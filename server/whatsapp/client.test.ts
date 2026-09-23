import { describe, expect, it } from "vitest";
import { createWhatsAppSender, WhatsAppSendError } from "./client";

const cfg = { token: "t", phoneNumberId: "123", apiVersion: "v25.0" };

describe("WhatsApp sender", () => {
  it("posts a text message to the Cloud API", async () => {
    let called: { url: string; init: RequestInit } | undefined;
    const send = createWhatsAppSender(cfg, (async (url: string, init: RequestInit) => {
      called = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch);
    await send("97333333333", "hello");
    expect(called!.url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect(JSON.parse(String(called!.init.body))).toMatchObject({ to: "97333333333", type: "text", text: { body: "hello" } });
    expect((called!.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("throws a WhatsAppSendError with Meta's error code", async () => {
    const send = createWhatsAppSender(cfg, (async () =>
      new Response(JSON.stringify({ error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } }), { status: 400 })) as unknown as typeof fetch);
    const err = await send("97300000000", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err.code).toBe(131030);
    expect(err.message).toContain("not in allowed list");
  });

  it("prints instead of sending in dry-run mode", async () => {
    const lines: string[] = [];
    const send = createWhatsAppSender({ ...cfg, dryRun: true, log: (m) => lines.push(String(m)) }, (() => { throw new Error("should not fetch"); }) as unknown as typeof fetch);
    await send("97333333333", "hello");
    expect(lines[0]).toContain("hello");
  });
});
