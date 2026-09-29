// CORS for the two marketing functions a browser calls directly: the public shop page
// (public/orderat/s/, docs/marketing-tools.md's orderat-shop) and, potentially, a future web page
// reading orderat-campaigns. Same shape as server/owner/cors.ts (answer OPTIONS itself, reflect only
// an allow-listed Origin, never set Access-Control-Allow-Credentials since these calls carry no
// cookie) but a different allow-list policy: owner's is a runtime env allow-list of exact origins;
// this one is fixed — the published site origins plus any localhost/127.0.0.1 port, so the
// page and its own dev server both work without an env var to maintain. Not configurable by env
// because, unlike the owner page, docs/marketing-tools.md pins the allow-list itself.
//
// withAppCors (below) is the same idea for the Orderat web app (docs/superpowers/specs/
// 2026-09-29-orderat-web-design.md): a browser page at orderat-app.pages.dev/app/ that calls
// orderat-auth, orderat-sync, orderat-parse, orderat-ask and orderat-studio directly (the signed-in
// actions carry the seller's session in X-Orderat-Session). It differs from withPublicCors only in its
// allow-list: just the site itself (not the older GitHub Pages copy), POST only, and one more allowed
// header. The phones call those same functions with no Origin header at all, so they are never
// "allowed" here and never see a CORS header — their responses stay exactly what the handler
// returned, plus Vary.

const ALLOWED_METHODS = "GET, POST, OPTIONS";
// Lower-case per docs/marketing-tools.md's exact wording; header names are case-insensitive on the
// wire, so this is only ever compared/read case-insensitively, never relied on verbatim.
const ALLOWED_HEADERS = "apikey, authorization, content-type";
// The site: orderatweb.com (shop links point there since 2026-09-29), its www form, its original
// Cloudflare address orderat-app.pages.dev, and the old GitHub
// Pages copy, so shop links sellers shared before the move keep working.
const PUBLISHED_ORIGINS: readonly string[] = [
  "https://orderatweb.com",
  "https://www.orderatweb.com",
  "https://orderat-app.pages.dev",
  "https://alishehab01.github.io",
];
// http only (not https), per docs/marketing-tools.md — a local dev server for the shop page.
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/** The Orderat web app's origin. One shared list, so the day the app also lives on its own domain
 * that domain is one more line here (and nowhere else). */
export const APP_ORIGINS: readonly string[] = ["https://orderat-app.pages.dev"];
// The web app only ever POSTs — every function it calls answers POST only — so nothing else is offered.
const APP_ALLOWED_METHODS = "POST, OPTIONS";
// apikey + authorization are the Supabase gateway's anon key, sent exactly as the phones send it;
// x-orderat-session carries the seller's session token (what makes this list differ from the public one).
const APP_ALLOWED_HEADERS = "apikey, authorization, content-type, x-orderat-session";

interface CorsPolicy {
  /** The exact origins allowed, in addition to any http localhost/127.0.0.1 port (LOCAL_ORIGIN_RE). */
  origins: readonly string[];
  methods: string;
  headers: string;
}

function isAllowedOrigin(origin: string | null, origins: readonly string[]): origin is string {
  return origin !== null && (origins.includes(origin) || LOCAL_ORIGIN_RE.test(origin));
}

/**
 * The mechanics both wrappers below share: answers an OPTIONS preflight itself (never reaching
 * `handler`), and adds Access-Control-Allow-Origin (only for an allowed Origin) plus Vary: Origin to
 * every response. A request with no Origin header at all is simply not allowed: an OPTIONS from it
 * gets the 403, anything else gets the handler's own response with only Vary added.
 */
function withCors(policy: CorsPolicy, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get("origin");
    const allowed = isAllowedOrigin(origin, policy.origins);

    if (req.method === "OPTIONS") {
      const headers = new Headers({ Vary: "Origin" });
      if (allowed) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Methods", policy.methods);
        headers.set("Access-Control-Allow-Headers", policy.headers);
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

/**
 * Wraps a handler with this fixed-allow-list CORS: answers an OPTIONS preflight itself (never
 * reaching `handler`), and adds Access-Control-Allow-Origin (only for an allowed Origin) plus
 * Vary: Origin to every response — same reasoning as server/owner/cors.ts's withOwnerCors, repeated
 * here rather than shared with it because the two allow-list policies differ (fixed here, env-driven
 * there) and owner's is Bearer-token-authenticated while these two functions are public reads/writes
 * authorized by other means (a shop's edit token, or nothing at all for a public GET).
 */
export function withPublicCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return withCors({ origins: PUBLISHED_ORIGINS, methods: ALLOWED_METHODS, headers: ALLOWED_HEADERS }, handler);
}

/**
 * The same wrapper for the five functions the Orderat web app calls from the browser (orderat-auth,
 * -sync, -parse, -ask, -studio): allows APP_ORIGINS plus any local dev origin, POST only, with the
 * session header. None of these calls relies on a cookie — credentials travel in headers (the
 * Supabase anon key, and X-Orderat-Session for the signed-in actions) — so
 * Access-Control-Allow-Credentials is not needed and never set. The allowed origin on *every*
 * response, errors included, is what lets the page read a 401 or 429 as such instead of the browser
 * hiding it as a network error. Requests without an Origin header (the phones) pass through untouched.
 */
export function withAppCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return withCors({ origins: APP_ORIGINS, methods: APP_ALLOWED_METHODS, headers: APP_ALLOWED_HEADERS }, handler);
}
