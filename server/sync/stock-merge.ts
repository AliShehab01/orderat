// What a product push does to stock (second review L2, 3 Oct 2026; third review F1-F3, same day;
// docs/sme-phase-2-cloud.md "Stock with several phones"). A product's stock is the result of its stock moves,
// and each move is applied exactly once. The phones move stock locally and push the product: its
// `stockQuantity` and its `stockMoves` (newest first, the last 50). The server never takes the pushed quantity
// for a push that carries moves: it starts from the stored quantity and applies the moves it has not applied yet.
//
// Which moves have been applied is no longer read off the 50-entry display list but off `stock_ops` (durable,
// uncapped; migration 0010), plus the moves in the product's stored list (so the list and the table agree for
// products from before the table). A move is identified by its id without case (iOS sends uppercase UUIDs, Android
// and the web lowercase); a move with no id (a legacy Android row) by its fields.
//
// For each move the push carries that the stored list lacks, oldest first (planProductPush):
//   - already in stock_ops: ignored (applied or ignored before; a retry, a stale copy, a pre-merge copy pushed
//     again after the server applied the order's ledger);
//   - manual (any reason that is not order-driven: received, damaged, correction, or no order id): applied once and
//     recorded; only the owner and `products` staff may send them (as before);
//   - order-driven (orderConfirmed / orderCancelled / orderEdited with an order id) -> the order decides:
//       * no live order with that id in this shop: not applied, and not recorded, so a retry can still land once
//         the order is there (orders in the same push are processed first, server/sync/push-pull.ts);
//       * the order has a ledger (`stockDeducted`): the SERVER owns its stock (server/sync/order-stock.ts), the
//         client's copy of the move is ignored and its id recorded: F1 (two devices doing the same transition
//         add both deltas) and F3 (a first-time offline move older than the 50-entry window) are closed there;
//       * otherwise (a released app that writes no ledger): the move must have the direction of its reason and
//         the order's applied units for this product (`order_stock`; for an order from before the table, derived
//         from the product's own stored moves for that order) must stay within 0 and the units of the product on
//         the order. Then it is applied once, `order_stock` follows, and its id is recorded. Otherwise it is not
//         applied and not recorded. This is what stops a fabricated move (F2): a nonexistent order, an order the
//         product is not on, an inflated or wrong-direction delta all fail it, and a real one can never move
//         more than the order itself holds.
// The stored quantity is never replaced by a pushed one when the push carries any move the stored copy lacks
// (applied, ignored or neither). A push with no such move (a new product's opening quantity, a manual quantity
// edit that carries no move) keeps the earlier behaviour for owner and `products` staff: stored as sent while
// its copy is up to date for stock, rebased onto the stored stock when it is stale.
//
// Moves the server applies are listed on the product (newest first, the cap of 50, with the server's own moves);
// moves it ignores or skips are not, so the display list never shows a deduction twice.
//
// A move trimmed off a stored list before this table existed is not known to it (migration 0010 and the first
// write of a product list every move that was still in a list): a stale phone that still holds such a move and
// pushes it again is the one case this cannot tell from a new move. The earlier "newer than the oldest move of a
// full list" rule dropped legitimate offline moves instead (F3), and a stock count that is too low is no safer
// than one that is too high.

import { isPlainObject, sameJson } from "./json-equal.ts";
import { hasPermission, type Member } from "./permissions.ts";

/** The phones keep the last 50 stock moves (docs/sme-phase-2-cloud.md's product row). */
export const MAX_STOCK_MOVES = 50;
/** The phones' order-driven stock reasons (iOS and Android StockMoveReason; the web's live-core). The manual
 * ones (received, damaged, correction) stay with the `products` permission. */
export const ORDER_STOCK_REASONS = new Set(["orderConfirmed", "orderCancelled", "orderEdited"]);

export type Json = Record<string, unknown>;

