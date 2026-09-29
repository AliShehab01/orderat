// Small crypto primitives shared by orderat-studio (nothing yet, reserved for future use),
// orderat-shop (edit tokens, photo dedupe ids, IP hashing for rate limits) and orderat-auth (token
// hashes, IP hashing for pair_start's rate limit): SHA-256 hashing and random token generation, both
// via the Web Crypto API (`crypto.subtle`, `crypto.getRandomValues`) so the same code runs unchanged
// under Deno and under Node 22's global `crypto` — no `node:crypto` import, which wouldn't resolve the
// same way under Deno's own global.

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out;
}

/** SHA-256 of `bytes`, as a lowercase hex string — used to derive a shop photo's content-addressed
 * id (server/shop/photos.ts's dedupe key: an unchanged photo is never uploaded twice). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `as BufferSource`: lib.dom's BufferSource wants a view over a plain ArrayBuffer, but a
  // Uint8Array parameter is typed over the wider ArrayBufferLike (so callers can also pass a view
  // backed by a SharedArrayBuffer) — a real mismatch only in TypeScript's eyes, never at runtime,
  // since SubtleCrypto.digest accepts any ArrayBufferView.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/** SHA-256 of a UTF-8 string, as a lowercase hex string — for hashing an edit token once it's a
 * string off the wire (server/shop/tokens.ts) or a client IP before it's ever written to a row
 * (server/shop/rate-limit.ts) — raw IPs and tokens are never stored, only these hashes. */
export function sha256HexOfString(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value));
}

/** A request's client IP as a per-IP rate limit keys it: `x-forwarded-for`'s first entry (Supabase
 * sets this) — the original client, before any proxy — hashed with the server's salt before ever
 * touching a row, never the raw IP. Falls back to a fixed bucket, "unknown", when the header is absent
 * (local testing, or a direct call) so rate limiting still applies, just coarsely. */
export function hashClientIp(req: Request, ipSalt: string): Promise<string> {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  return sha256HexOfString(`${ipSalt}:${ip}`);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(binary, "binary").toString("base64") : btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface NewToken {
  /** The secret value returned to the app exactly once — never stored, never logged. */
  token: string;
  /** SHA-256 hex of `token`, the only thing ever written to `orderat.shops.token_hash`. */
  tokenHash: string;
}

/** A fresh shop edit token: 32 random bytes, base64url-encoded (docs/marketing-tools.md: "32 random
 * bytes base64url via crypto.getRandomValues"). Callers persist only `tokenHash`. */
export async function newEditToken(): Promise<NewToken> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64UrlEncode(bytes);
  return { token, tokenHash: await sha256HexOfString(token) };
}

/**
 * Constant-time comparison of two hex digests (a submitted token's hash against the one stored for
 * a shop) — a plain `===` short-circuits on the first differing character, which lets a patient
 * attacker recover a valid hash byte-by-byte from response timing; this always inspects every
 * character regardless of where the first mismatch is. Different lengths are never equal (a real
 * digest's length is fixed and public, so leaking a length mismatch immediately isn't a concern).
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
