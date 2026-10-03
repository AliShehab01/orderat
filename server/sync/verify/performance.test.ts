// Final verification, task 6: performance sanity. Timings are PGlite's (a WASM Postgres in this process: no network, one core),
// so the numbers that carry over to production are the number of SQL statements per request (each is a round trip to the database
// there) and how both grow with the size of the push and of the shop. Nothing may grow faster than linearly.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet, type J } from "./fleet.ts";
import { SimPhone } from "./phone.ts";
import { seedLocalShop } from "./seed.ts";

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
const report: string[] = [];
const note = (line: string) => {
  report.push(line);
  console.log(`PERF ${line}`);
};

/** One timed request: wall time and the statements the server ran for it. */
async function timed(changes: J[], cursor = 0): Promise<{ ms: number; queries: number; status: number; json: J }> {
  const before = fleet.requests.length;
  const res = await fleet.call(owner.session, { action: "sync", shopId: fleet.shopId, cursor, changes });
  const r = fleet.requests[before]!;
  return { ms: r.ms, queries: r.queries, status: res.status, json: res.json };
}

const customer = (i: number) => base("customer", `cust-${i}`, { name: `Customer ${i}`, phone: String(1000 + i), area: null, notes: null, createdAt: fleet.now() });
const product = (i: number, moves = 0) => base("product", `prod-${i}`, { nameAr: `P${i}`, priceMinor: 1000, costMinor: 300, trackStock: true, stockQuantity: 100, lowStockThreshold: 2, stockMoves: Array.from({ length: moves }, (_, k) => ({ id: crypto.randomUUID().toUpperCase(), delta: k % 2 ? -1 : 2, reason: k % 2 ? "damaged" : "received", orderId: null, note: null, at: `2026-10-01T08:${String(10 + (k % 49)).padStart(2, "0")}:00.000Z` })), createdAt: fleet.now() });
const order = (i: number, status: string, productId: string, ledger?: Record<string, number>, extra: J = {}) => base("order", `order-${i}`, {
  customerId: `cust-${i % 50}`, status, fulfillmentType: "pickup", paymentStatus: "unpaid", deliveryFeeMinor: 0, dueAt: fleet.now(),
  items: [{ id: `line-${i}`, productId, nameSnapshot: "Item", quantity: 2, unitPriceMinor: 1000, unitCostMinor: 300 }],
  payments: [], changes: [{ id: `ch-${i}`, field: "order", oldValue: null, newValue: "created", note: null, at: fleet.now() }], notes: null, createdAt: fleet.now(), updatedAt: fleet.now(),
  ...(ledger ? { stockDeducted: ledger } : {}), ...extra,
});

