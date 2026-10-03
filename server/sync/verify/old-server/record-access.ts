// FROZEN FIXTURE (final verification, 3 Oct 2026): this file is server/sync/record-access.ts exactly as it is on origin/main (c07cc28),
// the server code deployed before the integrity rounds of 3 Oct, except that the relative imports of the other server folders
// point one level deeper. It is used only by ../migration-0010.test.ts to seed a database through the OLD code path before
// migration 0010 is applied. Do not edit it and do not import it from production code.
// Per-entity pull (read) and push (write) rules for sync, per staff permission (docs/sme-phase-2-cloud.md's
// "Permissions"; security review 1 Oct 2026, F01, docs/security-review-2026-10-01.md). Until that review
// staff pulled every record but expenses whatever their flags, and could push the shop record and any
// setting. The rules now follow what the phones' and the web's screens let each flag do (iOS Store
// canManageOrders / canChangeOrderStatus / canSeeMoney / canEditProducts, Android CloudShopService, the
// web's live-core access), and nothing more. The owner may read and write everything.
//
// Pull (canPull), for staff:
//   - every member, whatever their flags: the `shop` record and the `subscription` setting — the shop's
//     basics (name, currency, VAT, whether it is paid up), which every screen needs.
//   - any flag at all: every other setting (shop-level config such as whatsappTemplates or
//     deliveryDefaults), products and their stock moves, and occasions.
//   - `orders`, `prepare` or `money`: orders and customers — taking orders, preparing them, and the
//     money reports all need them (a phone also drops an order whose customer it does not have).
//   - `money`: expenses.
//   A record a member may not pull is simply left out of the page — never sent as a deletion, so
//   tightening a member's flags never makes a phone delete anything it holds.
//
// Push (decidePush), for staff:
//   - `shop` and every `setting`: never — the owner's alone (the `subscription` setting is the owner's
//     own report, which the website's paid check reads). No setting synced today belongs to a single
//     staff member: per-device preferences never sync.
//   - `orders`: full write of orders, customers and occasions (create, edit, delete).
//   - `prepare` (without `orders`): an *existing* order's status fields only — `status`,
//     `outForDeliveryAt`, `updatedAt`, and new `changes` entries about them. Every other field is
//     kept from the stored record, never trusted from the payload. No creating or deleting orders.
//   - `money` (without `orders`): an existing order's money fields only — `payments`, `paymentStatus`,
//     `updatedAt` and new payment history entries — and full write of expenses.
//   - `products`: full write of products and stock moves (and photo uploads, server/sync/handler.ts).
//     Staff with `orders` or `prepare` but not `products` may push an *existing* product when, next to
//     the stored copy, only its stock changed (isOrderStockUpdate) — so stock stays right when staff
//     confirm or cancel orders.
//   Everything else is refused, and comes back to the phone as a `rejected` entry (server/sync/
//   push-pull.ts), with the server's copy when the member may pull it.

import { hasPermission, type Member } from "./permissions.ts";

export const ENTITIES = ["shop", "product", "customer", "order", "expense", "occasion", "stock_move", "setting"] as const;
export type Entity = (typeof ENTITIES)[number];

/** The id of the "setting" record holding the owner's subscription report. */
const SUBSCRIPTION_SETTING_ID = "subscription";

export type PushDecision =
  | { allowed: true; data: Record<string, unknown> }
  | { allowed: false; reason: "forbidden" };

/** A record as currently stored, handed to decidePush — undefined when the push would create it. */
export interface StoredRecord {
  data: Record<string, unknown>;
  deleted: boolean;
}

const FORBIDDEN: PushDecision = { allowed: false, reason: "forbidden" };
const allow = (data: Record<string, unknown>): PushDecision => ({ allowed: true, data });

function hasAnyPermission(member: Member): boolean {
  return hasPermission(member, "orders") || hasPermission(member, "prepare") || hasPermission(member, "money") || hasPermission(member, "products");
}

