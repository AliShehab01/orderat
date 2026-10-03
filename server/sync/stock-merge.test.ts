import { describe, expect, it } from "vitest";
import { MAX_STOCK_MOVES, mergeProductStock } from "./stock-merge.ts";

// Second review (3 Oct 2026), L2: a product's stock is the result of its moves, each applied exactly once.
// These are the pure rules; push-pull.test.ts runs the same scenarios through the real push path.

const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 8, minute)).toISOString();
const move = (id: string, delta: number, minute: number, reason = "orderConfirmed", orderId: string | null = `o-${id}`) => ({ id, delta, reason, orderId, note: null, at: at(minute) });
const product = (stockQuantity: number, stockMoves: unknown[], extra: Record<string, unknown> = {}) => ({ nameAr: "كيك", priceMinor: 6500, trackStock: true, stockQuantity, lowStockThreshold: 3, stockMoves, updatedAt: at(0), ...extra });
const ids = (data: Record<string, unknown> | undefined) => (data?.stockMoves as { id: string }[]).map((m) => m.id);

const a = move("a", -3, 1);
const b = move("b", -2, 2);

describe("mergeProductStock / the rebase", () => {
  it("two phones from the same copy: A took 3, stale B took 2 -> stock 5 with both moves, newest applied first", () => {
    const stored = product(7, [a], { updatedAt: at(1) });
    const fromB = product(8, [b], { updatedAt: at(2) });
    const merged = mergeProductStock(stored, fromB, true)!;
    expect(merged).toEqual(product(5, [b, a], { updatedAt: at(2) }));
    expect(mergeProductStock(stored, fromB, false)).toEqual(merged);
  });

  it("is idempotent: the same push again (a retry) applies nothing, from either side", () => {
    const stored = product(7, [a]);
    const fromB = product(8, [b]);
    const once = mergeProductStock(stored, fromB, true)!;
    for (const mayEdit of [true, false]) {
      const twice = mergeProductStock(once, fromB, mayEdit)!;
      expect(twice.stockQuantity).toBe(5);
      expect(ids(twice)).toEqual(["b", "a"]);
    }
    // A's own stale retry on top of the merged copy changes nothing either.
    expect(mergeProductStock(once, product(7, [a]), true)).toMatchObject({ stockQuantity: 5 });
  });

  it("applies only the moves the stored copy lacks: a copy that has seen A and adds b lands exactly b", () => {
    const stored = product(7, [a]);
    const incoming = product(5, [b, a]);
    expect(mergeProductStock(stored, incoming, true)).toBe(incoming); // up to date for stock: stored as sent
    const staff = mergeProductStock(stored, incoming, false)!;
    expect(staff).toEqual({ ...stored, stockQuantity: 5, stockMoves: [b, a], updatedAt: at(0) });
  });

  it("a stale copy takes the stored quantity as its start, never its own: a copy with no moves of its own changes only its fields", () => {
    const stored = product(7, [a]);
    const rename = product(10, [], { nameAr: "كيك الشوكولاتة", priceMinor: 7000, updatedAt: at(5) });
    expect(mergeProductStock(stored, rename, true)).toEqual(product(7, [a], { nameAr: "كيك الشوكولاتة", priceMinor: 7000, updatedAt: at(5) }));
  });

  it("an up-to-date copy (it holds every stored move) is stored exactly as sent, a manual correction included", () => {
    const stored = product(7, [a]);
    const correction = { id: "k", delta: 5, reason: "correction", orderId: null, note: null, at: at(3) };
    const incoming = product(12, [correction, a], { priceMinor: 7000 });
    expect(mergeProductStock(stored, incoming, true)).toBe(incoming);
    // A copy with no stock history at all is stored as sent too (nothing to merge it with).
    const noHistory = { nameAr: "كيك", priceMinor: 1 };
    expect(mergeProductStock(stored, noHistory, true)).toBe(noHistory);
  });

  it("ids are compared without case (iOS sends an uppercase UUID, Android and the web lowercase)", () => {
    const upper = move("5F0D9C3E-2A41-4C57-9B1E-0C7A2D8E6F11", -3, 1);
    const lower = { ...upper, id: upper.id.toLowerCase() };
    const stored = product(7, [lower]);
    const fromB = product(8, [b]);
    const incomingWithUpper = product(5, [b, upper]);
    expect(mergeProductStock(stored, incomingWithUpper, true)).toBe(incomingWithUpper); // the same move, not a new one
    const merged = mergeProductStock(stored, fromB, false)!;
    expect(merged.stockQuantity).toBe(5);
    expect(mergeProductStock(merged, product(7, [upper]), true)).toMatchObject({ stockQuantity: 5 }); // the upper-case copy is not applied again
  });

  it("a move with no id (a legacy Android row) is identified by its fields", () => {
    const { id: _id, ...legacy } = move("x", -1, 1, "orderConfirmed", "o1");
    void _id;
    const stored = product(9, [legacy]);
    const incoming = product(8, [{ ...legacy }, { ...b }]);
    // The legacy move is shared; only b is new -> 9 - 2.
    expect(mergeProductStock(stored, incoming, false)).toMatchObject({ stockQuantity: 7 });
    expect(mergeProductStock(stored, product(10, [{ ...legacy, delta: -2 }]), false)).toBeUndefined(); // a different, id-less move is a new one; no id: not order-driven material
  });

  it("keeps the list newest first and capped at 50, dropping the oldest", () => {
    const stored = product(100, Array.from({ length: 50 }, (_, i) => move(`s${49 - i}`, 1, 40 - i)));
    const fresh = move("n", -1, 59);
    const fromStale = product(99, [fresh, ...stored.stockMoves.slice(1) as unknown[]]);
    const merged = mergeProductStock(stored, fromStale, true)!;
    expect(merged.stockMoves as unknown[]).toHaveLength(MAX_STOCK_MOVES);
    expect(ids(merged)[0]).toBe("n");
  });

  it("keeps the quantity under both names the web has used (stockQuantity, qty)", () => {
    const stored = { ...product(7, [a]), qty: 7 };
    const fromB = { ...product(8, [b]), qty: 8 };
    expect(mergeProductStock(stored, fromB, true)).toMatchObject({ stockQuantity: 5, qty: 5 });
    const onlyQty = { nameAr: "x", qty: 7, stockMoves: [a] };
    expect(mergeProductStock(onlyQty, { nameAr: "x", qty: 8, stockMoves: [b] }, true)).toMatchObject({ stockQuantity: 5, qty: 5 });
  });

  it("stamps the merged copy with the later updatedAt, so no phone sees it as older than its own", () => {
    expect(mergeProductStock(product(7, [a], { updatedAt: at(9) }), product(8, [b], { updatedAt: at(2) }), true)).toMatchObject({ updatedAt: at(9) });
    expect(mergeProductStock(product(7, [a], { updatedAt: at(1) }), product(8, [b], { updatedAt: at(2) }), true)).toMatchObject({ updatedAt: at(2) });
  });
});

