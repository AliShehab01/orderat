import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { canPull, decidePush, isOrderStockUpdate } from "./record-access.ts";

const owner: Member = { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS }; // Deliberately empty permissions: role alone should be enough.
const noPerms: Member = { role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS };
const withOrders: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
const withPrepare: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
const withMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, money: true } };
const withProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, products: true } };

describe("decidePush / expense (money)", () => {
  it("allows an owner to push an expense", () => {
    expect(decidePush(owner, "expense", "r1", { amount: 10 }, false, undefined)).toEqual({ allowed: true, data: { amount: 10 } });
  });

  it("allows staff with money to push an expense", () => {
    expect(decidePush(withMoney, "expense", "r1", { amount: 10 }, false, undefined)).toEqual({ allowed: true, data: { amount: 10 } });
  });

  it("rejects staff without money pushing an expense", () => {
    expect(decidePush(noPerms, "expense", "r1", { amount: 10 }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withOrders, "expense", "r1", { amount: 10 }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });
});

describe("decidePush / product (products)", () => {
  it("allows staff with products to push a product", () => {
    expect(decidePush(withProducts, "product", "r1", { name: "Cake" }, false, undefined)).toEqual({ allowed: true, data: { name: "Cake" } });
  });

  it("rejects staff without products pushing a product", () => {
    expect(decidePush(withOrders, "product", "r1", { name: "Cake" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("allows an owner regardless of their own permissions object", () => {
    expect(decidePush(owner, "product", "r1", { name: "Cake" }, false, undefined).allowed).toBe(true);
  });
});

// Staff who confirm or cancel orders without the products permission still move stock (review finding
// 3): a product push that only adds order-driven stock moves and moves the quantity by their sum.
describe("decidePush / product stock from staff handling orders", () => {
  const oldMove = { id: "m0", delta: 5, reason: "received", orderId: null, note: null, at: "2026-09-29T10:00:00.000Z" };
  const stored = { nameAr: "كيك", nameEn: null, priceMinor: 5000, trackStock: true, stockQuantity: 10, lowStockThreshold: 3, stockMoves: [oldMove], createdAt: "2026-09-01T00:00:00.000Z" };
  const confirm = (orderId = "o1") => ({ id: "m1", delta: -2, reason: "orderConfirmed", orderId, note: null, at: "2026-09-30T10:00:00.000Z" });
  const pushed = (overrides: Record<string, unknown> = {}) => ({ ...stored, stockQuantity: 8, stockMoves: [confirm(), oldMove], ...overrides });

  it("lets staff with orders or prepare push an order's stock change to an existing product", () => {
    for (const member of [withOrders, withPrepare]) {
      expect(decidePush(member, "product", "p1", pushed(), false, stored)).toEqual({ allowed: true, data: pushed() });
    }
  });

  it("accepts a cancellation that puts stock back, and clients that spell nulls or dates differently", () => {
    const back = { id: "m2", delta: 2, reason: "orderCancelled", orderId: "o1", note: null, at: "2026-09-30T11:00:00.000Z" };
    const { nameEn: _omit, ...withoutNameEn } = stored;
    void _omit;
    const incoming = { ...withoutNameEn, createdAt: "2026-09-01T00:00:00Z", stockQuantity: 12, stockMoves: [back, oldMove], updatedAt: "2026-09-30T11:00:00.000Z" };
    expect(isOrderStockUpdate(stored, incoming)).toBe(true);
  });

  it("still rejects staff without orders or prepare, a new product and a deletion", () => {
    expect(decidePush(noPerms, "product", "p1", pushed(), false, stored)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withMoney, "product", "p1", pushed(), false, stored)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withOrders, "product", "p1", pushed(), false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withOrders, "product", "p1", pushed(), true, stored)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects any change beyond stock: price, name, tracking", () => {
    for (const change of [{ priceMinor: 1 }, { nameAr: "x" }, { trackStock: false }, { lowStockThreshold: 0 }]) {
      expect(decidePush(withOrders, "product", "p1", pushed(change), false, stored)).toEqual({ allowed: false, reason: "forbidden" });
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

describe("decidePush / customer (orders)", () => {
  it("allows staff with orders to push a customer", () => {
    expect(decidePush(withOrders, "customer", "r1", { name: "Sara" }, false, undefined)).toEqual({ allowed: true, data: { name: "Sara" } });
  });

  it("rejects staff with only prepare (customers aren't covered by prepare)", () => {
    expect(decidePush(withPrepare, "customer", "r1", { name: "Sara" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects staff with no permissions", () => {
    expect(decidePush(noPerms, "customer", "r1", { name: "Sara" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });
});

describe("decidePush / order (orders full write, prepare status-only)", () => {
  const existing = { status: "pending", customerName: "Sara", items: [{ id: "p1", qty: 2 }] };

  it("staff with orders may fully rewrite an order, including creating a brand-new one", () => {
    const fresh = { status: "pending", customerName: "New customer" };
    expect(decidePush(withOrders, "order", "r1", fresh, false, undefined)).toEqual({ allowed: true, data: fresh });
    const edited = { status: "confirmed", customerName: "Renamed", items: [] };
    expect(decidePush(withOrders, "order", "r1", edited, false, existing)).toEqual({ allowed: true, data: edited });
  });

  it("staff with only prepare may change an existing order's status, keeping every other field from the stored record", () => {
    const decision = decidePush(withPrepare, "order", "r1", { status: "prepped", customerName: "Attempted rename", items: [{ id: "sneaky", qty: 99 }] }, false, existing);
    expect(decision).toEqual({ allowed: true, data: { status: "prepped", customerName: "Sara", items: [{ id: "p1", qty: 2 }] } });
  });

  it("prepare-only cannot create a brand-new order (nothing stored to copy the rest from)", () => {
    expect(decidePush(withPrepare, "order", "r1", { status: "pending" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("prepare-only cannot delete an order (a tombstone isn't a status change)", () => {
    expect(decidePush(withPrepare, "order", "r1", { status: "pending" }, true, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("prepare-only is rejected when the incoming data has no status field", () => {
    expect(decidePush(withPrepare, "order", "r1", { customerName: "x" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("staff with neither orders nor prepare cannot push an order at all", () => {
    expect(decidePush(noPerms, "order", "r1", { status: "prepped" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withMoney, "order", "r1", { status: "prepped" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("orders permission wins over prepare when staff somehow has both (full write, not status-only)", () => {
    const both: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true, prepare: true } };
    const edited = { status: "confirmed", customerName: "Fully rewritten" };
    expect(decidePush(both, "order", "r1", edited, false, existing)).toEqual({ allowed: true, data: edited });
  });
});

describe("decidePush / entities with no specific permission gate", () => {
  it("any member — even with zero permissions — may push shop, occasion, stock_move and setting", () => {
    for (const entity of ["shop", "occasion", "stock_move", "setting"] as const) {
      expect(decidePush(noPerms, entity, "r1", { x: 1 }, false, undefined)).toEqual({ allowed: true, data: { x: 1 } });
    }
  });
});

// The `setting` record "subscription" is the owner's own subscription report, which the website's paid
// check reads to open the shop: only the owner may write it. Every other setting keeps the open rule.
describe("decidePush / the subscription setting (owner only)", () => {
  const everyPermission: Member = { role: "staff", permissions: { orders: true, prepare: true, money: true, products: true } };
  const report = { value: { status: "active", expiresAt: "2027-01-01T00:00:00.000Z", platform: "ios", updatedAt: "2026-09-29T12:00:00.000Z" } };

  it("lets the owner write it, new or existing", () => {
    expect(decidePush(owner, "setting", "subscription", report, false, undefined)).toEqual({ allowed: true, data: report });
    expect(decidePush(owner, "setting", "subscription", report, false, { value: { status: "expired" } })).toEqual({ allowed: true, data: report });
  });

  it("refuses staff, even with every permission, whether writing or deleting it", () => {
    expect(decidePush(everyPermission, "setting", "subscription", report, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(noPerms, "setting", "subscription", report, false, { value: {} })).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(everyPermission, "setting", "subscription", {}, true, { value: {} })).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("still lets staff write every other setting, such as whatsappTemplates", () => {
    expect(decidePush(noPerms, "setting", "whatsappTemplates", { value: ["Hi"] }, false, undefined)).toEqual({ allowed: true, data: { value: ["Hi"] } });
  });

  it("is about the setting entity only: another entity's record with that id keeps its own rule", () => {
    expect(decidePush(noPerms, "occasion", "subscription", { x: 1 }, false, undefined)).toEqual({ allowed: true, data: { x: 1 } });
  });
});

describe("canPull", () => {
  it("hides expense from staff without money", () => {
    expect(canPull(noPerms, "expense")).toBe(false);
    expect(canPull(withOrders, "expense")).toBe(false);
  });

  it("shows expense to staff with money, and to the owner", () => {
    expect(canPull(withMoney, "expense")).toBe(true);
    expect(canPull(owner, "expense")).toBe(true);
  });

  it("never hides any other entity", () => {
    for (const entity of ["shop", "product", "customer", "order", "occasion", "stock_move", "setting"] as const) {
      expect(canPull(noPerms, entity)).toBe(true);
    }
  });
});
