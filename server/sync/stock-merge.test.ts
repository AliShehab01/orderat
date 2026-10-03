import { describe, expect, it } from "vitest";
import { MAX_STOCK_MOVES, moveKey, pairKey, planProductPush, type Json, type StockFacts } from "./stock-merge.ts";

// A product's stock is the result of its moves, each applied exactly once (second review L2; third review F1-F3,
// 3 Oct 2026). These are the pure rules; push-pull.test.ts runs the same scenarios through the real push path.

const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 8, minute)).toISOString();
const move = (id: string, delta: number, minute: number, reason = "orderConfirmed", orderId: string | null = `o-${id}`) => ({ id, delta, reason, orderId, note: null, at: at(minute) });
const product = (stockQuantity: number, stockMoves: unknown[], extra: Record<string, unknown> = {}): Json => ({ nameAr: "كيك", priceMinor: 6500, trackStock: true, stockQuantity, lowStockThreshold: 3, stockMoves, updatedAt: at(0), ...extra });
const ids = (data: Json | undefined) => (data?.stockMoves as { id: string }[]).map((m) => m.id);

const a = move("a", -3, 1);
const b = move("b", -2, 2);

interface OrderSpec { units?: number; ledger?: boolean; seq?: number }
/** Facts for product p1: the orders named, each with `units` of p1 on its lines (default 10), and what stock_ops holds. */
function facts(over: { orders?: Record<string, OrderSpec>; known?: string[]; applied?: Record<string, number> } = {}): StockFacts {
  return {
    knownOps: new Set(over.known ?? []),
    orders: new Map(Object.entries(over.orders ?? {}).map(([id, o]) => [id, { seq: o.seq ?? 1, ledgerBacked: o.ledger === true, units: new Map([["p1", o.units ?? 10]]) }])),
    applied: new Map(Object.entries(over.applied ?? {}).map(([orderId, units]) => [pairKey(orderId, "p1"), units])),
  };
}
/** Non-ledger orders `o-<id>` for each id, with room for every move of these tests. */
const orders = (...names: string[]) => Object.fromEntries(names.map((n) => [`o-${n}`, {} as OrderSpec]));
const plan = (stored: Json, incoming: Json, mayEdit: boolean, f: StockFacts = facts({ orders: orders("a", "b", "c", "k", "x", "n") })) => planProductPush("p1", stored, incoming, mayEdit, f);

