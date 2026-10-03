// Final verification: the new apps against each other with REAL concurrency: any phone, any order, any time, offline stretches, stale
// copies, orders that two phones change at once (last writer wins). Here the oracle cannot be what the users meant (the order
// record is last-writer-wins), so it is what the server's own final records say, and what must hold is that nothing else disagrees
// with them:
//   - the stock of every tracked product = what it started with + the manual moves - the ledgers of the orders that hold stock;
//   - the server's allocation rows (order_stock) are the ledgers;
//   - every ledger fits its order's lines, and a status that holds no stock holds none;
//   - payments are add-only: what every phone recorded minus what any phone deleted, whatever the interleaving (money is never lost to
//     a stale copy, a deletion is never undone by one);
//   - every phone ends holding what the server holds.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet, type J } from "./fleet.ts";
import { SimPhone, type Kind } from "./phone.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let sql: SqlClient;
let fleet: Fleet;
let owner: { userId: string; session: string };

beforeEach(async () => {
  sql = await createCloudTestSql();
  fleet = new Fleet(sql);
  owner = await fleet.newUser("owner");
});

const DEDUCTED = new Set(["confirmed", "ready", "collected"]);
const NEXT: Record<string, string[]> = { newOrder: ["confirmed", "cancelled"], confirmed: ["ready", "cancelled", "newOrder"], ready: ["collected", "cancelled", "confirmed"], collected: ["cancelled", "ready"], cancelled: ["newOrder", "confirmed"] };
const NEW: Kind[] = ["iosNew", "androidNew", "webNew", "iosNew", "androidNew"];

async function setUp(kinds: Kind[]): Promise<{ phones: SimPhone[]; products: string[]; customers: string[] }> {
  const seeder = new SimPhone(fleet, owner.session, "iosNew", "seeder");
  seeder.createShop(fleet.shopId);
  const customers = Array.from({ length: 3 }, (_, i) => seeder.createCustomer(`C${i}`, String(i)));
  const products = Array.from({ length: 8 }, (_, i) => seeder.createProduct({ name: `P${i}`, priceMinor: 1000 + 100 * i, costMinor: 300, track: true, stock: 100, low: 2 }));
  await fleet.createShop(owner.session);
  seeder.attach();
  expect((await seeder.sync()).ok).toBe(true);
  const phones = kinds.map((kind, i) => {
    const phone = new SimPhone(fleet, owner.session, kind, `${kind}#${i}`);
    phone.cloudOn = true;
    return phone;
  });
  for (const phone of phones) expect((await phone.sync()).ok, `${phone.label} restores`).toBe(true);
  return { phones, products, customers };
}

