// In-memory JWKS (JSON Web Key Set) cache for verifying Apple/Google ID tokens
// (docs/sme-phase-2-cloud.md's "Accounts") without a library: fetches a provider's public signing
// keys once, keeps them for `ttlMs`, and refetches on expiry or on an unknown `kid` (a key the
// provider rotated in since our last fetch) — so routine key rotation on Apple/Google's side never
// needs a deploy here. One cache per provider, held in the Edge Function's module scope
// (supabase/functions/orderat-auth/index.ts) so it's reused across requests the same isolate handles,
// the same reasoning as supabase/functions/_shared/db.ts's cached SqlClient.

export interface Jwk {
  kty: string;
  kid: string;
  [key: string]: unknown;
}

interface JwksDocument {
  keys: Jwk[];
}

export interface JwksCache {
  /** The key for `kid`, or undefined if no key by that id exists even after a refetch. Throws only
   * when the provider's JWKS endpoint itself can't be reached or returns something unusable — never
   * for a merely-unknown kid. */
  getKey(kid: string): Promise<Jwk | undefined>;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour.

function isJwksDocument(value: unknown): value is JwksDocument {
  return typeof value === "object" && value !== null && Array.isArray((value as { keys?: unknown }).keys);
}

/**
 * Creates a JWKS cache for one provider endpoint. `fetchImpl` is injectable so tests can serve a
 * fake JWKS (server/auth/jwt-test-support.ts's fakeJwksFetch) instead of ever calling
 * appleid.apple.com or googleapis.com for real.
 */
export function createJwksCache(url: string, opts: { ttlMs?: number; fetchImpl?: typeof fetch } = {}): JwksCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let cached: { keys: Jwk[]; fetchedAt: number } | undefined;

  async function refresh(): Promise<Jwk[]> {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS fetch failed for ${url}: ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error(`JWKS response from ${url} was not JSON`);
    }
    if (!isJwksDocument(body)) throw new Error(`JWKS response from ${url} had no "keys" array`);
    cached = { keys: body.keys, fetchedAt: Date.now() };
    return cached.keys;
  }

  return {
    async getKey(kid: string): Promise<Jwk | undefined> {
      const isFresh = cached !== undefined && Date.now() - cached.fetchedAt < ttlMs;
      let keys = isFresh ? cached!.keys : await refresh();
      let key = keys.find((k) => k.kid === kid);
      // Already-fresh cache missed this kid: refetch once before giving up, in case the provider
      // rotated in a new key inside our TTL window. (If the cache was stale, the refresh() above
      // already picked up whatever's current, so there's nothing more to gain from trying again.)
      if (!key && isFresh) {
        keys = await refresh();
        key = keys.find((k) => k.kid === kid);
      }
      return key;
    },
  };
}
