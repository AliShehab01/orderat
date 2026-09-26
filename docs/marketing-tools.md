# Marketing tools: occasion campaigns, photo studio, shop link

Three growth tools the founder approved on 2026-09-26. The backend (this repo), the iPhone app
(orderat-ios) and the Android app (orderat-app) share this spec. It follows the same rules as
[Ask Orderat](ask-orderat.md): the apps call our Supabase Edge Functions, API keys stay on the
server, and every AI call is rate limited.

| Tool | Arabic name | What the seller gets | Function |
|---|---|---|---|
| A. Occasion campaigns | حملات المناسبات | A ready campaign for each GCC occasion (tips, captions, hashtags, photo style), updated live from the server | `orderat-campaigns` (+ `orderat-studio` for AI captions) |
| B. Photo studio | استوديو الصور | A plain phone photo of a product becomes a studio or occasion photo | `orderat-studio` |
| C. Shop link | رابط متجري | A public shop page with her menu; customers order from it and the order lands in the app | `orderat-shop` + page `public/orderat/s/` |

Why these are hard to copy: the content calendar and the photo style prompts live on the server
and change without an app update, the shop link ties the public page to the seller's order book,
and each tool feeds the others (a campaign opens the studio with the occasion's style, a studio
photo becomes the product photo on the shop link, the campaign caption links to the shop).

## Shared rules

- **Headers**: `apikey: <anon key>` and `Authorization: Bearer <anon key>`, like `orderat-ask`.
  The shop page (browser) uses the same anon key.
