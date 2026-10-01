// server/parse never touches the cloud (auth/sync) tables at all — its only database access is the
// generic feature-usage ledger from db/migrations/0003_marketing.sql (server/usage/feature-limits.ts),
// the same one server/studio's caption/photo tasks use — so these tests reuse
// server/marketing-pglite-test-support.ts rather than the cloud bootstrap. No test here ever calls a
// real network: every Gemini request goes through a fake `fetch` built the same way
// server/ai/gemini.test.ts's own fakeGemini does.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createSession, newSessionToken, upsertUser } from "../auth/store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import { createParseHandler } from "./handler.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let sql: SqlClient;

function fakeGemini(result: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

function failingGemini(status = 500) {
  return (async () => new Response("busy", { status })) as unknown as typeof fetch;
}

function makeHandler(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return createParseHandler({ sql, ipSalt: "test-ip-salt", gemini: { apiKey: "test-key" }, now: () => NOW, log: () => {}, fetchImpl, ...overrides });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/orderat-parse", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return { installId: "install-1", platform: "ios", appVersion: "1.0.0", text: "2 cakes for tomorrow, call 33123456", products: [{ id: "p1", name: "Cake", aliases: [] }], ...overrides };
}

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

describe("createParseHandler / happy path", () => {
  it("returns a draft, lang and remainingToday for a text-only request", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [{ productId: "p1", rawText: "2 cakes", quantity: 2 }] }));
    const res = await handler(post(baseBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lang).toBe("en");
    expect(body.draft.items).toEqual([{ productId: "p1", rawText: "2 cakes", quantity: 2, confidence: "high" }]);
    expect(body.remainingToday).toBe(49);
  });

  it("strips a phone number from the text before it reaches Gemini", async () => {
    const capture: { init?: RequestInit } = {};
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }, capture));
    await handler(post(baseBody({ text: "call me at 33123456 for the order" })));
    const sentText = JSON.parse(String(capture.init!.body)).contents[0].parts.find((p: { text?: string }) => p.text?.startsWith("Customer message"))?.text as string;
    expect(sentText).not.toContain("33123456");
    expect(sentText).toContain("call me at");
  });

  it("accepts a screenshot image and forwards its bytes as inlineData", async () => {
    const capture: { init?: RequestInit } = {};
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }, capture));
    const res = await handler(post(baseBody({ text: undefined, image: { mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") } })));
    expect(res.status).toBe(200);
    const parts = JSON.parse(String(capture.init!.body)).contents[0].parts;
    expect(parts.some((p: { inlineData?: { mimeType: string } }) => p.inlineData?.mimeType === "image/jpeg")).toBe(true);
  });

  it("maps a bare product list (no nameAr) so the extractor still gets a usable menu line", async () => {
    const capture: { init?: RequestInit } = {};
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }, capture));
    await handler(post(baseBody({ products: [{ id: "p1", name: "Cake", aliases: ["gato"] }] })));
    const prompt = JSON.parse(String(capture.init!.body)).contents[0].parts[0].text as string;
    expect(prompt).toContain("p1: Cake / Cake / gato");
  });
});