// ---------- Pull ----------

/** Whether `member` may see record `id` of `entity` on a pull (and get its server copy back when a
 * push of it is refused). */
export function canPull(member: Member, entity: Entity, id: string): boolean {
  if (member.role === "owner") return true;
  switch (entity) {
    case "shop":
      return true;
    case "setting":
      return id === SUBSCRIPTION_SETTING_ID || hasAnyPermission(member);
    case "product":
    case "stock_move":
    case "occasion":
      return hasAnyPermission(member);
    case "customer":
    case "order":
      return hasPermission(member, "orders") || hasPermission(member, "prepare") || hasPermission(member, "money");
    case "expense":
      return hasPermission(member, "money");
    default:
      return false;
  }
}

/** The order records of a grant must reach a phone in: a phone drops an order whose customer it does
 * not hold yet (Android), so customers and products always come before orders — the same order the
 * phones push in. */
const REDELIVERY_ORDER: readonly Entity[] = ["shop", "setting", "product", "stock_move", "customer", "occasion", "order", "expense"];

/** A setting id other than the subscription, standing for "every other setting" below. */
const ANY_OTHER_SETTING = "";

/**
 * The entities with records `after` may pull and `before` could not — what a permission grant makes
 * visible, in REDELIVERY_ORDER. A phone keeps its pull cursor when its flags change, so records it was
 * not sent before the grant would otherwise never reach it; server/sync/handler.ts's members_update
 * gives these a fresh seq so every phone pulls them again.
 */
export function newlyVisibleEntities(before: Member, after: Member): Entity[] {
  return REDELIVERY_ORDER.filter((entity) => {
    const id = entity === "setting" ? ANY_OTHER_SETTING : "";
    return canPull(after, entity, id) && !canPull(before, entity, id);
  });
}

// ---------- Push ----------

/**
 * Decides whether `member` may push `incomingData` to record `id` of `entity`, and, when allowed, the
 * data to store — `incomingData` itself, except for a `prepare`/`money` push of an order, where only the
 * fields that permission covers are taken from `incomingData` and everything else comes from
 * `existing` (the record as currently stored; undefined when this push would create it).
 */
export function decidePush(
  member: Member,
  entity: Entity,
  _id: string,
  incomingData: Record<string, unknown>,
  deleted: boolean,
  existing: StoredRecord | undefined,
): PushDecision {
  if (member.role === "owner") return allow(incomingData);
  switch (entity) {
    case "shop":
    case "setting":
      return FORBIDDEN;
    case "customer":
    case "occasion":
      return hasPermission(member, "orders") ? allow(incomingData) : FORBIDDEN;
    case "expense":
      return hasPermission(member, "money") ? allow(incomingData) : FORBIDDEN;
    case "stock_move":
      return hasPermission(member, "products") ? allow(incomingData) : FORBIDDEN;
    case "product":
      if (hasPermission(member, "products")) return allow(incomingData);
      if ((hasPermission(member, "orders") || hasPermission(member, "prepare")) && !deleted && existing && !existing.deleted && isOrderStockUpdate(existing.data, incomingData)) {
        return allow(incomingData);
      }
      return FORBIDDEN;
    case "order":
      if (hasPermission(member, "orders")) return allow(incomingData);
      return mergeOrderFields(member, incomingData, deleted, existing);
    default:
      return FORBIDDEN;
  }
}

// ---------- Order fields for `prepare` and `money` ----------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (v: unknown) => typeof v === "string";
const isIsoDateOrNull = (v: unknown) => v === null || (typeof v === "string" && ISO_DATE_RE.test(v) && Number.isFinite(Date.parse(v)));
const isListOfObjects = (v: unknown) => Array.isArray(v) && v.every(isPlainObject);

interface FieldRule {
  valid: (value: unknown) => boolean;
  /** Optional keys follow the payload when it leaves them out (cleared); required ones stay as stored. */
  optional: boolean;
}

