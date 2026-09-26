// HTTP handler for "Ask Orderat" (docs/ask-orderat.md). A thin Deno.serve wrapper
// (supabase/functions/orderat-ask/index.ts) wires this to real deps — same shape as
// server/whatsapp/webhook.ts and server/owner/handler.ts: this file is plain Request/Response so it
// runs the same under Deno, Node or a test.
//
// Order of work, matching the spec: validate the body (never counted against a limit if invalid) ->
// check the Gemini key is configured -> check + record the per-install and global limits (before
// calling Gemini, so a rejected request never pays for a model call) -> build the prompt -> call
// Gemini -> validate its actions against the snapshot -> respond. Every response is JSON; every
// error path returns the exact shape docs/ask-orderat.md specifies.

import type { SqlClient } from "../agent/postgres-store.ts";
import { askGemini, GeminiAskError } from "../ai/ask.ts";
import type { GeminiConfig } from "../ai/gemini.ts";
import { collectSnapshotRefs, validateActions } from "./actions.ts";
import { checkAndRecordUsage, DEFAULT_LIMITS, type AskLimits } from "./limits.ts";
import { buildAskPrompt } from "./prompt.ts";
import { validateAskBody } from "./validate.ts";

export interface AskHandlerDeps {
  sql: SqlClient;
  /** Undefined when ORDERAT_GEMINI_API_KEY isn't set — every request then gets 502 ai_unavailable. */
  gemini?: GeminiConfig;
  limits?: Partial<AskLimits>;
  now?: () => Date;
  /** Structured, PII-free log line per request — see the module comment on what it logs and why. */
  log?: (entry: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const aiUnavailableResponse = () => jsonResponse({ error: "ai_unavailable" }, 502);

export function createAskHandler(deps: AskHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());
  const limits: AskLimits = { ...DEFAULT_LIMITS, ...deps.limits };

  return async (req) => {
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateAskBody(raw);
    if (!validated.ok) {
      log({ event: "ask", status: 400 });
      return invalidBodyResponse();
    }
    const body = validated.body;

    if (!deps.gemini?.apiKey) {
      log({ event: "ask", status: 502, reason: "not_configured" });
      return aiUnavailableResponse();
    }

    const usage = await checkAndRecordUsage(deps.sql, { installId: body.installId, demo: body.demo, now: now(), limits });
    if (!usage.ok) {
      log({ event: "ask", status: 429, reason: usage.reason });
      return jsonResponse({ error: usage.reason }, 429);
    }

    const prompt = buildAskPrompt(body);
    const started = Date.now();
    try {
      const { answer, model } = await askGemini(deps.gemini, prompt, deps.fetchImpl);
      const refs = collectSnapshotRefs(body.snapshot);
      const actions = validateActions(answer.actions, refs);
      log({ event: "ask", status: 200, model, latencyMs: Date.now() - started, actionCount: actions.length });
      return jsonResponse({ answer: answer.answer, actions, remainingToday: usage.remainingToday }, 200);
    } catch (err) {
      log({ event: "ask", status: 502, latencyMs: Date.now() - started, reason: err instanceof GeminiAskError ? "gemini_error" : "unexpected_error" });
      return aiUnavailableResponse();
    }
  };
}
