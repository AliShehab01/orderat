import { describe, expect, it } from "vitest";
import { createJwksCache } from "./jwks.ts";
import { fakeJwksFetch, generateTestKeyPair } from "./jwt-test-support.ts";

describe("createJwksCache", () => {
  it("finds a key by kid from the served JWKS", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    const cache = createJwksCache("https://example.test/keys", { fetchImpl: fakeJwksFetch([keyPair]) });
    const key = await cache.getKey("key-a");
    expect(key?.kid).toBe("key-a");
    expect(key?.kty).toBe("RSA");
  });

  it("returns undefined for a kid that never existed, without throwing", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    const cache = createJwksCache("https://example.test/keys", { fetchImpl: fakeJwksFetch([keyPair]) });
    expect(await cache.getKey("nonexistent")).toBeUndefined();
  });

  it("caches within the TTL: a second lookup of a known kid doesn't refetch", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    let fetchCount = 0;
    const cache = createJwksCache("https://example.test/keys", { fetchImpl: fakeJwksFetch([keyPair], () => fetchCount++) });
    await cache.getKey("key-a");
    await cache.getKey("key-a");
    expect(fetchCount).toBe(1);
  });

  it("refetches once when a kid isn't found in a still-fresh cache (key rotation)", async () => {
    const keyPairA = await generateTestKeyPair("key-a");
    let fetchCount = 0;
    let keys = [keyPairA];
    const cache = createJwksCache("https://example.test/keys", {
      fetchImpl: (async () => {
        fetchCount++;
        return fakeJwksFetch(keys)("https://example.test/keys");
      }) as unknown as typeof fetch,
    });
    await cache.getKey("key-a"); // Primes the cache (fetch #1).
    const keyPairB = await generateTestKeyPair("key-b");
    keys = [keyPairA, keyPairB]; // Provider rotates in a new key, same TTL window.
    const found = await cache.getKey("key-b");
    expect(found?.kid).toBe("key-b");
    expect(fetchCount).toBe(2);
  });

  it("refetches after the TTL expires even for a previously-known kid", async () => {
    const keyPair = await generateTestKeyPair("key-a");
    let fetchCount = 0;
    const cache = createJwksCache("https://example.test/keys", { ttlMs: 1, fetchImpl: fakeJwksFetch([keyPair], () => fetchCount++) });
    await cache.getKey("key-a");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cache.getKey("key-a");
    expect(fetchCount).toBe(2);
  });

  it("throws when the JWKS endpoint responds with a non-2xx status", async () => {
    const cache = createJwksCache("https://example.test/keys", { fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch });
    await expect(cache.getKey("key-a")).rejects.toThrow();
  });

  it("throws when the JWKS response has no keys array", async () => {
    const cache = createJwksCache("https://example.test/keys", {
      fetchImpl: (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(cache.getKey("key-a")).rejects.toThrow();
  });
});
