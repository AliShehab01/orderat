import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import type { ShopDocPublic } from "./doc";
import {
  ackOrders,
  buildWhatsappText,
  countOrdersByIpSince,
  countOrdersByShopSince,
  generateOrderRef,
  insertOrder,
  isPickupDateAllowed,
  listInboxOrders,
  purgeOldOrders,
  resolveOrderDoc,
} from "./orders";
import { createShop } from "./store";
import type { OrderBody } from "./validate";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

const SHOP_DOC: ShopDocPublic = {
  slug: "sweetstudio", name: { ar: "ع", en: "Sweet Studio" }, lang: "ar", currency: "BHD", whatsapp: "97333334444",
  leadTimeDays: 1, delivery: "pickup_and_delivery", acceptsWebOrders: true, accent: "#7C4DFF",
  items: [
    { id: "p1", name: { ar: "كب تشيز كيك", en: "Cheesecake cups" }, priceMinor: 4500, available: true },
    { id: "p2", name: { ar: "كيكة شوكولاتة", en: "Chocolate cake" }, priceMinor: 8000, available: false },
  ],
};

function orderBody(overrides: Partial<OrderBody> = {}): OrderBody {
  return {
    action: "order", slug: "sweetstudio", customer: { name: "Sara", phone: "97300001111" },
    items: [{ id: "p1", qty: 2 }], pickupDate: "2026-09-28", ...overrides,
  };
}

async function seedShop(id = "11111111-1111-1111-1111-111111111111", slug = "sweetstudio") {
  await createShop(sql, { id, slug, tokenHash: `hash-${id}`, installId: "install-1", doc: { ...SHOP_DOC, slug }, day: "2026-09-26" });
  return id;
}

