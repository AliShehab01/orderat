import { describe, expect, it } from "vitest";
import { planOrderStock, productsInPlay, productsNeedingBaseline } from "./order-stock.ts";
import type { Json } from "./stock-merge.ts";

// Third review (3 Oct 2026), F1-F3: the server turns an order's ledger into stock: delta = applied - ledger[product], once per
// accepted order version. These are the pure rules; stock-push.test.ts runs them through the real push path.

const NOW = "2026-10-03T09:00:00.000Z";
const line = (productId: string | null, quantity: number) => ({ id: `i-${productId}`, productId, nameSnapshot: "x", quantity, unitPriceMinor: 100, unitCostMinor: 50 });
const order = (status: string, items: unknown[], ledger?: Record<string, number>): Json => ({ status, items, ...(ledger ? { stockDeducted: ledger } : {}) });
const confirmedP1 = (units: number, ledger: Record<string, number> = { p1: units }) => order("confirmed", [line("p1", units)], ledger);
const product = (moves: unknown[] = []): Json => ({ stockQuantity: 10, stockMoves: moves });
const move = (delta: number, orderId = "o1", reason = "orderConfirmed") => ({ id: `m${delta}${orderId}`, delta, reason, orderId, note: null, at: NOW });

function plan(over: { orderId?: string; result: Json; stored?: Json; rows?: Record<string, number>; products?: Record<string, Json | null> }) {
  const rows = new Map(Object.entries(over.rows ?? {}));
  const ledger = over.result.stockDeducted as Record<string, number>;
  return planOrderStock({ orderId: over.orderId ?? "o1", result: over.result, stored: over.stored, ledger, rows, products: new Map(Object.entries(over.products ?? {})), now: NOW });
}

describe("planOrderStock / delta = applied - ledger", () => {
  it("a first confirm takes the ledger's units (reason orderConfirmed) and records the allocation", () => {
    const result = plan({ result: confirmedP1(3), stored: order("newOrder", [line("p1", 3)]), products: { p1: product() } });
    expect(result.effects).toEqual([{ productId: "p1", orderId: "o1", delta: -3, reason: "orderConfirmed", at: NOW }]);
    expect(result.orderStock).toEqual([{ orderId: "o1", productId: "p1", expect: null, units: 3, write: true }]);
  });

  it("the same ledger again changes no stock (two devices, a replay, a notes edit): the row is only guarded", () => {
    const result = plan({ result: confirmedP1(3), stored: confirmedP1(3), rows: { p1: 3 } });
    expect(result.effects).toEqual([]);
    expect(result.orderStock).toEqual([{ orderId: "o1", productId: "p1", expect: 3, units: 3, write: false }]);
  });

  it("an edit moves the difference: up takes more (orderEdited), down gives back; the winning quantity decides, whichever came first", () => {
    const up = plan({ result: confirmedP1(5), stored: confirmedP1(3), rows: { p1: 3 } });
    expect(up.effects).toEqual([{ productId: "p1", orderId: "o1", delta: -2, reason: "orderEdited", at: NOW }]);
    const down = plan({ result: confirmedP1(4), stored: confirmedP1(5), rows: { p1: 5 } });
    expect(down.effects).toEqual([{ productId: "p1", orderId: "o1", delta: 1, reason: "orderEdited", at: NOW }]);
    expect(down.orderStock[0]).toMatchObject({ expect: 5, units: 4, write: true });
  });

  it("a cancel ({}) gives back exactly what is applied (orderCancelled) and keeps a zero row; back to new does the same", () => {
    for (const status of ["cancelled", "newOrder"]) {
      const result = plan({ result: order(status, [line("p1", 3)], {}), stored: confirmedP1(3), rows: { p1: 3 } });
      expect(result.effects).toEqual([{ productId: "p1", orderId: "o1", delta: 3, reason: "orderCancelled", at: NOW }]);
      expect(result.orderStock).toEqual([{ orderId: "o1", productId: "p1", expect: 3, units: 0, write: true }]);
    }
    // Cancelled again: applied is 0, nothing to give back.
    const again = plan({ result: order("cancelled", [line("p1", 3)], {}), stored: order("cancelled", [line("p1", 3)], {}), rows: { p1: 0 } });
    expect(again.effects).toEqual([]);
    expect(again.orderStock[0]).toMatchObject({ expect: 0, units: 0, write: false });
  });

  it("a line removed in an edit (the ledger no longer names the product) gives back what the allocation holds", () => {
    const result = plan({ result: order("confirmed", [line("p2", 1)], { p2: 1 }), stored: confirmedP1(3), rows: { p1: 3 }, products: { p2: product() } });
    expect(result.effects).toEqual([
      { productId: "p1", orderId: "o1", delta: 3, reason: "orderEdited", at: NOW },
      { productId: "p2", orderId: "o1", delta: -1, reason: "orderConfirmed", at: NOW },
    ]);
  });

  it("reasons by status: a re-confirm after a cancel is a confirm; a give-back on a deducted order is an edit; stock taken on a status that holds none is a confirm", () => {
    expect(plan({ result: confirmedP1(3), stored: order("cancelled", [line("p1", 3)], {}), rows: { p1: 0 } }).effects[0]!.reason).toBe("orderConfirmed");
    expect(plan({ result: confirmedP1(1), stored: confirmedP1(3), rows: { p1: 3 } }).effects[0]!.reason).toBe("orderEdited");
    expect(plan({ result: order("newOrder", [line("p1", 1)], { p1: 1 }), rows: { p1: 0 }, stored: undefined }).effects[0]!.reason).toBe("orderConfirmed");
  });

  it("several products: each gets its own effect, in product id order, whatever order the ledger lists them in", () => {
    const result = plan({
      result: order("confirmed", [line("pB", 2), line("pA", 1)], { pB: 2, pA: 1 }),
      stored: order("newOrder", [line("pB", 2), line("pA", 1)]),
      products: { pA: product(), pB: product() },
    });
    expect(result.effects.map((e) => `${e.productId}:${e.delta}`)).toEqual(["pA:-1", "pB:-2"]);
  });
});

