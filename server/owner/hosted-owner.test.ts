// End-to-end test of the exact composition supabase/functions/orderat-owner/index.ts wires up
// (CORS -> Bearer auth -> hosted path rewrite -> JSON-only -> the shared handler), using the real
// function URL shape, so a mistake in how those wrappers are stacked in index.ts would show up here
// rather than only after a real deploy.
import { describe, expect, it } from "vitest";
import { withOwnerCors, parseAllowedOrigins } from "./cors";
import { withOwnerBearerAuth } from "./auth";
import { withHostedOwnerPath } from "./hosted-path";
import { withOwnerApiOnly } from "./json-only";
import { createOwnerHandler } from "./handler";
import { MemoryStore } from "../agent/store";
import { handleCustomerMessage } from "../agent/reply";
import { demoProducts } from "../../src/lib/plan";

const KEY = "hosted-owner-key";
const ORIGIN = "https://alishehab01.github.io";
const PREFIX = "/functions/v1/orderat-owner";
const BASE = `https://ckjmbdbvlbxfofjgqiuj.supabase.co${PREFIX}`;
const NOW = new Date("2026-09-25T06:00:00Z");

function hostedHandler(store: MemoryStore, sent: { to: string }[]) {
  const rawOwnerHandler = createOwnerHandler({
    store,
    products: demoProducts(),
    senders: { whatsapp: async (to) => { sent.push({ to }); } },
  });
  const apiOnly = withOwnerApiOnly(rawOwnerHandler);
  const pathAdjusted = withHostedOwnerPath(PREFIX, apiOnly);
  const authed = withOwnerBearerAuth(KEY, pathAdjusted);
  return withOwnerCors(parseAllowedOrigins(undefined), authed);
}

describe("hosted owner function composition", () => {
  it("answers the CORS preflight before any auth is needed", async () => {
    const handler = hostedHandler(new MemoryStore(), []);
    const res = await handler(new Request(`${BASE}/api/orders`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("lists orders through the real function URL shape with Bearer auth and CORS", async () => {
    const store = new MemoryStore();
    await handleCustomerMessage({ channel: "whatsapp", id: "wamid.1", from: "97333333333", profileName: "Sara", type: "text", text: "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح" }, store, demoProducts(), NOW);
    const handler = hostedHandler(store, []);

    const res = await handler(new Request(`${BASE}/api/orders`, { headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const orders = await res.json();
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("pending");
  });

  it("confirms an order through the real function URL shape", async () => {
    const store = new MemoryStore();
    const { order } = await handleCustomerMessage({ channel: "whatsapp", id: "wamid.2", from: "97333333333", profileName: "Sara", type: "text", text: "بغيت 5 تشيز كيك كب للسبت الساعة 10 الصبح" }, store, demoProducts(), NOW);
    const sent: { to: string }[] = [];
    const handler = hostedHandler(store, sent);

    const res = await handler(new Request(`${BASE}/api/orders/${order!.id}/confirm`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` } }));
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ to: "97333333333" }]);
  });

  it("rejects a missing/wrong Bearer token even from an allowed origin", async () => {
    const handler = hostedHandler(new MemoryStore(), []);
    const res = await handler(new Request(`${BASE}/api/orders`, { headers: { origin: ORIGIN, authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
  });

  it("never serves the HTML owner page at the bare function URL — JSON 404 instead", async () => {
    const handler = hostedHandler(new MemoryStore(), []);
    const res = await handler(new Request(BASE, { headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` } }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
