// Final verification, task 1: the released iOS 1.0 against the new server, through the real HTTP handler on a real (WASM)
// Postgres. The phone (phone.ts, kind "ios1") builds the exact wire shapes of iOS 1.0 (Store.swift / CloudRecordMapping.swift /
// SyncEngine.swift at 54abcd9): first upload of a whole shop (sorted dirty keys, batches of 200), then a day of use: new order,
// confirm (its product push carries an order-driven move), ready, collect, cancel, uncancel, edit items, record and delete a
// payment, edit a product, a staff member with each permission mix. After every step a second iOS 1.0 phone pulls and must hold
// what the first one holds; nothing is rejected, nothing conflicts where nobody wrote concurrently, and syncing twice more with
// no change moves nothing (no push, no pull, no new row, no new seq).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createCloudTestSql } from "../../cloud-pglite-test-support.ts";
import { Fleet, type J } from "./fleet.ts";
import { SimPhone, type RoundReport } from "./phone.ts";
import { seedLocalShop, type SeededShop } from "./seed.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let sql: SqlClient;
let fleet: Fleet;
let owner: { userId: string; session: string };
let A: SimPhone; // the owner's iOS 1.0 phone that uploads the shop
let B: SimPhone; // the owner's second iOS 1.0 phone (restores the shop)
let shop: SeededShop;
/** The opening stock of the tracked products and every manual move made since (the oracle for "stock = opening - what open orders hold"). */
let manual: Record<string, number>;
const OPENING: Record<string, number> = {};

const DEDUCTED = new Set(["confirmed", "ready", "collected"]);

const expectClean = (label: string, r: RoundReport) => {
  expect(r.ok, `${label}: round failed with ${r.failedStatus}`).toBe(true);
  expect(r.rejected, `${label}: rejected`).toEqual([]);
  expect(r.conflicts, `${label}: conflicts`).toEqual([]);
};

/** Stock the server must hold for a tracked product: opening + manual moves - the units of every order that holds stock. */
async function expectedStock(productId: string): Promise<number> {
  let held = 0;
  for (const rec of (await fleet.stored()).values()) {
    if (rec.entity !== "order" || rec.deleted || !DEDUCTED.has(rec.data.status)) continue;
    for (const item of rec.data.items as J[]) if (item.productId === productId) held += item.quantity;
  }
  return OPENING[productId]! + (manual[productId] ?? 0) - held;
}

async function expectStockMatches(label: string): Promise<void> {
  const server = await fleet.stored();
  for (const productId of [shop.products.cake, shop.products.cookie, shop.products.tart, shop.products.busy]) {
    const want = await expectedStock(productId);
    expect(server.get(`product/${productId}`)!.data.stockQuantity, `${label}: server stock of ${productId}`).toBe(want);
    expect(A.get("product", productId).stockQuantity, `${label}: phone A stock of ${productId}`).toBe(want);
    expect(B.get("product", productId).stockQuantity, `${label}: phone B stock of ${productId}`).toBe(want);
  }
  // Untracked products never move.
  for (const productId of [shop.products.box, shop.products.free]) {
    expect(server.get(`product/${productId}`)!.data.stockQuantity).toBe(0);
  }
}

/** Every record the phone holds equals the server's copy of it (the phone is up to date and clean). */
async function expectPhoneEqualsServer(label: string, phone: SimPhone): Promise<void> {
  const server = await fleet.stored();
  expect(phone.dirty.size, `${label}: ${phone.label} still has dirty records ${[...phone.dirty].join(",")}`).toBe(0);
  for (const [key, data] of phone.snapshot()) {
    const rec = server.get(key);
    expect(rec, `${label}: ${phone.label} holds ${key}, the server has none`).toBeDefined();
    expect(rec!.deleted, `${label}: ${key} is a tombstone on the server`).toBe(false);
    expect(data, `${label}: ${phone.label}'s ${key} differs from the server's`).toEqual(rec!.data);
  }
}

/** After a step: both phones sync (A pushes), then both hold the same, equal to the server; nothing rejected or conflicting. */
async function settle(label: string, opts: { allowConflicts?: boolean } = {}): Promise<void> {
  const a = await A.sync();
  if (!opts.allowConflicts) expectClean(`${label} / A`, a);
  const b = await B.sync();
  if (!opts.allowConflicts) expectClean(`${label} / B`, b);
  // A pulls what B did not change either: one more round each so both are at the end of the log.
  const a2 = await A.sync();
  expectClean(`${label} / A again`, a2);
  await expectPhoneEqualsServer(label, A);
  await expectPhoneEqualsServer(label, B);
  expect(B.view(), `${label}: what the second phone pulled`).toEqual(A.view());
  await expectStockMatches(label);
}

