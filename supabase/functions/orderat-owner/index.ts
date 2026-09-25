// Supabase Edge Function entry point for the owner page + API.
// Deployed as: supabase functions deploy owner --use-api
// URL: https://<project-ref>.supabase.co/functions/v1/owner
//
// Unlike server/dev.ts (which restricts /owner to loopback requests), this function is reachable
// from the public internet — verify_jwt is off (supabase/config.toml) so Supabase's own gateway
// does not block it either. server/owner/auth.ts is the access control here: OWNER_KEY, checked as
// a cookie set by visiting /owner?key=<OWNER_KEY> once, or an Authorization: Bearer header for API
// calls. See supabase/functions/whatsapp/index.ts for notes on the import layout.

import { createOwnerHandler } from "../../../server/owner/handler.ts";
import { withOwnerAuth } from "../../../server/owner/auth.ts";
import { createWhatsAppSender } from "../../../server/whatsapp/client.ts";
import { createInstagramSender } from "../../../server/instagram/client.ts";
import { SupabaseStore } from "../../../server/agent/supabase-store.ts";
import { demoProducts } from "../../../src/lib/plan.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;

const store = new SupabaseStore({
  url: env("SUPABASE_URL") ?? "",
  serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
});
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
