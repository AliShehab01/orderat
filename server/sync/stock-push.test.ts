// The order stock through the REAL push path, against a real (WASM) Postgres: the server owns the stock of an order that
// has a ledger (third review, 3 Oct 2026, F1-F3) and judges every client stock move (F2), on top of the second review's
// L1-L3 rules. Every scenario is a deterministic interleaving of the phones' pushes (arrival orders spelled out, writes
// landing between a push's read and its write made explicit with `racingOn`), each with retries.
// Pure rules: stock-merge.test.ts, order-stock.test.ts. The SQL function itself: atomic-write.test.ts.

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
/** The server stamps its own stock moves with this clock. */
const SERVER_NOW = new Date(Date.UTC(2026, 9, 3, 9, 0));
const serverNow = () => SERVER_NOW;

const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
const ownerPhone = { name: "owner", member: { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS } as Member, by: OWNER_ID };
const ordersPhone = { name: "orders staff", member: staff({ orders: true }), by: STAFF_ID };
const preparePhone = { name: "prepare staff", member: staff({ prepare: true }), by: STAFF_ID };
const productsPhone = { name: "products staff", member: staff({ products: true }), by: STAFF_ID };
type Phone = typeof ownerPhone;

const T = (minute: number) => new Date(Date.UTC(2026, 9, 3, 8, minute)).toISOString();
const PRODUCT = (stockQuantity: number, stockMoves: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  nameAr: "كيك", priceMinor: 6500, costMinor: 2500, trackStock: true, stockQuantity, lowStockThreshold: 3, stockMoves, createdAt: T(0), ...extra,
});
const mv = (id: string, delta: number, reason: string, orderId: string, minute: number) => ({ id, delta, reason, orderId, note: null, at: T(minute) });
const ORDER = (status: string, units: number, minute: number, ledger?: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  customerId: "c1",
  status,
  fulfillmentType: "pickup",
  paymentStatus: "unpaid",
  deliveryFeeMinor: 0,
  items: [{ id: "i1", productId: "p1", nameSnapshot: "Cake", quantity: units, unitPriceMinor: 6500, unitCostMinor: 2500 }],
  payments: [],
  changes: [],
  updatedAt: T(minute),
  ...(ledger ? { stockDeducted: ledger } : {}),
  ...extra,
});

const ch = (entity: "order" | "product", id: string, data: Record<string, unknown>, baseSeq: number): ChangeInput => ({ entity, id, data, deleted: false, baseSeq });
const push = (phone: Phone, changes: ChangeInput[]) => pushChanges(sql, SHOP_ID, phone.member, changes, phone.by, { now: serverNow });

const seqOf = async (entity: "order" | "product", id: string) => (await findRecord(sql, SHOP_ID, entity, id))!.seq;
interface StoredMove { id: string; delta: number; reason: string; orderId: string | null; at: string; note: string | null }
interface StoredProduct { nameAr: string; priceMinor: number; stockQuantity: number; lowStockThreshold: number; trackStock: boolean; stockMoves: StoredMove[] }
const productNow = async (id = "p1") => (await findRecord(sql, SHOP_ID, "product", id))!.data as unknown as StoredProduct;
const orderNow = async (id: string) => (await findRecord(sql, SHOP_ID, "order", id))!.data;
const stockNow = async (id = "p1") => (await productNow(id)).stockQuantity;
const rowsNow = async (orderId: string) => {
  const rows = await sql.query<{ product_id: string; units: number }>(`select product_id, units from orderat.order_stock where shop_id = $1 and order_id = $2 order by product_id`, [SHOP_ID, orderId]);
  return Object.fromEntries(rows.map((r) => [r.product_id, Number(r.units)]));
};
/** What stock_ops holds for the given keys only (the server's own moves and the listed ones are in it too). */
const opsNow = async (...keys: string[]) => {
  const rows = await sql.query<{ op_id: string; outcome: string }>(`select op_id, outcome from orderat.stock_ops where shop_id = $1 order by op_id`, [SHOP_ID]);
  return Object.fromEntries(rows.filter((r) => keys.includes(r.op_id)).map((r) => [r.op_id, r.outcome]));
};
/** The id the server gives its own move is a UUID derived from the order id, the seq the order's atomic write drew and the product id
 * (atomic-write.test.ts checks the formula). The order is written again after its products at the end of a batch (fourth review, R1),
 * so its final seq is not the one in the id: tests read the id off the product. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const moveIds = async () => (await productNow()).stockMoves.map((m) => m.id);

/** The first `times` reads matching `match` through this client each run `otherWrite` (another device's push, say) before
 * they come back: the window between a push's read and its write, made deterministic. */
function racingOn(match: RegExp, otherWrite: () => Promise<unknown>, times = 1): SqlClient {
  let left = times;
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      const rows = await sql.query<T>(text, params);
      if (left > 0 && match.test(text)) {
        left--;
        await otherWrite();
      }
      return rows;
    },
  };
}
/** The read of one record (the decision's own read), the order's allocation rows, the stock_ops lookup. */
const ONE_RECORD_READ = /from orderat\.records where shop_id = \$1 and entity = \$2 and id = \$3/;
const ALLOCATION_READ = /from orderat\.order_stock/;
const OPS_READ = /from orderat\.stock_ops/;
/** The bulk read of the orders a product push's moves name. */
const ORDERS_READ = /from orderat\.records where shop_id = \$1 and entity = \$2 and id in \(/;

/** Both phones start from the same copies: product p1 with 10 in stock and no moves, orders oA (3 units) and oB (2 units). */
let base: { p1: number; oA: number; oB: number };
beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  const seeded = await push(ownerPhone, [ch("product", "p1", PRODUCT(10), 0), ch("order", "oA", ORDER("newOrder", 3, 0), 0), ch("order", "oB", ORDER("newOrder", 2, 0), 0)]);
  expect(seeded).toEqual({ conflicts: [], rejected: [] });
  base = { p1: await seqOf("product", "p1"), oA: await seqOf("order", "oA"), oB: await seqOf("order", "oB") };
});

/** What a phone pushes after confirming `orderId` (`units` of p1) from the copy of `base`: its own product copy (its own
 * move, stock lowered) and the order with its ledger. */
const confirmBatch = (moveId: string, orderId: "oA" | "oB", units: number, minute: number): ChangeInput[] => [
  ch("product", "p1", PRODUCT(10 - units, [mv(moveId, -units, "orderConfirmed", orderId, minute)]), base.p1),
  ch("order", orderId, ORDER("confirmed", units, minute, { p1: units }), base[orderId]),
];

const PAIRS: [Phone, Phone][] = [[ownerPhone, ownerPhone], [ownerPhone, preparePhone], [preparePhone, preparePhone], [ordersPhone, preparePhone]];

