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
