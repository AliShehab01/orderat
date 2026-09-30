// Sign in with Apple token exchange and revocation (App Store Review Guideline 5.1.1(v): an app that
// offers account deletion and Sign in with Apple must also revoke the user's Apple tokens).
//
// At signin the iPhone app (and the web app) may send Apple's one-time `authorizationCode` with the ID
// token. `exchangeCode` trades it at https://appleid.apple.com/auth/token for a refresh token, which
// server/auth/store.ts keeps in orderat.apple_tokens; at delete_account `revoke` sends that refresh token
// to https://appleid.apple.com/auth/revoke. Both calls authenticate with a `client_secret`: an ES256 JWT
// signed with the Sign in with Apple private key (a .p8 from the Apple Developer account), naming the
// team (`iss`), the key (`kid`) and the client id the token was issued to (`sub`): com.ams.orderat for
// the iPhone app, com.ams.orderat.web for the website.
//
// Plain Web Crypto + fetch, so it runs the same under Deno (the edge function) and Node (tests).

export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_AUDIENCE = "https://appleid.apple.com";
/** A client secret may live up to six months; each one here is minted per call, so five minutes is ample. */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

export interface AppleKeyConfig {
  teamId: string;
  keyId: string;
  /** The .p8 file's contents: a PKCS#8 PEM ("-----BEGIN PRIVATE KEY----- ..."). Literal "\n" sequences
   * (how a multi-line secret is often pasted into a single-line env var) are accepted too. */
  privateKeyPem: string;
}

export interface AppleTokenClient {
  /** The refresh token for a one-time authorization code, or undefined if Apple refused it (expired,
   * already used, wrong client) or could not be reached. Never throws. */
  exchangeCode(code: string, clientId: string): Promise<string | undefined>;
  /** Revokes a refresh token. true once Apple accepted it (HTTP 200). Never throws. */
  revoke(refreshToken: string, clientId: string): Promise<boolean>;
}

/** The three secrets, or undefined when any is missing (the feature is then off). `get` reads one env
 * name without the ORDERAT_ prefix, as supabase/functions/_shared/env.ts's orderatEnv does. */
export function appleKeyConfigFromEnv(get: (name: string) => string | undefined): AppleKeyConfig | undefined {
  const teamId = get("APPLE_TEAM_ID")?.trim();
  const keyId = get("APPLE_KEY_ID")?.trim();
  const privateKeyPem = get("APPLE_PRIVATE_KEY")?.trim();
  if (!teamId || !keyId || !privateKeyPem) return undefined;
  return { teamId, keyId, privateKeyPem };
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pkcs8FromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The ES256 client_secret JWT for `clientId`. Web Crypto's ECDSA signature is already the raw r||s
 * form JWS wants, so no DER conversion is needed. */
export async function createAppleClientSecret(config: AppleKeyConfig, clientId: string, now: Date): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8FromPem(config.privateKeyPem) as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now.getTime() / 1000);
  const signingInput = `${base64UrlFromJson({ alg: "ES256", kid: config.keyId })}.${base64UrlFromJson({
    iss: config.teamId,
    iat,
    exp: iat + CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput) as BufferSource);
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

export interface AppleTokenClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function createAppleTokenClient(config: AppleKeyConfig, options: AppleTokenClientOptions = {}): AppleTokenClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  async function postForm(url: string, fields: Record<string, string>): Promise<Response | undefined> {
    try {
      return await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });
    } catch {
      return undefined;
    }
  }

  return {
    async exchangeCode(code, clientId) {
      let clientSecret: string;
      try {
        clientSecret = await createAppleClientSecret(config, clientId, now());
      } catch {
        return undefined; // A malformed private key: the feature simply does not work, signin still does.
      }
      const res = await postForm(APPLE_TOKEN_URL, { client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" });
      if (!res || !res.ok) return undefined;
      try {
        const body = (await res.json()) as { refresh_token?: unknown };
        return typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined;
      } catch {
        return undefined;
      }
    },

    async revoke(refreshToken, clientId) {
      let clientSecret: string;
      try {
        clientSecret = await createAppleClientSecret(config, clientId, now());
      } catch {
        return false;
      }
      const res = await postForm(APPLE_REVOKE_URL, { client_id: clientId, client_secret: clientSecret, token: refreshToken, token_type_hint: "refresh_token" });
      return res?.ok === true;
    },
  };
}
