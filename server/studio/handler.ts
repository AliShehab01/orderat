// HTTP handler for orderat-studio (docs/marketing-tools.md, tasks "caption" and "photo"). Plain
// Request -> Response, like server/ask/handler.ts, so it runs the same under Deno, Node or a test;
// supabase/functions/orderat-studio/index.ts only wires in env + the content bundle.
//
// No CORS in this handler itself (unlike server/campaigns/handler.ts and server/shop/handler.ts):
// docs/marketing-tools.md has orderat-studio called by the iPhone/Android apps directly, and the
// browser web app is let in by supabase/functions/orderat-studio/index.ts wrapping it with
// server/shared/cors.ts's withAppCors.
//
// Order of work per task, matching server/ask/handler.ts: validate the body (never counted against a
// limit if invalid) -> resolve content (campaign/style; an unknown campaignId is silently ignored, an
// unknown styleId is a 400) -> check the relevant Gemini config is present -> check + record the
// caller's own limits (per account with a valid X-Orderat-Session, else per client IP and install —
// server/usage/trusted-limits.ts) and the global one (before calling Gemini, so a rejected request
// never pays for a model call) -> call Gemini -> respond. Every response is JSON; every error path
// returns the exact shape docs/marketing-tools.md specifies.

import type { SqlClient } from "../agent/postgres-store.ts";
import type { GeminiConfig } from "../ai/gemini.ts";
import { GeminiImageBlockedError } from "../ai/image.ts";
import { findCampaignById, findStyleById, type Campaign, type StudioStyle } from "../campaigns/content.ts";
import { decodeBase64, sniffImageMimeType } from "../shared/image.ts";
import { checkAndRecordFeatureUsage, DEFAULT_CAPTION_LIMITS, DEFAULT_PHOTO_LIMITS, type FeatureLimits } from "../usage/feature-limits.ts";
import { identifyAiCaller } from "../usage/trusted-limits.ts";
import { generateCaptions, GeminiCaptionError } from "./caption.ts";
import { generatePhoto } from "./photo.ts";
import { validateStudioBody, type CaptionRequestBody, type PhotoRequestBody } from "./validate.ts";

/** docs/marketing-tools.md: "at most 2 MB decoded" for the photo task's input image. */
const MAX_PHOTO_INPUT_BYTES = 2 * 1024 * 1024;

