# Orderat Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in sellers use their real cloud shop in the browser at `/app/`, on top of the existing web demo.

**Architecture:** The vanilla-JS web demo (`public/orderat/`) keeps its screens and in-memory state `S`. Four new
browser modules (`cloud-api.js`, `cloud-map.js`, `cloud-sync.js`, `cloud-auth.js`) give it a live mode backed by
the existing `orderat-auth`/`orderat-sync` Edge Functions, which gain CORS for the site and 30-day web sessions.

**Tech Stack:** Vanilla JS (no build step, classic scripts + CommonJS for tests), vitest, TypeScript Deno Edge
Functions, Postgres (PGlite in tests), Google Identity Services, Sign in with Apple JS.

**Spec:** `docs/superpowers/specs/2026-09-29-orderat-web-design.md`

## Global Constraints

- Canonical record JSON: `docs/sme-phase-2-cloud.md` "Record formats" (ids lowercase UUID for new records,
  money in integer minor units, ISO 8601 UTC with milliseconds, unknown keys kept).
- Order status on the wire: `newOrder, confirmed, ready, collected, cancelled` (web uses `new` for `newOrder`).
- `businessType` on the wire: `home, shop, services, food, food_truck, other` (web uses `foodTruck`).
- Currency decimals: BHD 3, KWD 3, OMR 3, SAR 2, AED 2, QAR 2.
- Site origin: `https://orderat-app.pages.dev` (one shared constant; the future domain is added there).
- Server endpoints: `https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/<name>`; session header
  `X-Orderat-Session`.
- Google Web OAuth client id (public): `799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com`.
- Web sessions expire after 30 days; phone sessions never expire.
- Arabic is the default language; every new UI string exists in `i18n.js` as `[en, ar, arFeminine]`.
- Every new browser module works as a classic script (`window.OrderatCloud*`) and as CommonJS
  (`module.exports`), with no dependencies.
- Agents do not commit; the coordinator commits after review.

---

### Task 1: Server — CORS for the web app

**Files:**
- Modify: `server/shared/cors.ts` (add `withAppCors`, `APP_ORIGINS`)
- Test: `server/shared/cors.test.ts`
- Modify: `supabase/functions/orderat-auth/index.ts`, `orderat-sync/index.ts`, `orderat-ask/index.ts`,
  `orderat-parse/index.ts`, `orderat-studio/index.ts` (wrap `handler` with `withAppCors`; update the
  "no browser CORS" header comments)

**Interfaces:**
- Produces: `export const APP_ORIGINS: readonly string[]` = `["https://orderat-app.pages.dev"]`;
  `export function withAppCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>`
  — answers OPTIONS itself (204 with `Access-Control-Allow-Origin` = origin,
  `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: apikey, authorization, content-type, x-orderat-session`,
  `Access-Control-Max-Age: 86400`) for allowed origins (APP_ORIGINS or `http://localhost[:port]` /
  `http://127.0.0.1[:port]`), 403 without CORS headers otherwise; adds `Vary: Origin` and, for allowed
  origins, `Access-Control-Allow-Origin` to every other response. Requests without an Origin header (the
  phones) pass through unchanged.

- [ ] Step 1: Write failing tests in `server/shared/cors.test.ts` (describe `withAppCors`): preflight from
  `https://orderat-app.pages.dev` → 204 and the four headers above; preflight from `https://evil.example.com`
  → 403, no allow-origin; POST from the site → handler's body/status kept + allow-origin; POST with no
  Origin → identical to the bare handler (no allow-origin, has Vary); localhost preflight allowed.
- [ ] Step 2: `npx vitest run server/shared/cors.test.ts` → FAIL (`withAppCors` not exported).
- [ ] Step 3: Implement `withAppCors` next to `withPublicCors` (reuse `LOCAL_ORIGIN_RE`).
- [ ] Step 4: Run the test → PASS.
- [ ] Step 5: Wrap the five functions: `const handler = withAppCors(createXHandler({...}));` (keep
  `Deno.serve((req) => handler(req))`). `npx vitest run` whole suite → PASS.

### Task 2: Server — 30-day web sessions and ISO timestamps

