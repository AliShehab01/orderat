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
//     `outForDeliveryAt`, `updatedAt`, the stock ledger `stockDeducted` (confirming and cancelling an
//     order moves stock, and the ledger records how much; taken only when it fits the stored order,
//     server/sync/stock-ledger.ts, second review L3), and new `changes` entries about the status
//     fields. Every other field is kept from the stored record, never trusted from the payload. No
//     creating or deleting orders.
//   - `money` (without `orders`): an existing order's money fields only — `payments`, `paymentStatus`,
//     `updatedAt` and new payment history entries — and full write of expenses.
//   - `products`: full write of products and stock moves (and photo uploads, server/sync/handler.ts).
//     Staff with `orders` or `prepare` but not `products` may push an *existing* product to add
//     order-driven stock moves (planProductPush) — so stock stays right when staff confirm or cancel
//     orders; nothing else of the product they send is stored, and a move only counts when the order it
//     names allows it (server/sync/stock-merge.ts, third review F2).
//   - Stock moves are merged, never lost and never refused for being stale (second review, 3 Oct 2026, L2,
//     server/sync/stock-merge.ts): a product push whose copy lacks moves the stored one has is rebased onto
//     the stored quantity and moves, applying only the moves the stored copy lacks, each once (stock_ops).
//   - A whole-order push (owner, `orders`) that leaves out `stockDeducted` keeps the stored ledger (L1); one
//     whose ledger does not fit its own lines is treated as leaving it out (F1).
//   - Payments are add-only (third review F4, fourth review R2 and R3, server/sync/payments-merge.ts): the absence
//     of a payment in a pushed order never removes it, whatever the `baseSeq`; a payment is removed by listing its
//     id in the order's grow-only `removedPaymentIds` (or, for the released iOS 1.0, by its history entry). Only
//     the owner and staff with `orders` or `money` write payments and removal ids.
//   Everything else is refused, and comes back to the phone as a `rejected` entry (server/sync/
//   push-pull.ts), with the server's copy when the member may pull it.

import { ISO_DATE_RE, isPlainObject, sameJson } from "./json-equal.ts";
import { hasPermission, type Member } from "./permissions.ts";
import { applyPaymentRules } from "./payments-merge.ts";
import { acceptPreparedLedger, resolveWholeOrderLedger, settleLedgerForStatus } from "./stock-ledger.ts";
import { mayMoveOrderStock, NO_FACTS, planProductPush, type ProductPlan, type StockFacts } from "./stock-merge.ts";

export const ENTITIES = ["shop", "product", "customer", "order", "expense", "occasion", "stock_move", "setting"] as const;
export type Entity = (typeof ENTITIES)[number];

/** The id of the "setting" record holding the owner's subscription report. */
const SUBSCRIPTION_SETTING_ID = "subscription";

export type PushDecision =
  /** `stock` is the stock bookkeeping of a product push that goes with `data` (stock-merge.ts planProductPush). */
  | { allowed: true; data: Record<string, unknown>; stock?: ProductPlan }
  | { allowed: false; reason: "forbidden" };

/** A record as currently stored, handed to decidePush — undefined when the push would create it. */
export interface StoredRecord {
  data: Record<string, unknown>;
  deleted: boolean;
}

/** What else a push is decided on: the facts a product push's stock moves are judged against (read by
 * server/sync/stock-apply.ts). The seq a pushing device's copy is based on decides nothing here: payments are add-only
 * whatever it is (fourth review, R2), and stock is merged by move ids. */
export interface PushContext {
  stock?: StockFacts;
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
  id: string,
  incomingData: Record<string, unknown>,
  deleted: boolean,
  existing: StoredRecord | undefined,
  context: PushContext = {},
): PushDecision {
  if (member.role === "owner") {
    if (entity === "product") return decideProduct(true, id, incomingData, deleted, existing, context);
    if (entity === "order") return allow(wholeOrder(incomingData, existing));
    return allow(incomingData);
  }
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
      if (hasPermission(member, "products")) return decideProduct(true, id, incomingData, deleted, existing, context);
      if (mayMoveOrderStock(member)) return decideProduct(false, id, incomingData, deleted, existing, context);
      return FORBIDDEN;
    case "order":
      if (hasPermission(member, "orders")) return allow(wholeOrder(incomingData, existing));
      return mergeOrderFields(member, incomingData, deleted, existing);
    default:
      return FORBIDDEN;
  }
}

