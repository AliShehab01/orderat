import { describe, expect, it } from "vitest";
import type { GeminiConfig } from "../ai/gemini";
import { generateCaptions, GeminiCaptionError } from "./caption";
import type { CaptionRequestBody } from "./validate";

const BODY: CaptionRequestBody = {
  task: "caption", installId: "install-1", platform: "ios", appVersion: "1.1.0", demo: false,
  lang: "ar", channel: "instagram", shopName: "Sweet Studio", currency: "BHD",
  items: [{ name: "Cheesecake cups", priceMinor: 4500 }],
};

function fakeGemini(result: unknown, status = 200) {
  return (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status })) as unknown as typeof fetch;
}

describe("generateCaptions", () => {
  it("returns exactly 3 captions and the hashtags, trimmed", async () => {
    const gemini: GeminiConfig = { apiKey: "k" };
    const fetchImpl = fakeGemini({ captions: ["one", "two", "three"], hashtags: ["#a", "#b"] });
    const result = await generateCaptions(gemini, BODY, undefined, fetchImpl);
    expect(result.captions).toEqual(["one", "two", "three"]);
    expect(result.hashtags).toEqual(["#a", "#b"]);
    expect(result.model).toBeTruthy();
  });

  it("uses temperature 0.9 and the JSON response schema", async () => {
    const capture: { body?: string } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capture.body = String(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ captions: ["a", "b", "c"], hashtags: [] }) }] } }] }));
    }) as unknown as typeof fetch;
    await generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl);
    const parsed = JSON.parse(capture.body!);
    expect(parsed.generationConfig.temperature).toBe(0.9);
    expect(parsed.generationConfig.responseMimeType).toBe("application/json");
  });

  it("sends the API key in a header, never the URL", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capture.url = url;
      capture.init = init;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ captions: ["a", "b", "c"], hashtags: [] }) }] } }] }));
    }) as unknown as typeof fetch;
    await generateCaptions({ apiKey: "k-secret" }, BODY, undefined, fetchImpl);
    expect(capture.url).not.toContain("k-secret");
    expect((capture.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-secret");
  });

  it("truncates a caption longer than 600 characters", async () => {
    const long = "a".repeat(700);
    const fetchImpl = fakeGemini({ captions: [long, "b", "c"], hashtags: [] });
    const result = await generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl);
    expect(result.captions[0]).toHaveLength(600);
  });

  it("drops extra captions beyond 3", async () => {
    const fetchImpl = fakeGemini({ captions: ["a", "b", "c", "d", "e"], hashtags: [] });
    const result = await generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl);
    expect(result.captions).toEqual(["a", "b", "c"]);
  });

  it("drops empty/blank captions before counting toward the required 3", async () => {
    const fetchImpl = fakeGemini({ captions: ["a", "", "  ", "b", "c"], hashtags: [] });
    const result = await generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl);
    expect(result.captions).toEqual(["a", "b", "c"]);
  });

  it("throws GeminiCaptionError when fewer than 3 usable captions come back", async () => {
    const fetchImpl = fakeGemini({ captions: ["only one"], hashtags: [] });
    await expect(generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl)).rejects.toThrow(GeminiCaptionError);
  });

  it("keeps only hashtags starting with # and caps them at 12", async () => {
    const hashtags = [...Array.from({ length: 15 }, (_, i) => `#tag${i}`), "no-hash", "#"];
    const fetchImpl = fakeGemini({ captions: ["a", "b", "c"], hashtags });
    const result = await generateCaptions({ apiKey: "k" }, BODY, undefined, fetchImpl);
    expect(result.hashtags).toHaveLength(12);
    expect(result.hashtags.every((h) => h.startsWith("#"))).toBe(true);
  });

  it("throws GeminiCaptionError when every model fails", async () => {
    const fetchImpl = (async () => new Response('{"error":"nope"}', { status: 429 })) as unknown as typeof fetch;
    await expect(generateCaptions({ apiKey: "k", fallbackModels: [] }, BODY, undefined, fetchImpl)).rejects.toThrow(GeminiCaptionError);
  });

  it("throws GeminiCaptionError when the response is not JSON", async () => {
    const fetchImpl = (async () => new Response("<html>oops</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(generateCaptions({ apiKey: "k", fallbackModels: [] }, BODY, undefined, fetchImpl)).rejects.toThrow(GeminiCaptionError);
  });

  it("falls back to the next model when the first is rate-limited", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      tried.push(model);
      if (model === "busy-model") return new Response('{"error":"busy"}', { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ captions: ["a", "b", "c"], hashtags: [] }) }] } }] }));
    }) as unknown as typeof fetch;
    const result = await generateCaptions({ apiKey: "k", model: "busy-model", fallbackModels: ["good-model"] }, BODY, undefined, fetchImpl);
    expect(tried).toEqual(["busy-model", "good-model"]);
    expect(result.captions).toEqual(["a", "b", "c"]);
  });
});
