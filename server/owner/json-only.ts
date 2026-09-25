// The hosted Edge Function can't serve text/html: Supabase rewrites text/html responses to
// text/plain on *.supabase.co unless the project has a custom domain (see README "Hosting"), which
// this project doesn't. server/owner/handler.ts still returns the OWNER_PAGE HTML for GET /owner —
// that's correct for server/dev.ts (a real browser, same origin, no rewrite) — so this wrapper strips
// just that one route for the hosted deployment, converting it to a JSON 404. Every other route
// (list orders, confirm, ...) passes through untouched, so handler.ts itself needs no host-specific
// branching.
export function withOwnerApiOnly(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && (pathname === "/owner" || pathname === "/owner/")) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    return handler(req);
  };
}
