import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS, type Member, type Permissions } from "./permissions.ts";
import { canPull, decidePush, ENTITIES, isOrderStockUpdate, newlyVisibleEntities, type Entity } from "./record-access.ts";

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
// 3 of 29 Sep): a product push that only adds order-driven stock moves and moves the quantity by their sum.
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
    expect(isOrderStockUpdate(stored, incoming)).toBe(true);
  });

  it("still rejects staff without orders or prepare, a new product, a deletion and a deleted product", () => {
    expect(decidePush(noPerms, "product", "p1", pushed(), false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withMoney, "product", "p1", pushed(), false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", pushed(), false, undefined)).toEqual(FORBIDDEN);
    expect(decidePush(withOrders, "product", "p1", pushed(), true, live(stored))).toEqual(FORBIDDEN);
    // A tombstone is not a product to move stock on: that push would bring it back.
    expect(decidePush(withOrders, "product", "p1", pushed(), false, { data: stored, deleted: true })).toEqual(FORBIDDEN);
  });

  it("rejects any change beyond stock: price, name, tracking", () => {
    for (const change of [{ priceMinor: 1 }, { nameAr: "x" }, { trackStock: false }, { lowStockThreshold: 0 }]) {
      expect(decidePush(withOrders, "product", "p1", pushed(change), false, live(stored))).toEqual(FORBIDDEN);
    }
  });

  it("rejects a quantity that does not match the new moves, and manual reasons", () => {
    expect(isOrderStockUpdate(stored, pushed({ stockQuantity: 100 }))).toBe(false);
    expect(isOrderStockUpdate(stored, { ...stored, stockQuantity: 100 })).toBe(false);
    expect(isOrderStockUpdate(stored, pushed({ stockMoves: [{ ...confirm(), reason: "correction" }, oldMove] }))).toBe(false);
    expect(isOrderStockUpdate(stored, pushed({ stockMoves: [{ ...confirm(), orderId: null }, oldMove] }))).toBe(false);
    expect(isOrderStockUpdate(stored, pushed({ stockMoves: [{ ...confirm(), delta: -2.5 }, oldMove], stockQuantity: 7.5 }))).toBe(false);
  });

  it("rejects rewriting or dropping stored moves (unless the list is full)", () => {
    expect(isOrderStockUpdate(stored, pushed({ stockMoves: [confirm(), { ...oldMove, delta: 50 }] }))).toBe(false);
    expect(isOrderStockUpdate(stored, pushed({ stockMoves: [confirm()] }))).toBe(false);
    const full = Array.from({ length: 50 }, (_, i) => ({ ...oldMove, id: `h${i}`, delta: 1 }));
    const fullStored = { ...stored, stockMoves: full };
    expect(isOrderStockUpdate(fullStored, { ...fullStored, stockQuantity: 8, stockMoves: [confirm(), ...full.slice(0, 49)] })).toBe(true);
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
// and cancel them, so the ledger is one of the fields their push may set.
describe("decidePush / prepare: the stock ledger stockDeducted", () => {
  const ledgerPush = (stockDeducted: unknown, extra: Record<string, unknown> = {}) => ({ ...storedOrder, status: "confirmed", stockDeducted, ...extra });
  const prepared = (stockDeducted: unknown) => decidePush(withPrepare, "order", "o1", ledgerPush(stockDeducted), false, live(storedOrder));

  it("takes a ledger along with the status; every other field stays as stored", () => {
    const incoming = ledgerPush({ p1: 2, p2: 1 }, { customerId: "someone-else", deliveryFeeMinor: 0, items: [] });
    expect(decidePush(withPrepare, "order", "o1", incoming, false, live(storedOrder))).toEqual({
      allowed: true,
      data: { ...storedOrder, status: "confirmed", stockDeducted: { p1: 2, p2: 1 } },
    });
  });

  it("takes an empty ledger (the order takes nothing now), and replaces a stored one", () => {
    expect(prepared({})).toEqual({ allowed: true, data: { ...storedOrder, status: "confirmed", stockDeducted: {} } });
    const withLedger = { ...storedOrder, status: "confirmed", stockDeducted: { p1: 2 } };
    expect(decidePush(withPrepare, "order", "o1", { ...withLedger, status: "cancelled", stockDeducted: {} }, false, live(withLedger))).toEqual({
      allowed: true,
      data: { ...withLedger, status: "cancelled", stockDeducted: {} },
    });
  });

  it("accepts the edges: units 0 and 1,000,000, a 64-character product id, 200 products", () => {
    expect(prepared({ p1: 0 })).toMatchObject({ allowed: true, data: { stockDeducted: { p1: 0 } } });
    expect(prepared({ p1: 1_000_000 })).toMatchObject({ allowed: true, data: { stockDeducted: { p1: 1_000_000 } } });
    const longKey = "k".repeat(64);
    expect(prepared({ [longKey]: 3 })).toMatchObject({ allowed: true, data: { stockDeducted: { [longKey]: 3 } } });
    const twoHundred = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, 1]));
    expect(prepared(twoHundred)).toMatchObject({ allowed: true, data: { stockDeducted: twoHundred } });
  });

  it("ignores an invalid ledger like any other bad prepare field: the stored one stays", () => {
    const stored = { ...storedOrder, stockDeducted: { p1: 2 } };
    const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, 1]));
    const bad: unknown[] = [
      "p1:2", 7, true, [{ p1: 2 }], [], // not a plain object
      { p1: -1 }, { p1: 1.5 }, { p1: 1_000_001 }, { p1: "2" }, { p1: null }, { p1: true }, { p1: { n: 2 } }, // not whole units 0..1,000,000
      { "": 2 }, { ["k".repeat(65)]: 2 }, // key not 1..64 characters
      tooMany, // more than 200 products
    ];
    for (const value of bad) {
      const decision = decidePush(withPrepare, "order", "o1", { ...stored, status: "confirmed", stockDeducted: value }, false, live(stored));
      expect(decision, JSON.stringify(value)).toEqual({ allowed: true, data: { ...stored, status: "confirmed" } });
    }
    // null is not a ledger either (unlike outForDeliveryAt, where null clears it)
    expect(decidePush(withPrepare, "order", "o1", { ...stored, status: "confirmed", stockDeducted: null }, false, live(stored))).toEqual({ allowed: true, data: { ...stored, status: "confirmed" } });
  });

  it("an invalid ledger on an order that has none leaves it without one", () => {
    expect(prepared({ p1: -2 })).toEqual({ allowed: true, data: { ...storedOrder, status: "confirmed" } });
  });

  it("leaving the key out clears the stored ledger (an optional field, like outForDeliveryAt): the order is a legacy order again", () => {
    const stored = { ...storedOrder, stockDeducted: { p1: 2 } };
    const { stockDeducted: _omit, ...withoutKey } = stored;
    void _omit;
    expect(decidePush(withPrepare, "order", "o1", { ...withoutKey, status: "confirmed" }, false, live(stored))).toEqual({ allowed: true, data: { ...withoutKey, status: "confirmed" } });
  });

  it("only staff who prepare may set it without orders: money alone keeps the stored ledger", () => {
    const stored = { ...storedOrder, stockDeducted: { p1: 2 } };
    const forged = { ...stored, stockDeducted: { p1: 1_000_000 }, payments: [], paymentStatus: "unpaid" };
    expect(decidePush(withMoney, "order", "o1", forged, false, live(stored))).toEqual({ allowed: true, data: stored });
    expect(decidePush(withProducts, "order", "o1", forged, false, live(stored))).toEqual(FORBIDDEN);
    expect(decidePush(noPerms, "order", "o1", forged, false, live(stored))).toEqual(FORBIDDEN);
  });

  it("prepare with money takes the ledger as well; orders (and the owner) store the whole record as sent", () => {
    const incoming = ledgerPush({ p1: 3 }, { notes: "changed" });
    expect(decidePush(staff({ prepare: true, money: true }), "order", "o1", incoming, false, live(storedOrder))).toEqual({
      allowed: true,
      data: { ...storedOrder, status: "confirmed", stockDeducted: { p1: 3 } },
    });
    expect(decidePush(withOrders, "order", "o1", incoming, false, live(storedOrder))).toEqual({ allowed: true, data: incoming });
    // Owners and orders staff are not held to the prepare rules: their record is stored as they send it.
    const odd = ledgerPush({ p1: -1 });
    expect(decidePush(owner, "order", "o1", odd, false, live(storedOrder))).toEqual({ allowed: true, data: odd });
    expect(decidePush(withOrders, "order", "o1", odd, false, live(storedOrder))).toEqual({ allowed: true, data: odd });
  });

  it("the order stock moves staff push on products still pass isOrderStockUpdate: a restore on a product that no longer tracks stock", () => {
    const stored = { nameAr: "كيك", priceMinor: 5000, trackStock: false, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [] };
    const back = { id: "m9", delta: 3, reason: "orderCancelled", orderId: "o1", note: null, at: "2026-10-03T09:00:00.000Z" };
    const incoming = { ...stored, stockQuantity: 13, stockMoves: [back], updatedAt: "2026-10-03T09:00:00.000Z" };
    expect(isOrderStockUpdate(stored, incoming)).toBe(true);
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