export interface StudioHandlerDeps {
  sql: SqlClient;
  /** The salt a client IP is hashed with before it keys a per-IP limit (server/usage/trusted-limits.ts)
   * — the same ORDERAT_AUTH_IP_SALT orderat-auth uses. */
  ipSalt: string;
  /** Text model config for captions — undefined when ORDERAT_GEMINI_API_KEY isn't set (every
   * caption request then gets 502 ai_unavailable). */
  text?: GeminiConfig;
  /** Image model config for photos — undefined when ORDERAT_GEMINI_API_KEY isn't set. Its own
   * model/fallbackModels normally come from ORDERAT_IMAGE_MODEL/ORDERAT_IMAGE_FALLBACK_MODELS, not
   * the text ones. */
  image?: GeminiConfig;
  campaigns: Campaign[];
  styles: StudioStyle[];
  captionLimits?: Partial<FeatureLimits>;
  photoLimits?: Partial<FeatureLimits>;
  now?: () => Date;
  /** Structured, content-free log line per request — never the prompt, captions, or image bytes. */
  log?: (entry: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const aiUnavailableResponse = () => jsonResponse({ error: "ai_unavailable" }, 502);
const unsafeImageResponse = () => jsonResponse({ error: "unsafe_image" }, 422);

export function createStudioHandler(deps: StudioHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const captionLimits: FeatureLimits = { ...DEFAULT_CAPTION_LIMITS, ...deps.captionLimits };
  const photoLimits: FeatureLimits = { ...DEFAULT_PHOTO_LIMITS, ...deps.photoLimits };

  async function handleCaption(req: Request, body: CaptionRequestBody): Promise<Response> {
    if (!deps.text?.apiKey) {
      log({ event: "studio_caption", status: 502, reason: "not_configured" });
      return aiUnavailableResponse();
    }

    const at = now();
    const caller = await identifyAiCaller(deps.sql, req, { ipSalt: deps.ipSalt, now: at });
    const usage = await checkAndRecordFeatureUsage(deps.sql, { feature: "caption", caller, installId: body.installId, demo: body.demo, now: at, limits: captionLimits });
    if (!usage.ok) {
      log({ event: "studio_caption", status: 429, caller: caller.kind, reason: usage.reason });
      return jsonResponse({ error: usage.reason }, 429);
    }

    // docs/marketing-tools.md: "campaignId optional (unknown ids are ignored)" — never a 400.
    const campaign = body.campaignId ? findCampaignById(deps.campaigns, body.campaignId) : undefined;
    const started = Date.now();
    try {
      const result = await generateCaptions(deps.text, body, campaign, fetchImpl);
      log({ event: "studio_caption", status: 200, caller: caller.kind, model: result.model, latencyMs: Date.now() - started });
      return jsonResponse({ captions: result.captions, hashtags: result.hashtags, remainingToday: usage.remainingToday }, 200);
    } catch (err) {
      log({ event: "studio_caption", status: 502, latencyMs: Date.now() - started, reason: err instanceof GeminiCaptionError ? "gemini_error" : "unexpected_error" });
      return aiUnavailableResponse();
    }
  }

  async function handlePhoto(req: Request, body: PhotoRequestBody): Promise<Response> {
    const style = findStyleById(deps.styles, body.styleId);
    if (!style) {
      log({ event: "studio_photo", status: 400, reason: "unknown_style" });
      return invalidBodyResponse();
    }

    const bytes = decodeBase64(body.image.data);
    if (!bytes) {
      log({ event: "studio_photo", status: 400, reason: "bad_base64" });
      return invalidBodyResponse();
    }
    if (bytes.length > MAX_PHOTO_INPUT_BYTES) {
      log({ event: "studio_photo", status: 413 });
      return tooLargeResponse();
    }
    // Never trust the declared mimeType — it must match what the bytes actually are.
    const sniffed = sniffImageMimeType(bytes);
    if (!sniffed || sniffed !== body.image.mimeType) {
      log({ event: "studio_photo", status: 400, reason: "mime_mismatch" });
      return invalidBodyResponse();
    }

    if (!deps.image?.apiKey) {
      log({ event: "studio_photo", status: 502, reason: "not_configured" });
      return aiUnavailableResponse();
    }

    const at = now();
    const caller = await identifyAiCaller(deps.sql, req, { ipSalt: deps.ipSalt, now: at });
    const usage = await checkAndRecordFeatureUsage(deps.sql, { feature: "photo", caller, installId: body.installId, demo: body.demo, now: at, limits: photoLimits });
    if (!usage.ok) {
      log({ event: "studio_photo", status: 429, caller: caller.kind, reason: usage.reason });
      return jsonResponse({ error: usage.reason }, 429);
    }

    const started = Date.now();
    try {
      const result = await generatePhoto(deps.image, { mimeType: sniffed, data: bytes }, style.prompt, body.aspect, fetchImpl);
      log({ event: "studio_photo", status: 200, caller: caller.kind, model: result.model, latencyMs: Date.now() - started });
      return jsonResponse({ image: { mimeType: result.mimeType, data: result.data }, remainingToday: usage.remainingToday }, 200);
    } catch (err) {
      if (err instanceof GeminiImageBlockedError) {
        log({ event: "studio_photo", status: 422, latencyMs: Date.now() - started });
        return unsafeImageResponse();
      }
      log({ event: "studio_photo", status: 502, latencyMs: Date.now() - started, reason: "gemini_error" });
      return aiUnavailableResponse();
    }
  }

  return async (req) => {
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateStudioBody(raw);
    if (!validated.ok) {
      log({ event: "studio", status: validated.error === "too_large" ? 413 : 400 });
      return validated.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
    }

    return validated.body.task === "caption" ? handleCaption(req, validated.body) : handlePhoto(req, validated.body);
  };
}
