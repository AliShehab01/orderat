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

export interface SigninBody {
  action: "signin";
  provider: "apple" | "google";
  idToken: string;
  /** The app's raw nonce, only when it sent one for this signin — server/auth/handler.ts derives the
   * provider-specific expected claim value from it (Apple hashes it, Google doesn't). */
  nonce?: string;
  deviceName?: string;
  /** "web" for the browser web app, whose session then expires after WEB_SESSION_DAYS (see
   * server/auth/store.ts); "app", or nothing at all (every phone build so far), for the phones, whose
   * sessions never expire. */
  client?: "web" | "app";
}

export interface SignoutBody { action: "signout"; }
export interface MeBody { action: "me"; }
export interface DeleteAccountBody { action: "delete_account"; }

export type AuthRequestBody = SigninBody | SignoutBody | MeBody | DeleteAccountBody;

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

  return {
    ok: true,
    body: {
      action: "signin",
      provider: json.provider,
      idToken: json.idToken,
      nonce: json.nonce as string | undefined,
      deviceName: json.deviceName as string | undefined,
      client: json.client as "web" | "app" | undefined,
    },
  };
}

/** Validates a raw request body (the request's text, not yet parsed) and dispatches by `action` to
 * docs/sme-phase-2-cloud.md's per-action shape. `signout`/`me`/`delete_account` carry no fields of
 * their own — everything they need comes from the X-Orderat-Session header, checked separately in
 * server/auth/handler.ts. */
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
    default: return invalid();
  }
}

export { MAX_BODY_BYTES };