**Files:**
- Create: `db/migrations/0005_web_sessions.sql`
- Modify: `server/auth/validate.ts` (signin accepts optional `client: "web" | "app"`),
  `server/auth/handler.ts` (pass `expiresAt` when `client === "web"`), `server/auth/store.ts`
  (`createSession(sql, {tokenHash, userId, deviceName?, expiresAt?})`, select `expires_at`,
  `resolveSession` returns undefined when `expires_at <= now`), `server/cloud-pglite-test-support.ts`
  (apply migration 0005 like 0001–0004)
- Modify: `server/sync/store.ts` lines that build `updatedAt`/`joinedAt` with `String(...)` → ISO
  (`value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()`)
- Test: `server/auth/handler.test.ts`, `server/auth/store.test.ts`, `server/sync/handler.test.ts`

**Interfaces:**
- Produces: signin body field `client?: "web" | "app"` (anything else → 400 `invalid_body`); web sessions
  expire 30 days after creation (`WEB_SESSION_DAYS = 30` exported from `server/auth/store.ts`).

Migration:

```sql
-- Web sessions (docs/superpowers/specs/2026-09-29-orderat-web-design.md): a browser's session expires
-- 30 days after signin; the phones' sessions keep no expiry (null).
alter table orderat.sessions add column if not exists expires_at timestamptz null;
```

- [ ] Step 1: Failing tests: signin with `client:"web"` → session works now, fails (401) when `now` is 31 days
  later (inject `now` in handler deps like existing tests do); signin without `client` → still works 400 days
  later; `client:"x"` → 400; `shops_list` `updatedAt` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement migration + store + handler + validate + test-support change.
- [ ] Step 4: `npx vitest run server` → PASS.

### Task 3: Web — `cloud-map.js` (cloud records ⇄ web model)

**Files:**
- Create: `public/orderat/cloud-map.js`, `web/cloud-map.test.js`
- Modify: `vitest.config.mts` (add `"web/**/*.test.js"` to `include`)

**Interfaces (window.OrderatCloudMap / module.exports):**
- `decimalsFor(code: string): number`; `toMinor(amount: number, decimals: number): number` (rounded
  integer); `fromMinor(minor: number, decimals: number): number`.
- `newId(): string` — lowercase UUID v4 (`crypto.randomUUID()` when present).
- Per entity, `xToWeb(id, data, ctx)` and `xToCloud(webObj, rawData, ctx)` where `ctx = { decimals, now: Date,
  deviceCode: string }` and `rawData` is the last cloud `data` for that id or `undefined` for a new record.
  `xToCloud` starts from `{...rawData}` and overwrites only web-owned fields, so unknown fields survive:
  - `shopToWeb(id, data) → { shop:{nameAr,nameEn,phone,currency,pickupHours,dailyCapacity,businessType},
    vat:{enabled,trn,pricesInclude}, stockEnabled }`; `shopToCloud({shop,vat,stockEnabled}, raw, ctx)` (keeps
    `vat.rateBps`, `stock.defaultLowStockThreshold`, `createdAt`; sets `createdAt` = now for a new shop).
  - `productToWeb(id, data, ctx) → {id,nameAr,nameEn,aliases,price,cost,cap,active,track,qty,low,photoId}`;
    `productToCloud(p, raw, ctx)` (`priceMinor,costMinor,dailyCapacity,trackStock,stockQuantity,
    lowStockThreshold`; keeps `stockMoves`, `photoId` unless changed).
  - `customerToWeb(id, data) → {id,name,phone,area,notes}`; `customerToCloud`.
  - `orderToWeb(id, data, ctx) → {id,customerId,dueAt,items:[{id,pid,nameAr,nameEn,qty,price,cost}],
    fulfillment,area,deliveryFee,payments:[{id,amount,method,note,at}],notes,changes (cloud shape, untouched),
    status ('new' for 'newOrder'), createdAt, vatRateBps, vatIncluded, vatMinor, invoiceNumber,
    invoiceIdentifier}`; `orderToCloud(o, raw, ctx)` → canonical order; `paymentStatus` recomputed from
    payments vs total (`paid<=0 → unpaid`, `paid>=total → paid`, else `deposit`); `updatedAt` = now when
    anything changed; items without `id` get `newId()`; `nameSnapshot` = raw item's value if the item existed,
    else `nameAr || nameEn`.
  - `expenseToWeb/expenseToCloud` (`amount ⇄ amountMinor`, `note`, `category`, `date`, keeps `recurring`,
    `receiptPhotoId`), `occasionToWeb/occasionToCloud` (`start/end` day keys `YYYY-MM-DD` ⇄
    `startDate/endDate` ISO at 00:00 UTC; `cap ⇄ dailyCapacityOverride`; `blocked`, `kind`, names, notes).
  - `settingToWeb('whatsappTemplates', data) → data.value`; `settingToCloud(value, raw) → {...raw, value}`.