describe("planOrderStock / an order from before the server kept its own books (no allocation row)", () => {
  it("a stored ledger that the product's moves confirm: restated, nothing is taken twice; cancelled, it is given back once", () => {
    const products = { p1: product([move(-3)]) };
    const stored = confirmedP1(3);
    const restated = plan({ result: confirmedP1(3), stored, products });
    expect(restated.effects).toEqual([]);
    expect(restated.orderStock).toEqual([{ orderId: "o1", productId: "p1", expect: null, units: 3, write: true }]);
    const cancelled = plan({ result: order("cancelled", [line("p1", 3)], {}), stored, products });
    expect(cancelled.effects).toEqual([{ productId: "p1", orderId: "o1", delta: 3, reason: "orderCancelled", at: NOW }]);
  });

  it("a legacy order (no stored ledger): what the product's moves for it net to is what was taken (a cancel in the list nets it out)", () => {
    const stored = order("confirmed", [line("p1", 3)]);
    const taken = plan({ result: order("cancelled", [line("p1", 3)], {}), stored, products: { p1: product([move(-3)]) } });
    expect(taken.effects).toEqual([{ productId: "p1", orderId: "o1", delta: 3, reason: "orderCancelled", at: NOW }]);
    const settled = plan({ result: order("cancelled", [line("p1", 3)], {}), stored, products: { p1: product([move(3, "o1", "orderCancelled"), move(-3)]) } });
    expect(settled.effects).toEqual([]);
    // Another order's moves do not count.
    const other = plan({ result: order("cancelled", [line("p1", 3)], {}), stored, products: { p1: product([move(-3, "o2")]) } });
    expect(other.effects).toEqual([]);
  });

  it("a stored ledger the product's complete list contradicts (no move for it) took nothing: capped by the moves", () => {
    const result = plan({ result: confirmedP1(3), stored: confirmedP1(3), products: { p1: product([]) } });
    expect(result.effects).toEqual([{ productId: "p1", orderId: "o1", delta: -3, reason: "orderConfirmed", at: NOW }]);
  });

  it("... but a FULL list may have trimmed the move off its end, so the ledger written together with it stands", () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, delta: 1, reason: "received", orderId: null, note: null, at: NOW }));
    const result = plan({ result: order("cancelled", [line("p1", 3)], {}), stored: confirmedP1(3), products: { p1: product(full) } });
    expect(result.effects).toEqual([{ productId: "p1", orderId: "o1", delta: 3, reason: "orderCancelled", at: NOW }]);
  });

  it("a stored ledger that does not name the product took none of it, whatever the moves say; and needs no product read", () => {
    const stored = confirmedP1(3, { p2: 1 });
    expect(productsNeedingBaseline(["p1", "p2"], stored, new Map())).toEqual(["p2"]);
    const result = plan({ result: order("confirmed", [line("p1", 3)], { p1: 3 }), stored, products: { p1: product([move(-3)]), p2: product([move(-1)]) } });
    // p1: the ledger said none (whatever its moves say), so the ledger's 3 are taken now; p2: the ledger's 1 is confirmed by a move, and the new ledger has none.
    expect(result.effects.map((e) => `${e.productId}:${e.delta}`)).toEqual(["p1:-3", "p2:1"]);
  });

  it("a product that is missing or deleted has nothing to account for: the stored ledger's units stand, and the allocation is still set to the ledger", () => {
    const result = plan({ result: confirmedP1(3), stored: confirmedP1(3), products: { p1: null } });
    expect(result.effects).toEqual([]);
    expect(result.orderStock[0]).toMatchObject({ expect: null, units: 3, write: true });
    // Taking more of it is an effect the write skips (atomic-write.test.ts): no product, nothing to move.
    const more = plan({ result: confirmedP1(5), stored: confirmedP1(3), rows: { p1: 3 }, products: { p1: null } });
    expect(more.effects).toEqual([{ productId: "p1", orderId: "o1", delta: -2, reason: "orderEdited", at: NOW }]);
    expect(more.orderStock[0]).toMatchObject({ units: 5, write: true });
  });
});

describe("productsInPlay / productsNeedingBaseline", () => {
  it("covers the ledger, the allocations, the stored ledger and the lines of both versions, once each, sorted", () => {
    const stored = order("confirmed", [line("pStoredLine", 1), line(null, 9)], { pStoredLedger: 1 });
    const result = order("confirmed", [line("pNewLine", 1)], { pLedger: 1 });
    expect(productsInPlay(result, stored, { pLedger: 1 }, new Map([["pRow", 2]]))).toEqual(["pLedger", "pNewLine", "pRow", "pStoredLedger", "pStoredLine"]);
  });

  it("a pair with a row never needs the product; a pair without one needs it unless the stored ledger says it took none", () => {
    expect(productsNeedingBaseline(["a", "b", "c"], order("confirmed", [], { a: 1 }), new Map([["a", 1]]))).toEqual([]); // a has a row; the stored ledger says b and c took none
    expect(productsNeedingBaseline(["a", "b", "c"], order("confirmed", [], { a: 1, b: 0 }), new Map())).toEqual(["a"]);
    expect(productsNeedingBaseline(["a", "b"], undefined, new Map())).toEqual(["a", "b"]);
  });
});
