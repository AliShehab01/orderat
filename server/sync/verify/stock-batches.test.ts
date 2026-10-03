// Final verification: several stock moves for ONE order and product in ONE push (the released apps write no ledger, so the server
// judges each of their order-driven moves against the order). A phone that is offline for a while, or edits twice inside the
// 5-second sync debounce, pushes every move since its last sync together with the order's FINAL lines. The server must end with
// the net of those moves, not with only the ones that happen to be valid one at a time against the final lines.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet } from "./fleet.ts";
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

async function shopWith(kind: Kind, stock = 10): Promise<{ phone: SimPhone; customer: string; product: string }> {
  const phone = new SimPhone(fleet, owner.session, kind, kind);
  phone.createShop(fleet.shopId);
  const customer = phone.createCustomer("Sara", "1");
  const product = phone.createProduct({ name: "Cake", priceMinor: 1000, track: true, stock });
  await fleet.createShop(owner.session);
  phone.attach();
  expect((await phone.sync()).ok).toBe(true);
  return { phone, customer, product };
}

const released: Kind[] = ["ios1", "androidOld", "webOld"];

describe("several moves of one order in one push: the stock is the net of them (released apps, no ledger)", () => {
  for (const kind of released) {
    describe(kind, () => {
      it("create, confirm and edit down before the first sync (offline, or inside the debounce): the order holds its final units", async () => {
        const { phone, customer, product } = await shopWith(kind);
        phone.online = false;
        const o = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }] });
        phone.setStatus(o, "confirmed"); // -3
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 1, priceMinor: 1000 }]); // +2
        expect(phone.get("product", product).stockQuantity).toBe(9); // the phone's own books: 10 - 1
        phone.online = true;
        const r = await phone.sync();
        expect(r.ok).toBe(true);
        expect(r.rejected).toEqual([]);
        expect((await fleet.storedData("product", product)).stockQuantity, "the server's stock").toBe(9);
        expect(phone.get("product", product).stockQuantity, "what the phone shows after the sync").toBe(9);
      });

      it("a confirmed order edited up and then down in one push (2 -> 5 -> 3)", async () => {
        const { phone, customer, product } = await shopWith(kind);
        const o = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
        phone.setStatus(o, "confirmed");
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity).toBe(8);
        phone.online = false;
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 5, priceMinor: 1000 }]); // -3
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }]); // +2
        phone.online = true;
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity, "the order holds 3: 10 - 3").toBe(7);
        expect(phone.get("product", product).stockQuantity).toBe(7);
      });

      it("a confirmed order edited down and then up (3 -> 1 -> 2) and a confirm then a cancel in one push still work", async () => {
        const { phone, customer, product } = await shopWith(kind);
        const o = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }] });
        phone.setStatus(o, "confirmed");
        expect((await phone.sync()).ok).toBe(true);
        phone.online = false;
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 1, priceMinor: 1000 }]);
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }]);
        const o2 = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
        phone.setStatus(o2, "confirmed");
        phone.setStatus(o2, "cancelled");
        phone.online = true;
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity, "order 1 holds 2, order 2 nothing").toBe(8);
        expect(phone.get("product", product).stockQuantity).toBe(8);
      });

      it("confirm, edit down, cancel in one push gives everything back; an order with the product removed in the edit too", async () => {
        const { phone, customer, product } = await shopWith(kind);
        phone.online = false;
        const o = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }] });
        phone.setStatus(o, "confirmed");
        phone.editItems(o, [{ productId: product, name: "Cake", qty: 1, priceMinor: 1000 }]);
        phone.setStatus(o, "cancelled");
        const o2 = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
        phone.setStatus(o2, "confirmed");
        phone.editItems(o2, [{ productId: null, name: "Something else", qty: 1, priceMinor: 500 }]); // the product is gone from the order
        phone.online = true;
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity).toBe(10);
        expect(phone.get("product", product).stockQuantity).toBe(10);
      });

      it("the same in the middle of other work: a second order and a manual move in the same push", async () => {
        const { phone, customer, product } = await shopWith(kind, 20);
        phone.online = false;
        const a = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 4, priceMinor: 1000 }] });
        phone.setStatus(a, "confirmed"); // -4
        phone.adjustStockManually(product, 10, "received"); // +10
        phone.editItems(a, [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }]); // +2
        const b = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }] });
        phone.setStatus(b, "confirmed"); // -3
        phone.online = true;
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity, "20 + 10 - 2 - 3").toBe(25);
        expect(phone.get("product", product).stockQuantity).toBe(25);
        // A later cancel of each gives back exactly what the order holds.
        phone.setStatus(a, "cancelled");
        phone.setStatus(b, "cancelled");
        expect((await phone.sync()).ok).toBe(true);
        expect((await fleet.storedData("product", product)).stockQuantity).toBe(30);
      });
    });
  }
});

