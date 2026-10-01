# Security review, 1 October 2026: what changed and what remains

An external release review of `main` at `3c61513` found seven issues (F01 to F07). The server fixes
are on the branch `sec/review-oct1` (not merged to `main`). This page covers, for each finding, what
changed, what is left, and the steps the founder takes to deploy.

| | Severity | Finding | Status |
|---|---|---|---|
| F01 | High | Staff permissions were not enforced on sync pulls or pushes | Fixed (server) |
| F02 | High | Anonymous AI quotas could be reset by the client | Fixed (server) |
| F03 | | Subscription status is reported by the client | Design below; needs store credentials |
| F04 | | Next.js and Vitest advisories | To do: dependency upgrade |
| F05 | Medium | App sessions never expire | Fixed (server) |
| F06 | | iOS Keychain items can move to another device | To do: iOS app |
| F07 | | HSTS | Handled by the site agent |

## F01 (high): staff permissions on sync

**Finding.** A staff member with every flag off (`orders`, `prepare`, `money` and `products` all
false) still pulled every customer, order and product; only expenses were filtered. They could also
push the shop record and ordinary settings, for example a made-up VAT setting. The `subscription`
setting was already owner only.

**What changed** (`server/sync/record-access.ts`, `push-pull.ts`, `handler.ts`, `store.ts`). Reads and
writes are now decided per entity and per flag. The rules follow what the phones' and the web's screens
let each flag do (iOS `Store.canManageOrders` / `canChangeOrderStatus` / `canSeeMoney` /
`canEditProducts`, Android `CloudShopService`, the web's `live-core` `access`). The owner is unaffected.

| Staff with | Pulls | Pushes |
|---|---|---|
| any flags, even none | `shop`, `setting/subscription` | nothing |
| any one flag | also every other setting, `product`, `stock_move`, `occasion` | (per flag below) |
| `orders` | also `order`, `customer` | `order`, `customer`, `occasion`: create, edit, delete |
| `prepare` | also `order`, `customer` | an existing order's `status`, `outForDeliveryAt` and `updatedAt`, plus new `changes` entries with field `status` or `outForDelivery` |
| `money` | also `order`, `customer`, `expense` | `expense`; an existing order's `payments`, `paymentStatus` and `updatedAt`, plus new `changes` entries with field `paymentStatus` or `payment` |
| `products` | (nothing more) | `product`, `stock_move` |

- **Shop record and settings.** These are owner only: the `shop` record and every setting, including
  `subscription` and `deliveryDefaults`. No synced setting belongs to a single staff member; per-device
  preferences never sync.
- **Stock exception.** Staff with `orders` or `prepare` may still push an existing product when only its
  stock changed (`isOrderStockUpdate`, unchanged). A product that is a tombstone no longer qualifies.
- **`prepare` and `money` order pushes.** For these (without `orders`), the server takes only the fields
  the flag covers and copies the rest from the stored order. These staff cannot create, delete or bring
  back an order, and stored history entries are never edited or dropped.
- **Pull filtering.** A record the member may not pull is left out of the page. It is never sent as a
  deletion, so tightening a member's flags never makes a phone delete local data.
- **Refused pushes.** These come back as the existing `rejected` entries, which every client already
  handles. The entry carries the server's copy only when the member may pull that record. Otherwise the
  phone drops its local copy, as `docs/sme-phase-2-cloud.md` already specified.
- **Grants.** The phones and the web keep their pull cursor when flags change. A new staff member starts
  with every flag off, so their first pull moves the cursor past every order. To fix this,
  `members_update` now gives the records a grant makes visible a fresh `seq`. They are re-sequenced per
  entity, so products and customers always come before orders (Android drops an order whose customer it
  does not hold). Data, `updatedAt` and `updatedBy` are untouched. Every device of the shop pulls those
  records once more.
- **Photos.** `photo_upload` also accepts `money` (receipt photos). `photo_url` needs at least one flag.

**Tests:**
- `server/sync/record-access.test.ts`: every flag off, each flag alone, all flags, the owner.
- `server/sync/push-pull.test.ts`: the same against PGlite, plus `deliveryDefaults` and `outForDeliveryAt`.
- `server/sync/handler.test.ts`: grants re-send what they make visible; photo permissions.

**What remains** (clients, found while reading them; none blocks the server deploy):
- **Android: rejection without a server copy.**
  - A `shop` push rejected without a server copy is never marked clean and is pushed again on every
    sync. That only happens for a shop id the server never had, for example after "Delete all data" on
    a staff phone.
  - A delete that is refused while the record still exists keeps its tombstone and is pushed again on
    every sync.
  - A rejected new product, customer or order without a server copy is hard-deleted locally. If other
    rows reference it (foreign keys with no cascade), the delete fails and the whole sync stops. One
    example: an orders-only staff member types a new item name, which auto-creates a product.
  - These paths existed before. Narrower staff flags make them easier to reach.
- **Android: ungated screens.** Android lets any staff member change an order's status, edit customers,
  toggle a product's "active" switch, and edit the shop profile, VAT, WhatsApp templates and occasions.
  The server now refuses these, and the phone puts the server's copy back. Gate those screens on the
  same flags.
- **iOS: ungated screens.** The shop profile, VAT/stock settings and occasions are not gated for staff.
  They are refused and reverted the same way.
- **Phones keep pulled data when flags narrow.** A phone keeps whatever it already pulled; the server
  only stops sending updates. A phone wipe on narrowing would be a client change.
- **No field-level read redaction.** For example, product cost is still sent to staff who may pull
  products but lack `money`. The phones write whole records back, so a redacted field would come back
  as 0 and overwrite the owner's value.

## F02 (high): AI quotas a client could reset

**Finding.** `orderat-ask`, `orderat-studio` (caption, photo) and `orderat-parse` keyed their only
per-caller quota by the body's `installId`, and scaled it by the body's `demo` flag. A script could
reset its quota by sending a new `installId`, and claim the paid quota with `demo: false`.

**What changed** (`server/usage/trusted-limits.ts`, `feature-limits.ts`, `server/ask/limits.ts`, the
three handlers, `db/migrations/0009_ai_trusted_limits.sql`). `installId` and `demo` stay, for the apps'
"remaining today". In front of them now sit limits the client cannot reset:

- **With a valid `X-Orderat-Session`:** one counter per account, per feature and day, instead of per
  install. The limit is the install quota, or the demo one when the call says `demo: true`. No IP cap
  applies. An unknown, revoked or idle session is simply counted by IP.
- **Without a session:** per client IP. The IP is hashed by `server/shared/crypto.ts`'s `hashClientIp`,
  salted with `ORDERAT_AUTH_IP_SALT` (or the database URL when that is unset, as for `orderat-auth`), and
  never stored. Each IP gets two paid installs' worth of calls a day. Of those, only one paid install's
  worth may claim `demo: false`, which is the stricter cap. The per-install count still applies on top.
- **Global caps:** unchanged, and checked last. A call refused by its own limit never spends the global
  budget.
- **Responses:** `remainingToday` is the tightest counter that applies. A refusal is the existing
  `429 { "error": "daily_limit" }` (`busy` for the global cap), so no client change is needed.
- **Logs:** they add `caller: "account" | "anonymous"`, never the IP, its hash or the user id.

| Feature | Per install (demo) | Per account (demo) | Per IP, no session | Of which `demo: false` | Global (env) |
|---|---|---|---|---|---|
| Ask Orderat | 30 (3) | 30 (3) | 200 | 100 | 3000 (`ORDERAT_ASK_DAILY_CAP`) |
| Captions | 20 (3) | 20 (3) | 100 | 50 | 3000 (`ORDERAT_CAPTION_DAILY_CAP`) |
| Photos | 10 (2) | 10 (2) | 40 | 20 | 300 (`ORDERAT_PHOTO_DAILY_CAP`) |
| Order entry (parse) | 50 (5) | 50 (5) | 300 | 150 | 5000 (`ORDERAT_PARSE_DAILY_CAP`) |

The per-IP caps are set well above one install's quota on purpose: Gulf mobile carriers put many phones
behind one carrier-grade NAT address, and the phones do not send a session on AI calls yet, so a low
per-IP cap would block real (and paying) users. Their job is fairness (one script cannot eat the global
budget); the global caps bound spend. The per-IP numbers are in `DEFAULT_*_LIMITS` (`server/usage/feature-limits.ts`) and `DEFAULT_LIMITS`
(`server/ask/limits.ts`).

**Tests:** `server/usage/trusted-limits.test.ts`, `feature-limits.test.ts`, `server/ask/limits.test.ts`,
and the ask, parse and studio handler tests. They cover rotating installIds from one IP, a stricter cap
for `demo: false`, another IP, account quotas across installs and IPs, a bad session, and the global cap.

**What remains:**
- **Is the IP header trustworthy?** `hashClientIp` takes the first `X-Forwarded-For` entry; the
  `pair_start` and shop order limits already do the same. If Supabase's edge appends to a client-sent
  `X-Forwarded-For` instead of replacing it, a script could vary that header to dodge the per-IP cap.
  The global caps still bound the cost. Check after deploying (see the smoke checks below). If the
  header is spoofable, switch `hashClientIp` to the header the gateway sets itself, for example
  `cf-connecting-ip`. That is a one-line change in `server/shared/crypto.ts`.
- **The phones do not send `X-Orderat-Session` on AI calls yet.** Only the web does. Until they do, a
  signed-in phone is counted by IP. Sending the header when signed in moves it to its account's quota.
- **Shared mobile IPs (CGNAT).** Many customers can share one carrier IP and its budget. Watch for 429s
  with `caller: "anonymous"` in the logs, and raise `perIp` if real users hit it.
- **`demo: false` is still a claim.** A signed-in account can make it too, until F03.
- **Counter rows are never pruned,** like the existing usage ledgers.

## F03: subscription status is client-reported

**Finding.** The paid state rests on what the apps report: the owner's `setting/subscription` record and
the AI calls' `demo` flag. Nothing checks it with Apple or Google.

**Not fixed here: it needs server-side purchase verification.** The design:

- **Table.** `orderat.store_subscriptions (user_id → users on delete cascade, platform, product_id,
  original_transaction_id or purchase_token_hash, status, expires_at, auto_renew, environment,
  last_verified_at)`. One row per store subscription, tied to the signed-in owner.
- **Verify action.** A signed-in action, `subscription_verify`, in `orderat-auth` or a new
  `orderat-billing` function.
  - **iOS.** The app sends StoreKit 2's `Transaction.jwsRepresentation`. The server:
    - verifies the JWS certificate chain up to Apple Root CA G3;
    - checks bundle id `com.ams.orderat`, product `orderat.basic.monthly` / `orderat.basic.yearly`,
      `expiresDate` and `revocationDate`;
    - confirms with the App Store Server API (`GET /inApps/v1/subscriptions/{originalTransactionId}`,
      an ES256 JWT signed with an In-App Purchase key).
  - **Android.** The app sends `purchaseToken` and `productId`. The server calls the Google Play
    Developer API `purchases.subscriptionsv2.get` for package `com.orderat.app`, and checks
    `subscriptionState` (ACTIVE or IN_GRACE_PERIOD) and the line items' `expiryTime`.
- **Renewals and refunds.**
  - **Apple:** App Store Server Notifications V2 POST to the function, which verifies the
    `signedPayload` JWS.
  - **Google:** Real-time developer notifications arrive through a Pub/Sub push subscription. The
    function checks the push's auth token, then fetches the subscription again.
- **Use.** The website's paid check, the AI `demo` flag for signed-in callers, and staff (who use the
  owner's subscription) then read the owner's verified row. The client's `subscription` setting stays
  only for display.

**Credentials the founder must create:**
- **Apple:**
  - In App Store Connect, go to Users and Access, then Integrations, then In-App Purchase, and generate a
    key. Keep the **Issuer ID**, the **Key ID** and the **.p8** file. These become the secrets
    `ORDERAT_APPLE_IAP_ISSUER_ID`, `ORDERAT_APPLE_IAP_KEY_ID` and `ORDERAT_APPLE_IAP_PRIVATE_KEY`.
  - Under the app's App Information, set the App Store Server Notifications URL (Version 2), for
    production and for sandbox, to the new function.
  - Note the app's numeric Apple ID.
- **Google:**
  - In the Google Cloud project linked to Play Console, enable the **Google Play Android Developer
    API**.
  - Create a **service account** with a JSON key. This becomes the secret
    `ORDERAT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
  - In Play Console, under Users and permissions, invite that service account with "View financial
    data" and "Manage orders and subscriptions".
  - Under Monetization setup, then Real-time developer notifications:
    1. Create a Pub/Sub topic.
    2. Give `google-play-developer-notifications@system.gserviceaccount.com` the Publisher role on it.
    3. Add a push subscription to the function URL with an auth token, stored as
       `ORDERAT_PLAY_RTDN_TOKEN`.

## F04: Next.js and Vitest advisories

`npm audit` on this branch reports:
- **Next.js:** `next` 16.3.5 has a **critical** advisory, "Remote Code Execution in next/og
  ImageResponse", affecting >=16.2.0 <16.3.6. This repo does not import `next/og`.
- **Vitest:** `vitest` 3.2.x has a **moderate**, dev-only advisory, "Path Traversal / Arbitrary File Read
  via @vitest/mocker Redirect Mock", affecting <4.1.11.

**Not changed here:** `package.json` is outside this branch's scope. To do in a separate change:
1. Raise `next` and `eslint-config-next` to 16.3.8 (not a major version).
2. Raise `vitest` to 4.1.11 or later. This is a major version, so check `vitest.config.mts` and the
   setup file.
3. Run `npm ci`, `npx vitest run`, `npm run lint` and `npm run build`.

## F05 (medium): app sessions never expire

**What changed** (`server/auth/store.ts`, `handler.ts`):
- **Idle expiry.** A session (a phone's or a browser's) that has gone **180 days** without a call is
  revoked on its next use and answered 401, like any signed-out session. Revoked means it never comes
  back.
- **Sliding window.** `last_seen_at` is refreshed on use, at most once an hour and never backwards. A
  phone in use is never signed out, and a sync every few seconds no longer writes on every call.
- **Browser sessions** keep their fixed 30-day end as well.
- **Signin clock.** `createSession` now stamps `created_at` / `last_seen_at` with the signin's clock.

**Deploy note.** No migration is needed. Until now `last_seen_at` was refreshed on every call, so active
phones are unaffected. Sessions unused for 180 days are revoked on their next use; there are none yet,
because the cloud launched in September 2026.

A phone whose session lapses gets 401:
- **iOS** re-checks its session on a sync 401 and signs out locally, then shows the sign-in row
  (`SyncEngine` calls `CloudAccountManager.refreshSession`).
- **Android**'s `CloudAuthService.refresh` does the same when it runs.

The phone's local data stays.

**Tests:** `server/auth/store.test.ts` and `handler.test.ts`. They cover use every 100 to 179 days past
day 400, revocation at 180 days, other sessions left alone, the throttle, and "never backwards".

## F06: iOS Keychain items can move to another device

`orderat-ios/Orderat/Features/Keychain.swift` saves its items with `kSecAttrAccessibleAfterFirstUnlock`.
Those items are:
- the Sign in with Apple user id;
- the cloud session (`CloudAccountManager`);
- the shop link edit tokens (`ShopClient`).

With that attribute, an encrypted backup restored onto another iPhone carries them along.

**To do in the iOS app:**
1. Use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
2. Once at launch, re-save the existing items, or `SecItemUpdate` their `kSecAttrAccessible`.

A restored phone then signs in again. F05 already limits a copied session to 180 days without use.

## F07: HSTS

The site agent handles this in `site/`. Nothing on this branch.

## Founder deploy steps

1. **Review the branch.** Review `sec/review-oct1` and merge it when ready. This work does not merge it.
2. **Apply the migration first.** The AI functions write to its tables, so deploying them before the
   migration makes every AI call fail.
   ```
   npm run hosting:migrate -- --dry-run   # should list only 0009_ai_trusted_limits.sql
   npm run hosting:migrate
   ```
   0009 only adds two tables, `orderat.ai_ip_usage` and `orderat.ai_account_usage`, so it is safe to
   leave in place if the functions are rolled back.
3. **Secrets.** None are new. `ORDERAT_AUTH_IP_SALT` stays optional; when unset, the salt is derived from
   the database URL. It now also salts the AI functions' per-IP caps.
4. **Redeploy these five functions.** They bundle the changed server code.
   ```
   npm run hosting:deploy -- orderat-sync orderat-auth orderat-ask orderat-studio orderat-parse
   ```
   - `orderat-sync`: F01, and F05 through its session check.
   - `orderat-auth`: F05, and the shared IP-salt helper.
   - `orderat-ask`, `orderat-studio`, `orderat-parse`: F02, and F05 through the account lookup.
     `orderat-parse` also ships the tester-feedback delivery fields `fulfillment`, `address` and
     `deliveryNote`.
   - `orderat-shop`, `orderat-campaigns`, `orderat-owner`, `orderat-whatsapp` and `orderat-instagram`
     need nothing. The WhatsApp/Instagram order reader's request is unchanged.
5. **Smoke checks:**
   - **Staff with every flag off.** A sync pulls only the shop record and the subscription setting. Grant
     `orders`, and the next sync brings customers, products and orders. The owner's sync is unchanged.
   - **AI calls.** Logs show `caller`. Send two AI calls without a session whose `X-Forwarded-For`
     differs. Check that both add to the same row in `orderat.ai_ip_usage` for your IP. If they open
     separate rows, the header can be spoofed; see the first item under F02's "What remains".
6. **Client follow-ups.** None blocks this deploy.
   - Phones send `X-Orderat-Session` on AI calls when signed in.
   - Android: rejections without a server copy, and gating its screens like the server (F01).
   - iOS: the Keychain change (F06).
   - F03 once the store credentials exist.
   - The F04 dependency upgrade.