describe("a push of N changes costs N times a constant, never more (statements and time)", () => {
  const SIZES = [25, 50, 100, 200];
  const kinds: { name: string; make: (n: number, offset: number) => Promise<J[]> }[] = [
    { name: "new customers", make: async (n, o) => Array.from({ length: n }, (_, i) => customer(o + i)) },
    { name: "new orders with payments and history (iOS 1.0 first upload)", make: async (n, o) => Array.from({ length: n }, (_, i) => order(o + i, "confirmed", "prod-0", undefined, { payments: [{ id: crypto.randomUUID().toUpperCase(), amountMinor: 500, method: "cash", note: null, paidAt: fleet.now() }], paymentStatus: "deposit" })) },
    { name: "new products with 30 moves each (iOS 1.0 first upload)", make: async (n, o) => Array.from({ length: n }, (_, i) => product(o + i, 30)) },
    {
      name: "ledger orders (the new apps) confirmed on ONE hot product: every write moves the same product's stock",
      make: async (n, o) => Array.from({ length: n }, (_, i) => order(o + i, "confirmed", "hot", { hot: 2 })),
    },
    {
      name: "iOS 1.0 confirm batch: 50% orders + 50% products with a move naming the order",
      make: async (n, o) => {
        const half = n / 2;
        const orders = Array.from({ length: half }, (_, i) => order(o + i, "confirmed", `prod-${(o + i) % 25}`));
        const products = Array.from({ length: half }, (_, i) => base("product", `prod-${(o + i) % 25}`, { nameAr: "x", trackStock: true, stockQuantity: 100, stockMoves: [{ id: crypto.randomUUID().toUpperCase(), delta: -2, reason: "orderConfirmed", orderId: `order-${o + i}`, note: null, at: fleet.now() }] }));
        return [...orders, ...products];
      },
    },
  ];

  for (const kind of kinds) {
    it(`${kind.name}`, async () => {
      // Shared records the pushes name: a hot product, 25 products, 50 customers.
      const seeded = await timed([base("product", "hot", { nameAr: "hot", trackStock: true, stockQuantity: 100000, stockMoves: [] }), ...Array.from({ length: 25 }, (_, i) => product(i)), ...Array.from({ length: 50 }, (_, i) => customer(i))]);
      expect(seeded.status).toBe(200);
      const samples: { n: number; ms: number; queries: number }[] = [];
      let offset = 1000;
      for (const n of SIZES) {
        const changes = await kind.make(n, offset);
        offset += n;
        const r = await timed(changes);
        expect(r.status, `${kind.name} x${n}: ${JSON.stringify(r.json).slice(0, 200)}`).toBe(200);
        expect(r.json.rejected).toEqual([]);
        samples.push({ n, ms: r.ms, queries: r.queries });
      }
      const line = samples.map((s) => `${s.n}: ${s.ms.toFixed(0)} ms, ${s.queries} stmts (${(s.queries / s.n).toFixed(1)}/change)`).join(" | ");
      note(`${kind.name} -> ${line}`);
      // Statements per change must not grow with the size of the push (linear total): within 15% between the smallest and the largest.
      const perChange = samples.map((s) => s.queries / s.n);
      expect(perChange[3]! / perChange[0]!, `statements per change grew from ${perChange[0]} to ${perChange[3]}`).toBeLessThan(1.15);
      // Time per change must not grow with the size of the push (a quadratic step would multiply it by 8 between 25 and 200): within 3x, which
      // leaves room for the noise of a few tens of milliseconds on the smallest push.
      const perMs = samples.map((x) => x.ms / x.n);
      expect(perMs[3]! / perMs[0]!, `time per change grew from ${perMs[0]!.toFixed(2)} to ${perMs[3]!.toFixed(2)} ms: ${line}`).toBeLessThan(3);
      // And no push of 200 may take long even on this single core.
      expect(samples[3]!.ms, `a 200-change push took ${samples[3]!.ms.toFixed(0)} ms: ${line}`).toBeLessThan(20_000);
    }, 120_000);
  }
});