describe("staff phones (iOS 1.0) doing the same in one push", () => {
  for (const flags of [{ orders: true, prepare: false, money: false, products: false }, { orders: true, prepare: true, money: true, products: true }]) {
    it(`staff with ${Object.entries(flags).filter(([, on]) => on).map(([k]) => k).join("+")}: create, confirm, edit down and cancel another, all before the first sync, take exactly what the orders hold`, async () => {
      const { phone: A, customer, product } = await shopWith("ios1", 20);
      const staff = await fleet.addStaff(owner.session, "orders-staff", flags);
      const S = new SimPhone(fleet, staff.session, "ios1", "S");
      S.cloudOn = true;
      expect((await S.sync()).ok).toBe(true);
      S.online = false;
      const a = S.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 4, priceMinor: 1000 }] });
      S.setStatus(a, "confirmed"); // -4
      S.editItems(a, [{ productId: product, name: "Cake", qty: 1, priceMinor: 1000 }]); // +3
      const b = S.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
      S.setStatus(b, "confirmed"); // -2
      S.setStatus(b, "cancelled"); // +2
      S.online = true;
      const r = await S.sync();
      expect(r.ok).toBe(true);
      expect(r.rejected, "staff who may handle orders are never refused for this").toEqual([]);
      expect((await fleet.storedData("product", product)).stockQuantity, "20 - 1").toBe(19);
      expect(S.get("product", product).stockQuantity).toBe(19);
      expect((await A.sync()).ok).toBe(true);
      expect(A.get("product", product).stockQuantity).toBe(19);
    });
  }
});

describe("a forged or inflated move is still refused (F2 stays closed)", () => {
  it("a prepare-only member cannot take stock out of, or put it into, a product with moves whose NET is more than the order holds", async () => {
    const { phone, customer, product } = await shopWith("ios1");
    const o = phone.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 2, priceMinor: 1000 }] });
    expect((await phone.sync()).ok).toBe(true);
    const staff = await fleet.addStaff(owner.session, "prep", { orders: false, prepare: true, money: false, products: false });
    const S = new SimPhone(fleet, staff.session, "ios1", "S");
    S.cloudOn = true;
    expect((await S.sync()).ok).toBe(true);
    // Two moves whose net is far more than the order's 2 units, in either direction, and a pair that nets to a valid 2.
    const forged = (deltas: number[]) => {
      const moves = deltas.map((delta, i) => ({ id: crypto.randomUUID().toUpperCase(), delta, reason: delta < 0 ? "orderConfirmed" : "orderCancelled", orderId: o, note: null, at: `2026-10-03T08:0${i}:00.000Z` })).reverse();
      return fleet.call(staff.session, { action: "sync", shopId: fleet.shopId, cursor: S.cursor, changes: [{ entity: "product", id: product, baseSeq: 0, deleted: false, data: { ...S.get("product", product), stockMoves: moves } }] });
    };
    expect((await forged([-1000, -1000])).status).toBe(200);
    expect((await fleet.storedData("product", product)).stockQuantity, "an inflated pair changes nothing").toBe(10);
    expect((await forged([1000, 1000])).status).toBe(200);
    expect((await fleet.storedData("product", product)).stockQuantity, "a wrong-direction pair changes nothing").toBe(10);
    expect((await forged([-1000, 1000])).status).toBe(200);
    expect((await fleet.storedData("product", product)).stockQuantity, "a pair that nets to zero changes nothing").toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// One phone, random operations, random sync points: the batches the server sees are whatever the user did between two syncs. The
// server's stock must be what the phone's own books say (nobody else writes), for every kind of client.

