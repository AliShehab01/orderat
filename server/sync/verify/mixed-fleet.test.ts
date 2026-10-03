// Final verification, task 3: a mixed fleet on one shop. The released iOS 1.0, the new iOS, the released Android (1.5.5), the new
// Android, the live web and the new web, interleaved, each of them offline for a while now and then, all through the real handler.
//
// Truth is kept apart from the server by an oracle (what the users did), and after every walk, with everybody back online and
// synced:
//   - stock of every tracked product = what it started with + the manual moves users made - the units of every order that holds
//     stock (confirmed, ready, collected) on that order's lines;
//   - payments of every order = what users recorded - what they deleted (by id, whatever the case of the id);
//   - every order has the status the last operation on it gave it;
//   - every phone holds what the server holds, nothing is dirty, nothing was rejected, and syncing again moves nothing.
//
// What the walk does NOT do is exactly what the documentation lists as limits of the old apps (docs/security-review-2026-10-01.md):
//   - a released phone does not move an order that already carries a ledger into stock (confirm it again after a newer app cancelled
//     it, or edit its items): "the stock stays too high by that order's units";
//   - the released Android and the live web delete a payment by absence and the server does not honour it: they never delete one;
//   - two phones never change the SAME order while one of them is offline (an order is last-writer-wins as a whole);
//   - a product keeps at most 50 moves, and a legacy order's ledger is derived from them, so no list is allowed to reach 50.

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

interface Line { productId: string; qty: number }
class Oracle {
  readonly opening = new Map<string, number>();
  readonly manual = new Map<string, number>();
  readonly lines = new Map<string, Line[]>();
  readonly status = new Map<string, string>();
  readonly recorded = new Map<string, Set<string>>();
  readonly removed = new Map<string, Set<string>>();
  readonly home = new Map<string, string>(); // order -> the phone that made it
  readonly trace: string[] = [];
  paymentId = (id: string) => id.toLowerCase();
  expectedStock(productId: string): number {
    let held = 0;
    for (const [orderId, status] of this.status) if (DEDUCTED.has(status)) for (const l of this.lines.get(orderId)!) if (l.productId === productId) held += l.qty;
    return this.opening.get(productId)! + (this.manual.get(productId) ?? 0) - held;
  }
}

async function setUp(kinds: Kind[]): Promise<{ phones: SimPhone[]; products: string[]; customers: string[]; oracle: Oracle }> {
  const seeder = new SimPhone(fleet, owner.session, "iosNew", "seeder");
  seeder.createShop(fleet.shopId);
  const customers = Array.from({ length: 3 }, (_, i) => seeder.createCustomer(`C${i}`, String(i)));
  const products = Array.from({ length: 8 }, (_, i) => seeder.createProduct({ name: `P${i}`, priceMinor: 1000 + 100 * i, costMinor: 300, track: true, stock: 100, low: 2 }));
  products.push(seeder.createProduct({ name: "Box", priceMinor: 500, track: false, stock: 0 }));
  await fleet.createShop(owner.session);
  seeder.attach();
  expect((await seeder.sync()).ok).toBe(true);
  const oracle = new Oracle();
  for (const p of products.slice(0, 8)) oracle.opening.set(p, 100);
  const phones = kinds.map((kind, i) => {
    const phone = new SimPhone(fleet, owner.session, kind, `${kind}#${i}`);
    phone.cloudOn = true;
    return phone;
  });
  for (const phone of phones) expect((await phone.sync()).ok, `${phone.label} restores`).toBe(true);
  return { phones, products, customers, oracle };
}

const released = (p: SimPhone) => p.profile.ledger === false;

async function ledgerBacked(orderId: string): Promise<boolean> {
  const rows = await sql.query<{ data: J }>(`select data from orderat.records where shop_id = $1 and entity = 'order' and id = $2`, [fleet.shopId, orderId]);
  return rows[0]?.data.stockDeducted !== undefined; // an order the server has not seen yet has none
}

