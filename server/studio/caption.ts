// Gemini call for orderat-studio's caption task (docs/marketing-tools.md). Shares model
// fallback/timeout handling with the order extractor and Ask Orderat via callGemini
// (server/ai/gemini.ts) — same default text model chain (DEFAULT_MODEL/DEFAULT_FALLBACK_MODELS) as
// Ask Orderat, per the spec. Callers never see raw Gemini errors: every failure here is wrapped in
// GeminiCaptionError, so server/studio/handler.ts can map any of them to the spec's 502
// `ai_unavailable`.

import { callGemini, DEFAULT_FALLBACK_MODELS, DEFAULT_MODEL, type GeminiConfig } from "../ai/gemini.ts";
import type { Campaign } from "../campaigns/content.ts";
import { buildCaptionPrompt } from "./caption-prompt.ts";
import type { CaptionRequestBody } from "./validate.ts";

const DEFAULT_TIMEOUT_MS = 25000;
/** docs/marketing-tools.md: "exactly 3 caption variants", "each under 600 characters", "hashtags
 * start with #, max 12". */
const REQUIRED_CAPTIONS = 3;
const MAX_CAPTION_CHARS = 600;
const MAX_HASHTAGS = 12;

// Deliberately flat, like server/ai/ask.ts's own schema — Gemini's schema format has no clean way to
// express more structure than this, and there's nothing more structured to express here anyway.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    captions: { type: "ARRAY", items: { type: "STRING" }, description: "Exactly 3 different caption variants, each a complete, ready-to-post caption." },
    hashtags: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 12 hashtags, each starting with #, no spaces." },
  },
  required: ["captions", "hashtags"],
};

/** Wraps every failure mode of generateCaptions (network/model failure, non-JSON response, an
 * answer with fewer than 3 usable captions) so callers can treat "Gemini didn't work" as one case,
 * per docs/marketing-tools.md's single 502 `ai_unavailable`. */
export class GeminiCaptionError extends Error {}

export interface CaptionResult {
  /** Exactly 3 captions, each already trimmed to at most 600 characters. */
  captions: string[];
  /** At most 12 hashtags, each starting with "#". May be empty. */
  hashtags: string[];
  model: string;
}

/** Keeps only non-empty strings, trims each to the 600-char cap, and requires at least 3 to remain —
 * an answer with fewer is treated as unusable (GeminiCaptionError) rather than silently padded,
 * since inventing a 3rd caption isn't this function's job. Extra captions beyond 3 are dropped. */
function trimCaptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const captions = raw
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim().slice(0, MAX_CAPTION_CHARS));
  if (captions.length < REQUIRED_CAPTIONS) return undefined;
  return captions.slice(0, REQUIRED_CAPTIONS);
}

/** Keeps only strings that actually look like a hashtag, capped at 12 — an answer with too many or
 * malformed hashtags is trimmed, never a reason to fail the whole request (captions are the point). */
function trimHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string" && /^#\S+$/.test(h)).slice(0, MAX_HASHTAGS);
}

/**
 * Calls Gemini for one caption request (`body`, already validated by server/studio/validate.ts) and
 * returns exactly 3 trimmed captions plus up to 12 hashtags. `campaign` is the looked-up
 * content/campaigns.json entry for `body.campaignId` when it matched a known campaign, or undefined
 * when it was omitted or unknown (docs/marketing-tools.md: "unknown ids are ignored").
 */
export async function generateCaptions(
  gemini: GeminiConfig,
  body: CaptionRequestBody,
  campaign: Campaign | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptionResult> {
  const models = [gemini.model ?? DEFAULT_MODEL, ...(gemini.fallbackModels ?? DEFAULT_FALLBACK_MODELS)];
  const timeoutMs = gemini.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: buildCaptionPrompt(body, campaign) }] }],
    // 0.9, per docs/marketing-tools.md — noticeably more creative than Ask Orderat's 0.2 (a factual
    // answer) or the order extractor's 0 (exact extraction): captions are meant to vary and read
    // naturally, not converge on one "correct" answer.
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.9 },
  });

  let model: string;
  let raw: string;
  try {
    const result = await callGemini(models, gemini.apiKey, requestBody, timeoutMs, fetchImpl);
    model = result.model;
    raw = result.text;
  } catch (err) {
    throw new GeminiCaptionError(err instanceof Error ? err.message : String(err));
  }

  let parsed: { captions?: unknown; hashtags?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new GeminiCaptionError(`Gemini returned an answer from ${model} that is not JSON`);
  }

  const captions = trimCaptions(parsed.captions);
  if (!captions) throw new GeminiCaptionError(`Gemini returned fewer than ${REQUIRED_CAPTIONS} usable captions from ${model}`);

  return { captions, hashtags: trimHashtags(parsed.hashtags), model };
}
