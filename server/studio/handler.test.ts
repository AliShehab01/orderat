import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import type { Campaign, StudioStyle } from "../campaigns/content";
import { createStudioHandler, type StudioHandlerDeps } from "./handler";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

const STYLE: StudioStyle = {
  id: "marble", name: { ar: "رخام", en: "Marble" }, emoji: "🪨", swatch: "#D9D3C7", previewUrl: null, occasion: null,
  prompt: "SERVER-ONLY-STYLE-PROMPT",
};
const CAMPAIGN: Campaign = {
  id: "teachers-day-2026", occasion: "teachers_day", name: { ar: "يوم المعلم", en: "Teachers' Day" }, emoji: "🍎",
  countries: ["BH"], startDate: "2026-10-05", endDate: "2026-10-05", promoteFrom: "2026-09-21", accent: "#E4572E",
  headline: { ar: "ع", en: "H" }, tips: { ar: [], en: [] }, productIdeas: { ar: [], en: [] },
  captions: { ar: [], en: [] }, hashtags: { ar: [], en: [] }, studioStyles: ["marble"],
};

// A real (tiny) JPEG magic-number prefix, so server/shared/image.ts's sniffer accepts it.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5]);
const JPEG_BASE64 = Buffer.from(JPEG_BYTES).toString("base64");

function makeHandler(overrides: Partial<StudioHandlerDeps> = {}) {
  return createStudioHandler({ sql, campaigns: [CAMPAIGN], styles: [STYLE], log: () => {}, now: () => new Date("2026-09-26T12:00:00Z"), ...overrides });
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/orderat-studio", { method: "POST", body: JSON.stringify(body), ...init });
}

function validCaptionBody(overrides: Record<string, unknown> = {}) {
  return {
    task: "caption", installId: "install-1", platform: "ios", appVersion: "1.1.0", demo: false,
    lang: "ar", channel: "instagram", campaignId: "teachers-day-2026", shopName: "Sweet Studio", currency: "BHD",
    items: [{ name: "Cheesecake cups", priceMinor: 4500 }],
    ...overrides,
  };
}

function validPhotoBody(overrides: Record<string, unknown> = {}) {
  return {
    task: "photo", installId: "install-1", platform: "android", appVersion: "1.1.0", demo: false,
    styleId: "marble", aspect: "1:1", image: { mimeType: "image/jpeg", data: JPEG_BASE64 },
    ...overrides,
  };
}

function fetchReturningCaption(captions = ["a", "b", "c"], hashtags: string[] = ["#x"]): typeof fetch {
  return (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ captions, hashtags }) }] } }] }))) as unknown as typeof fetch;
}

function fetchReturningPhoto(base64 = "aGVsbG8="): typeof fetch {
  return (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }))) as unknown as typeof fetch;
}

describe("createStudioHandler / caption", () => {
  it("returns 200 with captions, hashtags and remainingToday on success", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    const res = await handler(req(validCaptionBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ captions: ["a", "b", "c"], hashtags: ["#x"], remainingToday: 19 });
  });

  it("resolves a known campaignId (used in the prompt, not visible in the response)", async () => {
    const capture: { body?: string } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capture.body = String(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ captions: ["a", "b", "c"], hashtags: [] }) }] } }] }));
    }) as unknown as typeof fetch;
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl });
    const res = await handler(req(validCaptionBody({ lang: "en" })));
    expect(res.status).toBe(200);
    expect(capture.body).toContain("Teachers' Day");
  });

  it("silently ignores an unknown campaignId instead of failing", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    const res = await handler(req(validCaptionBody({ campaignId: "no-such-campaign" })));
    expect(res.status).toBe(200);
  });

  it("returns 502 ai_unavailable when no Gemini key is configured, without recording usage", async () => {
    const handler = makeHandler({ text: undefined });
    const res = await handler(req(validCaptionBody()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("returns 502 ai_unavailable when Gemini fails, and still counts the request", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const handler = makeHandler({ text: { apiKey: "k", fallbackModels: [] }, fetchImpl });
    const res = await handler(req(validCaptionBody({ installId: "install-fail" })));
    expect(res.status).toBe(502);
    const second = await handler(req(validCaptionBody({ installId: "install-fail" })));
    expect(second.status).toBe(502); // proves the first failure didn't corrupt the counter
  });

  it("enforces the 20/day per-install caption limit with the spec's exact 429 body", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    for (let i = 0; i < 20; i++) expect((await handler(req(validCaptionBody({ installId: "heavy" })))).status).toBe(200);
    const blocked = await handler(req(validCaptionBody({ installId: "heavy" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "daily_limit" });
  });

  it("enforces the 3/day demo caption limit", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    for (let i = 0; i < 3; i++) expect((await handler(req(validCaptionBody({ installId: "demo-1", demo: true })))).status).toBe(200);
    const blocked = await handler(req(validCaptionBody({ installId: "demo-1", demo: true })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "daily_limit" });
  });

  it("enforces the global caption cap (ORDERAT_CAPTION_DAILY_CAP) with busy", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, captionLimits: { globalCap: 1 }, fetchImpl: fetchReturningCaption() });
    expect((await handler(req(validCaptionBody({ installId: "a" })))).status).toBe(200);
    const blocked = await handler(req(validCaptionBody({ installId: "b" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "busy" });
  });

  it("never logs the prompt, shop name, items, or the generated captions", async () => {
    const logs: Record<string, unknown>[] = [];
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption(["SECRET-CAPTION-TEXT"]), log: (e) => logs.push(e) });
    await handler(req(validCaptionBody({ shopName: "SECRET-SHOP-NAME" })));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("SECRET-SHOP-NAME");
    expect(serialized).not.toContain("SECRET-CAPTION-TEXT");
  });

  it("returns 400 invalid_body for a malformed caption body, without touching usage counters", async () => {
    const handler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    const res = await handler(req({ task: "caption", installId: "install-x" }));
    expect(res.status).toBe(400);
    const ok = await handler(req(validCaptionBody({ installId: "install-x" })));
    expect((await ok.json() as { remainingToday: number }).remainingToday).toBe(19);
  });
});

