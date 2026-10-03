// Final verification, task 4: pull paging and cursors with the re-seq step (an order a batch wrote is written again after the
// products of its lines) and the server's own stock effects (a product's seq drawn before its order's).
//
//  - Page size 500 (the real one): a shop of more than 1,300 records is restored by a second phone page by page (`more` true, true,
//    false) while the first phone keeps writing between the pages.
//  - Page sizes 1, 2 and 3 (forced through the store's `pullRecords` limit: the same query, a smaller LIMIT): observers page through
//    a shop that other devices (iOS 1.0, the new iOS, the new Android, the web) keep changing between every two pages. After every
//    page, for every record whose current seq is at or below the observer's cursor, the observer holds exactly the current version
//    (no record is ever skipped), the cursor never moves back, and a pull that applies in seq order like an installed Android
//    (an order whose customer is missing is dropped for good, a line whose product is missing is unlinked for good) never drops
//    or unlinks anything.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet, type J } from "./fleet.ts";
import { SimPhone, type Kind } from "./phone.ts";
import { seedLocalShop } from "./seed.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const forced = vi.hoisted(() => ({ limit: undefined as number | undefined }));
vi.mock("../store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store.ts")>();
  return { ...actual, pullRecords: (sql: SqlClient, shopId: string, cursor: number, limit: number) => actual.pullRecords(sql, shopId, cursor, forced.limit ?? limit) };
});

let sql: SqlClient;
let fleet: Fleet;
let owner: { userId: string; session: string };

beforeEach(async () => {
  forced.limit = undefined;
  sql = await createCloudTestSql();
  fleet = new Fleet(sql);
  owner = await fleet.newUser("owner");
});

const clean = (label: string, r: { ok: boolean; failedStatus?: number; rejected: J[] }) => {
  expect(r.ok, `${label}: failed ${r.failedStatus}`).toBe(true);
  expect(r.rejected, `${label}: rejected`).toEqual([]);
};

/** Every record whose current seq is at or below the phone's cursor is held by it in exactly its current version. */
async function expectNothingSkipped(label: string, phone: SimPhone): Promise<void> {
  const server = await fleet.stored();
  for (const [key, rec] of server) {
    if (rec.seq > phone.cursor) continue;
    const local = phone.records.get(`${rec.entity}:${rec.id}`);
    if (rec.deleted) {
      expect(local, `${label}: ${phone.label} still holds the deleted ${key}`).toBeUndefined();
      continue;
    }
    expect(local, `${label}: ${phone.label} (cursor ${phone.cursor}) lacks ${key} (seq ${rec.seq})`).toBeDefined();
    expect(local!.data, `${label}: ${phone.label} holds an older version of ${key} (seq ${rec.seq}, cursor ${phone.cursor})`).toEqual(rec.data);
  }
}

describe("paging with the real page size (500)", () => {
  it("a second phone restores a shop of 1,300+ records page by page (more: true, true, false) while the first phone keeps writing between the pages", async () => {
    const A = new SimPhone(fleet, owner.session, "ios1", "A");
    const shop = seedLocalShop(A);
    // Enough orders to cross two page boundaries.
    const line = (p: string) => [{ productId: p, name: "Item", qty: 1, priceMinor: 1000 }];
    for (let i = 0; i < 1200; i++) A.createOrder({ customerId: shop.customers[i % 12]!, lines: line(shop.products.cookie) });
    await fleet.createShop(owner.session);
    A.attach();
    const total = A.records.size;
    expect(total).toBeGreaterThan(1250);
    clean("upload", await A.sync());
    expect((await fleet.stored()).size).toBe(total);

    const B = new SimPhone(fleet, owner.session, "ios1", "B");
    B.cloudOn = true;
    const flags: boolean[] = [];
    let pages = 0;
    for (;;) {
      const { report, body } = await B.pullOnePage();
      clean("page", report);
      pages += 1;
      flags.push(body!.more);
      // The owner keeps working between two pages: an old order (already delivered to B or not yet), a new one, a confirm with stock.
      if (pages === 1) A.setStatus(Object.values(shop.orders)[3]!, "cancelled");
      if (pages === 2) {
        const o = A.createOrder({ customerId: shop.customers[0]!, lines: line(shop.products.cake) });
        A.setStatus(o, "confirmed");
        A.editProduct(shop.products.tart, { priceMinor: 4200 });
      }
      if (pages <= 2) clean("A writes between pages", await A.sync());
      await expectNothingSkipped(`page ${pages}`, B);
      if (!body!.more) break;
      expect(pages).toBeLessThan(10);
    }
    expect(flags.slice(0, 2)).toEqual([true, true]);
    expect(flags.at(-1)).toBe(false);
    // One more round brings what was written after the last page was cut; then B holds exactly the server.
    clean("last round", await B.sync());
    for (const [key, rec] of await fleet.stored()) expect(B.records.get(`${rec.entity}:${rec.id}`)?.data, key).toEqual(rec.deleted ? undefined : rec.data);
    expect(B.cursor).toBe((await fleet.counts()).maxSeq);
  });
});

