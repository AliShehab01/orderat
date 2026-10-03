// The server owns the stock of an order that has a ledger (third review, 3 Oct 2026, F1-F3;
// docs/sme-phase-2-cloud.md "Stock with several phones"). The phones record what an order took out of stock in
// its ledger `stockDeducted` { productId: units } and also move the product's stock themselves. Two devices that
// do the same transition (confirm, cancel, an edit) from the same copy used to add both of their stock moves,
// and a first-time offline move older than the product's 50-entry history was dropped while the order's ledger
// was stored. So the ledger is the truth and the server turns it into stock, once per accepted order version:
//
//   for every product the ledger or the order's applied allocation (order_stock) names,
//   delta = applied - ledger[product]; a non-zero delta moves the product's quantity by delta, with a move made
//   by the server, and applied becomes ledger[product].
//
// The order version and its stock effect are committed together (store.ts writeAtomic -> sync_apply). So two
// devices confirming the same order take its stock once (the second finds applied == ledger: delta 0); two
// conflicting item edits leave stock equal to the order that won; a cancel ({}) gives back exactly what was
// applied; a replay of a push changes nothing. The phones' own moves for such an order are ignored
// (stock-merge.ts planProductPush).
//
// An order that already took stock before the server kept its own books has no order_stock row. The first time
// the server accounts for such a pair it starts from what the stock really holds for it (baselineApplied): the
// order's stored ledger, checked against the product's own stored moves for that order. A ledger push that
// restates what was taken then changes nothing, and a cancel gives it back once.

import { ledgerOf, unitsByProduct, isDeductedStatus } from "./stock-ledger.ts";
import { MAX_STOCK_MOVES, movesOf, netTakenByMoves, type Json, type OrderStockWrite } from "./stock-merge.ts";

export interface StockEffect {
  productId: string;
  orderId: string;
  /** The change of the product's quantity (negative: the order takes stock). */
  delta: number;
  reason: "orderConfirmed" | "orderCancelled" | "orderEdited";
  at: string;
}

export interface OrderStockPlan {
  effects: StockEffect[];
  orderStock: OrderStockWrite[];
}

export interface OrderStockInputs {
  orderId: string;
  /** The order record about to be stored; its ledger (a valid one) is what the stock must come to. */
  ledger: Record<string, number>;
  result: Json;
  /** The order record as stored now, before this write (undefined: the order is new). */
  stored: Json | undefined;
  /** order_stock rows of this order: productId -> units applied. */
  rows: ReadonlyMap<string, number>;
  /** The stored product records read for the pairs that need a baseline: null when missing or deleted. */
  products: ReadonlyMap<string, Json | null>;
  now: string;
}

function lineProducts(items: unknown): string[] {
  return [...unitsByProduct(items).keys()];
}

/** Every product this write may have to account for: the ledger's, the allocations the server holds, the stored
 * ledger's, and the products of the lines (the stored and the incoming ones: an order from before the server's
 * books may have taken stock of a product the new ledger no longer names). */
export function productsInPlay(result: Json, stored: Json | undefined, ledger: Record<string, number>, rows: ReadonlyMap<string, number>): string[] {
  return [...new Set([
    ...Object.keys(ledger),
    ...rows.keys(),
    ...Object.keys(ledgerOf(stored) ?? {}),
    ...lineProducts(stored?.items),
    ...lineProducts(result.items),
  ])].sort();
}

/** Whether the baseline of a pair with no allocation row is known without reading the product: the stored
 * ledger says the order took none of it. */
function baselineIsZero(stored: Json | undefined, productId: string): boolean {
  const before = ledgerOf(stored);
  return before !== undefined && (before[productId] ?? 0) === 0;
}

/** The products whose stored record must be read to plan this write: those with no allocation row whose
 * baseline is not known to be zero. */
export function productsNeedingBaseline(products: string[], stored: Json | undefined, rows: ReadonlyMap<string, number>): string[] {
  return products.filter((p) => !rows.has(p) && !baselineIsZero(stored, p));
}

/**
 * What the server had already taken out of `productId`'s stock for the order, for a pair with no allocation row
 * (an order from before the table, or one the server never touched):
 *   - the order has no stored ledger (a legacy order, only the stock moves say): what the product's stored moves
 *     for this order net to;
 *   - the stored ledger names none of the product: none;
 *   - otherwise the ledger's units, checked against the moves: when the product's list is not full it holds every
 *     move the product ever had, so what the moves net to caps it (a ledger whose stock never moved took nothing);
 *     when it is full the move may have been trimmed off its end, and the ledger, written together with the move
 *     by the same phone, stands.
 * A product that is missing or deleted has nothing to account for (the effect is skipped): its stored ledger
 * units stand, which only decides the row.
 */
function baselineApplied(orderId: string, productId: string, stored: Json | undefined, product: Json | null | undefined): number {
  const before = ledgerOf(stored);
  const claimed = before ? (before[productId] ?? 0) : undefined;
  if (claimed === 0) return 0;
  if (!product) return claimed ?? 0;
  const moves = movesOf(product.stockMoves);
  const net = netTakenByMoves(moves, orderId);
  if (claimed === undefined) return net;
  return moves.length >= MAX_STOCK_MOVES ? claimed : Math.min(claimed, net);
}

function reasonFor(delta: number, status: unknown, appliedBefore: number): StockEffect["reason"] {
  if (isDeductedStatus(status)) return delta < 0 ? (appliedBefore === 0 ? "orderConfirmed" : "orderEdited") : "orderEdited";
  return delta > 0 ? "orderCancelled" : "orderConfirmed";
}

/** The stock effects and allocation rows that make the products' stock agree with `ledger`. Rows are listed for
 * every product in play (the ones not changed are only guarded), so a concurrent change of an allocation makes
 * the atomic write refuse instead of applying a delta that was worked out from a stale row. */
export function planOrderStock(input: OrderStockInputs): OrderStockPlan {
  const { orderId, ledger, rows, stored, result } = input;
  const effects: StockEffect[] = [];
  const orderStock: OrderStockWrite[] = [];
  for (const productId of productsInPlay(result, stored, ledger, rows)) {
    const row = rows.get(productId);
    const applied = row ?? baselineApplied(orderId, productId, stored, input.products.get(productId));
    const target = ledger[productId] ?? 0;
    const delta = applied - target;
    if (delta !== 0) effects.push({ productId, orderId, delta, reason: reasonFor(delta, result.status, applied), at: input.now });
    const write = row === undefined ? applied !== 0 || target !== 0 : row !== target;
    orderStock.push({ orderId, productId, expect: row ?? null, units: target, write });
  }
  return { effects, orderStock };
}
