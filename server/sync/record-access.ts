// Per-entity push/pull permission rules for sync (docs/sme-phase-2-cloud.md's "Permissions"):
//   - `orders` permission: full read/write of "order" and "customer" records ("create and edit
//     orders and customers").
//   - `prepare` permission, without `orders`: may push an *existing* "order" record's `status` field
//     only — every other field is kept from the record already stored, never trusted from the
//     incoming payload ("The server copies the rest of the order from the stored record"). Cannot
//     create a brand-new order (there is nothing stored yet to copy the rest from) and cannot delete
//     one (a tombstone isn't "changing status"), and cannot touch "customer" at all.
//   - `money` permission: required to push *or* pull "expense" records; without it, expense records
//     are simply left out of a pull, and a push of one is rejected outright.
//   - `products` permission: required to push "product" records (and, by the same reasoning, a
//     synced product photo — server/sync/handler.ts's photo_upload).
//   - every other entity ("shop", "occasion", "stock_move", "setting") has no permission of its own
//     in the spec, so any shop member — owner or staff, whatever their permissions — may push or pull
//     it; this file deliberately does not invent a stricter rule the spec never states.

import { hasPermission, type Member } from "./permissions.ts";

export const ENTITIES = ["shop", "product", "customer", "order", "expense", "occasion", "stock_move", "setting"] as const;
export type Entity = (typeof ENTITIES)[number];

export type PushDecision =
  | { allowed: true; data: Record<string, unknown> }
  | { allowed: false; reason: "forbidden" };

/**
 * Decides whether `member` may push `incomingData` to `entity`, and, when allowed, the actual `data`
 * to store — identical to `incomingData` for every entity except a prepare-only push of an "order",
 * where only `status` is taken from `incomingData` and everything else comes from `existingData` (the
 * record as currently stored; undefined when this would be a brand-new record).
 */
export function decidePush(
  member: Member,
  entity: Entity,
  incomingData: Record<string, unknown>,
  deleted: boolean,
  existingData: Record<string, unknown> | undefined,
): PushDecision {
  if (entity === "expense") {
    return hasPermission(member, "money") ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "product") {
    return hasPermission(member, "products") ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "customer") {
    return hasPermission(member, "orders") ? { allowed: true, data: incomingData } : { allowed: false, reason: "forbidden" };
  }
  if (entity === "order") {
    if (hasPermission(member, "orders")) return { allowed: true, data: incomingData };
    if (hasPermission(member, "prepare")) {
      if (deleted || !existingData) return { allowed: false, reason: "forbidden" };
      if (typeof incomingData.status !== "string") return { allowed: false, reason: "forbidden" };
      return { allowed: true, data: { ...existingData, status: incomingData.status } };
    }
    return { allowed: false, reason: "forbidden" };
  }
  // shop / occasion / stock_move / setting: no specific permission gates these in the spec.
  return { allowed: true, data: incomingData };
}

/** Whether `member` may see `entity` at all on a pull — only "expense" is gated (money), matching
 * decidePush's own reasoning for that entity. */
export function canPull(member: Member, entity: Entity): boolean {
  return entity === "expense" ? hasPermission(member, "money") : true;
}