- **installId / platform / appVersion / demo**: same meaning as in Ask Orderat.
- **Gating**: campaigns are free for everyone, including demo mode (no AI cost). AI captions and
  photos need the trial or a subscription; demo mode gets a small taste (see limits). The shop
  link is not available in demo mode (it needs the seller's real shop).
- **Usage ledger**: one generic table pair, `orderat.feature_usage (feature, install_id, day, count)`
  and `orderat.feature_usage_daily (feature, day, count)`, with the same increment-then-check logic
  as `server/ask/limits.ts`. Features: `caption`, `photo`. Ask Orderat keeps its own tables.
- **Errors** are JSON `{ "error": "<code>" }`: 400 `invalid_body`, 401 `bad_token`,
  404 `not_found`, 409 `slug_taken`, 413 `too_large`, 422 `unsafe_image`, 429 `daily_limit` |
  `busy` | `rate_limited`, 502 `ai_unavailable`.
- **Logging**: counts, status and latency only. Never log images, captions, shop content, customer
  names or phone numbers.

## A. Occasion campaigns

`GET /functions/v1/orderat-campaigns?country=BH&today=2026-09-26`

- `country` (optional): one of `BH SA AE KW QA OM`. Without it, campaigns for every GCC country
  are returned. The apps derive it from the shop currency (BHD→BH, SAR→SA, AED→AE, KWD→KW,
  QAR→QA, OMR→OM; anything else sends no country).
- `today` (optional, `YYYY-MM-DD`): defaults to today in Asia/Riyadh time (UTC+3).
- Returns campaigns whose `endDate >= today` and `promoteFrom <= today + 120 days`, sorted by
  `startDate`. `Cache-Control: public, max-age=3600`.

Response:
```json
{
  "version": "2026-09-26.1",
  "campaigns": [
    {
      "id": "teachers-day-2026",
      "occasion": "teachers_day",
      "name": { "ar": "يوم المعلم", "en": "Teachers' Day" },
      "emoji": "🍎",
      "countries": ["BH", "SA", "AE", "KW", "QA", "OM"],
      "startDate": "2026-10-05",
      "endDate": "2026-10-05",
      "promoteFrom": "2026-09-21",
      "accent": "#E4572E",
      "headline": { "ar": "هدية حلوة للمعلمة", "en": "A sweet thank-you for teachers" },
      "tips": { "ar": ["..."], "en": ["..."] },
      "productIdeas": { "ar": ["..."], "en": ["..."] },
      "captions": { "ar": ["... {shop} ... {item} ... {price} ... {link}"], "en": ["..."] },
      "hashtags": { "ar": ["#يوم_المعلم"], "en": ["#TeachersDay"] },
      "studioStyles": ["teachers_day", "white"]
    }
  ],
  "studioStyles": [
    {
      "id": "white",
      "name": { "ar": "أبيض نظيف", "en": "Clean white" },
      "previewUrl": "https://alishehab01.github.io/orderat/studio/white.jpg",
      "occasion": null
    }
  ]
}
```

- Caption placeholders: `{shop}` shop name, `{item}` product name, `{price}` formatted price,
  `{link}` the seller's shop link (or removed with its line when she has none), `{date}` the
  occasion date. The app fills them; lines whose placeholder has no value are dropped.
- Content lives in this repo as `content/campaigns.json` and `content/studio-styles.json`, bundled
  into the function. Updating content = edit the JSON + `npm run hosting:deploy -- orderat-campaigns`.
  A unit test validates every entry (both languages present, valid dates, known style ids, hex
  accent, `promoteFrom <= startDate <= endDate`).
- Style prompts (`prompt` in `studio-styles.json`) are server-only and never returned by any API.
- Hijri occasions carry explicit Gregorian dates per year (from the Umm al-Qura calendar). When a
  moon sighting moves a date, fix the JSON and redeploy; the apps pick it up within an hour.

App behavior:
- Fetch on launch at most every 6 hours; keep the last good response on disk and use it offline.
  Works in demo mode.
- **Today card** for the nearest campaign with `promoteFrom <= today <= endDate` ("🌙 رمضان بعد
  12 يوم، جهّزي حملتك"). The seller can hide it per campaign.
- **Campaign screen**: emoji + name + countdown, headline, tips, product ideas, captions with the
  placeholders filled from a product the seller picks (buttons Copy, Share, and "Write with AI"),
  hashtags, "Make an occasion photo" (opens the studio with the campaign's first style), "Add to my
  occasions" (creates a local Occasion: kind from `occasion`, start/end dates, pre-orders open at
  `promoteFrom`) and "Share my shop link".
- **Shop tab → Marketing**: a "Campaigns" list with every campaign from the feed.

### AI captions (part of A)

`POST /functions/v1/orderat-studio`
```json
{
  "task": "caption",
  "installId": "...", "platform": "ios", "appVersion": "1.1.0", "demo": false,
  "lang": "ar",
  "channel": "instagram",
  "campaignId": "teachers-day-2026",
  "shopName": "Sweet Studio",
  "currency": "BHD",
  "items": [{ "name": "Cheesecake cups", "priceMinor": 4500 }],
  "note": "توصيل مجاني في الرفاع",
  "link": "https://alishehab01.github.io/orderat/s/?sweetstudio"
}
```
- `channel`: `instagram` | `whatsapp_status` | `tiktok`. `campaignId` optional (unknown ids are
  ignored). `items` 1-5 entries. `note` optional, at most 200 characters. `link` optional.
- Response: `{ "captions": ["...", "...", "..."], "hashtags": ["#..."], "remainingToday": 19 }`
  with exactly 3 caption variants in the requested language, each under 600 characters. Gulf
  Arabic for `ar`. Prices formatted like Ask Orderat (BHD/KWD/OMR 3 decimals, others 2, Latin
  digits). The link, when given, is included as is in each caption.
- Limits: 20 per install per day (3 in demo mode); global cap `ORDERAT_CAPTION_DAILY_CAP`,
  default 3000.
- Model: the same text model chain as Ask Orderat (`ORDERAT_GEMINI_MODEL` + fallbacks), JSON
  output `{captions, hashtags}`.

## B. Photo studio

`POST /functions/v1/orderat-studio`
```json
{
  "task": "photo",
  "installId": "...", "platform": "android", "appVersion": "1.1.0", "demo": false,
  "styleId": "marble",
  "aspect": "1:1",
  "image": { "mimeType": "image/jpeg", "data": "<base64>" }
}
```
- `styleId`: an id from `studio-styles.json`. `aspect`: `1:1` | `4:5` | `9:16`.
- `image`: JPEG, PNG or WebP, at most 2 MB decoded. The apps resize to at most 1536 px on the long
  side and encode JPEG quality 0.85 before sending.
- Response: `{ "image": { "mimeType": "image/png", "data": "<base64>" }, "remainingToday": 9 }`.
- 422 `unsafe_image` when the model blocks the image or returns no image.
- Limits: 10 per install per day (2 in demo mode); global cap `ORDERAT_PHOTO_DAILY_CAP`,
  default 300 (cost control: image models are paid only).
- Model: `ORDERAT_IMAGE_MODEL`, default `gemini-3.1-flash-image`, fallbacks
  `ORDERAT_IMAGE_FALLBACK_MODELS`, default `gemini-2.5-flash-image`. Uses
  `generationConfig.responseModalities: ["IMAGE"]` and `imageConfig.aspectRatio`. Timeout 60 s.
  **Image models need the paid Gemini tier**; on the free tier every call returns 429 and the
  function answers 502 `ai_unavailable`.
- Prompt = the style's server-side prompt + fixed guardrails: keep the product identical (shape,
  colors, decorations, text on the product, size), change only the background, surface and light,
  photorealistic, no added text, logos, watermarks or people.
- Images are never stored on the server.

App behavior:
- Entry points: Shop → Marketing → Photo studio; product edit screen ("Make it pro ✨"); campaign
  screen.
- Flow: pick or take a photo → pick a style (grid with preview images, occasion styles first when a
  campaign is active) → pick the shape (square, portrait, story) → generate (show progress, about
  10-20 s) → before/after view → Save to Photos, Share, or "Use as product photo" (when opened from a
  product).
- Friendly errors: daily limit reached, offline, "the photo couldn't be processed, try another".

## C. Shop link

Public page: `https://alishehab01.github.io/orderat/s/?<slug>` (static page in
`public/orderat/s/`, published with `npm run pages:publish`; env `ORDERAT_SHOP_BASE_URL` holds
the base so it can move to a custom domain later).

### Data (migration `db/migrations/0003_marketing.sql`)

- `orderat.shops`: `id uuid pk`, `slug text unique`, `token_hash text` (SHA-256 hex of the edit
  token), `install_id text`, `doc jsonb` (the public shop document), `published bool`,
  `blocked bool`, `created_at`, `updated_at`.
- `orderat.shop_photos`: `(shop_id, photo_id) pk`, `path text`, `created_at`. `photo_id` is the
  SHA-256 hex of the JPEG bytes, so an unchanged photo is never uploaded twice.
- `orderat.shop_orders`: `id uuid pk`, `shop_id`, `ref text` (like `W4821`), `doc jsonb`,
  `ip_hash text`, `created_at`. Deleted when the seller's app acknowledges them, and purged after
  30 days either way.
- `orderat.shop_views_daily`: `(shop_id, day) pk`, `count`.
- Photos go to the public Supabase Storage bucket `orderat-shop` at `<shopId>/<photoId>.jpg`. The
  function writes them with the project's service role key, only ever to that bucket and only to
  paths it builds itself (a documented exception to the orderat_app-only rule; the database is
  still accessed only as orderat_app).

### Public shop document

```json
{
  "slug": "sweetstudio",
  "name": { "ar": "سويت ستوديو", "en": "Sweet Studio" },
  "bio": "حلويات بيتية طازجة كل يوم",
  "lang": "ar",
  "currency": "BHD",
  "whatsapp": "97333334444",
  "instagram": "sweetstudio.bh",
  "area": "الرفاع",
  "pickupHours": "4:00 PM - 8:00 PM",
  "leadTimeDays": 1,
  "delivery": "pickup_and_delivery",
  "acceptsWebOrders": true,
  "accent": "#7C4DFF",
  "logoUrl": "https://.../orderat-shop/<shopId>/<photoId>.jpg",
  "items": [
    {
      "id": "p1",
      "name": { "ar": "كب تشيز كيك", "en": "Cheesecake cups" },
      "description": "علبة 6 حبات",
      "priceMinor": 4500,
      "photoUrl": "https://.../orderat-shop/<shopId>/<photoId>.jpg",
      "available": true
    }
  ]
}
```
Limits: 60 items, name 60 chars, description 200, bio 300, each photo at most 400 KB (the apps
resize to 1080 px, JPEG 0.8). `delivery`: `pickup` | `delivery` | `pickup_and_delivery`.

### Endpoints (`orderat-shop`)

All `POST` bodies are JSON with an `action` field, except the public read.

| Call | Who | Body / query | Response |
|---|---|---|---|
| `GET ?slug=<slug>` | page | | 200 shop document (+ `"url"`), 404 `not_found` when missing, unpublished or blocked. Counts a view. `Cache-Control: public, max-age=60`. |
| `slug_check` | app | `{slug}` | `{available: bool}` (also false for invalid or reserved slugs) |
| `publish` | app | `{installId, token?, slug, shop, photos: [{photoId, mimeType, data}]}` | `{slug, url, token?, photoUrls: {photoId: url}}` |
| `unpublish` | app | `{token}` | `{ok: true}` |
| `stats` | app | `{token}` | `{views7d, orders7d, pending}` |
| `order` | page | `{slug, customer: {name, phone}, items: [{id, qty}], pickupDate, pickupTime?, fulfillment?, address?, notes?}` | `{orderRef, whatsappText}` |
| `inbox` | app | `{token}` | `{orders: [{id, ref, createdAt, customer, items, totalMinor, pickupDate, pickupTime, fulfillment, address, notes}]}` |
| `ack` | app | `{token, orderIds: []}` | `{deleted: n}` |

Publish rules:
- First publish (no `token`): the slug must be free. The server creates the shop and returns a new
  edit token (32 random bytes, base64url) once. The app stores it in the Keychain / encrypted
  prefs and in backups. Later publishes need the token (401 `bad_token` otherwise) and may change
  the slug when the new one is free.
- In `shop`, items and the logo refer to photos by `photoId`. The server replaces them with public
  URLs. `photos` carries only photos the server does not have yet; the app learns which ones it
  has from `photoUrls` in earlier responses. A referenced photo that is neither uploaded nor sent
  is dropped from the item.
- Slug: `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`, not in the reserved list (`admin api app help orderat
  s shop shops store support www` …). 409 `slug_taken` when used by another shop.
- 30 publishes per shop per day. Body at most 6 MB.

Order rules (from the page):
- Prices come from the server's copy of the shop, never from the page. Unknown or unavailable
  item ids → 400. Quantities 1-99, at most 30 lines.
- `customer.name` 1-60 chars; `customer.phone` 8-15 digits (a leading + is allowed);
  `pickupDate` today (Asia/Riyadh) + `leadTimeDays` or later, and within 60 days; notes at most
  300 chars; `address` at most 200 chars and only when `fulfillment` is `delivery`.
- 429 `rate_limited` above 5 orders per hour from one IP (hashed with a server salt, never stored
  raw) or 100 orders per day for one shop. 404 when the shop does not accept web orders.
- `whatsappText` is the order summary the page sends to the seller on WhatsApp after saving, so
  the seller sees it even before opening the app.

### App behavior

- Shop → Marketing → "My shop link": pick the slug (live availability check), bio, area, pickup
  hours, lead time, delivery option, accept web orders on/off, which products to show (all active
  products by default), then Publish. After publishing: the link with Copy, Share, Open, a QR code,
  "Put it in your Instagram bio" tip, views and orders this week (`stats`), Update and Unpublish.
- Products show their photo when they have one; the studio's "Use as product photo" sets it.
- Web orders: on launch and pull-to-refresh on Today, the app calls `inbox`. New orders show in a
  "From your shop link" section. "Add" creates the order (and the customer, matched by phone) as a
  new order; "Dismiss" drops it. Both then `ack` it.
- Not available in demo mode (the screen explains to start the trial first).

### Page behavior (`public/orderat/s/`)

- Loads the shop with `GET ?slug=`; Arabic RTL by default (`lang` of the shop), with an EN/AR
  toggle. All shop text is rendered as text, never as HTML.
- Header (logo, name, bio, area, pickup hours, Instagram), product grid with photos and prices,
  quantity steppers, a sticky cart bar, and a checkout sheet (name, phone, pickup or delivery,
  address, date, time, notes).
- "Send order": `POST order`, then a confirmation screen with the order number and a WhatsApp
  button that opens `https://wa.me/<whatsapp>?text=<whatsappText>`. When the shop does not accept
  web orders, the cart button opens WhatsApp directly with the summary.
- Footer: "Powered by Orderat · Make your own free shop link" linking to the Orderat landing page
  (store links), plus a "Report" mailto link.
- Not found / unpublished: a friendly message and the Orderat link.

## Privacy

Update `public/orderat/privacy.html` (both languages):
- Photo studio: the chosen photo goes to Google Gemini to make the new image; it is not stored.
- AI captions: the shop name, chosen product names and prices go to Google Gemini.
- Shop link: what the seller publishes is public. Customer orders placed on the page (name, phone,
  order details) are stored until the seller's app downloads them, at most 30 days.
