// FROZEN FIXTURE (final verification, 3 Oct 2026): this file is server/sync/permissions.ts exactly as it is on origin/main (c07cc28),
// the server code deployed before the integrity rounds of 3 Oct, except that the relative imports of the other server folders
// point one level deeper. It is used only by ../migration-0010.test.ts to seed a database through the OLD code path before
// migration 0010 is applied. Do not edit it and do not import it from production code.
// The four staff permission flags (docs/sme-phase-2-cloud.md's "Shops and members"): `orders`
// (create and edit orders and customers), `prepare` (change an order's status only), `money` (see
// expenses and profit), `products` (edit products). An owner implicitly holds all of them regardless
// of what's actually stored in their own shop_members row — hasPermission below is the one place
// that rule lives, so nothing else in server/sync ever has to special-case role === "owner" itself.

export interface Permissions {
  orders: boolean;
  prepare: boolean;
  money: boolean;
  products: boolean;
}

export type Role = "owner" | "staff";

export const OWNER_PERMISSIONS: Permissions = { orders: true, prepare: true, money: true, products: true };

/** What a brand-new staff member gets on invite_join, before the owner grants anything —
 * least-privilege by default, the same "nothing until explicitly granted" posture every other
 * default in this codebase takes. */
export const DEFAULT_STAFF_PERMISSIONS: Permissions = { orders: false, prepare: false, money: false, products: false };

/** Coerces an arbitrary jsonb value (what `shop_members.permissions` actually holds on the wire) into
 * a complete Permissions object, defaulting any missing or non-boolean key to false — so a reader
 * never has to guard against a partially-written or legacy-shaped row. */
export function normalizePermissions(raw: unknown): Permissions {
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    orders: obj.orders === true,
    prepare: obj.prepare === true,
    money: obj.money === true,
    products: obj.products === true,
  };
}

export interface Member {
  role: Role;
  permissions: Permissions;
}

/** True when `member` may act on capability `key` — an owner always can, regardless of their stored
 * permissions row; a staff member only when their own permissions object has that flag set. */
export function hasPermission(member: Member, key: keyof Permissions): boolean {
  return member.role === "owner" || member.permissions[key] === true;
}
