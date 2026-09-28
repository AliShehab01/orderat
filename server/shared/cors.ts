// CORS for the two marketing functions a browser calls directly: the public shop page
// (public/orderat/s/, docs/marketing-tools.md's orderat-shop) and, potentially, a future web page
// reading orderat-campaigns. Same shape as server/owner/cors.ts (answer OPTIONS itself, reflect only
// an allow-listed Origin, never set Access-Control-Allow-Credentials since these calls carry no
// cookie) but a different allow-list policy: owner's is a runtime env allow-list of exact origins;
// this one is fixed — the published site origins plus any localhost/127.0.0.1 port, so the
// page and its own dev server both work without an env var to maintain. Not configurable by env
// because, unlike the owner page, docs/marketing-tools.md pins the allow-list itself.

const ALLOWED_METHODS = "GET, POST, OPTIONS";
// Lower-case per docs/marketing-tools.md's exact wording; header names are case-insensitive on the
// wire, so this is only ever compared/read case-insensitively, never relied on verbatim.
const ALLOWED_HEADERS = "apikey, authorization, content-type";
// The site (orderat-app.pages.dev, where shop links point since 2026-09-29) and the old GitHub
// Pages copy, so shop links sellers shared before the move keep working.
const PUBLISHED_ORIGINS: readonly string[] = ["https://orderat-app.pages.dev", "https://alishehab01.github.io"];
// http only (not https), per docs/marketing-tools.md — a local dev server for the shop page.
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && (PUBLISHED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin));
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
  return async (req) => {
    const origin = req.headers.get("origin");
    const allowed = isAllowedOrigin(origin);

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
