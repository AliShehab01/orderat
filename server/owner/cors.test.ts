import { describe, expect, it } from "vitest";
import { parseAllowedOrigins, withOwnerCors } from "./cors";

const ALLOWED = "https://alishehab01.github.io";
const OTHER = "https://evil.example.com";

function handlerReturning(body: string, headers: Record<string, string> = {}) {
  return async () => new Response(body, { status: 200, headers });
}

describe("parseAllowedOrigins", () => {
  it("defaults to the published owner page's origin when unset", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["https://alishehab01.github.io"]);
  });

  it("defaults when the value is empty or blank", () => {
    expect(parseAllowedOrigins("")).toEqual(["https://alishehab01.github.io"]);
    expect(parseAllowedOrigins("   ")).toEqual(["https://alishehab01.github.io"]);
  });

  it("splits a comma list and trims whitespace", () => {
    expect(parseAllowedOrigins("https://a.example.com, https://b.example.com ,https://c.example.com"))
      .toEqual(["https://a.example.com", "https://b.example.com", "https://c.example.com"]);
  });
});

describe("withOwnerCors", () => {
  it("reflects an allow-listed origin and sets Vary: Origin on a normal response", async () => {
    const wrapped = withOwnerCors([ALLOWED], handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders", { headers: { origin: ALLOWED } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("never reflects a disallowed origin", async () => {
    const wrapped = withOwnerCors([ALLOWED], handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders", { headers: { origin: OTHER } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    // The inner handler still runs — CORS is a browser-side read restriction, not the access control.
    expect(res.status).toBe(200);
  });

  it("passes a request with no Origin header straight through, unchanged", async () => {
    const wrapped = withOwnerCors([ALLOWED], handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an allowed preflight (OPTIONS) without reaching the handler", async () => {
    let reached = false;
    const wrapped = withOwnerCors([ALLOWED], async () => { reached = true; return new Response("ok"); });
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders", {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    }));
    expect(reached).toBe(false);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("answers a disallowed preflight with no CORS headers", async () => {
    const wrapped = withOwnerCors([ALLOWED], async () => new Response("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders", {
      method: "OPTIONS",
      headers: { origin: OTHER, "access-control-request-method": "GET" },
    }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("answers a preflight with no Origin header at all with no CORS headers", async () => {
    const wrapped = withOwnerCors([ALLOWED], async () => new Response("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never sets Access-Control-Allow-Credentials", async () => {
    const wrapped = withOwnerCors([ALLOWED], handlerReturning("ok"));
    const preflight = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner", { method: "OPTIONS", headers: { origin: ALLOWED } }));
    const actual = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner", { headers: { origin: ALLOWED } }));
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(actual.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("supports more than one allow-listed origin", async () => {
    const second = "https://second.example.com";
    const wrapped = withOwnerCors([ALLOWED, second], handlerReturning("ok"));
    const res = await wrapped(new Request("https://x.supabase.co/functions/v1/orderat-owner", { headers: { origin: second } }));
    expect(res.headers.get("access-control-allow-origin")).toBe(second);
  });
});
