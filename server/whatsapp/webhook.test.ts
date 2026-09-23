import { describe, expect, it } from "vitest";
import { createWebhookHandler } from "./webhook";
import { signBody } from "./verify";
import { MemoryStore } from "../agent/store";
import { demoProducts } from "../../src/lib/plan";

const URL_BASE = "http://localhost/whatsapp/webhook";
// Monday 2026-09-21 09:00 Bahrain time.
const NOW = new Date("2026-09-21T06:00:00Z");

function textPayload(id: string, from: string, body: string, name = "Sara") {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "1082697964347942",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15551492016", phone_number_id: "1292142563990304" },
          contacts: [{ profile: { name }, wa_id: from }],
          messages: [{ from, id, timestamp: "1790000000", type: "text", text: { body } }],
        },
      }],
    }],
  };
}

function setup(opts: { appSecret?: string; allowUnsigned?: boolean } = {}) {
  const sent: { to: string; text: string }[] = [];
  const store = new MemoryStore();
  const handler = createWebhookHandler({
    verifyToken: "verify-me",
    appSecret: opts.appSecret,
    allowUnsigned: opts.allowUnsigned ?? true,
    send: async (to, text) => { sent.push({ to, text }); },
    store,
    products: demoProducts(),
    now: () => NOW,
    log: () => {},
  });
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json", ...headers } }));
  return { handler, post, sent, store };
}