/** Who may push a product, as far as an existing live one goes: `edit` (the owner, `products` staff: the
 * product as sent, its stock merged), `orderStock` (staff with `orders` or `prepare`: only the stock moves of
 * their copy, judged by the orders they name), or `none`. */
export function productAccess(member: Member): "edit" | "orderStock" | "none" {
  if (hasPermission(member, "products")) return "edit";
  return mayMoveOrderStock(member) ? "orderStock" : "none";
}

/** A product push. An existing live product takes the stock merge (stock-merge.ts planProductPush): a copy that
 * is stale for stock is rebased onto the stored quantity and moves, only moves not applied before count, and
 * staff without `products` store only the stock moves their copy adds. Anything else (a new product, a deletion,
 * a tombstone coming back) is a plain write for a member who may edit products, and refused for staff who only
 * handle orders: they never create, delete or bring back a product. The decision carries the stock bookkeeping
 * (`stock`) that must be committed with the product (server/sync/store.ts writeAtomic). */
function decideProduct(
  mayEditProduct: boolean,
  id: string,
  incoming: Record<string, unknown>,
  deleted: boolean,
  existing: StoredRecord | undefined,
  context: PushContext,
): PushDecision {
  const live = existing && !existing.deleted ? existing : undefined;
  if (deleted || !live) return mayEditProduct ? allow(incoming) : FORBIDDEN;
  const plan = planProductPush(id, live.data, incoming, mayEditProduct, context.stock ?? NO_FACTS);
  if (!plan) return FORBIDDEN;
  const bookkeeping = plan.ops.length > 0 || plan.listed.length > 0 || plan.orderStock.length > 0 || plan.deps.length > 0;
  return bookkeeping ? { allowed: true, data: plan.data, stock: plan } : allow(plan.data);
}

/** A whole-order push (the owner, staff with `orders`): the record as sent, with the stored ledger kept when it
 * sent none or one that does not fit its lines (L1, F1), a ledger of an order that holds no stock settled to {}, and
 * the payment rules applied (add-only payments, grow-only removal ids: payments-merge.ts). */
function wholeOrder(incoming: Record<string, unknown>, existing: StoredRecord | undefined): Record<string, unknown> {
  return applyPaymentRules(resolveWholeOrderLedger(incoming, existing?.data), existing, incoming);
}

// ---------- Order fields for `prepare` and `money` ----------

const isString = (v: unknown) => typeof v === "string";
const isIsoDateOrNull = (v: unknown) => v === null || (typeof v === "string" && ISO_DATE_RE.test(v) && Number.isFinite(Date.parse(v)));

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
// `payments` and `removedPaymentIds` are not here: the payment rules merge them (payments-merge.ts), never a plain copy.
const MONEY_FIELDS: Record<string, FieldRule> = {
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

  let data: Record<string, unknown> = { ...existing.data };
  for (const [key, rule] of Object.entries(fields)) {
    if (key in incoming) {
      if (rule.valid(incoming[key])) data[key] = incoming[key];
    } else if (rule.optional) {
      delete data[key];
    }
  }
  // Payments (R2, R3): added by id, removed only by the grow-only `removedPaymentIds` (or the released iOS 1.0's history
  // entry); only staff with `money` write them. Prepare-only staff keep the stored payments and removal ids as they are.
  if (money) data = applyPaymentRules(data, existing, incoming);
  if (prepare) {
    // What the order took out of stock (3 Oct 2026, integrity review R3): staff who confirm or cancel an
    // order write the ledger along with the status. Never cleared by leaving it out (L1), and taken only when
    // it fits the stored order (L3); otherwise the stored ledger stays (stock-ledger.ts).
    const ledger = acceptPreparedLedger(existing.data, incoming.stockDeducted, data.status);
    if (ledger !== undefined) data.stockDeducted = ledger;
  }
  const changes = mergeHistory(existing.data.changes, incoming.changes, history);
  if (changes !== undefined) data.changes = changes;
  return allow(prepare ? settleLedgerForStatus(data) : data);
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
