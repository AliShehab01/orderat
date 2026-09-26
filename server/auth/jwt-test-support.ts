// Shared "sign a fake provider ID token" helper for server/auth's own test suites
// (verify-token.test.ts, handler.test.ts): generates a real RSA key pair with WebCrypto, signs a JWT
// with it exactly the way Apple/Google would (RS256, base64url(header).base64url(payload).signature),
// and builds a fake `fetch` that serves that key pair's public half as a JWKS document — so these
// tests exercise the real signature-verification code path end to end without ever calling
// appleid.apple.com or googleapis.com. Not a *.test.ts file itself (vitest's include pattern is
// server/**/*.test.ts), so this is just a normal module the test files import.

export interface TestKeyPair {
  kid: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/** A fresh 2048-bit RSA key pair for RS256, tagged with `kid` — the same key-id-selects-which-key
 * scheme a real JWKS uses, so a test can register several keys and prove the right one gets picked. */
export async function generateTestKeyPair(kid = "test-key-1"): Promise<TestKeyPair> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return { kid, publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(binary, "binary").toString("base64") : btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Signs a JWT with `keyPair`'s private key: RS256,
 * base64url(header).base64url(payload).base64url(signature) — exactly the shape
 * server/auth/verify-token.ts parses. `headerOverrides` lets a test build a deliberately wrong header
 * (a different `kid`, a non-RS256 `alg`, ...).
 */
export async function signTestToken(keyPair: TestKeyPair, payload: Record<string, unknown>, headerOverrides: Record<string, unknown> = {}): Promise<string> {
  const header = { alg: "RS256", kid: keyPair.kid, typ: "JWT", ...headerOverrides };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * A fake `fetch` that serves `keyPairs`' public halves as a JWKS document, whatever URL it's called
 * with — the injected fetch server/auth/jwks.ts's createJwksCache takes, so verifying a test token
 * never reaches a real network. `onFetch` (optional) is called once per invocation, so a test can
 * assert the TTL cache is actually avoiding repeat fetches.
 */
export function fakeJwksFetch(keyPairs: TestKeyPair[], onFetch?: () => void): typeof fetch {
  return (async () => {
    onFetch?.();
    const keys = await Promise.all(
      keyPairs.map(async (kp) => ({ ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: kp.kid, alg: "RS256", use: "sig" })),
    );
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

/** A fake `fetch` that always fails the JWKS request — for the "provider's JWKS endpoint is down"
 * path, distinct from "the token itself is invalid". */
export function failingJwksFetch(status = 500): typeof fetch {
  return (async () => new Response("nope", { status })) as unknown as typeof fetch;
}