describe("paging with page sizes 1, 2 and 3, while other devices keep changing the shop", () => {
  const WRITERS: Kind[] = ["ios1", "iosNew", "androidNew", "webOld", "webNew", "androidOld"];

  for (const limit of [1, 2, 3]) {
    it(`page size ${limit}: observers (iOS 1.0, a strict installed Android, the web) page between 60 random writes of six kinds of phone: nothing skipped, cursors monotonic, nothing dropped or unlinked`, async () => {
      // A small shop on the server, built by the new iOS (customers and products synced before any order uses them).
      const seeder = new SimPhone(fleet, owner.session, "iosNew", "seeder");
      seeder.createShop(fleet.shopId);
      const customers = Array.from({ length: 4 }, (_, i) => seeder.createCustomer(`C${i}`, String(i)));
      const products = Array.from({ length: 3 }, (_, i) => seeder.createProduct({ name: `P${i}`, priceMinor: 1000 + i, costMinor: 300, track: true, stock: 50, low: 2 }));
      await fleet.createShop(owner.session);
      seeder.attach();
      clean("seed", await seeder.sync());

      const writers = WRITERS.map((kind) => {
        const w = new SimPhone(fleet, owner.session, kind, kind);
        w.cloudOn = true;
        return w;
      });
      for (const w of writers) clean(`restore ${w.label}`, await w.sync());
      const observers = (["androidOld", "ios1", "webOld"] as Kind[]).map((kind) => {
        const o = new SimPhone(fleet, owner.session, kind, `observer-${kind}`);
        o.cloudOn = true;
        return o;
      });
      for (const o of observers) clean(`restore ${o.label}`, await o.sync()); // installed apps that already hold the shop
      forced.limit = limit; // from here on every pull page holds at most `limit` records

      const rand = (() => {
        let s = 12345 + limit;
        return () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s / 4294967296;
        };
      })();
      const pickOf = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
      const orderIds: string[] = [];
      const cursors = new Map(observers.map((o) => [o.label, o.cursor]));

      for (let step = 0; step < 60; step++) {
        const w = pickOf(writers);
        // A writer pulls first (its sync is a full round: it pages through everything with the forced size), so its copies are current.
        clean(`${w.label} syncs`, await w.sync());
        const known = [...w.records.values()].filter((r) => r.entity === "order").map((r) => r.id);
        const roll = rand();
        if (roll < 0.25 || known.length === 0) {
          const id = w.createOrder({ customerId: pickOf(customers), lines: [{ productId: pickOf(products), name: "Item", qty: 1 + Math.floor(rand() * 3), priceMinor: 1000 }, { productId: pickOf(products), name: "Item", qty: 1, priceMinor: 1000 }] });
          orderIds.push(id);
        } else {
          const id = pickOf(known);
          const order = w.get("order", id);
          // A released phone does not move an order that carries a ledger (a documented limit of the stock books, not what is tested here).
          const released = w.profile.ledger === false;
          const ledgerBacked = order.stockDeducted !== undefined;
          if (roll < 0.6 && !(released && ledgerBacked)) {
            const next = ({ newOrder: "confirmed", confirmed: "ready", ready: "collected", collected: "cancelled", cancelled: "newOrder" } as Record<string, string>)[order.status]!;
            w.setStatus(id, next);
          } else if (roll < 0.75 && !(released && ledgerBacked)) {
            w.editItems(id, [{ productId: pickOf(products), name: "Item", qty: 1 + Math.floor(rand() * 4), priceMinor: 1000 }]);
          } else if (roll < 0.9) {
            w.recordPayment(id, 100 * (1 + Math.floor(rand() * 5)));
          } else if (roll < 0.95) {
            w.adjustStockManually(pickOf(products), 5, "received");
          } else {
            w.editProduct(pickOf(products), { priceMinor: 900 + Math.floor(rand() * 200) });
          }
        }
        clean(`${w.label} pushes`, await w.sync());

        // One observer takes one page now.
        const o = pickOf(observers);
        const before = cursors.get(o.label)!;
        const { report, body } = await o.pullOnePage();
        clean(`${o.label} page`, report);
        expect(body!.cursor, `${o.label}: the cursor moved back`).toBeGreaterThanOrEqual(before);
        expect(body!.changes.length, "a page holds at most the forced size").toBeLessThanOrEqual(limit);
        cursors.set(o.label, body!.cursor);
        await expectNothingSkipped(`step ${step} (${w.label}, observer ${o.label})`, o);
      }

      // Drain: every observer pages until nothing moves any more; then it holds exactly the server.
      for (const o of observers) {
        for (let i = 0; i < 2000; i++) {
          const before = o.cursor;
          const { report } = await o.pullOnePage();
          clean(`${o.label} drain`, report);
          if (o.cursor === before) break;
        }
        await expectNothingSkipped(`drained ${o.label}`, o);
        expect(o.cursor).toBe((await fleet.counts()).maxSeq);
        const server = await fleet.stored();
        for (const [key, rec] of server) expect(o.records.get(`${rec.entity}:${rec.id}`)?.data, `${o.label}: ${key}`).toEqual(rec.deleted ? undefined : rec.data);
      }
      // What an installed Android would have lost for good, had it paged like this: nothing.
      const strict = observers[0]!;
      expect(strict.droppedByPull, "orders dropped for a missing customer").toEqual([]);
      expect(strict.nulledLinks, "order lines unlinked from a product that arrived later").toEqual([]);
    }, 240_000);
  }
});

