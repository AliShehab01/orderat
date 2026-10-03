// Final verification, task 5: failure handling. What the phone sees when the server cannot finish a push, and whether one bad
// record can keep a whole batch (and with iOS 1.0, every later batch and the pull) from ever going through.
//
// iOS 1.0 (SyncEngine.syncNow): a non-200 answer aborts the round; every record of the batch stays dirty and is sent again at the
// next trigger, forever if the answer never changes. A 200 answer acknowledges every record of the batch that is not listed in
// `rejected` (Store.applyPushResult), so a record the server skipped silently would be lost on the phone for good.
// So: a server that cannot finish ONE record must still answer 200 for the batch when the failure is that record's own
// (deterministic), and may answer non-200 only for failures that go away by themselves (contention, a dropped connection).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet, type J } from "./fleet.ts";
import { SimPhone } from "./phone.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let sql: SqlClient;
let fleet: Fleet;
let owner: { userId: string; session: string };

beforeEach(async () => {
  sql = await createCloudTestSql();
  fleet = new Fleet(sql);
  owner = await fleet.newUser("owner");
  await fleet.createShop(owner.session);
});

const base = (entity: string, id: string, data: J, baseSeq = 0): J => ({ entity, id, data, deleted: false, baseSeq });
const sync = (changes: J[], cursor = 0, session = owner.session) => fleet.call(session, { action: "sync", shopId: fleet.shopId, cursor, changes });

// ---------------------------------------------------------------------------------------------------------------------------
// A tiny seeded generator, so a failing case can be replayed exactly.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values a broken, old or hostile client could put in any field the server reads. */
const WEIRD: unknown[] = [
  null, true, false, 0, -1, 1, 0.5, -0.5, 1e21, 1e300, -1e300, 2147483648, 3000000000, 9007199254740993, Number.MAX_SAFE_INTEGER, "", " ", "x", "ABC", "a".repeat(70), "a".repeat(700),
  "\u0000a".replace("\u0000", ""), "😀", "اختبار", [], [null], [[]], [{}], {}, { a: 1 }, { "__proto__": 1 }, ["a"], [1, 2, 3], { id: "x" }, { id: 5 }, { id: "" }, "2026-10-03T00:00:00.000Z", "not a date",
];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function moveLike(r: () => number, orderIds: string[], productId: string): J {
  const base: J = { id: crypto.randomUUID().toUpperCase(), delta: pick(r, [-3, -1, 1, 2, 5]), reason: pick(r, ["orderConfirmed", "orderCancelled", "orderEdited", "received", "damaged", "correction"]), orderId: pick(r, [...orderIds, null]), note: null, at: new Date(Date.UTC(2026, 9, 3, 8, Math.floor(r() * 59))).toISOString() };
  const keys = Object.keys(base);
  const n = Math.floor(r() * 3);
  for (let i = 0; i < n; i++) base[pick(r, keys)] = pick(r, WEIRD);
  void productId;
  return base;
}

function mutate(r: () => number, data: J, keys: string[]): J {
  const out: J = JSON.parse(JSON.stringify(data));
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const k = pick(r, keys);
    const roll = r();
    if (roll < 0.15) delete out[k];
    else out[k] = pick(r, WEIRD);
  }
  return out;
}

const PRODUCT_KEYS = ["nameAr", "priceMinor", "costMinor", "trackStock", "stockQuantity", "qty", "lowStockThreshold", "stockMoves", "updatedAt", "active"];
const ORDER_KEYS = ["customerId", "status", "items", "payments", "changes", "paymentStatus", "deliveryFeeMinor", "stockDeducted", "removedPaymentIds", "vatMinor", "vatIncluded", "updatedAt", "outForDeliveryAt", "notes"];
const LINE_KEYS = ["id", "productId", "quantity", "unitPriceMinor", "nameSnapshot"];

