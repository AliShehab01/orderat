// Supabase Edge Functions never strip their own /functions/v1/<function-name> prefix from the
// request path before a function sees it — Supabase's own routing docs say paths "should always be
// prefixed with the function name" and leave stripping it up to the function. server/owner/handler.ts
// (the one shared handler, also used by server/dev.ts) matches routes rooted at /owner, the same
// paths dev.ts serves locally (http://localhost:8787/owner/api/orders, ...). Rather than teach
// handler.ts two different route tables, this rewrites the hosted Request onto that shape before
// handler.ts ever sees it, so the one shared handler keeps working unchanged in both places.
// Verified live on 2026-09-25: the deployed function actually sees "/orderat-owner/api/orders"
// (Supabase strips /functions/v1 but keeps the function name), so callers pass every prefix form.
export function withHostedOwnerPath(prefixes: string | string[], handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  const list = (Array.isArray(prefixes) ? prefixes : [prefixes]).slice().sort((a, b) => b.length - a.length);
  return (req) => {
    const url = new URL(req.url);
    const prefix = list.find((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
    const rest = prefix ? url.pathname.slice(prefix.length) : url.pathname;
    url.pathname = rest === "" || rest === "/" ? "/owner" : `/owner${rest.startsWith("/") ? rest : `/${rest}`}`;
    // No route handler.ts exposes reads a request body (GET orders, POST confirm with no payload),
    // so only the method and headers (Authorization, in particular) need to carry over — simpler,
    // and avoids Node/Deno differences in re-wrapping a streamed request body.
    return handler(new Request(url, { method: req.method, headers: req.headers }));
  };
}