describe("planProductPush / the rebase", () => {
  it("two phones from the same copy: A took 3, stale B took 2 -> stock 5 with both moves, newest applied first", () => {
    const stored = product(7, [a], { updatedAt: at(1) });
    const fromB = product(8, [b], { updatedAt: at(2) });
    const merged = plan(stored, fromB, true)!;
    expect(merged.data).toEqual(product(5, [b, a], { updatedAt: at(2) }));
    expect(plan(stored, fromB, false)!.data).toEqual(merged.data);
    expect(merged.ops).toEqual([{ opId: moveKey(b), outcome: "applied" }]);
    // The server's own books for the order: b took 2 of o-b (no row before).
    expect(merged.orderStock).toEqual([{ orderId: "o-b", productId: "p1", expect: null, units: 2, write: true }]);
  });

  it("is idempotent: the same push again (a retry) applies nothing, from either side, because stock_ops holds b", () => {
    const stored = product(5, [b, a]);
    const known = facts({ known: [moveKey(a), moveKey(b)], orders: orders("a", "b") });
    for (const mayEdit of [true, false]) {
      const again = plan(stored, product(8, [b]), mayEdit, known)!;
      expect(again.data.stockQuantity).toBe(5);
      expect(ids(again.data)).toEqual(["b", "a"]);
      expect(again.ops).toEqual([]);
    }
    // A's own stale retry on top of the merged copy changes nothing either.
    expect(plan(stored, product(7, [a]), true, known)!.data).toMatchObject({ stockQuantity: 5 });
  });

  it("applies only the moves the stored copy lacks: a copy that has seen A and adds b lands exactly b", () => {
    const stored = product(7, [a]);
    const incoming = product(5, [b, a]);
    expect(plan(stored, incoming, true)!.data).toEqual({ ...incoming, updatedAt: at(0) });
    expect(plan(stored, incoming, false)!.data).toEqual({ ...stored, stockQuantity: 5, stockMoves: [b, a], updatedAt: at(0) });
  });

  it("the stored quantity is the start, never the pushed one: a pushed 999 changes nothing but the moves' deltas", () => {
    const stored = product(7, [a]);
    const lying = product(999, [b], { priceMinor: 7000 });
    expect(plan(stored, lying, true)!.data).toMatchObject({ stockQuantity: 5, priceMinor: 7000 });
    expect(plan(stored, lying, false)!.data).toMatchObject({ stockQuantity: 5, priceMinor: 6500 });
  });

  it("a stale copy with no moves of its own changes only its fields: the stored stock stays (an owner's rename)", () => {
    const stored = product(7, [a]);
    const rename = product(10, [], { nameAr: "كيك الشوكولاتة", priceMinor: 7000, updatedAt: at(5) });
    expect(plan(stored, rename, true)!.data).toEqual(product(7, [a], { nameAr: "كيك الشوكولاتة", priceMinor: 7000, updatedAt: at(5) }));
  });

  it("an up-to-date copy that adds a manual correction: the quantity is the stored one plus its delta, the fields are as sent", () => {
    const stored = product(7, [a]);
    const correction = { id: "k", delta: 5, reason: "correction", orderId: null, note: null, at: at(3) };
    const incoming = product(12, [correction, a], { priceMinor: 7000, updatedAt: at(3) });
    const result = plan(stored, incoming, true)!;
    expect(result.data).toEqual(incoming);
    expect(result.ops).toEqual([{ opId: moveKey(correction), outcome: "applied" }]);
    // A pushed quantity that does not agree with the moves is not believed.
    expect(plan(stored, { ...incoming, stockQuantity: 1000 }, true)!.data).toMatchObject({ stockQuantity: 12 });
  });

  it("a push with no move at all keeps the earlier behaviour: stored as sent while up to date (a new product's opening quantity, a manual edit)", () => {
    const stored = product(7, [a]);
    const edit = product(20, [a], { updatedAt: at(4) });
    expect(plan(stored, edit, true)!.data).toBe(edit);
    // A copy with no stock history at all is stored as sent too (nothing to merge it with).
    const noHistory = { nameAr: "كيك", priceMinor: 1 };
    expect(plan(stored, noHistory, true)!.data).toBe(noHistory);
  });

  it("ids are compared without case (iOS sends an uppercase UUID, Android and the web lowercase)", () => {
    const upper = move("5F0D9C3E-2A41-4C57-9B1E-0C7A2D8E6F11", -3, 1);
    const lower = { ...upper, id: upper.id.toLowerCase() };
    const stored = product(7, [lower]);
    const incomingWithUpper = product(5, [b, upper]);
    // The same move, not a new one: only b lands.
    expect(plan(stored, incomingWithUpper, true)!.data.stockQuantity).toBe(5);
    expect(plan(stored, incomingWithUpper, true)!.ops.map((o) => o.opId)).toEqual([moveKey(b)]);
    // stock_ops keys are lowercase, so an uppercase copy is known by its lowercase key.
    const known = facts({ known: [moveKey(lower)], orders: orders("b") });
    expect(plan(product(7, []), product(8, [upper]), true, known)!.data.stockQuantity).toBe(7);
  });

  it("a move with no id (a legacy Android row) is identified by its fields", () => {
    const { id: _id, ...legacy } = move("x", -1, 1, "orderConfirmed", "o-x");
    void _id;
    const stored = product(9, [legacy]);
    const incoming = product(8, [{ ...legacy }, { ...b }]);
    // The legacy move is shared; only b is new -> 9 - 2.
    expect(plan(stored, incoming, false)!.data).toMatchObject({ stockQuantity: 7 });
    // A different, id-less move is a new one; with no id it is not order-driven material for these staff.
    expect(plan(stored, product(10, [{ ...legacy, delta: -2 }]), false)).toBeUndefined();
    expect(moveKey(legacy).startsWith("f:")).toBe(true);
  });

  it("keeps the list newest first and capped at 50, dropping the oldest", () => {
    const stored = product(100, Array.from({ length: 50 }, (_, i) => move(`s${49 - i}`, 1, 40 - i, "received", null)));
    const fresh = move("n", -1, 59);
    const fromStale = product(99, [fresh, ...(stored.stockMoves as unknown[]).slice(1)]);
    const merged = plan(stored, fromStale, true)!.data;
    expect(merged.stockMoves as unknown[]).toHaveLength(MAX_STOCK_MOVES);
    expect(ids(merged)[0]).toBe("n");
  });

  it("keeps the quantity under both names the web has used (stockQuantity, qty)", () => {
    const stored = { ...product(7, [a]), qty: 7 };
    const fromB = { ...product(8, [b]), qty: 8 };
    expect(plan(stored, fromB, true)!.data).toMatchObject({ stockQuantity: 5, qty: 5 });
    const onlyQty = { nameAr: "x", qty: 7, stockMoves: [a] };
    expect(plan(onlyQty, { nameAr: "x", qty: 8, stockMoves: [b] }, true)!.data).toMatchObject({ stockQuantity: 5, qty: 5 });
  });

  it("stamps the merged copy with the later updatedAt, so no phone sees it as older than its own", () => {
    expect(plan(product(7, [a], { updatedAt: at(9) }), product(8, [b], { updatedAt: at(2) }), true)!.data).toMatchObject({ updatedAt: at(9) });
    expect(plan(product(7, [a], { updatedAt: at(1) }), product(8, [b], { updatedAt: at(2) }), true)!.data).toMatchObject({ updatedAt: at(2) });
  });

  it("records the ids of the stored list that stock_ops lacks, once, with the push (so a trimmed move stays known)", () => {
    const stored = product(7, [a, { ...a, id: "A" }]); // the same id twice, differing case: one key
    expect(plan(stored, product(7, [a]), true)!.listed).toEqual([moveKey(a)]);
    expect(plan(stored, product(7, [a]), true, facts({ known: [moveKey(a)] }))!.listed).toEqual([]);
  });
});

