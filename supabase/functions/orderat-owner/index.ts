// Supabase Edge Function entry point for the owner page + API.
// Deployed as: npm run hosting:deploy (supabase functions deploy orderat-owner --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-owner
//
// Unlike server/dev.ts (which restricts /owner to loopback requests), this function is reachable
// from the public internet — verify_jwt is off (supabase/config.toml) so Supabase's own gateway
// does not block it either. server/owner/auth.ts is the access control here: OWNER_KEY, checked as
// a cookie set by visiting /owner?key=<OWNER_KEY> once, or an Authorization: Bearer header for API
// calls. See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout and the
// orderat- / ORDERAT_ prefixing.

import { createOwnerHandler } from "../../../server/owner/handler.ts";
import { withOwnerAuth } from "../../../server/owner/auth.ts";
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

const ownerHandler = createOwnerHandler({ store, products, senders: { whatsapp: send, instagram: igSend } });
const handler = withOwnerAuth(env("OWNER_KEY"), ownerHandler);

Deno.serve((req) => handler(req));
