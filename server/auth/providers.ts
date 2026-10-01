// Apple/Google ID-token provider configuration (docs/sme-phase-2-cloud.md's "Accounts"): each
// provider's JWKS endpoint, the `iss` value(s) its tokens carry, and the allowed `aud` values (our
// app's client/bundle ids), which come from env so a build change never needs a code change.

export type Provider = "apple" | "google";

export interface ProviderConfig {
  jwksUrl: string;
  issuers: string[];
  audiences: string[];
}

export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** docs/sme-phase-2-cloud.md: "Apple: https://appleid.apple.com/auth/keys, iss
 * https://appleid.apple.com". */
export function appleConfig(audiences: string[]): ProviderConfig {
  return { jwksUrl: APPLE_JWKS_URL, issuers: ["https://appleid.apple.com"], audiences };
}

/** docs/sme-phase-2-cloud.md: "Google: https://www.googleapis.com/oauth2/v3/certs, iss
 * accounts.google.com or https://accounts.google.com" — Google ID tokens are seen in the wild with
 * either form, so both are accepted. */
export function googleConfig(audiences: string[]): ProviderConfig {
  return { jwksUrl: GOOGLE_JWKS_URL, issuers: ["accounts.google.com", "https://accounts.google.com"], audiences };
}

/** Parses a comma list of audiences from env (ORDERAT_APPLE_AUDIENCES / ORDERAT_GOOGLE_AUDIENCES),
 * trimming and dropping empty entries, falling back to `fallback` (default: none) when unset or
 * empty — docs/sme-phase-2-cloud.md: "ORDERAT_APPLE_AUDIENCES (default com.ams.orderat) and
 * ORDERAT_GOOGLE_AUDIENCES (comma lists)". An empty result (Google, unset) means no token can ever
 * match `aud`, which is deliberate: that provider is simply not accepted until configured, the same
 * "never crash, just refuse" posture server/shop/handler.ts's uploadPhoto failure takes rather than
 * a separate "not configured" branch. */
export function resolveAudiences(raw: string | undefined, fallback: string[] = []): string[] {
  const parsed = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

/** `audiences` plus one more client id when it is set (and not already listed) — how orderat-auth adds
 * the iPhone app's own Google OAuth client (ORDERAT_GOOGLE_IOS_CLIENT_ID) to the Google audiences,
 * whether those come from ORDERAT_GOOGLE_AUDIENCES or the built-in default. */
export function withExtraAudience(audiences: string[], extra: string | undefined): string[] {
  const id = extra?.trim();
  return id && !audiences.includes(id) ? [...audiences, id] : audiences;
}

/** A phone's session ("app": no fixed end, and the only kind that may approve a website's pairing) or
 * a browser's ("web": ends WEB_SESSION_DAYS after signin), server/auth/store.ts. */
export type SessionClient = "web" | "app";

/**
 * The kind of session a verified ID token starts (security retest 1 Oct 2026, F05; until then the
 * signin body's `client` chose, so a website token sent with `client: "app"` got a phone's session).
 * Decided from the token alone. "app" only for a token one of the apps asked for:
 * - its audience is one of the apps' own client ids, `appAudiences` (orderat-auth: the iPhone app's
 *   bundle id com.ams.orderat for Sign in with Apple, and its Google iOS client); or
 * - a Google token whose authorized party (`azp`) is a client other than its audience. Google issues
 *   such a cross-client token only to a native app of the same Google project that names the audience
 *   as its server client: the Android app, which asks for tokens addressed to the web client
 *   (google_sign_in's serverClientId), so they carry the web client id as `aud` and the Android
 *   client's own id as `azp`. A browser's Google token names the web client as both.
 * Every other token starts a web session: the website's (its Sign in with Apple Services ID
 * com.ams.orderat.web, its Google web client), and any audience not known to be an app's.
 */
export function sessionClientFor(provider: Provider, token: { aud: string; azp?: string }, appAudiences: readonly string[]): SessionClient {
  if (appAudiences.includes(token.aud)) return "app";
  if (provider === "google" && token.azp !== undefined && token.azp !== token.aud) return "app";
  return "web";
}
