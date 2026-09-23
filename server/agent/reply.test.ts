import { describe, expect, it } from "vitest";
import { handleCustomerMessage } from "./reply";
import { MemoryStore } from "./store";
import { demoProducts } from "../../src/lib/plan";
import type { IncomingMessage } from "../whatsapp/incoming";

// Monday 2026-09-21 09:00 Bahrain time.
const NOW = new Date("2026-09-21T06:00:00Z");

function textMessage(id: string, text: string): IncomingMessage {
  return { channel: "whatsapp", id, from: "97333333333", profileName: "Sara", type: "text", text };
}

describe("handleCustomerMessage - repeating an already-open order", () => {
  it("acknowledges in Arabic that the order is already recorded instead of creating a duplicate", async () => {
    const store = new MemoryStore();
    const products = demoProducts();
    const text = "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح";

    const first = await handleCustomerMessage(textMessage("wamid.1", text), store, products, NOW);
    expect(first.kind).toBe("new");

    const second = await handleCustomerMessage(textMessage("wamid.2", text), store, products, NOW);
    expect(second.kind).toBe("noted");
    expect(second.reply).toContain("طلبك مسجل عندنا");
    expect(await store.all()).toHaveLength(1);
  });

  it("acknowledges in English that the order is already recorded instead of creating a duplicate", async () => {
    const store = new MemoryStore();
    const products = demoProducts();
    const text = "i want 15 red velvet cups for thursday at 12 pm";

    const first = await handleCustomerMessage(textMessage("wamid.7", text), store, products, NOW);
    expect(first.kind).toBe("new");

    const second = await handleCustomerMessage(textMessage("wamid.8", text), store, products, NOW);
    expect(second.kind).toBe("noted");
    expect(second.reply).toContain("already with us");
    expect(await store.all()).toHaveLength(1);
  });

  it("still creates a new order when the repeated items are for a different day", async () => {
    const store = new MemoryStore();
    const products = demoProducts();

    const first = await handleCustomerMessage(textMessage("wamid.3", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح"), store, products, NOW);
    expect(first.kind).toBe("new");

    const second = await handleCustomerMessage(textMessage("wamid.4", "بغيت 20 تشيز كيك كب للاحد الساعة 10 الصبح"), store, products, NOW);
    expect(second.kind).toBe("new");
    expect(await store.all()).toHaveLength(2);
  });

  it("still applies a real change (different quantity) as a change, not a duplicate", async () => {
    const store = new MemoryStore();
    const products = demoProducts();

    await handleCustomerMessage(textMessage("wamid.5", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح"), store, products, NOW);
    const second = await handleCustomerMessage(textMessage("wamid.6", "ياليت تخليها 35 كب مو 20 اذا ممكن"), store, products, NOW);
    expect(second.kind).toBe("change");
    expect(await store.all()).toHaveLength(1);
  });
});