describe("planProductPush / staff without products", () => {
  const stored = product(7, [a]);

  it("never writes the other fields or the quantity: they come from the stored copy; only order-driven moves count", () => {
    const fromB = product(999, [b], { priceMinor: 1, nameAr: "x", trackStock: false });
    expect(plan(stored, fromB, false)!.data).toEqual({ ...stored, stockQuantity: 5, stockMoves: [b, a], updatedAt: at(0) });
  });

  it("refuses a push with anything but order-driven moves with an id, a whole non-zero delta and an order id", () => {
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
    for (const m of bad) expect(plan(stored, product(8, [m]), false), JSON.stringify(m)).toBeUndefined();
    for (const [reason, delta] of [["orderConfirmed", -2], ["orderCancelled", 2], ["orderEdited", -2]] as const) {
      expect(plan(stored, product(8, [{ ...b, reason, delta }]), false), reason).toBeDefined();
    }
  });

  it("applies a duplicated move once, and refuses a list longer than 50", () => {
    expect(plan(stored, product(8, [b, { ...b }]), false)!.data).toMatchObject({ stockQuantity: 5 });
    const many = Array.from({ length: 51 }, (_, i) => move(`m${i}`, -1, i));
    expect(plan(stored, product(0, many), false)).toBeUndefined();
  });

  it("a push that adds no move stores nothing: a change beyond stock is refused, a stock-only difference is a no-op", () => {
    expect(plan(stored, { ...stored, priceMinor: 1 }, false)).toBeUndefined();
    expect(plan(stored, { ...stored, stockQuantity: 100 }, false)!.data).toBe(stored);
    expect(plan(stored, product(10, []), false)!.data).toBe(stored);
  });

  it("stored moves are never rewritten by a push: a changed copy of a stored move is ignored", () => {
    const tampered = product(7, [b, { ...a, delta: -50 }]);
    const merged = plan(stored, tampered, false)!.data;
    expect(merged.stockMoves).toEqual([b, a]);
    expect(merged.stockQuantity).toBe(5);
  });
});

