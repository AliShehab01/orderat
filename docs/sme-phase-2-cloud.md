# SME phase 2: cloud account and sync, staff, AI order entry

Phase 1 keeps everything on the phone. Phase 2 adds:
- a cloud account, so data survives a lost phone and one shop works on several phones
- optional staff
- AI order entry from pasted messages and screenshots

Cloud sync stays **optional**: a seller can keep using the app offline-only, as today. The shared backend (this repo) serves both apps.

## Principles

- **Offline first.** The phone's local store remains the source the UI reads. Sync runs in the
  background (on launch, on foreground, after edits with a short debounce, and on pull-to-refresh)
  and never blocks the seller.
- **Isolation.** Same rules as the rest of Orderat: the apps only talk to Edge Functions, which use
  the `orderat_app` Postgres role. No PostgREST, no Supabase Auth (the project's `auth.users`
  belongs to Hayati), no service-role key for data.
- **Simple conflict rule.** Last writer wins per record, decided by the server-assigned sequence
  number of the write. That is enough for a small shop (edits to the same order at the same second
  from two phones are rare). Deletes are tombstones.

## Accounts (`orderat-auth`)

- The seller signs in with **Apple** on iPhone or **Google** on Android. Either provider works on
  either platform where the SDK allows it.
- The app sends the provider's ID token (JWT) to `orderat-auth`. The function:
  1. Verifies the token against the provider's JWKS: `iss`, `aud` (our client IDs), `exp`,
     `nonce`.
  2. Upserts `orderat.users (id uuid, provider, provider_sub, email, name, created_at)`.
  3. Returns a session: a random 32-byte token stored as SHA-256 in
     `orderat.sessions (token_hash, user_id, device_name, created_at, last_seen_at, revoked_at)`.
     A phone's session has no fixed end; signing out revokes it. Any session unused for 180 days is
     revoked on its next use (sliding: `last_seen_at` is refreshed on use, at most hourly), so a phone
     in use never signs out (security review 1 Oct 2026, F05; server/auth/store.ts). Whether a session
     is a phone's comes from the verified token, never from the body's `client`: a token for one of the
     apps' audiences (or a Google token the Android app asked for, `azp` ≠ `aud`) starts a phone's
     session; the website's tokens start a browser session that ends after 30 days and cannot approve
     a pairing (security retest 1 Oct 2026; server/auth/providers.ts `sessionClientFor`).
- Every other call sends `Authorization: Bearer <anon key>` (Supabase gateway) plus
  `X-Orderat-Session: <session token>`.
- "Delete my account" removes the user, their sessions, and every shop they own with its data.
  This is required by both stores.