// ---------------------------------------------------------------------------------------------------------------------
describe("F1 / two devices doing the same order transition take its stock once", () => {
  for (const [phoneA, phoneB] of PAIRS) {
    for (const arrival of ["A then B", "B then A"] as const) {
      it(`confirm (${phoneA.name} + ${phoneB.name}, ${arrival}): stock is the opening 10 minus the order's 3, once; cancelling gives 10, and cancelling twice still 10`, async () => {
        const batches = { A: () => push(phoneA, confirmBatch("mA", "oA", 3, 1)), B: () => push(phoneB, confirmBatch("mB", "oA", 3, 2)) };
        const [first, second] = arrival === "A then B" ? (["A", "B"] as const) : (["B", "A"] as const);

        const firstResult = await batches[first]();
        // The first phone's own push is no conflict: the server's stock effect on its product is not another phone's write.
        expect(firstResult).toEqual({ conflicts: [], rejected: [] });
        expect(await stockNow()).toBe(7);
        const serverMove = (await productNow()).stockMoves[0]!; // the server's own move for the accepted order version
        const secondResult = await batches[second]();
        expect(secondResult.rejected).toEqual([]);
        expect(secondResult.conflicts.map((c) => `${c.entity}/${c.id}`).sort()).toEqual(["order/oA", "product/p1"]); // stale copies: reported, applied

        // Stock = opening - the order's units, not minus 3 twice; the list shows the server's one move, never the phones' two.
        expect(await stockNow()).toBe(7);
        expect(await moveIds()).toEqual([serverMove.id]);
        expect(serverMove).toEqual({ id: expect.stringMatching(UUID_SHAPE), delta: -3, reason: "orderConfirmed", orderId: "oA", note: null, at: SERVER_NOW.toISOString() });
        expect(await rowsNow("oA")).toEqual({ p1: 3 });
        expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
        expect(await opsNow("id:ma", "id:mb")).toEqual({ "id:ma": "ignored", "id:mb": "ignored" });
        expect(await opsNow(`id:${serverMove.id}`)).toEqual({ [`id:${serverMove.id}`]: "applied" }); // the server's own move is recorded too

        // Both phones cancel from their copy of the confirmed order (each with its own give-back move): restored once.
        const cancel = (phone: Phone, moveId: string, minute: number) =>
          push(phone, [ch("order", "oA", ORDER("cancelled", 3, minute, {}), base.oA), ch("product", "p1", PRODUCT(10, [mv(moveId, 3, "orderCancelled", "oA", minute)]), base.p1)]);
        await cancel(phoneA, "cA", 3);
        expect(await stockNow()).toBe(10);
        await cancel(phoneB, "cB", 4);
        expect(await stockNow()).toBe(10);
        expect(await rowsNow("oA")).toEqual({ p1: 0 });
        expect((await orderNow("oA")).stockDeducted).toEqual({});
        expect((await productNow()).stockMoves.map((m) => m.reason)).toEqual(["orderCancelled", "orderConfirmed"]);
      });
    }
  }

  it("two devices cancel the same order: the stock is given back once (each push repeated as well)", async () => {
    await push(ownerPhone, confirmBatch("m0", "oA", 3, 1));
    expect(await stockNow()).toBe(7);
    const afterConfirm = { p1: await seqOf("product", "p1"), oA: await seqOf("order", "oA") };
    const cancel = (moveId: string, minute: number) => [
      ch("order", "oA", ORDER("cancelled", 3, minute, {}), afterConfirm.oA),
      ch("product", "p1", PRODUCT(10, [mv(moveId, 3, "orderCancelled", "oA", minute)]), afterConfirm.p1),
    ];
    for (const phone of [ownerPhone, preparePhone, ownerPhone, preparePhone]) {
      expect((await push(phone, cancel(`c-${phone.name}`, 2))).rejected).toEqual([]);
      expect(await stockNow()).toBe(10);
    }
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
    expect((await productNow()).stockMoves.map((m) => m.reason)).toEqual(["orderCancelled", "orderConfirmed"]);
  });

  for (const arrival of ["phone 1 then phone 2", "phone 2 then phone 1"] as const) {
    it(`edits 3 -> 5 on one phone and 3 -> 4 on the other (${arrival}): stock is the opening minus the WINNING quantity, and cancelling gives back the opening`, async () => {
      // oA (3 units) was confirmed by the owner (stock 7, ledger {p1:3}); both phones hold that copy.
      await push(ownerPhone, confirmBatch("c", "oA", 3, 1));
      const synced = { p1: await seqOf("product", "p1"), oA: await seqOf("order", "oA") };
      const phones = {
        "phone 1": [ch("order", "oA", ORDER("confirmed", 5, 2, { p1: 5 }), synced.oA), ch("product", "p1", PRODUCT(5, [mv("e1", -2, "orderEdited", "oA", 2)]), synced.p1)],
        "phone 2": [ch("order", "oA", ORDER("confirmed", 4, 3, { p1: 4 }), synced.oA), ch("product", "p1", PRODUCT(6, [mv("e2", -1, "orderEdited", "oA", 3)]), synced.p1)],
      };
      const sequence = arrival === "phone 1 then phone 2" ? (["phone 1", "phone 2"] as const) : (["phone 2", "phone 1"] as const);
      for (const name of sequence) expect((await push(ownerPhone, phones[name])).rejected).toEqual([]);

      // The order record is last-writer-wins: the last phone's items and ledger. The stock is what that ledger says.
      const winning = sequence[1] === "phone 1" ? 5 : 4;
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: winning });
      expect(await stockNow()).toBe(10 - winning);
      expect(await rowsNow("oA")).toEqual({ p1: winning });
      // The phones' own edit moves are never added: the list is the server's moves for the confirm and the changes of the ledger.
      expect((await moveIds()).filter((id) => id === "e1" || id === "e2")).toEqual([]);

      // Replays of both phones' pushes change nothing.
      for (const name of sequence) await push(ownerPhone, phones[name]);
      expect(await stockNow()).toBe(10 - winning);

      // Cancelling the order (from the winning copy) gives back everything that was taken: the opening 10.
      await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", winning, 4, {}), await seqOf("order", "oA")), ch("product", "p1", PRODUCT(10, [mv("cx", winning, "orderCancelled", "oA", 4)]), await seqOf("product", "p1"))]);
      expect(await stockNow()).toBe(10);
      expect(await rowsNow("oA")).toEqual({ p1: 0 });
    });
  }

  it("a repeated push (a retry) of the same order version changes no stock, twice over", async () => {
    await push(ownerPhone, confirmBatch("m1", "oA", 3, 1));
    const seqs = await Promise.all([seqOf("order", "oA"), seqOf("product", "p1")]);
    for (let retry = 0; retry < 3; retry++) {
      await push(preparePhone, confirmBatch("m1", "oA", 3, 1));
      expect(await stockNow()).toBe(7);
      expect(await moveIds()).toHaveLength(1);
    }
    expect(seqs[0]).toBeLessThan(await seqOf("order", "oA")); // the order is rewritten each time (a fresh seq)...
    expect(await rowsNow("oA")).toEqual({ p1: 3 }); // ...the stock is not
  });

  it("the merged copy reaches every device on the same sync's pull: the pushing phone and the other phones end with the server's stock", async () => {
    const cursor = (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).cursor;
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    for (const member of [ownerPhone.member, preparePhone.member, ordersPhone.member]) {
      const pulled = (await pullForMember(sql, SHOP_ID, member, cursor)).changes;
      expect(pulled.map((c) => `${c.entity}/${c.id}`)).toEqual(["product/p1", "order/oA"]); // the product first, then the order that moved it (fourth review, R1)
      const product = pulled.find((c) => c.entity === "product")!;
      expect(product.data.stockQuantity).toBe(7);
      expect((product.data.stockMoves as { orderId: string }[]).map((m) => m.orderId)).toEqual(["oA"]);
    }
  });

  it("a push whose order lands between another phone's read and write: the other phone's compare-and-swap fails and it decides again, taking the stock once", async () => {
    const aLands = async () => expect((await push(ownerPhone, confirmBatch("mA", "oA", 3, 1))).rejected).toEqual([]);
    // B reads the order (stored: new, no ledger) as A's whole push lands, then B writes: its check on the order's seq fails.
    const result = await pushChanges(racingOn(ONE_RECORD_READ, aLands), SHOP_ID, preparePhone.member, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 3 }), base.oA)], STAFF_ID, { now: serverNow });
    expect(result.rejected).toEqual([]);
    expect(result.conflicts).toEqual([{ entity: "order", id: "oA", seq: expect.any(Number) }]);
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect(await moveIds()).toHaveLength(1);
  });

  it("an allocation that changes between the order's read and its write (another push applied a move) refuses the write: it is decided again, and nothing is taken twice", async () => {
    // A released phone's cancel-able confirm of oA lands (order has no ledger: the move is applied, allocation 3) while the
    // ledger push of oA is between reading the allocation rows and writing.
    const releasedConfirm = async () => expect((await push(ownerPhone, [ch("product", "p1", PRODUCT(7, [mv("old", -3, "orderConfirmed", "oA", 1)]), base.p1)])).rejected).toEqual([]);
    const result = await pushChanges(racingOn(ALLOCATION_READ, releasedConfirm), SHOP_ID, ownerPhone.member, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 3 }), base.oA)], OWNER_ID, { now: serverNow });
    expect(result.rejected).toEqual([]);
    expect(await stockNow()).toBe(7); // taken once: by the released phone's move; the ledger found it applied
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
  });

  it("a product whose move names an order that is rewritten meanwhile is judged again (the order's seq is guarded)", async () => {
    // Released phone: product move for the non-ledger order oA, while another phone confirms oA with a ledger in between.
    const ledgerLands = async () => expect((await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 3 }), base.oA)])).rejected).toEqual([]);
    const result = await pushChanges(racingOn(OPS_READ, ledgerLands), SHOP_ID, preparePhone.member, [ch("product", "p1", PRODUCT(7, [mv("rel", -3, "orderConfirmed", "oA", 1)]), base.p1)], STAFF_ID, { now: serverNow });
    expect(result.rejected).toEqual([]);
    // The ledger push took the 3 (server move); the released phone's move was then judged against an order that has a ledger: ignored.
    expect(await stockNow()).toBe(7);
    expect(await opsNow("id:rel")).toEqual({ "id:rel": "ignored" });
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
  });

  it("an order that gets a ledger between a product push's read and its write: the guard on the order's seq refuses the write, and the move is judged again (ignored)", async () => {
    // The released phone's move names oA, which has no ledger when it is read: as read, the move would be applied (stock 7)...
    const ledgerOfNothing = async () => expect((await push(ownerPhone, [ch("order", "oA", ORDER("newOrder", 3, 2, {}), base.oA)])).rejected).toEqual([]);
    const result = await pushChanges(racingOn(ORDERS_READ, ledgerOfNothing), SHOP_ID, preparePhone.member, [ch("product", "p1", PRODUCT(7, [mv("rel", -3, "orderConfirmed", "oA", 1)]), base.p1)], STAFF_ID, { now: serverNow });
    expect(result.rejected).toEqual([]);
    // ...but oA now has a ledger ({}: it takes nothing): the server owns its stock, and the phone's move is ignored.
    expect(await stockNow()).toBe(10);
    expect(await opsNow("id:rel")).toEqual({ "id:rel": "ignored" });
    expect(await rowsNow("oA")).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("F2 / a member cannot push a fabricated stock move", () => {
  const forgedOnly = (moves: unknown[], quantity = 1_000_010) => [ch("product", "p1", PRODUCT(quantity, moves), base.p1)];

  for (const phone of [preparePhone, ordersPhone]) {
    it(`${phone.name}: a move for a nonexistent order, an unrelated product, an inflated or a wrong-direction delta leaves the stock as it is`, async () => {
      await push(ownerPhone, [ch("product", "p2", PRODUCT(5), 0)]);
      const forged = [
        mv("f1", 1_000_000, "orderEdited", "ghost", 1),
        mv("f2", -1_000_000, "orderConfirmed", "oA", 2),
        mv("f3", 1_000_000, "orderCancelled", "oA", 3),
        mv("f4", 2, "orderConfirmed", "oA", 4), // a confirm that adds stock
        mv("f5", -2, "orderCancelled", "oA", 5), // a cancel that takes it
        mv("f6", 3, "orderCancelled", "oA", 6), // nothing was taken to give back
      ];
      for (const moves of forged.map((m) => [m])) {
        const result = await push(phone, forgedOnly(moves));
        expect(result.rejected, JSON.stringify(moves)).toEqual([]);
        expect(await stockNow()).toBe(10);
      }
      await push(phone, forgedOnly(forged.slice().reverse()));
      expect(await stockNow()).toBe(10);
      // A real order, an unrelated product: p2 is not on oA's lines.
      await push(phone, [ch("product", "p2", PRODUCT(1_000_000, [mv("f7", -1, "orderConfirmed", "oA", 7)]), await seqOf("product", "p2"))]);
      expect(await stockNow("p2")).toBe(5);
      expect(await rowsNow("oA")).toEqual({});
      expect(await opsNow("id:f1", "id:f2", "id:f3", "id:f4", "id:f5", "id:f6", "id:f7")).toEqual({}); // none recorded: not applied, not ignored
    });

    it(`${phone.name}: a forged move for an order the server owns (it has a ledger) is ignored too, and the real order's stock is untouched`, async () => {
      await push(ownerPhone, confirmBatch("m0", "oA", 3, 1));
      expect(await stockNow()).toBe(7);
      await push(phone, [ch("product", "p1", PRODUCT(1_000_007, [mv("f1", 1_000_000, "orderCancelled", "oA", 2)]), await seqOf("product", "p1"))]);
      expect(await stockNow()).toBe(7);
      expect(await opsNow("id:f1")).toEqual({ "id:f1": "ignored" });
    });
  }

  it("legit moves of a released phone still work for the same member: confirm, an edit and a cancel (orders staff), each applied once", async () => {
    const confirm = (moveId: string, units: number) => [ch("product", "p1", PRODUCT(10 - units, [mv(moveId, -units, "orderConfirmed", "oA", 1)]), base.p1), ch("order", "oA", ORDER("confirmed", units, 1), base.oA)];
    await push(ordersPhone, confirm("c1", 3));
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    // Raise the order to 5 units: the edit move -2 is within the order's units.
    const edit = [
      ch("order", "oA", ORDER("confirmed", 5, 2), await seqOf("order", "oA")),
      ch("product", "p1", PRODUCT(5, [mv("e1", -2, "orderEdited", "oA", 2), mv("c1", -3, "orderConfirmed", "oA", 1)]), await seqOf("product", "p1")),
    ];
    await push(ordersPhone, edit);
    expect(await stockNow()).toBe(5);
    expect(await rowsNow("oA")).toEqual({ p1: 5 });
    // ...and a replay applies nothing.
    await push(ordersPhone, edit);
    expect(await stockNow()).toBe(5);
    // Cancel gives back what is applied (5), not more.
    await push(preparePhone, [
      ch("order", "oA", ORDER("cancelled", 5, 3), await seqOf("order", "oA")),
      ch("product", "p1", PRODUCT(10, [mv("x1", 5, "orderCancelled", "oA", 3)]), await seqOf("product", "p1")),
    ]);
    expect(await stockNow()).toBe(10);
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
    // A second cancel move for the same order (another phone) has nothing left to give back.
    await push(ownerPhone, [ch("product", "p1", PRODUCT(15, [mv("x2", 5, "orderCancelled", "oA", 4)]), await seqOf("product", "p1"))]);
    expect(await stockNow()).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("F3 / a first-time offline deduction older than the 50-move window is applied exactly once", () => {
  const received = (n: number) => ({ id: `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
  const window = (newest: number, count: number) => Array.from({ length: count }, (_, i) => received(newest - i));
  /** The server's list is full (h59 ... h10, stock 70) after 60 manual moves, 50 of them pushed in one go and 10 more later. */
  async function fullWindow() {
    await push(ownerPhone, [ch("product", "p1", PRODUCT(60, window(49, 50)), base.p1)]);
    await push(ownerPhone, [ch("product", "p1", PRODUCT(70, window(59, 50)), await seqOf("product", "p1"))]);
    expect(await stockNow()).toBe(70);
    expect(await moveIds()).toHaveLength(50);
    expect(await moveIds()).not.toContain("h0");
  }
  const mOff = { id: "off", delta: -2, reason: "orderConfirmed", orderId: "oB", note: null, at: "2026-08-15T10:00:00.000Z" }; // far older than every move in the window

  it("a ledger-aware phone: the offline confirm of 2 units takes 2 once, its ledger is true, a cancel gives them back, a replay changes nothing", async () => {
    await fullWindow();
    const offline = () => [ch("order", "oB", ORDER("confirmed", 2, 5, { p1: 2 }), base.oB), ch("product", "p1", PRODUCT(8, [mOff]), base.p1)];
    expect((await push(ownerPhone, offline())).rejected).toEqual([]);
    expect(await stockNow()).toBe(68);
    expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
    expect(await rowsNow("oB")).toEqual({ p1: 2 });
    expect(await opsNow("id:off")).toEqual({ "id:off": "ignored" });
    // Replays of the very same batch, from either kind of phone: zero more.
    await push(ownerPhone, offline());
    await push(preparePhone, [ch("product", "p1", PRODUCT(8, [mOff]), base.p1)]);
    expect(await stockNow()).toBe(68);
    // The cancel gives back the 2 that were taken, once.
    await push(ownerPhone, [ch("order", "oB", ORDER("cancelled", 2, 6, {}), await seqOf("order", "oB"))]);
    expect(await stockNow()).toBe(70);
    await push(ownerPhone, [ch("order", "oB", ORDER("cancelled", 2, 6, {}), await seqOf("order", "oB"))]);
    expect(await stockNow()).toBe(70);
  });

  it("a released phone (no ledger): the same old move is applied once, a replay of it zero times", async () => {
    await fullWindow();
    const offline = () => [ch("order", "oB", ORDER("confirmed", 2, 5), base.oB), ch("product", "p1", PRODUCT(8, [mOff]), base.p1)];
    await push(ownerPhone, offline());
    expect(await stockNow()).toBe(68);
    expect(await rowsNow("oB")).toEqual({ p1: 2 });
    expect(await opsNow("id:off")).toEqual({ "id:off": "applied" });
    await push(ownerPhone, offline());
    await push(preparePhone, [ch("product", "p1", PRODUCT(8, [mOff]), base.p1)]);
    expect(await stockNow()).toBe(68);
  });

  it("a manual correction made offline long before the window is applied once as well (the owner's), and a replay adds nothing", async () => {
    await fullWindow();
    const old = { id: "offline-received", delta: 20, reason: "received", orderId: null, note: null, at: "2026-01-01T00:00:00.000Z" };
    const batch = () => [ch("product", "p1", PRODUCT(90, [old]), base.p1)];
    await push(ownerPhone, batch());
    expect(await stockNow()).toBe(90);
    await push(ownerPhone, batch());
    await push(productsPhone, batch());
    expect(await stockNow()).toBe(90);
  });

  it("a move that was trimmed off the list is still known: a stale phone that pushes it again after 50 newer moves does not add it again", async () => {
    await fullWindow();
    // h0..h9 were applied and trimmed off the server's list long ago; a stale phone still holds h5..h0 and pushes them back
    // with one move of its own (n1, 2 units of oB). stock_ops holds all 60 ids: only n1 counts.
    const stale = PRODUCT(0, [mv("n1", -2, "orderConfirmed", "oB", 8), ...window(5, 6)]);
    await push(ownerPhone, [ch("product", "p1", stale, base.p1)]);
    expect(await stockNow()).toBe(68);
    await push(ownerPhone, [ch("product", "p1", stale, base.p1)]);
    expect(await stockNow()).toBe(68);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 5: the released apps (iOS 1.0, Android 1.5.5, the live web before it writes a ledger) push orders with no
// `stockDeducted` and move the product's stock themselves, with order-driven moves on the product.
describe("released apps / no ledger, order-driven moves on the product: still deduct and restore once", () => {
  const releasedConfirm = (moveId: string, orderId: "oA" | "oB", units: number, minute: number): ChangeInput[] => [
    ch("product", "p1", PRODUCT(10 - units, [mv(moveId, -units, "orderConfirmed", orderId, minute)]), base.p1),
    ch("order", orderId, ORDER("confirmed", units, minute), base[orderId]),
  ];
  const releasedCancel = async (moveId: string, orderId: "oA" | "oB", units: number, minute: number): Promise<ChangeInput[]> => [
    ch("product", "p1", PRODUCT(10, [mv(moveId, units, "orderCancelled", orderId, minute)]), await seqOf("product", "p1")),
    ch("order", orderId, ORDER("cancelled", units, minute), await seqOf(`order`, orderId)),
  ];

  for (const phone of [ownerPhone, ordersPhone, preparePhone]) {
    it(`${phone.name}: confirm deducts once, a replay and a second phone's copy change nothing, the cancel restores once`, async () => {
      expect(await push(phone, releasedConfirm("m1", "oA", 3, 1))).toEqual({ conflicts: [], rejected: [] });
      expect(await stockNow()).toBe(7);
      expect(await rowsNow("oA")).toEqual({ p1: 3 });
      expect((await orderNow("oA")).stockDeducted).toBeUndefined(); // the server writes no ledger for an order that never had one
      expect(await opsNow("id:m1")).toEqual({ "id:m1": "applied" });
      expect(await moveIds()).toEqual(["m1"]);

      await push(phone, releasedConfirm("m1", "oA", 3, 1)); // a replay
      await push(ownerPhone, releasedConfirm("m1", "oA", 3, 1)); // another phone with the same copy and move
      expect(await stockNow()).toBe(7);
      expect(await moveIds()).toEqual(["m1"]);

      await push(phone, await releasedCancel("c1", "oA", 3, 2));
      expect(await stockNow()).toBe(10);
      expect(await rowsNow("oA")).toEqual({ p1: 0 });
      await push(phone, await releasedCancel("c1", "oA", 3, 2));
      await push(ownerPhone, await releasedCancel("c2", "oA", 3, 3)); // a second cancel move for the same order: nothing left to give back
      expect(await stockNow()).toBe(10);
    });
  }

  it("two released phones confirm the same order from the same copy (different move ids): the order's own units cap what can be taken, so stock is taken once; a double cancel gives back once", async () => {
    await push(ownerPhone, releasedConfirm("mA", "oA", 3, 1));
    expect(await stockNow()).toBe(7);
    // B's copy is stale and its move has another id: taking 3 more would put 6 units against an order of 3.
    await push(preparePhone, releasedConfirm("mB", "oA", 3, 2));
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect(await opsNow("id:mB")).toEqual({}); // judged and refused: not applied, not recorded
    await push(ownerPhone, await releasedCancel("cA", "oA", 3, 3));
    await push(preparePhone, await releasedCancel("cB", "oA", 3, 4)); // nothing left to give back
    expect(await stockNow()).toBe(10);
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
  });

  it("a new order created and confirmed offline in one batch: the order is applied first, so the move naming it counts (not lost for being early)", async () => {
    const batch = [
      ch("product", "p1", PRODUCT(7, [mv("m9", -3, "orderConfirmed", "oNew", 1)]), base.p1),
      ch("order", "oNew", ORDER("confirmed", 3, 1), 0),
    ];
    expect(await push(ownerPhone, batch)).toEqual({ conflicts: [], rejected: [] });
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oNew")).toEqual({ p1: 3 });
    // The phones apply a pull in seq order, and an installed Android app keeps a null link for an order line whose product it
    // has not got yet (fourth review, R1): the product comes before the order whose line names it, however the batch was applied.
    const pulled = (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).changes.map((c) => `${c.entity}/${c.id}`);
    expect(pulled.indexOf("product/p1")).toBeLessThan(pulled.indexOf("order/oNew"));
  });

  it("customers and new products keep their place before the orders of the same batch (the phones apply a pull in seq order)", async () => {
    const cursor = (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).cursor;
    await push(ownerPhone, [
      ch("product", "p1", PRODUCT(7, [mv("m1", -3, "orderConfirmed", "oC", 1)]), base.p1),
      { entity: "product", id: "pNew", data: PRODUCT(4), deleted: false, baseSeq: 0 },
      { entity: "customer", id: "cNew", data: { name: "Noora", phone: "+97333000001" }, deleted: false, baseSeq: 0 },
      ch("order", "oC", ORDER("confirmed", 3, 1, undefined, { customerId: "cNew" }), 0),
    ]);
    const order = (await pullForMember(sql, SHOP_ID, ownerPhone.member, cursor)).changes.map((c) => `${c.entity}/${c.id}`);
    // The order was applied first in the batch (its move had to be judged against it), then written again after p1 (R1).
    expect(order).toEqual(["product/pNew", "customer/cNew", "product/p1", "order/oC"]);
  });

  it("an iOS-shaped push (uppercase ids everywhere) is deducted and restored once, and its replay is known by the lowercase key", async () => {
    const IDS = { product: "6B1F0A2E-3D4C-4E5F-8A9B-0C1D2E3F4A5B", order: "A1B2C3D4-0000-4000-8000-000000000001", move: "FFEEDDCC-1111-4222-8333-444455556666" };
    await push(ownerPhone, [{ entity: "product", id: IDS.product, data: PRODUCT(10), deleted: false, baseSeq: 0 }, { entity: "order", id: IDS.order, data: { ...ORDER("newOrder", 3, 0), items: [{ id: "I1", productId: IDS.product, nameSnapshot: "Cake", quantity: 3, unitPriceMinor: 6500, unitCostMinor: 2500 }] }, deleted: false, baseSeq: 0 }]);
    const confirm = async () => [
      { entity: "product" as const, id: IDS.product, data: PRODUCT(7, [{ id: IDS.move, delta: -3, reason: "orderConfirmed", orderId: IDS.order, note: null, at: T(1) }]), deleted: false, baseSeq: await seqOf("product", IDS.product) },
      { entity: "order" as const, id: IDS.order, data: { ...ORDER("confirmed", 3, 1), items: [{ id: "I1", productId: IDS.product, nameSnapshot: "Cake", quantity: 3, unitPriceMinor: 6500, unitCostMinor: 2500 }] }, deleted: false, baseSeq: await seqOf("order", IDS.order) },
    ];
    await push(preparePhone, await confirm());
    expect(await stockNow(IDS.product)).toBe(7);
    await push(preparePhone, await confirm());
    expect(await stockNow(IDS.product)).toBe(7);
    expect(await opsNow(`id:${IDS.move.toLowerCase()}`)).toEqual({ [`id:${IDS.move.toLowerCase()}`]: "applied" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The released apps and the live web run next to the new code for a while. An order a ledger-aware client confirmed carries
// `stockDeducted`; the released apps keep that key (unknown keys are preserved) and do their own stock moves.
describe("mixed fleet / a released app on an order that has a ledger", () => {
  it("a released phone cancels an order another app confirmed: the stale ledger it sends back settles to {}, the server gives the stock back once and its own move is ignored", async () => {
    await push(ownerPhone, confirmBatch("web1", "oA", 3, 1)); // a ledger-aware client (the live web) confirmed oA
    expect(await stockNow()).toBe(7);
    const releasedCancel = async (phone: Phone) => push(phone, [
      ch("product", "p1", PRODUCT(10, [mv("ios1", 3, "orderCancelled", "oA", 2)]), await seqOf("product", "p1")),
      ch("order", "oA", ORDER("cancelled", 3, 2, { p1: 3 }), await seqOf("order", "oA")), // the key it never heard of, as it found it
    ]);
    await releasedCancel(ownerPhone);
    expect(await stockNow()).toBe(10);
    expect((await orderNow("oA")).stockDeducted).toEqual({});
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
    await releasedCancel(preparePhone); // another released phone, same cancel
    expect(await stockNow()).toBe(10);
  });

  it("a prepare-only released phone cancels the same way (its push may only carry the status; the ledger settles on the server)", async () => {
    await push(preparePhone, confirmBatch("web1", "oA", 3, 1));
    expect(await stockNow()).toBe(7);
    await push(preparePhone, [
      ch("order", "oA", ORDER("cancelled", 3, 2, { p1: 3 }), await seqOf("order", "oA")),
      ch("product", "p1", PRODUCT(10, [mv("ios1", 3, "orderCancelled", "oA", 2)]), await seqOf("product", "p1")),
    ]);
    expect(await stockNow()).toBe(10);
    expect((await orderNow("oA")).stockDeducted).toEqual({});
  });

  it("known limit: a released phone that confirms (or edits) an order whose ledger is {} or lower than its lines is not followed; stock is never created", async () => {
    await push(ownerPhone, confirmBatch("web1", "oA", 3, 1));
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 2, {}), await seqOf("order", "oA"))]);
    expect(await stockNow()).toBe(10);
    // A released phone re-confirms it: its own move is ignored (the order has a ledger), the order says confirmed with {}.
    await push(ownerPhone, [
      ch("product", "p1", PRODUCT(7, [mv("ios2", -3, "orderConfirmed", "oA", 3)]), await seqOf("product", "p1")),
      ch("order", "oA", ORDER("confirmed", 3, 3, {}), await seqOf("order", "oA")),
    ]);
    expect(await stockNow()).toBe(10); // under-deducted (too high), never over-restored
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Existing shops: order_stock starts empty. An order confirmed before the deploy took its stock by a client move; the
// server must neither take it a second time on a later ledger push nor fail to give it back once.
describe("existing shops / an order confirmed before the deploy (nothing in order_stock)", () => {
  const OLD = mv("old", -3, "orderConfirmed", "oA", 1);
  /** The database as the old server left it: stock 7 with the confirm move on the product, and the order confirmed. */
  async function seedBeforeDeploy(order: Record<string, unknown>, list: unknown[] = [OLD], stock = 7) {
    await upsertRecord(sql, SHOP_ID, "product", "p1", PRODUCT(stock, list), false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "oA", order, false, OWNER_ID);
    expect(await rowsNow("oA")).toEqual({});
  }
  const synced = async () => ({ p1: await seqOf("product", "p1"), oA: await seqOf("order", "oA") });

  it("a later ledger push (a notes edit by a ledger-aware client, the ledger restated) does not take the stock a second time", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1, { p1: 3 }));
    const seqs = await synced();
    for (let attempt = 0; attempt < 2; attempt++) {
      await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 3 }, { notes: "No nuts" }), seqs.oA)]);
      expect(await stockNow()).toBe(7);
    }
    expect(await rowsNow("oA")).toEqual({ p1: 3 }); // the server's books now say what the stock says
    expect(await moveIds()).toEqual(["old"]); // and it made no move of its own
  });

  it("a later cancel gives the stock back once (a replay and a second device change nothing)", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1, { p1: 3 }));
    const seqs = await synced();
    for (const phone of [preparePhone, ownerPhone, preparePhone]) {
      await push(phone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), seqs.oA)]);
      expect(await stockNow()).toBe(10);
    }
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
    expect((await productNow()).stockMoves.map((m) => m.reason)).toEqual(["orderCancelled", "orderConfirmed"]);
  });

  it("a later edit (3 -> 5) takes the 2 more units, not 5", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1, { p1: 3 }));
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 5, 3, { p1: 5 }), (await synced()).oA)]);
    expect(await stockNow()).toBe(5);
    expect(await rowsNow("oA")).toEqual({ p1: 5 });
  });

  it("a legacy order (no ledger) cancelled by a released phone: its move is judged against what the product's own moves say was taken, and gives back once", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1));
    const cancel = async () => [ch("product", "p1", PRODUCT(10, [mv("c1", 3, "orderCancelled", "oA", 2), OLD]), await seqOf("product", "p1")), ch("order", "oA", ORDER("cancelled", 3, 2), (await synced()).oA)];
    await push(ownerPhone, await cancel());
    expect(await stockNow()).toBe(10);
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
    await push(preparePhone, await cancel());
    expect(await stockNow()).toBe(10);
  });

  it("a legacy order (no ledger) cancelled by a ledger-aware client (it derived the legacy ledger and writes {}): the baseline comes from the moves, once", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1));
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 2, {}), (await synced()).oA)]);
    expect(await stockNow()).toBe(10);
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 2, {}), (await synced()).oA)]);
    expect(await stockNow()).toBe(10);
  });

  it("a legacy order (no ledger) moved on by a ledger-aware client that derived the legacy ledger from the moves ({p1: 3}): nothing is taken twice, and a later cancel gives back once", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1));
    await push(ownerPhone, [ch("order", "oA", ORDER("ready", 3, 2, { p1: 3 }), (await synced()).oA)]);
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect(await moveIds()).toEqual(["old"]);
    await push(preparePhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), (await synced()).oA)]);
    expect(await stockNow()).toBe(10);
  });

  it("the confirm move has aged out of a full 50-move list: the order's own ledger (written together with the move by the same phone) stands, the cancel gives back 3", async () => {
    const received = (n: number) => ({ id: `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
    await seedBeforeDeploy(ORDER("confirmed", 3, 1, { p1: 3 }), Array.from({ length: 50 }, (_, i) => received(60 - i)), 57);
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 2, {}), (await synced()).oA)]);
    expect(await stockNow()).toBe(60);
    expect(await rowsNow("oA")).toEqual({ p1: 0 });
  });

  it("the stock never moved for an order that carries a ledger (a short list with no move for it): the ledger is taken now, so the stock follows the order", async () => {
    await seedBeforeDeploy(ORDER("confirmed", 3, 1, { p1: 3 }), [], 10); // e.g. the product push never reached the old server
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 3 }, { notes: "x" }), (await synced()).oA)]);
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    // ...and a cancel then gives back exactly that.
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), (await synced()).oA)]);
    expect(await stockNow()).toBe(10);
  });

  it("a product that no longer exists (or was deleted) is skipped, the allocation is still set, and nothing fails", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "oGone", ORDER("newOrder", 1, 0, undefined, { items: [{ id: "i9", productId: "pGone", nameSnapshot: "Gone", quantity: 2, unitPriceMinor: 1, unitCostMinor: 0 }] }), false, OWNER_ID);
    const confirmGone = (status: string, ledger: Record<string, number>, seq: number) => [ch("order", "oGone", ORDER(status, 1, 1, ledger, { items: [{ id: "i9", productId: "pGone", nameSnapshot: "Gone", quantity: 2, unitPriceMinor: 1, unitCostMinor: 0 }] }), seq)];
    expect((await push(ownerPhone, confirmGone("confirmed", { pGone: 2 }, await seqOf("order", "oGone")))).rejected).toEqual([]);
    expect(await rowsNow("oGone")).toEqual({ pGone: 2 });
    // A deleted product (a tombstone) is skipped the same way.
    await push(ownerPhone, [{ entity: "product", id: "p1", data: PRODUCT(10), deleted: true, baseSeq: base.p1 }]);
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 5, { p1: 3 }), base.oA)]);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.deleted).toBe(true);
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.data.stockQuantity).toBe(10); // the tombstone's data is not touched
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A phone that edits a product while its own sync is in flight keeps its PRE-MERGE copy (iOS, Android and the web replace a
// local record only if it was not edited during the round) and pushes it again. The server applied the order's ledger to the
// product meanwhile: nothing may be applied twice.
describe("a pre-merge copy of the product pushed again after the server applied the ledger effect", () => {
  it("the phone's own move (ignored) and its stale quantity are not applied: the owner's field edit lands, the stock is the server's, however often it is pushed", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1)); // stock 7, list [server move]
    const preMerge = () => [ch("product", "p1", PRODUCT(7, [mv("mA", -3, "orderConfirmed", "oA", 1)], { priceMinor: 7000 }), base.p1)];
    for (let repush = 0; repush < 3; repush++) {
      expect((await push(ownerPhone, preMerge())).rejected).toEqual([]);
      const product = await productNow();
      expect(product.stockQuantity).toBe(7);
      expect(product.priceMinor).toBe(7000);
      expect((await moveIds()).filter((id) => id === "ma")).toEqual([]);
      expect(product.stockMoves).toHaveLength(1);
    }
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
  });

  it("with another device's change in between (a manual +5), and after the order was cancelled meanwhile: the stale quantity never wins", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    await push(productsPhone, [ch("product", "p1", PRODUCT(12, [{ id: "r1", delta: 5, reason: "received", orderId: null, note: null, at: T(2) }, ...(await productNow()).stockMoves]), await seqOf("product", "p1"))]);
    expect(await stockNow()).toBe(12);
    const preMerge = () => [ch("product", "p1", PRODUCT(7, [mv("mA", -3, "orderConfirmed", "oA", 1)], { lowStockThreshold: 9 }), base.p1)];
    await push(ownerPhone, preMerge());
    expect(await stockNow()).toBe(12);
    expect((await productNow()).lowStockThreshold).toBe(9);
    // The order is cancelled by another device; the phone's pre-merge copy (stock 7, its move for the confirm) is pushed once more.
    await push(preparePhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), await seqOf("order", "oA"))]);
    expect(await stockNow()).toBe(15);
    await push(ownerPhone, preMerge());
    await push(preparePhone, preMerge());
    expect(await stockNow()).toBe(15);
  });

  it("the whole pre-merge batch pushed again (order and product), from a prepare-only phone: no stock effect at all", async () => {
    await push(preparePhone, confirmBatch("mA", "oA", 3, 1));
    for (let repush = 0; repush < 2; repush++) {
      await push(preparePhone, confirmBatch("mA", "oA", 3, 1));
      expect(await stockNow()).toBe(7);
      expect(await moveIds()).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The integrity review's ledger rules (R3, 3 Oct 2026) and the second review's L1/L3, now with the server turning the
// ledger into stock: staff who only prepare orders confirm and cancel them, and the stock follows what the ledger says.
describe("R3 + L1 + L3 / the order ledger through a real push, and the stock that follows it", () => {
  const statusEntry = (id: string, from: string, to: string) => ({ id, field: "status", oldValue: from, newValue: to, note: null, at: T(1) });

  it("prepare only: confirming stores the status and the ledger and takes the stock; cancelling writes {} and gives exactly that back (the phone needs to push no product)", async () => {
    const confirmed = ORDER("confirmed", 3, 1, { p1: 3 }, { changes: [statusEntry("h1", "newOrder", "confirmed")] });
    expect(await push(preparePhone, [ch("order", "oA", confirmed, base.oA)])).toEqual({ conflicts: [], rejected: [] });
    expect(await orderNow("oA")).toEqual(confirmed);
    expect(await stockNow()).toBe(7);

    const cancelled = { ...confirmed, status: "cancelled", stockDeducted: {}, changes: [...confirmed.changes, statusEntry("h2", "confirmed", "cancelled")], updatedAt: T(2) };
    expect((await push(preparePhone, [ch("order", "oA", cancelled, await seqOf("order", "oA"))])).rejected).toEqual([]);
    expect(await orderNow("oA")).toEqual(cancelled);
    expect(await stockNow()).toBe(10);
  });

  it("L1 acceptance: stored {p1: 3}, a prepare-only 'ready' push without the key leaves it, and a later cancel can give back exactly 3", async () => {
    await push(preparePhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    const { stockDeducted: _unknown, ...withoutLedger } = ORDER("ready", 3, 2, { p1: 3 });
    void _unknown;
    // An older app (or a stale copy) moves the order on: it does not know the ledger and sends none.
    expect((await push(preparePhone, [ch("order", "oA", withoutLedger, await seqOf("order", "oA"))])).rejected).toEqual([]);
    expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
    expect(await stockNow()).toBe(7);
    await push(preparePhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), await seqOf("order", "oA"))]);
    expect(await stockNow()).toBe(10);
  });

  it("L1: a whole-order push (owner, orders staff) that leaves the key out keeps the stored ledger and the stock; an explicit {} clears it and gives back", async () => {
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    for (const phone of [ownerPhone, ordersPhone]) {
      const edit = { ...ORDER("confirmed", 3, 2), notes: `Edited by ${phone.name}` };
      expect((await push(phone, [ch("order", "oA", edit, await seqOf("order", "oA"))])).rejected).toEqual([]);
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
      expect(await stockNow()).toBe(7);
    }
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 3, {}), await seqOf("order", "oA"))]);
    expect((await orderNow("oA")).stockDeducted).toEqual({});
    expect(await stockNow()).toBe(10); // the order now says it takes nothing: the 3 are given back
  });

  it("L3 acceptance: {p1: 3} to an unrelated 1,000,000 by prepare-only staff leaves {p1: 3} and the stock; the rest of the push is still handled", async () => {
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    const forged = ORDER("confirmed", 3, 1, { unrelated: 1_000_000 });
    expect((await push(preparePhone, [ch("order", "oA", forged, await seqOf("order", "oA"))])).rejected).toEqual([]);
    expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    expect(await stockNow()).toBe(7);
    // The status moves on in the same push: that is handled as today, the forged ledger is not.
    const ready = { ...forged, status: "ready", updatedAt: T(2) };
    await push(preparePhone, [ch("order", "oA", ready, await seqOf("order", "oA"))]);
    expect(await orderNow("oA")).toMatchObject({ status: "ready", stockDeducted: { p1: 3 } });
    expect(await stockNow()).toBe(7);
  });

  it("L3: an inflated ledger on a confirm is ignored (the order is then without one: nothing is taken); a ledger that fits is taken", async () => {
    await push(preparePhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 1_000_000 }), base.oA)]);
    expect((await orderNow("oA")).status).toBe("confirmed");
    expect("stockDeducted" in (await orderNow("oA"))).toBe(false);
    expect(await stockNow()).toBe(10);
    expect(await rowsNow("oA")).toEqual({});
    // A legacy order (no ledger) staying deducted may get the ledger the phone derived, when it fits its lines.
    await push(preparePhone, [ch("order", "oA", ORDER("ready", 3, 2, { p1: 3 }), await seqOf("order", "oA"))]);
    expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
    expect(await stockNow()).toBe(7); // an order from nowhere with no stock move on the product: the ledger is believed
  });

  it("the owner's or orders staff's ledger must fit the order they push (F1): above its lines it is ignored, the stored ledger stays", async () => {
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    for (const phone of [ownerPhone, ordersPhone]) {
      await push(phone, [ch("order", "oA", ORDER("confirmed", 3, 2, { p1: 1_000_000 }), await seqOf("order", "oA"))]);
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
      await push(phone, [ch("order", "oA", ORDER("confirmed", 3, 2, { unrelated: 4 }), await seqOf("order", "oA"))]);
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
      expect(await stockNow()).toBe(7);
    }
  });

  it("restore after tracking was switched off still works: the order took 3, the product no longer tracks, the cancel gives them back", async () => {
    await push(preparePhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    // The owner switches the product's tracking off (stock stays 7), then someone cancels the order.
    await push(ownerPhone, [ch("product", "p1", { ...(await productNow()), trackStock: false }, await seqOf("product", "p1"))]);
    expect((await productNow()).stockQuantity).toBe(7);
    await push(preparePhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), await seqOf("order", "oA"))]);
    expect(await stockNow()).toBe(10);
  });

  it("money only: cannot rewrite the ledger; its payment lands and the ledger and the stock stay as stored", async () => {
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)]);
    const payment = { id: "pay1", amountMinor: 19500, method: "cash", note: null, paidAt: T(2) };
    const forged = { ...ORDER("confirmed", 3, 2, { p1: 1_000_000 }), payments: [payment], paymentStatus: "paid" };
    const moneyPhone = { name: "money staff", member: staff({ money: true }), by: STAFF_ID };
    expect((await push(moneyPhone, [ch("order", "oA", forged, await seqOf("order", "oA"))])).rejected).toEqual([]);
    expect(await orderNow("oA")).toMatchObject({ stockDeducted: { p1: 3 }, payments: [payment], paymentStatus: "paid" });
    expect(await stockNow()).toBe(7);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The second review's L2 acceptance cases (different orders on stale devices, retries, order first and product later, an
// owner's stale edit), now through the server-owned stock.
describe("L2 / different orders on stale devices, retries, order before product, an owner's stale edit", () => {
  const a = mv("a", -3, "orderConfirmed", "oA", 1);
  const b = mv("b", -2, "orderConfirmed", "oB", 2);
  const aBatch = () => [ch("product", "p1", PRODUCT(7, [a], { updatedAt: T(1) }), base.p1), ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)];
  const bBatch = () => [ch("product", "p1", PRODUCT(8, [b], { updatedAt: T(2) }), base.p1), ch("order", "oB", ORDER("confirmed", 2, 2, { p1: 2 }), base.oB)];

  for (const [phoneA, phoneB] of PAIRS) {
    it(`acceptance 1 (${phoneA.name} + ${phoneB.name}): A confirms 3, stale B confirms 2: stock 5, both ledgers true; cancelling B gives 7, cancelling A too gives 10`, async () => {
      await push(phoneA, aBatch());
      expect(await stockNow()).toBe(7);
      const cursor = (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).cursor;
      const result = await push(phoneB, bBatch());
      expect(result.rejected).toEqual([]); // B's product is not refused for being stale
      expect(await stockNow()).toBe(5);
      expect((await orderNow("oA")).stockDeducted).toEqual({ p1: 3 });
      expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
      expect(await rowsNow("oA")).toEqual({ p1: 3 });
      expect(await rowsNow("oB")).toEqual({ p1: 2 });
      // The merged copy comes back to B on its pull (a fresh seq), so B ends with the server's 5, not its own 8.
      const pulledProduct = (await pullForMember(sql, SHOP_ID, phoneB.member, cursor)).changes.find((c) => c.entity === "product")!;
      expect(pulledProduct.data.stockQuantity).toBe(5);
      expect(pulledProduct.seq).toBe(await seqOf("product", "p1"));

      await push(phoneB, [ch("order", "oB", ORDER("cancelled", 2, 3, {}), await seqOf("order", "oB")), ch("product", "p1", PRODUCT(10, [mv("cb", 2, "orderCancelled", "oB", 3)]), await seqOf("product", "p1"))]);
      expect(await stockNow()).toBe(7);
      // A cancels oA from its own stale copy (7 with only move a): the server gives back what it took for oA: 7 + 3 = 10.
      await push(phoneA, [ch("order", "oA", ORDER("cancelled", 3, 4, {}), await seqOf("order", "oA")), ch("product", "p1", PRODUCT(10, [mv("ca", 3, "orderCancelled", "oA", 4), a], { updatedAt: T(4) }), base.p1)]);
      expect(await stockNow()).toBe(10);
      expect(await rowsNow("oA")).toEqual({ p1: 0 });
      expect(await rowsNow("oB")).toEqual({ p1: 0 });
    });
  }

  it("acceptance 1, the other way round: B's push lands first, A's stale push lands the same way", async () => {
    await push(ownerPhone, bBatch());
    expect(await stockNow()).toBe(8);
    await push(preparePhone, aBatch());
    expect(await stockNow()).toBe(5);
  });

  for (const phone of [ownerPhone, preparePhone]) {
    it(`acceptance 2 (${phone.name}): B retries the same pushes twice, and A retries too: nothing is applied twice`, async () => {
      await push(ownerPhone, aBatch());
      await push(phone, bBatch());
      expect(await stockNow()).toBe(5);
      for (let retry = 0; retry < 2; retry++) {
        const again = await push(phone, bBatch());
        expect(again.rejected).toEqual([]);
        await push(ownerPhone, aBatch());
        expect(await stockNow()).toBe(5);
        expect(await moveIds()).toHaveLength(2); // the server's two moves
        expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
      }
    });

    it(`acceptance 3 (${phone.name}): B's order lands first and its product push later, or again after a retry: the stock ends the same`, async () => {
      expect((await push(phone, [bBatch()[1]!])).rejected).toEqual([]); // the order alone (its ledger takes the stock)
      expect(await stockNow()).toBe(8);
      await push(ownerPhone, aBatch());
      expect(await stockNow()).toBe(5);
      expect((await push(phone, [bBatch()[0]!])).rejected).toEqual([]); // its product push, later
      expect(await stockNow()).toBe(5);
      expect((await push(phone, [bBatch()[0]!])).rejected).toEqual([]); // ...and again after a retry, the batch in the opposite order
      expect((await push(phone, [bBatch()[1]!])).rejected).toEqual([]);
      expect(await stockNow()).toBe(5);
      expect((await orderNow("oB")).stockDeducted).toEqual({ p1: 2 });
    });
  }

  it("acceptance 5: an owner's stale rename and price edit from an old copy keeps the other device's stock move; staff with products get the same merge", async () => {
    await push(preparePhone, aBatch()); // stock 7
    const staleEdit = PRODUCT(10, [], { nameAr: "كيك الشوكولاتة", priceMinor: 7000, updatedAt: T(5) });
    const result = await push(ownerPhone, [ch("product", "p1", staleEdit, base.p1)]);
    expect(result.rejected).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(await productNow()).toMatchObject({ nameAr: "كيك الشوكولاتة", priceMinor: 7000, stockQuantity: 7 });
    expect(await moveIds()).toHaveLength(1);
    await push(productsPhone, [ch("product", "p1", PRODUCT(10, [], { lowStockThreshold: 9, updatedAt: T(6) }), base.p1)]);
    expect(await productNow()).toMatchObject({ lowStockThreshold: 9, stockQuantity: 7 });
  });

  it("an up-to-date copy is stored as sent: a manual correction and an edit land as before; staff without products are refused a manual move with the server's copy", async () => {
    await push(ownerPhone, aBatch());
    const seen = await seqOf("product", "p1");
    const correction = { id: "k1", delta: 5, reason: "correction", orderId: null, note: null, at: T(6) };
    const edited = { ...(await productNow()), priceMinor: 7000, stockQuantity: 12, stockMoves: [correction, ...(await productNow()).stockMoves], updatedAt: T(6) };
    expect((await push(ownerPhone, [ch("product", "p1", edited, seen)])).conflicts).toEqual([]);
    expect(await productNow()).toMatchObject({ priceMinor: 7000, stockQuantity: 12 });
    const manual = { ...edited, stockQuantity: 100, stockMoves: [{ ...correction, id: "k2", delta: 88 }, ...edited.stockMoves] };
    const refused = await push(preparePhone, [ch("product", "p1", manual, await seqOf("product", "p1"))]);
    expect(refused.rejected).toEqual([{ entity: "product", id: "p1", reason: "forbidden", record: expect.objectContaining({ data: expect.objectContaining({ stockQuantity: 12 }) }) }]);
    expect(await stockNow()).toBe(12);
  });

  it("conflicting product pushes written between a push's read and its write are merged onto, not overwritten", async () => {
    // B's product push reads the product; A's whole push lands; B's compare-and-swap fails and B is decided again on A's copy.
    const aLands = async () => expect((await push(ownerPhone, aBatch())).rejected).toEqual([]);
    const result = await pushChanges(racingOn(ONE_RECORD_READ, aLands), SHOP_ID, preparePhone.member, [ch("product", "p1", PRODUCT(8, [b]), base.p1)], STAFF_ID, { now: serverNow });
    expect(result.rejected).toEqual([]);
    expect(result.conflicts).toEqual([{ entity: "product", id: "p1", seq: expect.any(Number) }]);
    // A's order is ledger-backed (stock 7 by the server); B's move names oB, which has no ledger: valid within its 2 units.
    expect(await stockNow()).toBe(5);
    expect(await rowsNow("oB")).toEqual({ p1: 2 });
  });

  it("gives up with an error, writing nothing stale, when the record changes under every attempt", async () => {
    let n = 0;
    const keepsEditing = async () => {
      n += 1;
      await push(ownerPhone, [ch("product", "p1", { ...(await productNow()), lowStockThreshold: 20 + n }, await seqOf("product", "p1"))]);
    };
    await expect(pushChanges(racingOn(ONE_RECORD_READ, keepsEditing, 100), SHOP_ID, preparePhone.member, [ch("product", "p1", PRODUCT(8, [b]), base.p1)], STAFF_ID, { now: serverNow })).rejects.toThrow(/kept changing/);
    expect(await stockNow()).toBe(10);
    expect(await opsNow("id:b")).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fourth review (3 Oct 2026), R1, server side: the phones apply a pull in seq order, and an installed Android app keeps a null
// link for an order line whose product it has not got yet (a fresh join or a reinstall pulls everything). So the products an
// order moved are given their seqs BEFORE the order: inside the atomic write (sync_apply), and, for the phone that pushes the
// product in the same batch (it is written after the order so its move is judged against it), by writing the order's seq again
// once the batch is done. Conflicts and everything else keep their meaning. The Android fix (links kept and resolved later) is
// the real one; this only stops the new server from making the unlucky order routine.
describe("R1 / a pull delivers the product an order moved before the order", () => {
  const RETOUCH = /update orderat\.records\s+set seq = nextval[\s\S]*and seq = \$4/;
  const kinds = async (cursor: number, member: Member = ownerPhone.member) => (await pullForMember(sql, SHOP_ID, member, cursor)).changes.map((c) => `${c.entity}/${c.id}`);
  const cursorNow = async () => (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).cursor;
  /** Counts the statements that give a record a fresh seq without writing it (the order written again after its products). */
  function counting(onRetouch?: () => Promise<unknown>): { client: SqlClient; retouches: () => number } {
    let n = 0;
    return {
      client: {
        async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
          if (RETOUCH.test(text)) {
            n += 1;
            if (onRetouch) await onRetouch();
          }
          return sql.query<T>(text, params);
        },
      },
      retouches: () => n,
    };
  }

  it("an order pushed alone (a phone that pushes no product): the order's own atomic write moves the product first", async () => {
    const cursor = await cursorNow();
    expect(await push(preparePhone, [ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA)])).toEqual({ conflicts: [], rejected: [] });
    expect(await stockNow()).toBe(7);
    expect(await kinds(cursor)).toEqual(["product/p1", "order/oA"]);
    expect(await seqOf("product", "p1")).toBeLessThan(await seqOf("order", "oA"));
  });

  for (const phone of [ownerPhone, ordersPhone, preparePhone]) {
    it(`${phone.name}: the confirm batch a phone really pushes (its product, then the order) pulls the product first, to every device and on a fresh pull`, async () => {
      const cursor = await cursorNow();
      expect(await push(phone, confirmBatch("mA", "oA", 3, 1))).toEqual({ conflicts: [], rejected: [] }); // no conflict with itself
      expect(await stockNow()).toBe(7);
      for (const member of [ownerPhone.member, preparePhone.member, ordersPhone.member]) {
        expect(await kinds(cursor, member)).toEqual(["product/p1", "order/oA"]);
      }
      const all = await kinds(0);
      expect(all.indexOf("product/p1")).toBeLessThan(all.indexOf("order/oA")); // a reinstall pulls the product first
      // The phone that pushed it applies the pull and carries on: its next push of the order is based on the seq it pulled.
      const pulledOrder = (await pullForMember(sql, SHOP_ID, phone.member, cursor)).changes.find((c) => c.entity === "order")!;
      expect(pulledOrder.seq).toBe(await seqOf("order", "oA"));
      const next = await push(phone, [ch("order", "oA", ORDER("confirmed", 3, 5, { p1: 3 }, { notes: "later" }), pulledOrder.seq)]);
      expect(next).toEqual({ conflicts: [], rejected: [] });
    });
  }

  it("a second phone's confirm of the same order (no stock to move: its product push only rewrites the product): still the product first", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    const cursor = await cursorNow();
    const second = await push(preparePhone, confirmBatch("mB", "oA", 3, 2));
    expect(second.conflicts.map((c) => `${c.entity}/${c.id}`).sort()).toEqual(["order/oA", "product/p1"]); // stale copies: reported as before
    expect(await stockNow()).toBe(7);
    expect(await kinds(cursor)).toEqual(["product/p1", "order/oA"]);
  });

  it("a released phone's batch (no ledger: its move is applied by the product push): the product first as well", async () => {
    const cursor = await cursorNow();
    await push(ownerPhone, [ch("product", "p1", PRODUCT(7, [mv("m1", -3, "orderConfirmed", "oA", 1)]), base.p1), ch("order", "oA", ORDER("confirmed", 3, 1), base.oA)]);
    expect(await stockNow()).toBe(7);
    expect(await kinds(cursor)).toEqual(["product/p1", "order/oA"]);
  });

  it("two orders on one product in one batch: both come after the product, in the batch's order", async () => {
    const cursor = await cursorNow();
    await push(ownerPhone, [
      ch("product", "p1", PRODUCT(5, [mv("mB", -2, "orderConfirmed", "oB", 2), mv("mA", -3, "orderConfirmed", "oA", 1)]), base.p1),
      ch("order", "oA", ORDER("confirmed", 3, 1, { p1: 3 }), base.oA),
      ch("order", "oB", ORDER("confirmed", 2, 2, { p1: 2 }), base.oB),
    ]);
    expect(await stockNow()).toBe(5);
    expect(await kinds(cursor)).toEqual(["product/p1", "order/oA", "order/oB"]);
  });

  it("a cancel, and an item edit while confirmed, behave the same way", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    for (const [units, minute] of [[5, 2], [0, 3]] as const) {
      const cursor = await cursorNow();
      const status = units === 0 ? "cancelled" : "confirmed";
      const ledger: Record<string, number> = units === 0 ? {} : { p1: units };
      await push(preparePhone, [
        ch("product", "p1", PRODUCT(10 - units, [mv(`e${minute}`, units === 0 ? 3 : -2, units === 0 ? "orderCancelled" : "orderEdited", "oA", minute)]), await seqOf("product", "p1")),
        ch("order", "oA", ORDER(status, Math.max(units, 3), minute, ledger), await seqOf("order", "oA")),
      ]);
      expect(await kinds(cursor)).toEqual(["product/p1", "order/oA"]);
    }
    expect(await stockNow()).toBe(10);
  });

  it("customers and new products keep their place before the orders, and an existing product named by the order comes before it too", async () => {
    const cursor = await cursorNow();
    await push(ownerPhone, [
      ch("product", "p1", PRODUCT(7, [mv("m1", -3, "orderConfirmed", "oC", 1)]), base.p1),
      { entity: "product", id: "pNew", data: PRODUCT(4), deleted: false, baseSeq: 0 },
      { entity: "customer", id: "cNew", data: { name: "Noora", phone: "+97333000001" }, deleted: false, baseSeq: 0 },
      ch("order", "oC", ORDER("confirmed", 3, 1, undefined, { customerId: "cNew" }), 0),
    ]);
    expect(await kinds(cursor)).toEqual(["product/pNew", "customer/cNew", "product/p1", "order/oC"]);
  });

  it("an order whose products were all written before it needs nothing: a first upload writes no extra seq", async () => {
    const { client, retouches } = counting();
    await pushChanges(client, SHOP_ID, ownerPhone.member, [
      { entity: "customer", id: "c9", data: { name: "x" }, deleted: false, baseSeq: 0 },
      { entity: "product", id: "p9", data: PRODUCT(5), deleted: false, baseSeq: 0 },
      { entity: "order", id: "o9", data: { ...ORDER("newOrder", 1, 0), items: [{ id: "i1", productId: "p9", nameSnapshot: "Cake", quantity: 1, unitPriceMinor: 6500, unitCostMinor: 2500 }] }, deleted: false, baseSeq: 0 },
    ], OWNER_ID, { now: serverNow });
    expect(retouches()).toBe(0);
    const all = await kinds(0);
    expect(all.indexOf("product/p9")).toBeLessThan(all.indexOf("order/o9"));
    // An order with no product lines, or lines with no product, has nothing to be after.
    const none = counting();
    await pushChanges(none.client, SHOP_ID, ownerPhone.member, [{ entity: "order", id: "o10", data: { ...ORDER("newOrder", 1, 0), items: [{ id: "i1", productId: null, nameSnapshot: "Custom", quantity: 1, unitPriceMinor: 100, unitCostMinor: 0 }] }, deleted: false, baseSeq: 0 }], OWNER_ID, { now: serverNow });
    expect(none.retouches()).toBe(0);
  });

  it("the seq is the only thing written again: the order's data, updated_by and updated_at stay as the push wrote them", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    const [row] = await sql.query<{ updated_by: string; updated_at: Date; data: Record<string, unknown> }>(`select updated_by, updated_at, data from orderat.records where shop_id = $1 and entity = 'order' and id = 'oA'`, [SHOP_ID]);
    expect(row!.updated_by).toBe(OWNER_ID);
    expect(row!.data).toMatchObject({ status: "confirmed", stockDeducted: { p1: 3 } });
    const pulled = (await pullForMember(sql, SHOP_ID, ownerPhone.member, 0)).changes.find((c) => c.entity === "order" && c.id === "oA")!;
    expect(new Date(pulled.updatedAt).getTime()).toBe(row!.updated_at.getTime());
  });

  it("another phone's write to the order that lands just before the order is written again is never overwritten: the seq is only moved while the order is as this push left it", async () => {
    const other = async () => {
      expect((await push(ordersPhone, [ch("order", "oA", ORDER("confirmed", 3, 9, { p1: 3 }, { notes: "another phone" }), await seqOf("order", "oA"))])).rejected).toEqual([]);
    };
    const { client, retouches } = counting(other);
    await pushChanges(client, SHOP_ID, ownerPhone.member, confirmBatch("mA", "oA", 3, 1), OWNER_ID, { now: serverNow });
    expect(retouches()).toBe(1);
    expect(await orderNow("oA")).toMatchObject({ notes: "another phone", stockDeducted: { p1: 3 } }); // its write stands
    expect(await stockNow()).toBe(7);
    // That write carried no product, but it is after the product anyway: a pull still lists the product first.
    const all = await kinds(0);
    expect(all.indexOf("product/p1")).toBeLessThan(all.indexOf("order/oA"));
  });

  it("the stock and the ledgers are what they were: two devices, retries and a cancel (F1 acceptance) end where they did", async () => {
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    await push(preparePhone, confirmBatch("mB", "oA", 3, 2));
    await push(ownerPhone, confirmBatch("mA", "oA", 3, 1));
    expect(await stockNow()).toBe(7);
    expect(await rowsNow("oA")).toEqual({ p1: 3 });
    await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, 3, {}), await seqOf("order", "oA")), ch("product", "p1", PRODUCT(10, [mv("cA", 3, "orderCancelled", "oA", 3)]), await seqOf("product", "p1"))]);
    expect(await stockNow()).toBe(10);
    expect((await orderNow("oA")).stockDeducted).toEqual({});
    expect(await moveIds()).toHaveLength(2);
  });
});
