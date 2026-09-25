// Supabase Edge Function entry point for the Instagram messaging webhook.
// Deployed as: npm run hosting:deploy (supabase functions deploy orderat-instagram --use-api)
// Callback URL for Meta: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-instagram
// See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout, --use-api and the
// orderat- / ORDERAT_ prefixing.

import { createInstagramWebhookHandler } from "../../../server/instagram/webhook.ts";
import { createInstagramSender, createUrlReader } from "../../../server/instagram/client.ts";
import { instagramAllowUnsigned } from "../../../server/instagram/config.ts";
import { createGeminiExtractor } from "../../../server/ai/gemini.ts";
import { PostgresStore } from "../../../server/agent/postgres-store.ts";
import { demoProducts } from "../../../src/lib/plan.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const store = new PostgresStore(getSqlClient(env("DATABASE_URL") ?? ""));
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
  allowUnsigned: instagramAllowUnsigned(env),
  store,
  products,
  send: igSend,
  replyTo,
  extractor,
  readUrl: createUrlReader(),
  defer,
});

Deno.serve((req) => handler(req));