export function quantityOf(data: Json): number {
  const v = data.stockQuantity ?? data.qty;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function movesOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

/**
 * What identifies a move, and the `op_id` of stock_ops: `id:` and its id with the ASCII capitals folded (iOS sends uppercase
 * UUIDs, Android and the web lowercase; non-ASCII letters are left alone so no database locale can decide what a key is), or,
 * for a move with no id (a legacy Android row), `f:` and its own fields `[at, delta, reason, orderId]` as JSON, where a field
 * that is not a string or a finite number counts as null.
 *
 * Fourth review, R4: this rule is written once per language and the two must agree on every move. SQL:
 * orderat.stock_move_key (db/migrations/0010_order_stock.sql), which backfills stock_ops, lists the moves of a stored list
 * before it is trimmed (sync_apply) and keys the server's own moves; stock-ops-keys.test.ts runs both on the same fixtures.
 * Change one, change the other.
 */
export function moveKey(move: Json): string {
  if (typeof move.id === "string" && move.id.length > 0) return `id:${foldAsciiCase(move.id)}`;
  return `f:[${keyToken(move.at)},${keyToken(move.delta)},${keyToken(move.reason)},${keyToken(move.orderId)}]`;
}

const foldAsciiCase = (text: string): string => text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const keyToken = (value: unknown): string => (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? JSON.stringify(value) : "null");

/** The stock_ops key of an order and product pair in the maps below. */
export const pairKey = (orderId: string, productId: string): string => `${orderId}\u0000${productId}`;

function timeOf(move: Json): number {
  return typeof move.at === "string" ? Date.parse(move.at) : NaN;
}

/** Stale detection: whether a stored move is missing from the incoming copy. A full incoming list may only have
 * lost moves off its old end (trimmed), so then a stored move counts only when it is not older than the
 * incoming list's oldest move. Equal times and unreadable times count as missing: a rebase of an up-to-date
 * copy changes nothing, while mistaking a stale copy for an up-to-date one overwrites a move. */
function storedMovesMissingFrom(stored: Json[], incoming: Json[]): boolean {
  const incomingKeys = new Set(incoming.map(moveKey));
  const missing = stored.filter((m) => !incomingKeys.has(moveKey(m)));
  if (missing.length === 0) return false;
  if (incoming.length < MAX_STOCK_MOVES) return true;
  const oldest = timeOf(incoming[incoming.length - 1]!);
  return missing.some((m) => !(timeOf(m) < oldest));
}

/** Whether a move has the shape the staff without `products` may send: an order-driven one, with an id, a whole
 * non-zero delta and the order's id (the same bar as before the merge existed). */
export function isOrderDrivenMove(m: Json): boolean {
  return (
    typeof m.id === "string" && m.id.length > 0 &&
    typeof m.delta === "number" && Number.isInteger(m.delta) && m.delta !== 0 &&
    typeof m.reason === "string" && ORDER_STOCK_REASONS.has(m.reason) &&
    typeof m.orderId === "string" && m.orderId.length > 0
  );
}

/** Whether a move is the order-driven kind (an order reason and an order id), whatever else is wrong with it. */
function isOrderLinked(m: Json): boolean {
  return typeof m.reason === "string" && ORDER_STOCK_REASONS.has(m.reason) && typeof m.orderId === "string" && m.orderId.length > 0;
}

/** The direction each order reason moves stock: a confirm takes, a cancel gives back, an edit either way. */
function hasReasonDirection(m: Json): boolean {
  const delta = m.delta as number;
  if (m.reason === "orderConfirmed") return delta < 0;
  if (m.reason === "orderCancelled") return delta > 0;
  return delta !== 0;
}

/** The units of `orderId` the product's stored moves say were taken out of stock, net of what was given back,
 * never below zero: what an order from before the server kept its own books (order_stock) had applied. */
export function netTakenByMoves(moves: Json[], orderId: string): number {
  let net = 0;
  for (const m of moves) {
    if (typeof m.reason === "string" && ORDER_STOCK_REASONS.has(m.reason) && m.orderId === orderId && typeof m.delta === "number" && Number.isFinite(m.delta)) net += m.delta;
  }
  return Math.max(0, -net);
}

/** The keys of a product that stock moves change: the quantity (canonical `stockQuantity`; `qty` is the web's
 * own name, accepted the same), the history and the update stamp. */
const STOCK_KEYS = new Set(["stockQuantity", "qty", "stockMoves", "updatedAt"]);

/** True when `incoming` equals `stored` in every key but the stock ones. */
function onlyStockDiffers(stored: Json, incoming: Json): boolean {
  for (const key of new Set([...Object.keys(stored), ...Object.keys(incoming)])) {
    if (!STOCK_KEYS.has(key) && !sameJson(stored[key], incoming[key])) return false;
  }
  return true;
}

/** The later of two `updatedAt` stamps, so a merged copy is never stamped before either side. */
function laterStamp(a: unknown, b: unknown): unknown {
  if (typeof a !== "string") return b;
  if (typeof b !== "string") return a;
  const ta = Date.parse(a), tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb ? a : b;
}

// ---------- What the database says (read by server/sync/stock-apply.ts, handed to the plan) ----------

/** A live order a stock move names, as the server holds it. */
export interface OrderFact {
  /** The order record's seq when it was read: the write is refused if it moved (sync_apply's p_deps). */
  seq: number;
  /** The order carries a valid ledger, so the server owns its stock. */
  ledgerBacked: boolean;
  /** Units of each product on the order's lines. */
  units: ReadonlyMap<string, number>;
}

export interface StockFacts {
  /** The keys (moveKey) of the moves of the stored and the incoming lists that stock_ops already holds. */
  knownOps: ReadonlySet<string>;
  /** The live orders named by the incoming moves the stored list lacks; absent: no such live order. */
  orders: ReadonlyMap<string, OrderFact>;
  /** order_stock rows for the order and this product (pairKey); absent: no row. */
  applied: ReadonlyMap<string, number>;
}

/** No stock_ops, no orders, no order_stock: for callers that only decide who may push what. */
export const NO_FACTS: StockFacts = { knownOps: new Set(), orders: new Map(), applied: new Map() };

export interface OrderStockWrite {
  orderId: string;
  productId: string;
  /** The row as read (null: none): the write is refused if it is not that any more. */
  expect: number | null;
  units: number;
  /** False for a row that is only read (guarded), not changed. */
  write: boolean;
}

export interface ProductPlan {
  /** The product data to store. */
  data: Json;
  /** Moves of this push that were applied or ignored, to record in stock_ops (each must not be there yet). */
  ops: { opId: string; outcome: "applied" | "ignored" }[];
  /** Keys of the stored list's moves that stock_ops lacks: recorded along (never a reason to refuse). */
  listed: string[];
  orderStock: OrderStockWrite[];
  /** Orders the plan decided on: written only while each still has this seq. */
  deps: { orderId: string; seq: number }[];
}

/** The moves of `incoming` that the stored list lacks (each key once), oldest first (the lists are newest first,
 * so the order applied moves are validated in is the order they happened in). */
export function freshMoves(stored: Json, incoming: Json): Json[] {
  const storedKeys = new Set(movesOf(stored.stockMoves).map(moveKey));
  const seen = new Set<string>();
  const fresh: Json[] = [];
  for (const m of movesOf(incoming.stockMoves)) {
    const key = moveKey(m);
    if (storedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(m);
  }
  return fresh.reverse();
}

/** Whether a product's pushed list has an order-linked move naming one of `orderIds` (the orders of the same push). */
export function namesAnyOrder(product: Json, orderIds: ReadonlySet<string>): boolean {
  return movesOf(product.stockMoves).some((m) => isOrderLinked(m) && orderIds.has(m.orderId as string));
}

/** Every move key of the stored and the incoming lists: what to ask stock_ops about. */
export function listedKeys(stored: Json, incoming: Json): string[] {
  return [...new Set([...movesOf(stored.stockMoves), ...movesOf(incoming.stockMoves)].map(moveKey))];
}

/** The ids of the orders the fresh order-driven moves name: what to read to judge them. */
export function orderIdsOfFreshMoves(stored: Json, incoming: Json): string[] {
  return [...new Set(freshMoves(stored, incoming).filter(isOrderLinked).map((m) => m.orderId as string))];
}

/**
 * The product to store and the stock bookkeeping that goes with it for a push of `incoming` (product
 * `productId`) onto the stored live product `stored`, or undefined when the push is refused (a member without
 * `products` adding anything but order-driven moves, or more than 50 of them).
 *
 * `mayEditProduct` (the owner, staff with `products`): fields other than the stock come from the incoming copy.
 * Everyone else (staff with `orders` or `prepare`) never writes the other fields and never the quantity directly:
 * the result is always the stored copy plus the moves of the incoming one that pass the rules above.
 */
export function planProductPush(productId: string, stored: Json, incoming: Json, mayEditProduct: boolean, facts: StockFacts): ProductPlan | undefined {
  const storedMoves = movesOf(stored.stockMoves);
  const listed = storedMoves.map(moveKey).filter((key, i, all) => !facts.knownOps.has(key) && all.indexOf(key) === i);
  const plain = (data: Json): ProductPlan => ({ data, ops: [], listed, orderStock: [], deps: [] });

  if (mayEditProduct && !Array.isArray(incoming.stockMoves)) return plain(incoming); // No history sent: stored as sent, as before.

  const incomingMoves = movesOf(incoming.stockMoves);
  if (!mayEditProduct && incomingMoves.length > MAX_STOCK_MOVES) return undefined;

  const fresh = freshMoves(stored, incoming);
  if (!mayEditProduct && !fresh.every(isOrderDrivenMove)) return undefined;

  if (fresh.length === 0) {
    if (!mayEditProduct) {
      // Without a new move there is nothing for these staff to store: a push that also differs from the stored
      // product beyond its stock is refused, as before; a stale copy pushed again changes nothing.
      return onlyStockDiffers(stored, incoming) ? plain(stored) : undefined;
    }
    if (!storedMovesMissingFrom(storedMoves, incomingMoves)) return plain(incoming); // Up to date for stock.
    return plain(mergedProduct(stored, incoming, true, [], 0)); // Stale: the stored stock under the incoming fields.
  }

  const applied: Json[] = []; // oldest first
  const ops: ProductPlan["ops"] = [];
  const deps = new Map<string, number>();
  const state = new Map<string, number>(); // pairKey -> units applied once the moves so far are in
  const orderStock = new Map<string, OrderStockWrite>();
  let delta = 0;

  for (const move of fresh) {
    const key = moveKey(move);
    if (facts.knownOps.has(key)) continue; // Applied or ignored before.

    if (!isOrderLinked(move)) {
      // A manual move: the owner's and `products` staff's (the others were refused above, by shape).
      applied.push(move);
      ops.push({ opId: key, outcome: "applied" });
      delta += typeof move.delta === "number" && Number.isFinite(move.delta) ? move.delta : 0;
      continue;
    }

    const orderId = move.orderId as string;
    const order = facts.orders.get(orderId);
    if (!order) continue; // No live order of this shop (yet): not applied, and not recorded.
    if (order.ledgerBacked) {
      deps.set(orderId, order.seq);
      ops.push({ opId: key, outcome: "ignored" }); // The server owns this order's stock.
      continue;
    }
    if (typeof move.delta !== "number" || !Number.isInteger(move.delta) || move.delta === 0 || !hasReasonDirection(move)) continue;

    const pair = pairKey(orderId, productId);
    const before = state.get(pair) ?? facts.applied.get(pair) ?? netTakenByMoves(storedMoves, orderId);
    const after = before - move.delta;
    if (after < 0 || after > (order.units.get(productId) ?? 0)) continue; // Not what this order can have taken.

    state.set(pair, after);
    deps.set(orderId, order.seq);
    applied.push(move);
    ops.push({ opId: key, outcome: "applied" });
    delta += move.delta;
    orderStock.set(pair, { orderId, productId, expect: facts.applied.get(pair) ?? null, units: after, write: true });
  }

  return {
    data: mergedProduct(stored, incoming, mayEditProduct, applied.reverse(), delta),
    ops,
    listed,
    orderStock: [...orderStock.values()],
    deps: [...deps].map(([orderId, seq]) => ({ orderId, seq })),
  };
}

/** The merged product: the stored quantity plus `delta`, the applied moves (newest first) in front of the stored
 * list (capped), the other fields from the incoming copy for members who may edit products, from the stored one
 * otherwise. */
function mergedProduct(stored: Json, incoming: Json, mayEditProduct: boolean, appliedNewestFirst: Json[], delta: number): Json {
  const quantity = quantityOf(stored) + delta;
  const merged: Json = { ...(mayEditProduct ? incoming : stored) };
  merged.stockMoves = [...appliedNewestFirst, ...movesOf(stored.stockMoves)].slice(0, MAX_STOCK_MOVES);
  merged.stockQuantity = quantity;
  if ("qty" in merged || "qty" in stored || "qty" in incoming) merged.qty = quantity;
  const stamp = laterStamp(stored.updatedAt, incoming.updatedAt);
  if (stamp !== undefined) merged.updatedAt = stamp;
  return merged;
}

/** Whether `member` may push an *existing, live* product of this shop through the merge without `products`:
 * staff who handle orders (so stock stays right when they confirm, cancel or edit orders). */
export function mayMoveOrderStock(member: Member): boolean {
  return hasPermission(member, "orders") || hasPermission(member, "prepare");
}
