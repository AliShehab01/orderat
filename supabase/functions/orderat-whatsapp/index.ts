// Supabase Edge Function entry point for the WhatsApp Cloud API webhook.
// Deployed as: supabase functions deploy whatsapp --use-api
// Callback URL for Meta: https://<project-ref>.supabase.co/functions/v1/whatsapp
//
// This is a thin Deno.serve wrapper: all the actual logic (signature check, parsing, the agent,
// storage) is the same TypeScript under server/ and src/lib/ that server/dev.ts runs locally —
// imported here by relative path with explicit .ts extensions, which both Deno and tsx/vitest/tsc
// resolve (see tsconfig.json's allowImportingTsExtensions). `--use-api` bundles this the same way
// Supabase's own docs show for importing a sibling folder outside supabase/ in a monorepo; it is
// newer/less battle-tested than the Docker path, and local `supabase functions serve` still needs
// Docker regardless — see the "Hosting on Supabase" section of README.md for the tradeoffs and the
// _shared/ fallback if a real deploy ever hits the bundler issue this flag has been reported to
// have with outside imports.

import { createWebhookHandler } from "../../../server/whatsapp/webhook.ts";
import { createWhatsAppSender } from "../../../server/whatsapp/client.ts";
import { createMediaReader } from "../../../server/whatsapp/media.ts";
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

const token = env("WHATSAPP_TOKEN");
const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
const dryRun = env("WHATSAPP_DRY_RUN") === "1";
const send = createWhatsAppSender({ token: token ?? "", phoneNumberId: phoneNumberId ?? "", apiVersion: env("WHATSAPP_API_VERSION"), dryRun });
const readMedia = token ? createMediaReader({ token, apiVersion: env("WHATSAPP_API_VERSION") }) : undefined;

const geminiKey = env("GEMINI_API_KEY");
const fallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const extractor = geminiKey ? createGeminiExtractor({ apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels }) : undefined;

// Keep the isolate alive for background work after the response is sent (Meta needs its 200 fast).
// Falls back to letting runAfterResponse await the work inline before responding when
// EdgeRuntime.waitUntil isn't available (e.g. running this same file under Deno outside Supabase).
const defer = typeof EdgeRuntime !== "undefined" ? (work: Promise<void>) => EdgeRuntime!.waitUntil(work) : undefined;

const handler = createWebhookHandler({
  verifyToken: env("WHATSAPP_VERIFY_TOKEN") ?? "",
  appSecret: env("WHATSAPP_APP_SECRET"),
  allowUnsigned: env("WHATSAPP_ALLOW_UNSIGNED") === "1",
  send,
  store,
  products,
  extractor,
  readMedia,
  defer,
});

Deno.serve((req) => handler(req));
