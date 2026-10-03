// A product's stock is the result of its stock moves, and each move is applied exactly once (second
// review, 3 Oct 2026, L2; docs/sme-phase-2-cloud.md "Stock with several phones").
//
// The apps move stock locally and push the product: its `stockQuantity` and its `stockMoves` (newest first,
// the last 50). Two phones that hold the same copy (stock 10) can each confirm an order from it: A pushes 7
// with move a, B pushes 8 with move b. Last-writer-wins on the quantity would lose a (or, for staff, refuse
// b), while both orders and their ledgers are stored. So a product push is merged on the server against the
// copy it finds stored, inside the compare-and-swap write (server/sync/push-pull.ts):
//   - the incoming copy is *stale for stock* when the stored copy has moves it lacks;
//   - then the stored quantity and the stored moves are the start, and only the moves the incoming copy has
//     and the stored one lacks are applied (their deltas), once: the merged quantity and the merged list
//     (those moves first, then the stored ones, capped at 50) are stored. A retry or a repeated push finds
//     its moves already stored and applies nothing;
//   - a copy that already has every stored move is up to date for stock and is stored as sent, as before.
// A move is identified by its id (every app creates it once and re-sends it on every push: iOS an uppercase
// UUID, Android and the web a lowercase one, so ids are compared without case). A move with no id (a legacy
// Android row) is identified by its fields.
//
// Trimmed histories. A list holds at most 50 moves, so a move missing from a *full* list may only have been
// trimmed off its old end. Then the missing move counts only when it is newer than the oldest move of that
// list (by its `at`): it would still be in the window if the list had it. A move missing from a list that is
// not full cannot have been trimmed, so it always counts. Known limits: a move older than the other copy's
// window is never applied (it was trimmed, not new), and clocks that differ by more than the span of 50 moves
// can misjudge a move; both under-count rather than apply a move twice.

import { isPlainObject, sameJson } from "./json-equal.ts";
import { hasPermission, type Member } from "./permissions.ts";

/** The phones keep the last 50 stock moves (docs/sme-phase-2-cloud.md's product row). */
export const MAX_STOCK_MOVES = 50;
/** The phones' order-driven stock reasons (iOS and Android StockMoveReason; the web's live-core). The manual
 * ones (received, damaged, correction) stay with the `products` permission. */
const ORDER_STOCK_REASONS = new Set(["orderConfirmed", "orderCancelled", "orderEdited"]);

type Json = Record<string, unknown>;

function quantityOf(data: Json): number {
  const v = data.stockQuantity ?? data.qty;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function movesOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

/** What identifies a move: its id without case, or, with no id, its own fields. */
function moveKey(move: Json): string {
  if (typeof move.id === "string" && move.id.length > 0) return `id:${move.id.toLowerCase()}`;
  return `f:${JSON.stringify([move.at ?? null, move.delta ?? null, move.reason ?? null, move.orderId ?? null])}`;
}

function timeOf(move: Json): number {
  return typeof move.at === "string" ? Date.parse(move.at) : NaN;
}

/** The moves of `from` that `other` lacks and should have had (see "Trimmed histories" above), once each. */
function unseen(from: Json[], other: Json[]): Json[] {
  const otherKeys = new Set(other.map(moveKey));
  const seen = new Set<string>();
  const missing = from.filter((m) => {
    const key = moveKey(m);
    if (otherKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (missing.length === 0 || other.length < MAX_STOCK_MOVES) return missing;
  // `other` is full: what it lacks counts only when it is newer than its oldest move (strictly: a move with
  // the same time as that oldest one, or with no readable time, may well have been trimmed, and applying a
  // trimmed move again is worse than missing one).
  const oldest = timeOf(other[other.length - 1]!);
  return missing.filter((m) => timeOf(m) > oldest);
}

/** Stale detection: whether a stored move is missing from the incoming copy. Unlike `unseen`, equal times and
 * unreadable times count as missing here: a rebase of an up-to-date copy changes nothing, while mistaking a
 * stale copy for an up-to-date one overwrites a move. */
function storedMovesMissingFrom(stored: Json[], incoming: Json[]): boolean {
  const incomingKeys = new Set(incoming.map(moveKey));
  const missing = stored.filter((m) => !incomingKeys.has(moveKey(m)));
  if (missing.length === 0) return false;
  if (incoming.length < MAX_STOCK_MOVES) return true;
  const oldest = timeOf(incoming[incoming.length - 1]!);
  return missing.some((m) => !(timeOf(m) < oldest));
}

/** Whether a staff member without `products` may add this move: an order-driven one, with an id, a whole
 * non-zero delta and the order's id (the same bar as before the merge existed). */
function isOrderDrivenMove(m: Json): boolean {
  return (
    typeof m.id === "string" && m.id.length > 0 &&
    typeof m.delta === "number" && Number.isInteger(m.delta) && m.delta !== 0 &&
    typeof m.reason === "string" && ORDER_STOCK_REASONS.has(m.reason) &&
    typeof m.orderId === "string" && m.orderId.length > 0
  );
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

/**
 * The product data to store for a push of `incoming` onto the stored product `stored` (both live), or
 * undefined when the push is refused (a member without `products` adding anything but order-driven moves).
 *
 * `mayEditProduct` (the owner, staff with `products`): fields other than the stock come from the incoming
 * copy, and an incoming copy that is up to date for stock is stored exactly as sent. Everyone else (staff with
 * `orders` or `prepare`) never writes the other fields and never the quantity directly: the result is always
 * the stored copy plus the order-driven moves of the incoming one that it lacks.
 */
export function mergeProductStock(stored: Json, incoming: Json, mayEditProduct: boolean): Json | undefined {
  if (mayEditProduct && !Array.isArray(incoming.stockMoves)) return incoming; // No history sent: stored as sent, as before.

  const storedMoves = movesOf(stored.stockMoves);
  const incomingMoves = movesOf(incoming.stockMoves);
  if (!mayEditProduct && incomingMoves.length > MAX_STOCK_MOVES) return undefined;

  if (mayEditProduct && !storedMovesMissingFrom(storedMoves, incomingMoves)) return incoming;

  const added = unseen(incomingMoves, storedMoves);
  if (!mayEditProduct) {
    if (!added.every(isOrderDrivenMove)) return undefined;
    // Without a new order move there is nothing for these staff to store: a push that also differs from the
    // stored product beyond its stock is refused, as before; a stale copy pushed again changes nothing.
    if (added.length === 0) return onlyStockDiffers(stored, incoming) ? stored : undefined;
  }

  const delta = added.reduce((sum, m) => sum + (typeof m.delta === "number" && Number.isFinite(m.delta) ? m.delta : 0), 0);
  const quantity = quantityOf(stored) + delta;
  const merged: Json = { ...(mayEditProduct ? incoming : stored) };
  merged.stockMoves = [...added, ...storedMoves].slice(0, MAX_STOCK_MOVES);
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
