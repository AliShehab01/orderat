import { describe, expect, it } from "vitest";
import { withOwnerAuth } from "./auth";

const KEY = "s3cret-owner-key";

describe("owner auth", () => {
  it("refuses every request when OWNER_KEY is not configured", async () => {
    const handler = withOwnerAuth(undefined, async () => new Response("ok"));
    const res = await handler(new Request("https://x.supabase.co/functions/v1/owner"));
    expect(res.status).toBe(500);
  });

  it("rejects requests with no key at all", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const res = await handler(new Request("https://x.supabase.co/functions/v1/owner"));
    expect(res.status).toBe(401);
  });

  it("signs in with ?key=, setting an HttpOnly Secure SameSite=Strict cookie and redirecting", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const res = await handler(new Request(`https://x.supabase.co/functions/v1/owner?key=${KEY}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/functions/v1/owner");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("orderat_owner=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("rejects a wrong key on the sign-in URL", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const res = await handler(new Request("https://x.supabase.co/functions/v1/owner?key=wrong"));
    expect(res.status).toBe(401);
  });

  it("accepts the cookie set at sign-in on a later request", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const signIn = await handler(new Request(`https://x.supabase.co/functions/v1/owner?key=${KEY}`));
    const setCookie = signIn.headers.get("set-cookie")!;
    const cookiePair = setCookie.split(";")[0];
    const res = await handler(new Request("https://x.supabase.co/functions/v1/owner/api/orders", { headers: { cookie: cookiePair } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("accepts an Authorization: Bearer header for API calls", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const res = await handler(new Request("https://x.supabase.co/functions/v1/owner/api/orders", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(res.status).toBe(200);
  });

  it("rejects a wrong bearer token and a wrong cookie", async () => {
    const handler = withOwnerAuth(KEY, async () => new Response("ok"));
    const wrongBearer = await handler(new Request("https://x.supabase.co/functions/v1/owner/api/orders", { headers: { authorization: "Bearer nope" } }));
    expect(wrongBearer.status).toBe(401);
    const wrongCookie = await handler(new Request("https://x.supabase.co/functions/v1/owner/api/orders", { headers: { cookie: "orderat_owner=nope" } }));
    expect(wrongCookie.status).toBe(401);
  });
});

describe("withOwnerAuth responses are fresh per request", () => {
  it("can answer unauthorized many times (a Response body can only be read once)", async () => {
    const guarded = withOwnerAuth("k", async () => new Response("ok"));
    for (let i = 0; i < 3; i++) {
      const res = await guarded(new Request("http://localhost/owner/api/orders"));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("Unauthorized");
    }
  });

  it("can answer 'not configured' many times", async () => {
    const guarded = withOwnerAuth(undefined, async () => new Response("ok"));
    for (let i = 0; i < 2; i++) {
      const res = await guarded(new Request("http://localhost/owner"));
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("OWNER_KEY");
    }
  });
});
