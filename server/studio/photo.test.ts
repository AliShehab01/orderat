import { describe, expect, it } from "vitest";
import { GeminiImageBlockedError, GeminiImageUnavailableError } from "../ai/image";
import { DEFAULT_IMAGE_FALLBACK_MODELS, DEFAULT_IMAGE_MODEL, generatePhoto } from "./photo";

const INPUT_IMAGE = { mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) };

function imageFetch(base64: string) {
  return (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }))) as unknown as typeof fetch;
}

describe("generatePhoto", () => {
  it("returns a base64-encoded image and the model used", async () => {
    const result = await generatePhoto({ apiKey: "k" }, INPUT_IMAGE, "a style prompt", "1:1", imageFetch("aGVsbG8="));
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toBe("aGVsbG8=");
    expect(result.model).toBeTruthy();
  });

  it("uses the default image model chain when none is configured", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      tried.push(url.split("/models/")[1].split(":")[0]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    }) as unknown as typeof fetch;
    await generatePhoto({ apiKey: "k" }, INPUT_IMAGE, "prompt", "1:1", fetchImpl);
    expect(tried).toEqual([DEFAULT_IMAGE_MODEL]);
    expect(DEFAULT_IMAGE_FALLBACK_MODELS).toEqual(["gemini-2.5-flash-image"]);
  });

  it("sends the input image inline, the style+guardrail prompt as text, and the requested aspect ratio", async () => {
    const capture: { body?: string } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capture.body = String(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    }) as unknown as typeof fetch;
    await generatePhoto({ apiKey: "k" }, INPUT_IMAGE, "a marble background", "4:5", fetchImpl);
    const parsed = JSON.parse(capture.body!);
    const parts = parsed.contents[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: "AQID" });
    expect(parts[1].text).toContain("a marble background");
    expect(parts[1].text).toContain("Do not add any text");
    expect(parsed.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(parsed.generationConfig.imageConfig.aspectRatio).toBe("4:5");
  });

  it("never sends the API key in the URL", async () => {
    const capture: { url?: string } = {};
    const fetchImpl = (async (url: string) => {
      capture.url = url;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    }) as unknown as typeof fetch;
    await generatePhoto({ apiKey: "k-secret" }, INPUT_IMAGE, "prompt", "1:1", fetchImpl);
    expect(capture.url).not.toContain("k-secret");
  });

  it("propagates GeminiImageBlockedError when Gemini blocks the image (unsafe_image upstream)", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }))) as unknown as typeof fetch;
    await expect(generatePhoto({ apiKey: "k" }, INPUT_IMAGE, "prompt", "1:1", fetchImpl)).rejects.toThrow(GeminiImageBlockedError);
  });

  it("propagates GeminiImageUnavailableError when every model fails (ai_unavailable upstream)", async () => {
    const fetchImpl = (async () => new Response('{"error":"busy"}', { status: 429 })) as unknown as typeof fetch;
    await expect(generatePhoto({ apiKey: "k", fallbackModels: [] }, INPUT_IMAGE, "prompt", "1:1", fetchImpl)).rejects.toThrow(GeminiImageUnavailableError);
  });

  it("uses a configured model/fallback list over the defaults", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      tried.push(url.split("/models/")[1].split(":")[0]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    }) as unknown as typeof fetch;
    await generatePhoto({ apiKey: "k", model: "custom-model", fallbackModels: ["custom-fallback"] }, INPUT_IMAGE, "prompt", "1:1", fetchImpl);
    expect(tried).toEqual(["custom-model"]);
  });
});
