import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS, hasPermission, normalizePermissions, OWNER_PERMISSIONS } from "./permissions.ts";

describe("normalizePermissions", () => {
  it("defaults every key to false for an empty or missing object", () => {
    expect(normalizePermissions({})).toEqual(DEFAULT_STAFF_PERMISSIONS);
    expect(normalizePermissions(undefined)).toEqual(DEFAULT_STAFF_PERMISSIONS);
    expect(normalizePermissions(null)).toEqual(DEFAULT_STAFF_PERMISSIONS);
  });

  it("passes through true flags and defaults the rest", () => {
    expect(normalizePermissions({ orders: true, products: true })).toEqual({ orders: true, prepare: false, money: false, products: true });
  });

  it("treats a non-boolean value for a key as false", () => {
    expect(normalizePermissions({ orders: "true", money: 1 })).toEqual({ orders: false, prepare: false, money: false, products: false });
  });

  it("ignores an array or scalar input", () => {
    expect(normalizePermissions([1, 2, 3])).toEqual(DEFAULT_STAFF_PERMISSIONS);
    expect(normalizePermissions("nope")).toEqual(DEFAULT_STAFF_PERMISSIONS);
  });
});

describe("hasPermission", () => {
  it("an owner always has every permission, regardless of their stored permissions object", () => {
    for (const key of ["orders", "prepare", "money", "products"] as const) {
      expect(hasPermission({ role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS }, key)).toBe(true);
    }
  });

  it("a staff member only has the permissions actually set on their own row", () => {
    const member = { role: "staff" as const, permissions: { orders: true, prepare: false, money: false, products: false } };
    expect(hasPermission(member, "orders")).toBe(true);
    expect(hasPermission(member, "prepare")).toBe(false);
    expect(hasPermission(member, "money")).toBe(false);
    expect(hasPermission(member, "products")).toBe(false);
  });

  it("a staff member with every flag granted matches OWNER_PERMISSIONS' shape", () => {
    const member = { role: "staff" as const, permissions: OWNER_PERMISSIONS };
    for (const key of ["orders", "prepare", "money", "products"] as const) expect(hasPermission(member, key)).toBe(true);
  });
});
