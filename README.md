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

## Hosting

`server/` and `src/lib/` run unchanged under Deno as three Supabase Edge Functions — the same
webhook handlers, agent, parser and day-plan logic as `npm run whatsapp:dev`, just deployed instead
of run on your machine, and backed by Postgres instead of an in-memory array. Nothing here is
required for local development; `npm run whatsapp:dev` keeps working exactly as before.

### Why Hayati

Supabase's free plan allows two projects. The founder's other project, **Hayati**, is a live iOS
game with real players; rather than spend Orderat's slot on a project of its own (or crowd Hayati
out with a second free project that doesn't exist), Orderat is hosted *inside* Hayati's existing
project (ref `ckjmbdbvlbxfofjgqiuj`, region `ap-south-1`, Postgres 17) as an isolated tenant. Orderat
is small (a handful of tables, low traffic) and Hayati doesn't need the Postgres headroom Orderat
would otherwise sit idle on its own project for — a reasonable trade as long as Orderat can never
read Hayati's data, degrade its database, or get in the way of moving off this arrangement later.

### The isolation contract

- **Its own schema, nothing in `public`.** Every Orderat table lives in schema `orderat`
  (`orderat.orders`, `orderat.processed_messages`, `orderat.schema_migrations`) —
  `db/migrations/0001_orderat_isolation.sql`. Hayati's own tables (`public` or wherever its game
  keeps them) are never touched, queried, or even visible to Orderat's connection.
- **A least-privilege role, not Hayati-wide credentials.** Orderat's code — Edge Functions and
  `server/dev.ts` alike — connects to Postgres directly as `orderat_app`
  (`server/agent/postgres-store.ts`, `server/agent/postgres-client.ts`,
  `supabase/functions/_shared/db.ts`), never with a Supabase service role key or an admin DB URL.
  `orderat_app` can only reach schema `orderat` (`search_path` pinned to it, `USAGE` +
  `SELECT`/`INSERT`/`UPDATE`/`DELETE` on its two tables, nothing else granted, everything revoked
  from `PUBLIC`/`anon`/`authenticated`), has a `statement_timeout` of 10s so one slow query can't
  hold a connection open, and a hard `CONNECTION LIMIT 10` so a bug or a traffic spike in Orderat
  can never crowd Hayati out of the pooler's connection budget. It owns its two tables outright
  (simpler and just as safe here as writing RLS policies would be, since Orderat has no separate
  PostgREST/anon access path at all — see the migration file's comments for the full reasoning);
  RLS is still enabled on both as defense in depth, in case either table is ever exposed through
  PostgREST later.
- **Prefixed everywhere it's visible in the shared project.** Edge Functions are named
  `orderat-whatsapp`, `orderat-instagram`, `orderat-owner` (not `whatsapp`/`instagram`/`owner`);
  every hosted secret carries an `ORDERAT_` prefix and is read only through that prefix
  (`supabase/functions/_shared/env.ts`). Nothing Orderat does can accidentally read, overwrite, or
  even collide in name with something that belongs to Hayati.
- **Migrations outside the Supabase CLI's managed folder.** `db/migrations/` (not
  `supabase/migrations/`), applied by `npm run hosting:migrate`, never `supabase db push` — so
  nobody ever points the CLI's own migration history at Hayati's project and risks it trying to
  reconcile against Hayati's own (unrelated) migrations.

**Layout:** three thin `Deno.serve` entry points, `supabase/functions/orderat-{whatsapp,instagram,owner}/index.ts`,
import `server/` and `src/lib/` by relative path and are deployed with `--use-api` (server-side
bundling, no local Docker daemon needed). Supabase's own docs show `--use-api` bundling a sibling
folder outside `supabase/` for exactly this kind of monorepo case, but it's a newer path than the
Docker-based deploy and has had reported bundler rough edges with outside imports on some layouts,
and local `supabase functions serve` still needs Docker regardless of `--use-api` (that flag only
changes how a real deploy bundles). `supabase/functions/_shared/` already holds two small files
every function imports (`env.ts`, the `ORDERAT_` env prefix helper; `db.ts`, the Deno Postgres
adapter) — **if a deploy ever fails to bundle the outside imports**, the fallback is to also copy
`server/` and `src/lib/` in there (the officially-supported, Docker-bundled pattern) and re-point
the three `index.ts` files and `server/dev.ts` at that copy instead — a single source of truth
either way, just relocated.

### Move to a dedicated project later

Everything above is what makes this cheap: a new project is a new `ORDERAT_DATABASE_URL` (plus the
other `ORDERAT_*` secrets) and a redeploy, not a rewrite.

1. **Create the new Supabase project**, note its ref and pooler host.
2. `npm run hosting:migrate -- --project-ref <new-ref>` — creates schema `orderat`, `orderat_app`
   and both tables there, from the same `db/migrations/` files, unmodified.
