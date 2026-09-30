// Verifies an Apple/Google ID token (docs/sme-phase-2-cloud.md's "Accounts") with no JWT library:
// decodes the three base64url segments by hand, checks the signature with WebCrypto
// (`crypto.subtle.verify`, RS256 — RSASSA-PKCS1-v1_5 + SHA-256), then checks `iss`, `aud`, `exp` and
// (when the app sent one) `nonce`. `crypto.subtle` is a Web Crypto API global, so this file runs
// unchanged under Deno and under Node's global `crypto` (same reasoning as server/shared/crypto.ts) —
// no `jsonwebtoken`/`jose` dependency needed.

import { sha256HexOfString } from "../shared/crypto.ts";
import type { JwksCache } from "./jwks.ts";
import type { Provider } from "./providers.ts";

export interface VerifiedIdToken {
  sub: string;
  /** The token audience that matched one of VerifyOptions.audiences — for Apple, the client id the
   * token was issued to (the iPhone app's bundle id or the website's Services ID). */
  aud: string;
  email?: string;
  name?: string;
}

export type VerifyError = "malformed" | "bad_alg" | "unknown_kid" | "bad_signature" | "bad_iss" | "bad_aud" | "expired" | "bad_nonce";

export type VerifyResult = { ok: true; token: VerifiedIdToken } | { ok: false; error: VerifyError };

export interface VerifyOptions {
  issuers: string[];
  audiences: string[];
  jwks: JwksCache;
  now: Date;
  /** The exact value the token's `nonce` claim must equal, only checked when the app sent a nonce at
   * all (docs/sme-phase-2-cloud.md: "nonce when the app sends one"). Provider-specific by the time it
   * gets here — see expectedNonceFor below — so this file itself never needs to know which provider
   * it's verifying. */
  expectedNonce?: string;
}

/** Apple hashes the app's raw nonce with SHA-256 (hex) before it ever reaches the ID token's `nonce`
 * claim; Google's OpenID Connect flow puts the raw nonce in the claim unchanged. Called once by
 * server/auth/handler.ts, before verifyIdToken, so this file only ever compares two already-resolved
 * strings and never has to branch on provider itself. */
export function expectedNonceFor(provider: Provider, rawNonce: string): Promise<string> {
  return provider === "apple" ? sha256HexOfString(rawNonce) : Promise.resolve(rawNonce);
}

function base64UrlToBytes(b64url: string): Uint8Array | undefined {
  if (b64url.length === 0 || !/^[A-Za-z0-9_-]+$/.test(b64url)) return undefined;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(padded, "base64"));
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function decodeJsonSegment(b64url: string): Record<string, unknown> | undefined {
  const bytes = base64UrlToBytes(b64url);
  if (!bytes) return undefined;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `aud` is a single string in every token Apple/Google actually issue, but the JWT spec also allows
 * an array — accepted here too rather than assumed away. */
function audienceList(aud: unknown): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((a): a is string => typeof a === "string");
  return [];
}

/**
 * Verifies `idToken` end to end against `opts` and returns a typed result — never throws for a bad or
 * hostile token, only for a genuinely unexpected failure to reach the JWKS endpoint at all
 * (`opts.jwks.getKey` rejecting), which server/auth/handler.ts handles separately as an upstream
 * failure rather than "this token is invalid".
 */
export async function verifyIdToken(idToken: string, opts: VerifyOptions): Promise<VerifyResult> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed" };
  const [headerB64, payloadB64, sigB64] = parts;

  const header = decodeJsonSegment(headerB64);
  const payload = decodeJsonSegment(payloadB64);
  const signature = base64UrlToBytes(sigB64);
  if (!header || !payload || !signature) return { ok: false, error: "malformed" };
  if (header.alg !== "RS256") return { ok: false, error: "bad_alg" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, error: "malformed" };

  const jwk = await opts.jwks.getKey(header.kid);
  if (!jwk) return { ok: false, error: "unknown_kid" };

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    // A malformed or non-RSA key under this kid — treat exactly like "no usable key for this kid".
    return { ok: false, error: "unknown_kid" };
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature as BufferSource, signingInput as BufferSource);
  if (!valid) return { ok: false, error: "bad_signature" };

  if (typeof payload.iss !== "string" || !opts.issuers.includes(payload.iss)) return { ok: false, error: "bad_iss" };

  const auds = audienceList(payload.aud);
  const matchedAud = auds.find((aud) => opts.audiences.includes(aud));
  if (matchedAud === undefined) return { ok: false, error: "bad_aud" };

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= opts.now.getTime()) return { ok: false, error: "expired" };

  if (opts.expectedNonce !== undefined && payload.nonce !== opts.expectedNonce) return { ok: false, error: "bad_nonce" };

  if (typeof payload.sub !== "string" || !payload.sub) return { ok: false, error: "malformed" };

  return {
    ok: true,
    token: {
      sub: payload.sub,
      aud: matchedAud,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    },
  };
}