describe("webhook verification (GET)", () => {
  it("returns the challenge when the verify token matches", async () => {
    const { handler } = setup();
    const res = await handler(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("rejects a wrong verify token", async () => {
    const { handler } = setup();
    const res = await handler(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`));
    expect(res.status).toBe(403);
  });
});

describe("signature check (POST)", () => {
  it("accepts a correctly signed body", async () => {
    const { post, sent } = setup({ appSecret: "s3cret", allowUnsigned: false });
    const payload = textPayload("wamid.1", "97333333333", "hi");
    const sig = await signBody(JSON.stringify(payload), "s3cret");
    const res = await post(payload, { "x-hub-signature-256": sig });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("rejects a bad signature and sends nothing", async () => {
    const { post, sent } = setup({ appSecret: "s3cret", allowUnsigned: false });
    const res = await post(textPayload("wamid.1", "97333333333", "hi"), { "x-hub-signature-256": "sha256=deadbeef" });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("rejects unsigned requests when no secret is set and unsigned is not allowed", async () => {
    const { post } = setup({ allowUnsigned: false });
    const res = await post(textPayload("wamid.1", "97333333333", "hi"));
    expect(res.status).toBe(401);
  });
});

describe("agent replies", () => {
  it("summarises an Arabic order and says the owner will confirm", async () => {
    const { post, sent, store } = setup();
    await post(textPayload("wamid.a", "97333333333", "هلا حبيبتي، بغيت اطلب 20 cup cheesecake و10 brownies box، للسبت الساعة 10 الصبح"));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("97333333333");
    expect(sent[0].text).toContain("تشيز كيك كب × 20");
    expect(sent[0].text).toContain("براونيز بوكس × 10");
    expect(sent[0].text).toContain("السبت");
    expect(sent[0].text).toContain("بنأكد لك الطلب");
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].order.customerName).toBe("Sara");
    expect(store.all()[0].order.status).toBe("pending");
  });

  it("asks for the collection time when it is missing", async () => {
    const { post, sent } = setup();
    await post(textPayload("wamid.b", "97333333333", "ابي 12 تشيز كيك كب"));
    expect(sent[0].text).toContain("تشيز كيك كب × 12");
    expect(sent[0].text).toContain("متى");
  });

  it("fills the time when the customer answers the follow-up", async () => {
    const { post, sent, store } = setup();
    await post(textPayload("wamid.c1", "97333333333", "ابي 12 تشيز كيك كب"));
    await post(textPayload("wamid.c2", "97333333333", "الخميس الساعة 5 العصر"));
    expect(sent[1].text).toContain("الخميس");
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].order.collectionAt).toBeDefined();
  });

  it("applies a quantity change to the customer's open order", async () => {
    const { post, sent, store } = setup();
    await post(textPayload("wamid.d1", "97333333333", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح"));
    await post(textPayload("wamid.d2", "97333333333", "ياليت تخليها 35 كب مو 20 اذا ممكن"));
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].order.items[0].quantity).toBe(35);
    expect(sent[1].text).toContain("20");
    expect(sent[1].text).toContain("35");
  });

  it("replies in English to an English message", async () => {
    const { post, sent } = setup();
    await post(textPayload("wamid.e", "97333333333", "hi i want 15 red velvet cups for thursday at 12 pm"));
    expect(sent[0].text).toContain("Red velvet cup × 15");
    expect(sent[0].text).toContain("Thursday 12:00 pm");
    expect(sent[0].text).toMatch(/confirm/i);
  });

  it("sends a help message with the menu when no order is found", async () => {
    const { post, sent, store } = setup();
    await post(textPayload("wamid.f", "97333333333", "السلام عليكم"));
    expect(sent[0].text).toContain("تشيز كيك كب");
    expect(store.all()).toHaveLength(0);
  });

  it("does not reply twice to a retried delivery", async () => {
    const { post, sent } = setup();
    const p = textPayload("wamid.g", "97333333333", "ابي 12 تشيز كيك كب");
    await post(p);
    await post(p);
    expect(sent).toHaveLength(1);
  });

  it("ignores delivery status updates", async () => {
    const { post, sent } = setup();
    const res = await post({ object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id: "wamid.x", status: "delivered" }] } }] }] });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("acknowledges a voice note without guessing an order", async () => {
    const { post, sent, store } = setup();
    const p = textPayload("wamid.h", "97333333333", "");
    const msg = p.entry[0].changes[0].value.messages[0] as Record<string, unknown>;
    msg.type = "audio"; delete msg.text; msg.audio = { id: "media-1", mime_type: "audio/ogg" };
    await post(p);
    expect(sent).toHaveLength(1);
    expect(store.all()).toHaveLength(0);
  });

  it("reads a voice note with the AI extractor and replies with the order", async () => {
    const sent: { to: string; text: string }[] = [];
    const store = new MemoryStore();
    const reads: string[] = [];
    const handler = createWebhookHandler({
      verifyToken: "v", allowUnsigned: true, store, products: demoProducts(), now: () => NOW, log: () => {},
      send: async (to, text) => { sent.push({ to, text }); },
      readMedia: async (id) => { reads.push(id); return { data: new Uint8Array([1]), mimeType: "audio/ogg" }; },
      extractor: async () => ({
        lang: "ar",
        sourceText: "ودي أطلب 30 كب كيك فانيلا للسبت الساعة 6 العصر",
        draft: {
          customerName: undefined, customerConfidence: "low",
          items: [{ productId: "p-cupcake", rawText: "30 كب كيك فانيلا", quantity: 30, confidence: "high" }],
          collectionAt: "2026-09-26T15:00:00.000Z", collectionConfidence: "high", oldQuantities: [],
        },
      }),
    });
    const p = textPayload("wamid.v1", "97333333333", "");
    const msg = p.entry[0].changes[0].value.messages[0] as Record<string, unknown>;
    msg.type = "audio"; delete msg.text; msg.audio = { id: "media-9", mime_type: "audio/ogg; codecs=opus", voice: true };
    await handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(p) }));
    expect(reads).toEqual(["media-9"]);
    expect(sent[0].text).toContain("كب كيك فانيلا × 30");
    expect(sent[0].text).toContain("السبت");
    expect(store.all()[0].sourceText).toContain("30 كب كيك");
  });

  it("falls back to the built-in parser when the AI extractor fails on text", async () => {
    const sent: { to: string; text: string }[] = [];
    const store = new MemoryStore();
    const handler = createWebhookHandler({
      verifyToken: "v", allowUnsigned: true, store, products: demoProducts(), now: () => NOW, log: () => {},
      send: async (to, text) => { sent.push({ to, text }); },
      extractor: async () => { throw new Error("Gemini down"); },
    });
    await handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(textPayload("wamid.x1", "97333333333", "ابي 12 تشيز كيك كب")) }));
    expect(sent[0].text).toContain("تشيز كيك كب × 12");
    expect(store.all()).toHaveLength(1);
  });

  it("acknowledges a voice note when the AI extractor fails", async () => {
    const sent: { to: string; text: string }[] = [];
    const store = new MemoryStore();
    const handler = createWebhookHandler({
      verifyToken: "v", allowUnsigned: true, store, products: demoProducts(), now: () => NOW, log: () => {},
      send: async (to, text) => { sent.push({ to, text }); },
      readMedia: async () => ({ data: new Uint8Array([1]), mimeType: "audio/ogg" }),
      extractor: async () => { throw new Error("Gemini down"); },
    });
    const p = textPayload("wamid.x2", "97333333333", "");
    const msg = p.entry[0].changes[0].value.messages[0] as Record<string, unknown>;
    msg.type = "audio"; delete msg.text; msg.audio = { id: "media-10", mime_type: "audio/ogg" };
    await handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(p) }));
    expect(sent[0].text).toContain("استلمنا رسالتك");
    expect(store.all()).toHaveLength(0);
  });

  it("still returns 200 when sending the reply fails", async () => {
    const store = new MemoryStore();
    const handler = createWebhookHandler({ verifyToken: "v", allowUnsigned: true, send: async () => { throw new Error("boom"); }, store, products: demoProducts(), now: () => NOW, log: () => {} });
    const res = await handler(new Request(URL_BASE, { method: "POST", body: JSON.stringify(textPayload("wamid.i", "97333333333", "ابي 12 تشيز كيك كب")) }));
    expect(res.status).toBe(200);
  });
});
