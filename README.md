# اوردرات — Orderat browser MVP

Pitch-ready browser MVP for Bahrain home sellers. Basic captures copied text, screenshots, voice notes and manual orders without accessing WhatsApp or Instagram. The owner reviews every draft before it enters the order book and day plan.

Ready Stock tracks finished items, automatically reserves quantities for open confirmed orders, flags product-level shortages, and shows what remains available to sell. Sales Analytics uses current product prices to estimate booked sales, average order value, units, bestsellers, order sources and fulfilment progress. These features remain device-local in the prototype.

Every order records its customer channel and intake method separately. Automatic Pro examples retain the WhatsApp customer number or Instagram username. Manually captured orders also retain their stated source and customer reference. Source details appear in the order list, order details, review form, analytics and CSV export.

The Plans screen presents the proposed BHD 9 Basic and BHD 15 Pro tests. Pro includes a pre-subscription readiness checklist for WhatsApp Business, a Meta business account, possible Meta verification, and a professional Instagram account. Pro remains marked as pending Meta app review; no payment or account connection is performed in the prototype.

The interactive product is served from `public/orderat`. It stores prototype records on the current device. Text extraction is a limited local demonstration; live AI, authentication, cloud sync, Meta APIs, customer replies and subscription billing are not connected.

The visual and verbal system is documented in `BRAND_GUIDELINES.md`. Orderat uses IBM Plex Sans Arabic and IBM Plex Sans in Regular 400 and Bold 700, with a flat operational palette and direct, owner-controlled language.

Light and dark modes use the same brand tokens. On mobile, the bottom navigation keeps Today, Order Book and Ready Stock visible; Day Plan, Sales, Products, Plans and Settings sit behind a single More menu.

Run with `npm run dev` or create the static export with `npm run build`.

## WhatsApp agent (Pro) — local webhook

`server/` holds the WhatsApp Cloud API webhook. It runs separately from the static site, because a static export cannot receive webhook calls. The code uses the standard Request/Response API, so it can move to a Supabase Edge Function or Vercel later.

What it does today: a customer messages the WhatsApp number, the agent reads the order, stores it as **pending** (the owner still confirms), and replies with a summary in Arabic or English. It asks for a missing collection time, applies changes such as "make it 35 not 20", and never replies twice to a retried delivery. Voice notes and images get an acknowledgement only; Gemini extraction comes later. Orders are kept in memory and are lost on restart.

Settings in `.env.local` (never committed):

| Name | Purpose |
| --- | --- |
| `WHATSAPP_TOKEN` | Access token from Meta (temporary tokens expire after about 24 hours) |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string; the same value goes in Meta's webhook settings |
| `WHATSAPP_APP_SECRET` | App settings > Basic > App secret; enables signature checks |
| `WHATSAPP_ALLOW_UNSIGNED` | `1` accepts unsigned calls when no app secret is set (testing only) |
| `WHATSAPP_DRY_RUN` | `1` prints replies instead of sending them |

Commands: `npm test` runs the tests; `npm run whatsapp:dev` starts the webhook on `http://localhost:8787/whatsapp/webhook`. Meta needs a public HTTPS address, so expose that port through a tunnel while testing.