describe("the order of a pull: products before the order that names them, in one page or across pages", () => {
  /** After a confirm batch by `kind`, a strict phone that paged through the log one record at a time never met the order before a product it names. */
  for (const kind of ["ios1", "iosNew", "androidNew", "androidOld", "webOld", "webNew"] as Kind[]) {
    it(`a confirm pushed by ${kind} (an order and the product it moved, one batch) reaches a page-size-1 pull product first`, async () => {
      const seeder = new SimPhone(fleet, owner.session, "iosNew", "seeder");
      seeder.createShop(fleet.shopId);
      const customer = seeder.createCustomer("C", "1");
      const product = seeder.createProduct({ name: "P", priceMinor: 1000, track: true, stock: 20 });
      await fleet.createShop(owner.session);
      seeder.attach();
      clean("seed", await seeder.sync());
      const w = new SimPhone(fleet, owner.session, kind, kind);
      w.cloudOn = true;
      clean("restore", await w.sync());
      const order = w.createOrder({ customerId: customer, lines: [{ productId: product, name: "P", qty: 3, priceMinor: 1000 }] });
      clean("new order", await w.sync());
      const strict = new SimPhone(fleet, owner.session, "androidOld", "strict"); // an installed app that already holds the shop
      strict.cloudOn = true;
      clean("strict joins", await strict.sync());
      w.setStatus(order, "confirmed");
      clean("confirm", await w.sync());
      forced.limit = 1; // from here the strict phone pulls one record at a time
      const seen: string[] = [];
      for (let i = 0; i < 20; i++) {
        const before = strict.cursor;
        const { report } = await strict.pullOnePage();
        seen.push(...report.pulledKeys.map((k) => k.split("@")[0]!));
        if (strict.cursor === before) break;
      }
      const productAt = seen.indexOf(`product/${product}`), orderAt = seen.lastIndexOf(`order/${order}`);
      expect(productAt, `the product is delivered (${seen.join(", ")})`).toBeGreaterThanOrEqual(0);
      expect(orderAt, "the order is delivered").toBeGreaterThanOrEqual(0);
      expect(productAt, `the product (${productAt}) comes before the order's last version (${orderAt}): ${seen.join(", ")}`).toBeLessThan(orderAt);
      await expectNothingSkipped("after the confirm", strict);
    });
  }

  it("KNOWN LIMIT (documented, fourth review R1: only the Android fix covers it): a FRESH join of an installed Android app meets an older order before a product edited after it", async () => {
    const A = new SimPhone(fleet, owner.session, "ios1", "A");
    const shop = seedLocalShop(A);
    await fleet.createShop(owner.session);
    A.attach();
    clean("upload", await A.sync());
    // The product is edited after its orders were written: its one record now has a higher seq than every older order that names it.
    A.editProduct(shop.products.cake, { priceMinor: 6600 });
    clean("edit", await A.sync());
    const strict = new SimPhone(fleet, owner.session, "androidOld", "strict");
    strict.cloudOn = true;
    clean("a fresh join of an installed Android app", await strict.sync());
    expect(strict.nulledLinks.length, "the old orders of the edited product are met before it: unlinked on an installed Android (fixed in the new Android)").toBeGreaterThan(0);
    expect(strict.nulledLinks.every((l) => l.endsWith(shop.products.cake))).toBe(true); // only that product
    expect(strict.droppedByPull).toEqual([]); // customers are never edited after their orders here
  });
});
