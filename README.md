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

What it does today:

- A customer messages the WhatsApp number. The agent reads the order, stores it as **pending**, and replies with a summary in Arabic or English.
- It asks for a missing collection time, applies changes such as "make it 35 not 20", and never replies twice to a retried delivery.
- With a `GEMINI_API_KEY`, Gemini reads text, voice notes and screenshots. If Gemini fails, text falls back to the built-in parser and media gets an acknowledgement. Without a key, only text is read.
- The owner page lists the agent's orders. Confirming an order sends the customer a WhatsApp confirmation.
- Orders are kept in memory and are lost on restart.

Settings in `.env.local` (never committed):

| Name | Purpose |
| --- | --- |
| `WHATSAPP_TOKEN` | Access token from Meta (temporary tokens expire after about 24 hours) |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Business account ID |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string; the same value goes in Meta's webhook settings |
| `WHATSAPP_APP_SECRET` | App settings > Basic > App secret; turns on signature checks |
| `WHATSAPP_ALLOW_UNSIGNED` | `1` accepts unsigned calls when no app secret is set (testing only) |
| `WHATSAPP_DRY_RUN` | `1` prints replies instead of sending them |
| `GEMINI_API_KEY` | Turns on AI reading of text, voice notes and screenshots |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash` |
| `DEMO_CUSTOMER_NUMBER` | Your own WhatsApp number, used by the simulator |

Commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the tests |
| `npm run whatsapp:dev` | Starts the webhook on `http://localhost:8787/whatsapp/webhook` and the owner page on `http://localhost:8787/owner` (this computer only) |
| `npm run whatsapp:simulate -- "message"` | Sends a customer message into the running agent, as if Meta delivered it |

Meta needs a public HTTPS address for the webhook, so expose port 8787 through a tunnel while testing, for example `cloudflared tunnel --url http://localhost:8787`. While the Meta app is unpublished, Meta only delivers its own test webhooks, not messages from real phones; use the simulator to demo the flow.

## Legal pages

`public/orderat/privacy.html`, `terms.html` and `data-deletion.html` are published on GitHub Pages and set in the Meta app settings. The `gh-pages` branch is a copy of `public/orderat`.
