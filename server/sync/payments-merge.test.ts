import { describe, expect, it } from "vitest";
import {
  applyPaymentRules,
  legacyRemovedIds,
  MAX_PAYMENTS_PER_ORDER,
  MAX_REMOVED_IDS_PER_PUSH,
  MAX_REMOVED_IDS_STORED,
  newHistoryEntries,
  paymentKey,
  paymentStatusFor,
  validRemovedIds,
} from "./payments-merge.ts";

// Fourth review (3 Oct 2026), R2 and R3: payments are add-only. The absence of a payment in a pushed order never removes
// it, whatever the baseSeq; a payment is removed only by listing its id in the order's grow-only `removedPaymentIds`
// (or, for the released iOS 1.0, by its history entry). The rules in isolation; payments-push.test.ts runs them through
// the real push path.

const AT = "2026-10-03T08:00:00.000Z";
const pay = (id: string | undefined, amountMinor: number, extra: Record<string, unknown> = {}) => ({ ...(id ? { id } : {}), amountMinor, method: "cash", note: null, paidAt: AT, ...extra });
/** A 5,000 order (2 x 2,500), nothing paid unless the caller says so. */
const order = (payments: unknown[], extra: Record<string, unknown> = {}) => ({
  items: [{ id: "i1", quantity: 2, unitPriceMinor: 2500 }],
  deliveryFeeMinor: 0,
  paymentStatus: "unpaid",
  payments,
  changes: [],
  ...extra,
});
const stored = (data: Record<string, unknown>, deleted = false) => ({ data, deleted });
const idsOf = (data: Record<string, unknown>) => (data.payments as { id?: string }[]).map((p) => p.id);
const A = pay("a", 2000), B = pay("b", 3000);

describe("paymentKey", () => {
  it("identifies a payment by its id without case, or by its fields when it has none", () => {
    expect(paymentKey(pay("PAY-1", 1))).toBe(paymentKey(pay("pay-1", 5)));
    expect(paymentKey(pay(undefined, 1))).toBe(paymentKey(pay(undefined, 1)));
    expect(paymentKey(pay(undefined, 1))).not.toBe(paymentKey(pay(undefined, 2)));
  });
});

describe("validRemovedIds", () => {
  it("takes an array of non-empty strings of up to 64 characters, at most 500 of them", () => {
    expect(validRemovedIds(["a", "B"])).toEqual(["a", "B"]);
    expect(validRemovedIds([])).toEqual([]);
    expect(validRemovedIds(["x".repeat(64)])).toEqual(["x".repeat(64)]);
    expect(validRemovedIds(Array.from({ length: MAX_REMOVED_IDS_PER_PUSH }, (_, i) => `id${i}`))).toHaveLength(MAX_REMOVED_IDS_PER_PUSH);
  });

  it("anything else is invalid as a whole (and so ignored): not an array, a non-string, an empty string, 65 characters, 501 ids", () => {
    for (const bad of [undefined, null, "a", 7, {}, { 0: "a" }, ["a", 1], ["a", null], ["a", ""], ["x".repeat(65)], Array.from({ length: MAX_REMOVED_IDS_PER_PUSH + 1 }, (_, i) => `id${i}`)]) {
      expect(validRemovedIds(bad), JSON.stringify(bad)?.slice(0, 40)).toBeUndefined();
    }
  });
});

