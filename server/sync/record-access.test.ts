import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { canPull, decidePush } from "./record-access.ts";

const owner: Member = { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS }; // Deliberately empty permissions: role alone should be enough.
const noPerms: Member = { role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS };
const withOrders: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
const withPrepare: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
const withMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, money: true } };
const withProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, products: true } };

describe("decidePush / expense (money)", () => {
  it("allows an owner to push an expense", () => {
    expect(decidePush(owner, "expense", { amount: 10 }, false, undefined)).toEqual({ allowed: true, data: { amount: 10 } });
  });

  it("allows staff with money to push an expense", () => {
    expect(decidePush(withMoney, "expense", { amount: 10 }, false, undefined)).toEqual({ allowed: true, data: { amount: 10 } });
  });

  it("rejects staff without money pushing an expense", () => {
    expect(decidePush(noPerms, "expense", { amount: 10 }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withOrders, "expense", { amount: 10 }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });
});

describe("decidePush / product (products)", () => {
  it("allows staff with products to push a product", () => {
    expect(decidePush(withProducts, "product", { name: "Cake" }, false, undefined)).toEqual({ allowed: true, data: { name: "Cake" } });
  });

  it("rejects staff without products pushing a product", () => {
    expect(decidePush(withOrders, "product", { name: "Cake" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("allows an owner regardless of their own permissions object", () => {
    expect(decidePush(owner, "product", { name: "Cake" }, false, undefined).allowed).toBe(true);
  });
});

describe("decidePush / customer (orders)", () => {
  it("allows staff with orders to push a customer", () => {
    expect(decidePush(withOrders, "customer", { name: "Sara" }, false, undefined)).toEqual({ allowed: true, data: { name: "Sara" } });
  });

  it("rejects staff with only prepare (customers aren't covered by prepare)", () => {
    expect(decidePush(withPrepare, "customer", { name: "Sara" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects staff with no permissions", () => {
    expect(decidePush(noPerms, "customer", { name: "Sara" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });
});

describe("decidePush / order (orders full write, prepare status-only)", () => {
  const existing = { status: "pending", customerName: "Sara", items: [{ id: "p1", qty: 2 }] };

  it("staff with orders may fully rewrite an order, including creating a brand-new one", () => {
    const fresh = { status: "pending", customerName: "New customer" };
    expect(decidePush(withOrders, "order", fresh, false, undefined)).toEqual({ allowed: true, data: fresh });
    const edited = { status: "confirmed", customerName: "Renamed", items: [] };
    expect(decidePush(withOrders, "order", edited, false, existing)).toEqual({ allowed: true, data: edited });
  });

  it("staff with only prepare may change an existing order's status, keeping every other field from the stored record", () => {
    const decision = decidePush(withPrepare, "order", { status: "prepped", customerName: "Attempted rename", items: [{ id: "sneaky", qty: 99 }] }, false, existing);
    expect(decision).toEqual({ allowed: true, data: { status: "prepped", customerName: "Sara", items: [{ id: "p1", qty: 2 }] } });
  });

  it("prepare-only cannot create a brand-new order (nothing stored to copy the rest from)", () => {
    expect(decidePush(withPrepare, "order", { status: "pending" }, false, undefined)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("prepare-only cannot delete an order (a tombstone isn't a status change)", () => {
    expect(decidePush(withPrepare, "order", { status: "pending" }, true, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("prepare-only is rejected when the incoming data has no status field", () => {
    expect(decidePush(withPrepare, "order", { customerName: "x" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("staff with neither orders nor prepare cannot push an order at all", () => {
    expect(decidePush(noPerms, "order", { status: "prepped" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
    expect(decidePush(withMoney, "order", { status: "prepped" }, false, existing)).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("orders permission wins over prepare when staff somehow has both (full write, not status-only)", () => {
    const both: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true, prepare: true } };
    const edited = { status: "confirmed", customerName: "Fully rewritten" };
    expect(decidePush(both, "order", edited, false, existing)).toEqual({ allowed: true, data: edited });
  });
});

describe("decidePush / entities with no specific permission gate", () => {
  it("any member — even with zero permissions — may push shop, occasion, stock_move and setting", () => {
    for (const entity of ["shop", "occasion", "stock_move", "setting"] as const) {
      expect(decidePush(noPerms, entity, { x: 1 }, false, undefined)).toEqual({ allowed: true, data: { x: 1 } });
    }
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
