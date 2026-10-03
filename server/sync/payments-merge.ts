// Payments are add-only (third review, 3 Oct 2026, F4; fourth review, same day, R2 and R3; docs/sme-phase-2-cloud.md "Order
// payments with several phones").
//
// An order record is last-writer-wins as a whole, so a push that carries a `payments` list says what that phone knows, not
// what the order holds. Money must never vanish silently, so:
//   - A payment is identified by its `id` (compared without case: iOS writes uppercase UUIDs, Android and the web lowercase;
//     a payment with no id by its fields).
//   - The absence of a payment in a pushed order NEVER removes it, whatever the push's `baseSeq`. (The `baseSeq` rule of the
//     third review treated an up-to-date copy as a deliberate removal. iOS refreshes its recorded seq for a record it did not
//     apply, so its old `payments` list arrived looking up to date and deleted another phone's payment: R2. And a removal
//     accepted from one phone was undone by a stale copy that still held the payment: R3.)
//   - A payment is removed only by listing its id in the order's `removedPaymentIds`: an array of the ids of payments the
//     user deliberately deleted, GROW-ONLY. Every app appends to it when the user deletes a payment (an undo of a payment
//     just recorded included) and never drops an id; on a pull it takes the server's `payments` and `removedPaymentIds`.
//   - On every accepted order write by a member who may write payments (the owner, `orders` and `money` staff):
//       removed  = stored.removedPaymentIds + the valid pushed ones + legacy removals (below)
//       payments = (the stored payments + the pushed ones, by id; a payment in both takes the pushed copy) minus removed
//     and both are stored. Staff who may not write payments (`prepare` only) cannot add removal ids, and a push of an order
//     by a member with neither permission is refused before any of this (record-access.ts).
//   - A pushed `removedPaymentIds` is valid when it is an array of at most 500 non-empty strings of at most 64 characters.
//     Anything else is ignored as a whole (and not stored).
//   - Legacy removals: the released iOS 1.0 deletes a payment by leaving it out of its `payments` list, and logs a history
//     entry `payment: "<amount in minor units>" -> "removed"` (Store.removePayment). A NEW `changes` entry like that, for
//     which exactly as many stored payments with that amount are missing from the pushed copy as there are such new entries
//     for that amount, removes those payments and records their ids. Anything else is ambiguous (the missing payment may be
//     one the pushing phone never saw, or one it created and removed before it ever synced) and keeps the payments. Android
//     1.5.5 and the live web delete by absence without any such entry: for them, a deleted payment comes back on the next
//     pull until the app that writes `removedPaymentIds` is installed (it is never lost to a stale copy: that is the point).
//   - `paymentStatus` is recomputed from the resulting payments exactly as the apps do (paid <= 0: unpaid; paid >= total:
//     paid; else deposit) when the resulting list differs from what the push said and the record carries the lines the total
//     needs (every line's quantity and unit price); otherwise the pushed status stays. The server writes no history entry for
//     a recomputation.
// Bounds, so one order cannot be made to grow without limit by a member with `orders` or `money` (grow-only lists are the
// one thing a 32 KB push limit does not bound): 1,000 removal ids and 500 payments per order. Past them a NEW id or payment
// is not stored; what is stored is never dropped.

import { isPlainObject, sameJson } from "./json-equal.ts";

type Json = Record<string, unknown>;

/** What one push may carry in `removedPaymentIds`. */
export const MAX_REMOVED_IDS_PER_PUSH = 500;
export const MAX_REMOVED_ID_CHARS = 64;
/** What an order may hold in `removedPaymentIds` in all. */
export const MAX_REMOVED_IDS_STORED = 1000;
export const MAX_PAYMENTS_PER_ORDER = 500;

/** What identifies a payment: its id without case, or, with no id, its own fields. */
export function paymentKey(payment: Json): string {
  if (typeof payment.id === "string" && payment.id.length > 0) return `id:${payment.id.toLowerCase()}`;
  return `f:${JSON.stringify([payment.amountMinor ?? null, payment.method ?? null, payment.paidAt ?? null, payment.note ?? null])}`;
}

/** The key a removed payment id is compared by: the same as the key of a payment that has that id. */
const removedKey = (id: string): string => `id:${id.toLowerCase()}`;

function paymentsOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

const isRemovedId = (id: unknown): id is string => typeof id === "string" && id.length >= 1 && id.length <= MAX_REMOVED_ID_CHARS;

