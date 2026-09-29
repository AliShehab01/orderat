# Orderat Web: design

Date: 2026-09-29. Status: approved by the founder in chat (approach 1, sign-in option C, scope "everything
that fits a computer", paid check "the phone tells").

## Goal

A seller whose shop has cloud sync on opens `https://orderat-app.pages.dev/app/` (later `app.<domain>`),
signs in with the same Apple or Google account as the phone, and works on the same shop data as the
phones: orders, customers, products, money, team. Visitors without an account keep the existing demo.

## Approach

Upgrade the existing web demo (`public/orderat/`: vanilla JS, `index.html` + `i18n.js` + `demo.js` +
`app.js` + `app.css`, no build step) instead of writing a new app. The demo's screens and its in-memory
state `S` stay; a real-mode data layer is added next to them in new files:

| file | job |
|---|---|
| `cloud-api.js` | HTTP client for `orderat-auth`, `orderat-sync`, `orderat-parse`, `orderat-ask`, `orderat-studio`: base URL, headers (`X-Orderat-Session`), error mapping (401 → signed out, 429 → retry later, network → offline). |
| `cloud-map.js` | Pure functions mapping canonical cloud records (docs/sme-phase-2-cloud.md "Record formats") to the web model and back. Keeps every unknown field by merging over the last raw record. |
| `cloud-sync.js` | Holds the raw records, cursor and seqs; builds `S` from records; after each local change diffs `S` against the raw records and pushes only what changed; pulls every 20 s and on tab focus. |
| `cloud-auth.js` | Google Identity Services button and Sign in with Apple JS (popup), nonce handling, session storage, sign-out, shop picker. |

Each new file works both as a classic browser script (`window.Orderat*`) and as a CommonJS module, so
vitest tests it directly (`server/**` stays as is; web tests go in `web/*.test.js`, picked up by vitest).

Modes: `demo` (today's behaviour, local data, nothing leaves the browser) and `live` (signed in,
cloud data). The mode decides which implementation each action uses; screens do not change.

Hosting: the site build (`site/build.mjs`) copies the web app into `site/dist/app/`. `/app/` shows
"Sign in" and "Try the demo". The marketing header gets a "Log in" link to `/app/`.

## Sign-in

- **Google:** Google Identity Services with the existing Web OAuth client id (already accepted by
  `orderat-auth`). The founder adds `https://orderat-app.pages.dev` (and later the domain) to the
  client's Authorized JavaScript origins.
- **Apple:** Sign in with Apple JS, popup mode, with a new Services ID (e.g. `com.ams.orderat.web`),
  created with the founder's OK; its id is added to `ORDERAT_APPLE_AUDIENCES`. The browser sends
  Apple `sha256hex(rawNonce)` and the server receives `rawNonce` (same rule as iOS).
- The server returns `{session, user}`. The web stores the session in `localStorage` (per origin) and
  sends it as `X-Orderat-Session`.
- **Web sessions expire after 30 days** (new): `signin` accepts `client: "web"`; the server stores
  `expires_at = now + 30 days` for that session and rejects expired sessions like unknown ones.
  Phone sessions keep no expiry.
- After sign-in: `shops_list`. No shop → "Turn on cloud sync in the app first" with store links.
  Several shops → picker. The chosen shop id is remembered.
- QR login ("Open on computer" from the app, like WhatsApp Web) comes with the next app update and is
  out of this spec.

## Server changes

1. CORS on `orderat-auth`, `orderat-sync`, `orderat-parse`, `orderat-ask`, `orderat-studio` for the
   site origins (`https://orderat-app.pages.dev`, and http://localhost for development), allowing
   headers `content-type, x-orderat-session, apikey, authorization`. The allow-list is one shared
   constant so adding the domain later is one line.
2. Migration `0005_web_sessions.sql`: `orderat.sessions.expires_at timestamptz null`.
   `resolveSession` treats `expires_at < now()` as no session.
3. `shops_list` / member timestamps returned as ISO 8601 (today `String(Date)`).

No other server behaviour changes.

## Data mapping (cloud ⇄ web)

Canonical format: docs/sme-phase-2-cloud.md. Rules:

- IDs: kept exactly as received. New records created on the web get lowercase UUIDs.
- Money: `*Minor` integers ⇄ web major-unit numbers using the currency's decimals
  (BHD, KWD, OMR: 3; SAR, AED, QAR: 2).
- Dates: ISO 8601 UTC with milliseconds both ways; occasions' `startDate/endDate` ⇄ web day keys.
- Enums: order status `newOrder` ⇄ web `new`; `businessType` `food_truck` ⇄ web `foodTruck`; any
  unknown code is shown as "other" and written back unchanged.
- Unknown fields: `toCloud(webObject, rawData)` starts from `rawData` and overwrites only fields the
  web owns, so address block/road/building, stock moves, photo ids, VAT snapshots, invoice numbers
  and anything newer survive a web edit.
- Entity details:
  - `shop` ⇄ `S.shop`, `S.vat`, `S.stockEnabled`.
  - `product` ⇄ `S.products` (`price/cost/cap/track/qty/low` ⇄ `priceMinor/costMinor/
    dailyCapacity/trackStock/stockQuantity/lowStockThreshold`), photo shown through `photo_url`.
  - `customer` ⇄ `S.customers`.
  - `order` ⇄ `S.orders`: items keep their `id`; `nameSnapshot` shows as the item name in both
    languages; payments keep `id`, `paidAt ⇄ at`; history `changes` keep the cloud shape and are
    rendered from `field/newValue`; `paymentStatus` is recomputed on every web write; the VAT
    snapshot and invoice number are set on create like the phones (invoice identifier prefixed with
    this browser's device code); the web-only order number is derived from `createdAt` order.
  - `expense` ⇄ `S.expenses`, `occasion` ⇄ `S.occasions`, `setting/whatsappTemplates` ⇄ templates.
- Stock: when the web changes an order's status it applies stock like the phones and pushes the
  product (last writer wins, as on the phones).

## Sync

- Open: pull from cursor 0 until `more` is false, build `S`, render. (No local cache in v1.)
- Local change: `save()` in live mode diffs every entity's `toCloud()` result against its raw record
  and pushes the changed ones (≤ 500 per call) with `baseSeq`; deletions push a tombstone. The response
  also carries pulled changes, which are applied.
- Pull every 20 s and on tab focus; 429 backs off to the next tick.
- Conflicts: last writer wins (server rule); a small "Updated from another device" toast.
- `rejected: forbidden` restores the server copy and shows "You don't have permission".
- Staff: `membership.permissions` hide screens and actions exactly as on the phones.
- Offline: banner "No connection, changes will be sent when you're back online"; edits stay queued in
  memory and are retried on the next tick. Closing the tab while offline loses unsent edits (warned by
  `beforeunload`).

## Paid check

- The owner's phone writes a `setting` record `subscription` = `{ value: { status, expiresAt,
  platform, updatedAt } }` on every sync (next iOS/Android update).
- The web opens a shop when that record says `expiresAt` in the future, or when the record does not
  exist yet (until the phones ship the update). Otherwise it shows "The subscription for this shop has
  ended. Renew it in the app." with store links.
- Server-side verification with Apple and Google is a later upgrade.

## Features in live mode

- Real: Today, orders (create, edit, status, payments, receipts to print), paste a message → AI order
  (`orderat-parse`), customers, products (photo upload from a file via `photo_upload`), expenses and
  money reports, occasions, WhatsApp buttons (open WhatsApp Web), Ask Orderat (`orderat-ask` with the
  same numbers snapshot as the phones), Photo studio (image from a file), campaigns, team (members,
  permissions, invite code), shop settings (profile, VAT, stock, WhatsApp templates).
- Not in live mode: camera, share sheet, buying the subscription (shows "Subscribe in the app"), shop
  link editing and the web-orders inbox (the shop link's edit token lives only on the phone; a later
  step moves it to the account), backup import (the cloud is the backup; export stays).

## Error handling

- Every network call goes through `cloud-api.js`; failures become one of: signed out (401 → back to
  sign-in), no permission (403), rate limited (429), offline (network), server error (5xx → toast and
  retry on next tick).
- Sign-in failures show the provider's message plus "Try again".

## Testing

- `web/cloud-map.test.js`: round-trip every entity (cloud → web → cloud equals input), unknown-field
  preservation, money decimals per currency, enum mapping, new-record creation.
- `web/cloud-sync.test.js`: diff/push selection, tombstones, applying pulled changes, forbidden revert,
  pagination, with a fake API.
- Server: CORS tests for the five functions, web-session expiry tests, ISO timestamp test.
- Manual: sign in with Google and Apple on the deployed site, edit an order on the web and see it on
  a phone and back.