/** Syncing again with nothing changed: no push, nothing pulled, no row and no seq added, nothing rewritten. */
async function expectIdle(label: string): Promise<void> {
  const before = await fleet.counts();
  const storedBefore = JSON.stringify([...(await fleet.stored())].map(([k, r]) => [k, r.seq]));
  for (let i = 0; i < 2; i++) {
    for (const phone of [A, B]) {
      const r = await phone.sync();
      expectClean(`${label} / idle ${phone.label} ${i}`, r);
      expect(r.pushed, `${label}: ${phone.label} pushed on an idle sync`).toBe(0);
      expect(r.pulled, `${label}: ${phone.label} pulled on an idle sync: ${r.pulledKeys.join(", ")}`).toBe(0);
    }
  }
  expect(await fleet.counts(), `${label}: the server grew on idle syncs`).toEqual(before);
  expect(JSON.stringify([...(await fleet.stored())].map(([k, r]) => [k, r.seq])), `${label}: seqs moved on idle syncs`).toBe(storedBefore);
}

beforeEach(async () => {
  sql = await createCloudTestSql();
  fleet = new Fleet(sql);
  owner = await fleet.newUser("owner");
  A = new SimPhone(fleet, owner.session, "ios1", "A");
  B = new SimPhone(fleet, owner.session, "ios1", "B");
  shop = seedLocalShop(A);
  for (const id of [shop.products.cake, shop.products.cookie, shop.products.tart, shop.products.busy]) OPENING[id] = 0;
  // The opening quantity of each tracked product is the quantity the oracle starts from: stock now + what its open orders hold.
  manual = {};
  for (const id of [shop.products.cake, shop.products.cookie, shop.products.tart, shop.products.busy]) {
    let held = 0;
    for (const o of A.all("order")) if (DEDUCTED.has(o.data.status)) for (const item of o.data.items as J[]) if (item.productId === id) held += item.quantity;
    OPENING[id] = A.get("product", id).stockQuantity + held;
  }
  await fleet.createShop(owner.session);
  A.attach();
});

describe("iOS 1.0 / the first upload of a whole shop", () => {
  it("uploads shop, settings, products with stock, customers and orders with payments and history in batches of 200 without a rejection or a conflict", async () => {
    const records = A.records.size;
    expect(records).toBeGreaterThan(50);
    const first = await A.sync();
    expectClean("first upload", first);
    expect(first.pushed).toBe(records);
    expect(first.requests).toBeGreaterThanOrEqual(Math.ceil(records / 200));
    // The server holds exactly what the phone built, record for record.
    await expectPhoneEqualsServer("first upload", A);
    expect((await fleet.stored()).size).toBe(records);
    expect(A.failures).toEqual([]);
  });

  it("a second phone that restores the shop pulls exactly what the first holds, and further syncs of both change nothing", async () => {
    expectClean("upload", await A.sync());
    B.cloudOn = true;
    const restored = await B.sync();
    expectClean("restore", restored);
    expect(restored.pulled).toBe(A.records.size);
    expect(B.snapshot()).toEqual(A.snapshot());
    expect(B.view()).toEqual(A.view());
    await expectStockMatches("restore");
    await expectIdle("after the restore");
  });
});

