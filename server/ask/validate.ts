// Request body validation for "Ask Orderat" (docs/ask-orderat.md). Deliberately strict and
// type-only: the phone is trusted to compute its own snapshot correctly ("the app does the math"),
// so this never re-derives business numbers — it only bounds size/shape so a malformed or hostile
// body can't reach Gemini or the rate limiter. Every failure is the same 400 `invalid_body`; the
// spec doesn't distinguish reasons for a 400, so there is nothing more specific to return.

/** ~64 KB, per docs/ask-orderat.md. Measured in UTF-8 bytes (the wire size), not UTF-16 code units,
 * since the body is mostly Arabic/English seller text and JSON. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY_TURNS = 6;
const MAX_QUESTION_CHARS = 500;
const MAX_INSTALL_ID_CHARS = 200;
const MAX_APP_VERSION_CHARS = 32;

export type Lang = "ar" | "en";
export type Platform = "ios" | "android";
export type HistoryRole = "user" | "assistant";

export interface HistoryTurn {
  role: HistoryRole;
  text: string;
}

export interface AskRequestBody {
  installId: string;
  platform: Platform;
  appVersion: string;
  lang: Lang;
  demo: boolean;
  question: string;
  history: HistoryTurn[];
  /** Not validated field-by-field here — see server/ask/actions.ts for the parts of it (refs) that
   * later matter, and server/ask/prompt.ts for how it's handed to Gemini. */
  snapshot: Record<string, unknown>;
}

export type AskValidationResult = { ok: true; body: AskRequestBody } | { ok: false; error: "invalid_body" };

function invalid(): AskValidationResult {
  return { ok: false, error: "invalid_body" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength;
}

function parseHistory(value: unknown): HistoryTurn[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_TURNS) return undefined;
  const turns: HistoryTurn[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return undefined;
    if (item.role !== "user" && item.role !== "assistant") return undefined;
    if (typeof item.text !== "string") return undefined;
    turns.push({ role: item.role, text: item.text });
  }
  return turns;
}

/**
 * Validates a raw request body (the request's text, not yet parsed) against
 * docs/ask-orderat.md's shape: sizes (the ~64 KB body cap, the 6-turn history cap, the 1-500 char
 * question), and types (every field's expected type/enum). Returns the parsed, narrowed body on
 * success so callers never need to re-check what this already checked.
 */
export function validateAskBody(raw: string): AskValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return invalid();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  const { installId, platform, appVersion, lang, demo, question, history, snapshot } = json;

  if (!isNonEmptyString(installId, MAX_INSTALL_ID_CHARS)) return invalid();
  if (platform !== "ios" && platform !== "android") return invalid();
  if (!isNonEmptyString(appVersion, MAX_APP_VERSION_CHARS)) return invalid();
  if (lang !== "ar" && lang !== "en") return invalid();
  if (demo !== undefined && typeof demo !== "boolean") return invalid();
  if (!isNonEmptyString(question, MAX_QUESTION_CHARS)) return invalid();
  if (!isPlainObject(snapshot)) return invalid();

  const parsedHistory = parseHistory(history);
  if (parsedHistory === undefined) return invalid();

  return {
    ok: true,
    body: {
      installId,
      platform,
      appVersion,
      lang,
      demo: demo === true,
      question,
      history: parsedHistory,
      snapshot,
    },
  };
}

export { MAX_BODY_BYTES, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS };
