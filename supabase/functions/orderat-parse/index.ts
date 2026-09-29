// Supabase Edge Function entry point for AI order entry (docs/sme-phase-2-cloud.md's "AI order
// entry"). Deployed as: npm run hosting:deploy -- orderat-parse
// (supabase functions deploy orderat-parse --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-parse
//
// Called directly by the iPhone/Android apps and by the browser web app at
// https://orderatweb.com/app/, like orderat-ask/orderat-studio — no session. The handler is
// wrapped with withAppCors (server/shared/cors.ts), which allows the site's origins (and localhost for
// development) and leaves the phones, which send no Origin header, exactly as they were. All the
// actual logic (body validation, image checks, phone stripping, rate limiting, the Gemini call) is the
// same server/parse/handler.ts a test can exercise directly; this file only wires it to real
// dependencies. See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout,
// --use-api and the orderat- / ORDERAT_ prefixing this shares with the other functions.

import { createParseHandler } from "../../../server/parse/handler.ts";
import { withAppCors } from "../../../server/shared/cors.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const sql = getSqlClient(env("DATABASE_URL") ?? "");

// GEMINI_API_KEY/GEMINI_MODEL/GEMINI_FALLBACK_MODELS are the same settings server/dev.ts and every
// other Gemini-backed function here already read (server/ai/gemini.ts's createGeminiExtractor is the
// exact one the web/agent order reader uses) — reused as-is, not duplicated under an ORDERAT_PARSE_
// prefix.
const geminiKey = env("GEMINI_API_KEY");
const fallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const gemini = geminiKey ? { apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels } : undefined;

// docs/sme-phase-2-cloud.md: global cap default 5000 (server/usage/feature-limits.ts's
// DEFAULT_PARSE_LIMITS) when unset or not a positive integer.
const dailyCapRaw = env("PARSE_DAILY_CAP");
const dailyCap = dailyCapRaw && /^\d+$/.test(dailyCapRaw) ? Number(dailyCapRaw) : undefined;

const handler = withAppCors(createParseHandler({ sql, gemini, limits: dailyCap ? { globalCap: dailyCap } : undefined }));

Deno.serve((req) => handler(req));
