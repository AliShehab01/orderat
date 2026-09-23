import { describe, expect, it } from "vitest";
import { extractInstagramMessages } from "./incoming";
import { createInstagramSender, fitInstagramText } from "./client";
import { createInstagramWebhookHandler } from "./webhook";
import { MemoryStore } from "../agent/store";
import { createOwnerHandler } from "../owner/handler";
import { demoProducts } from "../../src/lib/plan";

const NOW = new Date("2026-09-21T06:00:00Z");
const URL_BASE = "http://localhost/instagram/webhook";
const IG_ID = "17841400000000001";

function igPayload(messaging: unknown[]) {
  return { object: "instagram", entry: [{ id: IG_ID, time: 1790000000, messaging }] };
}
const textEvent = (sender: string, mid: string, text: string) => ({
  sender: { id: sender }, recipient: { id: IG_ID }, timestamp: 1790000000000, message: { mid, text },
});

describe("Instagram message parsing", () => {
  it("reads text and image messages and skips echoes and read receipts", () => {
    const msgs = extractInstagramMessages(igPayload([
      textEvent("111", "m1", "ابي 12 تشيز كيك كب"),
      { sender: { id: "111" }, recipient: { id: IG_ID }, message: { mid: "m2", attachments: [{ type: "image", payload: { url: "https://cdn.example/img.jpg" } }] } },
      { sender: { id: IG_ID }, recipient: { id: "111" }, message: { mid: "m3", text: "our own reply", is_echo: true } },
      { sender: { id: "111" }, recipient: { id: IG_ID }, read: { mid: "m1" } },
    ]));
    expect(msgs).toEqual([
      { channel: "instagram", id: "m1", from: "111", type: "text", text: "ابي 12 تشيز كيك كب", timestamp: "1790000000000" },
      { channel: "instagram", id: "m2", from: "111", type: "image", text: undefined, media: { url: "https://cdn.example/img.jpg" }, timestamp: undefined },
    ]);
  });

  it("ignores payloads that are not Instagram", () => {
    expect(extractInstagramMessages({ object: "page", entry: [] })).toEqual([]);
  });
});

describe("Instagram sender", () => {
  it("posts the reply to the Instagram messages endpoint", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const send = createInstagramSender({ token: "ig-token", apiVersion: "v25.0" }, (async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response(JSON.stringify({ recipient_id: "111", message_id: "x" }));
    }) as unknown as typeof fetch);
    await send("111", "hello");
    expect(call!.url).toBe("https://graph.instagram.com/v25.0/me/messages");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe("Bearer ig-token");
    expect(JSON.parse(String(call!.init.body))).toEqual({ recipient: { id: "111" }, message: { text: "hello" } });
  });

  it("keeps messages within Instagram's 1000-byte limit, cutting at a line break", () => {
    const long = Array.from({ length: 60 }, (_, i) => `• تشيز كيك كب × ${i + 1}`).join("\n");
    const fitted = fitInstagramText(long);
    expect(new TextEncoder().encode(fitted).length).toBeLessThanOrEqual(1000);
    expect(long.startsWith(fitted.replace(/\n…$/, ""))).toBe(true);
    expect(fitInstagramText("short")).toBe("short");
  });

  it("hard-truncates a single line over the byte limit by bytes, without splitting a character", () => {
    const line = "أ".repeat(600); // "أ" is 2 UTF-8 bytes, so 1200 bytes total, over the limit on its own.
    const fitted = fitInstagramText(line);
    const bytes = new TextEncoder().encode(fitted);
    expect(bytes.length).toBeLessThanOrEqual(1000);
    expect(fitted.endsWith("…")).toBe(true);
    expect(fitted).not.toBe("\n…");
    expect(fitted.length).toBeGreaterThan(1); // keeps real content, not just the ellipsis
    // Decoding must succeed (fatal: true throws on a truncated multi-byte sequence).
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(fitted);
  });

  it("hard-truncates the oversized line even when earlier lines already fit", () => {
    const long = `short line\n${"a".repeat(1200)}`;
    const fitted = fitInstagramText(long);
    const bytes = new TextEncoder().encode(fitted);
    expect(bytes.length).toBeLessThanOrEqual(1000);
    expect(fitted.startsWith("short line\n")).toBe(true);
    expect(fitted.endsWith("…")).toBe(true);
  });
});

describe("Instagram webhook", () => {
  function setup(replyTo: "all" | string[]) {
    const sent: { to: string; text: string }[] = [];
    const logs: string[] = [];
    const store = new MemoryStore();
    const handler = createInstagramWebhookHandler({
      verifyToken: "v", allowUnsigned: true, store, products: demoProducts(), now: () => NOW,
      log: (m) => logs.push(String(m)),
      send: async (to, text) => { sent.push({ to, text }); },
      replyTo,
    });
    const post = (payload: unknown) => handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(payload) }));
    return { handler, post, sent, store, logs };
  }

  it("answers Meta's verification handshake", async () => {
    const { handler } = setup([]);
    const res = await handler(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=v&hub.challenge=77`));
    expect(await res.text()).toBe("77");
  });

  it("replies to an allowed tester and stores the order as Instagram", async () => {
    const { post, sent, store } = setup(["111"]);
    await post(igPayload([textEvent("111", "m1", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح")]));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("111");
    expect(sent[0].text).toContain("تشيز كيك كب × 20");
    expect((await store.all())[0]).toMatchObject({ channel: "instagram", customerId: "111" });
  });

  it("only observes senders that are not allowed: no reply, no order", async () => {
    const { post, sent, store, logs } = setup(["111"]);
    await post(igPayload([textEvent("999", "m2", "is this car still available?")]));
    expect(sent).toHaveLength(0);
    expect(await store.all()).toHaveLength(0);
    expect(logs.join("\n")).toContain("999");
  });

  it("replies to everyone when replyTo is all", async () => {
    const { post, sent } = setup("all");
    await post(igPayload([textEvent("555", "m3", "ابي 12 تشيز كيك كب")]));
    expect(sent).toHaveLength(1);
  });

  it("lets the owner confirm an Instagram order through the Instagram sender", async () => {
    const { post, store } = setup(["111"]);
    await post(igPayload([textEvent("111", "m4", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح")]));
    const igSent: string[] = [];
    const owner = createOwnerHandler({ store, products: demoProducts(), senders: { instagram: async (to) => { igSent.push(to); } } });
    const res = await owner(new Request(`http://localhost:8787/owner/api/orders/${(await store.all())[0].order.id}/confirm`, { method: "POST" }));
    expect((await res.json()).messageSent).toBe(true);
    expect(igSent).toEqual(["111"]);
  });
});