3. **Copy the data across** (Hayati's `orderat` schema → the new project):
   ```
   pg_dump --data-only --schema=orderat --exclude-table=orderat.schema_migrations \
     "<Hayati admin connection string>" | psql "<new project admin connection string>"
   ```
   (`schema_migrations` is excluded/reconciled separately — it's bookkeeping for
   `hosting:migrate`, not Orderat's data; step 2 already populated it correctly for the new project.)
4. `npm run hosting:db-user -- --project-ref <new-ref> --pooler-host <new-pooler-host>`, then
   `npm run hosting:secrets -- --project-ref <new-ref>`, then
   `npm run hosting:deploy -- --project-ref <new-ref>`.
5. **Re-point Meta's webhooks** (App Dashboard > WhatsApp/Instagram > Configuration > Webhooks) at
   the new project's function URLs, Verify and Save.
6. **Clean up Hayati** once the new project is confirmed working (see "Undo" below).

**Undo / clean up Hayati** (after a successful move, or to abandon hosting Orderat there entirely):

```
npx supabase functions delete orderat-whatsapp --project-ref ckjmbdbvlbxfofjgqiuj
npx supabase functions delete orderat-instagram --project-ref ckjmbdbvlbxfofjgqiuj
npx supabase functions delete orderat-owner --project-ref ckjmbdbvlbxfofjgqiuj
# Unset every ORDERAT_* secret in the dashboard (Edge Functions > Secrets), or via the CLI.
```
```sql
-- Run against Hayati (e.g. via the dashboard's SQL editor, or supabase db query --linked):
drop schema orderat cascade;
drop role orderat_app;
```

### Shared free-tier quotas to watch

Because this is Hayati's project, not Orderat's own, these are shared with the game, not
Orderat-exclusive budgets:

- **500 MB database.** Orderat's two tables are small, but they're 500 MB shared with Hayati's own
  data, not 500 MB just for Orderat.
- **Edge Function invocations** (free tier: 500K/month) — shared across every function in the
  project, Hayati's and Orderat's `orderat-*` three alike.
- **Egress** — same pool, same reasoning.

None of this is enforced in code; it's watched by keeping an eye on the dashboard's usage page.
When it becomes a real constraint, that's the trigger for "Move to a dedicated project" above.

### First-time setup (none of this has been done for you)

1. **Get the CLI and sign in** (already a dev dependency, so no global/Scoop install):
   ```
   npm install
   npx supabase login
   ```
   This opens a browser once to create an access token. In a non-interactive/CI context, use
   `npx supabase login --no-browser` or set `SUPABASE_ACCESS_TOKEN` instead. There is no `supabase
   link` step — every `hosting:*` script below takes `--project-ref` explicitly instead, precisely
   so nothing here ever points the CLI's own linked-project state at Hayati.
2. **Set `ORDERAT_SUPABASE_PROJECT_REF` and `ORDERAT_DB_POOLER_HOST` in `.env.local`** (or pass
   `--project-ref`/`--pooler-host` to each command below) — Hayati's ref (`ckjmbdbvlbxfofjgqiuj`)
   and its Supavisor transaction pooler host (Settings > Database > Connection pooling in the
   dashboard; currently `aws-0-ap-south-1.pooler.supabase.com`).
3. **Apply the isolation-contract migration:**
   ```
   npm run hosting:migrate
   ```
4. **Create `orderat_app`'s login and write `ORDERAT_DATABASE_URL` to `.env.local`** (never printed):
   ```
   npm run hosting:db-user
   ```
5. **Add the WhatsApp/Instagram/Gemini/`OWNER_KEY` settings to `.env.local`** (unprefixed — same
   names `server/dev.ts` already reads; see `.env.example`), then **push them as hosted secrets**
   (renamed with the `ORDERAT_` prefix, never printed):
   ```
   npm run hosting:secrets
   ```
6. **Deploy the three functions:**
   ```
   npm run hosting:deploy
   ```
   Deploy one function at a time with `npm run hosting:deploy -- orderat-whatsapp`.
7. **Point Meta at the deployed webhooks** (App Dashboard > WhatsApp/Instagram > Configuration >
   Webhooks), then click Verify and Save:
   - WhatsApp: `https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-whatsapp`
   - Instagram: `https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-instagram`
8. **Sign in to the hosted owner page** once, in a browser: visit
   `https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-owner?key=<OWNER_KEY>`. It
   redirects back to the same page with the cookie set; bookmark the plain URL (without `?key=`)
   after that.
9. **Tail logs** while testing: `npm run hosting:logs -- orderat-whatsapp --project-ref ckjmbdbvlbxfofjgqiuj`.

None of this was run as part of preparing the code — no migration was applied, no secret was
pushed, and nothing was deployed.

## Legal pages

`public/orderat/privacy.html`, `terms.html` and `data-deletion.html` are published on GitHub Pages and set in the Meta app settings. The `gh-pages` branch is a copy of `public/orderat`.