// Third review, F2: a prepare-only member could push a product move for an order that does not exist, an order
// the product is not on, an inflated or a wrong-direction delta, and the server added it to the stock.
describe("planProductPush / F2: an order-driven move only counts when its order allows it", () => {
  const stored = product(7, [a]);
  const stockAfter = (f: StockFacts, m: Json, mayEdit = false) => plan(stored, product(8, [m]), mayEdit, f)!.data.stockQuantity;

  it("a nonexistent order: not applied, and not recorded (a retry can still land once the order is there)", () => {
    const result = plan(stored, product(8, [{ ...b, orderId: "ghost", delta: 1_000_000, reason: "orderEdited" }]), false, facts())!;
    expect(result.data.stockQuantity).toBe(7);
    expect(result.ops).toEqual([]);
    expect(result.orderStock).toEqual([]);
  });

  it("an order the product is not on, and an order with room for fewer units, can only take what it holds", () => {
    const f = facts({ orders: { "o-b": { units: 1 } } });
    expect(stockAfter(f, b)).toBe(7); // takes 2 of an order with 1 unit of this product: refused
    expect(stockAfter(facts({ orders: { "o-b": { units: 2 } } }), b)).toBe(5);
    // "Not on the order" is zero units: nothing may be taken.
    const none = { seq: 1, ledgerBacked: false, units: new Map([["other", 5]]) };
    const notOn: StockFacts = { knownOps: new Set(), orders: new Map([["o-b", none]]), applied: new Map() };
    expect(stockAfter(notOn, b)).toBe(7);
  });

  it("an inflated delta and a wrong-direction delta never change the stock", () => {
    const f = facts({ orders: orders("b") });
    expect(stockAfter(f, { ...b, delta: -1_000_000 })).toBe(7);
    expect(stockAfter(f, { ...b, reason: "orderCancelled", delta: 1_000_000 })).toBe(7);
    expect(stockAfter(f, { ...b, reason: "orderCancelled", delta: 2 })).toBe(7); // nothing was taken to give back
    expect(stockAfter(f, { ...b, reason: "orderConfirmed", delta: 2 })).toBe(7); // a confirm that adds stock
    expect(stockAfter(f, { ...b, reason: "orderCancelled", delta: -2 })).toBe(7); // a cancel that takes it
  });

  it("a real move can never move more than the order holds: a cancel gives back exactly what the server holds as applied", () => {
    const f = facts({ orders: orders("b"), applied: { "o-b": 2 } });
    expect(stockAfter(f, { ...b, id: "c1", reason: "orderCancelled", delta: 2 })).toBe(9);
    expect(stockAfter(f, { ...b, id: "c2", reason: "orderCancelled", delta: 3 })).toBe(7); // 3 > 2 applied
    expect(stockAfter(f, { ...b, id: "c3", reason: "orderEdited", delta: -1 })).toBe(6); // one more unit is within the order's 10
  });

  it("an order that the server owns (it has a ledger): the move is ignored and recorded, the quantity is not the pushed one", () => {
    const f = facts({ orders: { "o-b": { ledger: true, seq: 42 } } });
    const result = plan(stored, product(8, [b]), true, f)!;
    expect(result.data.stockQuantity).toBe(7);
    expect(ids(result.data)).toEqual(["a"]); // never listed: the server's own move shows the deduction
    expect(result.ops).toEqual([{ opId: moveKey(b), outcome: "ignored" }]);
    expect(result.deps).toEqual([{ orderId: "o-b", seq: 42 }]);
    expect(result.orderStock).toEqual([]);
  });

  it("applied moves are recorded with the allocation row they changed, guarded by the row and the order as read", () => {
    const f = facts({ orders: { "o-b": { seq: 9 } }, applied: { "o-b": 1 } });
    const result = plan(stored, product(8, [b]), false, f)!;
    expect(result.orderStock).toEqual([{ orderId: "o-b", productId: "p1", expect: 1, units: 3, write: true }]);
    expect(result.deps).toEqual([{ orderId: "o-b", seq: 9 }]);
  });

  it("several moves of one order in one push are judged oldest first, each on the state the earlier ones left", () => {
    const confirm = move("c", -3, 1, "orderConfirmed", "o-c");
    const edit = move("e", -2, 2, "orderEdited", "o-c");
    const f = facts({ orders: { "o-c": { units: 5 } } });
    const result = plan(product(10, []), product(5, [edit, confirm]), false, f)!;
    expect(result.data.stockQuantity).toBe(5);
    expect(ids(result.data)).toEqual(["e", "c"]);
    expect(result.orderStock).toEqual([{ orderId: "o-c", productId: "p1", expect: null, units: 5, write: true }]);
    // The same two with room for only 4 units: the confirm lands, the edit would take it to 5 and does not.
    const tight = plan(product(10, []), product(5, [edit, confirm]), false, facts({ orders: { "o-c": { units: 4 } } }))!;
    expect(tight.data.stockQuantity).toBe(7);
    expect(ids(tight.data)).toEqual(["c"]);
  });

  it("an order from before the server's own books (no allocation row): what the product's stored moves say is the start", () => {
    const earlier = move("old", -3, 1, "orderConfirmed", "o-x");
    const withIt = product(7, [earlier]);
    const cancel = move("cx", 3, 2, "orderCancelled", "o-x");
    const f = facts({ orders: orders("x") });
    // The stored list shows o-x took 3: its cancel gives them back.
    expect(plan(withIt, product(7, [cancel, earlier]), false, f)!.data).toMatchObject({ stockQuantity: 10 });
    // With no trace of the confirm (a product that never held it), the same cancel has nothing to give back.
    expect(plan(product(7, []), product(7, [cancel]), false, f)!.data).toMatchObject({ stockQuantity: 7 });
  });

  it("manual moves (any other reason) are the owner's and products staff's: applied once and recorded", () => {
    const received = { id: "r1", delta: 20, reason: "received", orderId: null, note: null, at: at(3) };
    const result = plan(stored, product(27, [received, a]), true)!;
    expect(result.data).toMatchObject({ stockQuantity: 27, stockMoves: [received, a] });
    expect(result.ops).toEqual([{ opId: "id:r1", outcome: "applied" }]);
    expect(plan(stored, product(27, [received, a]), false)).toBeUndefined(); // staff without products: refused
    // An order reason with no order id is manual, so only for those who may edit products.
    const noOrder = { ...received, id: "r2", reason: "orderEdited", orderId: null };
    expect(plan(stored, product(27, [noOrder, a]), true)!.data.stockQuantity).toBe(27);
    expect(plan(stored, product(27, [noOrder, a]), false)).toBeUndefined();
  });
});

