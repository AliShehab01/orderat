// HTTP handler for orderat-parse (docs/sme-phase-2-cloud.md's "AI order entry"). Plain
// Request -> Response, like server/ask/handler.ts and server/studio/handler.ts, so it runs the same
// under Deno, Node or a test; supabase/functions/orderat-parse/index.ts only wires in env.
//
// Unlike server/auth and server/sync, this action needs no signed-in session at all — the spec's own
// build order says AI order entry ships "independent of accounts" and is limited the same way as the
// marketing tools' AI features, via server/usage/feature-limits.ts's generic ledger: per install, and,
// since the security review of 1 Oct 2026 (F02), per client IP — or, when the call does carry a valid
// X-Orderat-Session, per account instead (server/usage/trusted-limits.ts).
//
// `lang`/`addressAs` are accepted in the body (docs/sme-phase-2-cloud.md lists them as part of the
// input) and validated, but never handed to server/ai/gemini.ts's extractor: that extractor already
// detects the message's own language itself (`AiResult.lang`) and has no notion of how the seller
// should be addressed, so these two exist for the caller's own bookkeeping/analytics rather than to
// change how the model is called.
//
// Order of work, matching server/studio/handler.ts's photo task: validate the body -> decode/size/
// magic-check the image, if any -> check the Gemini key is configured -> check + record the
// per-install/global "parse" limit (before calling Gemini, so a rejected request never pays for a
// model call) -> strip phone numbers from the text -> call the extractor -> respond.

import type { Product } from "../../src/lib/types.ts";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createGeminiExtractor, type GeminiConfig } from "../ai/gemini.ts";
import { decodeBase64, sniffImageMimeType } from "../shared/image.ts";
import { checkAndRecordFeatureUsage, DEFAULT_PARSE_LIMITS, type FeatureLimits } from "../usage/feature-limits.ts";
import { identifyAiCaller } from "../usage/trusted-limits.ts";
import { stripPhoneNumbers } from "./phone.ts";
import { validateParseBody, type ParseRequestBody } from "./validate.ts";

/** docs/sme-phase-2-cloud.md: "one screenshot image (JPEG/PNG, at most 2 MB)". */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ParseHandlerDeps {
  sql: SqlClient;
  /** The salt a client IP is hashed with before it keys a per-IP limit (server/usage/trusted-limits.ts)
   * — the same ORDERAT_AUTH_IP_SALT orderat-auth uses. */
  ipSalt: string;
  /** Undefined when ORDERAT_GEMINI_API_KEY isn't set — every request then gets 502 ai_unavailable,
   * the same convention as server/ask/handler.ts's and server/studio/handler.ts's `text`/`image`. */
  gemini?: GeminiConfig;
  limits?: Partial<FeatureLimits>;
  now?: () => Date;
  /** Structured, content-free log line per request — never the message text, an image, a product
   * list, or the draft itself. */
  log?: (entry: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const aiUnavailableResponse = () => jsonResponse({ error: "ai_unavailable" }, 502);

/** The app sends only (id, name, aliases) plus an optional nameAr (docs/sme-phase-2-cloud.md: "the
 * shop's product list (id, name, aliases)"); server/ai/gemini.ts's Product also wants a `nameAr` and
 * `packaging`, neither used by the parts of it this handler exercises (buildPrompt reads `nameAr` for
 * the menu line it shows the model, toDraft never touches `packaging` at all) — nameAr falls back to
 * the English name when the app doesn't send one, and packaging is always empty. */
function toGeminiProduct(p: ParseRequestBody["products"][number]): Product {
  return { id: p.id, name: p.name, nameAr: p.nameAr ?? p.name, aliases: p.aliases, packaging: [] };
}

export function createParseHandler(deps: ParseHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limits: FeatureLimits = { ...DEFAULT_PARSE_LIMITS, ...deps.limits };

  return async (req) => {
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateParseBody(raw);
    if (!validated.ok) {
      log({ event: "parse", status: validated.error === "too_large" ? 413 : 400 });
      return validated.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
    }
    const body = validated.body;

    let media: { data: Uint8Array; mimeType: string } | undefined;
    if (body.image) {
      const bytes = decodeBase64(body.image.data);
      if (!bytes) {
        log({ event: "parse", status: 400, reason: "bad_base64" });
        return invalidBodyResponse();
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        log({ event: "parse", status: 413 });
        return tooLargeResponse();
      }
      // Never trust the declared mimeType — it must match what the bytes actually are.
      const sniffed = sniffImageMimeType(bytes);
      if (!sniffed || sniffed !== body.image.mimeType) {
        log({ event: "parse", status: 400, reason: "mime_mismatch" });
        return invalidBodyResponse();
      }
      media = { data: bytes, mimeType: sniffed };
    }

    if (!deps.gemini?.apiKey) {
      log({ event: "parse", status: 502, reason: "not_configured" });
      return aiUnavailableResponse();
    }

    const at = now();
    const caller = await identifyAiCaller(deps.sql, req, { ipSalt: deps.ipSalt, now: at });
    const usage = await checkAndRecordFeatureUsage(deps.sql, { feature: "parse", caller, installId: body.installId, demo: body.demo, now: at, limits });
    if (!usage.ok) {
      log({ event: "parse", status: 429, caller: caller.kind, reason: usage.reason });
      return jsonResponse({ error: usage.reason }, 429);
    }

    const text = body.text !== undefined ? stripPhoneNumbers(body.text) : undefined;
    const products = body.products.map(toGeminiProduct);
    const extract = createGeminiExtractor(deps.gemini, fetchImpl);

    const started = Date.now();
    try {
      const result = await extract({ text, media, products, now: at });
      log({ event: "parse", status: 200, caller: caller.kind, latencyMs: Date.now() - started, hasImage: !!media, itemCount: result.draft.items.length });
      return jsonResponse({ draft: result.draft, lang: result.lang, remainingToday: usage.remainingToday }, 200);
    } catch (err) {
      log({ event: "parse", status: 502, latencyMs: Date.now() - started, reason: "gemini_error", detail: err instanceof Error ? err.message : String(err) });
      return aiUnavailableResponse();
    }
  };
}
