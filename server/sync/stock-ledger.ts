// The order stock ledger `stockDeducted` { "<productId>": units } on an order record: what the order
// actually took out of each product's stock (docs/sme-phase-2-cloud.md "Record formats"; integrity review
// 3 Oct 2026, R3, and the second review, L1 and L3). The ledger is how a cancelled order gives back exactly
// what it took, so the server keeps it as honest as it can without ever editing an order's items:
//   - L1: a missing or invalid ledger never changes a stored one; only a valid value does ({} clears it).
//   - L3: staff who only prepare orders cannot edit items, so the stored order is the reference for what a
//     ledger they send may say (acceptPreparedLedger below).

import { isPlainObject } from "./json-equal.ts";

/** The order statuses that hold stock (iOS isStockDeductedStatus, Android _isStockDeductedStatus, the web's
 * DEDUCTED): confirmed, ready (also "out for delivery") and collected. The wire spells the rest `newOrder`
 * and `cancelled`; a status the server does not know takes no stock. */
const DEDUCTED_STATUSES = new Set(["confirmed", "ready", "collected"]);
export const isDeductedStatus = (status: unknown): boolean => typeof status === "string" && DEDUCTED_STATUSES.has(status);

/** A valid ledger: { "<productId>": units } with at most 200 keys, each a non-empty string of up to 64
 * characters, and every value a whole number from 0 to 1,000,000. An empty object is valid: the order
 * takes nothing now. */
const MAX_LEDGER_KEYS = 200;
const MAX_LEDGER_KEY_CHARS = 64;
const MAX_LEDGER_UNITS = 1_000_000;
export function isStockLedger(value: unknown): value is Record<string, number> {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_LEDGER_KEYS &&
    entries.every(([key, units]) => key.length >= 1 && key.length <= MAX_LEDGER_KEY_CHARS && typeof units === "number" && Number.isInteger(units) && units >= 0 && units <= MAX_LEDGER_UNITS)
  );
}

function sameLedger(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

/** The units of each product on an order's lines (a product can have several lines). Lines without a
 * product, and quantities that are not positive numbers, count for nothing. */
function unitsByProduct(items: unknown): Map<string, number> {
  const units = new Map<string, number>();
  if (!Array.isArray(items)) return units;
  for (const line of items) {
    if (!isPlainObject(line) || typeof line.productId !== "string" || !line.productId) continue;
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) continue;
    units.set(line.productId, (units.get(line.productId) ?? 0) + quantity);
  }
  return units;
}

/** Whether `ledger` can be what the order `items` took out of stock: every key is the product of one of its
 * lines, and no product has more units in the ledger than on the order. */
function fitsLines(ledger: Record<string, number>, items: unknown): boolean {
  const units = unitsByProduct(items);
  return Object.entries(ledger).every(([productId, taken]) => taken <= (units.get(productId) ?? -1));
}

/**
 * L1, for the pushes that store a whole order (the owner, staff with `orders`): the stored ledger stays when
 * the pushed record has none. "Absent" (or null) means this client does not know the ledger (an older app,
 * a stale copy); only an explicit value changes it, `{}` included. A stored ledger that is not valid is not
 * kept: there is nothing sound to keep.
 */
export function keepStoredLedger(incoming: Record<string, unknown>, stored: Record<string, unknown> | undefined): Record<string, unknown> {
  if (incoming.stockDeducted !== undefined && incoming.stockDeducted !== null) return incoming;
  if (!stored || !isStockLedger(stored.stockDeducted)) return incoming;
  return { ...incoming, stockDeducted: stored.stockDeducted };
}

/**
 * L1 + L3, for a push of an *existing* order by staff who prepare orders but do not hold `orders`: the
 * ledger the push may write, or undefined when the stored one stays. Prepare-only staff cannot edit items, so
 * the stored order is the reference. A pushed ledger is taken only when it is valid (L1: missing, null or
 * invalid leaves the stored one alone) and one of these holds:
 *   1. it equals the stored ledger (nothing to do);
 *   2. the push moves the order INTO a deducted status from one that is not: every key is the product of a
 *      line of the stored order, and no value is above that product's units on the order (confirming, or
 *      confirming again after a cancel; `{}` when no tracked product was taken);
 *   3. the push moves the order OUT of a deducted status and the ledger is `{}` (cancelling, or back to new:
 *      the stock came back);
 *   4. the stored order has no ledger, is in a deducted status and stays in one, and the ledger fits its
 *      lines as in 2 (a legacy order's ledger, derived by the phone from the stock moves).
 * Anything else is ignored like any other invalid prepare value.
 */
export function acceptPreparedLedger(stored: Record<string, unknown>, pushedLedger: unknown, newStatus: unknown): Record<string, number> | undefined {
  if (!isStockLedger(pushedLedger)) return undefined;
  const storedLedger = isStockLedger(stored.stockDeducted) ? stored.stockDeducted : undefined;
  if (storedLedger && sameLedger(storedLedger, pushedLedger)) return pushedLedger;

  const was = isDeductedStatus(stored.status);
  const now = isDeductedStatus(newStatus);
  if (!was && now) return fitsLines(pushedLedger, stored.items) ? pushedLedger : undefined;
  if (was && !now) return Object.keys(pushedLedger).length === 0 ? pushedLedger : undefined;
  if (was && now && !storedLedger) return fitsLines(pushedLedger, stored.items) ? pushedLedger : undefined;
  return undefined;
}
