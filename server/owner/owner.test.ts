import { describe, expect, it } from "vitest";
import { createOwnerHandler } from "./handler";
import { MemoryStore } from "../agent/store";
import { handleCustomerMessage } from "../agent/reply";
import { demoProducts } from "../../src/lib/plan";

// Monday 2026-09-21 09:00 Bahrain time.
const NOW = new Date("2026-09-21T06:00:00Z");
const BASE = "http://localhost:8787";

function setup(sendImpl?: (to: string, text: string) => Promise<void>) {
  const store = new MemoryStore();
  const products = demoProducts();
  const sent: { to: string; text: string }[] = [];
  const handler = createOwnerHandler({
    store,
    products,
    senders: { whatsapp: sendImpl ?? (async (to, text) => { sent.push({ to, text }); }) },
  });
  const addOrder = async (text: string, from = "97333333333", id = "wamid.1") =>
    (await handleCustomerMessage({ channel: "whatsapp", id, from, profileName: "Sara", type: "text", text }, store, products, NOW)).order!;
  return { store, handler, sent, addOrder };
}

describe("owner page", () => {
  it("serves the owner page as HTML", async () => {
    const { handler } = setup();
    const res = await handler(new Request(`${BASE}/owner`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("اوردرات");
  });

  it("lists agent orders with readable item names and time", async () => {
    const { handler, addOrder } = setup();
    await addOrder("بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح");
    const res = await handler(new Request(`${BASE}/owner/api/orders`));
    const orders = await res.json();
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("pending");
    expect(orders[0].customerName).toBe("Sara");
    expect(orders[0].channel).toBe("whatsapp");
    expect(orders[0].customerId).toBe("97333333333");
    expect(orders[0].items).toEqual([{ name: "تشيز كيك كب", quantity: 20 }]);
    expect(orders[0].collectionText).toContain("السبت");
  });

  it("confirms a pending order and messages the customer", async () => {
    const { handler, addOrder, sent, store } = setup();
    const order = await addOrder("بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح");
    const res = await handler(new Request(`${BASE}/owner/api/orders/${order.id}/confirm`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await store.get(order.id))!.order.status).toBe("confirmed");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("97333333333");
    expect(sent[0].text).toContain("تم تأكيد طلبك");
    expect(sent[0].text).toContain("تشيز كيك كب × 20");
  });

  it("confirms in English for an English order", async () => {
    const { handler, addOrder, sent } = setup();
    const order = await addOrder("hi i want 15 red velvet cups for thursday at 12 pm");
    await handler(new Request(`${BASE}/owner/api/orders/${order.id}/confirm`, { method: "POST" }));
    expect(sent[0].text).toContain("Your order is confirmed");
  });

  it("refuses to confirm the same order twice", async () => {
    const { handler, addOrder, sent } = setup();
    const order = await addOrder("بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح");
    await handler(new Request(`${BASE}/owner/api/orders/${order.id}/confirm`, { method: "POST" }));
    const res = await handler(new Request(`${BASE}/owner/api/orders/${order.id}/confirm`, { method: "POST" }));
    expect(res.status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it("returns 404 for an unknown order", async () => {
    const { handler } = setup();
    const res = await handler(new Request(`${BASE}/owner/api/orders/nope/confirm`, { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("keeps the order confirmed and reports when the WhatsApp message fails", async () => {
    const { handler, addOrder, store } = setup(async () => { throw new Error("131047 window closed"); });
    const order = await addOrder("بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح");
    const res = await handler(new Request(`${BASE}/owner/api/orders/${order.id}/confirm`, { method: "POST" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect((await store.get(order.id))!.order.status).toBe("confirmed");
    expect(body.messageSent).toBe(false);
    expect(body.error).toContain("131047");
  });
});