- `ENTITY_ORDER = ['shop','customer','product','occasion','order','expense','setting']`.

- [ ] Step 1: Tests: for each entity, a canonical fixture (copy the field lists from the spec table) →
  `toWeb` → `toCloud(web, fixture)` deep-equals the fixture (round trip); an extra unknown field
  (`futureField: 1`, and `address.block`) survives an edit; BHD `12.345 ⇄ 12345`, SAR `9.99 ⇄ 999`;
  `newOrder ⇄ new`; `food_truck ⇄ foodTruck`; unknown status `'archived'` is kept on write; new order from the
  web gets ids, `createdAt`, `updatedAt`, `paymentStatus`, `nameSnapshot`.
- [ ] Step 2: `npx vitest run web/cloud-map.test.js` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.

### Task 4: Web — `cloud-api.js`, `cloud-sync.js`, `cloud-auth.js`

**Files:**
- Create: `public/orderat/cloud-api.js`, `public/orderat/cloud-sync.js`, `public/orderat/cloud-auth.js`
- Test: `web/cloud-api.test.js`, `web/cloud-sync.test.js`

**Interfaces:**
- `OrderatCloudApi.createApi({ baseUrl, getSession, fetchImpl }) → api` with async methods returning parsed
  JSON: `signin({provider, idToken, nonce, deviceName})` (sends `client:"web"`), `me()`, `signout()`,
  `deleteAccount()`, `shopsList()`, `sync({shopId, cursor, changes})`, `inviteCreate(shopId)`,
  `membersList(shopId)`, `membersUpdate(shopId, userId, permissions)`, `membersRemove(shopId, userId)`,
  `photoUpload(shopId, mimeType, base64)`, `photoUrl(shopId, photoId)`, `parse(body)`, `ask(body)`,
  `studio(body)` (bodies exactly as `server/parse/validate.ts`, `server/ask/validate.ts`,
  `server/studio/validate.ts` expect — read them). Errors throw `CloudError { kind: 'unauthorized' |
  'forbidden' | 'not_found' | 'rate_limited' | 'offline' | 'invalid' | 'server', status, code }`.
- `OrderatCloudSync.createSync({ api, map, shopId, ctx, onChange, onNotice }) → sync` with
  `start()` (pull from cursor 0 until `more` false; builds state via `buildState()`; calls `onChange(state)`),
  `commit(webState)` (for every entity in `map.ENTITY_ORDER` compute `toCloud` for each web object, compare
  (stable JSON) with the raw record, push changed ones and tombstones for raw ids missing from the web state,
  ≤500 per call, `baseSeq` = raw seq; apply the response's pulled changes; `rejected` → restore raw copy and
  `onNotice('forbidden')`; `conflicts` → `onNotice('conflict')`), `pull()`, `buildState()`,
  `membership` getter, `pending` count, and offline handling (a failed push keeps changes pending;
  `onNotice('offline')`; next `pull()`/`commit()` retries).
- `OrderatCloudAuth`: `googleButton(el, onToken)` (Google Identity Services, client id above, nonce = raw
  random), `appleSignIn() → {idToken, rawNonce}` (Sign in with Apple JS popup; Apple gets
  `sha256hex(rawNonce)`; Services ID and redirect URI from `window.ORDERAT_CONFIG`), `getSession()`,
  `setSession(s)`, `clearSession()` (localStorage key `orderat.web.session`), `deviceCode(session)` = first 2
  hex chars of SHA-256(session) upper-cased (same as the phones).

