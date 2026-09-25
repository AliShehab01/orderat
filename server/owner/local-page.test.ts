// Proves the local dev flow (server/dev.ts: withOwnerAuth + createOwnerHandler, cookie sign-in) still
// serves the owner page as HTML end-to-end, unaffected by the hosted-only wrappers added for
// supabase/functions/orderat-owner (server/owner/cors.ts, json-only.ts, hosted-path.ts, and
// withOwnerBearerAuth) — none of those wrap this composition, exactly as dev.ts does today.
import { describe, expect, it } from "vitest";
import { withOwnerAuth } from "./auth";
import { createOwnerHandler } from "./handler";
import { MemoryStore } from "../agent/store";
import { demoProducts } from "../../src/lib/plan";

const KEY = "local-dev-owner-key";

function localHandler() {
  const store = new MemoryStore();
  return withOwnerAuth(KEY, createOwnerHandler({ store, products: demoProducts(), senders: {} }));
}

describe("local owner page (server/dev.ts composition)", () => {
  it("signs in via ?key= and then serves the owner page as HTML using the cookie", async () => {
    const handler = localHandler();
    const signIn = await handler(new Request(`http://localhost:8787/owner?key=${KEY}`));
    expect(signIn.status).toBe(302);
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0];

    const page = await handler(new Request("http://localhost:8787/owner", { headers: { cookie } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("اوردرات");
  });

  it("also accepts a Bearer header locally, unaffected by the hosted bearer-only wrapper", async () => {
    const handler = localHandler();
    const page = await handler(new Request("http://localhost:8787/owner/api/orders", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(page.status).toBe(200);
  });
});