describe("createParseHandler / image validation", () => {
  it("rejects an image whose declared mimeType doesn't match its magic number", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    const res = await handler(post(baseBody({ text: undefined, image: { mimeType: "image/png", data: JPEG_BYTES.toString("base64") } })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("rejects an image over 2 MB decoded with too_large", async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    const res = await handler(post(baseBody({ text: undefined, image: { mimeType: "image/jpeg", data: big.toString("base64") } })));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("rejects invalid base64 image data", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    const res = await handler(post(baseBody({ text: undefined, image: { mimeType: "image/jpeg", data: "not base64!!" } })));
    expect(res.status).toBe(400);
  });
});

describe("createParseHandler / limits", () => {
  it("returns ai_unavailable when Gemini isn't configured", async () => {
    const handler = createParseHandler({ sql, ipSalt: "test-ip-salt", now: () => NOW, log: () => {}, fetchImpl: fakeGemini({}) });
    const res = await handler(post(baseBody()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("returns ai_unavailable when every Gemini model fails", async () => {
    const handler = makeHandler(failingGemini(500));
    const res = await handler(post(baseBody()));
    expect(res.status).toBe(502);
  });

  it("blocks the 51st parse of the day for a non-demo install (50/day)", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    for (let i = 0; i < 50; i++) expect((await handler(post(baseBody()))).status).toBe(200);
    const res = await handler(post(baseBody()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
  });

  it("blocks the 6th demo parse of the day (5/day in demo mode)", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    for (let i = 0; i < 5; i++) expect((await handler(post(baseBody({ demo: true })))).status).toBe(200);
    const res = await handler(post(baseBody({ demo: true })));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
  });

  it("blocks with busy once the global cap is reached, even for an install under its own limit", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }), { limits: { globalCap: 1 } });
    expect((await handler(post(baseBody({ installId: "install-a" })))).status).toBe(200);
    const res = await handler(post(baseBody({ installId: "install-b" })));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "busy" });
  });

  it("never counts a request that fails body validation against the daily limit", async () => {
    const handler = makeHandler(fakeGemini({ isOrder: true, language: "en", items: [] }));
    await handler(post({ installId: "install-1", platform: "ios", appVersion: "1.0.0", products: [] })); // No text/image: invalid_body.
    const res = await handler(post(baseBody()));
    expect((await res.json()).remainingToday).toBe(49); // Still the first real request of the day.
  });
});

// Security review 1 Oct 2026, F02: limits a client cannot reset by changing installId or claiming demo=false.
describe("createParseHandler / limits a client cannot reset", () => {
  const empty = () => fakeGemini({ isOrder: true, language: "en", items: [] });

  it("a new installId on every request stops at the client IP's cap (demo or not)", async () => {
    const handler = makeHandler(empty(), { limits: { perIp: 4 } });
    for (let i = 0; i < 4; i++) expect((await handler(post(baseBody({ installId: `fresh-${i}`, demo: i % 2 === 0 }), { "x-forwarded-for": "203.0.113.7" }))).status).toBe(200);
    const res = await handler(post(baseBody({ installId: "fresh-new", demo: true }), { "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
  });

  it("demo=false without a session gets the stricter per-IP cap, and remainingToday shows it", async () => {
    const handler = makeHandler(empty(), { limits: { perIpPaidClaim: 2 } });
    const first = await handler(post(baseBody({ installId: "paid-1" }), { "x-forwarded-for": "203.0.113.7" }));
    expect((await first.json()).remainingToday).toBe(1);
    expect((await handler(post(baseBody({ installId: "paid-2" }), { "x-forwarded-for": "203.0.113.7" }))).status).toBe(200);
    expect((await handler(post(baseBody({ installId: "paid-3" }), { "x-forwarded-for": "203.0.113.7" }))).status).toBe(429);
    // A demo request from the same IP still has the IP's wider budget.
    expect((await handler(post(baseBody({ installId: "demo-1", demo: true }), { "x-forwarded-for": "203.0.113.7" }))).status).toBe(200);
  });

  it("signed in, the quota is the account's own: new installIds and IPs share it", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "google", providerSub: "google-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id, now: NOW });
    const handler = makeHandler(empty(), { limits: { perInstallDemo: 2 } });
    const headers = (ip: string) => ({ "x-forwarded-for": ip, "x-orderat-session": token });
    expect((await handler(post(baseBody({ installId: "a", demo: true }), headers("203.0.113.7")))).status).toBe(200);
    expect((await handler(post(baseBody({ installId: "b", demo: true }), headers("198.51.100.9")))).status).toBe(200);
    expect((await handler(post(baseBody({ installId: "c", demo: true }), headers("192.0.2.1")))).status).toBe(429);
  });
});

describe("createParseHandler / request shape", () => {
  it("rejects a non-POST request", async () => {
    const handler = makeHandler(fakeGemini({}));
    const res = await handler(new Request("https://example.test/orderat-parse", { method: "GET" }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const handler = makeHandler(fakeGemini({}));
    const res = await handler(new Request("https://example.test/orderat-parse", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("rejects a body with neither text nor image", async () => {
    const handler = makeHandler(fakeGemini({}));
    const res = await handler(post({ installId: "install-1", platform: "ios", appVersion: "1.0.0", products: [] }));
    expect(res.status).toBe(400);
  });
});
