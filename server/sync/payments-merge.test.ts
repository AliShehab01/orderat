import { describe, expect, it } from "vitest";
import { isStalePush, paymentKey, paymentStatusFor, reconcilePayments, unionPayments } from "./payments-merge.ts";

// Third review (3 Oct 2026), F4: payments of a stale copy are never dropped. The rules in isolation;
// payments-push.test.ts runs them through the real push path.

const pay = (id: string | undefined, amountMinor: number, extra: Record<string, unknown> = {}) => ({ ...(id ? { id } : {}), amountMinor, method: "cash", note: null, paidAt: "2026-10-03T08:00:00.000Z", ...extra });
const order = (payments: unknown[], extra: Record<string, unknown> = {}) => ({
  items: [{ id: "i1", quantity: 2, unitPriceMinor: 2500 }],
  deliveryFeeMinor: 0,
  paymentStatus: "unpaid",
  payments,
  ...extra,
});

describe("isStalePush", () => {
  it("is stale only when the pushed copy is based on an older version than the stored one; unknown seqs are never stale", () => {
    expect(isStalePush(10, 12)).toBe(true);
    expect(isStalePush(12, 12)).toBe(false);
    expect(isStalePush(13, 12)).toBe(false);
    expect(isStalePush(0, 12)).toBe(true);
    expect(isStalePush(undefined, 12)).toBe(false);
    expect(isStalePush(5, undefined)).toBe(false);
  });
});

describe("unionPayments", () => {
  it("keeps the stored payments in their order, then the pushed ones the order lacks, each identity once", () => {
    expect(unionPayments([pay("a", 1), pay("b", 2)], [pay("c", 3), pay("a", 1)]).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(unionPayments([pay("a", 1)], [pay("b", 2), pay("b", 2)]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("a payment present in both takes the pushed copy", () => {
    const edited = pay("a", 99, { note: "fixed" });
    expect(unionPayments([pay("a", 1)], [edited])).toEqual([edited]);
  });

  it("is stable: the same two lists in either push order give the same set, and a repeat adds nothing", () => {
    const a = pay("a", 1), b = pay("b", 2);
    const once = unionPayments([a], [b]);
    expect(unionPayments(once, [b])).toEqual(once);
    expect(unionPayments(once, [a])).toEqual(once);
    expect(new Set(unionPayments([b], [a]).map((p) => p.id))).toEqual(new Set(once.map((p) => p.id)));
  });

  it("ignores things that are not payments, and tolerates a missing list on either side", () => {
    expect(unionPayments([pay("a", 1), "junk", null], [7, pay("b", 2)]).map((p) => p.id)).toEqual(["a", "b"]);
    expect(unionPayments(undefined, [pay("a", 1)])).toHaveLength(1);
    expect(unionPayments([pay("a", 1)], undefined)).toHaveLength(1);
  });

  it("identifies a payment by its id without case, or by its fields when it has none", () => {
    expect(paymentKey(pay("PAY-1", 1))).toBe(paymentKey(pay("pay-1", 5)));
    expect(paymentKey(pay(undefined, 1))).toBe(paymentKey(pay(undefined, 1)));
    expect(paymentKey(pay(undefined, 1))).not.toBe(paymentKey(pay(undefined, 2)));
    expect(unionPayments([pay(undefined, 1)], [pay(undefined, 1), pay(undefined, 2)])).toHaveLength(2);
  });
});

describe("paymentStatusFor (the apps' rule)", () => {
  it("nothing paid is unpaid, paid at least the total is paid, anything between is a deposit", () => {
    expect(paymentStatusFor(order([]))).toBe("unpaid");
    expect(paymentStatusFor(order([pay("a", 2000)]))).toBe("deposit");
    expect(paymentStatusFor(order([pay("a", 2000), pay("b", 3000)]))).toBe("paid");
    expect(paymentStatusFor(order([pay("a", 9000)]))).toBe("paid"); // overpaid
    expect(paymentStatusFor(order([pay("a", 0)]))).toBe("unpaid");
  });

  it("the total is the lines plus the delivery fee, plus the VAT only when it was added on top of the prices", () => {
    expect(paymentStatusFor(order([pay("a", 5000)], { deliveryFeeMinor: 500 }))).toBe("deposit");
    expect(paymentStatusFor(order([pay("a", 5500)], { deliveryFeeMinor: 500 }))).toBe("paid");
    expect(paymentStatusFor(order([pay("a", 5000)], { vatIncluded: false, vatMinor: 500 }))).toBe("deposit");
    expect(paymentStatusFor(order([pay("a", 5500)], { vatIncluded: false, vatMinor: 500 }))).toBe("paid");
    expect(paymentStatusFor(order([pay("a", 5000)], { vatIncluded: true, vatMinor: 500 }))).toBe("paid"); // already inside the prices
    expect(paymentStatusFor({ items: [], payments: [pay("a", 1)] })).toBe("paid"); // a zero total with something paid
    expect(paymentStatusFor({ items: [], payments: [] })).toBe("unpaid");
  });

  it("is undefined when the record lacks what the total needs: no lines list, or a line without a quantity or price", () => {
    expect(paymentStatusFor({ payments: [pay("a", 1)] })).toBeUndefined();
    expect(paymentStatusFor({ items: [{ id: "i1" }], payments: [] })).toBeUndefined();
    expect(paymentStatusFor({ items: ["junk"], payments: [] })).toBeUndefined();
  });
});

describe("reconcilePayments", () => {
  const stored = order([pay("a", 2000)], { paymentStatus: "deposit" });

  it("an up-to-date push, or a push with nothing stored to lose, is returned as sent", () => {
    const pushed = order([pay("b", 3000)], { paymentStatus: "deposit" });
    expect(reconcilePayments(pushed, stored, false)).toBe(pushed);
    expect(reconcilePayments(pushed, undefined, true)).toBe(pushed);
    expect(reconcilePayments(pushed, order([], {}), true)).toBe(pushed);
  });

  it("a stale push gets the union and the recomputed status, and the rest of what it sent", () => {
    const pushed = order([pay("b", 3000)], { paymentStatus: "deposit", notes: "B's note" });
    const result = reconcilePayments(pushed, stored, true);
    expect((result.payments as { id: string }[]).map((p) => p.id)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ paymentStatus: "paid", notes: "B's note" });
  });

  it("a stale push that already holds everything stored is returned as sent (no rewrite, no recompute)", () => {
    const pushed = order([pay("a", 2000), pay("b", 3000)], { paymentStatus: "weird" });
    expect(reconcilePayments(pushed, stored, true)).toBe(pushed);
  });

  it("keeps the pushed status when it cannot be recomputed, or is not one the apps use", () => {
    const noLines = { payments: [pay("b", 3000)], paymentStatus: "deposit" };
    expect(reconcilePayments(noLines, { payments: [pay("a", 2000)] }, true)).toMatchObject({ paymentStatus: "deposit" });
    const unknown = order([pay("b", 3000)], { paymentStatus: "refunded" });
    expect(reconcilePayments(unknown, stored, true)).toMatchObject({ paymentStatus: "refunded" });
  });

  it("a stale push with no payments list at all keeps the stored list", () => {
    const { payments: _omit, ...withoutList } = order([], {});
    void _omit;
    expect(reconcilePayments(withoutList, stored, true).payments).toEqual([pay("a", 2000)]);
  });
});
