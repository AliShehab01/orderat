import { describe, expect, it } from "vitest";
import { withHostedOwnerPath } from "./hosted-path";

const PREFIX = "/functions/v1/orderat-owner";

function echo() {
  return withHostedOwnerPath(PREFIX, async (req) => {
    const url = new URL(req.url);
    return new Response(JSON.stringify({
      pathname: url.pathname,
      search: url.search,
      method: req.method,
      authorization: req.headers.get("authorization"),
    }));
  });
}

describe("withHostedOwnerPath", () => {
  it("also strips the short /<function-name> prefix the deployed function really sees", async () => {
    const handler = withHostedOwnerPath(["/functions/v1/orderat-owner", "/orderat-owner"], async (req) => new Response(new URL(req.url).pathname));
    expect(await (await handler(new Request("https://x.supabase.co/orderat-owner/api/orders"))).text()).toBe("/owner/api/orders");
    expect(await (await handler(new Request("https://x.supabase.co/functions/v1/orderat-owner/api/orders"))).text()).toBe("/owner/api/orders");
    expect(await (await handler(new Request("https://x.supabase.co/orderat-owner"))).text()).toBe("/owner");
  });

  it("rewrites the bare function URL to /owner", async () => {
    const res = await echo()(new Request(`https://x.supabase.co${PREFIX}`));
    expect(await res.json()).toMatchObject({ pathname: "/owner" });
  });

  it("rewrites a sub-path onto /owner/...", async () => {
    const res = await echo()(new Request(`https://x.supabase.co${PREFIX}/api/orders`));
    expect(await res.json()).toMatchObject({ pathname: "/owner/api/orders" });
  });

  it("rewrites the confirm route and preserves the method", async () => {
    const res = await echo()(new Request(`https://x.supabase.co${PREFIX}/api/orders/abc-123/confirm`, { method: "POST" }));
    expect(await res.json()).toMatchObject({ pathname: "/owner/api/orders/abc-123/confirm", method: "POST" });
  });

  it("preserves headers such as Authorization", async () => {
    const res = await echo()(new Request(`https://x.supabase.co${PREFIX}/api/orders`, { headers: { authorization: "Bearer s3cret" } }));
    expect(await res.json()).toMatchObject({ authorization: "Bearer s3cret" });
  });

  it("preserves the query string", async () => {
    const res = await echo()(new Request(`https://x.supabase.co${PREFIX}/api/orders?foo=bar`));
    expect(await res.json()).toMatchObject({ pathname: "/owner/api/orders", search: "?foo=bar" });
  });

  it("falls back to prefixing the whole path when it doesn't start with the given prefix", async () => {
    const res = await echo()(new Request("https://x.supabase.co/something-else"));
    expect(await res.json()).toMatchObject({ pathname: "/owner/something-else" });
  });
});
