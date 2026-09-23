// Supabase Edge Function entry point for the Instagram messaging webhook.
// Deployed as: supabase functions deploy instagram --use-api
// Callback URL for Meta: https://<project-ref>.supabase.co/functions/v1/instagram
// See supabase/functions/whatsapp/index.ts for notes on the import layout and --use-api.

import { createInstagramWebhookHandler } from "../../../server/instagram/webhook.ts";
import { createInstagramSender, createUrlReader } from "../../../server/instagram/client.ts";
import { createGeminiExtractor } from "../../../server/ai/gemini.ts";
import { SupabaseStore } from "../../../server/agent/supabase-store.ts";
import { demoProducts } from "../../../src/lib/plan.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;

const store = new SupabaseStore({
  url: env("SUPABASE_URL") ?? "",
  serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
});
const products = demoProducts();

const igToken = env("INSTAGRAM_ACCESS_TOKEN");
const igSend = igToken ? createInstagramSender({ token: igToken, apiVersion: env("INSTAGRAM_API_VERSION") }) : undefined;
// "all", or a comma-separated list of Instagram-scoped user IDs. Empty/unset = observe only, so a
// real business account never auto-answers real customers before this is deliberately opened up.
const igReplyRaw = env("INSTAGRAM_REPLY_TO") ?? "";
const replyTo: "all" | string[] = igReplyRaw === "all" ? "all" : igReplyRaw.split(",").map((x) => x.trim()).filter(Boolean);

const geminiKey = env("GEMINI_API_KEY");
const fallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const extractor = geminiKey ? createGeminiExtractor({ apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels }) : undefined;

const defer = typeof EdgeRuntime !== "undefined" ? (work: Promise<void>) => EdgeRuntime!.waitUntil(work) : undefined;

const handler = createInstagramWebhookHandler({
  verifyToken: env("INSTAGRAM_VERIFY_TOKEN") ?? env("WHATSAPP_VERIFY_TOKEN") ?? "",
  appSecret: env("INSTAGRAM_APP_SECRET"),
  allowUnsigned: env("INSTAGRAM_ALLOW_UNSIGNED") === "1" || env("WHATSAPP_ALLOW_UNSIGNED") === "1",
  store,
  products,
  send: igSend,
  replyTo,
  extractor,
  readUrl: createUrlReader(),
  defer,
});

Deno.serve((req) => handler(req));
