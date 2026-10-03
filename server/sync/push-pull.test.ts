// The scenarios docs/sme-phase-2-cloud.md's "Sync" section and the SME-phase-2 spec's test list name
// explicitly: last-writer-wins, conflict reporting, tombstones, pull pagination ("more"), and staff
// permission filtering (money, products, prepare-only status edits) — all against a real (if WASM)
// Postgres via server/cloud-pglite-test-support.ts, not a mock.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { pullForMember, pushChanges } from "./push-pull.ts";
import { findRecord, insertShopCloud, upsertRecord } from "./store.ts";
import type { ChangeInput } from "./validate.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";
const owner: Member = { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS };

function change(overrides: Partial<ChangeInput>): ChangeInput {
  return { entity: "order", id: "order-1", data: { status: "pending" }, deleted: false, baseSeq: 0, ...overrides };
}

/** The first `times` reads of a record through this client each run `otherWrite` (another device's push,
 * say) before they come back: exactly the window between a push's read and its write, made deterministic. */
const isRecordRead = (text: string) => /^\s*select\b[\s\S]*\bfrom orderat\.records\b/i.test(text);
function racing(otherWrite: () => Promise<unknown>, times = 1): SqlClient {
  let left = times;
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      const rows = await sql.query<T>(text, params);
      if (left > 0 && isRecordRead(text)) {
        left--;
        await otherWrite();
      }
      return rows;
    },
  };
}

beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
});

describe("pushChanges / first upload", () => {
  it("accepts a whole batch of brand-new records from the owner, none of them conflicting", async () => {
    const changes: ChangeInput[] = [
      change({ entity: "product", id: "p1", data: { name: "Cake" } }),
      change({ entity: "customer", id: "c1", data: { name: "Sara" } }),
      change({ entity: "order", id: "o1", data: { status: "pending" } }),
    ];
    const result = await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);
    expect(result).toEqual({ conflicts: [], rejected: [] });
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))?.data).toEqual({ name: "Cake" });
  });
});

describe("pushChanges / last-writer-wins and conflict reporting", () => {
  it("a push with a stale baseSeq still applies (last writer wins) but is reported as a conflict", async () => {
    const first = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    // A second phone pushes with baseSeq behind the record's current seq (it never saw the latest pull).
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" }, baseSeq: first.seq - 1 })], OWNER_ID);
    expect(result.conflicts).toEqual([{ entity: "order", id: "order-1", seq: first.seq }]);
    expect(result.rejected).toEqual([]);
    // Last writer wins: the push's data is what's actually stored, despite the conflict.
    expect((await findRecord(sql, SHOP_ID, "order", "order-1"))?.data).toEqual({ status: "confirmed" });
  });

  it("a push whose baseSeq matches (or exceeds) the current seq is not a conflict", async () => {
    const first = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" }, baseSeq: first.seq })], OWNER_ID);
    expect(result.conflicts).toEqual([]);
  });

  it("a brand-new record (no existing row) is never a conflict, even with baseSeq 0", async () => {
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ baseSeq: 0 })], OWNER_ID);
    expect(result.conflicts).toEqual([]);
  });

  it("every accepted push gets a fresh, strictly increasing seq", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "pending" } })], OWNER_ID);
    const afterFirst = await findRecord(sql, SHOP_ID, "order", "order-1");
    await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" } })], OWNER_ID);
    const afterSecond = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(afterSecond!.seq).toBeGreaterThan(afterFirst!.seq);
  });
});

describe("pushChanges / tombstones", () => {
  it("a deleted: true push is stored, not removed, with deleted: true and a fresh seq", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ deleted: true })], OWNER_ID);
    expect(result.rejected).toEqual([]);
    const record = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(record?.deleted).toBe(true);
  });

  it("a tombstone is still pulled (as deleted: true), so other devices learn to remove it too", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ deleted: true })], OWNER_ID);
    const pulled = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]).toMatchObject({ id: "order-1", deleted: true });
  });
});

describe("pushChanges / staff permission filtering", () => {
  it("rejects an expense push from staff without money, without touching any other change in the batch", async () => {
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const changes: ChangeInput[] = [change({ entity: "expense", id: "e1", data: { amount: 10 } }), change({ entity: "order", id: "o1", data: { status: "pending" } })];
    const result = await pushChanges(sql, SHOP_ID, staffNoMoney, changes, STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "expense", id: "e1", reason: "forbidden" }]);
    expect(await findRecord(sql, SHOP_ID, "expense", "e1")).toBeUndefined();
    expect(await findRecord(sql, SHOP_ID, "order", "o1")).toBeDefined();
  });

  it("accepts an expense push from staff with money", async () => {
    const staffWithMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, money: true } };
    const result = await pushChanges(sql, SHOP_ID, staffWithMoney, [change({ entity: "expense", id: "e1", data: { amount: 10 } })], STAFF_ID);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a product push from staff without products", async () => {
    const staffNoProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoProducts, [change({ entity: "product", id: "p1", data: { name: "Cake" } })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "product", id: "p1", reason: "forbidden" }]);
  });

  it("a prepare-only staff member's order push keeps every field but status from the stored record", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending", customerName: "Sara", items: [{ id: "p1", qty: 2 }] }, false, OWNER_ID);
    const prepareOnly: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
    const result = await pushChanges(sql, SHOP_ID, prepareOnly, [change({ data: { status: "prepped", customerName: "Attempted rename" } })], STAFF_ID);
    expect(result.rejected).toEqual([]);
    expect((await findRecord(sql, SHOP_ID, "order", "order-1"))?.data).toEqual({ status: "prepped", customerName: "Sara", items: [{ id: "p1", qty: 2 }] });
  });

  it("a rejected change carries the server's current copy so the phone can revert exactly", async () => {
    await upsertRecord(sql, SHOP_ID, "product", "p1", { name: "Cake", priceMinor: 5000 }, false, OWNER_ID);
    const staffNoProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoProducts, [change({ entity: "product", id: "p1", data: { name: "Hacked", priceMinor: 1 } })], STAFF_ID);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ entity: "product", id: "p1", reason: "forbidden", record: { data: { name: "Cake", priceMinor: 5000 }, deleted: false } });
    expect(result.rejected[0]!.record!.seq).toBeGreaterThan(0);
  });

  it("a rejected change never leaks a record the member may not see", async () => {
    await upsertRecord(sql, SHOP_ID, "expense", "e1", { amount: 99 }, false, OWNER_ID);
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoMoney, [change({ entity: "expense", id: "e1", data: { amount: 1 } })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "expense", id: "e1", reason: "forbidden" }]);
  });

  it("accepts the owner's subscription report (the setting record \"subscription\")", async () => {
    const report = { value: { status: "active", expiresAt: "2027-01-01T00:00:00.000Z" } };
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ entity: "setting", id: "subscription", data: report })], OWNER_ID);
    expect(result).toEqual({ conflicts: [], rejected: [] });
    expect((await findRecord(sql, SHOP_ID, "setting", "subscription"))?.data).toEqual(report);
  });

  it("rejects a staff member's write of the subscription setting, returning the server copy", async () => {
    const ownersReport = { value: { status: "expired", expiresAt: "2026-09-01T00:00:00.000Z" } };
    const stored = await upsertRecord(sql, SHOP_ID, "setting", "subscription", ownersReport, false, OWNER_ID);
    const everyPermission: Member = { role: "staff", permissions: { orders: true, prepare: true, money: true, products: true } };

    const forged = { value: { status: "active", expiresAt: "2099-01-01T00:00:00.000Z" } };
    const result = await pushChanges(sql, SHOP_ID, everyPermission, [change({ entity: "setting", id: "subscription", data: forged, baseSeq: stored.seq })], STAFF_ID);

    expect(result.rejected).toEqual([
      { entity: "setting", id: "subscription", reason: "forbidden", record: { data: ownersReport, deleted: false, seq: stored.seq, updatedAt: stored.updatedAt } },
    ]);
    expect((await findRecord(sql, SHOP_ID, "setting", "subscription"))?.data).toEqual(ownersReport);
  });

  it("rejects a staff member's other settings too, such as whatsappTemplates (security review F01)", async () => {
    const staff: Member = { role: "staff", permissions: { orders: true, prepare: true, money: true, products: true } };
    const result = await pushChanges(sql, SHOP_ID, staff, [change({ entity: "setting", id: "whatsappTemplates", data: { value: ["Hi {name}"] } })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "setting", id: "whatsappTemplates", reason: "forbidden" }]);
    expect(await findRecord(sql, SHOP_ID, "setting", "whatsappTemplates")).toBeUndefined();
  });

  it("rejects a prepare-only staff member's attempt to create a brand-new order", async () => {
    const prepareOnly: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
    const result = await pushChanges(sql, SHOP_ID, prepareOnly, [change({ id: "brand-new-order" })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "order", id: "brand-new-order", reason: "forbidden" }]);
  });

  it("hides expense records from a staff pull when they lack money, without shrinking the page early", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: {} }), change({ entity: "expense", id: "e1", data: { amount: 5 } })], OWNER_ID);
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const pulled = await pullForMember(sql, SHOP_ID, staffNoMoney, 0);
    expect(pulled.changes.map((c) => c.entity)).toEqual(["product"]);
    // The owner, pulling the same page, sees both.
    const ownerPulled = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(ownerPulled.changes.map((c) => c.entity).sort()).toEqual(["expense", "product"]);
  });
});

