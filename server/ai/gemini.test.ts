import { describe, expect, it } from "vitest";
import { createGeminiExtractor } from "./gemini";
import { demoProducts } from "../../src/lib/plan";

// Monday 2026-09-21 09:00 Bahrain time.
const NOW = new Date("2026-09-21T06:00:00Z");

function fakeGemini(result: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("Gemini order extractor", () => {
  it("sends the voice note inline with the key in a header, not the URL", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const extract = createGeminiExtractor({ apiKey: "k-123", model: "gemini-3.6-flash" }, fakeGemini({ isOrder: true, language: "ar", items: [] }, capture));
    await extract({ media: { data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg; codecs=opus" }, products: demoProducts(), now: NOW });
    expect(capture.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
    expect(capture.url).not.toContain("k-123");
    expect((capture.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
    const body = JSON.parse(String(capture.init!.body));
    const parts = body.contents[0].parts;
    expect(parts.some((p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData?.mimeType === "audio/ogg" && p.inlineData.data === "AQID")).toBe(true);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("maps the AI answer to a draft in Bahrain time and drops unknown product ids", async () => {
    const extract = createGeminiExtractor({ apiKey: "k" }, fakeGemini({
      isOrder: true,
      language: "ar",
      customerName: "أم خالد",
      items: [
        { productId: "p-cupcake", rawText: "30 كب كيك فانيلا", quantity: 30 },
        { productId: "p-made-up", rawText: "كيكة شوكولاتة", quantity: 1 },
      ],
      collectionDate: "2026-09-26",
      collectionTime: "18:00",
      notes: "بدون مكسرات",
      oldQuantities: [],
      transcript: "هلا أختي، أنا أم خالد. ودي أطلب 30 كب كيك فانيلا...",
    }));
    const result = await extract({ media: { data: new Uint8Array([0]), mimeType: "audio/ogg" }, products: demoProducts(), now: NOW });
    expect(result.lang).toBe("ar");
    expect(result.sourceText).toContain("أم خالد");
    expect(result.draft.customerName).toBe("أم خالد");
    expect(result.draft.items).toEqual([
      { productId: "p-cupcake", rawText: "30 كب كيك فانيلا", quantity: 30, confidence: "high" },
      { productId: undefined, rawText: "كيكة شوكولاتة", quantity: 1, confidence: "high" },
    ]);
    expect(result.draft.collectionAt).toBe("2026-09-26T15:00:00.000Z");
    expect(result.draft.collectionConfidence).toBe("high");
    expect(result.draft.notes).toBe("بدون مكسرات");
  });

  it("returns no items when the message is not an order, but keeps a stated time", async () => {
    const extract = createGeminiExtractor({ apiKey: "k" }, fakeGemini({ isOrder: false, language: "ar", items: [{ rawText: "هلا", quantity: null }], collectionDate: "2026-09-24", collectionTime: "17:00" }));
    const result = await extract({ text: "الخميس الساعة 5 العصر", products: demoProducts(), now: NOW });
    expect(result.draft.items).toEqual([]);
    expect(result.draft.collectionAt).toBe("2026-09-24T14:00:00.000Z");
  });

  it("marks a date without a time as low confidence", async () => {
    const extract = createGeminiExtractor({ apiKey: "k" }, fakeGemini({ isOrder: true, language: "en", items: [{ productId: "p-brownie", rawText: "brownie box", quantity: 2 }], collectionDate: "2026-09-25", collectionTime: null }));
    const result = await extract({ text: "2 brownie box friday", products: demoProducts(), now: NOW });
    expect(result.draft.collectionConfidence).toBe("low");
    expect(result.draft.collectionAt).toBe("2026-09-25T07:00:00.000Z");
  });

  it("tells Gemini about the customer's open order so changes map to the right product", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const extract = createGeminiExtractor({ apiKey: "k" }, fakeGemini({ isOrder: true, language: "ar", items: [] }, capture));
    await extract({
      text: "خليها 35 كب مو 20",
      products: demoProducts(),
      now: NOW,
      openOrder: { items: [{ productId: "p-cheesecake", name: "Cheesecake cup", quantity: 20 }], collectionAt: "2026-09-26T07:00:00.000Z" },
    });
    const prompt = JSON.parse(String(capture.init!.body)).contents[0].parts[0].text as string;
    expect(prompt).toContain("p-cheesecake: Cheesecake cup × 20");
    expect(prompt).toContain("oldQuantities");
  });

  it("moves to the next model when one is busy or retired", async () => {
    const tried: string[] = [];
    const extract = createGeminiExtractor({ apiKey: "k", model: "busy-model", fallbackModels: ["gone-model", "good-model"] }, (async (url: string) => {
      tried.push(url.split("/models/")[1].split(":")[0]);
      if (url.includes("busy-model")) return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 });
      if (url.includes("gone-model")) return new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ isOrder: true, language: "en", items: [{ productId: "p-brownie", rawText: "brownie box", quantity: 2 }] }) }] } }] }));
    }) as unknown as typeof fetch);
    const result = await extract({ text: "2 brownie box", products: demoProducts(), now: NOW });
    expect(tried).toEqual(["busy-model", "gone-model", "good-model"]);
    expect(result.draft.items[0].quantity).toBe(2);
  });

  it("throws when Gemini answers with an error", async () => {
    const extract = createGeminiExtractor({ apiKey: "bad", fallbackModels: [] }, (async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 })) as unknown as typeof fetch);
    await expect(extract({ text: "hi", products: demoProducts(), now: NOW })).rejects.toThrow(/400/);
  });
});
