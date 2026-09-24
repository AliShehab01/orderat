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
- The owner routes (`/owner`, `/owner/api/...`) require `OWNER_KEY` auth (`server/owner/auth.ts`), the
  same mechanism the hosted Supabase owner function uses — visiting `/owner?key=<OWNER_KEY>` once sets
  a sign-in cookie. This is on top of, not instead of, the existing "this computer only" check: if
  `OWNER_KEY` is not set in `.env.local`, `npm run whatsapp:dev` generates a random one for that run
  and prints the one-time sign-in URL (`http://localhost:8787/owner?key=...`) to the console — open it
  once per restart, or set `OWNER_KEY` yourself to keep the same URL across restarts.

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
| `OWNER_KEY` | Long random string protecting `/owner`; auto-generated for the run and printed to the console when unset |
| `GEMINI_API_KEY` | Turns on AI reading of text, voice notes and screenshots |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash` |
| `DEMO_CUSTOMER_NUMBER` | Your own WhatsApp number, used by the simulator |

Commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the tests |
| `npm run whatsapp:dev` | Starts the webhook on `http://localhost:8787/whatsapp/webhook` and the owner page on `http://localhost:8787/owner` (this computer only) |
| `npm run whatsapp:live` | Starts the agent and a Cloudflare quick tunnel, then points the WhatsApp account's webhook at the new tunnel address (quick-tunnel addresses change on every start) |
| `npm run whatsapp:simulate -- "message"` | Sends a customer message into the running agent, as if Meta delivered it |

Meta needs a public HTTPS address for the webhook, so expose port 8787 through a tunnel while testing, for example `cloudflared tunnel --url http://localhost:8787`. While the Meta app is unpublished, Meta only delivers its own test webhooks, not messages from real phones; use the simulator to demo the flow.

## Hosting on Supabase

`server/` and `src/lib/` run unchanged under Deno as three Supabase Edge Functions — the same
webhook handlers, agent, parser and day-plan logic as `npm run whatsapp:dev`, just deployed instead
of run on your machine, and backed by Postgres instead of an in-memory array. Nothing here is
required for local development; `npm run whatsapp:dev` keeps working exactly as before.

**What changed to make this possible:**

- **Storage.** `OrderStore` (`server/agent/store.ts`) is now an async interface. `MemoryStore`
  (used locally) and `SupabaseStore` (`server/agent/supabase-store.ts`, Postgres over PostgREST,
  no extra dependency) both implement it, and the agent persists every change explicitly through
  `store.update()`/`store.add()` — required once a store might be a network round-trip, since an
  Edge Function isolate can be recycled between requests the way a long-lived Node process isn't.
- **Time zone.** Bahrain has a fixed UTC+3 offset (no DST). Edge Functions run in UTC, so
  `src/lib/parser.ts` and `src/lib/plan.ts` compute Bahrain dates directly from the instant
  (`src/lib/bahrain-time.ts`) instead of through local `Date` methods, which used to depend on
  `server/dev.ts` forcing `process.env.TZ = "Asia/Bahrain"`. `src/lib/parser.timezone.test.ts`
  proves this with the process forced to UTC.
- **Deno compatibility.** Relative imports in `server/` and `src/lib/` carry explicit `.ts`
  extensions, which Deno 2 requires and which `tsc`/`tsx`/`vitest` also resolve fine
  (`allowImportingTsExtensions` in `tsconfig.json`, which excludes `supabase/` — that folder has
  its own `supabase/functions/deno.json` and is Deno's project, not Next's).
- **Owner access.** Both the local runner and the hosted function require `OWNER_KEY` auth
  (`server/owner/auth.ts`): an `HttpOnly; Secure; SameSite=Strict` cookie (set once by visiting
  `/owner?key=<OWNER_KEY>`) or an `Authorization: Bearer <OWNER_KEY>` header, compared in constant
  time. `supabase/functions/owner/index.ts` wraps the hosted function with it directly; `server/dev.ts`
  wraps the local one the same way (generating a key for the run when `.env.local` has none) and
  additionally checks "this computer only" (`isLocalRequest` in `server/owner/local-guard.ts`) as a
  second, non-substitute layer — the IP check alone fails open behind a non-Cloudflare tunnel.