- **Sign in with Apple revocation** (App Store Review Guideline 5.1.1(v)): an Apple signin may also send
  `authorizationCode` (Apple's one-time code from the same signin; iPhone and web). When the secrets
  `ORDERAT_APPLE_TEAM_ID`, `ORDERAT_APPLE_KEY_ID` and `ORDERAT_APPLE_PRIVATE_KEY` (the Sign in with Apple
  key's `.p8`) are set, `orderat-auth` exchanges it at `https://appleid.apple.com/auth/token` (`client_id` =
  the token's audience: `com.ams.orderat` for iOS, `com.ams.orderat.web` for the web; `client_secret` = an
  ES256 JWT) and keeps the refresh token in `orderat.apple_tokens (user_id, client_id, refresh_token)`
  (db/migrations/0007_apple_tokens.sql). "Delete my account" first calls
  `https://appleid.apple.com/auth/revoke` for each kept token, then deletes the account. Without the
  secrets the code is ignored (logged once); a failed exchange or revoke never fails signin or deletion.

## Shops and members

- `orderat.shops_cloud (id uuid, owner_user_id, name, created_at)` is the cloud copy of the seller's shop.
- `orderat.shop_members (shop_id, user_id, role, permissions jsonb, joined_at)`:
  - **owner**: everything.
  - **staff**: permissions `orders` (create and edit orders and customers), `prepare` (change status only), `money` (see expenses and profit), `products` (edit products).
- **Invites:** the owner creates a 6-digit code, valid for 48 hours, single use, stored hashed. Staff sign in, enter the code, and join.
- **One invite, one member** (third review, 3 Oct 2026, F5): `invite_join` claims the unused, unexpired invite and creates the membership in ONE database call (`orderat.claim_invite`, migration 0010; server/sync/store.ts `claimInvite`), with the staff limit inside it. The invite row is locked, so two accounts racing for one code get exactly one membership and the other the normal `invalid_code` answer; the shop row is locked while the staff are counted, so two accounts holding two different invites cannot both take the last seat. A join refused for the limit (`staff_limit`) leaves the invite unused; someone who already belongs to the shop uses the code up and gets their existing role back, nothing added.
- Staff limit is 5 per shop in v1. Staff use the owner's subscription.

## Sync (`orderat-sync`)

**Records.**
- One table: `orderat.records (shop_id, entity, id, seq bigserial, data jsonb, deleted bool, updated_by, updated_at)`, with primary key `(shop_id, entity, id)` and an index on `(shop_id, seq)`.
- Entities: `shop`, `product`, `customer`, `order`, `expense`, `occasion`, `stock_move`, `setting` (shop-level settings only; per-device prefs like language and theme never sync).
- `data` is the record exactly as the apps store it locally (both apps already use string UUID ids).

**Push, then pull,** in one call:
```json
{ "action": "sync", "shopId": "…", "cursor": 1234,
  "changes": [{ "entity": "order", "id": "…", "data": { … }, "deleted": false, "baseSeq": 1200 }] }
```
- The server applies each change atomically on its own record (a compare-and-swap on the record's `seq`, retried against the newest copy). Each accepted change gets a new `seq`. An order whose record carries a ledger, and a product push that has stock bookkeeping to record, are single atomic units across several rows (`orderat.sync_apply`, migration 0010: the order or product, the products' stock, `order_stock`, `stock_ops`), still a single call for the transaction pooler.
- Within a batch the changes are applied in the order sent, except that a push of an existing product whose stock moves name an order of the same batch is applied after the orders, so the order is on the server when its moves are judged. Customers and new products keep their place before the orders: the phones apply a pull in `seq` order (Android drops an order whose customer it does not hold yet).
- **A product comes before the order that moved it** (fourth review, 3 Oct 2026, R1): an installed Android app keeps a null link for an order line whose product it has not got yet, so a pull must deliver the products first. The atomic write of an order draws the `seq` of the products its stock effects move before its own; and once a batch is applied, every order it wrote whose products (the product the phone pushed in the same batch, which is applied after the order so its move is judged against it) now have a higher `seq` is given a fresh `seq` again, the `seq` alone (data, `updated_at` and `updated_by` stay), only while it is still as the batch left it. Conflicts are decided when each change is applied and are reported exactly as before. A product edited by a later batch still gets a higher `seq` than every older order that names it: that is what the Android fix (links kept and resolved when the record arrives) is for.
- A change whose `baseSeq` is older than the record's current seq still wins (last writer wins). The server reports it in `conflicts` so the app can show "updated on another phone" if it wants.
- The response is `{ "changes": [records with seq > cursor, up to 500], "cursor": newMax, "more": bool, "conflicts": [...], "rejected": [...], "membership": { "role", "permissions" } }`.
- `membership` is the caller's current role and permissions, re-read on every sync, so an owner's change to a staff member's permissions reaches that phone on its next sync.
- Each `rejected` entry is `{ entity, id, reason: "forbidden", record? }`. `record` (`{ data, deleted, seq, updatedAt }`) is the server's current copy: the phone replaces its refused local edit with it. With no `record` (the server has no copy, or the member may not see it), the phone drops its local copy.
- The app loops while `more` is true.

**Permissions** (server/sync/record-access.ts; tightened by the security review of 1 Oct 2026, F01,
docs/security-review-2026-10-01.md). The owner reads and writes everything. For staff:

| | pulls | pushes |
|---|---|---|
| every member, any flags | `shop`, `setting/subscription` | nothing |
| any one flag | also every other `setting`, `product`, `stock_move`, `occasion` | (per flag below) |
| `orders` | also `order`, `customer` | `order`, `customer`, `occasion` (create, edit, delete) |
| `prepare` | also `order`, `customer` | an existing order's `status`, `outForDeliveryAt`, `stockDeducted` (only a ledger that fits the stored order, see "Order stock ledger"), `updatedAt` and new `changes` entries with field `status` / `outForDelivery` |
| `money` | also `order`, `customer`, `expense` | `expense`; an existing order's `payments` and `removedPaymentIds` (added by id, removed only by id: see "Order payments with several phones"), `paymentStatus`, `updatedAt` and new `changes` entries with field `paymentStatus` / `payment` |
| `products` | (nothing more) | `product`, `stock_move` |

- The `shop` record and every `setting` (including `subscription` and `deliveryDefaults`) are the owner's only.
- A record a member may not pull is left out of the page, never sent as a deletion: tightening a member's flags never makes a phone delete what it holds.
- A grant that lets a member pull records they could not before gives those records a fresh `seq` (`members_update`), so the next sync brings them even though the phone's cursor is past them; customers and products come before orders.
- For `prepare` and `money` (without `orders`) the server copies the rest of the order from the stored record: they cannot create, delete or bring back an order, and stored `changes` entries are never edited or dropped.
- Staff without `products` cannot push other `product` changes. One exception keeps stock right when staff handle orders: staff with `orders` or `prepare` may push an existing, live product to add order-driven stock moves. Every move must have an order-driven reason (`orderConfirmed`, `orderCancelled`, `orderEdited`), an `id`, an `orderId` and a whole non-zero delta, or the push is refused; a move then only counts when its order allows it (third review, F2, server/sync/stock-merge.ts `planProductPush`, "Stock with several phones"): a fabricated move (a nonexistent order, an order the product is not on, an inflated or wrong-direction delta) changes nothing. The rest of what they send (price, name, tracking, quantity) is not stored, and a push that adds no move and differs beyond stock is refused.
- `photo_upload` needs `products` or `money` (a receipt photo); `photo_url` needs any flag.

**First sign-in on a phone with existing local data.**
- The app offers to upload this phone's shop, creating the cloud shop as owner, or to join an existing shop with an invite code.
- Uploading pushes every local record in batches of 200.

**Finding a shop again on a new phone (no local data yet).**
- `shops_list` (no fields beyond the action) returns every shop the signed-in user belongs to, owner
  or staff, newest first: `{ "shops": [{ "shopId", "role": "owner"|"staff", "name", "updatedAt" }] }`,
  an empty array when the user has none.
- `name`/`updatedAt` come from the shop's own `shop` entity record (see "Record formats" below) — never
  from the bootstrap name given once at `create_shop` time — so both are `null` until that record has
  synced at least once.
- The app shows this list so the seller can pick which shop to restore, then calls `sync` with
  `cursor: 0` for that `shopId` to pull everything down.

**Photos.**
- Product photos go to the Storage bucket `orderat-photos` at `<shopId>/<sha256>.jpg`. They are content-addressed, written by the function (same exception as the shop link), and private.
- Apps fetch them through `orderat-sync` action `photo` (short-lived signed URL).

**Limits.** Body at most 2 MB. 60 syncs per minute per session. Records at most 32 KB each.

## AI order entry (`orderat-parse`)

- **Input:** pasted text (a WhatsApp message) or one screenshot image (JPEG/PNG, at most 2 MB), plus the shop's product list (id, name, aliases) and `lang`/`addressAs`.
- **Processing:** reuses `server/ai/gemini.ts` `createGeminiExtractor`, the same order reader the web version uses.
- **Output:** a draft with the customer name, lines matched to product ids or free text, quantities, date, time and notes, each with a confidence.
- **Delivery (tester feedback, 1 Oct 2026):** the response also carries `fulfillment` (`"delivery"` | `"pickup"` | `null`), `address` (`{ area?, block?, road?, building?, flat?, city?, text? }` | `null`: Bahrain parts when the customer gives them, with Western digits; otherwise the free-text line in `text`, and the city; `text` is the whole address as written) and `deliveryNote` (directions for the driver, or `null`). An address, a location or words like توصيل / delivery mean delivery; استلام / pickup mean pickup; an address with nothing said means delivery. The address and directions are never left in the draft's `notes` (server/ai/delivery.ts). Older apps ignore these keys.
- **The app:**
  - A "Paste order" button on New Order (and a share-sheet target on Android: share a message to Orderat).
  - Shows the draft in the existing review form. The seller confirms or edits, then saves.
  - Nothing is saved without the seller's confirmation.
- **Limits and data handling:**
  - 50 per day per install (5 in demo), with a global cap. Signed in (`X-Orderat-Session`), the 50 (or 5)
    count per account instead; without a session, 100 per client IP per day, of which 50 may claim
    `demo: false` (security review F02, server/usage/trusted-limits.ts).
  - Phone numbers are stripped before sending.
  - Nothing is stored.

## Migration and rollout

- Migration `0004_cloud.sql` holds users, sessions, shops_cloud, shop_members, invites and records, with the same ownership dance as 0001-0003.
- Migration `0010_order_stock.sql` (third review, 3 Oct 2026; fourth review, same day, R1 and R4) adds `order_stock` and `stock_ops` and the functions `apply_stock_effect`, `sync_apply` (the atomic multi-record compare-and-swap under the sync push), `claim_invite` and the key functions `stock_move_key`, `stock_move_key_token` and `record_listed_moves`. Additive only: it is safe to run on the live database before the new `orderat-sync` code is deployed (nothing reads it) and safe with the code that is deployed now. **Deploy order: the migration first, then `orderat-sync`.** The functions run as the caller (`orderat_app`); only that role may call them. It had not been applied to any real database when the fourth review found that its backfill listed the bare lowercase id while the code looks moves up as `id:<id>`, so it was corrected in place; a database that did run the first draft gets its bare backfilled ids taken out and the right keys put in when the file is run (the file is idempotent). The new payment rules (`removedPaymentIds`) need no migration. **Client rollout:** the web app and the apps that write `removedPaymentIds` may ship before or after the server (an old server stores the field on whole-order pushes and ignores it on `money` pushes, where deleting by absence still works); the released iOS 1.0 keeps working on the new server (its deletion is recognised by its history entry), while Android 1.5.5 and the web app of before this change delete a payment by absence, which the new server does not honour: the payment comes back on their next pull until they are updated.
- Apps ship sync behind a "Cloud backup & sync" switch in Settings: off until the seller signs in. The existing local backup export stays.
- Privacy policy update: account data (provider id, email, name) and synced shop data are stored on our servers. The seller can delete them.

## Build order

1. Backend: auth (Apple and Google token verification), sync, parse, and the migration, with tests. PGlite for the sync rules; JWKS verification tested with generated keys.
2. **AI order entry** in both apps first. It is independent of accounts and gives quick value.
3. Sign-in and sync in both apps: iOS (JSON store records) and Android (drift tables, plus a `dirty`/`seq` column per synced table).
4. Staff: invite, join, the permissions UI, and role-gated screens.

## Record formats (shared by both apps)

One shop can be used from an iPhone and an Android phone at the same time, so `data` in every
sync record uses this **canonical JSON**, never a platform's local shape. Each app maps its local
model to and from it.

- **IDs:** lowercase UUID strings. iOS already uses UUID strings. Android keeps its integer primary keys and adds a
  `sync_id TEXT UNIQUE` column (UUID) to every synced table. It maps foreign keys (customer, product,
  order) through those UUIDs.
- **Formats:**
  - Dates: ISO 8601 UTC with milliseconds (`2026-09-27T14:05:00.000Z`).
  - Money: integer minor units.
  - Unknown keys: kept as-is and ignored, never dropped. Keep the raw JSON and merge your fields over it, so a newer app on another phone does not lose fields an older one does not know.
- **Entities:**

| entity | id | data |
|---|---|---|
| `shop` | the shop id | `nameAr, nameEn?, phone, currencyCode, pickupHours?, dailyCapacity?, businessType, vat:{enabled, trn, rateBps, pricesIncludeVat}, stock:{enabled, defaultLowStockThreshold}, createdAt` |
| `product` | uuid | `nameAr, nameEn?, aliases[], priceMinor, costMinor, dailyCapacity?, active, photoId?, trackStock, stockQuantity, lowStockThreshold, stockMoves:[{id, delta, reason, orderId?, note?, at}] (last 50), createdAt` |
| `customer` | uuid | `name, phone, area?, notes?, createdAt` |
| `order` | uuid | `customerId, status, fulfillmentType, dueAt, address:{area?, block?, road?, building?, notes?}, deliveryFeeMinor, paymentStatus, items:[{id, productId?, nameSnapshot, quantity, unitPriceMinor, unitCostMinor}], payments:[{id, amountMinor, method, note?, paidAt}], removedPaymentIds?:[paymentId], changes:[{id, field, oldValue?, newValue?, note?, at}], notes?, vatRateBps?, vatIncluded?, vatMinor?, invoiceNumber?, stockDeducted?:{productId: units}, createdAt, updatedAt` |
| `expense` | uuid | `amountMinor, category, note?, receiptPhotoId?, recurring, date, createdAt` |
| `occasion` | uuid | `kind, nameAr, nameEn?, startDate, endDate, preOrderOpensAt?, dailyCapacityOverride?, blocked, notes?` |
| `setting` | the key | `{ value }` for shop-level settings only, e.g. `whatsappTemplates`. Per-device prefs (language, theme, address form, Ask consent) never sync. |

- **Enum values** are the existing lowercase codes both apps already use (status, payment status, fulfillment, expense category, occasion kind, stock reason). A code an app does not know is shown as "other" and kept unchanged on write.
- **Stock with several phones (3 Oct 2026, second review L2, third review F1-F3): the server owns an order's stock.** A product's stock is the result of its moves, each applied exactly once. Phones move stock locally and push the product (`stockQuantity` and `stockMoves`, newest first, the last 50) and the order (with its ledger `stockDeducted`); the server turns those into one stock, so devices that did the same thing, or that were behind, cannot add it twice. Two tables (migration 0010) hold the books: `order_stock (shop, order, product, units)` is what the server has actually taken out of each product for each order (the "applied allocation"; `0` is a real value), and `stock_ops (shop, op id)` is every client move id the server has applied or deliberately ignored (and the ids already in a product's stored list when the server first sees it): durable, not capped, independent of the 50-entry display list. A move is keyed (fourth review, R4) by `id:` and its id with the ASCII capitals folded (iOS sends uppercase UUIDs, Android and the web lowercase; non-ASCII letters are left alone, so no database locale decides what a key is), or, for a move with no id (a legacy Android row), by `f:[at,delta,reason,orderId]` as JSON (a field that is not a string or a number counts as null, and so does a number JavaScript and PostgreSQL would print differently: below 1e-6 in size, or from 1e21 up; no stock move has one). The key rule is written once per language, `orderat.stock_move_key` in migration 0010 and `moveKey` in `server/sync/stock-merge.ts`, and a test runs both on the same fixtures. Every `stock_ops` row, whoever wrote it (a push, the migration's backfill, the server's own move), has that key.
  - **A. Orders with a ledger (the server applies it).** When an order write is accepted and the stored record carries a valid ledger, for every product the ledger, the allocation, the previously stored ledger or the order's lines name, `delta = applied - ledger[product]`. A non-zero delta changes the product's quantity by `delta` (from whatever it is then: a relative update), puts a server-made move first in its list (`id` = the md5 of order id, accepted order `seq` and product id, formatted as a UUID; reason `orderConfirmed` / `orderCancelled` / `orderEdited` as fits; the `orderId`; `at` = now) and gives the product a fresh `seq`, so every device pulls it (the product's `seq` is drawn before the order's: a pull delivers the product first, fourth review R1); `applied` becomes `ledger[product]`. A missing or deleted product is skipped, `applied` is still set. The order version and its stock effect commit together. So two devices confirming the same order take its stock once (the second finds `applied == ledger`); two conflicting item edits (3 -> 5 and 3 -> 4) leave stock equal to the order that won (the order record is last-writer-wins) and a cancel (`{}`) gives back exactly what is applied; a replay changes nothing. Before a product's list can lose a move (the server's move goes first and the list keeps 50), every move the stored list holds is recorded in `stock_ops` (R4: every path that rewrites a product's `stockMoves`, a client push merge, a deletion or a product that comes back, and the server's own effect, does this first). The server move's id is also recorded in `stock_ops`, so a phone that pulls it and pushes it back in its list, however much later, never has it applied. A status that holds no stock (`newOrder`, `cancelled`) settles the ledger to `{}`: that is what makes a release that does not know the ledger (it keeps the key it found, with the old ledger, and gives the stock back by its own move, which the server ignores) give back once.
  - **B. Client stock moves on a product push.** For each move the pushed list has and the stored list lacks, oldest first: already in `stock_ops` -> ignored (a retry, a stale copy, a pre-merge copy pushed again after the server applied the order's ledger). A manual move (any reason that is not order-driven, or no order id) -> applied once and recorded; only the owner and `products` staff may send them. An order-driven move -> no live order with that id in this shop: not applied and not recorded (a retry can still land once the order is there); the order has a ledger: the server owns its stock, the move is ignored and its id recorded (F1: two devices doing the same transition, F3: a first-time offline deduction older than the 50-entry list, are closed here); no ledger (a release that writes none: iOS 1.0, Android 1.5.5, the live web before it writes one): the move must have the direction of its reason, and the order's applied units for this product must stay within 0 and the units of that product on the order, then it is applied once, `order_stock` follows and its id is recorded; otherwise it is not applied and not recorded (F2). The stored quantity is never replaced by a pushed quantity when the push carries any move the stored copy lacks (applied, ignored or neither): it is the stored quantity plus the deltas applied. A push with no such move (a new product's opening quantity, a manual quantity edit that carries no move) keeps the earlier behaviour for the owner and `products` staff: stored as sent while its copy is up to date for stock, rebased onto the stored stock (the other fields still taken) when it is stale. Applied moves are listed on the product (newest first, 50, with the server's own moves); ignored and skipped ones are not, so a deduction is never shown twice. Other fields come from the pushed copy for members who may edit products, from the stored copy otherwise. The merged copy gets a fresh `seq`, so the pushing phone receives it on the same sync's pull. `baseSeq` is never used for stock.
  - **Orders confirmed before the server kept its own books (existing shops).** `order_stock` starts empty. The first time the server accounts for an (order, product) pair that has no row, it starts from what the stock really holds for it: with no stored ledger (a legacy order) what the product's stored moves for that order net to; with a stored ledger that does not name the product, nothing; otherwise the ledger's units, capped by the moves when the product's list is not full (a list under 50 holds every move the product ever had, so a ledger whose stock never moved took nothing) and trusted as written when it is full (the move may have been trimmed off its end; the same phone wrote both). So a later ledger push that restates what was taken changes nothing (the stock is not taken a second time), and a later cancel gives it back once. No data backfill is needed for this; migration 0010 only lists every move already in the products' stored lists in `stock_ops`, with the keys above (moves with and without an id).
  - **Remaining limits.** A move trimmed off a product's list before migration 0010 ran is not known to `stock_ops`; a stale phone that still holds it and pushes it again is the one case the server cannot tell from a new move (the earlier "newer than the oldest move of a full list" rule dropped legitimate offline moves instead). Moves still in a list when the migration runs, and every move applied or listed since, are known. A move that names an order the server never receives is never applied. A release that confirms or edits an order that already carries a ledger is not followed by the server (the order's ledger decides): the stock can be too high for it, never made up. Orders that are deleted keep their allocation; a product that comes back is not re-adjusted. A phone that edits a product or order while its own sync is in flight keeps its pre-merge copy and pushes it again: for products the server merges that by move ids (nothing is applied twice); for payments see "Order payments with several phones".
- **Order stock ledger:** `stockDeducted` is what the order actually took out of each product's stock (`{}` = nothing; missing = a legacy order, derived from the stock moves that carry the order id). Confirming writes it, cancelling gives back exactly it and writes `{}`, item edits move the difference. Tracking switches never decide what comes back. The server keeps it honest (second review, 3 Oct 2026, L1 and L3, server/sync/stock-ledger.ts):
  - A missing ledger never clears a stored one. "Absent" (or `null`, or an invalid value) means the client does not know the ledger (an older app, a stale copy); only an explicit valid value changes it, and an explicit `{}` clears it. This holds for prepare/money pushes and for whole-order pushes (owner, `orders` staff).
  - A whole-order push (owner, `orders` staff) takes its ledger only when it is valid and fits the pushed order's own lines (every key a product of one of its lines, no value above that product's units; third review, F1): otherwise it counts as leaving it out, so a ledger can never name stock the order does not hold. The ledger is what the server turns into stock (see above).
  - A `prepare`-only push (it cannot edit items, so the stored order is the reference) takes a ledger only when it equals the stored one; or it moves the order into a deducted status (`confirmed`, `ready`, `collected`) from one that is not, every key is the product id of a line of the stored order and every value is at most that product's units on the order; or it moves the order out of a deducted status and the ledger is `{}`; or the stored order has no ledger, is and stays in a deducted status, and the ledger fits the lines (a legacy order's derived ledger). Anything else is ignored like any other invalid prepare value: the stored ledger stays and the rest of the push is handled as before.