function randomOrder(r: () => number, productIds: string[]): J {
  const items: unknown[] = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const line: J = { id: crypto.randomUUID(), productId: pick(r, [...productIds, null]), nameSnapshot: "Item", quantity: 1 + Math.floor(r() * 4), unitPriceMinor: 1000, unitCostMinor: 400 };
    if (r() < 0.3) line[pick(r, LINE_KEYS)] = pick(r, WEIRD);
    return line;
  });
  const data: J = {
    customerId: "c1", status: pick(r, ["newOrder", "confirmed", "ready", "collected", "cancelled", "weird"]), fulfillmentType: "pickup", paymentStatus: "unpaid", deliveryFeeMinor: 0, items,
    payments: r() < 0.5 ? [{ id: crypto.randomUUID().toUpperCase(), amountMinor: 500, method: "cash", note: null, paidAt: "2026-10-03T08:00:00.000Z" }] : [], changes: [], updatedAt: "2026-10-03T08:00:00.000Z",
  };
  if (r() < 0.5) data.stockDeducted = pick(r, [{}, { [productIds[0]!]: 1 }, { [productIds[0]!]: 1000000 }, { nope: 2 }, { [productIds[0]!]: 1.5 }, "x", null]);
  if (r() < 0.3) data.removedPaymentIds = pick(r, [[], ["x"], [1], ["a".repeat(70)], null, "x", Array.from({ length: 600 }, (_, i) => `id${i}`)]);
  return r() < 0.8 ? mutate(r, data, ORDER_KEYS) : data;
}