describe("applyPaymentRules / add-only", () => {
  it("an order with nothing stored and nothing removed is returned as sent: no removedPaymentIds is invented", () => {
    const pushed = order([A], { paymentStatus: "deposit" });
    expect(applyPaymentRules(pushed, undefined, pushed)).toEqual(pushed);
    expect(applyPaymentRules(pushed, stored(order([])), pushed)).toEqual(pushed);
    const noPayments = { status: "confirmed" };
    expect(applyPaymentRules(noPayments, stored({ status: "confirmed" }), noPayments)).toEqual(noPayments);
  });

  it("the result is the union by id: the stored payments first, then the pushed ones the order lacks; the status follows the union", () => {
    const pushed = order([B], { paymentStatus: "deposit", notes: "B's note" });
    const result = applyPaymentRules(pushed, stored(order([A], { paymentStatus: "deposit" })), pushed);
    expect(idsOf(result)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ paymentStatus: "paid", notes: "B's note" }); // 2,000 + 3,000 on a 5,000 order; the rest of the push stands
    expect(result.removedPaymentIds).toBeUndefined();
  });

  it("a payment present in both takes the pushed copy", () => {
    const edited = pay("a", 2500, { note: "fixed" });
    const pushed = order([edited, B]);
    expect(applyPaymentRules(pushed, stored(order([A])), pushed).payments).toEqual([edited, B]);
  });

  it("absence never removes: a pushed order that lacks a stored payment keeps it, whatever it was based on", () => {
    const pushed = order([], { paymentStatus: "unpaid" });
    const result = applyPaymentRules(pushed, stored(order([A, B], { paymentStatus: "paid" })), pushed);
    expect(idsOf(result)).toEqual(["a", "b"]);
    expect(result.paymentStatus).toBe("paid");
    // A push that carries no payments list at all keeps them too.
    const { payments: _omit, ...withoutList } = order([]);
    void _omit;
    expect(idsOf(applyPaymentRules(withoutList, stored(order([A])), withoutList))).toEqual(["a"]);
  });

  it("is stable: the same pushes in any order, or repeated, give the same set", () => {
    const fromA = order([A]), fromB = order([B]);
    const once = applyPaymentRules(fromB, stored(applyPaymentRules(fromA, stored(order([])), fromA)), fromB);
    const other = applyPaymentRules(fromA, stored(applyPaymentRules(fromB, stored(order([])), fromB)), fromA);
    expect(new Set(idsOf(once))).toEqual(new Set(idsOf(other)));
    expect(applyPaymentRules(fromB, stored(once), fromB).payments).toEqual(once.payments);
    expect(applyPaymentRules(fromA, stored(once), fromA).payments).toEqual(once.payments);
  });

  it("a payment with no id is identified by its fields, and things that are not payments never duplicate or hide one", () => {
    const pushed = order([7, pay(undefined, 2000), "junk"]);
    const result = applyPaymentRules(pushed, stored(order([pay(undefined, 2000)])), pushed);
    expect((result.payments as unknown[]).filter((p) => typeof p === "object")).toEqual([pay(undefined, 2000)]);
    const next = order([pay(undefined, 2000), pay(undefined, 100)]);
    expect(applyPaymentRules(next, stored(result), next).payments).toHaveLength(2);
    // Stored junk is not a payment either: it is not carried into a merge.
    const withJunk = applyPaymentRules(order([B]), stored(order(["junk", A] as unknown[])), order([B]));
    expect(idsOf(withJunk)).toEqual(["a", "b"]);
  });

  it("the status is recomputed only when the stored order added or removed something the push did not say; a status the apps do not use stays", () => {
    const same = order([A, B], { paymentStatus: "weird" });
    expect(applyPaymentRules(same, stored(order([A, B])), same)).toEqual(same); // nothing differs from the push: stored as sent
    const refunded = order([B], { paymentStatus: "refunded" });
    expect(applyPaymentRules(refunded, stored(order([A])), refunded)).toMatchObject({ paymentStatus: "refunded" });
    const noLines = { payments: [B], paymentStatus: "deposit" }; // no lines: no total to compare with
    expect(applyPaymentRules(noLines, stored({ payments: [A], paymentStatus: "deposit" }), noLines)).toMatchObject({ paymentStatus: "deposit" });
    expect(idsOf(applyPaymentRules(noLines, stored({ payments: [A] }), noLines))).toEqual(["a", "b"]);
  });
});

