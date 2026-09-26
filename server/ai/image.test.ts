import { describe, expect, it } from "vitest";
import { callGeminiImage, GeminiImageBlockedError, GeminiImageUnavailableError } from "./image";

function imageResponse(mimeType: string, base64: string, status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: base64 } }] } }] }), { status });
}

describe("callGeminiImage", () => {
  it("returns the decoded image bytes and the model that produced them", async () => {
    const fetchImpl = (async () => imageResponse("image/png", "aGVsbG8=")) as unknown as typeof fetch;
    const result = await callGeminiImage(["good-model"], "k", "{}", 1000, fetchImpl);
    expect(result.model).toBe("good-model");
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toEqual(new TextEncoder().encode("hello"));
  });

  it("sends the key in a header, never the URL", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capture.url = url;
      capture.init = init;
      return imageResponse("image/png", "aGVsbG8=");
    }) as unknown as typeof fetch;
    await callGeminiImage(["good-model"], "k-secret", '{"contents":[]}', 1000, fetchImpl);
    expect(capture.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/good-model:generateContent");
    expect(capture.url).not.toContain("k-secret");
    expect((capture.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-secret");
  });

  it("moves to the next model when one is busy or retired", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      tried.push(model);
      if (model === "busy-model") return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 });
      if (model === "gone-model") return new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 });
      return imageResponse("image/png", "aGVsbG8=");
    }) as unknown as typeof fetch;
    const result = await callGeminiImage(["busy-model", "gone-model", "good-model"], "k", "{}", 1000, fetchImpl);
    expect(tried).toEqual(["busy-model", "gone-model", "good-model"]);
    expect(result.model).toBe("good-model");
  });

  it("falls through to the next model when one hangs past the timeout", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const model = url.split("/models/")[1].split(":")[0];
      tried.push(model);
      if (model === "hung-model") {
        return new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return imageResponse("image/png", "aGVsbG8=");
    }) as unknown as typeof fetch;
    const result = await callGeminiImage(["hung-model", "good-model"], "k", "{}", 20, fetchImpl);
    expect(tried).toEqual(["hung-model", "good-model"]);
    expect(result.model).toBe("good-model");
  });

  it("throws GeminiImageUnavailableError when every model returns 429/5xx", async () => {
    const fetchImpl = (async () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 })) as unknown as typeof fetch;
    await expect(callGeminiImage(["model-a", "model-b"], "k", "{}", 1000, fetchImpl)).rejects.toThrow(GeminiImageUnavailableError);
  });

  it("throws GeminiImageUnavailableError when the response body isn't JSON", async () => {
    const fetchImpl = (async () => new Response("<html>oops</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(callGeminiImage(["model-a"], "k", "{}", 1000, fetchImpl)).rejects.toThrow(GeminiImageUnavailableError);
  });

  it("throws GeminiImageBlockedError when Gemini's safety filter blocks the prompt", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }],
      promptFeedback: { blockReason: "SAFETY" },
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(callGeminiImage(["model-a"], "k", "{}", 1000, fetchImpl)).rejects.toThrow(GeminiImageBlockedError);
    await expect(callGeminiImage(["model-a"], "k", "{}", 1000, fetchImpl)).rejects.toThrow(/SAFETY/);
  });

  it("throws GeminiImageBlockedError when the response has candidates but no image part", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "sorry, I can't generate that" }] }, finishReason: "STOP" }],
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(callGeminiImage(["model-a"], "k", "{}", 1000, fetchImpl)).rejects.toThrow(GeminiImageBlockedError);
  });

  it("defaults a missing mimeType to image/png", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "aGVsbG8=" } }] } }] }))) as unknown as typeof fetch;
    const result = await callGeminiImage(["model-a"], "k", "{}", 1000, fetchImpl);
    expect(result.mimeType).toBe("image/png");
  });
});