/** The order fields each permission may change, and what a valid value looks like. A value that is not
 * valid is ignored: the stored one stays. */
const PREPARE_FIELDS: Record<string, FieldRule> = {
  status: { valid: isString, optional: false },
  // "Out for delivery" (tester feedback, 1 Oct 2026): status stays "ready" on the wire and this key holds
  // when the order left; null or absent once it moves on.
  outForDeliveryAt: { valid: isIsoDateOrNull, optional: true },
  updatedAt: { valid: isString, optional: false },
};
const MONEY_FIELDS: Record<string, FieldRule> = {
  payments: { valid: isListOfObjects, optional: false },
  paymentStatus: { valid: isString, optional: false },
  updatedAt: { valid: isString, optional: false },
};
/** The `changes` (order history) entries each permission may add — the `field` the phones and the web
 * write for a status move ("status", "outForDelivery") or a payment ("paymentStatus", "payment"). */
const PREPARE_HISTORY = ["status", "outForDelivery"];
const MONEY_HISTORY = ["paymentStatus", "payment"];

/** A prepare/money push of an order: only onto an existing, live order (nothing to create, delete or
 * bring back), with a status like every order has; the covered fields come from the payload, the rest
 * from the stored record. */
function mergeOrderFields(member: Member, incoming: Record<string, unknown>, deleted: boolean, existing: StoredRecord | undefined): PushDecision {
  const prepare = hasPermission(member, "prepare");
  const money = hasPermission(member, "money");
  if (!prepare && !money) return FORBIDDEN;
  if (deleted || !existing || existing.deleted) return FORBIDDEN;
  if (typeof incoming.status !== "string") return FORBIDDEN;

  const fields: Record<string, FieldRule> = { ...(prepare ? PREPARE_FIELDS : {}), ...(money ? MONEY_FIELDS : {}) };
  const history = new Set([...(prepare ? PREPARE_HISTORY : []), ...(money ? MONEY_HISTORY : [])]);

  const data: Record<string, unknown> = { ...existing.data };
  for (const [key, rule] of Object.entries(fields)) {
    if (key in incoming) {
      if (rule.valid(incoming[key])) data[key] = incoming[key];
    } else if (rule.optional) {
      delete data[key];
    }
  }
  const changes = mergeHistory(existing.data.changes, incoming.changes, history);
  if (changes !== undefined) data.changes = changes;
  return allow(data);
}

/**
 * The order history after a prepare/money push: every stored entry exactly as stored (an entry with a
 * known id always takes its stored copy; one the payload left out is kept, at the end), plus the
 * payload's new entries whose `field` is one this member may record. In the payload's own order, so a
 * phone that appends sees the same list back. Undefined when neither side has a history list.
 */
function mergeHistory(stored: unknown, incoming: unknown, allowedFields: Set<string>): unknown[] | undefined {
  if (!Array.isArray(stored) && !Array.isArray(incoming)) return undefined;
  const storedList = Array.isArray(stored) ? stored : [];
  const storedById = new Map<string, unknown>();
  for (const entry of storedList) if (isPlainObject(entry) && typeof entry.id === "string") storedById.set(entry.id, entry);

  const out: unknown[] = [];
  const taken = new Set<unknown>();
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    if (!isPlainObject(entry)) continue;
    const known = typeof entry.id === "string" ? storedById.get(entry.id) : storedList.find((s) => sameJson(s, entry));
    if (known !== undefined) {
      if (!taken.has(known)) {
        out.push(known);
        taken.add(known);
      }
    } else if (typeof entry.field === "string" && allowedFields.has(entry.field) && !(typeof entry.id === "string" && out.some((o) => isPlainObject(o) && o.id === entry.id))) {
      out.push(entry);
    }
  }
  for (const entry of storedList) if (!taken.has(entry)) out.push(entry);
  return out;
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
