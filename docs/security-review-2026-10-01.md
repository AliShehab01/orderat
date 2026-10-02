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
