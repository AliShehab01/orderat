import { describe, expect, it } from "vitest";
import { sha256HexOfString } from "../shared/crypto.ts";
import { createJwksCache } from "./jwks.ts";
import { fakeJwksFetch, generateTestKeyPair, signTestToken, type TestKeyPair } from "./jwt-test-support.ts";
import { expectedNonceFor, verifyIdToken } from "./verify-token.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const ISS = "https://appleid.apple.com";
const AUD = "com.ams.orderat";

async function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISS,
    aud: AUD,
    sub: "user-sub-123",
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    iat: Math.floor(NOW.getTime() / 1000) - 60,
    ...overrides,
  };
}

async function cacheFor(keyPairs: TestKeyPair[]) {
  return createJwksCache("https://example.test/keys", { fetchImpl: fakeJwksFetch(keyPairs) });
}

describe("verifyIdToken", () => {
  it("accepts a validly-signed token matching iss/aud/exp", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ email: "seller@example.com", name: "Sara" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: true, token: { sub: "user-sub-123", email: "seller@example.com", name: "Sara" } });
  });

  it("rejects a malformed token (not three segments)", async () => {
    const result = await verifyIdToken("not.a.jwt.at.all", { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([]), now: NOW });
    expect(result).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects a non-RS256 alg header", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload(), { alg: "none" });
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "bad_alg" });
  });

  it("rejects a token whose kid isn't in the JWKS", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    const otherKeyPair = await generateTestKeyPair("key-b");
    const token = await signTestToken(keyPair, await basePayload());
    // Serve only key-b, not the key-a this token was actually signed with.
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([otherKeyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "unknown_kid" });
  });

  it("rejects a bad signature (token signed by a different key than the one served under its kid)", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    const impostorKeyPair = await generateTestKeyPair("key-a"); // Same kid, different actual key.
    const token = await signTestToken(impostorKeyPair, await basePayload());
    // The JWKS serves key-a's *real* public key, which does not match the impostor's signature.
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload());
    const [header, , signature] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify(await basePayload({ sub: "attacker-sub" }))).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const result = await verifyIdToken(tampered, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects the wrong iss", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ iss: "https://evil.example" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "bad_iss" });
  });

  it("accepts either documented Google iss form", async () => {
    const keyPair = await generateTestKeyPair();
    const issuers = ["accounts.google.com", "https://accounts.google.com"];
    for (const iss of issuers) {
      const token = await signTestToken(keyPair, await basePayload({ iss, aud: "google-client-id" }));
      const result = await verifyIdToken(token, { issuers, audiences: ["google-client-id"], jwks: await cacheFor([keyPair]), now: NOW });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects the wrong aud", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ aud: "some-other-app" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "bad_aud" });
  });

  it("accepts an aud claim given as an array containing an allowed value", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ aud: ["some-other-app", AUD] }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result.ok).toBe(true);
  });

  it("rejects an expired token", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ exp: Math.floor(NOW.getTime() / 1000) - 10 }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a token expiring at exactly `now` (exp is not inclusive)", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ exp: Math.floor(NOW.getTime() / 1000) }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("accepts a token whose nonce claim matches the expected nonce", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ nonce: "raw-nonce-value" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW, expectedNonce: "raw-nonce-value" });
    expect(result.ok).toBe(true);
  });

  it("rejects a nonce mismatch", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ nonce: "raw-nonce-value" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW, expectedNonce: "a-different-nonce" });
    expect(result).toEqual({ ok: false, error: "bad_nonce" });
  });

  it("never checks nonce when the caller passes no expectedNonce, even if the token has one", async () => {
    const keyPair = await generateTestKeyPair();
    const token = await signTestToken(keyPair, await basePayload({ nonce: "whatever" }));
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result.ok).toBe(true);
  });

  it("rejects a token with no sub claim", async () => {
    const keyPair = await generateTestKeyPair();
    const payload = await basePayload();
    delete (payload as Record<string, unknown>).sub;
    const token = await signTestToken(keyPair, payload);
    const result = await verifyIdToken(token, { issuers: [ISS], audiences: [AUD], jwks: await cacheFor([keyPair]), now: NOW });
    expect(result).toEqual({ ok: false, error: "malformed" });
  });
});

describe("expectedNonceFor", () => {
  it("hashes the raw nonce with SHA-256 for Apple", async () => {
    const expected = await expectedNonceFor("apple", "raw-nonce-value");
    expect(expected).toBe(await sha256HexOfString("raw-nonce-value"));
  });

  it("passes the raw nonce through unchanged for Google", async () => {
    expect(await expectedNonceFor("google", "raw-nonce-value")).toBe("raw-nonce-value");
  });
});