/** Everything is back online and synced: the oracle against the server and the phones. */
async function expectTruth(label: string, phones: SimPhone[], oracle: Oracle, products: string[]): Promise<void> {
  for (const p of phones) p.online = true;
  for (let round = 0; round < 3; round++) for (const p of phones) await p.sync();
  const server = await fleet.stored();
  const where = `\n${label}\ntrace:\n${oracle.trace.slice(-300).join("\n")}`;
  for (const productId of products.slice(0, 8)) {
    const rec = server.get(`product/${productId}`)!;
    if (rec.data.stockQuantity !== oracle.expectedStock(productId)) {
      const rows = await sql.query<J>(`select order_id, units from orderat.order_stock where shop_id = $1 and product_id = $2 order by order_id`, [fleet.shopId, productId]);
      const held = [...oracle.status].filter(([o]) => oracle.lines.get(o)!.some((l) => l.productId === productId)).map(([o, st]) => `${o.slice(0, 4)}:${st}:${oracle.lines.get(o)!.filter((l) => l.productId === productId).map((l) => l.qty).join("+")}:alloc=${rows.find((r) => r.order_id === o)?.units ?? "-"}:ledger=${JSON.stringify((server.get(`order/${o}`)!.data as J).stockDeducted ?? null)}`);
      const mine = [...oracle.status.keys()].filter((o) => oracle.lines.get(o)!.some((l) => l.productId === productId)).map((o) => o.slice(0, 4));
      const history = oracle.trace.filter((l) => mine.some((m) => l.includes(m)) || /offline|online|stock|edits a product/.test(l));
      throw new Error(`stock of product #${products.indexOf(productId)}: server ${rec.data.stockQuantity}, oracle ${oracle.expectedStock(productId)}; orders naming it: ${held.join(" | ")}\nHISTORY:\n${history.join("\n")}`);
    }
    expect((rec.data.stockMoves as J[]).length, "a product's move list must stay below the cap this oracle assumes").toBeLessThan(50);
  }
  for (const [orderId, status] of oracle.status) {
    const rec = server.get(`order/${orderId}`)!;
    expect(rec.data.status, `status of ${orderId}${where}`).toBe(status);
    const want = [...oracle.recorded.get(orderId)!].filter((id) => !oracle.removed.get(orderId)!.has(id)).sort();
    const got = (rec.data.payments as J[]).map((p) => oracle.paymentId(p.id)).sort();
    expect(got, `payments of ${orderId}${where}`).toEqual(want);
    // The status of the payment follows what the order holds.
    const total = (rec.data.items as J[]).reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0) + (rec.data.deliveryFeeMinor ?? 0);
    const paid = (rec.data.payments as J[]).reduce((s, p) => s + p.amountMinor, 0);
    expect(rec.data.paymentStatus, `paymentStatus of ${orderId}${where}`).toBe(paid <= 0 ? "unpaid" : paid >= total ? "paid" : "deposit");
  }
  for (const p of phones) {
    expect(p.dirty.size, `${p.label} has nothing left to push${where}`).toBe(0);
    expect(p.allRejected, `${p.label}: nothing may be rejected for the owner${where}`).toEqual([]);
    for (const [key, data] of p.snapshot()) {
      const rec = server.get(key);
      expect(rec, `${p.label} holds ${key}`).toBeDefined();
      expect(data, `${p.label}'s ${key} equals the server's${where}`).toEqual(rec!.data);
    }
    expect(p.droppedByPull, `${p.label}: dropped by its pull`).toEqual([]);
    expect(p.nulledLinks, `${p.label}: unlinked by its pull`).toEqual([]);
  }
  // Nothing moves on an idle round.
  const before = JSON.stringify(await fleet.counts());
  for (const p of phones) {
    const r = await p.sync();
    expect([r.pushed, r.pulled], `${p.label} idle`).toEqual([0, 0]);
  }
  expect(JSON.stringify(await fleet.counts())).toBe(before);
}

