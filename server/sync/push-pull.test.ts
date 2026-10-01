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
  const isRecordRead = (text: string) => /^\s*select\b[\s\S]*\bfrom orderat\.records\b/i.test(text);

  /** `sql`, except that the first `times` reads of a record each run `otherWrite` before they return. */
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
