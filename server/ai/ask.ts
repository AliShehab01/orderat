// Gemini call for "Ask Orderat" (docs/ask-orderat.md): a seller's question, her conversation history
// and a business snapshot her phone computed, answered from that snapshot only. Shares model
// fallback + timeout handling with the order extractor via callGemini (gemini.ts) — see that file
// for why the loop looks the way it does (busy/retired/hung models). Callers never see raw Gemini
// errors: every failure here is wrapped in GeminiAskError, so server/ask/handler.ts can map any of
// them to the spec's single 502 { error: "ai_unavailable" }.

import { callGemini, DEFAULT_FALLBACK_MODELS, DEFAULT_MODEL, type GeminiConfig } from "./gemini.ts";

const DEFAULT_TIMEOUT_MS = 25000;

// Deliberately flat (no nested oneOf/union): Gemini's schema format has no clean way to express
// "one of these four shapes", so every field from every action type is optional here and
// server/ask/actions.ts validates the combination that actually matters for each `type` afterwards,
// dropping anything that doesn't fit rather than failing the whole answer.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING", description: "The reply shown to the seller, in the requested language, at most about 6 lines, formatted per the rules in the prompt." },
    actions: {
      type: "ARRAY",
      description: "Suggested actions the app can offer to perform locally. Omit or leave empty when none fit the question.",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["send_reminders", "add_expense", "draft_caption", "open_order"] },
          customerRefs: { type: "ARRAY", items: { type: "STRING" }, nullable: true, description: "send_reminders only: customer refs copied from the snapshot (topCustomers/unpaid), never invented." },
          amountMinor: { type: "INTEGER", nullable: true, description: "add_expense only: a positive integer in minor currency units." },
          category: { type: "STRING", nullable: true, description: "add_expense only: one of ingredients, packaging, delivery, ads, tools, rent, other." },
          note: { type: "STRING", nullable: true, description: "add_expense only: a short free-text note." },
          text: { type: "STRING", nullable: true, description: "draft_caption only: the drafted post text." },
          orderRef: { type: "STRING", nullable: true, description: "open_order only: an order ref copied from the snapshot (unpaid/upcoming), never invented." },
        },
        required: ["type"],
      },
    },
  },
  required: ["answer"],
};

/** Wraps every failure mode of askGemini (network/model failure, non-JSON response, a schema-shaped
 * but empty answer) so callers can treat "Gemini didn't work" as one case, per docs/ask-orderat.md's
 * single 502 `ai_unavailable`. */
export class GeminiAskError extends Error {}

export interface RawAskAnswer {
  answer: string;
  /** Not yet validated against the allowed types or the snapshot's refs — see server/ask/actions.ts. */
  actions: unknown[];
}

export interface AskGeminiResult {
  answer: RawAskAnswer;
  model: string;
}

/**
 * Calls Gemini with `prompt` (built by server/ask/prompt.ts) and returns its answer plus which model
 * produced it (logged by the caller — never the prompt or the answer text itself, per
 * docs/ask-orderat.md's logging rule).
 */
export async function askGemini(cfg: GeminiConfig, prompt: string, fetchImpl: typeof fetch = fetch): Promise<AskGeminiResult> {
  const models = [cfg.model ?? DEFAULT_MODEL, ...(cfg.fallbackModels ?? DEFAULT_FALLBACK_MODELS)];
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
  });

  let model: string;
  let raw: string;
  try {
    const result = await callGemini(models, cfg.apiKey, body, timeoutMs, fetchImpl);
    model = result.model;
    raw = result.text;
  } catch (err) {
    throw new GeminiAskError(err instanceof Error ? err.message : String(err));
  }

  let parsed: { answer?: unknown; actions?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new GeminiAskError(`Gemini returned an answer from ${model} that is not JSON`);
  }
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    throw new GeminiAskError(`Gemini returned no answer text from ${model}`);
  }
  return { answer: { answer: parsed.answer, actions: Array.isArray(parsed.actions) ? parsed.actions : [] }, model };
}
