import { describe, expect, it } from "vitest";
import { withOwnerApiOnly } from "./json-only";

describe("withOwnerApiOnly", () => {
  it("turns GET /owner into a JSON 404 instead of the HTML page", async () => {
    let reached = false;
    const wrapped = withOwnerApiOnly(async () => { reached = true; return new Response("<html>", { headers: { "content-type": "text/html" } }); });
    const res = await wrapped(new Request("http://localhost/owner"));
    expect(reached).toBe(false);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("turns GET /owner/ into a JSON 404 too", async () => {
    const wrapped = withOwnerApiOnly(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    const res = await wrapped(new Request("http://localhost/owner/"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves every other owner route untouched", async () => {
    const wrapped = withOwnerApiOnly(async (req) => new Response(JSON.stringify({ path: new URL(req.url).pathname })));
    const orders = await wrapped(new Request("http://localhost/owner/api/orders"));
    expect(await orders.json()).toEqual({ path: "/owner/api/orders" });
    const confirm = await wrapped(new Request("http://localhost/owner/api/orders/abc/confirm", { method: "POST" }));
    expect(await confirm.json()).toEqual({ path: "/owner/api/orders/abc/confirm" });
  });
});