// Security review 1 Oct 2026, F01: a staff member with every flag off used to pull every customer,
// order and product, and could push the shop record and any setting (a made-up VAT setting, say). Every
// flag off, each flag alone, and the owner, against one shop holding a record of every kind.
describe("F01 / what each member pulls and may push", () => {
  const AT = "2026-10-01T10:00:00.000Z";
  const SHOP = { nameAr: "كيك سارة", currencyCode: "BHD", vat: { enabled: true, rateBps: 1000 } };
  const ORDER = { customerId: "c1", status: "ready", fulfillmentType: "delivery", paymentStatus: "unpaid", items: [{ id: "i1", productId: "p1", quantity: 2, unitPriceMinor: 5000 }], payments: [], changes: [], updatedAt: AT };
  const PRODUCT = { nameAr: "كيك", priceMinor: 5000, costMinor: 2000, trackStock: true, stockQuantity: 10, stockMoves: [] };
  const seed: ChangeInput[] = [
    change({ entity: "shop", id: SHOP_ID, data: SHOP }),
    change({ entity: "setting", id: "subscription", data: { value: { status: "active", expiresAt: "2027-01-01T00:00:00.000Z" } } }),
    change({ entity: "setting", id: "whatsappTemplates", data: { value: { "orderReady.ar": "طلبك جاهز" } } }),
    change({ entity: "setting", id: "deliveryDefaults", data: { value: { feeMinor: 500 } } }),
    change({ entity: "product", id: "p1", data: PRODUCT }),
    change({ entity: "stock_move", id: "m1", data: { delta: 5 } }),
    change({ entity: "customer", id: "c1", data: { name: "Fatima", phone: "+97333000000" } }),
    change({ entity: "order", id: "o1", data: ORDER }),
    change({ entity: "expense", id: "e1", data: { amountMinor: 3000, category: "ingredients" } }),
    change({ entity: "occasion", id: "x1", data: { kind: "eid", nameAr: "العيد" } }),
  ];
  const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
  const pulledKinds = async (member: Member) =>
    (await pullForMember(sql, SHOP_ID, member, 0)).changes.map((c) => (c.entity === "setting" ? `setting:${c.id}` : c.entity));

  beforeEach(async () => {
    expect(await pushChanges(sql, SHOP_ID, owner, seed, OWNER_ID)).toEqual({ conflicts: [], rejected: [] });
  });

  it("every flag off: pulls the shop and the subscription setting only, and every push is refused", async () => {
    const none = staff({});
    expect(await pulledKinds(none)).toEqual(["shop", "setting:subscription"]);

    const attempts = seed.map((c) => ({ ...c, data: { ...c.data, tampered: true } }));
    const result = await pushChanges(sql, SHOP_ID, none, [...attempts, change({ entity: "setting", id: "vat", data: { value: { rateBps: 0 } } }), change({ entity: "order", id: "o2", data: ORDER })], STAFF_ID);
    expect(result.conflicts).toEqual([]);
    expect(result.rejected.map((r) => `${r.entity}/${r.id}`)).toEqual([...seed.map((c) => `${c.entity}/${c.id}`), "setting/vat", "order/o2"]);
    // The server's copy comes back only for what this member may pull; the rest the phone drops.
    expect(result.rejected.filter((r) => r.record).map((r) => `${r.entity}/${r.id}`)).toEqual([`shop/${SHOP_ID}`, "setting/subscription"]);
    // Nothing changed on the server.
    for (const c of seed) expect((await findRecord(sql, SHOP_ID, c.entity, c.id))?.data).toEqual(c.data);
    expect(await findRecord(sql, SHOP_ID, "setting", "vat")).toBeUndefined();
  });

  it("a filtered record is left out, never sent as a deletion, even once the owner deletes it", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: ORDER, deleted: true })], OWNER_ID);
    const pulled = await pullForMember(sql, SHOP_ID, staff({}), 0);
    expect(pulled.changes.some((c) => c.entity === "order" || c.deleted)).toBe(false);
    // Staff who may see orders do get the tombstone.
    const ordersPull = await pullForMember(sql, SHOP_ID, staff({ orders: true }), 0);
    expect(ordersPull.changes.find((c) => c.entity === "order")).toMatchObject({ id: "o1", deleted: true });
  });

  it("orders alone: no expenses; writes orders, customers and occasions; not the shop, settings or products", async () => {
    const member = staff({ orders: true });
    expect(await pulledKinds(member)).toEqual(["shop", "setting:subscription", "setting:whatsappTemplates", "setting:deliveryDefaults", "product", "stock_move", "customer", "order", "occasion"]);

    const result = await pushChanges(sql, SHOP_ID, member, [
      change({ entity: "order", id: "o2", data: { ...ORDER, customerId: "c2" } }),
      change({ entity: "customer", id: "c2", data: { name: "Noora" } }),
      change({ entity: "occasion", id: "x1", data: { kind: "eid", nameAr: "عيد الأضحى" } }),
      change({ entity: "shop", id: SHOP_ID, data: { ...SHOP, vat: { enabled: false } } }),
      change({ entity: "setting", id: "deliveryDefaults", data: { value: { feeMinor: 0 } } }),
      change({ entity: "product", id: "p1", data: { ...PRODUCT, priceMinor: 1 } }),
      change({ entity: "expense", id: "e1", data: { amountMinor: 1 } }),
    ], STAFF_ID);
    expect(result.rejected.map((r) => `${r.entity}/${r.id}`)).toEqual([`shop/${SHOP_ID}`, "setting/deliveryDefaults", "product/p1", "expense/e1"]);
    expect(result.rejected.find((r) => r.entity === "expense")!.record).toBeUndefined();
    expect(result.rejected.find((r) => r.entity === "shop")!.record!.data).toEqual(SHOP);
    expect((await findRecord(sql, SHOP_ID, "order", "o2"))?.data.customerId).toBe("c2");
    expect((await findRecord(sql, SHOP_ID, "occasion", "x1"))?.data.nameAr).toBe("عيد الأضحى");
  });

  it("prepare alone: what preparing takes; writes an order's status and outForDeliveryAt only", async () => {
    const member = staff({ prepare: true });
    expect(await pulledKinds(member)).toEqual(["shop", "setting:subscription", "setting:whatsappTemplates", "setting:deliveryDefaults", "product", "stock_move", "customer", "order", "occasion"]);

    const outEntry = { id: "h1", field: "outForDelivery", oldValue: null, newValue: AT, note: null, at: AT };
    const result = await pushChanges(sql, SHOP_ID, member, [
      change({ entity: "order", id: "o1", data: { ...ORDER, outForDeliveryAt: AT, changes: [outEntry], paymentStatus: "paid", items: [] } }),
      change({ entity: "customer", id: "c1", data: { name: "Renamed" } }),
      change({ entity: "order", id: "o2", data: ORDER }),
    ], STAFF_ID);
    expect(result.rejected.map((r) => `${r.entity}/${r.id}`)).toEqual(["customer/c1", "order/o2"]);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))?.data).toEqual({ ...ORDER, outForDeliveryAt: AT, changes: [outEntry] });
  });

  it("prepare alone: delivered — status, a cleared outForDeliveryAt and the appended history all stored, nothing else", async () => {
    const member = staff({ prepare: true });
    const outEntry = { id: "h1", field: "outForDelivery", oldValue: null, newValue: AT, note: null, at: AT };
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: { ...ORDER, outForDeliveryAt: AT, changes: [outEntry] } })], OWNER_ID);

    const later = "2026-10-01T11:00:00.000Z";
    const cleared = { id: "h2", field: "outForDelivery", oldValue: AT, newValue: null, note: null, at: later };
    const delivered = { id: "h3", field: "status", oldValue: "ready", newValue: "collected", note: null, at: later };
    const sneaky = { id: "h4", field: "deliveryFeeMinor", oldValue: "0", newValue: "999", note: null, at: later };
    const rewritten = { ...outEntry, newValue: "2026-09-01T00:00:00.000Z" };
    const pushed = { ...ORDER, status: "collected", outForDeliveryAt: null, updatedAt: later, deliveryFeeMinor: 999, changes: [rewritten, cleared, delivered, sneaky] };
    expect((await pushChanges(sql, SHOP_ID, member, [change({ entity: "order", id: "o1", data: pushed })], STAFF_ID)).rejected).toEqual([]);

    expect((await findRecord(sql, SHOP_ID, "order", "o1"))?.data).toEqual({
      ...ORDER,
      status: "collected",
      outForDeliveryAt: null,
      updatedAt: later,
      changes: [outEntry, cleared, delivered], // The stored entry as stored; only the new status entries added.
    });
  });

  it("money alone: adds expenses; writes expenses and an order's payments only", async () => {
    const member = staff({ money: true });
    expect(await pulledKinds(member)).toEqual(["shop", "setting:subscription", "setting:whatsappTemplates", "setting:deliveryDefaults", "product", "stock_move", "customer", "order", "expense", "occasion"]);

    const payment = { id: "pay1", amountMinor: 10000, method: "cash", note: null, paidAt: AT };
    const result = await pushChanges(sql, SHOP_ID, member, [
      change({ entity: "expense", id: "e2", data: { amountMinor: 700, category: "packaging" } }),
      change({ entity: "order", id: "o1", data: { ...ORDER, status: "collected", payments: [payment], paymentStatus: "paid" } }),
      change({ entity: "product", id: "p1", data: { ...PRODUCT, costMinor: 1 } }),
    ], STAFF_ID);
    expect(result.rejected.map((r) => `${r.entity}/${r.id}`)).toEqual(["product/p1"]);
    expect((await findRecord(sql, SHOP_ID, "expense", "e2"))?.data.amountMinor).toBe(700);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))?.data).toEqual({ ...ORDER, payments: [payment], paymentStatus: "paid" });
  });

  it("products alone: the catalogue only; writes products and stock moves", async () => {
    const member = staff({ products: true });
    expect(await pulledKinds(member)).toEqual(["shop", "setting:subscription", "setting:whatsappTemplates", "setting:deliveryDefaults", "product", "stock_move", "occasion"]);

    const result = await pushChanges(sql, SHOP_ID, member, [
      change({ entity: "product", id: "p2", data: { ...PRODUCT, nameAr: "كوكيز" } }),
      change({ entity: "product", id: "p1", data: { ...PRODUCT, priceMinor: 5500 } }),
      change({ entity: "order", id: "o1", data: { ...ORDER, status: "collected" } }),
      change({ entity: "customer", id: "c1", data: { name: "x" } }),
    ], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "order", id: "o1", reason: "forbidden" }, { entity: "customer", id: "c1", reason: "forbidden" }]);
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))?.data.priceMinor).toBe(5500);
  });

  it("the owner is unaffected: pulls every record, and every push applies", async () => {
    expect(await pulledKinds(owner)).toEqual(seed.map((c) => (c.entity === "setting" ? `setting:${c.id}` : c.entity)));
    const edits = seed.map((c) => ({ ...c, data: { ...c.data, edited: true } }));
    expect((await pushChanges(sql, SHOP_ID, owner, edits, OWNER_ID)).rejected).toEqual([]);
    for (const c of edits) expect((await findRecord(sql, SHOP_ID, c.entity, c.id))?.data).toEqual(c.data);
  });

  it("deliveryDefaults (tester feedback 1 Oct): the owner's {feeMinor} is stored and reaches order staff; staff cannot change it", async () => {
    expect((await findRecord(sql, SHOP_ID, "setting", "deliveryDefaults"))?.data).toEqual({ value: { feeMinor: 500 } });
    const pulled = await pullForMember(sql, SHOP_ID, staff({ orders: true }), 0);
    expect(pulled.changes.find((c) => c.entity === "setting" && c.id === "deliveryDefaults")?.data).toEqual({ value: { feeMinor: 500 } });

    const result = await pushChanges(sql, SHOP_ID, staff({ orders: true }), [change({ entity: "setting", id: "deliveryDefaults", data: { value: { feeMinor: 0 } } })], STAFF_ID);
    expect(result.rejected).toEqual([expect.objectContaining({ entity: "setting", id: "deliveryDefaults", reason: "forbidden", record: expect.objectContaining({ data: { value: { feeMinor: 500 } } }) })]);
  });
});