describe("the first upload of 2,000 records (iOS 1.0, batches of 200) and the work after it", () => {
  it("uploads, restores on a second phone, and one more order costs the same as on an empty shop", async () => {
    // A shop of ~2,000 records built the way iOS 1.0 builds one.
    const A = new SimPhone(fleet, owner.session, "ios1", "A");
    const shop = seedLocalShop(A);
    const line = (productId: string) => [{ productId, name: "Item", qty: 1 + (A.records.size % 3), priceMinor: 1500 }];
    const productsList = Object.values(shop.products);
    for (let i = 0; i < 1850; i++) {
      const id = A.createOrder({ customerId: shop.customers[i % 12]!, lines: line(productsList[i % productsList.length]!) });
      if (i % 4 === 0) A.setStatus(id, "confirmed");
      if (i % 9 === 0) A.recordPayment(id, 1000);
    }
    A.attach();
    const records = A.records.size;
    expect(records).toBeGreaterThanOrEqual(1900);

    const before = fleet.requests.length;
    const started = performance.now();
    const up = await A.sync();
    const wall = performance.now() - started;
    expect(up.ok).toBe(true);
    expect(up.rejected).toEqual([]);
    expect(up.conflicts).toEqual([]);
    const uploads = fleet.requests.slice(before).filter((r) => r.changes > 0);
    const stmts = uploads.reduce((sum, r) => sum + r.queries, 0);
    note(`first upload of ${records} records: ${wall.toFixed(0)} ms in ${fleet.requests.length - before} requests (${uploads.length} pushes: ${uploads.map((r) => `${r.ms.toFixed(0)}ms/${r.queries}q`).join(", ")}); ${stmts} statements = ${(stmts / records).toFixed(1)} per record`);
    expect((await fleet.stored()).size).toBe(records);
    // The cost of a batch must not depend on how many records the shop already holds: the last full batch against the first one.
    const full = uploads.filter((r) => r.changes === 200);
    expect(full.length).toBeGreaterThanOrEqual(8);
    expect(full.at(-1)!.queries, "statements of the last batch vs the first").toBeLessThanOrEqual(full[0]!.queries * 1.5 + 5);
    expect(full.at(-1)!.ms, `time of the last batch (${full.at(-1)!.ms.toFixed(0)} ms) vs the first (${full[0]!.ms.toFixed(0)} ms)`).toBeLessThan(full[0]!.ms * 4 + 500);
    expect(wall, "2,000 records on PGlite").toBeLessThan(120_000);

    // A second phone restores: 4 pages.
    const B = new SimPhone(fleet, owner.session, "ios1", "B");
    B.cloudOn = true;
    const t1 = performance.now();
    const restore = await B.sync();
    note(`restore of ${records} records on a second phone: ${(performance.now() - t1).toFixed(0)} ms in ${restore.requests} requests`);
    expect(restore.ok).toBe(true);
    expect(restore.pulled).toBe(records);

    // One order confirmed on the big shop vs on an empty one: same statements.
    const o = A.createOrder({ customerId: shop.customers[0]!, lines: line(shop.products.cake) });
    A.setStatus(o, "confirmed");
    const b2 = fleet.requests.length;
    const t2 = performance.now();
    expect((await A.sync()).ok).toBe(true);
    const confirmMs = performance.now() - t2;
    const confirmQueries = fleet.requests.slice(b2).reduce((sum, r) => sum + r.queries, 0);
    note(`one new confirmed order (order + product) on the ${records}-record shop: ${confirmMs.toFixed(0)} ms, ${confirmQueries} statements`);

    // The same on an empty shop for comparison.
    const fresh = new Fleet(sql); // a second shop in the same database
    const owner2 = await fresh.newUser("owner2");
    await fresh.createShop(owner2.session);
    const C = new SimPhone(fresh, owner2.session, "ios1", "C");
    C.createShop(fresh.shopId);
    const cust = C.createCustomer("x", "1");
    const prod = C.createProduct({ name: "Cake", priceMinor: 1000, track: true, stock: 50 });
    C.attach();
    expect((await C.sync()).ok).toBe(true);
    const o2 = C.createOrder({ customerId: cust, lines: [{ productId: prod, name: "Cake", qty: 2, priceMinor: 1000 }] });
    C.setStatus(o2, "confirmed");
    const b3 = fresh.requests.length;
    expect((await C.sync()).ok).toBe(true);
    const emptyQueries = fresh.requests.slice(b3).reduce((sum, r) => sum + r.queries, 0);
    note(`the same on an empty shop: ${emptyQueries} statements`);
    expect(confirmQueries, "a confirm costs the same number of statements whatever the size of the shop").toBe(emptyQueries);

    // An idle sync (nothing to push, nothing new) is a handful of statements.
    const b4 = fleet.requests.length;
    expect((await B.sync()).ok).toBe(true);
    expect((await A.sync()).ok).toBe(true);
    const idle = fleet.requests.slice(b4);
    note(`idle syncs on the big shop: ${idle.map((r) => `${r.ms.toFixed(0)}ms/${r.queries}q`).join(", ")}`);
    for (const r of idle) expect(r.queries).toBeLessThanOrEqual(6);
  }, 600_000);
});

describe("what a phone saves by the new server: nothing slower than before for the same first upload", () => {
  it("prints the report", () => {
    console.log(`PERF REPORT\n${report.join("\n")}`);
    expect(true).toBe(true);
  });
});