- **Order payments with several phones (3 Oct 2026, third review F4, fourth review R2 and R3): payments are add-only.** A payment is identified on the wire by its `id` (every app writes one: iOS an uppercase UUID, Android and the web a lowercase one, compared without case; a payment with no id by its fields). The order record is last-writer-wins, so a pushed `payments` list says what that phone knows, not what the order holds, and money must never vanish silently: **the absence of a payment in a pushed order never removes it, whatever the `baseSeq`.** (The third review's rule, "an up-to-date copy that leaves a payment out removes it", let an iOS phone, which refreshes its recorded `seq` for a record it did not apply, delete another phone's payment with its old list, and let a stale copy bring back a payment another phone had deleted.)
  - **Removing a payment: `removedPaymentIds`.** The order record has a field `removedPaymentIds`, an array of the ids of the payments the user deliberately deleted, **grow-only**. Deleting a payment (an undo of a payment just recorded included) removes it from `payments` and appends its id, exactly as it is written on that payment, to `removedPaymentIds`. The field syncs with the order and is kept in backups; a client never drops an id from it, keeps sending every id it knows, and sends its `payments` as it holds them (leaving one out removes nothing). On a pull a client takes the server's `payments` and `removedPaymentIds` and removes a local payment whose id is listed.
  - **The rule, on every accepted order write by a member who may write payments** (the owner, staff with `orders` or `money`; whole-order pushes and `money` merges): `removed = stored removedPaymentIds + the valid pushed ids + legacy removals`; `payments = (stored payments + pushed payments, by id; a payment in both takes the pushed copy) minus removed`; both are stored. Staff who only `prepare` cannot add removal ids (their push never touches payments), and a member with neither permission cannot push an order at all. Any arrival order, a retry, and a stale copy that still holds a removed payment give the same result: the payment stays removed; a payment added concurrently survives.
  - **A valid `removedPaymentIds`** is an array of at most 500 non-empty strings of at most 64 characters; anything else is ignored as a whole and not stored. Ids are compared without case. An order holds at most 1,000 removal ids and 500 payments (so a grow-only list cannot be used to bloat one record); past them a new id or payment is not stored, what is stored is never dropped.
  - **Legacy removals (the released iOS 1.0).** It deletes a payment by leaving it out of `payments` and logs the history entry `payment: "<amount in minor units>" -> "removed"`. A new such entry (not already stored) for which exactly as many stored payments with that amount are missing from the pushed copy as there are such new entries for that amount removes those payments and records their ids; a payment recorded after the entry cannot be the one it removed; anything else is ambiguous (the missing payment may be one the pushing phone never saw) and keeps the payments. Android 1.5.5 and the web app of before this change delete by absence with no such entry: until they carry `removedPaymentIds`, a payment they delete returns on their next pull.
  - **`paymentStatus`** is recomputed from the resulting payments and the order's total (the apps' rule: nothing paid -> `unpaid`, paid at least the total -> `paid`, otherwise `deposit`; the total is the lines, plus the delivery fee, plus the VAT when it was added on top) when the result differs from what the push said and the record carries the lines; otherwise the pushed status stays. The server writes no `changes` entry for that recomputation.
  - **Limits.** A payment recorded and removed on iOS 1.0 before it ever synced, while another phone's payment of the same amount is stored, looks like a removal of that other payment unless it was recorded after the removal entry; a removal entry that reaches the server before the creation it undoes names no stored payment, so a late creation is stored (a phone's own pushes arrive in order; only a retry after a lost response can do this). A deleted order (a tombstone) keeps its removal ids but its payments are not merged into a record that comes back. A payment present in both takes the pushed copy even from a stale phone (no app edits a payment: a correction is a removal and a new payment).
- **Invoice numbers:** with sync on, each device prefixes its sequence with a short device code taken from the session (for example `INV-A7-000123`), so two phones never issue the same number. Without sync, numbering stays as it is today.
- **Photos:** product and receipt photos travel as `photoId` (SHA-256 of the JPEG). Upload with `photo_upload`, fetch with `photo_url`, and cache locally by photoId.