// Security retest 1 Oct 2026, R01: a prepare-only or money-only push read the order, merged its own
// fields onto that copy and wrote the whole record back, so an owner edit landing in between (a new
// total, say) was silently put back, with no conflict reported. Each push below is interleaved
// deterministically with another device's write: `racing` hands pushChanges a client that runs that
// other write right after pushChanges reads the record, before the read comes back: exactly the window
// the retest found (read, other write, write).
describe("R01 / a push racing another write to the same record", () => {
  const AT = "2026-10-01T10:00:00.000Z";
  const LATER = "2026-10-01T10:05:00.000Z";
  const ORDER = { customerId: "c1", status: "confirmed", fulfillmentType: "pickup", paymentStatus: "unpaid", items: [{ id: "i1", productId: "p1", quantity: 2, unitPriceMinor: 5000 }], totalMinor: 10000, payments: [], changes: [], updatedAt: AT };
  const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
  let seeded: number;
  /** The seq the other device's write left the record at. */
  let otherSeq: number;
  beforeEach(async () => {
    expect(await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: ORDER })], OWNER_ID)).toEqual({ conflicts: [], rejected: [] });
    seeded = (await findRecord(sql, SHOP_ID, "order", "o1"))!.seq;
    otherSeq = 0;
  });

  /** Another device's push of `c` as `member`, from the same up-to-date copy (baseSeq: the seeded seq),
   * noting the seq it leaves the record at. */
  const otherDevice = (member: Member, c: Partial<ChangeInput>) => async () => {
    const result = await pushChanges(sql, SHOP_ID, member, [change({ baseSeq: seeded, ...c })], member === owner ? OWNER_ID : STAFF_ID);
    expect(result.rejected).toEqual([]);
    otherSeq = (await findRecord(sql, SHOP_ID, c.entity!, c.id!))!.seq;
  };
  /** The owner's other phone changes the total. */
  const ownerEditsTotal = () => otherDevice(owner, { entity: "order", id: "o1", data: { ...ORDER, totalMinor: 12000, updatedAt: LATER } })();

  it("prepare only: the status lands on the owner's new total, and the push reports the conflict", async () => {
    const ready = { id: "h1", field: "status", oldValue: "confirmed", newValue: "ready", note: null, at: LATER };
    const pushed = { ...ORDER, status: "ready", changes: [ready], updatedAt: LATER };
    const result = await pushChanges(racing(ownerEditsTotal), SHOP_ID, staff({ prepare: true }), [change({ entity: "order", id: "o1", data: pushed, baseSeq: seeded })], STAFF_ID);

    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, totalMinor: 12000, status: "ready", changes: [ready], updatedAt: LATER });
    // Reported like any other conflict: the seq of the version this push was applied on top of.
    expect(result).toEqual({ conflicts: [{ entity: "order", id: "o1", seq: otherSeq }], rejected: [] });
    expect(otherSeq).toBeGreaterThan(seeded);
  });

  it("money only: the payment lands on the owner's new total, and the push reports the conflict", async () => {
    const payment = { id: "pay1", amountMinor: 12000, method: "cash", note: null, paidAt: LATER };
    const paid = { id: "h2", field: "paymentStatus", oldValue: "unpaid", newValue: "paid", note: null, at: LATER };
    const pushed = { ...ORDER, payments: [payment], paymentStatus: "paid", changes: [paid], updatedAt: LATER };
    const result = await pushChanges(racing(ownerEditsTotal), SHOP_ID, staff({ money: true }), [change({ entity: "order", id: "o1", data: pushed, baseSeq: seeded })], STAFF_ID);

    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, totalMinor: 12000, payments: [payment], paymentStatus: "paid", changes: [paid], updatedAt: LATER });
    expect(result).toEqual({ conflicts: [{ entity: "order", id: "o1", seq: otherSeq }], rejected: [] });
  });

  it("a status change and a payment racing each other: both land, and the later push reports the conflict", async () => {
    const paidMeanwhile = otherDevice(staff({ money: true }), { entity: "order", id: "o1", data: { ...ORDER, paymentStatus: "paid" } });
    const result = await pushChanges(racing(paidMeanwhile), SHOP_ID, staff({ prepare: true }), [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready" }, baseSeq: seeded })], STAFF_ID);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, status: "ready", paymentStatus: "paid" });
    expect(result).toEqual({ conflicts: [{ entity: "order", id: "o1", seq: otherSeq }], rejected: [] });
  });

  it("the same pushes with no write in between report no conflict", async () => {
    const prepare = await pushChanges(sql, SHOP_ID, staff({ prepare: true }), [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready" }, baseSeq: seeded })], STAFF_ID);
    expect(prepare).toEqual({ conflicts: [], rejected: [] });
    const afterPrepare = (await findRecord(sql, SHOP_ID, "order", "o1"))!.seq;
    const money = await pushChanges(sql, SHOP_ID, staff({ money: true }), [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready", paymentStatus: "paid" }, baseSeq: afterPrepare })], STAFF_ID);
    expect(money).toEqual({ conflicts: [], rejected: [] });
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, status: "ready", paymentStatus: "paid" });
  });

  it("two owner phones: the last writer still wins the whole record, and now hears about the conflict", async () => {
    const otherPhone = otherDevice(owner, { entity: "order", id: "o1", data: { ...ORDER, totalMinor: 12000 } });
    const result = await pushChanges(racing(otherPhone), SHOP_ID, owner, [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready" }, baseSeq: seeded })], OWNER_ID);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, status: "ready" });
    expect(result).toEqual({ conflicts: [{ entity: "order", id: "o1", seq: otherSeq }], rejected: [] });
  });

  it("an order the owner deletes in between is refused to prepare-only staff, with the tombstone as the server's copy", async () => {
    const ownerDeletes = otherDevice(owner, { entity: "order", id: "o1", data: ORDER, deleted: true });
    const result = await pushChanges(racing(ownerDeletes), SHOP_ID, staff({ prepare: true }), [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready" }, baseSeq: seeded })], STAFF_ID);
    const stored = (await findRecord(sql, SHOP_ID, "order", "o1"))!;
    expect(stored).toMatchObject({ deleted: true, data: ORDER, seq: otherSeq });
    expect(result).toEqual({ conflicts: [], rejected: [{ entity: "order", id: "o1", reason: "forbidden", record: { data: ORDER, deleted: true, seq: otherSeq, updatedAt: stored.updatedAt } }] });
  });

  it("a record another phone creates in between is not overwritten blind: the push lands on top and is reported", async () => {
    const otherPhoneCreates = otherDevice(owner, { entity: "customer", id: "c9", data: { name: "Noora", phone: "+97333000001" }, baseSeq: 0 });
    const result = await pushChanges(racing(otherPhoneCreates), SHOP_ID, owner, [change({ entity: "customer", id: "c9", data: { name: "Noora A." } })], OWNER_ID);
    expect((await findRecord(sql, SHOP_ID, "customer", "c9"))!.data).toEqual({ name: "Noora A." });
    expect(result).toEqual({ conflicts: [{ entity: "customer", id: "c9", seq: otherSeq }], rejected: [] });
  });

  it("gives up with an error, writing nothing stale, when the record changes under every attempt", async () => {
    let total = 12000;
    const keepsEditing = async () => {
      total += 1;
      await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: { ...ORDER, totalMinor: total } })], OWNER_ID);
    };
    const push = pushChanges(racing(keepsEditing, 100), SHOP_ID, staff({ prepare: true }), [change({ entity: "order", id: "o1", data: { ...ORDER, status: "ready" }, baseSeq: seeded })], STAFF_ID);
    await expect(push).rejects.toThrow(/kept changing/);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ ...ORDER, totalMinor: total });
  });
});

