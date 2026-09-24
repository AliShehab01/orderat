import { describe, expect, it } from "vitest";
import { findTunnelUrl, setWebhookOverride } from "./webhook-override";

describe("WhatsApp webhook override", () => {
  it("posts the callback and verify token to the account's subscribed_apps", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    await setWebhookOverride({ token: "t", wabaId: "123", verifyToken: "vt" }, "https://x.trycloudflare.com/whatsapp/webhook", (async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response('{"success":true}');
    }) as unknown as typeof fetch);
    expect(call!.url).toBe("https://graph.facebook.com/v25.0/123/subscribed_apps");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    const body = new URLSearchParams(String(call!.init.body));
    expect(body.get("override_callback_uri")).toBe("https://x.trycloudflare.com/whatsapp/webhook");
    expect(body.get("verify_token")).toBe("vt");
  });

  it("throws with Meta's error when the override is refused", async () => {
    const run = setWebhookOverride({ token: "t", wabaId: "123", verifyToken: "vt" }, "https://x", (async () =>
      new Response('{"error":{"message":"Callback verification failed","code":2200}}', { status: 400 })) as unknown as typeof fetch);
    await expect(run).rejects.toThrow(/2200/);
  });

  it("finds the tunnel address but not the API host in cloudflared logs", () => {
    const log = 'INF Requesting new quick Tunnel on trycloudflare.com...\nfailed Post "https://api.trycloudflare.com/tunnel"\n|  https://minolta-holes-wilson-bridal.trycloudflare.com  |';
    expect(findTunnelUrl(log)).toBe("https://minolta-holes-wilson-bridal.trycloudflare.com");
    expect(findTunnelUrl("nothing yet")).toBeUndefined();
  });
});
