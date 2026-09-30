// Per-entity push/pull permission rules for sync (docs/sme-phase-2-cloud.md's "Permissions"):
//   - `orders` permission: full read/write of "order" and "customer" records ("create and edit
//     orders and customers").
//   - `prepare` permission, without `orders`: may push an *existing* "order" record's `status` field
//     only — every other field is kept from the record already stored, never trusted from the
//     incoming payload ("The server copies the rest of the order from the stored record"). Cannot
//     create a brand-new order (there is nothing stored yet to copy the rest from) and cannot delete
//     one (a tombstone isn't "changing status"), and cannot touch "customer" at all.
//   - `money` permission: required to push *or* pull "expense" records; without it, expense records
//     are simply left out of a pull, and a push of one is rejected outright.
//   - `products` permission: required to push "product" records (and, by the same reasoning, a
//     synced product photo — server/sync/handler.ts's photo_upload). One exception, so stock stays
//     right when staff handle orders: staff with `orders` or `prepare` but not `products` may push an
//     *existing* product when, next to the stored copy, only its stock changed — see isOrderStockUpdate.
//   - every other entity ("shop", "occasion", "stock_move", "setting") has no permission of its own
//     in the spec, so any shop member — owner or staff, whatever their permissions — may push or pull
//     it; this file deliberately does not invent a stricter rule the spec never states.
//   - one exception: the "setting" record with id "subscription" is the owner's own subscription
//     report (docs/superpowers/specs/2026-09-29-orderat-web-design.md's "Paid check": the website opens
//     the shop only while it says the subscription is current), so only the owner may push it. Staff may
//     still pull it, and may push every other setting as before.

import { hasPermission, type Member } from "./permissions.ts";

export const ENTITIES = ["shop", "product", "customer", "order", "expense", "occasion", "stock_move", "setting"] as const;
export type Entity = (typeof ENTITIES)[number];

/** The id of the "setting" record holding the owner's subscription report. */
const SUBSCRIPTION_SETTING_ID = "subscription";

export type PushDecision =
  | { allowed: true; data: Record<string, unknown> }
  | { allowed: false; reason: "forbidden" };

/**
 * Decides whether `member` may push `incomingData` to record `id` of `entity`, and, when allowed, the
 * actual `data` to store — identical to `incomingData` for every entity except a prepare-only push of
 * an "order", where only `status` is taken from `incomingData` and everything else comes from
 * `existingData` (the record as currently stored; undefined when this would be a brand-new record).
 */
export function decidePush(
  member: Member,
  entity: Entity,
  id: string,
  incomingData: Record<string, unknown>,
  deleted: boolean,
  existingData: Record<string, unknown> | undefined,
): PushDecision {
  if (entity === "setting" && id === SUBSCRIPTION_SETTING_ID) {
    return member.role === "owner" ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "expense") {
    return hasPermission(member, "money") ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "product") {
    if (hasPermission(member, "products")) return { allowed: true, data: incomingData };
    if ((hasPermission(member, "orders") || hasPermission(member, "prepare")) && !deleted && existingData && isOrderStockUpdate(existingData, incomingData)) {
      return { allowed: true, data: incomingData };
    }
    return { allowed: false, reason: "forbidden" };
  }
  if (entity === "customer") {
    return hasPermission(member, "orders") ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "order") {
    if (hasPermission(member, "orders")) return { allowed: true, data: incomingData };
    if (hasPermission(member, "prepare")) {
      if (deleted || !existingData) return { allowed: false, reason: "forbidden" };
      if (typeof incomingData.status !== "string") return { allowed: false, reason: "forbidden" };
      return { allowed: true, data: { ...existingData, status: incomingData.status } };
    }
    return { allowed: false, reason: "forbidden" };
  }
  // shop / occasion / stock_move / setting (other than the subscription, above): no specific
  // permission gates these in the spec.
  return { allowed: true, data: incomingData };
}

// ---------- Stock updates from staff who handle orders ----------

/** The keys an order's stock update may change on a product: the quantity (canonical `stockQuantity`;
 * `qty` is the web's own name, accepted the same), the stock history and an update stamp. */
const STOCK_KEYS = new Set(["stockQuantity", "qty", "stockMoves", "updatedAt"]);
/** The phones' order-driven stock reasons (iOS and Android StockMoveReason; the web's live-core). The
 * manual ones (received, damaged, correction) stay with the `products` permission. */
const ORDER_STOCK_REASONS = new Set(["orderConfirmed", "orderCancelled", "orderEdited"]);
/** The phones keep the last 50 stock moves (docs/sme-phase-2-cloud.md's product row). */
const MAX_STOCK_MOVES = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality of JSON values, lenient only where clients legitimately differ in spelling: a missing
 * key equals null, and two ISO date strings are equal when they name the same instant. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (typeof a === "string" && typeof b === "string") {
    if (a === b) return true;
    if (ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) {
      const ta = Date.parse(a), tb = Date.parse(b);
      return Number.isFinite(ta) && ta === tb;
    }
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameJson(a[k], b[k])) return false;
    return true;
  }
  return a === b;
}

function quantityOf(data: Record<string, unknown>): number {
  const v = data.stockQuantity ?? data.qty;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * True when `incoming` differs from the stored product `existing` only by stock an order moved:
 * - no key other than stockQuantity / qty / stockMoves / updatedAt changed;
 * - every stored stock move that is still listed is unchanged, and stored moves are only dropped off
 *   the end of a full (50-move) list;
 * - every new move has an id, a whole non-zero delta, an order-driven reason and the order's id;
 * - the quantity moved by exactly the sum of the new moves' deltas.
 * Staff who confirm, cancel or edit orders on a phone or the web push exactly this; anything else
 * (a price, a name, a manual stock correction) still needs the `products` permission.
 */
export function isOrderStockUpdate(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const k of keys) if (!STOCK_KEYS.has(k) && !sameJson(existing[k], incoming[k])) return false;

  const before = Array.isArray(existing.stockMoves) ? existing.stockMoves : [];
  const after = Array.isArray(incoming.stockMoves) ? incoming.stockMoves : before;
  if (after.length > MAX_STOCK_MOVES) return false;

  const beforeById = new Map<string, unknown>();
  for (const m of before) if (isPlainObject(m) && typeof m.id === "string") beforeById.set(m.id, m);

  let added = 0;
  const kept = new Set<string>();
  for (const m of after) {
    if (!isPlainObject(m) || typeof m.id !== "string" || !m.id) return false;
    if (kept.has(m.id)) return false;
    kept.add(m.id);
    if (beforeById.has(m.id)) {
      if (!sameJson(beforeById.get(m.id), m)) return false;
      continue;
    }
    if (typeof m.delta !== "number" || !Number.isInteger(m.delta) || m.delta === 0) return false;
    if (typeof m.reason !== "string" || !ORDER_STOCK_REASONS.has(m.reason)) return false;
    if (typeof m.orderId !== "string" || !m.orderId) return false;
    added += m.delta;
  }
  const dropped = [...beforeById.keys()].filter((id) => !kept.has(id));
  if (dropped.length > 0 && after.length < MAX_STOCK_MOVES) return false;

  return quantityOf(incoming) === quantityOf(existing) + added;
}

/** Whether `member` may see `entity` at all on a pull — only "expense" is gated (money), matching
 * decidePush's own reasoning for that entity. */
export function canPull(member: Member, entity: Entity): boolean {
  return entity === "expense" ? hasPermission(member, "money") : true;
}