// Integrity review R3 (3 Oct 2026): an order records what it took out of stock, `stockDeducted`
// { productId: units }, and gives back exactly that. Staff who only prepare orders confirm and cancel
// them (and move the products' stock with it), so their pushes carry the ledger too.
describe("R3 / the order stock ledger through a real push", () => {
  const AT = "2026-10-03T08:00:00.000Z";
  const ORDER = { customerId: "c1", status: "newOrder", fulfillmentType: "pickup", paymentStatus: "unpaid", items: [{ id: "i1", productId: "p1", quantity: 3, unitPriceMinor: 6500 }], payments: [], changes: [], notes: "No nuts", updatedAt: AT };
  const PRODUCT = { nameAr: "كيك", priceMinor: 6500, trackStock: true, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [] };
  const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
  const statusEntry = (id: string, from: string, to: string) => ({ id, field: "status", oldValue: from, newValue: to, note: null, at: AT });
  const move = (id: string, delta: number, reason: string) => ({ id, delta, reason, orderId: "o1", note: null, at: AT });
  const orderNow = async () => (await findRecord(sql, SHOP_ID, "order", "o1"))!.data;
  const productNow = async () => (await findRecord(sql, SHOP_ID, "product", "p1"))!.data;
  /** A change of an up-to-date copy: based on the seq the record has now, so it is no conflict. */
  const fresh = async (entity: "order" | "product", id: string, data: Record<string, unknown>) => change({ entity, id, data, baseSeq: (await findRecord(sql, SHOP_ID, entity, id))!.seq });

  beforeEach(async () => {
    const seeded = await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: PRODUCT }), change({ entity: "order", id: "o1", data: ORDER })], OWNER_ID);
    expect(seeded).toEqual({ conflicts: [], rejected: [] });
  });

  it("prepare only: confirming stores the status and the ledger, cancelling puts the ledger back to {}, and the product's stock follows", async () => {
    const member = staff({ prepare: true });
    const confirmed = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 3 }, updatedAt: "2026-10-03T08:01:00.000Z" };
    const took = { ...PRODUCT, stockQuantity: 7, stockMoves: [move("m1", -3, "orderConfirmed")] };
    expect(await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", took), await fresh("order", "o1", confirmed)], STAFF_ID)).toEqual({ conflicts: [], rejected: [] });
    expect(await orderNow()).toEqual(confirmed);
    expect((await productNow()).stockQuantity).toBe(7);

    const cancelled = { ...confirmed, status: "cancelled", changes: [...confirmed.changes, statusEntry("h2", "confirmed", "cancelled")], stockDeducted: {}, updatedAt: "2026-10-03T08:02:00.000Z" };
    const gaveBack = { ...took, stockQuantity: 10, stockMoves: [move("m2", 3, "orderCancelled"), ...took.stockMoves] };
    expect(await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", gaveBack), await fresh("order", "o1", cancelled)], STAFF_ID)).toEqual({ conflicts: [], rejected: [] });
    expect(await orderNow()).toEqual(cancelled);
    expect((await productNow()).stockQuantity).toBe(10);
  });

  it("prepare only: a ledger that is not valid is not stored, and every other field of the push stays the stored one", async () => {
    const member = staff({ prepare: true });
    const confirmed = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 3 } };
    await pushChanges(sql, SHOP_ID, member, [change({ entity: "order", id: "o1", data: confirmed })], STAFF_ID);
    for (const forged of [{ p1: 1_000_001 }, { p1: -3 }, { p1: 2.5 }, [3], "p1:3", { ["k".repeat(65)]: 1 }]) {
      const attempt = { ...confirmed, stockDeducted: forged, notes: "Attempted rename" };
      expect((await pushChanges(sql, SHOP_ID, member, [change({ entity: "order", id: "o1", data: attempt })], STAFF_ID)).rejected, JSON.stringify(forged)).toEqual([]);
      expect(await orderNow()).toEqual(confirmed);
    }
  });

  it("money only: cannot rewrite the ledger; its payment lands and the ledger stays as stored", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: { ...ORDER, status: "confirmed", stockDeducted: { p1: 3 } } })], OWNER_ID);
    const payment = { id: "pay1", amountMinor: 19500, method: "cash", note: null, paidAt: AT };
    const forged = { ...ORDER, status: "confirmed", stockDeducted: { p1: 1_000_000 }, payments: [payment], paymentStatus: "paid" };
    expect((await pushChanges(sql, SHOP_ID, staff({ money: true }), [change({ entity: "order", id: "o1", data: forged })], STAFF_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual({ ...ORDER, status: "confirmed", stockDeducted: { p1: 3 }, payments: [payment], paymentStatus: "paid" });
  });

  it("orders staff and the owner store the whole record, ledger included, and a phone that never heard of it keeps it", async () => {
    const edited = { ...ORDER, status: "confirmed", stockDeducted: { p1: 3 }, notes: "Edited" };
    expect((await pushChanges(sql, SHOP_ID, staff({ orders: true }), [change({ entity: "order", id: "o1", data: edited })], STAFF_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual(edited);
    // An older phone pulls the order, edits its notes and pushes the record back with the key it does not know.
    const pulled = (await pullForMember(sql, SHOP_ID, owner, 0)).changes.find((c) => c.entity === "order")!;
    const fromOlderPhone = { ...pulled.data, notes: "Edited on an older phone" };
    expect((await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: fromOlderPhone })], OWNER_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual({ ...edited, notes: "Edited on an older phone" });
  });

  // Second review (3 Oct 2026), L1: a missing ledger never clears a stored one.
  it("L1 acceptance: stored {p1: 3}, a prepare-only 'ready' push without the key leaves it, and a later cancel gives back exactly 3", async () => {
    const member = staff({ prepare: true });
    const confirmed = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 3 }, updatedAt: "2026-10-03T08:01:00.000Z" };
    const took = { ...PRODUCT, stockQuantity: 7, stockMoves: [move("m1", -3, "orderConfirmed")] };
    expect(await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", took), await fresh("order", "o1", confirmed)], STAFF_ID)).toEqual({ conflicts: [], rejected: [] });

    // An older app (or a stale copy) moves the order on: it does not know the ledger and sends none.
    const { stockDeducted: _unknown, ...withoutLedger } = confirmed;
    void _unknown;
    const ready = { ...withoutLedger, status: "ready", changes: [...confirmed.changes, statusEntry("h2", "confirmed", "ready")], updatedAt: "2026-10-03T08:02:00.000Z" };
    expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", ready)], STAFF_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual({ ...ready, stockDeducted: { p1: 3 } });

    // The cancel gives back exactly 3, and writes {}.
    const cancelled = { ...ready, status: "cancelled", stockDeducted: {}, changes: [...ready.changes, statusEntry("h3", "ready", "cancelled")], updatedAt: "2026-10-03T08:03:00.000Z" };
    const gaveBack = { ...took, stockQuantity: 10, stockMoves: [move("m2", 3, "orderCancelled"), ...took.stockMoves] };
    expect(await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", gaveBack), await fresh("order", "o1", cancelled)], STAFF_ID)).toEqual({ conflicts: [], rejected: [] });
    expect((await orderNow()).stockDeducted).toEqual({});
    expect((await productNow()).stockQuantity).toBe(10);
  });

  it("L1: a whole-order push (owner, orders staff) that leaves the key out keeps the stored ledger; an explicit {} clears it", async () => {
    const confirmed = { ...ORDER, status: "confirmed", stockDeducted: { p1: 3 } };
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: confirmed })], OWNER_ID);
    for (const [member, by] of [[owner, OWNER_ID], [staff({ orders: true }), STAFF_ID]] as const) {
      const { stockDeducted: _unknown, ...fromOlderApp } = confirmed;
      void _unknown;
      const edit = { ...fromOlderApp, notes: `Edited by ${by}` };
      expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", edit)], by)).rejected).toEqual([]);
      expect(await orderNow()).toEqual({ ...edit, stockDeducted: { p1: 3 } });
    }
    expect((await pushChanges(sql, SHOP_ID, owner, [await fresh("order", "o1", { ...confirmed, status: "cancelled", stockDeducted: {} })], OWNER_ID)).rejected).toEqual([]);
    expect((await orderNow()).stockDeducted).toEqual({});
  });

  // L3: a prepare-only push may only write a ledger that fits the stored order.
  it("L3 acceptance: {p1: 3} to an unrelated 1,000,000 by prepare-only staff leaves {p1: 3}, and the rest of the push is still handled", async () => {
    const member = staff({ prepare: true });
    const confirmed = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 3 }, updatedAt: "2026-10-03T08:01:00.000Z" };
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "order", id: "o1", data: confirmed })], OWNER_ID);

    // Nothing but the ledger differs, and it fits no rule: the stored order is what comes back out.
    const forged = { ...confirmed, stockDeducted: { unrelated: 1_000_000 } };
    expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", forged)], STAFF_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual(confirmed);

    // The status moves on in the same push: that is handled as today, the forged ledger is not.
    const ready = { ...forged, status: "ready", changes: [...confirmed.changes, statusEntry("h2", "confirmed", "ready")], updatedAt: "2026-10-03T08:02:00.000Z" };
    expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", ready)], STAFF_ID)).rejected).toEqual([]);
    expect(await orderNow()).toEqual({ ...ready, stockDeducted: { p1: 3 } });
  });

  it("L3: inflated quantities are ignored on confirm; a ledger that fits the stored order is taken", async () => {
    const member = staff({ prepare: true });
    const inflated = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 1_000_000 } };
    expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", inflated)], STAFF_ID)).rejected).toEqual([]);
    const afterInflated = await orderNow();
    expect(afterInflated.status).toBe("confirmed");
    expect("stockDeducted" in afterInflated).toBe(false);
    // A legacy order (no ledger) staying deducted may get the ledger the phone derived, when it fits the lines.
    const derived = { ...inflated, status: "ready", stockDeducted: { p1: 3 }, changes: [...inflated.changes, statusEntry("h2", "confirmed", "ready")] };
    expect((await pushChanges(sql, SHOP_ID, member, [await fresh("order", "o1", derived)], STAFF_ID)).rejected).toEqual([]);
    expect((await orderNow()).stockDeducted).toEqual({ p1: 3 });
  });

  it("L3: restore after tracking was switched off still works: the order took 3, the product no longer tracks, cancel gives them back", async () => {
    const member = staff({ prepare: true });
    const confirmed = { ...ORDER, status: "confirmed", changes: [statusEntry("h1", "newOrder", "confirmed")], stockDeducted: { p1: 3 }, updatedAt: "2026-10-03T08:01:00.000Z" };
    const took = { ...PRODUCT, stockQuantity: 7, stockMoves: [move("m1", -3, "orderConfirmed")] };
    await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", took), await fresh("order", "o1", confirmed)], STAFF_ID);
    // The owner switches the product's tracking off (stock stays 7), then someone cancels the order.
    const untracked = { ...took, trackStock: false };
    await pushChanges(sql, SHOP_ID, owner, [await fresh("product", "p1", untracked)], OWNER_ID);
    const cancelled = { ...confirmed, status: "cancelled", stockDeducted: {}, changes: [...confirmed.changes, statusEntry("h2", "confirmed", "cancelled")], updatedAt: "2026-10-03T08:03:00.000Z" };
    const gaveBack = { ...untracked, stockQuantity: 10, stockMoves: [move("m2", 3, "orderCancelled"), ...took.stockMoves] };
    expect(await pushChanges(sql, SHOP_ID, member, [await fresh("product", "p1", gaveBack), await fresh("order", "o1", cancelled)], STAFF_ID)).toEqual({ conflicts: [], rejected: [] });
    expect(await orderNow()).toEqual(cancelled);
    expect((await productNow()).stockQuantity).toBe(10);
  });
});