describe("applyPaymentRules / removedPaymentIds", () => {
  it("a listed id removes the payment, is stored, and the pusher's own status stands (it was computed without the payment)", () => {
    const pushed = order([B], { paymentStatus: "deposit", removedPaymentIds: ["a"] });
    const result = applyPaymentRules(pushed, stored(order([A, B], { paymentStatus: "paid" })), pushed);
    expect(idsOf(result)).toEqual(["b"]);
    expect(result).toMatchObject({ removedPaymentIds: ["a"], paymentStatus: "deposit" });
  });

  it("a stale copy that still holds a removed payment does not bring it back, and its status is recomputed", () => {
    const afterRemoval = order([B], { paymentStatus: "deposit", removedPaymentIds: ["a"] });
    const stale = order([A, B], { paymentStatus: "paid", notes: "edited on the older phone" });
    const result = applyPaymentRules(stale, stored(afterRemoval), stale);
    expect(idsOf(result)).toEqual(["b"]);
    expect(result).toMatchObject({ removedPaymentIds: ["a"], notes: "edited on the older phone", paymentStatus: "deposit" });
    // The same with nothing else surviving, and with a payment added meanwhile.
    expect(applyPaymentRules(order([A]), stored(order([], { removedPaymentIds: ["a"] })), order([A])).payments).toEqual([]);
    expect(idsOf(applyPaymentRules(order([A, pay("c", 100)]), stored(order([], { removedPaymentIds: ["a"] })), order([A, pay("c", 100)])))).toEqual(["c"]);
  });

  it("is grow-only: stored ids stay whatever the push says, new ones are added, each id once", () => {
    const base = stored(order([], { removedPaymentIds: ["a", "b"] }));
    for (const pushedIds of [undefined, [], ["c"], ["A", "c", "c"], "junk"]) {
      const pushed = order([], pushedIds === undefined ? {} : { removedPaymentIds: pushedIds });
      const result = applyPaymentRules(pushed, base, pushed);
      expect(result.removedPaymentIds, JSON.stringify(pushedIds)).toEqual(Array.isArray(pushedIds) && pushedIds.includes("c") ? ["a", "b", "c"] : ["a", "b"]);
    }
  });

  it("ids are compared without case (iOS writes uppercase UUIDs, Android and the web lowercase)", () => {
    const pushed = order([], { removedPaymentIds: ["PAY-A"] });
    expect(applyPaymentRules(pushed, stored(order([pay("pay-a", 100)])), pushed).payments).toEqual([]);
    const lower = order([pay("PAY-B", 100)], { removedPaymentIds: ["pay-b"] });
    expect(applyPaymentRules(lower, stored(order([])), lower).payments).toEqual([]);
  });

  it("an invalid value is ignored as a whole and not stored: nothing is removed, not even by its valid entries", () => {
    for (const bad of ["a", 7, ["a", 1], ["a", ""], ["x".repeat(65)], Array.from({ length: MAX_REMOVED_IDS_PER_PUSH + 1 }, (_, i) => (i === 0 ? "a" : `id${i}`))]) {
      const pushed = order([A], { removedPaymentIds: bad });
      const result = applyPaymentRules(pushed, stored(order([A])), pushed);
      expect(idsOf(result), JSON.stringify(bad)?.slice(0, 40)).toEqual(["a"]);
      expect("removedPaymentIds" in result).toBe(false);
    }
  });

  it("an empty list sent as such is kept as sent; 500 valid ids are accepted, 64-character ids too", () => {
    const pushed = order([A], { removedPaymentIds: [] });
    expect(applyPaymentRules(pushed, undefined, pushed).removedPaymentIds).toEqual([]);
    const ids = Array.from({ length: MAX_REMOVED_IDS_PER_PUSH }, (_, i) => `id${i}`);
    const many = order([A], { removedPaymentIds: ids });
    expect(applyPaymentRules(many, stored(order([A])), many).removedPaymentIds).toEqual(ids);
    const long = order([pay("y".repeat(64), 1)], { removedPaymentIds: ["y".repeat(64)] });
    expect(applyPaymentRules(long, undefined, long).payments).toEqual([]);
  });

  it("an id that is removed and also listed among the payments is removed (the removal wins)", () => {
    const pushed = order([A, B], { removedPaymentIds: ["a"] });
    expect(idsOf(applyPaymentRules(pushed, undefined, pushed))).toEqual(["b"]);
  });

  it("the ids of a deleted stored order still count (grow-only), its payments are not merged back in", () => {
    const tombstone = stored(order([A], { removedPaymentIds: ["gone"] }), true);
    const pushed = order([pay("gone", 100), B]);
    const result = applyPaymentRules(pushed, tombstone, pushed);
    expect(idsOf(result)).toEqual(["b"]);
    expect(result.removedPaymentIds).toEqual(["gone"]);
  });

  it("bounds what one order can hold: stored removal ids stop growing at the cap, and so do the payments (the stored ones always stay)", () => {
    const full = Array.from({ length: MAX_REMOVED_IDS_STORED }, (_, i) => `r${i}`);
    const pushed = order([], { removedPaymentIds: ["new1", "new2"] });
    expect(applyPaymentRules(pushed, stored(order([], { removedPaymentIds: full })), pushed).removedPaymentIds).toEqual(full);
    const nearly = full.slice(0, MAX_REMOVED_IDS_STORED - 1);
    expect(applyPaymentRules(pushed, stored(order([], { removedPaymentIds: nearly })), pushed).removedPaymentIds).toEqual([...nearly, "new1"]);

    const many = Array.from({ length: MAX_PAYMENTS_PER_ORDER }, (_, i) => pay(`p${i}`, 1));
    const extra = order([pay("late", 1)]);
    const result = applyPaymentRules(extra, stored(order(many)), extra);
    expect(result.payments).toEqual(many);
    // A payment the order already holds is still taken as pushed at the cap.
    const edited = order([pay("p0", 99)]);
    expect((applyPaymentRules(edited, stored(order(many)), edited).payments as { amountMinor: number }[])[0]!.amountMinor).toBe(99);
  });
});