async function concurrentWalk(seed: number, steps: number): Promise<void> {
  const { phones, products: tracked, customers } = await setUp(NEW);
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pickOf = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const manual = new Map<string, number>();
  const recorded = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  const trace: string[] = [];
  const setOf = (m: Map<string, Set<string>>, id: string): Set<string> => m.get(id) ?? m.set(id, new Set()).get(id)!;

  for (let step = 0; step < steps; step++) {
    const p = pickOf(phones);
    if (!p.online) {
      if (rand() < 0.3) {
        p.online = true;
        trace.push(`${step}: ${p.label} back online`);
        expect((await p.sync()).ok).toBe(true);
      }
    } else if (rand() < 0.1) {
      p.online = false;
      trace.push(`${step}: ${p.label} goes offline`);
    }
    const known = [...p.records.values()].filter((r) => r.entity === "order").map((r) => r.id);
    const roll = rand();
    if (roll < 0.2 || known.length === 0) {
      const lines = [{ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 3) }];
      if (rand() < 0.5) lines.push({ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 2) });
      const id = p.createOrder({ customerId: pickOf(customers), lines: lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 1000 })) });
      setOf(recorded, id);
      setOf(removed, id);
      trace.push(`${step}: ${p.label} creates ${id.slice(0, 4)}`);
    } else {
      const id = pickOf(known);
      const order = p.get("order", id);
      if (roll < 0.5) {
        const to = pickOf(NEXT[order.status as string]!);
        trace.push(`${step}: ${p.label} ${id.slice(0, 4)} ${order.status} -> ${to}`);
        p.setStatus(id, to);
      } else if (roll < 0.65) {
        const lines = [{ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 4) }];
        if (rand() < 0.4) lines.push({ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 3) });
        p.editItems(id, lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 1000 })));
        trace.push(`${step}: ${p.label} edits ${id.slice(0, 4)}`);
      } else if (roll < 0.8) {
        const pay = p.recordPayment(id, 100 * (1 + Math.floor(rand() * 8)));
        setOf(recorded, id).add(pay.toLowerCase());
        trace.push(`${step}: ${p.label} pays ${id.slice(0, 4)}`);
      } else if (roll < 0.9) {
        const live = order.payments as J[];
        if (live.length > 0) {
          const victim = pickOf(live);
          p.removePayment(id, victim.id);
          setOf(removed, id).add((victim.id as string).toLowerCase());
          trace.push(`${step}: ${p.label} deletes a payment of ${id.slice(0, 4)}`);
        }
      } else if (roll < 0.97) {
        const productId = pickOf(tracked);
        const delta = pickOf([5, 10, -2, -3]);
        p.adjustStockManually(productId, delta, delta > 0 ? "received" : "damaged");
        manual.set(productId, (manual.get(productId) ?? 0) + delta);
        trace.push(`${step}: ${p.label} stock ${delta}`);
      } else {
        p.editProduct(pickOf(tracked), { priceMinor: 900 + Math.floor(rand() * 300) });
      }
    }
    if (p.online && rand() < 0.6) expect((await p.sync()).ok, `${p.label} syncs`).toBe(true);
  }

  for (const p of phones) p.online = true;
  for (let round = 0; round < 4; round++) for (const p of phones) expect((await p.sync()).ok).toBe(true);
  const server = await fleet.stored();
  const where = `\nseed ${seed}\n${trace.slice(-80).join("\n")}`;
  const rows = await sql.query<{ order_id: string; product_id: string; units: number }>(`select order_id, product_id, units from orderat.order_stock where shop_id = $1`, [fleet.shopId]);
  for (const productId of tracked) {
    let held = 0;
    for (const rec of server.values()) {
      if (rec.entity !== "order" || rec.deleted || !DEDUCTED.has(rec.data.status)) continue;
      const ledger = rec.data.stockDeducted as Record<string, number> | undefined;
      expect(ledger, `a stock-holding order made by the new apps carries a ledger: ${rec.id}${where}`).toBeDefined();
      held += ledger![productId] ?? 0;
    }
    expect((server.get(`product/${productId}`)!.data as J).stockQuantity, `stock of ${productId}${where}`).toBe(100 + (manual.get(productId) ?? 0) - held);
  }
  for (const rec of server.values()) {
    if (rec.entity !== "order") continue;
    const ledger = (rec.data.stockDeducted ?? {}) as Record<string, number>;
    const lines = new Map<string, number>();
    for (const l of rec.data.items as J[]) if (l.productId) lines.set(l.productId, (lines.get(l.productId) ?? 0) + l.quantity);
    for (const [pid, units] of Object.entries(ledger)) expect(units <= (lines.get(pid) ?? -1), `ledger of ${rec.id} fits its lines${where}`).toBe(true);
    if (!DEDUCTED.has(rec.data.status)) expect(Object.keys(ledger), `a status that holds no stock holds none: ${rec.id}${where}`).toEqual([]);
    for (const row of rows.filter((r) => r.order_id === rec.id)) expect(Number(row.units), `allocation of ${rec.id}/${row.product_id}${where}`).toBe(ledger[row.product_id] ?? 0);
  }
  for (const [orderId, ids] of recorded) {
    const rec = server.get(`order/${orderId}`);
    expect(rec, `order ${orderId} reached the server${where}`).toBeDefined();
    const want = [...ids].filter((id) => !setOf(removed, orderId).has(id)).sort();
    const got = (rec!.data.payments as J[]).map((x) => (x.id as string).toLowerCase()).sort();
    expect(got, `payments of ${orderId}${where}`).toEqual(want);
  }
  for (const p of phones) {
    expect(p.dirty.size, `${p.label} has nothing left to push${where}`).toBe(0);
    expect(p.allRejected).toEqual([]);
    for (const [key, data] of p.snapshot()) expect(data, `${p.label}'s ${key}${where}`).toEqual(server.get(key)!.data);
  }
}

describe("the new apps against each other with real concurrency: the server's books agree with its own orders", () => {
  for (const seed of [101, 102, 103, 104, 105, 106]) {
    it(`seed ${seed}: 80 random steps by five phones, offline stretches, stale copies, orders changed by two phones at once`, async () => {
      await concurrentWalk(seed, 80);
    }, 240_000);
  }

  // A longer soak, off by default: VERIFY_SEEDS=60 npx vitest run server/sync/verify/concurrent-new-apps.test.ts
  for (let i = 0; i < Number(process.env.VERIFY_SEEDS ?? 0); i++) {
    it(`soak ${i}`, async () => {
      await concurrentWalk(4000 + i, 100);
    }, 600_000);
  }
});
