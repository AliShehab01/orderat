// Gemini call for orderat-studio's photo task (docs/marketing-tools.md's "B. Photo studio"). Builds
// the generateContent body (the seller's product photo as an inlineData part, the style prompt as a
// text part, `generationConfig.responseModalities: ["IMAGE"]` + `imageConfig.aspectRatio`) and calls
// callGeminiImage (server/ai/image.ts) for the model-fallback/timeout loop + image extraction.
// GeminiImageBlockedError/GeminiImageUnavailableError propagate unchanged — server/studio/handler.ts
// is what maps them to 422 `unsafe_image` / 502 `ai_unavailable`, per the spec's error table.

import { callGeminiImage } from "../ai/image.ts";
import type { GeminiConfig } from "../ai/gemini.ts";
import { encodeBase64 } from "../shared/image.ts";
import { buildPhotoPrompt } from "./photo-prompt.ts";
import type { Aspect } from "./validate.ts";

/** docs/marketing-tools.md's defaults, and a 60s timeout (longer than the text models' 25s — image
 * generation is slower). Callers (server/studio/handler.ts, wired from env in
 * supabase/functions/orderat-studio/index.ts) normally override `model`/`fallbackModels` from
 * ORDERAT_IMAGE_MODEL/ORDERAT_IMAGE_FALLBACK_MODELS; these only apply when those are unset. */
export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
export const DEFAULT_IMAGE_FALLBACK_MODELS = ["gemini-2.5-flash-image"];
const DEFAULT_TIMEOUT_MS = 60000;

export interface GeneratedPhoto {
  mimeType: string;
  /** Base64, ready to put straight into the JSON response. */
  data: string;
  model: string;
}

/**
 * Calls Gemini's image model with the input product photo (`image`, already decoded, size-checked
 * and magic-number sniffed by server/studio/handler.ts) and the resolved style's prompt, and returns
 * the generated image.
 */
export async function generatePhoto(
  gemini: GeminiConfig,
  image: { mimeType: string; data: Uint8Array },
  stylePrompt: string,
  aspect: Aspect,
  fetchImpl: typeof fetch = fetch,
): Promise<GeneratedPhoto> {
  const models = [gemini.model ?? DEFAULT_IMAGE_MODEL, ...(gemini.fallbackModels ?? DEFAULT_IMAGE_FALLBACK_MODELS)];
  const timeoutMs = gemini.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestBody = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: image.mimeType, data: encodeBase64(image.data) } },
        { text: buildPhotoPrompt(stylePrompt) },
      ],
    }],
    // aspect ("1:1" | "4:5" | "9:16") is already the "W:H" string form Gemini's imageConfig.aspectRatio
    // takes, so it's passed straight through with no reformatting.
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
  });

  const result = await callGeminiImage(models, gemini.apiKey, requestBody, timeoutMs, fetchImpl);
  return { mimeType: result.mimeType, data: encodeBase64(result.data), model: result.model };
}
