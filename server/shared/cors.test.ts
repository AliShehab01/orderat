import { describe, expect, it } from "vitest";
import { withPublicCors } from "./cors";

const PUBLISHED = "https://alishehab01.github.io";
const OTHER = "https://evil.example.com";

function handlerReturning(body: string, headers: Record<string, string> = {}) {
  return async () => new Response(body, { status: 200, headers });
}

describe("withPublicCors", () => {
  it("reflects the published GitHub Pages origin", async () => {
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