describe("one phone, random operations, random sync points: the server's stock is the phone's, always", () => {
  const ALL: Kind[] = ["ios1", "androidOld", "webOld", "iosNew", "androidNew", "webNew"];
  const DEDUCTED = new Set(["confirmed", "ready", "collected"]);
  const NEXT: Record<string, string[]> = { newOrder: ["confirmed", "cancelled"], confirmed: ["ready", "cancelled", "newOrder"], ready: ["collected", "cancelled", "confirmed"], collected: ["cancelled", "ready"], cancelled: ["newOrder", "confirmed"] };

  for (const kind of ALL) {
    for (let seed = 1; seed <= 25; seed++) {
      it(`${kind}, seed ${seed}: 40 operations, a sync after about one in three`, async () => {
        const { phone, customer } = await shopWith(kind, 1000);
        const products = [phone.all("product")[0]!.id];
        for (const name of ["B", "C"]) products.push(phone.createProduct({ name, priceMinor: 500, track: true, stock: 1000 }));
        expect((await phone.sync()).ok).toBe(true);
        let s = (seed * 7919 + kind.length) >>> 0;
        const rand = () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s / 4294967296;
        };
        const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
        const orders = new Map<string, { status: string; lines: { productId: string; qty: number }[]; paid: Set<string> }>();
        const manual = new Map<string, number>();
        const opening = 1000;
        const log: string[] = [];
        for (let step = 0; step < 40; step++) {
          const roll = rand();
          if (roll < 0.2 || orders.size === 0) {
            const lines = [{ productId: pick(products), qty: 1 + Math.floor(rand() * 4) }];
            if (rand() < 0.4) lines.push({ productId: pick(products), qty: 1 + Math.floor(rand() * 3) });
            const id = phone.createOrder({ customerId: customer, lines: lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 500 })) });
            orders.set(id, { status: "newOrder", lines, paid: new Set() });
            log.push(`create ${id.slice(0, 4)} ${JSON.stringify(lines.map((l) => `${products.indexOf(l.productId)}x${l.qty}`))}`);
          } else {
            const id = pick([...orders.keys()]);
            const o = orders.get(id)!;
            if (roll < 0.55) {
              const to = pick(NEXT[o.status]!);
              phone.setStatus(id, to);
              log.push(`${id.slice(0, 4)} ${o.status} -> ${to}`);
              o.status = to;
            } else if (roll < 0.8) {
              const lines = [{ productId: pick(products), qty: 1 + Math.floor(rand() * 5) }];
              if (rand() < 0.3) lines.push({ productId: pick(products), qty: 1 + Math.floor(rand() * 3) });
              phone.editItems(id, lines.map((l) => ({ productId: l.productId, name: "Item", qty: l.qty, priceMinor: 500 })));
              log.push(`edit ${id.slice(0, 4)} (${o.status}) -> ${JSON.stringify(lines.map((l) => `${products.indexOf(l.productId)}x${l.qty}`))}`);
              o.lines = lines;
            } else if (roll < 0.9) {
              const pay = phone.recordPayment(id, 100 * (1 + Math.floor(rand() * 5)));
              o.paid.add(pay.toLowerCase());
              log.push(`pay ${id.slice(0, 4)}`);
            } else if (roll < 0.95) {
              const p = pick(products);
              phone.adjustStockManually(p, 7, "received");
              manual.set(p, (manual.get(p) ?? 0) + 7);
              log.push(`manual +7 on ${products.indexOf(p)}`);
            } else {
              phone.editProduct(pick(products), { priceMinor: 400 + Math.floor(rand() * 200) });
              log.push("edit a product");
            }
          }
          if (rand() < 0.33) {
            const r = await phone.sync();
            expect(r.ok, `sync at step ${step}`).toBe(true);
            expect(r.rejected).toEqual([]);
            log.push("-- sync");
          }
        }
        for (let i = 0; i < 2; i++) expect((await phone.sync()).ok).toBe(true);
        const server = await fleet.stored();
        for (const p of products) {
          let held = 0;
          for (const o of orders.values()) if (DEDUCTED.has(o.status)) for (const l of o.lines) if (l.productId === p) held += l.qty;
          const want = opening + (manual.get(p) ?? 0) - held;
          const where = `\n${log.join("\n")}`;
          expect((server.get(`product/${p}`)!.data as Record<string, unknown>).stockQuantity, `server stock of product #${products.indexOf(p)}${where}`).toBe(want);
          expect(phone.get("product", p).stockQuantity, `the phone's stock of product #${products.indexOf(p)}${where}`).toBe(want);
        }
        for (const [id, o] of orders) {
          const rec = server.get(`order/${id}`)!.data as { status: string; payments: { id: string }[] };
          expect(rec.status).toBe(o.status);
          expect(rec.payments.map((x) => x.id.toLowerCase()).sort()).toEqual([...o.paid].sort());
        }
        const idle = await phone.sync();
        expect([idle.pushed, idle.pulled]).toEqual([0, 0]);
      });
    }
  }
});