describe("a bad record never fails the request: 300 seeded batches of mixed, malformed records answer 200", () => {
  // The owner and each staff mix push the same garbage; the shop holds real products and orders for the moves to name.
  for (const who of ["owner", "orders", "prepare", "money", "products", "orders+prepare+money+products"] as const) {
    it(`pushed by ${who}`, async () => {
      const r = rng(who.length * 7919 + 17);
      const flags = who === "owner" ? undefined : { orders: who.includes("orders"), prepare: who.includes("prepare"), money: who.includes("money"), products: who.includes("products") };
      const pusher = flags ? await fleet.addStaff(owner.session, who, flags) : owner;
      // Real records to name and to overwrite.
      const productIds = ["p1", "p2", "p3"];
      const seeded = await sync([
        ...productIds.map((id) => base("product", id, { nameAr: id, priceMinor: 1000, trackStock: true, stockQuantity: 10, lowStockThreshold: 1, stockMoves: [], createdAt: "2026-10-01T00:00:00.000Z" })),
        ...["o1", "o2", "o3", "o4"].map((id, i) => base("order", id, { customerId: "c1", status: i % 2 ? "confirmed" : "newOrder", fulfillmentType: "pickup", paymentStatus: "unpaid", deliveryFeeMinor: 0, items: [{ id: `i-${id}`, productId: "p1", nameSnapshot: "Item", quantity: 2, unitPriceMinor: 1000, unitCostMinor: 400 }], payments: [], changes: [], updatedAt: "2026-10-03T08:00:00.000Z" })),
      ]);
      expect(seeded.status).toBe(200);
      const orderIds = ["o1", "o2", "o3", "o4"];
      let cursor = 0;
      const failures: string[] = [];
      for (let round = 0; round < 50; round++) {
        const changes: J[] = [];
        for (let i = 0; i < 6; i++) {
          const roll = r();
          if (roll < 0.4) {
            const id = pick(r, productIds);
            const product: J = { nameAr: id, priceMinor: 1000, trackStock: true, stockQuantity: 10, lowStockThreshold: 1, stockMoves: Array.from({ length: Math.floor(r() * 4) }, () => moveLike(r, orderIds, id)), createdAt: "2026-10-01T00:00:00.000Z" };
            changes.push(base("product", id, r() < 0.7 ? mutate(r, product, PRODUCT_KEYS) : product, Math.floor(r() * 3)));
          } else if (roll < 0.85) {
            changes.push(base("order", pick(r, [...orderIds, "o5", "o6"]), randomOrder(r, productIds), Math.floor(r() * 3)));
          } else {
            changes.push({ ...base("customer", pick(r, ["c1", "c2"]), { name: "Cust", phone: "1" }), deleted: r() < 0.2 });
          }
        }
        const res = await sync(changes, cursor, pusher.session);
        if (res.status !== 200) {
          // Find the culprit: one change at a time on a copy of the situation is not possible after the fact, so keep the batch.
          failures.push(`round ${round}: status ${res.status} ${JSON.stringify(res.json).slice(0, 160)} <- ${JSON.stringify(changes).slice(0, 1500)}`);
          break;
        }
        cursor = res.json.cursor;
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});

describe("KNOWN GAP, hostile or broken clients only: a record the server throws on answers 500 every time (no released app can write one)", () => {
  // iOS 1.0 caps a quantity at 9999 (OrderLineMerge.maxQuantity), the web at 99, every id is a UUID. These two records are what a
  // hand-made or buggy client could send. The batch's other records are applied; the request answers 500 and the phone that sent it
  // sends the same batch again for ever (only its own sync is blocked: nobody else's pull or push goes through that record).
  const good = Array.from({ length: 199 }, (_, i) => base("customer", `cust-${i}`, { name: `C${i}`, phone: String(i) }));

  it("an order line of 3,000,000,000 units with a move that names it: orderat.sync_apply raises \"out of range for type integer\"", async () => {
    expect((await sync([base("product", "pp", { nameAr: "pp", trackStock: true, stockQuantity: 5, stockMoves: [] })])).status).toBe(200);
    const bad = [
      base("order", "huge", { customerId: "c", status: "confirmed", items: [{ id: "l", productId: "pp", quantity: 3_000_000_000, unitPriceMinor: 1 }], payments: [], changes: [], paymentStatus: "unpaid" }),
      base("product", "pp", { nameAr: "pp", trackStock: true, stockQuantity: 5 - 3_000_000_000, stockMoves: [{ id: crypto.randomUUID(), delta: -3_000_000_000, reason: "orderConfirmed", orderId: "huge", note: null, at: fleet.now() }] }),
    ];
    const res = await sync([...good.slice(0, 98), ...bad, ...good.slice(98)]);
    expect(res.status).toBe(500);
    expect(String(res.json.thrown)).toMatch(/out of range for type integer/);
    const stored = await fleet.stored();
    expect(good.filter((c) => stored.has(`customer/${c.id}`))).toHaveLength(199); // everything else of the batch is in
    expect((await sync([...bad])).status, "and it is the same on every retry").toBe(500);
  });

  it("a product whose id is \"__proto__\" (a valid record id) with an order line naming it and a ledger: a null product record, not-null violation", async () => {
    const bad = [
      base("product", "__proto__", { nameAr: "pp", trackStock: true, stockQuantity: 5, stockMoves: [] }),
      base("order", "protoorder", { customerId: "c", status: "confirmed", items: [{ id: "l", productId: "__proto__", quantity: 2, unitPriceMinor: 1 }], payments: [], changes: [], paymentStatus: "unpaid", stockDeducted: {} }),
    ];
    const res = await sync([...good.slice(0, 98), ...bad, ...good.slice(98)]);
    expect(res.status).toBe(500);
    expect(String(res.json.thrown)).toMatch(/not-null constraint/);
    expect((await sync([...bad])).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe("an exception inside the atomic function (a deadlock the database aborts one side of)", () => {
  it("the first attempt raises deadlock_detected: the sync answers 500, nothing is half written, and the same push a moment later goes through once", async () => {
    const phone = new SimPhone(fleet, owner.session, "ios1", "A");
    phone.createShop(fleet.shopId);
    const cust = phone.createCustomer("Sara", "1");
    const product = phone.createProduct({ name: "Cake", priceMinor: 1000, track: true, stock: 10 });
    phone.cloudOn = true;
    phone.attach();
    expect((await phone.sync()).ok).toBe(true);
    const order = phone.createOrder({ customerId: cust, lines: [{ productId: product, name: "Cake", qty: 4, priceMinor: 1000 }] });
    phone.setStatus(order, "confirmed");
    let raised = 0;
    const flaky: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        if (/orderat.sync_apply/.test(text) && raised < 1) {
          raised += 1;
          throw new Error("deadlock detected");
        }
        return sql.query<T>(text, params);
      },
    };
    const racing = new Fleet(sql, (await import("../handler.ts")).createSyncHandler({ sql: flaky, uploadPhoto: async () => true, getSignedPhotoUrl: async () => undefined, now: () => new Date(fleet.clock), log: () => {} }));
    racing.clock = fleet.clock;
    const first = await racing.call(owner.session, { action: "sync", shopId: fleet.shopId, cursor: phone.cursor, changes: phone.plan().flat() });
    expect(first.status).toBe(500);
    expect((await fleet.storedData("product", product)).stockQuantity, "the product write that raised changed nothing").toBe(10);
    const retry = await phone.sync();
    expect(retry.ok).toBe(true);
    expect(retry.rejected).toEqual([]);
    expect((await fleet.storedData("product", product)).stockQuantity).toBe(6);
    expect((await phone.sync()).pushed).toBe(0);
    expect((await fleet.storedData("product", product)).stockQuantity).toBe(6);
  });
});

describe("the atomic write returns no row again and again (a record that keeps changing)", () => {
  /** A client whose `sync_apply` calls always find the record changed: a competing write lands just before each one. */
  function alwaysLosing(table: { entity: string; id: string }): SqlClient {
    return {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        if (/orderat\.sync_apply/.test(text)) {
          await sql.query(`update orderat.records set seq = nextval(pg_get_serial_sequence('orderat.records', 'seq')) where shop_id = $1 and entity = $2 and id = $3`, [fleet.shopId, table.entity, table.id]);
        }
        return sql.query<T>(text, params);
      },
    };
  }

  it("5 attempts lose to other writers: the sync answers a non-200 with nothing half applied; the phone's retry (the writers are gone) goes through exactly once", async () => {
    const phone = new SimPhone(fleet, owner.session, "ios1", "A");
    phone.createShop(fleet.shopId);
    const cust = phone.createCustomer("Sara", "1");
    const product = phone.createProduct({ name: "Cake", priceMinor: 1000, track: true, stock: 10 });
    phone.cloudOn = true;
    phone.attach();
    expect((await phone.sync()).ok).toBe(true);
    const order = phone.createOrder({ customerId: cust, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
    phone.setStatus(order, "confirmed");
    const phoneRecords = phone.plan().flat();
    expect(phoneRecords.map((c) => c.entity)).toEqual(["order", "product"]); // iOS sorts "order:" before "product:"

    // The orders's atomic write (it carries stock bookkeeping through the product's move) is the one that keeps losing.
    const racingHandler = (await import("../handler.ts")).createSyncHandler({ sql: alwaysLosing({ entity: "product", id: product }), uploadPhoto: async () => true, getSignedPhotoUrl: async () => undefined, now: () => new Date(fleet.clock), log: () => {} });
    const racing = new Fleet(sql, racingHandler);
    racing.clock = fleet.clock;
    const lost = await racing.call(owner.session, { action: "sync", shopId: fleet.shopId, cursor: phone.cursor, changes: phoneRecords });
    expect(lost.status, "an exhausted retry is reported as a failure the phone retries, not as a success").toBe(500);
    // The first change (the order) was applied; the product was not (it never got its write through).
    const stored = await fleet.stored();
    expect((stored.get(`order/${order}`)!.data as J).status).toBe("confirmed");
    expect((stored.get(`product/${product}`)!.data as J).stockQuantity).toBe(10);

    // The phone kept everything dirty and sends it again, now that nobody races: both records go through, stock is taken once.
    const retry = await phone.sync();
    expect(retry.ok).toBe(true);
    expect(retry.rejected).toEqual([]);
    expect((await fleet.storedData("product", product)).stockQuantity).toBe(8);
    const again = await phone.sync();
    expect(again.pushed).toBe(0);
    expect((await fleet.storedData("product", product)).stockQuantity).toBe(8);
  });
});