// Second review (3 Oct 2026), L2: a product's stock is the result of its moves, each applied exactly once.
// Two phones hold the same copy of a product (stock 10); one confirms 3 (A, move a), the other confirms 2
// from its stale copy (B, move b). The server rebases B's push onto the stored quantity and moves — inside
// the compare-and-swap write, so a write that lands between the read and the write is rebased onto too —
// instead of refusing it (staff) or overwriting a (owner). Everything here goes through the real push path.
describe("L2 / stock moves are merged on the server, never lost and never refused for being stale", () => {
  const T = (minute: number) => new Date(Date.UTC(2026, 9, 3, 8, minute)).toISOString();
  const PRODUCT = { nameAr: "كيك", priceMinor: 6500, costMinor: 2500, trackStock: true, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [] as unknown[], createdAt: T(0), updatedAt: T(0) };
  const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
  const mv = (id: string, delta: number, reason: string, orderId: string, minute: number) => ({ id, delta, reason, orderId, note: null, at: T(minute) });
  const order = (id: string, status: string, units: number, minute: number, ledger?: Record<string, number>) => ({
    customerId: "c1",
    status,
    fulfillmentType: "pickup",
    paymentStatus: "unpaid",
    items: [{ id: `i-${id}`, productId: "p1", nameSnapshot: "Cake", quantity: units, unitPriceMinor: 6500, unitCostMinor: 2500 }],
    payments: [],
    changes: [],
    updatedAt: T(minute),
    ...(ledger ? { stockDeducted: ledger } : {}),
  });
  const ownerPhone = { name: "owner", member: owner, by: OWNER_ID };
  const ordersPhone = { name: "orders staff", member: staff({ orders: true }), by: STAFF_ID };
  const preparePhone = { name: "prepare staff", member: staff({ prepare: true }), by: STAFF_ID };
  type Phone = typeof ownerPhone;
  const seqOf = async (entity: "order" | "product", id: string) => (await findRecord(sql, SHOP_ID, entity, id))!.seq;
  const productNow = async () => (await findRecord(sql, SHOP_ID, "product", "p1"))!.data as typeof PRODUCT;
  const orderNow = async (id: string) => (await findRecord(sql, SHOP_ID, "order", id))!.data;
  const movesNow = async () => (await productNow()).stockMoves.map((m) => (m as { id: string }).id);
  /** The change of a copy a phone made from the version it last pulled (baseSeq). */
  const push = (phone: Phone, entity: "order" | "product", id: string, data: Record<string, unknown>, baseSeq: number) =>
    pushChanges(sql, SHOP_ID, phone.member, [change({ entity, id, data, baseSeq })], phone.by);

  /** Both phones start from the same copies: product p1 with 10 in stock and no moves, orders oA (3 units) and oB (2). */
  let base: { product: number; oA: number; oB: number };
  beforeEach(async () => {
    const seeded = await pushChanges(sql, SHOP_ID, owner, [
      change({ entity: "product", id: "p1", data: PRODUCT }),
      change({ entity: "order", id: "oA", data: order("oA", "newOrder", 3, 0) }),
      change({ entity: "order", id: "oB", data: order("oB", "newOrder", 2, 0) }),
    ], OWNER_ID);
    expect(seeded).toEqual({ conflicts: [], rejected: [] });
    base = { product: await seqOf("product", "p1"), oA: await seqOf("order", "oA"), oB: await seqOf("order", "oB") };
  });

  // What A's and B's phones push after confirming, each from the copy it holds (stock 10).
  const a = mv("a", -3, "orderConfirmed", "oA", 1);
  const b = mv("b", -2, "orderConfirmed", "oB", 2);
  const aProduct = { ...PRODUCT, stockQuantity: 7, stockMoves: [a], updatedAt: T(1) };
  const bProduct = { ...PRODUCT, stockQuantity: 8, stockMoves: [b], updatedAt: T(2) };
  const aOrder = () => order("oA", "confirmed", 3, 1, { p1: 3 });
  const bOrder = () => order("oB", "confirmed", 2, 2, { p1: 2 });
  const confirmA = async (phone: Phone) => {
    expect((await push(phone, "product", "p1", aProduct, base.product)).rejected).toEqual([]);
    expect((await push(phone, "order", "oA", aOrder(), base.oA)).rejected).toEqual([]);
  };
  const confirmB = async (phone: Phone) => {
    const result = await pushChanges(sql, SHOP_ID, phone.member, [
      change({ entity: "product", id: "p1", data: bProduct, baseSeq: base.product }),
      change({ entity: "order", id: "oB", data: bOrder(), baseSeq: base.oB }),
    ], phone.by);
    expect(result.rejected, `${phone.name}: B's product push is not refused for being stale`).toEqual([]);
    return result;
  };

  const PAIRS: [Phone, Phone][] = [[ownerPhone, ownerPhone], [ownerPhone, preparePhone], [preparePhone, preparePhone], [ordersPhone, preparePhone]];

  for (const [phoneA, phoneB] of PAIRS) {
    it(`acceptance 1 (${phoneA.name} + ${phoneB.name}): A confirms 3, stale B confirms 2: stock 5 with both moves, B's ledger {p1: 2} is true; cancelling B gives 7, A too gives 10`, async () => {
      await confirmA(phoneA);
      expect((await productNow()).stockQuantity).toBe(7);
      const cursor = (await pullForMember(sql, SHOP_ID, owner, 0)).cursor;

      const result = await confirmB(phoneB);
      // B's copy was behind: reported like any stale push, but applied.
      expect(result.conflicts).toContainEqual({ entity: "product", id: "p1", seq: expect.any(Number) });
      const merged = await productNow();
      expect(merged.stockQuantity).toBe(5);
      expect(await movesNow()).toEqual(["b", "a"]);
      expect(merged.stockMoves).toEqual([b, a]);
      expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
      // Other fields of a staff push come from the stored copy; the owner's from the pushed one (identical here).
      expect(merged).toMatchObject({ nameAr: "كيك", priceMinor: 6500, trackStock: true, lowStockThreshold: 3 });

      // The merged copy comes back to B on the same sync's pull (a fresh seq), so B ends with 5, not its own 8.
      const pulled = await pullForMember(sql, SHOP_ID, phoneB.member, cursor);
      const mergedRow = pulled.changes.find((c) => c.entity === "product" && c.id === "p1");
      expect(mergedRow?.data).toEqual(merged);
      expect(mergedRow!.seq).toBe(await seqOf("product", "p1"));

      // B cancels oB from the merged copy it pulled: +2 -> 7.
      const cancelB = mv("cb", 2, "orderCancelled", "oB", 3);
      expect((await push(phoneB, "product", "p1", { ...merged, stockQuantity: 7, stockMoves: [cancelB, ...merged.stockMoves], updatedAt: T(3) }, mergedRow!.seq)).rejected).toEqual([]);
      expect((await push(phoneB, "order", "oB", { ...bOrder(), status: "cancelled", stockDeducted: {}, updatedAt: T(3) }, await seqOf("order", "oB"))).rejected).toEqual([]);
      expect((await productNow()).stockQuantity).toBe(7);

      // A cancels oA from its own stale copy (7 with only move a): +3 on the stored 7 -> 10, not 10 by luck.
      const cancelA = mv("ca", 3, "orderCancelled", "oA", 4);
      expect((await push(phoneA, "product", "p1", { ...aProduct, stockQuantity: 10, stockMoves: [cancelA, a], updatedAt: T(4) }, base.product)).rejected).toEqual([]);
      expect((await push(phoneA, "order", "oA", { ...aOrder(), status: "cancelled", stockDeducted: {}, updatedAt: T(4) }, await seqOf("order", "oA"))).rejected).toEqual([]);
      const end = await productNow();
      expect(end.stockQuantity).toBe(10);
      expect(end.stockMoves.map((m) => (m as { id: string }).id)).toEqual(["ca", "cb", "b", "a"]);
      expect((await orderNow("oA")).stockDeducted).toEqual({});
      expect((await orderNow("oB")).stockDeducted).toEqual({});
    });
  }

  it("acceptance 1, the other way round: B's push lands first, A's stale push is rebased the same way", async () => {
    await confirmB(ownerPhone);
    expect((await productNow()).stockQuantity).toBe(8);
    await confirmA(preparePhone);
    const merged = await productNow();
    expect(merged.stockQuantity).toBe(5);
    expect(merged.stockMoves).toEqual([a, b]);
  });

  for (const phone of [ownerPhone, preparePhone]) {
    it(`acceptance 2 (${phone.name}): B retries the same pushes twice, and A retries too: nothing is applied twice`, async () => {
      await confirmA(ownerPhone);
      await confirmB(phone);
      const settled = await productNow();
      expect(settled.stockQuantity).toBe(5);
      for (let retry = 0; retry < 2; retry++) {
        const again = await confirmB(phone);
        // Still reported as stale (the retry carries B's old baseSeq), and rewrites the same stock.
        expect(again.rejected).toEqual([]);
        await confirmA(ownerPhone);
        const now = await productNow();
        expect(now.stockQuantity).toBe(5);
        expect(now.stockMoves).toEqual([b, a]);
        expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
      }
    });
  }

  it("acceptance 2: the same push applied twice by one phone alone (no other phone) moves stock once", async () => {
    await confirmB(ownerPhone);
    await confirmB(ownerPhone);
    await confirmB(preparePhone);
    const now = await productNow();
    expect(now.stockQuantity).toBe(8);
    expect(now.stockMoves).toEqual([b]);
  });

  for (const phone of [ownerPhone, preparePhone]) {
    it(`acceptance 3 (${phone.name}): B's order lands first and its product push later, or again after a retry: the stock ends the same`, async () => {
      // B's order push (ledger {p1: 2}) arrives first, then A's whole push, and only then B's product.
      expect((await push(phone, "order", "oB", bOrder(), base.oB)).rejected).toEqual([]);
      await confirmA(ownerPhone);
      expect((await productNow()).stockQuantity).toBe(7);
      expect((await push(phone, "product", "p1", bProduct, base.product)).rejected).toEqual([]);
      expect((await productNow()).stockQuantity).toBe(5);
      // ... and again after a retry (the whole batch re-sent in the opposite order).
      expect((await push(phone, "product", "p1", bProduct, base.product)).rejected).toEqual([]);
      expect((await push(phone, "order", "oB", bOrder(), base.oB)).rejected).toEqual([]);
      const end = await productNow();
      expect(end.stockQuantity).toBe(5);
      expect(end.stockMoves).toEqual([b, a]);
      expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
    });
  }

  it("acceptance 3: the order's own push never decides the stock: stock follows the moves whichever push comes last", async () => {
    await confirmB(ownerPhone);
    await confirmA(ownerPhone);
    // B's order push repeated after everything else changes no stock.
    await push(ownerPhone, "order", "oB", bOrder(), base.oB);
    expect((await productNow()).stockQuantity).toBe(5);
  });

  for (const arrival of [["phone 1", "phone 2"], ["phone 2", "phone 1"]] as const) {
    it(`acceptance 4 (${arrival.join(" then ")}): conflicting item edits of one order on two phones end with every move applied once`, async () => {
      // Order oX (3 units) was confirmed (stock 10 -> 7, move c) and both phones hold that copy.
      const c = mv("c", -3, "orderConfirmed", "oX", 1);
      await pushChanges(sql, SHOP_ID, owner, [
        change({ entity: "product", id: "p1", data: { ...PRODUCT, stockQuantity: 7, stockMoves: [c], updatedAt: T(1) } }),
        change({ entity: "order", id: "oX", data: order("oX", "confirmed", 3, 1, { p1: 3 }) }),
      ], OWNER_ID);
      const synced = { product: await seqOf("product", "p1"), order: await seqOf("order", "oX") };

      // Phone 1 raises the order to 5 units (-2), phone 2 raises it to 4 (-1): each from the 7-copy it holds.
      const e1 = mv("e1", -2, "orderEdited", "oX", 2);
      const e2 = mv("e2", -1, "orderEdited", "oX", 3);
      const phones = {
        "phone 1": { product: { ...PRODUCT, stockQuantity: 5, stockMoves: [e1, c], updatedAt: T(2) }, order: order("oX", "confirmed", 5, 2, { p1: 5 }) },
        "phone 2": { product: { ...PRODUCT, stockQuantity: 6, stockMoves: [e2, c], updatedAt: T(3) }, order: order("oX", "confirmed", 4, 3, { p1: 4 }) },
      };
      for (const name of arrival) {
        const result = await pushChanges(sql, SHOP_ID, owner, [
          change({ entity: "product", id: "p1", data: phones[name].product, baseSeq: synced.product }),
          change({ entity: "order", id: "oX", data: phones[name].order, baseSeq: synced.order }),
        ], OWNER_ID);
        expect(result.rejected).toEqual([]);
      }
      // Stock is what the moves say, whichever phone's pushes arrive first: 10 - 3 - 2 - 1 = 4, none lost, none twice.
      const end = await productNow();
      expect(end.stockMoves.map((m) => (m as { id: string }).id).sort()).toEqual(["c", "e1", "e2"]);
      expect(end.stockQuantity).toBe(4);
    });
  }

  it("acceptance 5: an owner's stale rename and price edit from an old copy keeps the other phone's stock move", async () => {
    await confirmA(preparePhone); // stock 7, move a
    const staleEdit = { ...PRODUCT, nameAr: "كيك الشوكولاتة", priceMinor: 7000, stockQuantity: 10, stockMoves: [], updatedAt: T(5) };
    const result = await push(ownerPhone, "product", "p1", staleEdit, base.product);
    expect(result.rejected).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    const end = await productNow();
    expect(end).toMatchObject({ nameAr: "كيك الشوكولاتة", priceMinor: 7000, stockQuantity: 7, stockMoves: [a], updatedAt: T(5) });
  });

  it("acceptance 5: staff with products (not the owner) get the same merge for an edit from an old copy", async () => {
    await confirmA(ownerPhone);
    const productsStaff = { name: "products staff", member: staff({ products: true }), by: STAFF_ID };
    const staleEdit = { ...PRODUCT, lowStockThreshold: 9, stockQuantity: 10, stockMoves: [], updatedAt: T(5) };
    expect((await push(productsStaff, "product", "p1", staleEdit, base.product)).rejected).toEqual([]);
    expect(await productNow()).toMatchObject({ lowStockThreshold: 9, stockQuantity: 7, stockMoves: [a] });
  });

  it("an up-to-date copy is stored as sent: a manual correction and an edit land as before", async () => {
    await confirmA(ownerPhone);
    const seen = await seqOf("product", "p1");
    const correction = { id: "k1", delta: 5, reason: "correction", orderId: null, note: null, at: T(6) };
    const edited = { ...aProduct, priceMinor: 7000, stockQuantity: 12, stockMoves: [correction, a], updatedAt: T(6) };
    expect((await push(ownerPhone, "product", "p1", edited, seen)).conflicts).toEqual([]);
    expect(await productNow()).toEqual(edited);
  });

  it("staff without products still add order-driven moves only: a manual correction is refused with the server's copy", async () => {
    await confirmA(ownerPhone);
    const manual = { ...aProduct, stockQuantity: 100, stockMoves: [mv("k2", 93, "correction", "oA", 7), a] };
    const result = await push(preparePhone, "product", "p1", manual, await seqOf("product", "p1"));
    expect(result.rejected).toEqual([{ entity: "product", id: "p1", reason: "forbidden", record: expect.objectContaining({ data: aProduct }) }]);
    expect((await productNow()).stockQuantity).toBe(7);
  });

  // The merge runs inside the compare-and-swap write: a write landing between the read and the write is
  // merged onto, not overwritten.
  describe("interleavings made deterministic by writing between the read and the write", () => {
    for (const phone of [ownerPhone, preparePhone]) {
      it(`${phone.name}: B reads the product, A's push lands, B's compare-and-swap fails and B is rebased onto A's copy`, async () => {
        const aLands = async () => {
          expect((await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: aProduct, baseSeq: base.product })], OWNER_ID)).rejected).toEqual([]);
        };
        const result = await pushChanges(racing(aLands), SHOP_ID, phone.member, [change({ entity: "product", id: "p1", data: bProduct, baseSeq: base.product })], phone.by);
        expect(result.rejected).toEqual([]);
        expect(result.conflicts).toEqual([{ entity: "product", id: "p1", seq: expect.any(Number) }]);
        const end = await productNow();
        expect(end.stockQuantity).toBe(5);
        expect(end.stockMoves).toEqual([b, a]);
      });
    }

    it("A's push lands while B's retry is being decided: the retry is a no-op on top of a copy that already holds b", async () => {
      await confirmA(ownerPhone);
      await confirmB(ownerPhone);
      const moreLands = async () => {
        const c = mv("c3", -1, "orderConfirmed", "oC", 5);
        const current = await productNow();
        await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: { ...current, stockQuantity: 4, stockMoves: [c, ...current.stockMoves] }, baseSeq: await seqOf("product", "p1") })], OWNER_ID);
      };
      await pushChanges(racing(moreLands), SHOP_ID, preparePhone.member, [change({ entity: "product", id: "p1", data: bProduct, baseSeq: base.product })], STAFF_ID);
      const end = await productNow();
      expect(end.stockQuantity).toBe(4);
      expect(end.stockMoves.map((m) => (m as { id: string }).id)).toEqual(["c3", "b", "a"]);
    });

    it("two other phones write between B's reads: B is rebased again on each newer copy and still applies b once", async () => {
      let n = 0;
      const eachOtherPhone = async () => {
        n += 1;
        const current = await productNow();
        const m = mv(`x${n}`, -1, "orderConfirmed", `ox${n}`, 10 + n);
        await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: { ...current, stockQuantity: current.stockQuantity - 1, stockMoves: [m, ...current.stockMoves] }, baseSeq: await seqOf("product", "p1") })], OWNER_ID);
      };
      const result = await pushChanges(racing(eachOtherPhone, 2), SHOP_ID, preparePhone.member, [change({ entity: "product", id: "p1", data: bProduct, baseSeq: base.product })], STAFF_ID);
      expect(result.rejected).toEqual([]);
      const end = await productNow();
      expect(end.stockQuantity).toBe(10 - 1 - 1 - 2);
      expect(end.stockMoves.map((m) => (m as { id: string }).id).sort()).toEqual(["b", "x1", "x2"]);
    });
  });

  describe("trimmed histories (the lists keep the last 50 moves)", () => {
    const received = (n: number) => ({ id: `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
    /** `count` moves, newest first, the newest being h<newest> */
    const window = (newest: number, count: number) => Array.from({ length: count }, (_, i) => received(newest - i));

    it("a stale copy that still holds moves the server has trimmed off the end does not apply them again; one new move lands once", async () => {
      // The server's list is full: h59 (newest) ... h10; h0..h9 were trimmed off it long ago.
      await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: { ...PRODUCT, stockQuantity: 100, stockMoves: window(59, 50) } })], OWNER_ID);
      // A phone that was offline holds an older window, h49 ... h1, and adds one new move on top.
      const newMove = { id: "n1", delta: -2, reason: "orderConfirmed", orderId: "oN", note: null, at: "2026-10-03T09:00:00.000Z" };
      const stale = { ...PRODUCT, stockQuantity: 55, stockMoves: [newMove, ...window(49, 49)] };
      expect((await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: stale })], OWNER_ID)).rejected).toEqual([]);
      const end = await productNow();
      expect(end.stockQuantity).toBe(98); // 100 stored, minus the one genuinely new move; h1..h9 are not added again
      expect(end.stockMoves).toHaveLength(50);
      expect(end.stockMoves.map((m) => (m as { id: string }).id).slice(0, 3)).toEqual(["n1", "h59", "h58"]);
      // The same push again changes nothing.
      await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: stale })], OWNER_ID);
      expect((await productNow()).stockQuantity).toBe(98);
    });
  });
});

describe("pullForMember / pagination", () => {
  it("reports more: true and a cursor at the page boundary when more records remain", async () => {
    const changes: ChangeInput[] = Array.from({ length: 3 }, (_, i) => change({ id: `order-${i}` }));
    await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);

    // Simulate a small page size by pulling with cursor 0 and expecting all 3 back with more:false
    // (3 < the real 500-row page size) — then prove pagination end to end with the cursor it returns.
    const firstPull = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(firstPull.more).toBe(false);
    expect(firstPull.changes).toHaveLength(3);

    const secondPull = await pullForMember(sql, SHOP_ID, owner, firstPull.cursor);
    expect(secondPull.changes).toHaveLength(0);
    expect(secondPull.more).toBe(false);
    expect(secondPull.cursor).toBe(firstPull.cursor);
  });

  it("loops to a second page when the first is exactly full (more: true), then finishes", async () => {
    // Push 501 distinct records so the first 500-row page is completely full.
    const changes: ChangeInput[] = Array.from({ length: 501 }, (_, i) => change({ id: `order-${i}` }));
    await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);

    const firstPage = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(firstPage.changes).toHaveLength(500);
    expect(firstPage.more).toBe(true);

    const secondPage = await pullForMember(sql, SHOP_ID, owner, firstPage.cursor);
    expect(secondPage.changes).toHaveLength(1);
    expect(secondPage.more).toBe(false);
  }, 30000);

  it("a pull with no new records returns an empty page and the same cursor", async () => {
    const pulled = await pullForMember(sql, SHOP_ID, owner, 999);
    expect(pulled).toEqual({ changes: [], cursor: 999, more: false });
  });
});