describe("resolveOrderDoc", () => {
  it("resolves a known, available item using the shop's own price and lang-appropriate name", () => {
    const result = resolveOrderDoc(SHOP_DOC, orderBody());
    expect(result).toEqual({
      ok: true,
      doc: {
        customer: { name: "Sara", phone: "97300001111" },
        items: [{ id: "p1", name: "كب تشيز كيك", qty: 2, priceMinor: 4500 }],
        totalMinor: 9000,
        currency: "BHD",
        pickupDate: "2026-09-28",
        pickupTime: undefined,
        fulfillment: undefined,
        address: undefined,
        notes: undefined,
      },
    });
  });

  it("uses the English name when the shop's lang is en", () => {
    const enDoc = { ...SHOP_DOC, lang: "en" as const };
    const result = resolveOrderDoc(enDoc, orderBody());
    expect(result.ok && result.doc.items[0].name).toBe("Cheesecake cups");
  });

  it("rejects an unknown item id with invalid_body", () => {
    expect(resolveOrderDoc(SHOP_DOC, orderBody({ items: [{ id: "no-such-item", qty: 1 }] }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unavailable item id with invalid_body", () => {
    expect(resolveOrderDoc(SHOP_DOC, orderBody({ items: [{ id: "p2", qty: 1 }] }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("sums multiple lines correctly", () => {
    const result = resolveOrderDoc(SHOP_DOC, orderBody({ items: [{ id: "p1", qty: 3 }] }));
    expect(result.ok && result.doc.totalMinor).toBe(13500);
  });
});

describe("isPickupDateAllowed", () => {
  it("rejects a date before today + leadTimeDays", () => {
    expect(isPickupDateAllowed("2026-09-26", "2026-09-26", 1)).toBe(false);
  });

  it("accepts a date exactly at today + leadTimeDays", () => {
    expect(isPickupDateAllowed("2026-09-27", "2026-09-26", 1)).toBe(true);
  });

  it("accepts today itself when leadTimeDays is 0", () => {
    expect(isPickupDateAllowed("2026-09-26", "2026-09-26", 0)).toBe(true);
  });

  it("accepts a date exactly 60 days out", () => {
    expect(isPickupDateAllowed("2026-11-25", "2026-09-26", 0)).toBe(true);
  });

  it("rejects a date 61 days out", () => {
    expect(isPickupDateAllowed("2026-11-26", "2026-09-26", 0)).toBe(false);
  });
});

describe("generateOrderRef", () => {
  it("looks like W followed by 4 digits", () => {
    expect(generateOrderRef()).toMatch(/^W\d{4}$/);
  });
});

describe("buildWhatsappText", () => {
  const doc = {
    customer: { name: "Sara", phone: "97300001111" },
    items: [{ id: "p1", name: "Cheesecake cups", qty: 2, priceMinor: 4500 }],
    totalMinor: 9000, currency: "BHD", pickupDate: "2026-09-28", pickupTime: "17:00",
  };

  it("includes the ref, customer, items, total and pickup in Arabic", () => {
    const text = buildWhatsappText("W4821", doc, "ar");
    expect(text).toContain("طلب جديد #W4821");
    expect(text).toContain("Sara");
    expect(text).toContain("97300001111");
    expect(text).toContain("Cheesecake cups");
    expect(text).toContain("9.000 BHD");
    expect(text).toContain("2026-09-28 17:00");
  });

  it("includes the same content in English", () => {
    const text = buildWhatsappText("W4821", doc, "en");
    expect(text).toContain("New order #W4821");
    expect(text).toContain("Total: 9.000 BHD");
  });

  it("includes the address only when given", () => {
    expect(buildWhatsappText("W1", doc, "en")).not.toContain("Address");
    expect(buildWhatsappText("W1", { ...doc, address: "Building 12" }, "en")).toContain("Building 12");
  });

  it("includes notes only when given", () => {
    expect(buildWhatsappText("W1", doc, "en")).not.toContain("Notes");
    expect(buildWhatsappText("W1", { ...doc, notes: "extra sweet please" }, "en")).toContain("extra sweet please");
  });
});

describe("insertOrder / listInboxOrders / ackOrders / purgeOldOrders / rate-limit counts", () => {
  it("inserts an order and lists it in the inbox, newest first", async () => {
    const shopId = await seedShop();
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId, ref: "W1000", doc: resolved.doc, ipHash: "iphash-a" });

    const inbox = await listInboxOrders(sql, shopId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: "22222222-2222-2222-2222-222222222222", ref: "W1000", totalMinor: 9000 });
  });

  it("acks (deletes) only the given order ids for the given shop", async () => {
    const shopId = await seedShop();
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId, ref: "W1000", doc: resolved.doc, ipHash: "iphash-a" });
    await insertOrder(sql, { id: "33333333-3333-3333-3333-333333333333", shopId, ref: "W1001", doc: resolved.doc, ipHash: "iphash-a" });

    const deleted = await ackOrders(sql, shopId, ["22222222-2222-2222-2222-222222222222"]);
    expect(deleted).toBe(1);
    const remaining = await listInboxOrders(sql, shopId);
    expect(remaining.map((o) => o.id)).toEqual(["33333333-3333-3333-3333-333333333333"]);
  });

  it("never acks an order belonging to a different shop", async () => {
    const shopA = await seedShop("11111111-1111-1111-1111-111111111111", "sweetstudio-a");
    const shopB = await seedShop("44444444-4444-4444-4444-444444444444", "sweetstudio-b");
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId: shopA, ref: "W1000", doc: resolved.doc, ipHash: "iphash-a" });

    const deleted = await ackOrders(sql, shopB, ["22222222-2222-2222-2222-222222222222"]);
    expect(deleted).toBe(0);
    expect(await listInboxOrders(sql, shopA)).toHaveLength(1);
  });

  it("returns 0 for ackOrders with an empty id list, without querying", async () => {
    const shopId = await seedShop();
    expect(await ackOrders(sql, shopId, [])).toBe(0);
  });

  it("counts orders by ip hash since a given time", async () => {
    const shopId = await seedShop();
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId, ref: "W1", doc: resolved.doc, ipHash: "same-ip" });
    await insertOrder(sql, { id: "33333333-3333-3333-3333-333333333333", shopId, ref: "W2", doc: resolved.doc, ipHash: "same-ip" });
    await insertOrder(sql, { id: "55555555-5555-5555-5555-555555555555", shopId, ref: "W3", doc: resolved.doc, ipHash: "other-ip" });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(await countOrdersByIpSince(sql, "same-ip", oneHourAgo)).toBe(2);
    expect(await countOrdersByIpSince(sql, "other-ip", oneHourAgo)).toBe(1);
    expect(await countOrdersByIpSince(sql, "unseen-ip", oneHourAgo)).toBe(0);
  });

  it("counts orders by shop since a given time", async () => {
    const shopId = await seedShop();
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId, ref: "W1", doc: resolved.doc, ipHash: "a" });
    await insertOrder(sql, { id: "33333333-3333-3333-3333-333333333333", shopId, ref: "W2", doc: resolved.doc, ipHash: "b" });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await countOrdersByShopSince(sql, shopId, oneDayAgo)).toBe(2);
  });

  it("purges only orders older than 30 days", async () => {
    const shopId = await seedShop();
    const resolved = resolveOrderDoc(SHOP_DOC, orderBody());
    if (!resolved.ok) throw new Error("setup failed");
    await insertOrder(sql, { id: "22222222-2222-2222-2222-222222222222", shopId, ref: "W1", doc: resolved.doc, ipHash: "a" });
    // Backdate this row to 31 days ago directly (insertOrder always uses now()).
    await sql.query("update orderat.shop_orders set created_at = now() - interval '31 days' where id = $1", ["22222222-2222-2222-2222-222222222222"]);
    await insertOrder(sql, { id: "33333333-3333-3333-3333-333333333333", shopId, ref: "W2", doc: resolved.doc, ipHash: "a" });

    const purged = await purgeOldOrders(sql, new Date());
    expect(purged).toBe(1);
    const remaining = await listInboxOrders(sql, shopId);
    expect(remaining.map((o) => o.id)).toEqual(["33333333-3333-3333-3333-333333333333"]);
  });
});