describe("mergeProductStock / staff without products", () => {
  const stored = product(7, [a]);

  it("never writes the other fields or the quantity: they come from the stored copy; only order-driven moves count", () => {
    const fromB = product(999, [b], { priceMinor: 1, nameAr: "x", trackStock: false });
    expect(mergeProductStock(stored, fromB, false)).toEqual({ ...stored, stockQuantity: 5, stockMoves: [b, a], updatedAt: at(0) });
  });

  it("refuses anything but order-driven moves with an id, a whole non-zero delta and an order id", () => {
    const bad = [
      { ...b, reason: "correction" },
      { ...b, reason: "received" },
      { ...b, orderId: null },
      { ...b, orderId: "" },
      { ...b, id: "" },
      { ...b, delta: 0 },
      { ...b, delta: -1.5 },
      { ...b, delta: "-2" },
    ];
    for (const m of bad) expect(mergeProductStock(stored, product(8, [m]), false), JSON.stringify(m)).toBeUndefined();
    for (const reason of ["orderConfirmed", "orderCancelled", "orderEdited"]) {
      expect(mergeProductStock(stored, product(8, [{ ...b, reason }]), false), reason).toBeDefined();
    }
  });

  it("applies a duplicated move once, and refuses a list longer than 50", () => {
    expect(mergeProductStock(stored, product(8, [b, { ...b }]), false)).toMatchObject({ stockQuantity: 5 });
    const many = Array.from({ length: 51 }, (_, i) => move(`m${i}`, -1, i));
    expect(mergeProductStock(stored, product(0, many), false)).toBeUndefined();
  });

  it("a push that adds no move stores nothing: a change beyond stock is refused, a stock-only difference is a no-op", () => {
    expect(mergeProductStock(stored, { ...stored, priceMinor: 1 }, false)).toBeUndefined();
    expect(mergeProductStock(stored, { ...stored, stockQuantity: 100 }, false)).toBe(stored);
    expect(mergeProductStock(stored, product(10, []), false)).toBe(stored);
  });

  it("stored moves are never rewritten by a push: a changed copy of a stored move is ignored", () => {
    const tampered = product(7, [b, { ...a, delta: -50 }]);
    const merged = mergeProductStock(stored, tampered, false)!;
    expect(merged.stockMoves).toEqual([b, a]);
    expect(merged.stockQuantity).toBe(5);
  });
});

