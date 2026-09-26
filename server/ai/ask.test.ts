import { describe, expect, it } from "vitest";
import { askGemini, GeminiAskError } from "./ask.ts";

function fakeGemini(result: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("askGemini", () => {
  it("sends the key in a header, the prompt as the user content, and returns the model + parsed answer", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const result = await askGemini(
      { apiKey: "k-123", model: "gemini-3.6-flash" },
      "the prompt text",
      fakeGemini({ answer: "ربحك هالشهر 240.500 د.ب", actions: [] }, capture),
    );
    expect(capture.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
    expect((capture.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
    const body = JSON.parse(String(capture.init!.body));
    expect(body.contents[0].parts[0].text).toBe("the prompt text");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(result.model).toBe("gemini-3.6-flash");
    expect(result.answer).toEqual({ answer: "ربحك هالشهر 240.500 د.ب", actions: [] });
  });

  it("defaults actions to [] when Gemini omits them", async () => {
    const result = await askGemini({ apiKey: "k" }, "prompt", fakeGemini({ answer: "hi" }));
    expect(result.answer.actions).toEqual([]);
  });

  it("passes actions through unvalidated — that is server/ask/actions.ts's job, not this file's", async () => {
    const raw = [{ type: "made_up_type", foo: "bar" }];
    const result = await askGemini({ apiKey: "k" }, "prompt", fakeGemini({ answer: "hi", actions: raw }));
    expect(result.answer.actions).toEqual(raw);
  });

  it("throws GeminiAskError when the 200 response body is not JSON", async () => {
    const fetchImpl = (async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(askGemini({ apiKey: "k", fallbackModels: [] }, "prompt", fetchImpl)).rejects.toThrow(GeminiAskError);
  });

  it("throws GeminiAskError when Gemini's answer has no usable answer text", async () => {
    await expect(askGemini({ apiKey: "k" }, "prompt", fakeGemini({ answer: "" }))).rejects.toThrow(GeminiAskError);
    await expect(askGemini({ apiKey: "k" }, "prompt", fakeGemini({ actions: [] }))).rejects.toThrow(GeminiAskError);
  });

  it("throws GeminiAskError (wrapping the network/model failure) when every model fails", async () => {
    const fetchImpl = (async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 })) as unknown as typeof fetch;
    await expect(askGemini({ apiKey: "bad", fallbackModels: [] }, "prompt", fetchImpl)).rejects.toThrow(GeminiAskError);
  });

  it("falls back to the next model when the first is rate-limited (429)", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      tried.push(model);
      if (model === "busy-model") return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "ok", actions: [] }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await askGemini({ apiKey: "k", model: "busy-model", fallbackModels: ["good-model"] }, "prompt", fetchImpl);
    expect(tried).toEqual(["busy-model", "good-model"]);
    expect(result.model).toBe("good-model");
    expect(result.answer.answer).toBe("ok");
  });

  it("uses the default model and fallback list when none are given", async () => {
    const capture: { url?: string } = {};
    await askGemini({ apiKey: "k" }, "prompt", fakeGemini({ answer: "ok" }, capture));
    expect(capture.url).toContain("gemini-3.6-flash");
  });
});