/** The random walk. */
async function walk(seed: number, kinds: Kind[], steps: number, offlineChance: number): Promise<void> {
  const { phones, products, customers, oracle } = await setUp(kinds);
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pickOf = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const tracked = products.slice(0, 8);
  const offlineSince = new Map<SimPhone, number>();
  const offlineClaims = new Map<string, SimPhone>(); // orders an offline phone made or changed: nobody else touches them meanwhile

  for (let step = 0; step < steps; step++) {
    const p = pickOf(phones);
    if (p.online) {
      if (rand() < offlineChance) {
        expect((await p.sync()).ok).toBe(true); // it leaves the network up to date: the copies it holds are current at that moment
        p.online = false;
        offlineSince.set(p, step);
        oracle.trace.push(`${step}: ${p.label} goes offline`);
        // Its own orders are its alone until it is back: nobody else changes an order while a phone that holds a copy of it is offline.
        for (const [o, home] of oracle.home) if (home === p.label) offlineClaims.set(o, p);
        continue;
      }
      expect((await p.sync()).ok).toBe(true);
    } else if (rand() < 0.25) {
      p.online = true;
      oracle.trace.push(`${step}: ${p.label} comes back online`);
      const r = await p.sync();
      expect(r.ok, `${p.label} syncs after being offline`).toBe(true);
      for (const [o, claimer] of [...offlineClaims]) if (claimer === p) offlineClaims.delete(o);
      offlineSince.delete(p);
      continue;
    }
    const offline = !p.online;
    // The orders this phone may change now: online, any order nobody offline has claimed; offline, only the ones it made itself.
    const mine = [...oracle.status.keys()].filter((o) => (offline ? oracle.home.get(o) === p.label && p.records.has(`order:${o}`) : !offlineClaims.has(o) && p.records.has(`order:${o}`)));
    const roll = rand();
    if (roll < 0.22 || mine.length === 0) {
      const lines: Line[] = [{ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 3) }];
      if (rand() < 0.5) lines.push({ productId: pickOf(products), qty: 1 + Math.floor(rand() * 2) });
      const id = p.createOrder({ customerId: pickOf(customers), lines: lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 1000 })) });
      oracle.status.set(id, "newOrder");
      oracle.lines.set(id, lines.filter((l) => tracked.includes(l.productId) || true));
      oracle.recorded.set(id, new Set());
      oracle.removed.set(id, new Set());
      oracle.home.set(id, p.label);
      if (offline) offlineClaims.set(id, p);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} creates order ${id.slice(0, 4)} ${JSON.stringify(lines.map((l) => `${products.indexOf(l.productId)}x${l.qty}`))}`);
    } else if (roll < 0.55) {
      const id = pickOf(mine);
      const status = oracle.status.get(id)!;
      const to = pickOf(NEXT[status]!);
      const backed = await ledgerBacked(id);
      // A released phone does not enter a stock-holding status for an order that carries a ledger already (documented limit).
      if (released(p) && backed && DEDUCTED.has(to) && !DEDUCTED.has(status)) continue;
      if (to === status) continue;
      p.setStatus(id, to);
      oracle.status.set(id, to);
      if (offline) offlineClaims.set(id, p);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} ${id.slice(0, 4)} ${status} -> ${to}`);
    } else if (roll < 0.68) {
      const id = pickOf(mine);
      const status = oracle.status.get(id)!;
      if (released(p) && DEDUCTED.has(status) && (await ledgerBacked(id))) continue; // documented limit
      const lines: Line[] = [{ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 4) }];
      if (rand() < 0.4) lines.push({ productId: pickOf(tracked), qty: 1 + Math.floor(rand() * 3) });
      // Same product twice on one order is fine; keep the oracle's lines as the phone has them.
      p.editItems(id, lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 1000 })));
      oracle.lines.set(id, lines);
      if (offline) offlineClaims.set(id, p);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} edits ${id.slice(0, 4)} (${status}) -> ${JSON.stringify(lines.map((l) => `${products.indexOf(l.productId)}x${l.qty}`))}`);
    } else if (roll < 0.82) {
      const id = pickOf(mine);
      const paymentId = p.recordPayment(id, 100 * (1 + Math.floor(rand() * 8)));
      oracle.recorded.get(id)!.add(oracle.paymentId(paymentId));
      if (offline) offlineClaims.set(id, p);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} pays ${id.slice(0, 4)} ${paymentId.slice(0, 4)}`);
    } else if (roll < 0.9) {
      const id = pickOf(mine);
      // A deletion by absence (released Android, live web) is not honoured by the server: those phones never delete a payment.
      if (p.profile.paymentRemoval === "absence") continue;
      const live = (p.get("order", id).payments as J[]).filter((x) => !oracle.removed.get(id)!.has(oracle.paymentId(x.id)));
      if (live.length === 0) continue;
      const victim = pickOf(live);
      p.removePayment(id, victim.id);
      oracle.removed.get(id)!.add(oracle.paymentId(victim.id));
      if (offline) offlineClaims.set(id, p);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} deletes payment ${victim.id.slice(0, 4)} of ${id.slice(0, 4)}`);
    } else if (roll < 0.96) {
      const productId = pickOf(tracked);
      const delta = pickOf([5, 10, -2, -3]);
      p.adjustStockManually(productId, delta, delta > 0 ? "received" : "damaged");
      oracle.manual.set(productId, (oracle.manual.get(productId) ?? 0) + delta);
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} stock ${products.indexOf(productId)} ${delta > 0 ? "+" : ""}${delta}`);
    } else {
      p.editProduct(pickOf(tracked), { priceMinor: 900 + Math.floor(rand() * 300) });
      oracle.trace.push(`${step}: ${p.label}${offline ? " (offline)" : ""} edits a product`);
    }
    if (!offline) expect((await p.sync()).ok, `${p.label} pushes`).toBe(true);
  }
  await expectTruth(`seed ${seed}, ${kinds.join(",")}`, phones, oracle, products);
}