describe("iOS 1.0 / a day of use, two phones, nothing lost between them", () => {
  beforeEach(async () => {
    expectClean("upload", await A.sync());
    B.cloudOn = true;
    expectClean("restore", await B.sync());
  });

  it("new order, confirm (stock out), ready, collect: each step reaches the other phone, stock is opening minus what open orders hold", async () => {
    const o = A.createOrder({ customerId: shop.customers[0]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 4, priceMinor: 6500 }, { productId: shop.products.cookie, name: "Cookies box", qty: 2, priceMinor: 2500 }] });
    await settle("new order");
    expect(B.get("order", o).status).toBe("newOrder");
    A.setStatus(o, "confirmed");
    await settle("confirm");
    expect(B.get("order", o).status).toBe("confirmed");
    A.setStatus(o, "ready");
    await settle("ready");
    A.setStatus(o, "collected");
    await settle("collect");
    expect(B.get("order", o).status).toBe("collected");
    await expectIdle("after collect");
    // The legacy order has no ledger, and the server accounted for what it took (order_stock) without writing one into the order.
    expect((await fleet.storedData("order", o)).stockDeducted).toBeUndefined();
  });

  it("cancel gives the stock back exactly once; un-cancel (back to new) and confirm again takes it again", async () => {
    const o = A.createOrder({ customerId: shop.customers[1]!, lines: [{ productId: shop.products.tart, name: "Lemon tart", qty: 3, priceMinor: 4000 }] });
    A.setStatus(o, "confirmed");
    await settle("confirm");
    A.setStatus(o, "cancelled");
    await settle("cancel");
    A.setStatus(o, "newOrder");
    await settle("back to new");
    A.setStatus(o, "confirmed");
    await settle("confirm again");
    A.setStatus(o, "cancelled");
    await settle("cancel again");
    await expectIdle("after cancel");
  });

  it("an order the phone cancelled in the seed (confirmed then cancelled before the upload) can be confirmed and cancelled again", async () => {
    const o = shop.orders.cancelled!;
    A.setStatus(o, "confirmed");
    await settle("re-confirm a cancelled seed order");
    A.setStatus(o, "cancelled");
    await settle("cancel it again");
  });

  it("edit items of a confirmed order: quantity up, down, a line added, a line removed; stock follows each edit", async () => {
    const o = A.createOrder({ customerId: shop.customers[2]!, lines: [{ productId: shop.products.cookie, name: "Cookies box", qty: 3, priceMinor: 2500 }, { productId: shop.products.cake, name: "Chocolate cake", qty: 1, priceMinor: 6500 }] });
    A.setStatus(o, "confirmed");
    await settle("confirm");
    A.editItems(o, [{ productId: shop.products.cookie, name: "Cookies box", qty: 6, priceMinor: 2500 }, { productId: shop.products.cake, name: "Chocolate cake", qty: 1, priceMinor: 6500 }]);
    await settle("quantity up");
    A.editItems(o, [{ productId: shop.products.cookie, name: "Cookies box", qty: 2, priceMinor: 2500 }, { productId: shop.products.cake, name: "Chocolate cake", qty: 1, priceMinor: 6500 }]);
    await settle("quantity down");
    A.editItems(o, [{ productId: shop.products.cookie, name: "Cookies box", qty: 2, priceMinor: 2500 }, { productId: shop.products.cake, name: "Chocolate cake", qty: 1, priceMinor: 6500 }, { productId: shop.products.tart, name: "Lemon tart", qty: 2, priceMinor: 4000 }]);
    await settle("a line added");
    A.editItems(o, [{ productId: shop.products.tart, name: "Lemon tart", qty: 2, priceMinor: 4000 }]);
    await settle("two lines removed");
    A.setStatus(o, "cancelled");
    await settle("cancel after the edits");
    await expectIdle("after the edits");
  });

  it("an order edited while it is still new takes no stock; confirming it afterwards takes the edited quantity", async () => {
    const o = A.createOrder({ customerId: shop.customers[3]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 1, priceMinor: 6500 }] });
    await settle("new order");
    A.editItems(o, [{ productId: shop.products.cake, name: "Chocolate cake", qty: 7, priceMinor: 6500 }]);
    await settle("edit while new");
    A.setStatus(o, "confirmed");
    await settle("confirm");
    A.setStatus(o, "cancelled");
    await settle("cancel");
  });

  it("record a payment, record a second of the same amount, delete one (iOS 1.0's history entry), delete the other: payments on both phones are what the user recorded minus what they deleted", async () => {
    const o = A.createOrder({ customerId: shop.customers[4]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 2, priceMinor: 6500 }] });
    await settle("new order");
    const p1 = A.recordPayment(o, 3000);
    await settle("first payment");
    const p2 = A.recordPayment(o, 3000, "benefit");
    await settle("second payment, same amount");
    expect(A.get("order", o).paymentStatus).toBe("deposit");
    A.removePayment(o, p1);
    await settle("first payment deleted");
    expect(B.get("order", o).payments.map((p: J) => p.id)).toEqual([p2]);
    expect(B.get("order", o).paymentStatus).toBe("deposit");
    // The server noted the removal by id; iOS keeps the field it does not know and sends it back.
    expect((await fleet.storedData("order", o)).removedPaymentIds).toEqual([p1]);
    const p3 = A.recordPayment(o, 10000, "transfer");
    await settle("a third payment that pays the order");
    expect(B.get("order", o).paymentStatus).toBe("paid");
    A.removePayment(o, p2);
    A.removePayment(o, p3);
    await settle("two payments deleted in one edit batch");
    expect(B.get("order", o).payments).toEqual([]);
    expect(B.get("order", o).paymentStatus).toBe("unpaid");
    expect((await fleet.storedData("order", o)).removedPaymentIds!.map((x: string) => x.toLowerCase()).sort()).toEqual([p1, p2, p3].map((x) => x.toLowerCase()).sort());
    await expectIdle("after the payments");
  });

  it("a payment recorded and deleted before the sync that would carry it never reaches the server", async () => {
    const o = A.createOrder({ customerId: shop.customers[5]!, lines: [{ productId: shop.products.cookie, name: "Cookies box", qty: 1, priceMinor: 2500 }] });
    await settle("new order");
    const pay = A.recordPayment(o, 1000);
    A.removePayment(o, pay);
    await settle("record then delete");
    expect(B.get("order", o).payments).toEqual([]);
    expect(B.get("order", o).paymentStatus).toBe("unpaid");
  });

  it("deleting a payment of the seed (recorded before the upload) works too", async () => {
    const o = shop.orders.readyPaid!;
    const first = A.get("order", o).payments[0].id as string;
    A.removePayment(o, first);
    await settle("delete a seeded payment");
    expect(B.get("order", o).payments).toHaveLength(1);
    expect(B.get("order", o).paymentStatus).toBe("deposit");
  });

  it("edit a product (rename, price) and adjust its stock by hand: both reach the other phone, stock keeps every move", async () => {
    const p = shop.products.cake;
    A.editProduct(p, { nameAr: "Choco cake", priceMinor: 7000 });
    await settle("rename + price");
    expect(B.get("product", p).nameAr).toBe("Choco cake");
    A.adjustStockManually(p, 20, "received", "new batch");
    manual[p] = (manual[p] ?? 0) + 20;
    await settle("received +20");
    A.adjustStockManually(p, -3, "damaged");
    manual[p] = (manual[p] ?? 0) - 3;
    await settle("damaged -3");
    const o = A.createOrder({ customerId: shop.customers[6]!, lines: [{ productId: p, name: "Choco cake", qty: 5, priceMinor: 7000 }] });
    A.setStatus(o, "confirmed");
    await settle("an order after the manual moves");
    await expectIdle("after the product edits");
  });

  it("the busy product (its move list is at the 50 cap): orders confirmed, edited and cancelled on it keep the stock right", async () => {
    const p = shop.products.busy;
    const o = A.createOrder({ customerId: shop.customers[7]!, lines: [{ productId: p, name: "Brownie", qty: 9, priceMinor: 1200 }] });
    A.setStatus(o, "confirmed");
    await settle("confirm on the busy product");
    A.editItems(o, [{ productId: p, name: "Brownie", qty: 4, priceMinor: 1200 }]);
    await settle("edit down");
    A.setStatus(o, "cancelled");
    await settle("cancel");
    // And the seeded busy order, confirmed before the upload, cancelled now.
    A.setStatus(shop.orders.busyOrder!, "cancelled");
    await settle("cancel the seeded busy order");
  });

  it("deleting a product that has an open order, an expense and an occasion (tombstones) reaches the other phone; the order is still cancellable, stock of the rest is right", async () => {
    const temp = A.createProduct({ name: "Temp tart", priceMinor: 900, track: true, stock: 10 });
    const o = A.createOrder({ customerId: shop.customers[0]!, lines: [{ productId: temp, name: "Temp tart", qty: 2, priceMinor: 900 }, { productId: shop.products.cookie, name: "Cookies box", qty: 1, priceMinor: 2500 }] });
    A.setStatus(o, "confirmed");
    await settle("a product with an open order");
    A.deleteRecord("product", temp);
    A.deleteRecord("expense", A.all("expense")[0]!.id);
    A.deleteRecord("occasion", A.all("occasion")[0]!.id);
    await settle("three deletes");
    expect(B.records.has(`product:${temp}`)).toBe(false);
    expect(B.all("expense")).toHaveLength(2);
    expect(B.all("occasion")).toHaveLength(1);
    const server = await fleet.stored();
    expect(server.get(`product/${temp}`)!.deleted).toBe(true);
    // The order that names the deleted product is cancelled: nothing breaks, the other product comes back once.
    A.setStatus(o, "cancelled");
    await settle("cancel the order of a deleted product");
    await expectIdle("after the deletes");
  });

  it("the other phone works too: B confirms and cancels what A made, A sees it; both edit different orders at once", async () => {
    const o1 = A.createOrder({ customerId: shop.customers[8]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 2, priceMinor: 6500 }] });
    const o2 = A.createOrder({ customerId: shop.customers[9]!, lines: [{ productId: shop.products.tart, name: "Lemon tart", qty: 1, priceMinor: 4000 }] });
    await settle("two new orders");
    B.setStatus(o1, "confirmed");
    A.setStatus(o2, "confirmed");
    // Both push in the same breath: the order of arrival is A then B; they touch different orders but the same product record
    // is not edited by anyone as a record (stock follows the orders).
    const a = await A.sync();
    const b = await B.sync();
    const a2 = await A.sync();
    expect(a.rejected.concat(b.rejected, a2.rejected)).toEqual([]);
    await settle("both confirm one order each", { allowConflicts: true });
    expect(A.view()).toEqual(B.view());
    await expectStockMatches("both confirm one order each");
    B.setStatus(o1, "cancelled");
    A.setStatus(o2, "cancelled");
    await A.sync();
    await B.sync();
    await settle("both cancel", { allowConflicts: true });
    await expectIdle("after both phones worked");
  });

  it("an edit made while a sync call is in flight (iOS 1.0 keeps its pre-merge copy and pushes again): nothing is applied twice, nothing is lost, the other phone's payment survives", async () => {
    const o = A.createOrder({ customerId: shop.customers[7]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 2, priceMinor: 6500 }] });
    A.setStatus(o, "confirmed");
    await settle("order confirmed");
    // B records a payment and pushes it; A is still holding the order without it.
    const bPay = B.recordPayment(o, 3000);
    expectClean("B pays", await B.sync());
    // A now confirms a second order and, in the middle of its next sync call, records a payment on the first and confirms a third.
    const o2 = A.createOrder({ customerId: shop.customers[8]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 3, priceMinor: 6500 }] });
    A.setStatus(o2, "confirmed");
    let aPay = "";
    let o3 = "";
    A.duringRound = () => {
      aPay = A.recordPayment(o, 1000);
      o3 = A.createOrder({ customerId: shop.customers[9]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 4, priceMinor: 6500 }] });
      A.setStatus(o3, "confirmed");
    };
    const r = await A.sync();
    expect(r.ok).toBe(true);
    expect(r.rejected).toEqual([]);
    await settle("after the in-flight edits", { allowConflicts: true });
    expect((await fleet.storedData("order", o)).payments.map((x: J) => x.id.toLowerCase()).sort()).toEqual([bPay, aPay].map((x) => x.toLowerCase()).sort());
    expect(A.get("order", o).payments).toHaveLength(2);
    expect(B.get("order", o).payments).toHaveLength(2);
    expect(A.get("order", o3).status).toBe("confirmed");
    await expectIdle("after the in-flight edits");
  });

  it("a sync that is retried (the answer was lost) changes nothing: the same push twice leaves stock, payments and statuses as one", async () => {
    const o = A.createOrder({ customerId: shop.customers[10]!, lines: [{ productId: shop.products.cookie, name: "Cookies box", qty: 5, priceMinor: 2500 }] });
    A.setStatus(o, "confirmed");
    const pay = A.recordPayment(o, 4000);
    // The first attempt reaches the server but its answer never reaches the phone: the phone keeps everything dirty and pushes again.
    const plan = A.plan().flat();
    expect(plan.length).toBeGreaterThan(0);
    const lost = await fleet.call(owner.session, { action: "sync", shopId: fleet.shopId, cursor: A.cursor, changes: plan });
    expect(lost.status).toBe(200);
    await settle("retry after a lost answer", { allowConflicts: true });
    expect(B.get("order", o).payments.map((p: J) => p.id)).toEqual([pay]);
    await expectIdle("after the retry");
  });
});