describe("newHistoryEntries", () => {
  const e = (id: string, extra: Record<string, unknown> = {}) => ({ id, field: "payment", oldValue: "2000", newValue: "removed", note: null, at: AT, ...extra });

  it("an entry is new when no stored entry has its id (or, with no id, equals it); each entry once", () => {
    expect(newHistoryEntries([e("h1")], [e("h1"), e("h2"), e("h2")])).toEqual([e("h2")]);
    const { id: _id, ...anonymous } = e("x");
    void _id;
    expect(newHistoryEntries([anonymous], [anonymous])).toEqual([]);
    expect(newHistoryEntries([], [anonymous, { ...anonymous, oldValue: "5" }])).toHaveLength(2);
    expect(newHistoryEntries(undefined, undefined)).toEqual([]);
    expect(newHistoryEntries("junk", ["junk", 7, e("h3")])).toEqual([e("h3")]);
  });
});

describe("legacyRemovedIds (the released iOS 1.0 deletes by absence and logs `payment: <amount> -> removed`)", () => {
  const entry = (amount: string | number, id = `h${amount}`, extra: Record<string, unknown> = {}) => ({ id, field: "payment", oldValue: amount, newValue: "removed", note: null, at: "2026-10-03T09:00:00.000Z", ...extra });
  const legacy = (storedPayments: unknown[], incomingPayments: unknown[] | undefined, entries: unknown[]) => legacyRemovedIds(storedPayments as never, incomingPayments as never, entries as never);

  it("removes the stored payment of that amount the pushed copy lacks, when exactly as many are missing as there are entries", () => {
    expect(legacy([A, B], [B], [entry("2000")])).toEqual(["a"]);
    expect(legacy([A, B], [], [entry("2000")])).toEqual(["a"]); // B is missing too, but no entry is for 3,000: kept
    expect(legacy([A, pay("a2", 2000)], [], [entry("2000", "h1"), entry("2000", "h2")])).toEqual(["a", "a2"]);
    expect(legacy([A, B], [], [entry("2000", "h1"), entry("3000", "h2")])).toEqual(["a", "b"]);
    expect(legacy([A], [], [entry(2000)])).toEqual(["a"]); // an amount that is a number is an amount too
  });

  it("ambiguous means keep: more or fewer payments of that amount are missing than there are entries", () => {
    expect(legacy([A, pay("a2", 2000)], [], [entry("2000")])).toEqual([]); // one may be another phone's payment this copy never saw
    expect(legacy([A], [], [entry("2000", "h1"), entry("2000", "h2")])).toEqual([]);
    expect(legacy([A], [A], [entry("2000")])).toEqual([]); // nothing is missing: the entry is about a payment the server never had
    expect(legacy([B], [], [entry("2000")])).toEqual([]);
  });

  it("only a removal entry with an amount counts: the field, the value and the amount are all checked", () => {
    expect(legacy([A], [], [entry("2000", "h1", { field: "paymentStatus" })])).toEqual([]);
    expect(legacy([A], [], [entry("2000", "h1", { newValue: "kept" })])).toEqual([]);
    for (const oldValue of ["two thousand", "", "-2000", "2000.5", null, undefined, true, 2000.5, "2000 BHD"]) {
      expect(legacy([A], [], [entry(oldValue as never)]), String(oldValue)).toEqual([]);
    }
  });

  it("a payment recorded after the removal cannot be the one removed", () => {
    const later = pay("late", 2000, { paidAt: "2026-10-03T10:00:00.000Z" }); // after the entry's 09:00
    expect(legacy([later], [], [entry("2000")])).toEqual([]);
    expect(legacy([A, later], [], [entry("2000")])).toEqual(["a"]); // A (08:00) is the only candidate
    expect(legacy([pay("x", 2000, { paidAt: "not a date" })], [], [entry("2000")])).toEqual(["x"]); // unreadable times do not block
  });

  it("needs the pushed list to compare with, and an id to record: a payment with no id is never removed this way", () => {
    expect(legacy([A], undefined, [entry("2000")])).toEqual([]);
    expect(legacy([pay(undefined, 2000)], [], [entry("2000")])).toEqual([]);
  });
});