- [ ] Step 1: Tests with a fake `fetchImpl`/fake api: api sends the session header and `client:"web"`;
  401 → `CloudError('unauthorized')`; network failure → `'offline'`. Sync: start paginates; commit pushes only
  changed records; deletion → tombstone; forbidden → raw restored; offline commit keeps pending then succeeds.
- [ ] Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.

### Task 5: Web — live mode in `app.js`, sign-in screens, site build

**Files:**
- Modify: `public/orderat/index.html` (load `config.js`, `cloud-map.js`, `cloud-api.js`, `cloud-sync.js`,
  `cloud-auth.js` before `app.js`; Google/Apple SDK script tags), `public/orderat/app.js`,
  `public/orderat/i18n.js`, `public/orderat/app.css`, `public/orderat/sw.js` (cache name bump, never cache
  API calls)
- Create: `public/orderat/config.js` (`window.ORDERAT_CONFIG = { apiBase, googleClientId, appleServicesId,
  appleRedirectUri }`)
- Modify: `site/build.mjs` (copy the web app into `dist/app/`), `site/lib/layout.mjs` + `site/data/strings.mjs`
  (header "Log in / دخول" link to `/app/`)

**Behaviour:**
- Start screen when not onboarded: "Sign in" (Google button, Apple button) and "Try the demo" (today's
  onboarding). Signed in → `shopsList()` → none: "Turn on cloud sync in the Orderat app first" + store links;
  one: open it; several: picker. Chosen shop id kept in localStorage `orderat.web.shop`.
- Live mode: `S` = device prefs (lang, addressAs, theme) + `sync.buildState()`; `save()` in live mode calls
  `sync.commit(S)` debounced 800 ms and stores only prefs locally; `sync.pull()` every 20 s and on
  `visibilitychange`; notices shown as toasts; offline banner; `beforeunload` warning while `pending > 0`.
- Replace simulated features when live: AI order paste → `api.parse`; Ask → `api.ask` with the numbers
  snapshot built like the apps (port the snapshot builder from the Android `buildAskOrderatSnapshot` /
  iOS `AskSnapshot.swift`); Photo studio → `api.studio` with an image file; product photo upload
  (`photoUpload`) and display (`photoUrl`, cached per session); team screen → members/invite actions;
  paywall → "Subscribe in the Orderat app" + store links; shop link screen → "Manage your shop link in the
  app"; backup import hidden.
- Staff: hide screens by `sync.membership.permissions` (orders, prepare, money, products) exactly as the
  phones do.
- Paid gate: `setting` record `subscription` with `value.expiresAt` in the past → "The subscription for this
  shop has ended. Renew it in the Orderat app." (missing record → allowed).
- Sign out in Settings → `api.signout()`, clear session, back to start.
- Site: `/app/` served from `dist/app/`; header link.

- [ ] Steps: implement screen by screen, checking each in the browser against a real signed-in shop
  (see Task 6), `npm run site:check` passes, `npx vitest run` passes.

### Task 6: Founder setup and end-to-end check

- [ ] Google console: add `https://orderat-app.pages.dev` to the Web client's Authorized JavaScript origins.
- [ ] Apple Developer: Services ID `com.ams.orderat.web` with Sign in with Apple, domain
  `orderat-app.pages.dev`, return URL `https://orderat-app.pages.dev/app/`; add it to
  `ORDERAT_APPLE_AUDIENCES` (`com.ams.orderat,com.ams.orderat.web`) and push secrets.
- [ ] Founder runs: `npm run hosting:migrate`, deploys the five functions, deploys the site.
- [ ] Sign in with Google and Apple on the site; edit an order on the web, see it on a phone, and back.

### Task 7 (next app update): phones report the subscription

- iOS and Android: on every sync, when this device is the shop owner, push `setting` id `subscription`
  = `{ value: { status: 'trial'|'active'|'expired'|'none', expiresAt: ISO|null, platform: 'ios'|'android',
  updatedAt: ISO } }`; pulling an unknown setting id must be ignored safely (check both apps).
