// Supabase Edge Function entry point for the owner API.
// Deployed as: npm run hosting:deploy (supabase functions deploy orderat-owner --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-owner
//
// Unlike server/dev.ts (which restricts /owner to loopback requests), this function is reachable
// from the public internet — verify_jwt is off (supabase/config.toml) so Supabase's own gateway does
// not block it either. It is JSON-only: *.supabase.co rewrites text/html responses to text/plain
// without a custom domain (see README "Hosting"), so the owner UI is a static page instead
// (public/orderat/owner.html + owner.js), served from GitHub Pages and calling this function
// cross-origin. That means three things server/dev.ts's local flow doesn't need, each its own small
// wrapper around the same server/owner/handler.ts server/dev.ts uses, so that shared handler stays
// exactly as it was:
//   - server/owner/json-only.ts   strips the HTML owner-page route (Supabase can't serve it anyway)
//   - server/owner/hosted-path.ts rewrites this function's own /functions/v1/orderat-owner prefix
//                                 onto the /owner-rooted paths handler.ts matches
//   - server/owner/auth.ts's withOwnerBearerAuth (not withOwnerAuth): Authorization: Bearer only,
//                                 no cookie sign-in — a cross-origin cookie can't work here anyway
//                                 (see server/owner/cors.ts on why credentials are never sent)
//   - server/owner/cors.ts        strict origin allow-list (ORDERAT_OWNER_ALLOWED_ORIGINS)
// See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout and the
// orderat- / ORDERAT_ prefixing.

import { createOwnerHandler } from "../../../server/owner/handler.ts";
import { withOwnerBearerAuth } from "../../../server/owner/auth.ts";
import { withOwnerApiOnly } from "../../../server/owner/json-only.ts";
import { withHostedOwnerPath } from "../../../server/owner/hosted-path.ts";
import { withOwnerCors, parseAllowedOrigins } from "../../../server/owner/cors.ts";
import { createWhatsAppSender } from "../../../server/whatsapp/client.ts";
import { createInstagramSender } from "../../../server/instagram/client.ts";
import { PostgresStore } from "../../../server/agent/postgres-store.ts";
import { demoProducts } from "../../../src/lib/plan.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const store = new PostgresStore(getSqlClient(env("DATABASE_URL") ?? ""));
const products = demoProducts();

const token = env("WHATSAPP_TOKEN");
const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
const send = token && phoneNumberId
  ? createWhatsAppSender({ token, phoneNumberId, apiVersion: env("WHATSAPP_API_VERSION") })
  : undefined;
const igToken = env("INSTAGRAM_ACCESS_TOKEN");
const igSend = igToken ? createInstagramSender({ token: igToken, apiVersion: env("INSTAGRAM_API_VERSION") }) : undefined;

const rawOwnerHandler = createOwnerHandler({ store, products, senders: { whatsapp: send, instagram: igSend } });
const apiOnly = withOwnerApiOnly(rawOwnerHandler);
const pathAdjusted = withHostedOwnerPath("/functions/v1/orderat-owner", apiOnly);
const authed = withOwnerBearerAuth(env("OWNER_KEY"), pathAdjusted);
const handler = withOwnerCors(parseAllowedOrigins(env("OWNER_ALLOWED_ORIGINS")), authed);

Deno.serve((req) => handler(req));