describe("applyPaymentRules / the released iOS 1.0 shape", () => {
  const removal = { id: "h9", field: "payment", oldValue: "2000", newValue: "removed", note: null, at: "2026-10-03T09:00:00.000Z" };

  it("a push without removedPaymentIds, the payment missing, and a new removal entry for its amount: removed and recorded", () => {
    const pushed = order([B], { paymentStatus: "deposit", changes: [removal] });
    const result = applyPaymentRules(pushed, stored(order([A, B], { paymentStatus: "paid" })), pushed);
    expect(idsOf(result)).toEqual(["b"]);
    expect(result.removedPaymentIds).toEqual(["a"]);
    expect(result.paymentStatus).toBe("deposit");
  });

  it("without that entry the payment is kept; and an entry that is already stored is not new (a retry changes nothing more)", () => {
    const pushed = order([B]);
    expect(idsOf(applyPaymentRules(pushed, stored(order([A, B])), pushed))).toEqual(["a", "b"]);
    const removed = order([B], { changes: [removal] });
    const after = applyPaymentRules(removed, stored(order([A, B])), removed);
    expect(after.removedPaymentIds).toEqual(["a"]);
    // The same push again (its entry is stored now, so it is not new): A is recorded as removed, and stays so.
    expect(idsOf(applyPaymentRules(removed, stored(after), removed))).toEqual(["b"]);
    // A copy from before the removal, still holding A, brings nothing back.
    const stale = order([A, B]);
    expect(idsOf(applyPaymentRules(stale, stored(after), stale))).toEqual(["b"]);
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

// Random interleavings of phones that record, delete, push (with the base they happen to hold) and pull, some of them older apps
// that do not write removedPaymentIds, ids spelled in either case: whatever happens, a payment that was pushed is on the order
// unless its id was pushed as removed, a removed id never comes back, removal ids never shrink, and the same push twice is the
// same order.
describe("applyPaymentRules / invariants under random interleavings", () => {
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  interface Phone { payments: ReturnType<typeof pay>[]; removed: string[]; writesRemovedIds: boolean }
  const lower = (id: string) => id.toLowerCase();

  it("200 seeded runs of 60 steps: no stored payment is lost except by a removal id, nothing removed returns, ids only grow, a repeated push changes nothing", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed);
      const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
      let server: Record<string, unknown> = order([]);
      const phones: Phone[] = [0, 1, 2, 3].map((i) => ({ payments: [], removed: [], writesRemovedIds: i < 3 }));
      const pushedIds = new Set<string>();
      const removedIds = new Set<string>();
      let counter = 0;

      for (let step = 0; step < 60; step++) {
        const phone = pick(phones);
        const action = rand();
        if (action < 0.25) {
          const id = `P${seed}-${counter++}`;
          phone.payments.push(pay(rand() < 0.5 ? id : id.toLowerCase(), 100 * (1 + Math.floor(rand() * 40))));
        } else if (action < 0.4 && phone.payments.length > 0) {
          const [gone] = phone.payments.splice(Math.floor(rand() * phone.payments.length), 1);
          if (phone.writesRemovedIds) phone.removed.push(rand() < 0.5 ? gone!.id! : gone!.id!.toUpperCase());
        } else if (action < 0.55) {
          phone.payments = (server.payments as ReturnType<typeof pay>[]).map((p) => ({ ...p }));
          phone.removed = phone.writesRemovedIds ? [...((server.removedPaymentIds as string[] | undefined) ?? [])] : [];
        } else {
          const before = server;
          const extra: Record<string, unknown> = phone.writesRemovedIds && (phone.removed.length > 0 || rand() < 0.3) ? { removedPaymentIds: [...phone.removed] } : {};
          const pushed = order(phone.payments.map((p) => ({ ...p })), { paymentStatus: pick(["unpaid", "deposit", "paid"]), notes: `step ${step}`, ...extra });
          server = JSON.parse(JSON.stringify(applyPaymentRules(pushed, stored(before), pushed))); // stored as JSON: no array is shared with a phone

          for (const p of phone.payments) pushedIds.add(lower(p.id!));
          for (const id of phone.writesRemovedIds ? phone.removed : []) removedIds.add(lower(id));

          const onOrder = new Set((server.payments as { id: string }[]).map((p) => lower(p.id)));
          for (const id of pushedIds) expect(onOrder.has(id) || removedIds.has(id), `seed ${seed} step ${step}: ${id} was lost`).toBe(true);
          for (const id of removedIds) expect(onOrder.has(id), `seed ${seed} step ${step}: ${id} came back`).toBe(false);
          expect(new Set(((server.removedPaymentIds as string[] | undefined) ?? []).map(lower)), `seed ${seed} step ${step}: ids shrank`).toEqual(removedIds);
          expect((server.payments as { id: string }[]).length, "each payment once").toBe(onOrder.size);
          expect(JSON.parse(JSON.stringify(applyPaymentRules(pushed, stored(server), pushed))), `seed ${seed} step ${step}: a repeated push changed the order`).toEqual(server);
        }
      }
    }
  });
});
