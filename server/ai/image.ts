// Gemini image generation for the photo studio (docs/marketing-tools.md: "B. Photo studio"). A
// sibling of server/ai/gemini.ts's callGemini (text): same model-fallback/timeout loop
// (requestGemini), same API shape (a `generateContent` POST, the key in a header, never the URL),
// but this reads an `inlineData` image part out of the response instead of a text part, and separates
// "every model failed at the transport level" (ai_unavailable) from "a model answered but blocked or
// omitted the image" (unsafe_image) into two distinct error types, since server/studio/photo.ts maps
// them to two different HTTP statuses (502 vs 422) per the spec's error table.

import { requestGemini } from "./gemini.ts";
import { decodeBase64 } from "../shared/image.ts";

/** Every model in the fallback chain failed at the transport level (429/5xx on all of them, every
 * model retired, or every attempt timed out) — docs/marketing-tools.md's 502 `ai_unavailable`. */
export class GeminiImageUnavailableError extends Error {}

/** A model answered, but Gemini's safety filter blocked the request or the response contains no
 * image part — docs/marketing-tools.md's 422 `unsafe_image`. */
export class GeminiImageBlockedError extends Error {}

export interface GeminiImagePart {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
}

export interface GeminiImageResult {
  /** The model that produced the image — the first one in the list that returned an image part. */
  model: string;
  mimeType: string;
  data: Uint8Array;
}

interface GeminiImageResponseBody {
  candidates?: { content?: { parts?: GeminiImagePart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * POSTs a Gemini `generateContent` body (built by server/studio/photo.ts: the input photo as an
 * `inlineData` part plus the style prompt as a `text` part, with
 * `generationConfig.responseModalities: ["IMAGE"]`) to `models` in order via requestGemini, and
 * returns the first `inlineData` image part found in the response. Throws GeminiImageUnavailableError
 * when every model failed at the transport level, or GeminiImageBlockedError when a model answered
 * with no image (Gemini's safety filter, or simply no image in the output).
 */
export async function callGeminiImage(models: string[], apiKey: string, body: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<GeminiImageResult> {
  const { res, okModel, failures } = await requestGemini(models, apiKey, body, timeoutMs, fetchImpl);
  if (!res || !res.ok) {
    const detail = res ? (await res.text()).slice(0, 300) : "";
    throw new GeminiImageUnavailableError(`Gemini image request failed (${failures.join(", ")}): ${detail}`);
  }

  const bodyText = await res.text();
  let responseData: GeminiImageResponseBody;
  try {
    responseData = JSON.parse(bodyText) as GeminiImageResponseBody;
  } catch {
    throw new GeminiImageUnavailableError(`Gemini image response from ${okModel} (${res.status}) was not JSON`);
  }

  const candidate = responseData.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p) => typeof p.inlineData?.data === "string" && p.inlineData.data.length > 0);
  if (!imagePart?.inlineData?.data) {
    const reason = responseData.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no image in the response";
    throw new GeminiImageBlockedError(`Gemini returned no image from ${okModel} (${reason})`);
  }

  const data = decodeBase64(imagePart.inlineData.data);
  if (!data) throw new GeminiImageBlockedError(`Gemini returned an image from ${okModel} that could not be decoded`);

  return { model: okModel!, mimeType: imagePart.inlineData.mimeType || "image/png", data };
}