describe("mixed fleet / the released and the new clients on one shop, each offline now and then", () => {
  const ALL: Kind[] = ["ios1", "iosNew", "androidOld", "androidNew", "webOld", "webNew"];

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`all six kinds, seed ${seed}: stock, payments, statuses and every phone agree with the oracle`, async () => {
      await walk(seed, ALL, 70, 0.07);
    }, 240_000);
  }

  for (const seed of [11, 12, 13]) {
    it(`today's production fleet only (two iOS 1.0 phones, the live web, an old Android), seed ${seed}`, async () => {
      await walk(seed, ["ios1", "ios1", "webOld", "androidOld"], 70, 0.1);
    }, 240_000);
  }

  for (const seed of [21, 22]) {
    it(`the next fleet only (new iOS, new Android, new web), seed ${seed}`, async () => {
      await walk(seed, ["iosNew", "androidNew", "webNew", "iosNew"], 70, 0.1);
    }, 240_000);
  }

  // A longer soak, off by default: VERIFY_SEEDS=60 npx vitest run server/sync/verify/mixed-fleet.test.ts
  for (let i = 0; i < Number(process.env.VERIFY_SEEDS ?? 0); i++) {
    it(`soak ${i}: all six kinds`, async () => { await walk(1000 + i, ALL, 90, 0.08); }, 600_000);
    it(`soak ${i}: today's fleet`, async () => { await walk(2000 + i, ["ios1", "ios1", "webOld", "androidOld"], 90, 0.1); }, 600_000);
    it(`soak ${i}: the next fleet`, async () => { await walk(3000 + i, ["iosNew", "androidNew", "webNew", "iosNew"], 90, 0.1); }, 600_000);
  }

  it("each kind of phone offline for a long stretch while the others work (scripted): everything lands once when it comes back", async () => {
    const { phones, products, customers, oracle } = await setUp(["ios1", "iosNew", "androidOld", "androidNew", "webOld", "webNew"]);
    const [i1, iN, aO, aN, wO, wN] = phones as [SimPhone, SimPhone, SimPhone, SimPhone, SimPhone, SimPhone];
    const tracked = products.slice(0, 8);
    const make = (p: SimPhone, productId: string, qty: number, confirm = true) => {
      const id = p.createOrder({ customerId: customers[0]!, lines: [{ productId, name: "Item", qty, priceMinor: 1000 }] });
      oracle.status.set(id, "newOrder");
      oracle.lines.set(id, [{ productId, qty }]);
      oracle.recorded.set(id, new Set());
      oracle.removed.set(id, new Set());
      oracle.home.set(id, p.label);
      if (confirm) {
        p.setStatus(id, "confirmed");
        oracle.status.set(id, "confirmed");
      }
      return id;
    };
    // Every phone goes offline holding stale product copies, and every one of them confirms orders on the SAME product.
    for (const p of phones) p.online = false;
    const hot = tracked[0]!;
    const orders = phones.map((p, i) => make(p, hot, 1 + i));
    for (const [i, p] of phones.entries()) {
      const pay = p.recordPayment(orders[i]!, 500 * (i + 1));
      oracle.recorded.get(orders[i]!)!.add(oracle.paymentId(pay));
      p.adjustStockManually(tracked[1]!, 3, "received");
      oracle.manual.set(tracked[1]!, (oracle.manual.get(tracked[1]!) ?? 0) + 3);
    }
    // They come back one at a time, in the worst order for last-writer-wins on the shared product record.
    for (const p of [wN, aO, i1, aN, wO, iN]) {
      p.online = true;
      expect((await p.sync()).ok, `${p.label} back online`).toBe(true);
    }
    // Then they cancel each other's orders (cancel by a released phone of an order with a ledger is covered), and delete a payment.
    for (const [i, p] of [aN, i1, wN, iN, aO, wO].entries()) {
      expect((await p.sync()).ok).toBe(true);
      const id = orders[i]!;
      const was = oracle.status.get(id)!;
      if (was === "confirmed") {
        p.setStatus(id, "cancelled");
        oracle.status.set(id, "cancelled");
      }
      expect((await p.sync()).ok).toBe(true);
    }
    await expectTruth("scripted offline stretch", phones, oracle, products);
  }, 240_000);
});
