// Supabase Edge Function entry point for "Ask Orderat" (docs/ask-orderat.md).
// Deployed as: npm run hosting:deploy (supabase functions deploy orderat-ask --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-ask
//
// Called directly by the iPhone/Android apps (not a Meta webhook), with `apikey` +
// `Authorization: Bearer <anon key>` like the other orderat functions — see
// supabase/functions/orderat-whatsapp/index.ts for notes on the import layout, --use-api and the
// orderat- / ORDERAT_ prefixing this shares with the other three functions. All the actual logic
// (body validation, rate limiting, the Gemini call, action validation) is the same
// server/ask/handler.ts a test can exercise directly; this file only wires it to real dependencies.

import { createAskHandler } from "../../../server/ask/handler.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const sql = getSqlClient(env("DATABASE_URL") ?? "");

const geminiKey = env("GEMINI_API_KEY");
const fallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const gemini = geminiKey ? { apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels } : undefined;

// docs/ask-orderat.md: defaults to 3000 (server/ask/limits.ts's DEFAULT_LIMITS) when unset or not a
// positive integer.
const dailyCapRaw = env("ASK_DAILY_CAP");
const dailyCap = dailyCapRaw && /^\d+$/.test(dailyCapRaw) ? Number(dailyCapRaw) : undefined;

const handler = createAskHandler({
  sql,
  gemini,
  limits: dailyCap ? { globalCap: dailyCap } : undefined,
});

Deno.serve((req) => handler(req));
