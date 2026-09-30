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
     Sessions are long-lived; signing out revokes them.
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
- The server applies each change in a transaction. Each accepted change gets a new `seq`.
- A change whose `baseSeq` is older than the record's current seq still wins (last writer wins). The server reports it in `conflicts` so the app can show "updated on another phone" if it wants.
- The response is `{ "changes": [records with seq > cursor, up to 500], "cursor": newMax, "more": bool, "conflicts": [...], "rejected": [...], "membership": { "role", "permissions" } }`.
- `membership` is the caller's current role and permissions, re-read on every sync, so an owner's change to a staff member's permissions reaches that phone on its next sync.
- Each `rejected` entry is `{ entity, id, reason: "forbidden", record? }`. `record` (`{ data, deleted, seq, updatedAt }`) is the server's current copy: the phone replaces its refused local edit with it. With no `record` (the server has no copy, or the member may not see it), the phone drops its local copy.
- The app loops while `more` is true.

**Permissions.**
- Staff without `money` never receive `expense` records, and their pushes of them are rejected.
- Staff without `products` cannot push `product` changes.
- `prepare`-only staff can change only an order's `status`. The server copies the rest of the order from the stored record.

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
- **The app:**
  - A "Paste order" button on New Order (and a share-sheet target on Android: share a message to Orderat).
  - Shows the draft in the existing review form. The seller confirms or edits, then saves.
  - Nothing is saved without the seller's confirmation.
- **Limits and data handling:**
  - 50 per day per install (5 in demo), with a global cap.
  - Phone numbers are stripped before sending.
  - Nothing is stored.

## Migration and rollout

- Migration `0004_cloud.sql` holds users, sessions, shops_cloud, shop_members, invites and records, with the same ownership dance as 0001-0003.
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
| `order` | uuid | `customerId, status, fulfillmentType, dueAt, address:{area?, block?, road?, building?, notes?}, deliveryFeeMinor, paymentStatus, items:[{id, productId?, nameSnapshot, quantity, unitPriceMinor, unitCostMinor}], payments:[{id, amountMinor, method, note?, paidAt}], changes:[{id, field, oldValue?, newValue?, note?, at}], notes?, vatRateBps?, vatIncluded?, vatMinor?, invoiceNumber?, createdAt, updatedAt` |
| `expense` | uuid | `amountMinor, category, note?, receiptPhotoId?, recurring, date, createdAt` |
| `occasion` | uuid | `kind, nameAr, nameEn?, startDate, endDate, preOrderOpensAt?, dailyCapacityOverride?, blocked, notes?` |
| `setting` | the key | `{ value }` for shop-level settings only, e.g. `whatsappTemplates`. Per-device prefs (language, theme, address form, Ask consent) never sync. |

- **Enum values** are the existing lowercase codes both apps already use (status, payment status, fulfillment, expense category, occasion kind, stock reason). A code an app does not know is shown as "other" and kept unchanged on write.
- **Stock with several phones:** each order's stock moves are recorded on the phone that confirmed the order. `stockQuantity` is last-writer-wins like any field. This is acceptable for v1.
- **Invoice numbers:** with sync on, each device prefixes its sequence with a short device code taken from the session (for example `INV-A7-000123`), so two phones never issue the same number. Without sync, numbering stays as it is today.
- **Photos:** product and receipt photos travel as `photoId` (SHA-256 of the JPEG). Upload with `photo_upload`, fetch with `photo_url`, and cache locally by photoId.
