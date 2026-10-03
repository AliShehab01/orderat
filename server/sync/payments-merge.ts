// Payments from two devices both survive (third review, 3 Oct 2026, F4; docs/sme-phase-2-cloud.md "Order
// payments with several phones").
//
// An order record is last-writer-wins as a whole, so two devices that each record a different payment on the same
// order from the same copy (A takes 2,000, B takes 3,000) used to leave one of them: whichever pushed last
// replaced the `payments` list with its own. Money must never vanish silently, so a push whose copy is STALE
// keeps the stored payments it does not know about:
//   - stale = the push's `baseSeq` is older than the stored record's seq (the pushing device never saw the stored
//     version; a retry of an earlier push, or a copy edited while its own sync was in flight, is stale too);
//   - the result of a stale push is the union of the stored and the pushed payments, by payment identity (the
//     `id` every app writes; a payment with no id is identified by its fields); a payment present in both takes
//     the pushed copy; the stored order stays first, so the same two pushes in any order, or repeated, give the
//     same list;
//   - a payment is removed only by a push that is NOT stale: an up-to-date copy that leaves a payment out is a
//     deliberate removal and is honoured. Removing a payment from a copy that is behind is not: the payment stays.
// When the union differs from what was pushed, `paymentStatus` is recomputed from the accepted payments and the
// order's total, exactly as the apps do (paid <= 0: unpaid; paid >= total: paid; else deposit), when the record
// carries what that needs (every line's quantity and unit price); otherwise the pushed status is kept. The
// server writes no history entry for such a recomputation: the history (`changes`) stays whatever the push held.

import { isPlainObject, sameJson } from "./json-equal.ts";

type Json = Record<string, unknown>;

/** What identifies a payment: its id without case, or, with no id, its own fields. */
export function paymentKey(payment: Json): string {
  if (typeof payment.id === "string" && payment.id.length > 0) return `id:${payment.id.toLowerCase()}`;
  return `f:${JSON.stringify([payment.amountMinor ?? null, payment.method ?? null, payment.paidAt ?? null, payment.note ?? null])}`;
}

function paymentsOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

/** Whether a push of an order is stale for its payments: its copy is based on an older version than the stored
 * one. A caller that knows no seq (a unit test of the rules, a record that does not exist yet) is never stale. */
export function isStalePush(baseSeq: number | undefined, storedSeq: number | undefined): boolean {
  return baseSeq !== undefined && storedSeq !== undefined && baseSeq < storedSeq;
}

/** The payments of a stale push: the stored ones (the pushed copy of one that is in both), then the pushed ones
 * the stored order does not have, each identity once. */
export function unionPayments(stored: unknown, incoming: unknown): Json[] {
  const pushed = paymentsOf(incoming);
  const pushedByKey = new Map<string, Json>();
  for (const payment of pushed) if (!pushedByKey.has(paymentKey(payment))) pushedByKey.set(paymentKey(payment), payment);

  const out: Json[] = [];
  const seen = new Set<string>();
  for (const payment of paymentsOf(stored)) {
    const key = paymentKey(payment);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pushedByKey.get(key) ?? payment);
  }
  for (const payment of pushed) {
    const key = paymentKey(payment);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(payment);
  }
  return out;
}

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

/**
 * A whole-order push (owner, `orders` staff): `data` as pushed, except that a stale push keeps the stored
 * payments it lacks (and keeps the stored list when it pushed none), with `paymentStatus` recomputed when that
 * changed the list.
 */
export function reconcilePayments(data: Json, stored: Json | undefined, stale: boolean): Json {
  if (!stale || !stored || paymentsOf(stored.payments).length === 0) return data; // nothing stored to lose
  const merged = unionPayments(stored.payments, data.payments);
  if (Array.isArray(data.payments) && sameJson(merged, paymentsOf(data.payments))) return data;
  return withPayments(data, merged);
}

/** `data` with `payments` set to `payments` and `paymentStatus` recomputed from them (kept when it cannot be). */
export function withPayments(data: Json, payments: Json[]): Json {
  const next: Json = { ...data, payments };
  const status = paymentStatusFor(next);
  if (status !== undefined && (data.paymentStatus === undefined || (typeof data.paymentStatus === "string" && PAYMENT_STATUSES.has(data.paymentStatus)))) {
    next.paymentStatus = status;
  }
  return next;
}
