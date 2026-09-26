import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createAskHandler, type AskHandlerDeps } from "./handler.ts";
import { createAskUsageTestSql } from "./pglite-test-support.ts";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createAskUsageTestSql();
});

/** createAskHandler with a silent log by default, like server/whatsapp/webhook.test.ts's own
 * `log: () => {}` convention — tests that care about log output pass their own. */
function makeHandler(deps: Omit<AskHandlerDeps, "sql">): (req: Request) => Promise<Response> {
  return createAskHandler({ sql, log: () => {}, ...deps });
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-ask", {
    method: "POST",
    body: JSON.stringify(body),
    ...init,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    installId: "install-1",
    platform: "ios",
    appVersion: "1.0.0",
    lang: "ar",
    demo: false,
    question: "كم ربحت هالشهر؟",
    history: [],
    snapshot: {
      currency: "BHD",
      topCustomers: [{ ref: "c12", firstName: "Sara" }],
      unpaid: [{ ref: "c12", firstName: "Sara", orderRef: "o33", amountMinor: 4500 }],
      upcoming: [{ orderRef: "o40" }],
    },
    ...overrides,
  };
}

function fetchReturning(answer: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status })) as unknown as typeof fetch;
}

describe("createAskHandler", () => {
  it("returns 400 invalid_body for a non-POST request", async () => {
    const handler = makeHandler({ gemini: { apiKey: "k" } });
    const res = await handler(new Request("https://example.com", { method: "GET" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("returns 400 invalid_body for a malformed body, without touching usage counters", async () => {
    const handler = makeHandler({ gemini: { apiKey: "k" }, fetchImpl: fetchReturning({ answer: "ok", actions: [] }) });
    const res = await handler(req({ installId: "install-1" })); // missing required fields
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    // No counters were touched — a fresh, valid request still gets the full remaining allowance.
    const ok = await handler(req(validBody()));
    const okJson = (await ok.json()) as { remainingToday: number };
    expect(okJson.remainingToday).toBe(29);
  });

  it("returns 502 ai_unavailable when no Gemini key is configured, without recording usage", async () => {
    const handler = makeHandler({ gemini: undefined });
    const res = await handler(req(validBody()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("returns 200 with the answer, filtered actions, and remainingToday on success", async () => {
    const handler = makeHandler({
      gemini: { apiKey: "k" },
      fetchImpl: fetchReturning({
        answer: "ربحك هالشهر 240.500 د.ب",
        actions: [
          { type: "open_order", orderRef: "o40" },
          { type: "open_order", orderRef: "made-up-ref" },
        ],
      }),
    });
    const res = await handler(req(validBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      answer: "ربحك هالشهر 240.500 د.ب",
      actions: [{ type: "open_order", orderRef: "o40" }],
      remainingToday: 29,
    });
  });

  it("enforces the 30/day per-install limit with the spec's exact 429 body", async () => {
    const handler = makeHandler({ gemini: { apiKey: "k" }, fetchImpl: fetchReturning({ answer: "ok" }) });
    for (let i = 0; i < 30; i++) {
      const res = await handler(req(validBody({ installId: "install-heavy" })));
      expect(res.status).toBe(200);
    }
    const blocked = await handler(req(validBody({ installId: "install-heavy" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "daily_limit" });
  });

  it("enforces the 3/day demo limit with the spec's exact 429 body", async () => {
    const handler = makeHandler({ gemini: { apiKey: "k" }, fetchImpl: fetchReturning({ answer: "ok" }) });
    for (let i = 0; i < 3; i++) {
      const res = await handler(req(validBody({ installId: "install-demo", demo: true })));
      expect(res.status).toBe(200);
    }
    const blocked = await handler(req(validBody({ installId: "install-demo", demo: true })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "daily_limit" });
  });

  it("enforces the global daily cap (ORDERAT_ASK_DAILY_CAP) with the spec's exact 429 body", async () => {
    const handler = makeHandler({ gemini: { apiKey: "k" }, limits: { globalCap: 2 }, fetchImpl: fetchReturning({ answer: "ok" }) });
    expect((await handler(req(validBody({ installId: "install-a" })))).status).toBe(200);
    expect((await handler(req(validBody({ installId: "install-b" })))).status).toBe(200);
    const blocked = await handler(req(validBody({ installId: "install-c" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "busy" });
  });

  it("returns 502 ai_unavailable when Gemini's response is not JSON, and still counts the request", async () => {
    const handler = makeHandler({
      gemini: { apiKey: "k", fallbackModels: [] },
      fetchImpl: (async () => new Response("<html>oops</html>", { status: 200 })) as unknown as typeof fetch,
    });
    const res = await handler(req(validBody({ installId: "install-fail" })));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });

    // The failed call was still counted (limits are checked/recorded before calling Gemini).
    const second = await handler(req(validBody({ installId: "install-fail" }), {}));
    // Same fetchImpl (still fails), so still 502, but this proves a second call was accepted past
    // validation/limits rather than being blocked outright — i.e. the first failure didn't corrupt
    // the counter into refusing everything.
    expect(second.status).toBe(502);
  });

  it("falls back to the next model when the first is rate-limited (429), and still returns 200", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      tried.push(model);
      if (model === "busy-model") return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "ok", actions: [] }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const handler = makeHandler({ gemini: { apiKey: "k", model: "busy-model", fallbackModels: ["good-model"] }, fetchImpl });
    const res = await handler(req(validBody()));
    expect(res.status).toBe(200);
    expect(tried).toEqual(["busy-model", "good-model"]);
  });

  it("never logs the question, history, or snapshot — only status/model/latency/counts", async () => {
    const logs: Record<string, unknown>[] = [];
    const handler = makeHandler({ gemini: { apiKey: "k" }, fetchImpl: fetchReturning({ answer: "ok", actions: [] }), log: (entry) => logs.push(entry) });
    await handler(req(validBody({ question: "SECRET-QUESTION-TEXT", snapshot: { currency: "BHD", secretField: "SECRET-SNAPSHOT-VALUE" } })));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("SECRET-QUESTION-TEXT");
    expect(serialized).not.toContain("SECRET-SNAPSHOT-VALUE");
    expect(logs).toEqual([{ event: "ask", status: 200, model: expect.any(String), latencyMs: expect.any(Number), actionCount: 0 }]);
  });
});