describe("mergeProductStock / trimmed histories (lists keep the last 50 moves)", () => {
  const received = (n: number) => ({ id: `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
  /** `count` moves, newest first, the newest being h<newest> */
  const window = (newest: number, count: number) => Array.from({ length: count }, (_, i) => received(newest - i));
  const newMove = (id: string, delta: number) => ({ id, delta, reason: "orderConfirmed", orderId: `o-${id}`, note: null, at: "2026-10-03T09:00:00.000Z" });

  it("a move missing from a full list that is older than its oldest move was trimmed: it is not applied again", () => {
    const stored = product(100, window(59, 50)); // h59 ... h10
    const old = product(55, window(49, 50)); // an older copy, h49 ... h0: shares h49..h10, still holds h9..h0
    const merged = mergeProductStock(stored, old, true)!;
    expect(merged.stockQuantity).toBe(100); // nothing of h9..h0 added again
    expect(ids(merged)).toEqual(ids(stored));
  });

  it("... but a new move on that stale copy still lands, once, and the oldest stored move falls off the end", () => {
    const stored = product(100, window(59, 50));
    const stale = product(55, [newMove("n1", -2), ...window(49, 49)]);
    const merged = mergeProductStock(stored, stale, true)!;
    expect(merged.stockQuantity).toBe(98);
    expect(merged.stockMoves as unknown[]).toHaveLength(50);
    expect(ids(merged).slice(0, 3)).toEqual(["n1", "h59", "h58"]);
    expect(ids(merged)).not.toContain("h10"); // trimmed off the end by the cap
    // Again: n1 is stored now, so the retry applies nothing.
    expect(mergeProductStock(merged, stale, true)).toMatchObject({ stockQuantity: 98 });
  });

  it("a stored move missing from a FULL incoming list counts when it is newer than that list's oldest move", () => {
    // The incoming copy is full (h49..h0, plus nothing new); the stored list has h60 on top that it lacks.
    const stored = product(120, window(60, 50));
    const stale = product(60, [newMove("n2", -1), ...window(49, 49)]);
    const merged = mergeProductStock(stored, stale, true)!;
    expect(merged.stockQuantity).toBe(119);
    expect(ids(merged)[0]).toBe("n2");
  });

  it("a full list that lacks only moves older than its own oldest one is not stale: stored as sent", () => {
    // Stored: h59..h10 (full). Incoming: h59..h10 plus a new move on top, trimmed back to 50 (h59..h11 + n3).
    const stored = product(100, window(59, 50));
    const incoming = product(98, [newMove("n3", -2), ...window(59, 49)]);
    expect(mergeProductStock(stored, incoming, true)).toBe(incoming);
  });

  it("with no move in common, a list that is not full counts every move of the other as missing (a product that had no history)", () => {
    expect(mergeProductStock(product(7, [a]), product(8, [b]), true)).toMatchObject({ stockQuantity: 5 });
    expect(mergeProductStock(product(10, []), product(8, [b]), true)).toMatchObject({ stockQuantity: 8 });
  });

  it("with no move in common and a full stored list, an incoming move counts only when it is newer than the stored oldest", () => {
    const stored = product(100, window(59, 50));
    const ancient = product(5, [received(3), received(2)]); // no common move, both older than h10
    expect(mergeProductStock(stored, ancient, true)).toMatchObject({ stockQuantity: 100 });
    const recent = product(5, [newMove("n4", -4)]);
    expect(mergeProductStock(stored, recent, true)).toMatchObject({ stockQuantity: 96 });
  });
});