/** A pushed `removedPaymentIds`, or undefined when it is not a valid one (and so is ignored as a whole). */
export function validRemovedIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_REMOVED_IDS_PER_PUSH) return undefined;
  return value.every(isRemovedId) ? (value as string[]) : undefined;
}

/** The removal ids an order already holds. Only this server writes them, so they are valid; anything else is dropped. */
function storedRemovedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isRemovedId) : [];
}

/** The stored ids followed by the new ones, each id once (without case), the new ones only while the order is under the cap. */
function growRemovedIds(stored: string[], added: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of stored) {
    if (seen.has(removedKey(id))) continue;
    seen.add(removedKey(id));
    out.push(id);
  }
  for (const id of added) {
    if (out.length >= MAX_REMOVED_IDS_STORED) break;
    if (seen.has(removedKey(id))) continue;
    seen.add(removedKey(id));
    out.push(id);
  }
  return out;
}

/** The union by payment identity: the stored payments in their order (the pushed copy of one that is in both), then the
 * pushed ones the order lacks while it holds fewer than the cap, each identity once. */
function unionPayments(stored: Json[], pushed: Json[]): Json[] {
  const pushedByKey = new Map<string, Json>();
  for (const payment of pushed) if (!pushedByKey.has(paymentKey(payment))) pushedByKey.set(paymentKey(payment), payment);

  const out: Json[] = [];
  const seen = new Set<string>();
  for (const payment of stored) {
    const key = paymentKey(payment);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pushedByKey.get(key) ?? payment);
  }
  for (const payment of pushed) {
    const key = paymentKey(payment);
    if (seen.has(key)) continue;
    if (out.length >= MAX_PAYMENTS_PER_ORDER) continue;
    seen.add(key);
    out.push(payment);
  }
  return out;
}

// ---------- The history entries of the released iOS 1.0 ----------

/** The entries of the pushed history that the stored history does not have yet: an entry with an id is new when no stored
 * entry has that id, one without when no stored entry equals it; each once. The same notion of "known" as the history merge
 * of the prepare and money pushes (record-access.ts). */
