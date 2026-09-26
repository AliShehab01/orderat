// Supabase Edge Function entry point for the AI captions + photo studio tasks
// (docs/marketing-tools.md, "A. Occasion campaigns" > "AI captions" and "B. Photo studio").
// Deployed as: npm run hosting:deploy -- orderat-studio (supabase functions deploy orderat-studio --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-studio
//
// Called directly by the iPhone/Android apps (not a browser — no CORS here, unlike orderat-campaigns
// and orderat-shop). All the actual logic (body validation, content lookups, rate limiting, both
// Gemini calls) is the same server/studio/handler.ts a test can exercise directly; this file only
// wires it to real dependencies. See supabase/functions/orderat-whatsapp/index.ts for notes on the
// import layout, --use-api and the orderat- / ORDERAT_ prefixing this shares with the other
// functions.
//
// content/campaigns.json and content/studio-styles.json are imported with Deno's
// `with { type: "json" }` import attribute — see server/campaigns/content.ts's header for why.

import campaignsFile from "../../../content/campaigns.json" with { type: "json" };
import studioStylesFile from "../../../content/studio-styles.json" with { type: "json" };
import type { Campaign, StudioStyle } from "../../../server/campaigns/content.ts";
import { createStudioHandler } from "../../../server/studio/handler.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const sql = getSqlClient(env("DATABASE_URL") ?? "");

const geminiKey = env("GEMINI_API_KEY");
const textFallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const text = geminiKey ? { apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels: textFallbackModels } : undefined;

const imageFallbackModels = env("IMAGE_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const image = geminiKey ? { apiKey: geminiKey, model: env("IMAGE_MODEL"), fallbackModels: imageFallbackModels } : undefined;

// docs/marketing-tools.md: defaults (server/usage/feature-limits.ts's DEFAULT_CAPTION_LIMITS /
// DEFAULT_PHOTO_LIMITS) apply when unset or not a positive integer.
function parseCap(raw: string | undefined): number | undefined {
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
}
const captionDailyCap = parseCap(env("CAPTION_DAILY_CAP"));
const photoDailyCap = parseCap(env("PHOTO_DAILY_CAP"));

const handler = createStudioHandler({
  sql,
  text,
  image,
  campaigns: campaignsFile.campaigns as Campaign[],
  styles: studioStylesFile.styles as StudioStyle[],
  captionLimits: captionDailyCap ? { globalCap: captionDailyCap } : undefined,
  photoLimits: photoDailyCap ? { globalCap: photoDailyCap } : undefined,
});

Deno.serve((req) => handler(req));
