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

A retest on 1 October 2026 found two more server issues (R01, and F05's session class), settled the
client IP question and brought F04's Next.js upgrade: see "Retest 1 Oct" at the end.

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
- **Stock exception.** Staff with `orders` or `prepare` may still push an existing product to add
  order-driven stock moves. A product that is a tombstone no longer qualifies. (Since 3 Oct 2026 this
  goes through the stock merge, `planProductPush` (first `mergeProductStock`), which replaced
  `isOrderStockUpdate`, and a move only counts when its order allows it; see "Second review, 3 Oct" and
  "Third review, 3 Oct" below.)
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

## Retest 1 Oct

An external retest of `main` at `41fc4b5` on 1 October 2026 found two more server issues, answered the
open question about the client IP header, and flagged one accessibility issue in the web app. The fixes
are on the branch `fix/retest-oct1` (not merged to `main`), one commit per item, with F04's dependency
upgrade.

| | Severity | Finding | Status |
|---|---|---|---|
| R01 | Medium | A restricted staff push could put an owner's edit back | Fixed (server: `orderat-sync`) |
| F05 | Medium | The caller chose whether its session was a phone's | Fixed (server: `orderat-auth`) |
| IP | | Can a caller choose its client IP? (F02, "What remains") | Checked on the live gateway: no |
| A11y | | New order quantity buttons were announced as "+" and "−" | Fixed (web app) |
| F04 | | Next.js advisory | Fixed: `next` 16.3.8; Vitest left as is |

### R01 (medium): a staff push could undo an owner's edit

**Finding.** A staff push with `prepare` or `money` (and not `orders`) read the order, merged the fields
its flag covers onto that copy, and wrote the whole record back (`server/sync/push-pull.ts`,
`record-access.ts`, `store.ts`). When the owner changed the order between that read and that write (a
new `totalMinor`, say), the staff write put the old total back. Its `baseSeq` matched the copy it had
read, so no conflict was reported either.

**What changed.** Each change is now read, checked and written as one unit per record:
- The write is a compare-and-swap on the record's `seq`, which every write re-draws
  (`store.ts` `writeRecordIfUnchanged`): `UPDATE ... WHERE seq = <the seq read>`, or, for a record
  that did not exist, `INSERT ... ON CONFLICT DO NOTHING`. Each is a single statement, so it needs no
  transaction and works through the transaction pooler.
- When another write landed in between, nothing is written; the record is read again and the change
  decided again on the record as it is now (`push-pull.ts`). A `prepare` or `money` push therefore only
  changes its own fields on the current stored order, and a push onto an order deleted meanwhile is
  decided against the tombstone (refused for these staff, with the tombstone as the server's copy).
- A conflict is reported as before, `{ entity, id, seq }`, with the seq of the version the push actually
  replaced, also when that version only appeared while the push was running. Two owner phones still get
  last-writer-wins on the whole record, and now hear about the conflict too.
- After 5 attempts in a row lose to other writes, the sync answers 500 and the phone retries later. With
  a handful of devices per shop, even a second attempt is rare.
- **Clients:** no change. The merged record has a fresh `seq`, so the same sync's pull already brings it
  back to the phone that pushed.

**Tests:** `server/sync/push-pull.test.ts` ("R01"), against PGlite, with each push interleaved
deterministically with another device's write between its read and its write: the owner's total edit
racing a prepare-only status change and a money-only payment, a status change racing a payment, two
owner phones, a delete in between, a record created in between, and a record that keeps changing.
`server/sync/store.test.ts` covers the compare-and-swap itself.

### F05 (medium): the caller chose its session class

**Finding.** `signin`'s body field `client` decided the session class. `client: "app"` with a token for
the website (the Sign in with Apple Services ID, or the Google web client) got a phone's session: no
fixed end, and allowed to approve website pairings, which mint further sessions.

**What changed** (`server/auth/providers.ts` `sessionClientFor`, `handler.ts`, `verify-token.ts`,
`supabase/functions/orderat-auth/index.ts`). The verified token decides:

| Token | Session |
|---|---|
| Apple, `aud` `com.ams.orderat` (the iPhone app) | phone ("app") |
| Google, `aud` the iOS client (the iPhone app) | phone ("app") |
| Google, `aud` the web client, `azp` another client of the project (the Android app) | phone ("app") |
| Apple, `aud` `com.ams.orderat.web` (the website's Services ID) | browser ("web"), 30 days |
| Google, `aud` the web client, `azp` the same or none (the website) | browser ("web"), 30 days |
| Any other audience that verifies | browser ("web"), 30 days |

- **Why `azp`.** The Android app asks Google for tokens addressed to the web client (`serverClientId`),
  so `aud` alone cannot tell Android from the website. Google puts the Android client's own id in
  `azp`, and issues such a cross-client token only to a native app of the same Google Cloud project.
  `verify-token.ts` now reports `azp`.
- **`client`** is still validated (`"web"`, `"app"` or absent; anything else is 400) and otherwise
  ignored. A value the token overruled is logged as `requestedClient`. The `auth_signin` log line now
  says which kind of session it started (`client`).
- **Pairing approval** stays phone-only: only a session with no fixed end approves (unchanged check).
- **Sessions started before the deploy** keep their kind; nothing records which token started them.
  The website has always sent `client: "web"`, so only a hand-made request could have got a phone's
  session from a website token. The 180-day idle limit applies to those too.
- **Configuration.** `orderat-auth` passes the apps' audiences: `com.ams.orderat` and the Google iOS
  client (plus `ORDERAT_GOOGLE_IOS_CLIENT_ID` when set). No new secrets.

**Tests:** `server/auth/handler.test.ts` ("F05"): five tokens (Apple iPhone, Apple website, Google
website, Google Android, Google iPhone) times three `client` values (none, `"app"`, `"web"`), checking
the stored expiry and whether `pair_approve` is allowed; plus the log line. `providers.test.ts` covers
`sessionClientFor` alone and `verify-token.test.ts` the `azp` claim.

### The client IP header: checked on the live gateway

F02 left open whether a caller could choose its client IP for the per-IP limits (the AI calls,
`pair_start`, shop orders), which key on the first `X-Forwarded-For` entry (`server/shared/crypto.ts`
`hashClientIp`). The live gateway was tested on 1 Oct 2026:
- A client-sent `X-Forwarded-For: 1.2.3.4` does not reach the function.
- The gateway rewrites `X-Forwarded-For`, and its first entry equals `cf-connecting-ip`, the address
  Cloudflare saw the call come from.

So a script cannot rotate its per-IP bucket by sending the header, and no code change is needed.
`hashClientIp` now records this in its comment. Should the hosting ever change (another proxy in front,
or a gateway that appends instead of rewriting), switch it to `cf-connecting-ip`.

### Web app: the quantity buttons say what they do

The New order and Edit items quantity buttons were announced as just "−" and "+". They now read
"Decrease quantity of Cheesecake" / "Increase quantity of Cheesecake" ("تقليل كمية …" / "زيادة كمية …"),
and the minus with one left, which removes the line, "Remove Cheesecake" (`public/orderat/app.js`,
`i18n.js`). A custom line without a name yet reads "Custom item". The shop link's lead-time buttons
had the same bare symbols and now read "Decrease lead time" / "Increase lead time". The icons seen are
unchanged. **Tests:** `web/a11y-steppers.test.js` runs the items editor with the real labels, in English
and Arabic, and checks that no button in `app.js` or `live.js` is labelled with a bare symbol.

### F04: dependencies

- **Next.js:** `next` and `eslint-config-next` 16.3.5 → 16.3.8, the newest 16.3.x; the critical `next/og`
  advisory affects 16.2.0 to 16.3.5. Only the `next` packages moved in the lockfile, and `npm audit` reports
  nothing for `next` now. Checked: `npx vitest run`, eslint (0 errors), `npm run site:check`,
  `npx next build --webpack` and `npm run build`. Nothing to redeploy for it: the site (`site/`) and the
  Edge Functions do not run Next.js; the Next.js app is the local `npm run dev` frame.
- **Vitest: not upgraded, on purpose.** Its moderate advisory (`@vitest/mocker` before 4.1.11) is
  dev-only: Vitest runs tests on a developer's machine and ships nowhere. The fix is Vitest 4.1.11, a
  major upgrade: do it separately and check `vitest.config.mts` and `server/test-setup.ts` with it.

### Deploy

1. **Review the branch.** Review `fix/retest-oct1` and merge it when ready.
2. **No migration and no new secrets.**
3. **Redeploy two functions:**
   ```
   npm run hosting:deploy -- orderat-sync orderat-auth
   ```
   - `orderat-sync`: R01.
   - `orderat-auth`: F05.
   - The other functions need nothing; `server/shared/crypto.ts` only gained a comment.
4. **Web app:** the quantity labels ship with the next site deploy (`site/build.mjs` copies
   `public/orderat` into the site).
5. **Smoke checks:**
   - **Sync:** on one phone the owner changes an order's total while a prepare-only staff phone marks the
     same order ready. After both sync, the order has the new total and the new status.
   - **Sign-in:** a website sign-in logs `auth_signin` with `client: "web"`; iPhone and Android sign-ins
     log `client: "app"`, and "Open on computer" still approves from both phones. If an Android Google
     sign-in logs `"web"`, its tokens carry no separate `azp`: redeploy the previous `orderat-auth` and
     report it, since Android would then be unable to approve pairings.

### Done since (2 Oct 2026)

- **Staff screens gated on both phones.** iOS (`orderat-ios` `feat/today-glance-back`, in 1.0.1 build 23):
  shop details, shop settings (business type, currency, VAT, stock), occasions and the shop link are not
  offered to staff who cannot change them; each gate is tested against the server's rule for all flag
  combinations. Android (`orderat-app` `feat/round-oct2`, in 1.5.5): order status without `prepare`,
  customers and occasions without `orders`, the product active switch and typed items without
  `products`, and the shop details and templates for any staff member.
- **Refused changes are announced.** Both phones show one calm notice per sync when the server refused a
  change and the phone put the server's copy back. Android also stops re-sending a refused edit whose
  server copy it could not apply yet. The F01 rejection-without-copy paths were fixed earlier (`9667831`).
- **iOS Keychain:** secrets are kept on this iPhone only and a failed save keeps the old value (1.0.1).

### What remains

- **F03:** server-verified purchases (the design above); it needs the store credentials.
- **Field minimization for staff without `money`:** product cost and other money fields still reach
  every staff member who may pull products or orders (F01, "No field-level read redaction"). Redacting
  them needs the phones to stop writing whole records back, or a redacted field would overwrite the
  owner's value.
- **Backups:** confirm the database backups on the Supabase plan in use (daily backups or point-in-time
  recovery) and run one restore test. Nothing in this repository covers it.
- **Canonical host redirects:** `orderat-app.pages.dev` and `www.orderatweb.com` reach
  `https://orderatweb.com` only through a script in the page. A server-side 301 needs a Cloudflare
  redirect rule, since Pages' `_redirects` cannot redirect one hostname to another: a Single Redirect
  for `www.orderatweb.com` and Bulk Redirects for the `pages.dev` address, set up by the founder in the
  Cloudflare dashboard.
- **Vitest 4** (see F04).

## Second review, 3 Oct 2026 (L1 to L3: the stock ledger and stock moves)

A second review of the order stock ledger (`stockDeducted`) and of stock moves found three server
problems. All three are in `server/sync/`; no client change is needed (the wire stays compatible with
iOS 1.0, Android 1.5.4 / 1.5.5 and the new builds). Rules: `docs/sme-phase-2-cloud.md` ("Stock with
several phones", "Order stock ledger").

### L1: a missing ledger cleared a stored one

An order's ledger was an "optional" prepare field, so a prepare-only push that left `stockDeducted` out
(an older app, or a stale copy) removed the stored ledger. The order then looked like a legacy order, and
a later cancel derived what to give back from at most 50 stock moves, or restored nothing.

- **Changed:** absent (or `null`, or an invalid value) never changes the stored ledger. Only an explicit
  valid value does; an explicit `{}` clears it. For prepare/money pushes and for whole-order pushes (the
  owner, `orders` staff: a record without the key keeps the stored ledger in what is written).
- The old test that expected omission to clear the ledger is replaced.

### L3: a prepare-only push could write any ledger

Staff who only prepare orders could set the ledger to anything valid-looking (`{"unrelated":1000000}`),
which a later cancel would then restore into stock.

- **Changed:** prepare-only staff cannot edit items, so the stored order is the reference. A pushed ledger
  is taken only when it equals the stored one; when the push moves the order into a deducted status and
  every key is a product of a line of the stored order with at most that line's units; when it moves the
  order out of a deducted status and is `{}`; or when a legacy order (no stored ledger) stays deducted and
  the ledger fits its lines. Otherwise it is ignored like any other invalid prepare value, and the rest of
  the push is handled as before. (The write still happens, with a fresh `seq`, so the phone gets the stored
  order back on its pull.)

### L2: stale stock pushes were refused or overwrote another phone's deduction

Two phones hold the same product copy (stock 10). A confirms 3 (server 7). B confirms 2 from its stale
copy and pushes 8 with its move. Staff pushes were refused (`isOrderStockUpdate` required the stored
moves unchanged); an owner's push overwrote A's deduction. B's order and ledger `{p:2}` were stored either
way, so a later cancel of B added 2 units that were never taken.

- **Changed:** a product's stock is the result of its moves, each applied exactly once. A push whose copy
  lacks moves the stored product has is rebased inside the compare-and-swap write: the stored quantity and
  moves are the start, only the pushed moves the stored copy lacks are applied, and the merged quantity and
  list (newest first, at most 50) are stored with a fresh `seq`, so the pushing phone receives them on the
  same sync's pull. Moves are identified by id (compared without case: iOS sends uppercase UUIDs); a retry
  applies nothing twice; `baseSeq` is not used. Staff without `products` still add order-driven moves
  only; the other fields of the product come from the stored copy for them, from the pushed copy for
  members who may edit products.
- **Trimmed histories (the 50-move cap):** a move missing from a full list counts only when it is newer
  than that list's oldest move (by `at`). An older one was trimmed, not new, and is never applied again.
- Tests run through the real push path on PGlite with the interleavings made deterministic (a write
  landing between a push's read and its write): the two-device scenario for owner and staff pairs
  (stock 5 with both moves; cancelling B gives 7, then A gives 10), retries, order first and product later,
  conflicting item edits, an owner's stale rename, and a trimmed history.

### What remains

- **Legacy orders on a busy product.** An order that has no ledger and whose deduction moves aged out of
  the product's 50-move history derives `{}` on the phone and restores nothing. That under-counts stock
  rather than inventing it. Orders confirmed since the ledger shipped carry their ledger and are not
  affected; no server change can recover moves that are gone.
- **Order records are still last-writer-wins.** Two phones that edit the same order's items from the same
  copy each move stock by their own delta, and the product ends with both moves; the order keeps one
  phone's items and ledger. The stock is what the moves say, but a later cancel gives back the ledger of
  the order that won. Fixing it needs an item-level merge of orders, or reconciling the ledger with the
  moves, which is a design decision for both phones and the server.
- **Quantity changes with no move.** A new product's opening quantity and a quantity edit on a product that
  does not track stock carry no stock move (iOS, Android and the web all do this today). They are stored
  while the pushed copy is up to date for stock, and cannot be merged when it is stale.
- **A phone that edits a product while its own sync is in flight** keeps its pre-merge copy (iOS, Android
  and the web only replace a local record that was not edited during the round) and pushes it again. The
  server merges that push by move ids as well, so no move is lost; the phone adopts the merged copy on its
  next pull.
- **Clock skew.** Trimmed histories compare a move's `at` with the oldest move of a full list. A phone
  whose clock is off by more than the span of 50 moves can have a genuinely new move skipped, or a
  trimmed one applied again. Only full lists (50 moves) are affected.

## Third review, 3 Oct 2026 (F1 to F5: the server owns order stock)

A third external review found five server problems, all in `server/sync/` plus one migration
(`db/migrations/0010_order_stock.sql`). No client change is needed; the wire stays compatible with iOS 1.0,
Android 1.5.4 / 1.5.5, the live web app and the new builds. Rules: `docs/sme-phase-2-cloud.md` ("Stock with
several phones", "Order payments with several phones", "Shops and members").

### F1: two devices doing the same order transition added both stock deltas

The merge from the second review (L2) deduplicated moves by id only. Two devices that each confirmed the same
order (or cancelled it, or edited it) pushed two different move ids, and both deltas were added: a confirm of 3
units took 6. Two conflicting item edits (3 -> 5 and 3 -> 4) each moved stock by their own delta while the order
record kept one of them, so a later cancel gave back a different quantity than the stock had lost.

- **Changed:** the server turns an order's ledger (`stockDeducted`) into stock, once per accepted order version.
  New table `order_stock (shop, order, product, units)` holds what the server has actually taken for each order
  and product. When an order write is accepted and its record has a ledger, for every product it names,
  `delta = applied - ledger[product]`; a non-zero delta changes the product's quantity by `delta`, adds a
  server-made move (deterministic id from the order id, the accepted order `seq` and the product id) and gives
  the product a fresh `seq` so every device pulls it. The order version and the stock effect are one atomic unit
  (`orderat.sync_apply`). The phones' own moves for such an order are ignored. Result: two confirms take the stock
  once, two cancels give it back once, conflicting edits leave stock equal to the winning order, a replay changes
  nothing.
- The ledger of every member is validated: the owner's and `orders` staff's against the INCOMING order's lines
  (a ledger above them, or naming another product, counts as absent), prepare-only staff's against the stored
  order (L3, unchanged). An order whose status holds no stock (`newOrder`, `cancelled`) settles its ledger to `{}`:
  a release that does not know the ledger and cancels an order another app confirmed sends the old ledger back
  as it found it, and the server then gives the stock back, once, while ignoring that release's own move.
- Tests: `server/sync/stock-push.test.ts` (both arrival orders and four phone pairs for confirm, double cancel,
  edits 3 -> 5 / 3 -> 4 in both orders with the cancel afterwards, replays, a write landing between a push's read
  and its write, an allocation row that changes meanwhile, an order that gets a ledger meanwhile). The test that
  expected stock 4 for the conflicting edits is replaced by one that checks stock against the winning order and
  after the cancel.

### F2: prepare-only staff could push a fabricated stock move

A prepare-only member could push a product whose list carried a move with a made-up order id and a delta of
+1,000,000; the server only checked its shape.

- **Changed:** a move only counts when its order allows it. An order-driven move needs a live order of the shop;
  for an order that has a ledger it is ignored (the server owns that stock); for an order without one (a release
  that writes no ledger) it must have the direction of its reason, and the order's applied units for the product
  (`order_stock`, or, for an order from before the table, derived from the product's own stored moves) must stay
  within 0 and the units of the product on the order. A nonexistent order, an order the product is not on, an
  inflated or wrong-direction delta all fail it, and a real move can never move more than the order itself holds.
  Such a move is not applied and not recorded. The shape rules for staff without `products` are unchanged.
- Tests: `stock-push.test.ts` ("F2"), `stock-merge.test.ts`, `record-access.test.ts` (prepare-only and `orders`
  staff, every forged shape, stock unchanged; legitimate confirm, edit and cancel still work).

### F3: a first-time offline deduction older than the 50-move window was dropped

The L2 merge treated a move missing from a full list and older than the list's oldest move as "trimmed, not new"
and never applied it, while the order's ledger, pushed in the same batch, was stored. An offline phone that
confirmed 2 units, with 50 newer moves on the server, left the order saying it took 2 and the stock untouched; the
later cancel then added 2 units that were never taken.

- **Changed:** for an order with a ledger the move no longer matters (F1): the ledger is applied. For every other
  move the 50-entry list is no longer what decides: new table `stock_ops (shop, op id)` keeps every client move id
  the server has applied or ignored, uncapped, so a move is applied exactly once and a replay of an old one zero
  times. The migration lists the ids already in the products' stored lists, and the first write of a product lists
  them too.
- Tests: `stock-push.test.ts` ("F3": a ledger-aware phone, a released phone, a manual correction made months
  before the window, a move that was trimmed off the list later; each with a replay).

### F4: payments from two devices, last writer won

Two devices that each recorded a different payment on the same order from the same copy (2,000 and 3,000) pushed
two whole `payments` lists; the later one replaced the other and a payment vanished.

- **Changed:** payments are identified by their `id` (every app writes one). A push whose copy is stale (`baseSeq`
  behind the stored `seq`) keeps the stored payments it lacks (union by id; a payment in both takes the pushed copy;
  the stored order first, so retries and any arrival order give the same list); only an up-to-date copy may remove
  one. Whole-order pushes and `money` pushes both. When the union differs from what was pushed, `paymentStatus` is
  recomputed from the accepted payments and the order's total (the apps' rule) when the record carries the lines,
  otherwise the pushed status is kept. No history entry is written for the recomputation.
- Tests: `server/sync/payments-push.test.ts` (2,000 and 3,000 from one base in both arrival orders for four phone
  pairs, retries, a corrected amount, deliberate removal from an up-to-date copy and not from a stale one, a write
  landing between read and write), `record-access.test.ts` ("F4").

### F5: one staff invite could be redeemed by two accounts at once

`invite_join` read the invite, counted the staff, inserted the membership and only then marked the invite used,
as separate statements. Two accounts racing for one code both passed the read and both became staff; two accounts
with two codes could take the sixth seat.

- **Changed:** the claim and the membership are one database call (`orderat.claim_invite`): the invite row is
  locked (the second account then finds it used: the normal `invalid_code` answer) and the shop row is locked
  while the staff are counted. A join refused for the limit leaves the invite unused; someone who already belongs
  to the shop uses the code up and gets their role back, as before.
- Tests: through the real HTTP handler (`handler.test.ts`, "F5"): another account's whole join landing in the
  middle of the first one's, for one code and for the last seat (these fail against the previous handler), two
  requests in flight, the join being a single call, a retry after a dropped response, expired and unknown codes.

### Design: why a database function, and what is atomic

Production reaches Postgres through Supabase's transaction pooler, so a client-side `BEGIN ... COMMIT` across
several statements is not safe, and the sync code deliberately uses one statement per atomic unit (a compare-and-swap
on one record's `seq`). The order version and its stock effect span several rows (the order, the products,
`order_stock`, `stock_ops`). One statement cannot guard those as a unit under READ COMMITTED: each row's own
check is re-run after a lock wait, but a sibling CTE does not see the winner. So migration 0010 adds
`orderat.sync_apply`: a generic multi-record compare-and-swap that takes the row locks first, in a fixed order
(orders before products, then by id, so two writers cannot wait on each other), checks that every record, every
allocation row and every stock_ops id the decision read is still as read, then writes everything; anything that
moved returns no row and writes nothing, and the push reads and decides again inside its existing retry loop.
It is still a single call for the pooler. All decisions stay in TypeScript (`record-access.ts`, `stock-merge.ts`,
`order-stock.ts`, `payments-merge.ts`), where they are unit-tested; the function only locks, verifies and writes.
It runs as the caller (`orderat_app`), and only that role may execute it.

### Existing shops

`order_stock` starts empty. The first time the server accounts for an order and product with no row it starts from
what the stock really holds: with no stored ledger, what the product's own stored moves for that order net to;
with a stored ledger, its units, capped by the moves when the product's list is not full (a list under 50 holds
every move the product ever had, so a ledger whose stock never moved took nothing) and trusted when it is full (the
move may have been trimmed). Tested: a later ledger push that restates the ledger takes nothing twice; a later
cancel gives back once; an edit 3 -> 5 takes 2; a legacy order cancelled by a release or by a ledger-aware client;
a trimmed confirm move. No data backfill beyond listing the move ids already stored.

### Deploy

1. **Migration first:** `npm run hosting:migrate -- --dry-run` should list only `0010_order_stock.sql`, then
   `npm run hosting:migrate`. It is additive (two tables, three functions, and an insert into the new `stock_ops` of the move ids already in products' lists),
   idempotent, and safe against the code that is deployed now (nothing reads or calls any of it).
2. **Then `npm run hosting:deploy -- orderat-sync`.** The new code needs the migration; deploying it first fails
   every order write that carries a ledger and every product push with stock bookkeeping.
3. Between the two steps, and while old function instances finish, stock activity served by an old instance does not
   write `order_stock`; do the two steps close together.

### What remains

- **A release that moves an order that already carries a ledger is not followed.** iOS 1.0 and Android 1.5.5
  ignore `stockDeducted` (they keep it unchanged). When one re-confirms an order whose ledger is `{}` (confirmed
  and cancelled by a newer app before), or edits its items, the server ignores that release's own stock move (the
  order has a ledger: the ledger decides) and the stock stays too high by that order's units. It is never made up.
  Cancels by a release are covered (the ledger settles to `{}`). Closing the rest needs the release to write a
  ledger or the server to derive one from tracking switches it does not hold reliably.
- **Two released phones that make the same edit-down of an order** (3 -> 2 units, each with its own move) give the
  difference back twice, within the order's units: a move's id says nothing about which transition it is, and only
  a ledger tells identical edits apart. Two released phones that confirm or cancel the same order are covered (the
  order's units are the cap, zero the floor).
- **An iOS phone that edits an order while its own sync is in flight can still drop another phone's payment.**
  iOS refreshes its recorded `seq` for a pulled record even when it skips applying it (the order was edited
  meanwhile), so the re-push carries a current `baseSeq` and its own, older, payments list; the server cannot tell
  that from a deliberate removal. Android and the web keep the old `baseSeq` for such a record and are merged.
  A client fix (keep the old `baseSeq` for a record that was not applied, as Android does) closes it.
- **A payment added and removed again before the sync that carried it returns** is not removed on Android and the
  web: the removal is based on the older copy, and a removal counts only from an up-to-date one. The payment
  stays; the seller deletes it again. (iOS, which refreshes its `baseSeq`, removes it.)
- **A move trimmed off a product's list before migration 0010** and still held by a long-offline phone is
  indistinguishable from a new move and would be applied again when that phone pushes. Moves still in a list at
  migration time, and every move applied since, are known.
- **A product move that names an order the server never receives** is never applied (and never recorded). The
  order of a batch is handled (its orders first), a batch split across syncs by the 200-change limit is not.
- **Deleted orders keep their allocation** (the stock stays taken). Nothing in the apps deletes orders (they
  cancel them).
- **Item-level merge of orders.** The order record is still last-writer-wins; stock now follows the winner, but an
  edit of one device can still lose to another device's edit of the same order.
- **A quantity change with no stock move** (a new product's opening quantity, a quantity edit on a product that does
  not track stock) is still stored only while the pushed copy is up to date for stock (unchanged from the second
  review): no move, nothing to merge it by.
- Two writers meeting in the database can in principle deadlock (a permission grant that re-sequences every order
  while an order write holds several rows): Postgres aborts one, the sync answers 500 and the phone retries.
