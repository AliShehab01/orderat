// Request body validation for orderat-auth (docs/sme-phase-2-cloud.md's "Accounts"). Same philosophy
// as server/ask/validate.ts: deliberately strict and type-only — this never verifies the ID token
// itself (server/auth/verify-token.ts does that, with the provider's JWKS in hand); it only bounds
// size/shape so a malformed or hostile body can't reach the verifier or the database.

/** Generous for a real ID token (Apple's and Google's are typically under 2 KB) with room to spare;
 * every other action's body is tiny by comparison. */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ID_TOKEN_CHARS = 8000;
const MAX_NONCE_CHARS = 256;
const MAX_DEVICE_NAME_CHARS = 100;
/** Apple's authorization codes are short (well under 100 characters); this only bounds a hostile one. */
const MAX_AUTHORIZATION_CODE_CHARS = 1024;
/** A poll token is 43 characters (32 random bytes, base64url); anything far longer is not one. */
const MAX_POLL_TOKEN_CHARS = 128;
const PAIR_CODE_RE = /^\d{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SigninBody {
  action: "signin";
  provider: "apple" | "google";
  idToken: string;
  /** The app's raw nonce, only when it sent one for this signin — server/auth/handler.ts derives the
   * provider-specific expected claim value from it (Apple hashes it, Google doesn't). */
  nonce?: string;
  deviceName?: string;
  /** What the caller says it is: "web" from the browser web app; "app", or nothing at all (every phone
   * build so far), from the phones. Checked for shape only: the verified token, not this, decides
   * whether the session is a browser's (expires after WEB_SESSION_DAYS) or a phone's (security retest
   * 1 Oct 2026, F05; server/auth/providers.ts sessionClientFor). server/auth/handler.ts logs a value
   * the token overruled. */
  client?: "web" | "app";
  /** Sign in with Apple only, optional: Apple's one-time authorization code from the same signin, which
   * server/auth/handler.ts exchanges for a refresh token so account deletion can revoke it
   * (server/auth/apple-tokens.ts). Ignored for Google. */
  authorizationCode?: string;
}

export interface SignoutBody { action: "signout"; }
export interface MeBody { action: "me"; }
export interface DeleteAccountBody { action: "delete_account"; }

/** Phone-to-web login ("Open on computer"): the website starts a pairing (no session — getting one is
 * the point), the signed-in phone approves the pairing's 6-digit `code`, and the website polls with the
 * pairing's id and the poll token pair_start gave it until it receives its session. */
export interface PairStartBody { action: "pair_start"; }
export interface PairApproveBody { action: "pair_approve"; code: string; }
export interface PairPollBody { action: "pair_poll"; pairId: string; pollToken: string; }

export type AuthRequestBody = SigninBody | SignoutBody | MeBody | DeleteAccountBody | PairStartBody | PairApproveBody | PairPollBody;

export type AuthValidationResult = { ok: true; body: AuthRequestBody } | { ok: false; error: "invalid_body" | "too_large" };

function invalid(): AuthValidationResult {
  return { ok: false, error: "invalid_body" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength;
}

function validateSignin(json: Record<string, unknown>): AuthValidationResult {
  if (json.provider !== "apple" && json.provider !== "google") return invalid();
  if (!isNonEmptyString(json.idToken, MAX_ID_TOKEN_CHARS)) return invalid();
  if (json.nonce !== undefined && !isNonEmptyString(json.nonce, MAX_NONCE_CHARS)) return invalid();
  if (json.deviceName !== undefined && !isNonEmptyString(json.deviceName, MAX_DEVICE_NAME_CHARS)) return invalid();
  if (json.client !== undefined && json.client !== "web" && json.client !== "app") return invalid();
  if (json.authorizationCode !== undefined && !isNonEmptyString(json.authorizationCode, MAX_AUTHORIZATION_CODE_CHARS)) return invalid();

  return {
    ok: true,
    body: {
      action: "signin",
      provider: json.provider,
      idToken: json.idToken,
      nonce: json.nonce as string | undefined,
      deviceName: json.deviceName as string | undefined,
      client: json.client as "web" | "app" | undefined,
      ...(json.authorizationCode !== undefined ? { authorizationCode: json.authorizationCode as string } : {}),
    },
  };
}

function validatePairApprove(json: Record<string, unknown>): AuthValidationResult {
  if (typeof json.code !== "string" || !PAIR_CODE_RE.test(json.code)) return invalid();
  return { ok: true, body: { action: "pair_approve", code: json.code } };
}

function validatePairPoll(json: Record<string, unknown>): AuthValidationResult {
  // A uuid, checked here so a malformed one is a 400 rather than a failed uuid cast in the query.
  if (typeof json.pairId !== "string" || !UUID_RE.test(json.pairId)) return invalid();
  if (!isNonEmptyString(json.pollToken, MAX_POLL_TOKEN_CHARS)) return invalid();
  return { ok: true, body: { action: "pair_poll", pairId: json.pairId, pollToken: json.pollToken } };
}

/** Validates a raw request body (the request's text, not yet parsed) and dispatches by `action` to
 * docs/sme-phase-2-cloud.md's per-action shape. `signout`/`me`/`delete_account` carry no fields of
 * their own — everything they need comes from the X-Orderat-Session header, checked separately in
 * server/auth/handler.ts (as is pair_approve's; pair_start and pair_poll need no session). */
export function validateAuthBody(raw: string): AuthValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { ok: false, error: "too_large" };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  switch (json.action) {
    case "signin": return validateSignin(json);
    case "signout": return { ok: true, body: { action: "signout" } };
    case "me": return { ok: true, body: { action: "me" } };
    case "delete_account": return { ok: true, body: { action: "delete_account" } };
    case "pair_start": return { ok: true, body: { action: "pair_start" } };
    case "pair_approve": return validatePairApprove(json);
    case "pair_poll": return validatePairPoll(json);
    default: return invalid();
  }
}

export { MAX_BODY_BYTES };