**Layout:** three thin `Deno.serve` entry points, `supabase/functions/{whatsapp,instagram,owner}/index.ts`,
import `server/` and `src/lib/` by relative path and are deployed with `--use-api` (server-side
bundling, no local Docker daemon needed). Supabase's own docs show `--use-api` bundling a sibling
folder outside `supabase/` for exactly this kind of monorepo case, but it's a newer path than the
Docker-based deploy and has had reported bundler rough edges with outside imports on some layouts,
and local `supabase functions serve` still needs Docker regardless of `--use-api` (that flag only
changes how a real deploy bundles). **If a deploy ever fails to bundle the outside imports**, the
fallback is to physically copy `server/` and `src/lib/` into `supabase/functions/_shared/` (the
officially-supported, Docker-bundled pattern) and re-point the three `index.ts` files and
`server/dev.ts` at that copy instead — a single source of truth either way, just relocated.

### What the founder needs to do (none of this has been done for you)

1. **Sign up at [supabase.com](https://supabase.com) and create a project.** Supabase has no
   Middle East region; Mumbai (`ap-south-1`) and Frankfurt (`eu-central-1`) are the two candidates
   nearest Bahrain, and which is actually faster from Bahrain depends on real network routing —
   worth an empirical check, since a project's region can't be changed later without recreating it.
2. **Get the CLI and sign in** (already added as a dev dependency, so no global/Scoop install):
   ```
   npm install
   npx supabase login
   ```
   This opens a browser once to create an access token. In a non-interactive/CI context, use
   `npx supabase login --no-browser` or set `SUPABASE_ACCESS_TOKEN` instead.
3. **Link this repo to the project** (the project ref is in its dashboard URL):
   ```
   npx supabase link --project-ref <project-ref>
   ```
4. **Run the migration** (creates `orders` and `processed_messages`, RLS on, no public policies):
   ```
   npm run supabase:migrate
   ```
5. **Add the new settings to `.env.local`**, alongside the existing WhatsApp/Gemini ones — get
   `SUPABASE_URL` and the service role key from Settings > API in the dashboard, and make up a long
   random string for `OWNER_KEY`:

   | Name | Purpose |
   | --- | --- |
   | `SUPABASE_URL` | Project URL, `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Settings > API — bypasses RLS, server-side only |
   | `OWNER_KEY` | Long random string protecting the hosted `/owner` page |

6. **Push secrets and deploy** (never prints a secret value):
   ```
   npm run supabase:secrets
   npm run supabase:deploy
   ```
   Deploy one function at a time with `npm run supabase:deploy -- whatsapp`.
7. **Point Meta at the deployed webhooks** (App Dashboard > WhatsApp/Instagram > Configuration >
   Webhooks), then click Verify and Save:
   - WhatsApp: `https://<project-ref>.supabase.co/functions/v1/whatsapp`
   - Instagram: `https://<project-ref>.supabase.co/functions/v1/instagram`
8. **Check `verify_jwt` in the dashboard** (Edge Functions > function > Details) for all three
   functions. `supabase/config.toml` sets it to `false`, but the CLI has been reported to not
   always apply that on a redeploy — Meta's verification GET will fail with a 401 from Supabase
   itself (not from this code) if it's stuck on.
9. **Sign in to the hosted owner page** once, in a browser: visit
   `https://<project-ref>.supabase.co/functions/v1/owner?key=<OWNER_KEY>`. It redirects back to the
   same page with the cookie set; bookmark the plain URL (without `?key=`) after that.
10. **Tail logs** while testing: `npm run supabase:logs -- whatsapp`.

None of this was run as part of preparing the code — no Supabase account was created, and nothing
was deployed or pushed.

## Legal pages

`public/orderat/privacy.html`, `terms.html` and `data-deletion.html` are published on GitHub Pages and set in the Meta app settings. The `gh-pages` branch is a copy of `public/orderat`.
