// Strict allow-list CORS for the hosted owner Edge Function. The static page (public/orderat/owner.html
// + owner.js) calls this function from its own origin (GitHub Pages by default), which is never the
// same origin as https://<ref>.supabase.co, so the browser enforces CORS on every call. Only origins
// in the allow-list are ever reflected back in Access-Control-Allow-Origin; every other Origin gets no
// CORS headers at all, which is what makes the browser refuse to hand the response to the page's own
// script (CORS is enforced by the browser reading these response headers, not by the server refusing
// the request outright — the Authorization: Bearer check in server/owner/auth.ts is what actually
// protects the data, independent of CORS). Access-Control-Allow-Credentials is never set: the client
// authenticates with an Authorization header instead of a cookie, so no cross-origin credentials mode
// is ever needed here — see server/owner/auth.ts's withOwnerBearerAuth for why cookies don't apply.
//
// server/dev.ts (local) never wraps its handler with this: only the hosted Edge Function
// (supabase/functions/orderat-owner/index.ts) does, since only it is ever called cross-origin.

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type";
// Only the static owner page's own default host — nobody has published the redesigned page to a
// different origin yet (see README "Hosting" and public/orderat's separate redesign branch).
const DEFAULT_ALLOWED_ORIGIN = "https://alishehab01.github.io";

/**
 * Parses ORDERAT_OWNER_ALLOWED_ORIGINS (a comma-separated list of exact origins, e.g.
 * "https://alishehab01.github.io,https://example.com") into an allow-list, defaulting to the
 * published static owner page's own origin when unset or empty.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [DEFAULT_ALLOWED_ORIGIN];
  const origins = trimmed.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length ? origins : [DEFAULT_ALLOWED_ORIGIN];
}

function isAllowedOrigin(origin: string | null, allowedOrigins: readonly string[]): origin is string {
  return origin !== null && allowedOrigins.includes(origin);
}

/**
 * Wraps an owner handler with strict CORS: answers OPTIONS preflight requests itself (never reaching
 * `handler`, since a preflight carries no Authorization header and would otherwise fail auth), and
 * adds Access-Control-Allow-Origin (only for an allow-listed Origin) plus Vary: Origin to every
 * response from `handler`, so a cache in front of this function never serves one origin's response to
 * another's.
 */
export function withOwnerCors(allowedOrigins: readonly string[], handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get("origin");
    const allowed = isAllowedOrigin(origin, allowedOrigins);

    if (req.method === "OPTIONS") {
      const headers = new Headers({ Vary: "Origin" });
      if (allowed) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
        headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
        headers.set("Access-Control-Max-Age", "86400");
      }
      return new Response(null, { status: allowed ? 204 : 403, headers });
    }

    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("Vary", "Origin");
    if (allowed) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