describe("iOS 1.0 / a staff phone with each permission mix", () => {
  const FLAGS = ["orders", "prepare", "money", "products"] as const;
  const mixes = Array.from({ length: 16 }, (_, n) => ({ orders: !!(n & 1), prepare: !!(n & 2), money: !!(n & 4), products: !!(n & 8) }));

  for (const mix of mixes) {
    const name = FLAGS.filter((f) => mix[f]).join("+") || "no flags";
    it(`staff with ${name}: what the flags allow works with no rejection and the right stock; what they do not allow is refused and put back`, async () => {
      expectClean("upload", await A.sync());
      const staff = await fleet.addStaff(owner.session, `staff-${name}`, mix);
      const S = new SimPhone(fleet, staff.session, "ios1", `S(${name})`);
      S.cloudOn = true;
      const restore = await S.sync();
      expectClean("staff restore", restore);
      const anyFlag = Object.values(mix).some(Boolean);
      const canSeeOrders = mix.orders || mix.prepare || mix.money;
      expect(S.all("shop")).toHaveLength(1);
      expect(S.all("order").length > 0, "orders visible").toBe(canSeeOrders);
      expect(S.all("product").length > 0, "products visible").toBe(anyFlag);

      // The order the owner's phone makes for the staff member to work on.
      const o = A.createOrder({ customerId: shop.customers[0]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 2, priceMinor: 6500 }, { productId: shop.products.cookie, name: "Cookies box", qty: 3, priceMinor: 2500 }] });
      expectClean("owner makes the order", await A.sync());
      await S.sync();
      const stockBefore = { cake: A.get("product", shop.products.cake).stockQuantity as number, cookie: A.get("product", shop.products.cookie).stockQuantity as number };
      const canStatus = mix.orders || mix.prepare;

      if (canStatus) {
        S.setStatus(o, "confirmed");
        const r = await S.sync();
        expectClean("staff confirms", r);
        expectClean("owner pulls the confirm", await A.sync());
        expect(A.get("order", o).status).toBe("confirmed");
        const server = await fleet.stored();
        expect(server.get(`product/${shop.products.cake}`)!.data.stockQuantity, "cake after the staff confirm").toBe(stockBefore.cake - 2);
        expect(server.get(`product/${shop.products.cookie}`)!.data.stockQuantity, "cookie after the staff confirm").toBe(stockBefore.cookie - 3);
        S.setStatus(o, "ready");
        expectClean("staff marks ready", await S.sync());
        S.setStatus(o, "cancelled");
        expectClean("staff cancels", await S.sync());
        expectClean("owner pulls the cancel", await A.sync());
        expect(A.get("order", o).status).toBe("cancelled");
        const after = await fleet.stored();
        expect(after.get(`product/${shop.products.cake}`)!.data.stockQuantity, "cake back after the staff cancel").toBe(stockBefore.cake);
        expect(after.get(`product/${shop.products.cookie}`)!.data.stockQuantity, "cookie back after the staff cancel").toBe(stockBefore.cookie);
      } else if (canSeeOrders) {
        // money only: cannot change a status; the server refuses it, the phone puts the server's copy back.
        S.setStatus(o, "confirmed");
        const r = await S.sync();
        expect(r.ok).toBe(true);
        expect(S.get("order", o).status, "a status change by staff who may not make it is put back").toBe("newOrder");
      }

      if (mix.money || mix.orders) {
        const pay = S.recordPayment(o, 1500);
        const r = await S.sync();
        expectClean("staff records a payment", r);
        expectClean("owner pulls the payment", await A.sync());
        expect(A.get("order", o).payments.map((p: J) => p.id)).toEqual([pay]);
        S.removePayment(o, pay);
        expectClean("staff deletes the payment", await S.sync());
        expectClean("owner pulls the deletion", await A.sync());
        expect(A.get("order", o).payments).toEqual([]);
      }

      if (mix.products) {
        S.adjustStockManually(shop.products.tart, 5, "received");
        S.editProduct(shop.products.tart, { priceMinor: 4100 });
        expectClean("staff edits a product", await S.sync());
        expectClean("owner pulls the product", await A.sync());
        expect(A.get("product", shop.products.tart).priceMinor).toBe(4100);
      } else if (anyFlag) {
        // A staff phone that may not edit products and changes one: refused, put back to the server's copy.
        const before = S.get("product", shop.products.tart).priceMinor as number;
        S.editProduct(shop.products.tart, { priceMinor: before + 100 });
        const r = await S.sync();
        expect(r.ok).toBe(true);
        expect(S.get("product", shop.products.tart).priceMinor, "a refused product edit is put back").toBe(before);
        expect((await fleet.stored()).get(`product/${shop.products.tart}`)!.data.priceMinor).toBe(before);
      }
      // Nothing left pending, and an idle sync moves nothing.
      const idle = await S.sync();
      expect(idle.pushed).toBe(0);
      expect(idle.pulled).toBe(0);
    });
  }
});