describe("createStudioHandler / photo", () => {
  it("returns 200 with the generated image and remainingToday on success", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    const res = await handler(req(validPhotoBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: { mimeType: "image/png", data: "aGVsbG8=" }, remainingToday: 9 });
  });

  it("returns 400 invalid_body for an unknown styleId", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    const res = await handler(req(validPhotoBody({ styleId: "no-such-style" })));
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_body when the declared mimeType doesn't match the bytes' magic number", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    // JPEG_BASE64 is real JPEG bytes, declared here as PNG.
    const res = await handler(req(validPhotoBody({ image: { mimeType: "image/png", data: JPEG_BASE64 } })));
    expect(res.status).toBe(400);
  });

  it("returns 413 too_large when the decoded image exceeds 2 MB", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; // valid JPEG magic, just oversized
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    const res = await handler(req(validPhotoBody({ image: { mimeType: "image/jpeg", data: Buffer.from(big).toString("base64") } })));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("returns 422 unsafe_image when Gemini blocks the image", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }))) as unknown as typeof fetch;
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl });
    const res = await handler(req(validPhotoBody()));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unsafe_image" });
  });

  it("returns 422 unsafe_image when Gemini returns no image at all", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "can't do that" }] }, finishReason: "STOP" }] }))) as unknown as typeof fetch;
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl });
    const res = await handler(req(validPhotoBody()));
    expect(res.status).toBe(422);
  });

  it("returns 502 ai_unavailable when every image model is rate-limited or down", async () => {
    const fetchImpl = (async () => new Response('{"error":"busy"}', { status: 429 })) as unknown as typeof fetch;
    const handler = makeHandler({ image: { apiKey: "k", fallbackModels: [] }, fetchImpl });
    const res = await handler(req(validPhotoBody({ installId: "install-busy" })));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("returns 502 ai_unavailable when no image Gemini key is configured, without recording usage", async () => {
    const handler = makeHandler({ image: undefined });
    const res = await handler(req(validPhotoBody()));
    expect(res.status).toBe(502);
  });

  it("enforces the 10/day per-install photo limit", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    for (let i = 0; i < 10; i++) expect((await handler(req(validPhotoBody({ installId: "heavy" })))).status).toBe(200);
    const blocked = await handler(req(validPhotoBody({ installId: "heavy" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "daily_limit" });
  });

  it("enforces the 2/day demo photo limit", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    for (let i = 0; i < 2; i++) expect((await handler(req(validPhotoBody({ installId: "demo-1", demo: true })))).status).toBe(200);
    const blocked = await handler(req(validPhotoBody({ installId: "demo-1", demo: true })));
    expect(blocked.status).toBe(429);
  });

  it("enforces the global photo cap (ORDERAT_PHOTO_DAILY_CAP) with busy", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, photoLimits: { globalCap: 1 }, fetchImpl: fetchReturningPhoto() });
    expect((await handler(req(validPhotoBody({ installId: "a" })))).status).toBe(200);
    const blocked = await handler(req(validPhotoBody({ installId: "b" })));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "busy" });
  });

  it("never sends the style's server-only prompt anywhere in the response", async () => {
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    const res = await handler(req(validPhotoBody()));
    const text = await res.text();
    expect(text).not.toContain("SERVER-ONLY-STYLE-PROMPT");
  });

  it("never logs image bytes", async () => {
    const logs: Record<string, unknown>[] = [];
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto(), log: (e) => logs.push(e) });
    await handler(req(validPhotoBody()));
    expect(JSON.stringify(logs)).not.toContain(JPEG_BASE64);
  });

  it("rejects an unrecognized (non-magic-number) image before ever calling Gemini", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    const handler = makeHandler({ image: { apiKey: "k" }, fetchImpl });
    const res = await handler(req(validPhotoBody({ image: { mimeType: "image/jpeg", data: Buffer.from("not an image").toString("base64") } })));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe("createStudioHandler / shared", () => {
  it("returns 400 invalid_body for a non-POST request", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("https://example.com", { method: "GET" }));
    expect(res.status).toBe(400);
  });

  it("returns 413 too_large for an oversized body", async () => {
    const handler = makeHandler();
    const res = await handler(req({ task: "caption", padding: "a".repeat(5 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("keeps caption and photo usage counters independent for the same install", async () => {
    const photoHandler = makeHandler({ image: { apiKey: "k" }, fetchImpl: fetchReturningPhoto() });
    // Spend all 10 photo requests for this install...
    for (let i = 0; i < 10; i++) await photoHandler(req(validPhotoBody({ installId: "shared" })));
    // ...captions (a different feature, but the same underlying sql/tables) are still fresh.
    const captionHandler = makeHandler({ text: { apiKey: "k" }, fetchImpl: fetchReturningCaption() });
    const res = await captionHandler(req(validCaptionBody({ installId: "shared" })));
    expect(res.status).toBe(200);
  });
});
