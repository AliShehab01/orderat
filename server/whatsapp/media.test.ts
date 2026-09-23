import { describe, expect, it } from "vitest";
import { createMediaReader } from "./media";

describe("WhatsApp media reader", () => {
  it("looks up the media URL, then downloads the file with the token", async () => {
    const calls: { url: string; auth?: string }[] = [];
    const read = createMediaReader({ token: "t", apiVersion: "v25.0" }, (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url.endsWith("/media-1")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "audio/ogg; codecs=opus" }));
      return new Response(new Uint8Array([7, 8, 9]));
    }) as unknown as typeof fetch);
    const media = await read("media-1");
    expect(calls.map((c) => c.url)).toEqual(["https://graph.facebook.com/v25.0/media-1", "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"]);
    expect(calls.every((c) => c.auth === "Bearer t")).toBe(true);
    expect(Array.from(media.data)).toEqual([7, 8, 9]);
    expect(media.mimeType).toBe("audio/ogg");
  });

  it("fails clearly when the media lookup fails", async () => {
    const read = createMediaReader({ token: "t" }, (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
    await expect(read("gone")).rejects.toThrow(/404/);
  });
});
