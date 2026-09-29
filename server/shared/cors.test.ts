import { describe, expect, it } from "vitest";
import { withAppCors, withPublicCors } from "./cors";

const PUBLISHED = "https://alishehab01.github.io";
const OTHER = "https://evil.example.com";
// The site at each of its addresses: orderatweb.com, its www form, and its original Cloudflare address
// orderat-app.pages.dev (which now forwards visitors to orderatweb.com).
const SITE_ORIGINS = ["https://orderatweb.com", "https://www.orderatweb.com", "https://orderat-app.pages.dev"];

function handlerReturning(body: string, headers: Record<string, string> = {}) {
  return async () => new Response(body, { status: 200, headers });
}

describe("withPublicCors", () => {
  // The site, where shop links point, plus the old GitHub Pages copy, for links shared before the move.
  it.each([...SITE_ORIGINS, PUBLISHED])("reflects the published origin %s", async (origin) => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin } }));
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("keeps a Vary header the handler set and adds Origin to it", async () => {
    const wrapped = withPublicCors(handlerReturning("ok", { vary: "Accept-Encoding" }));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin: PUBLISHED } }));
    expect(res.headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it("still reflects the old GitHub Pages origin, for links shared before the move", async () => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin: PUBLISHED } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PUBLISHED);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it.each([
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:8080",
  ])("reflects the local dev origin %s", async (origin) => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin } }));
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("never reflects an https localhost origin (only http is allowed)", async () => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin: "https://localhost:3000" } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never reflects a disallowed origin", async () => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin: OTHER } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.status).toBe(200); // CORS never blocks the handler itself from running.
  });

  it("answers an allowed OPTIONS preflight without reaching the handler", async () => {
    let reached = false;
    const wrapped = withPublicCors(async () => { reached = true; return new Response("ok"); });
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", {
      method: "OPTIONS",
      headers: { origin: PUBLISHED, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    }));
    expect(reached).toBe(false);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("apikey");
  });

  it("answers a disallowed preflight with no CORS headers and a 403", async () => {
    const wrapped = withPublicCors(async () => new Response("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { method: "OPTIONS", headers: { origin: OTHER } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never sets Access-Control-Allow-Credentials", async () => {
    const wrapped = withPublicCors(handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-shop", { headers: { origin: PUBLISHED } }));
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

// The web app (https://orderatweb.com/app/) calls five functions (orderat-auth/-sync/-parse/-ask/
// -studio) from the browser; the phones call the same URLs with no Origin header at all and must see
// exactly what they saw before this wrapper existed.
describe("withAppCors", () => {
  const SITE = "https://orderatweb.com";
  const ENDPOINT = "https://x.supabase.co/functions/v1/orderat-sync";
  const SESSION_HEADERS = "apikey, authorization, content-type, x-orderat-session";

  function preflight(origin?: string): Request {
    const headers: Record<string, string> = { "access-control-request-method": "POST", "access-control-request-headers": SESSION_HEADERS };
    if (origin) headers.origin = origin;
    return new Request(ENDPOINT, { method: "OPTIONS", headers });
  }

  function post(origin?: string): Request {
    const headers: Record<string, string> = { "content-type": "application/json", "x-orderat-session": "token" };
    if (origin) headers.origin = origin;
    return new Request(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ action: "shops_list" }) });
  }

  /** What every real handler here returns for a rejected call: a JSON body with a non-200 status. */
  const unauthorized = async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });

  it.each(SITE_ORIGINS)("answers a preflight from the site origin %s with 204 and that origin allowed", async (origin) => {
    const res = await withAppCors(async () => new Response("ok"))(preflight(origin));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-headers")).toBe(SESSION_HEADERS);
  });

  it.each(SITE_ORIGINS)("reflects the site origin %s on a POST", async (origin) => {
    const res = await withAppCors(unauthorized)(post(origin));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("keeps a Vary header the handler set and adds Origin to it", async () => {
    const res = await withAppCors(handlerReturning("ok", { vary: "Accept-Encoding" }))(post(SITE));
    expect(res.headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it("answers the site's preflight itself with 204 and the four CORS headers", async () => {
    let reached = false;
    const wrapped = withAppCors(async () => { reached = true; return new Response("ok"); });
    const res = await wrapped(preflight(SITE));
    expect(reached).toBe(false);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe(SESSION_HEADERS);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("answers a preflight from another origin with 403 and no CORS headers", async () => {
    const wrapped = withAppCors(async () => new Response("ok"));
    const res = await wrapped(preflight(OTHER));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("does not extend the shop page's older GitHub Pages origin to the web app's functions", async () => {
    const wrapped = withAppCors(async () => new Response("ok"));
    const res = await wrapped(preflight(PUBLISHED));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight with no Origin header at all with 403 and no CORS headers", async () => {
    const wrapped = withAppCors(async () => new Response("ok"));
    const res = await wrapped(preflight());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:8080",
  ])("answers a preflight from the local dev origin %s", async (origin) => {
    const wrapped = withAppCors(async () => new Response("ok"));
    const res = await wrapped(preflight(origin));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-headers")).toBe(SESSION_HEADERS);
  });

  it("never allows an https localhost origin (only http is allowed)", async () => {
    const wrapped = withAppCors(async () => new Response("ok"));
    const res = await wrapped(preflight("https://localhost:3000"));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps the handler's status, body and headers on a POST from the site and adds allow-origin plus Vary", async () => {
    const wrapped = withAppCors(unauthorized);
    const res = await wrapped(post(SITE));
    // A rejection must carry the CORS header too, or the browser hides the 401 from the page as a
    // network error and the app could never tell "signed out" from "offline".
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("passes a POST with no Origin header (the phones) through unchanged, adding only Vary", async () => {
    const bare = await unauthorized();
    const res = await withAppCors(unauthorized)(post());
    expect(res.status).toBe(bare.status);
    expect(await res.text()).toBe(await bare.text());
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    const withoutVary = (r: Response) => [...r.headers].filter(([name]) => name !== "vary");
    expect(withoutVary(res)).toEqual(withoutVary(bare));
  });

  it("runs the handler for a POST from a disallowed origin but never reflects that origin", async () => {
    const res = await withAppCors(unauthorized)(post(OTHER));
    expect(res.status).toBe(401); // CORS never blocks the handler itself from running.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never sets Access-Control-Allow-Credentials", async () => {
    const wrapped = withAppCors(handlerReturning("ok"));
    const preflightRes = await wrapped(preflight(SITE));
    const postRes = await wrapped(post(SITE));
    expect(preflightRes.headers.get("access-control-allow-credentials")).toBeNull();
    expect(postRes.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