describe("planProductPush / histories of any length (stock_ops, not the 50-entry list, decides what was applied)", () => {
  const received = (n: number) => ({ id: `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
  /** `count` moves, newest first, the newest being h<newest> */
  const window = (newest: number, count: number) => Array.from({ length: count }, (_, i) => received(newest - i));
  const newMove = (id: string, delta: number) => ({ id, delta, reason: "orderConfirmed", orderId: `o-${id}`, note: null, at: "2026-10-03T09:00:00.000Z" });
  const order = (id: string) => ({ [`o-${id}`]: {} as OrderSpec });

  it("a stale copy holding moves the server trimmed off its list (but stock_ops knows) does not apply them again; one new move lands once", () => {
    const stored = product(100, window(59, 50)); // h59 ... h10; h0..h9 were trimmed off it long ago
    const known = facts({ known: Array.from({ length: 60 }, (_, i) => `id:h${i}`), orders: order("n1") });
    const stale = product(55, [newMove("n1", -2), ...window(49, 49)]);
    const merged = plan(stored, stale, true, known)!;
    expect(merged.data.stockQuantity).toBe(98);
    expect(merged.data.stockMoves as unknown[]).toHaveLength(50);
    expect(ids(merged.data).slice(0, 3)).toEqual(["n1", "h59", "h58"]);
    expect(ids(merged.data)).not.toContain("h10"); // trimmed off the end by the cap
  });

  it("F3: a first-time offline move older than the list's window is applied once: the window no longer decides", () => {
    const stored = product(100, window(59, 50));
    const old = { id: "offline", delta: 20, reason: "received", orderId: null, note: null, at: "2026-01-01T00:00:00.000Z" };
    const first = plan(stored, product(120, [old]), true, facts())!;
    expect(first.data.stockQuantity).toBe(120);
    expect(first.ops).toEqual([{ opId: "id:offline", outcome: "applied" }]);
    // Replayed: stock_ops knows it, so it is applied zero times.
    expect(plan(stored, product(120, [old]), true, facts({ known: ["id:offline"] }))!.data.stockQuantity).toBe(100);
  });

  it("a stored move missing from a FULL incoming list counts when it is newer than that list's oldest move (stale detection)", () => {
    const stored = product(120, window(60, 50));
    const stale = product(60, [newMove("n2", -1), ...window(49, 49)]);
    const known = facts({ known: Array.from({ length: 61 }, (_, i) => `id:h${i}`), orders: order("n2") });
    const merged = plan(stored, stale, true, known)!;
    expect(merged.data.stockQuantity).toBe(119);
    expect(ids(merged.data)[0]).toBe("n2");
  });

  it("a full list that lacks only moves older than its own oldest one is not stale: stored as sent", () => {
    const stored = product(100, window(59, 50));
    const incoming = product(98, [newMove("n3", -2), ...window(59, 49)]);
    const result = plan(stored, incoming, true, facts({ orders: order("n3") }))!;
    expect(result.data.stockQuantity).toBe(98);
    expect(ids(result.data).slice(0, 2)).toEqual(["n3", "h59"]);
  });
});