export function newHistoryEntries(stored: unknown, incoming: unknown): Json[] {
  const storedList = Array.isArray(stored) ? stored : [];
  const storedIds = new Set<string>();
  for (const entry of storedList) if (isPlainObject(entry) && typeof entry.id === "string") storedIds.add(entry.id);

  const out: Json[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    if (!isPlainObject(entry)) continue;
    const known = typeof entry.id === "string" ? storedIds.has(entry.id) : storedList.some((s) => sameJson(s, entry));
    if (known) continue;
    const key = typeof entry.id === "string" ? `id:${entry.id}` : `json:${JSON.stringify(entry)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** The amount in minor units a removal entry names in its `oldValue` (a string of digits, as iOS writes it; a whole number
 * is taken too), or undefined. */
function removedAmount(entry: Json): number | undefined {
  if (entry.field !== "payment" || entry.newValue !== "removed") return undefined;
  const value = entry.oldValue;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

const timeOf = (value: unknown): number => (typeof value === "string" ? Date.parse(value) : NaN);

/**
 * Legacy removals (the released iOS 1.0): the ids of the stored payments a push removed by leaving them out and logging a new
 * `payment: <amount> -> removed` entry. For each amount, when exactly as many stored payments with it are missing from the
 * pushed copy as there are such new entries, those payments are removed; otherwise none are (it is ambiguous which payment
 * the phone meant). A payment recorded after the removal entry cannot be the one it removed, and a payment with no id cannot
 * be recorded as removed, so neither counts as a candidate (the second keeps the whole amount: it is ambiguous).
 */
export function legacyRemovedIds(storedPayments: Json[], pushedPayments: Json[] | undefined, newEntries: Json[]): string[] {
  if (pushedPayments === undefined) return [];
  const byAmount = new Map<number, Json[]>();
  for (const entry of newEntries) {
    const amount = removedAmount(entry);
    if (amount !== undefined) byAmount.set(amount, [...(byAmount.get(amount) ?? []), entry]);
  }
  if (byAmount.size === 0) return [];

  const pushedKeys = new Set(pushedPayments.map(paymentKey));
  const missing = storedPayments.filter((payment) => !pushedKeys.has(paymentKey(payment)));
  const ids: string[] = [];
  for (const [amount, entries] of byAmount) {
    const latest = Math.max(...entries.map((e) => timeOf(e.at)));
    const candidates = missing.filter((p) => p.amountMinor === amount && !(Number.isFinite(latest) && timeOf(p.paidAt) > latest));
    if (candidates.length === entries.length && candidates.every((p) => typeof p.id === "string" && p.id.length > 0)) {
      ids.push(...candidates.map((p) => p.id as string));
    }
  }
  return ids;
}

// ---------- The payment status ----------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const PAYMENT_STATUSES = new Set(["unpaid", "deposit", "paid"]);

/** The payment status an order record's payments and total give (the apps' rule), or undefined when the record
 * lacks what the total needs: lines that are all objects with a numeric quantity and unit price. The total is
 * the lines plus the delivery fee, plus the VAT when it was added on top of the prices (`vatIncluded: false`). */
export function paymentStatusFor(order: Json): "unpaid" | "deposit" | "paid" | undefined {
  if (!Array.isArray(order.items)) return undefined;
  let total = 0;
  for (const line of order.items) {
    if (!isPlainObject(line) || !finite(line.quantity) || !finite(line.unitPriceMinor)) return undefined;
    total += line.quantity * line.unitPriceMinor;
  }
  total += finite(order.deliveryFeeMinor) ? order.deliveryFeeMinor : 0;
  if (order.vatIncluded === false) total += finite(order.vatMinor) ? order.vatMinor : 0;
  const paid = paymentsOf(order.payments).reduce((sum, p) => sum + (finite(p.amountMinor) ? p.amountMinor : 0), 0);
  return paid <= 0 ? "unpaid" : paid >= total ? "paid" : "deposit";
}

/** `data` with `payments` set to `payments` and `paymentStatus` recomputed from them (kept when it cannot be, or when it is
 * not one of the statuses the apps use). */
function withPayments(data: Json, payments: Json[]): Json {
  const next: Json = { ...data, payments };
  const status = paymentStatusFor(next);
  if (status !== undefined && (data.paymentStatus === undefined || (typeof data.paymentStatus === "string" && PAYMENT_STATUSES.has(data.paymentStatus)))) {
    next.paymentStatus = status;
  }
  return next;
}

// ---------- The rules ----------

/**
 * The order to store after the payment rules above, for a push by a member who may write payments. `data` is the record
 * as it would be stored apart from them (the pushed record, for a whole-order push; the stored one with the fields the push
 * may change, for a money push), `existing` the order as stored now (undefined: it is new) and `incoming` what was pushed.
 * The payments of a deleted stored order are not merged in (a tombstone holds nothing), but its removal ids still count:
 * they are grow-only.
 */
export function applyPaymentRules(data: Json, existing: { data: Json; deleted: boolean } | undefined, incoming: Json): Json {
  const prior = existing?.data;
  const storedPayments = existing && !existing.deleted ? paymentsOf(prior!.payments) : [];
  const pushedPayments = Array.isArray(incoming.payments) ? paymentsOf(incoming.payments) : undefined;

  const removed = growRemovedIds(storedRemovedIds(prior?.removedPaymentIds), [
    ...(validRemovedIds(incoming.removedPaymentIds) ?? []),
    ...legacyRemovedIds(storedPayments, pushedPayments, newHistoryEntries(prior?.changes, incoming.changes)),
  ]);
  const gone = new Set(removed.map(removedKey));
  const payments = unionPayments(storedPayments, pushedPayments ?? []).filter((payment) => !gone.has(paymentKey(payment)));

  let next = data;
  const current = Array.isArray(data.payments) ? paymentsOf(data.payments) : undefined;
  const store = current === undefined ? payments.length > 0 : !sameJson(current, payments);
  // The pusher's own status stands while the order holds what it said; it is recomputed when the order holds anything else.
  const recompute = pushedPayments === undefined ? payments.length > 0 : !sameJson(payments, pushedPayments);
  if (recompute) next = withPayments(next, payments);
  else if (store) next = { ...next, payments };

  if (removed.length > 0) {
    if (!sameJson(next.removedPaymentIds, removed)) next = { ...next, removedPaymentIds: removed };
  } else if ("removedPaymentIds" in next && validRemovedIds(next.removedPaymentIds) === undefined) {
    const { removedPaymentIds: _invalid, ...rest } = next;
    void _invalid;
    next = rest;
  }
  return next;
}
