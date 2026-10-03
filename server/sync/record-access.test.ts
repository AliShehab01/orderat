import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS, type Member, type Permissions } from "./permissions.ts";
import { canPull, decidePush, ENTITIES, newlyVisibleEntities, type Entity } from "./record-access.ts";

const staff = (flags: Partial<Permissions>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
const owner: Member = { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS }; // Deliberately empty permissions: role alone should be enough.
const noPerms = staff({});
const withOrders = staff({ orders: true });
const withPrepare = staff({ prepare: true });
const withMoney = staff({ money: true });
const withProducts = staff({ products: true });
const everyPermission = staff({ orders: true, prepare: true, money: true, products: true });

/** A stored, live record (decidePush's `existing`). */
const live = (data: Record<string, unknown>) => ({ data, deleted: false });
const FORBIDDEN = { allowed: false, reason: "forbidden" };

// One sample record per kind of thing a pull can carry: every entity, and the setting ids that differ.
const SAMPLES: [Entity, string, string][] = [
  ["shop", "shop-1", "shop"],
  ["setting", "subscription", "setting:subscription"],
  ["setting", "whatsappTemplates", "setting:whatsappTemplates"],
  ["setting", "deliveryDefaults", "setting:deliveryDefaults"],
  ["product", "p1", "product"],
  ["stock_move", "m1", "stock_move"],
  ["customer", "c1", "customer"],
  ["order", "o1", "order"],
  ["expense", "e1", "expense"],
  ["occasion", "x1", "occasion"],
];
const visibleTo = (member: Member) => SAMPLES.filter(([entity, id]) => canPull(member, entity, id)).map(([, , label]) => label);
const SETTINGS = ["setting:subscription", "setting:whatsappTemplates", "setting:deliveryDefaults"];

// Security review 1 Oct 2026, F01: staff used to pull every record but expenses whatever their flags.
describe("canPull (per entity and permission)", () => {
  it("the owner sees every record", () => {
    expect(visibleTo(owner)).toEqual(SAMPLES.map(([, , label]) => label));
  });

  it("a staff member with every flag off sees only the shop record and the subscription setting", () => {
    expect(visibleTo(noPerms)).toEqual(["shop", "setting:subscription"]);
  });

  it("orders: shop, settings, products, customers, orders and occasions, never expenses", () => {
    expect(visibleTo(withOrders)).toEqual(["shop", ...SETTINGS, "product", "stock_move", "customer", "order", "occasion"]);
  });

  it("prepare: what preparing takes (orders with their customers and products), never expenses", () => {
    expect(visibleTo(withPrepare)).toEqual(["shop", ...SETTINGS, "product", "stock_move", "customer", "order", "occasion"]);
  });

  it("money: orders with their payments, customers and products for the reports, and expenses", () => {
    expect(visibleTo(withMoney)).toEqual(["shop", ...SETTINGS, "product", "stock_move", "customer", "order", "expense", "occasion"]);
  });

  it("products: the catalogue and its stock, never customers, orders or expenses", () => {
    expect(visibleTo(withProducts)).toEqual(["shop", ...SETTINGS, "product", "stock_move", "occasion"]);
  });

  it("a staff member holding every flag sees everything the owner does", () => {
    expect(visibleTo(everyPermission)).toEqual(visibleTo(owner));
  });
});

describe("decidePush / the owner is unaffected", () => {
  it("may write, create and delete every entity, the subscription and deliveryDefaults settings included", () => {
    for (const entity of ENTITIES) {
      expect(decidePush(owner, entity, "r1", { x: 2 }, false, undefined)).toEqual({ allowed: true, data: { x: 2 } });
      expect(decidePush(owner, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual({ allowed: true, data: { x: 2 } });
      expect(decidePush(owner, entity, "r1", { x: 2 }, true, live({ x: 1 }))).toEqual({ allowed: true, data: { x: 2 } });
    }
    const report = { value: { status: "active", expiresAt: "2027-01-01T00:00:00.000Z", platform: "ios", updatedAt: "2026-09-29T12:00:00.000Z" } };
    expect(decidePush(owner, "setting", "subscription", report, false, live({ value: { status: "expired" } }))).toEqual({ allowed: true, data: report });
    expect(decidePush(owner, "setting", "deliveryDefaults", { value: { feeMinor: 500 } }, false, undefined)).toEqual({ allowed: true, data: { value: { feeMinor: 500 } } });
  });
});

describe("decidePush / a staff member with every flag off", () => {
  it("may push nothing at all: new, edited or deleted, of any entity", () => {
    for (const entity of ENTITIES) {
      for (const id of entity === "setting" ? ["subscription", "whatsappTemplates", "deliveryDefaults", "vat"] : ["r1"]) {
        expect(decidePush(noPerms, entity, id, { x: 2 }, false, undefined)).toEqual(FORBIDDEN);
        expect(decidePush(noPerms, entity, id, { x: 2 }, false, live({ x: 1 }))).toEqual(FORBIDDEN);
        expect(decidePush(noPerms, entity, id, { x: 2 }, true, live({ x: 1 }))).toEqual(FORBIDDEN);
      }
    }
  });
});

// The shop record and every setting are the owner's: staff used to be able to rewrite the shop (VAT,
// currency) and push any setting, such as a made-up VAT one. No setting synced today is per staff member
// (per-device preferences never sync), so none is left open.
describe("decidePush / shop and settings are owner only", () => {
  it("refuses staff, even with every permission, writing the shop record or any setting", () => {
    for (const member of [withOrders, withPrepare, withMoney, withProducts, everyPermission]) {
      expect(decidePush(member, "shop", "shop-1", { nameAr: "x", vat: { enabled: true, rateBps: 0 } }, false, live({ nameAr: "كيك" }))).toEqual(FORBIDDEN);
      for (const id of ["subscription", "whatsappTemplates", "deliveryDefaults", "vat"]) {
        expect(decidePush(member, "setting", id, { value: { x: 1 } }, false, undefined)).toEqual(FORBIDDEN);
        expect(decidePush(member, "setting", id, { value: { x: 1 } }, false, live({ value: {} }))).toEqual(FORBIDDEN);
        expect(decidePush(member, "setting", id, {}, true, live({ value: {} }))).toEqual(FORBIDDEN);
      }
    }
  });
});

describe("decidePush / orders", () => {
  it("full write of orders, customers and occasions, including creating and deleting them", () => {
    for (const entity of ["order", "customer", "occasion"] as const) {
      expect(decidePush(withOrders, entity, "r1", { x: 2 }, false, undefined)).toEqual({ allowed: true, data: { x: 2 } });
      expect(decidePush(withOrders, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual({ allowed: true, data: { x: 2 } });
      expect(decidePush(withOrders, entity, "r1", { x: 2 }, true, live({ x: 1 }))).toEqual({ allowed: true, data: { x: 2 } });
    }
  });

  it("nothing else: no expenses, products (beyond stock, below) or stock moves", () => {
    for (const entity of ["expense", "product", "stock_move"] as const) {
      expect(decidePush(withOrders, entity, "r1", { x: 2 }, false, undefined)).toEqual(FORBIDDEN);
      expect(decidePush(withOrders, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual(FORBIDDEN);
    }
  });

  it("orders wins over prepare and money when staff hold several (full write, not a merge)", () => {
    const both = staff({ orders: true, prepare: true, money: true });
    const edited = { status: "confirmed", customerName: "Fully rewritten" };
    expect(decidePush(both, "order", "r1", edited, false, live({ status: "pending", customerName: "Sara" }))).toEqual({ allowed: true, data: edited });
  });
});

describe("decidePush / money", () => {
  it("full write of expenses", () => {
    expect(decidePush(withMoney, "expense", "e1", { amountMinor: 10 }, false, undefined)).toEqual({ allowed: true, data: { amountMinor: 10 } });
    expect(decidePush(withMoney, "expense", "e1", { amountMinor: 10 }, true, live({ amountMinor: 5 }))).toEqual({ allowed: true, data: { amountMinor: 10 } });
  });

  it("nothing else but an order's money fields (below): no customers, products, occasions or stock moves", () => {
    for (const entity of ["customer", "product", "occasion", "stock_move"] as const) {
      expect(decidePush(withMoney, entity, "r1", { x: 2 }, false, undefined)).toEqual(FORBIDDEN);
      expect(decidePush(withMoney, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual(FORBIDDEN);
    }
  });

  it("expenses need money: refused for every other flag", () => {
    for (const member of [withOrders, withPrepare, withProducts]) {
      expect(decidePush(member, "expense", "e1", { amountMinor: 10 }, false, undefined)).toEqual(FORBIDDEN);
    }
  });
});

describe("decidePush / products", () => {
  it("full write of products and stock moves", () => {
    for (const entity of ["product", "stock_move"] as const) {
      expect(decidePush(withProducts, entity, "r1", { name: "Cake" }, false, undefined)).toEqual({ allowed: true, data: { name: "Cake" } });
      expect(decidePush(withProducts, entity, "r1", { name: "Cake" }, true, live({ name: "Old" }))).toEqual({ allowed: true, data: { name: "Cake" } });
    }
  });

  it("nothing else", () => {
    for (const entity of ["order", "customer", "occasion", "expense"] as const) {
      expect(decidePush(withProducts, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual(FORBIDDEN);
    }
  });
});

describe("decidePush / prepare", () => {
  it("nothing but an order's status fields (below) and order stock on products: no customers, occasions, stock moves", () => {
    for (const entity of ["customer", "occasion", "stock_move", "expense"] as const) {
      expect(decidePush(withPrepare, entity, "r1", { x: 2 }, false, undefined)).toEqual(FORBIDDEN);
      expect(decidePush(withPrepare, entity, "r1", { x: 2 }, false, live({ x: 1 }))).toEqual(FORBIDDEN);
    }
  });
});

// Staff who confirm or cancel orders without the products permission still move stock (review finding
// 3 of 29 Sep): a product push adds order-driven stock moves. Since the second review (3 Oct, L2) the push is
// merged onto the stored copy, never refused for being stale (more in stock-merge.test.ts): staff store the
// stored product plus the order-driven moves their copy adds, and nothing else of what they send.
describe("decidePush / product stock from staff handling orders", () => {
  const oldMove = { id: "m0", delta: 5, reason: "received", orderId: null, note: null, at: "2026-09-29T10:00:00.000Z" };
  const stored = { nameAr: "كيك", nameEn: null, priceMinor: 5000, trackStock: true, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [oldMove], createdAt: "2026-09-01T00:00:00.000Z" };
  const confirm = (orderId = "o1") => ({ id: "m1", delta: -2, reason: "orderConfirmed", orderId, note: null, at: "2026-09-30T10:00:00.000Z" });
  const pushed = (overrides: Record<string, unknown> = {}) => ({ ...stored, stockQuantity: 8, stockMoves: [confirm(), oldMove], ...overrides });

  it("lets staff with orders or prepare push an order's stock change to an existing product", () => {
    for (const member of [withOrders, withPrepare]) {
      expect(decidePush(member, "product", "p1", pushed(), false, live(stored))).toEqual({ allowed: true, data: pushed() });
    }
  });

  it("accepts a cancellation that puts stock back, and clients that spell nulls or dates differently", () => {
    const back = { id: "m2", delta: 2, reason: "orderCancelled", orderId: "o1", note: null, at: "2026-09-30T11:00:00.000Z" };
    const { nameEn: _omit, ...withoutNameEn } = stored;
    void _omit;
    const incoming = { ...withoutNameEn, createdAt: "2026-09-01T00:00:00Z", stockQuantity: 12, stockMoves: [back, oldMove], updatedAt: "2026-09-30T11:00:00.000Z" };
    expect(decidePush(withPrepare, "product", "p1", incoming, false, live(stored))).toEqual({
      allowed: true,
      data: { ...stored, stockQuantity: 12, stockMoves: [back, oldMove], updatedAt: "2026-09-30T11:00:00.000Z" },
    });
  });

  it("still refuses staff without orders or prepare, a new product, a deletion and a deleted product", () => {
    expect(decidePush(noPerms, "product", "p1", pushed(), false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withMoney, "product", "p1", pushed(), false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", pushed(), false, undefined)).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", pushed(), true, live(stored))).toEqual(FORBIDDEN);
    // A tombstone is not a product to move stock on: that push would bring it back.
    expect(decidePush(withOrders, "product", "p1", pushed(), false, { data: stored, deleted: true })).toEqual(FORBIDDEN);
  });

  it("stores nothing of a price, name or tracking change: those fields stay as stored, the stock moves land", () => {
    for (const change of [{ priceMinor: 1 }, { nameAr: "x" }, { trackStock: false }, { lowStockThreshold: 0 }]) {
      expect(decidePush(withOrders, "product", "p1", pushed(change), false, live(stored)), JSON.stringify(change)).toEqual({ allowed: true, data: pushed() });
    }
  });

  it("with no new move there is nothing to store: a change beyond stock is refused as before, a stock-only difference changes nothing", () => {
    expect(decidePush(withOrders, "product", "p1", { ...stored, priceMinor: 1 }, false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", { ...stored, stockQuantity: 100, priceMinor: 1 }, false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", { ...stored, stockQuantity: 100 }, false, live(stored))).toEqual({ allowed: true, data: stored });
  });

  it("the quantity is the stored one plus the new moves, never the pushed one", () => {
    expect(decidePush(withOrders, "product", "p1", pushed({ stockQuantity: 100 }), false, live(stored))).toEqual({ allowed: true, data: pushed() });
    expect(decidePush(withOrders, "product", "p1", pushed({ stockQuantity: 0 }), false, live(stored))).toEqual({ allowed: true, data: pushed() });
  });

  it("refuses a move that is not order-driven: a manual reason, no order id, no id, a fractional or zero delta", () => {
    const bad = [
      { ...confirm(), reason: "correction" },
      { ...confirm(), orderId: null },
      { ...confirm(), orderId: "" },
      { ...confirm(), id: undefined },
      { ...confirm(), delta: -2.5 },
      { ...confirm(), delta: 0 },
      { ...confirm(), delta: "2" },
    ];
    for (const move of bad) {
      expect(decidePush(withOrders, "product", "p1", pushed({ stockMoves: [move, oldMove] }), false, live(stored)), JSON.stringify(move)).toEqual(FORBIDDEN);
    }
  });

  it("stored moves stay as stored: a rewritten or dropped one changes nothing, a full list drops its oldest", () => {
    expect(decidePush(withOrders, "product", "p1", pushed({ stockMoves: [confirm(), { ...oldMove, delta: 50 }] }), false, live(stored))).toEqual({ allowed: true, data: pushed() });
    expect(decidePush(withOrders, "product", "p1", pushed({ stockMoves: [confirm()] }), false, live(stored))).toEqual({ allowed: true, data: pushed() });
    const full = Array.from({ length: 50 }, (_, i) => ({ ...oldMove, id: `h${i}`, delta: 1, at: `2026-09-29T09:${String(59 - i).padStart(2, "0")}:00.000Z` }));
    const fullStored = { ...stored, stockMoves: full };
    const decision = decidePush(withOrders, "product", "p1", { ...fullStored, stockQuantity: 8, stockMoves: [confirm(), ...full.slice(0, 49)] }, false, live(fullStored));
    expect(decision).toEqual({ allowed: true, data: { ...fullStored, stockQuantity: 8, stockMoves: [confirm(), ...full.slice(0, 49)] } });
  });

  it("the owner and staff with products write the product as sent while their copy is up to date for stock", () => {
    const edited = pushed({ priceMinor: 6000, nameAr: "كيك كبير" });
    for (const member of [owner, withProducts]) {
      expect(decidePush(member, "product", "p1", edited, false, live(stored))).toEqual({ allowed: true, data: edited });
    }
  });
});

// An existing order, as the phones and the web write it (docs/sme-phase-2-cloud.md "Record formats").
const AT = "2026-09-30T10:00:00.000Z";
const statusEntry = { id: "h1", field: "status", oldValue: "new", newValue: "confirmed", note: null, at: "2026-09-29T09:00:00.000Z" };
const storedOrder = {
  customerId: "c1",
  status: "ready",
  fulfillmentType: "delivery",
  dueAt: "2026-10-01T10:00:00.000Z",
  address: { area: "Riffa" },
  deliveryFeeMinor: 1000,
  paymentStatus: "unpaid",
  items: [{ id: "i1", productId: "p1", nameSnapshot: "Cake", quantity: 2, unitPriceMinor: 5000, unitCostMinor: 2000 }],
  payments: [],
  changes: [statusEntry],
  notes: "No nuts",
  createdAt: "2026-09-29T08:00:00.000Z",
  updatedAt: "2026-09-29T09:00:00.000Z",
};

describe("decidePush / prepare: an existing order's status fields only", () => {
  it("takes status, outForDeliveryAt, updatedAt and new status history; every other field stays as stored", () => {
    const outEntry = { id: "h2", field: "outForDelivery", oldValue: null, newValue: AT, note: null, at: AT };
    const incoming = {
      ...storedOrder,
      outForDeliveryAt: AT,
      updatedAt: AT,
      changes: [statusEntry, outEntry],
      // Attempts beyond preparing are ignored, never stored:
      customerId: "someone-else",
      items: [{ id: "sneaky", productId: "p1", nameSnapshot: "Cake", quantity: 99, unitPriceMinor: 1, unitCostMinor: 0 }],
      paymentStatus: "paid",
      payments: [{ id: "pay1", amountMinor: 11000, method: "cash", paidAt: AT }],
      deliveryFeeMinor: 0,
      invoiceNumber: 7,
    };
    expect(decidePush(withPrepare, "order", "o1", incoming, false, live(storedOrder))).toEqual({
      allowed: true,
      data: { ...storedOrder, outForDeliveryAt: AT, updatedAt: AT, changes: [statusEntry, outEntry] },
    });
  });

  it("moves an order on (ready → collected) and back, clearing outForDeliveryAt with null or by leaving it out", () => {
    const out = { ...storedOrder, outForDeliveryAt: AT };
    const collected = decidePush(withPrepare, "order", "o1", { ...out, status: "collected", outForDeliveryAt: null }, false, live(out));
    expect(collected).toEqual({ allowed: true, data: { ...out, status: "collected", outForDeliveryAt: null } });
    const { outForDeliveryAt: _omit, ...withoutKey } = out;
    void _omit;
    const back = decidePush(withPrepare, "order", "o1", { ...withoutKey, status: "ready" }, false, live(out));
    expect(back).toEqual({ allowed: true, data: withoutKey });
  });

  it("ignores an outForDeliveryAt that is neither a date nor null", () => {
    expect(decidePush(withPrepare, "order", "o1", { ...storedOrder, outForDeliveryAt: 42 }, false, live(storedOrder))).toEqual({ allowed: true, data: storedOrder });
  });

  it("history: keeps every stored entry as stored, adds only status entries, and drops other new ones", () => {
    const tampered = { ...statusEntry, newValue: "collected" };
    const payEntry = { id: "h3", field: "paymentStatus", oldValue: "unpaid", newValue: "paid", note: null, at: AT };
    const statusNow = { id: "h4", field: "status", oldValue: "ready", newValue: "collected", note: null, at: AT };
    const incoming = { ...storedOrder, status: "collected", changes: [tampered, payEntry, statusNow] };
    const decision = decidePush(withPrepare, "order", "o1", incoming, false, live(storedOrder));
    expect(decision).toEqual({ allowed: true, data: { ...storedOrder, status: "collected", changes: [statusEntry, statusNow] } });
    // A client that dropped stored entries (or sent none) never removes them.
    const dropped = decidePush(withPrepare, "order", "o1", { ...storedOrder, status: "collected", changes: [statusNow] }, false, live(storedOrder));
    expect(dropped).toEqual({ allowed: true, data: { ...storedOrder, status: "collected", changes: [statusNow, statusEntry] } });
  });

  it("cannot create a brand-new order, delete one, bring back a deleted one, or push one without a status", () => {
    expect(decidePush(withPrepare, "order", "o1", { status: "new" }, false, undefined)).toEqual(FORBIDDEN);
    expect(decidePush(withPrepare, "order", "o1", { status: "new" }, true, live(storedOrder))).toEqual(FORBIDDEN);
    expect(decidePush(withPrepare, "order", "o1", { ...storedOrder, status: "new" }, false, { data: storedOrder, deleted: true })).toEqual(FORBIDDEN);
    const { status: _omit, ...withoutStatus } = storedOrder;
    void _omit;
    expect(decidePush(withPrepare, "order", "o1", withoutStatus, false, live(storedOrder))).toEqual(FORBIDDEN);
  });
});

// Integrity review R3 (3 Oct 2026): each order records what it actually took out of stock, in
// `stockDeducted` { productId: units }, and gives back exactly that. Staff who only prepare orders confirm
// and cancel them, so the ledger is one of the fields their push may set. Second review (3 Oct 2026): L1 a
// missing ledger never clears a stored one; L3 a prepare-only push may only write a ledger that fits the
// stored order.
describe("decidePush / prepare: the stock ledger stockDeducted", () => {
  const fresh = { ...storedOrder, status: "newOrder" }; // a new order, items: p1 x 2
  const confirmedWith = (ledger: Record<string, number>) => ({ ...storedOrder, status: "confirmed", stockDeducted: ledger });
  const push = (stored: Record<string, unknown>, status: string, stockDeducted: unknown, extra: Record<string, unknown> = {}) => {
    const { stockDeducted: _stored, ...rest } = stored;
    void _stored;
    return decidePush(withPrepare, "order", "o1", { ...rest, status, stockDeducted, ...extra }, false, live(stored));
  };
  /** What the stored order becomes when only the status moves and the ledger stays as stored. */
  const statusOnly = (stored: Record<string, unknown>, status: string) => ({ allowed: true, data: { ...stored, status } });

  it("confirming takes a ledger that fits the order's lines, along with the status; every other field stays as stored", () => {
    const incoming = { ...fresh, status: "confirmed", stockDeducted: { p1: 2 }, customerId: "someone-else", deliveryFeeMinor: 0, items: [] };
    expect(decidePush(withPrepare, "order", "o1", incoming, false, live(fresh))).toEqual({ allowed: true, data: { ...fresh, status: "confirmed", stockDeducted: { p1: 2 } } });
    // Less than the order's units (a product that tracks stock only in part) and nothing at all are fine too.
    expect(push(fresh, "confirmed", { p1: 1 })).toEqual({ allowed: true, data: { ...fresh, status: "confirmed", stockDeducted: { p1: 1 } } });
    expect(push(fresh, "confirmed", { p1: 0 })).toEqual({ allowed: true, data: { ...fresh, status: "confirmed", stockDeducted: { p1: 0 } } });
    expect(push(fresh, "confirmed", {})).toEqual({ allowed: true, data: { ...fresh, status: "confirmed", stockDeducted: {} } });
    for (const into of ["ready", "collected"]) {
      expect(push(fresh, into, { p1: 2 })).toEqual({ allowed: true, data: { ...fresh, status: into, stockDeducted: { p1: 2 } } });
    }
  });

  it("sums several lines of the same product, and every key must be a product of the stored order", () => {
    const twoLines = { ...fresh, items: [...fresh.items, { id: "i2", productId: "p1", nameSnapshot: "Cake", quantity: 3, unitPriceMinor: 5000, unitCostMinor: 2000 }, { id: "i3", productId: null, nameSnapshot: "Free text", quantity: 9 }] };
    expect(push(twoLines, "confirmed", { p1: 5 })).toMatchObject({ data: { stockDeducted: { p1: 5 } } });
    expect(push(twoLines, "confirmed", { p1: 6 })).toEqual(statusOnly(twoLines, "confirmed"));
    for (const unrelated of [{ p2: 1 }, { p1: 2, p2: 0 }, { unrelated: 1_000_000 }, { null: 1 }]) {
      expect(push(fresh, "confirmed", unrelated), JSON.stringify(unrelated)).toEqual(statusOnly(fresh, "confirmed"));
    }
  });

  it("a ledger with inflated quantities is ignored: the order's status is handled, the ledger stays as stored", () => {
    expect(push(fresh, "confirmed", { p1: 3 })).toEqual(statusOnly(fresh, "confirmed"));
    expect(push(fresh, "confirmed", { p1: 1_000_000 })).toEqual(statusOnly(fresh, "confirmed"));
    const withLedger = confirmedWith({ p1: 2 });
    expect(push(withLedger, "ready", { p1: 99 })).toEqual(statusOnly(withLedger, "ready"));
  });

  it("acceptance: stored {p:3}, a prepare push may not rewrite it to an unrelated product, and may not change it with no move", () => {
    const order = { ...storedOrder, items: [{ id: "i1", productId: "p", nameSnapshot: "Cake", quantity: 3, unitPriceMinor: 5000, unitCostMinor: 2000 }], status: "confirmed", stockDeducted: { p: 3 } };
    expect(push(order, "confirmed", { unrelated: 1_000_000 })).toEqual({ allowed: true, data: order });
    expect(push(order, "ready", { unrelated: 1_000_000 })).toEqual(statusOnly(order, "ready"));
    expect(push(order, "ready", { p: 2 })).toEqual(statusOnly(order, "ready"));
    expect(push(order, "ready", { p: 3 })).toEqual(statusOnly(order, "ready"));
  });

  it("cancelling (or back to new) writes {} when the stock came back; any other ledger on the way out is ignored", () => {
    const withLedger = confirmedWith({ p1: 2 });
    for (const out of ["cancelled", "newOrder"]) {
      expect(push(withLedger, out, {})).toEqual({ allowed: true, data: { ...withLedger, status: out, stockDeducted: {} } });
      expect(push(withLedger, out, { p1: 1 }), out).toEqual(statusOnly(withLedger, out));
      expect(push(withLedger, out, { unrelated: 5 }), out).toEqual(statusOnly(withLedger, out));
    }
    // A legacy order (no ledger) cancelled: the phone derived and restored it, and writes {}.
    expect(push(storedOrder, "cancelled", {})).toEqual({ allowed: true, data: { ...storedOrder, status: "cancelled", stockDeducted: {} } });
  });

  it("an order that took nothing ({}) is cancelled and confirmed again with a ledger that fits", () => {
    const tookNothing = confirmedWith({});
    expect(push(tookNothing, "cancelled", {})).toEqual({ allowed: true, data: { ...tookNothing, status: "cancelled" } });
    const cancelled = { ...storedOrder, status: "cancelled", stockDeducted: {} };
    expect(push(cancelled, "confirmed", { p1: 2 })).toEqual({ allowed: true, data: { ...cancelled, status: "confirmed", stockDeducted: { p1: 2 } } });
    expect(push(cancelled, "confirmed", { p1: 3 })).toEqual(statusOnly(cancelled, "confirmed"));
  });

  it("moving on between deducted statuses keeps the ledger: the same ledger is taken, a different one is not", () => {
    const withLedger = confirmedWith({ p1: 2 });
    expect(push(withLedger, "ready", { p1: 2 })).toEqual(statusOnly(withLedger, "ready"));
    expect(push(withLedger, "ready", { p1: 1 })).toEqual(statusOnly(withLedger, "ready"));
    expect(push(withLedger, "ready", {})).toEqual(statusOnly(withLedger, "ready"));
  });

  it("a legacy order (no ledger) that stays in a deducted status may get the ledger the phone derived, when it fits", () => {
    expect(push(storedOrder, "collected", { p1: 2 })).toEqual({ allowed: true, data: { ...storedOrder, status: "collected", stockDeducted: { p1: 2 } } });
    expect(push(storedOrder, "collected", {})).toEqual({ allowed: true, data: { ...storedOrder, status: "collected", stockDeducted: {} } });
    expect(push(storedOrder, "collected", { p1: 9 })).toEqual(statusOnly(storedOrder, "collected"));
    expect(push(storedOrder, "collected", { p2: 1 })).toEqual(statusOnly(storedOrder, "collected"));
  });

  it("a ledger on an order that is not (and does not become) deducted is ignored: new, cancelled", () => {
    expect(push(fresh, "cancelled", { p1: 2 })).toEqual(statusOnly(fresh, "cancelled"));
    const cancelled = { ...storedOrder, status: "cancelled", stockDeducted: {} };
    expect(push(cancelled, "newOrder", { p1: 2 })).toEqual(statusOnly(cancelled, "newOrder"));
    expect(push(cancelled, "cancelled", { p1: 2 })).toEqual(statusOnly(cancelled, "cancelled"));
  });

  it("an unknown status takes no stock: confirming from it is a move into a deducted status", () => {
    const odd = { ...storedOrder, status: "somethingNew" };
    expect(push(odd, "confirmed", { p1: 2 })).toEqual({ allowed: true, data: { ...odd, status: "confirmed", stockDeducted: { p1: 2 } } });
  });

  it("accepts the edges: units 1,000,000, a 64-character product id, 200 products (when the order has them)", () => {
    const line = (productId: string, quantity: number) => ({ id: `i-${productId}`, productId, nameSnapshot: "x", quantity, unitPriceMinor: 1, unitCostMinor: 0 });
    const big = { ...fresh, items: [line("p1", 1_000_000)] };
    expect(push(big, "confirmed", { p1: 1_000_000 })).toMatchObject({ allowed: true, data: { stockDeducted: { p1: 1_000_000 } } });
    const longKey = "k".repeat(64);
    const longOrder = { ...fresh, items: [line(longKey, 3)] };
    expect(push(longOrder, "confirmed", { [longKey]: 3 })).toMatchObject({ allowed: true, data: { stockDeducted: { [longKey]: 3 } } });
    const twoHundred = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, 1]));
    const many = { ...fresh, items: Array.from({ length: 200 }, (_, i) => line(`p${i}`, 1)) };
    expect(push(many, "confirmed", twoHundred)).toMatchObject({ allowed: true, data: { stockDeducted: twoHundred } });
  });

  it("ignores an invalid ledger like any other bad prepare field: the stored one stays", () => {
    const stored = confirmedWith({ p1: 2 });
    const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, 1]));
    const bad: unknown[] = [
      "p1:2", 7, true, [{ p1: 2 }], [], // not a plain object
      { p1: -1 }, { p1: 1.5 }, { p1: 1_000_001 }, { p1: "2" }, { p1: null }, { p1: true }, { p1: { n: 2 } }, // not whole units 0..1,000,000
      { "": 2 }, { ["k".repeat(65)]: 2 }, // key not 1..64 characters
      tooMany, // more than 200 products
    ];
    for (const value of bad) {
      expect(push(stored, "confirmed", value), JSON.stringify(value)).toEqual({ allowed: true, data: stored });
    }
    // null is not a ledger either (unlike outForDeliveryAt, where null clears it)
    expect(push(stored, "confirmed", null)).toEqual({ allowed: true, data: stored });
  });

  it("an invalid ledger on an order that has none leaves it without one", () => {
    expect(push(fresh, "confirmed", { p1: -2 })).toEqual(statusOnly(fresh, "confirmed"));
  });

  it("L1: leaving the key out never clears the stored ledger: the order keeps what it took, and a later cancel can give it back", () => {
    const stored = confirmedWith({ p1: 2 });
    const { stockDeducted: _omit, ...withoutKey } = stored;
    void _omit;
    // An older app, or a stale copy, moves the order on (confirmed -> ready) without knowing the ledger.
    expect(decidePush(withPrepare, "order", "o1", { ...withoutKey, status: "ready" }, false, live(stored))).toEqual(statusOnly(stored, "ready"));
    const ready = { ...stored, status: "ready" };
    // The later cancel finds {p1: 2} to give back, and writes {}.
    expect(push(ready, "cancelled", {})).toEqual({ allowed: true, data: { ...ready, status: "cancelled", stockDeducted: {} } });
  });

  it("L1: only an explicit value changes the ledger: {} clears it on the way out, and a missing key on an order without one adds none", () => {
    const stored = confirmedWith({ p1: 2 });
    expect(push(stored, "cancelled", {})).toMatchObject({ data: { stockDeducted: {} } });
    expect(decidePush(withPrepare, "order", "o1", { ...storedOrder, status: "collected" }, false, live(storedOrder))).toEqual(statusOnly(storedOrder, "collected"));
  });

  it("only staff who prepare may set it without orders: money alone keeps the stored ledger", () => {
    const stored = { ...storedOrder, stockDeducted: { p1: 2 } };
    const forged = { ...stored, stockDeducted: { p1: 1_000_000 }, payments: [], paymentStatus: "unpaid" };
    expect(decidePush(withMoney, "order", "o1", forged, false, live(stored))).toEqual({ allowed: true, data: stored });
    expect(decidePush(withProducts, "order", "o1", forged, false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(noPerms, "order", "o1", forged, false, live(stored))).toEqual(FORBIDDEN);
  });

  it("prepare with money takes the ledger as well; orders (and the owner) store the whole record as sent", () => {
    const incoming = { ...fresh, status: "confirmed", stockDeducted: { p1: 2 }, notes: "changed" };
    expect(decidePush(staff({ prepare: true, money: true }), "order", "o1", incoming, false, live(fresh))).toEqual({
      allowed: true,
      data: { ...fresh, status: "confirmed", stockDeducted: { p1: 2 } },
    });
    expect(decidePush(withOrders, "order", "o1", incoming, false, live(fresh))).toEqual({ allowed: true, data: incoming });
    // Owners and orders staff are not held to the prepare rules: their record is stored as they send it.
    const odd = { ...fresh, status: "confirmed", stockDeducted: { p1: -1 } };
    expect(decidePush(owner, "order", "o1", odd, false, live(fresh))).toEqual({ allowed: true, data: odd });
    expect(decidePush(withOrders, "order", "o1", odd, false, live(fresh))).toEqual({ allowed: true, data: odd });
  });

  it("L1, whole-record pushes: a record without the key keeps the stored ledger; an explicit value, {} included, replaces it", () => {
    const stored = confirmedWith({ p1: 2 });
    const { stockDeducted: _omit, ...withoutKey } = stored;
    void _omit;
    for (const member of [owner, withOrders]) {
      expect(decidePush(member, "order", "o1", { ...withoutKey, notes: "edited on an older app" }, false, live(stored))).toEqual({ allowed: true, data: { ...stored, notes: "edited on an older app" } });
      expect(decidePush(member, "order", "o1", { ...stored, stockDeducted: null }, false, live(stored))).toEqual({ allowed: true, data: stored });
      expect(decidePush(member, "order", "o1", { ...stored, stockDeducted: {} }, false, live(stored))).toEqual({ allowed: true, data: { ...stored, stockDeducted: {} } });
      expect(decidePush(member, "order", "o1", { ...stored, stockDeducted: { p1: 1 } }, false, live(stored))).toEqual({ allowed: true, data: { ...stored, stockDeducted: { p1: 1 } } });
    }
    // Nothing stored, nothing to keep: a new order, a stored order without a ledger, or a ledger that is not valid.
    expect(decidePush(owner, "order", "o9", withoutKey, false, undefined)).toEqual({ allowed: true, data: withoutKey });
    expect(decidePush(owner, "order", "o1", withoutKey, false, live(withoutKey))).toEqual({ allowed: true, data: withoutKey });
    expect(decidePush(owner, "order", "o1", withoutKey, false, live({ ...withoutKey, stockDeducted: "junk" }))).toEqual({ allowed: true, data: withoutKey });
  });

  it("the order stock moves staff push on products still pass: a restore on a product that no longer tracks stock", () => {
    const stored = { nameAr: "كيك", priceMinor: 5000, trackStock: false, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [] };
    const back = { id: "m9", delta: 3, reason: "orderCancelled", orderId: "o1", note: null, at: "2026-10-03T09:00:00.000Z" };
    const incoming = { ...stored, stockQuantity: 13, stockMoves: [back], updatedAt: "2026-10-03T09:00:00.000Z" };
    expect(decidePush(withPrepare, "product", "p1", incoming, false, live(stored))).toEqual({ allowed: true, data: incoming });
  });
});

describe("decidePush / money: an existing order's money fields only", () => {
  it("takes payments, paymentStatus, updatedAt and new payment history; the status and everything else stay", () => {
    const payment = { id: "pay1", amountMinor: 11000, method: "cash", note: null, paidAt: AT };
    const payEntry = { id: "h3", field: "paymentStatus", oldValue: "unpaid", newValue: "paid", note: null, at: AT };
    const sneakyStatus = { id: "h4", field: "status", oldValue: "ready", newValue: "cancelled", note: null, at: AT };
    const incoming = { ...storedOrder, status: "cancelled", payments: [payment], paymentStatus: "paid", updatedAt: AT, changes: [statusEntry, payEntry, sneakyStatus], deliveryFeeMinor: 0 };
    expect(decidePush(withMoney, "order", "o1", incoming, false, live(storedOrder))).toEqual({
      allowed: true,
      data: { ...storedOrder, payments: [payment], paymentStatus: "paid", updatedAt: AT, changes: [statusEntry, payEntry] },
    });
  });

  it("cannot create or delete an order", () => {
    expect(decidePush(withMoney, "order", "o1", { status: "new", payments: [] }, false, undefined)).toEqual(FORBIDDEN);
    expect(decidePush(withMoney, "order", "o1", storedOrder, true, live(storedOrder))).toEqual(FORBIDDEN);
  });

  it("prepare and money together take both sets of fields", () => {
    const payment = { id: "pay1", amountMinor: 11000, method: "cash", note: null, paidAt: AT };
    const incoming = { ...storedOrder, status: "collected", payments: [payment], paymentStatus: "paid", notes: "changed" };
    expect(decidePush(staff({ prepare: true, money: true }), "order", "o1", incoming, false, live(storedOrder))).toEqual({
      allowed: true,
      data: { ...storedOrder, status: "collected", payments: [payment], paymentStatus: "paid" },
    });
  });
});

describe("newlyVisibleEntities (records to send again after a permission grant)", () => {
  it("lists what a grant makes visible, in the order a phone needs them (customers and products before orders)", () => {
    expect(newlyVisibleEntities(noPerms, withOrders)).toEqual(["setting", "product", "stock_move", "customer", "occasion", "order"]);
    expect(newlyVisibleEntities(noPerms, withProducts)).toEqual(["setting", "product", "stock_move", "occasion"]);
    expect(newlyVisibleEntities(withProducts, withMoney)).toEqual(["customer", "order", "expense"]);
    expect(newlyVisibleEntities(withOrders, staff({ orders: true, money: true }))).toEqual(["expense"]);
  });

  it("is empty when nothing new becomes visible: same flags, fewer flags, or another flag with the same reach", () => {
    expect(newlyVisibleEntities(withOrders, withOrders)).toEqual([]);
    expect(newlyVisibleEntities(everyPermission, noPerms)).toEqual([]);
    expect(newlyVisibleEntities(withOrders, withPrepare)).toEqual([]);
  });
});
