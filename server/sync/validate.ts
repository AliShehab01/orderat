// Request body validation for orderat-sync (docs/sme-phase-2-cloud.md's "Sync" and "Shops and
// members"). Same philosophy as server/shop/validate.ts: deliberately strict and type-only — this
// never decides whether a shop/user/invite is real or whether a change is allowed; server/sync's
// store.ts, push-pull.ts and record-access.ts do that, with the database in hand.

import { ENTITIES, type Entity } from "./record-access.ts";
import type { Permissions } from "./permissions.ts";

/** docs/sme-phase-2-cloud.md: "Body at most 2 MB." */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** docs/sme-phase-2-cloud.md: "Records at most 32 KB each" — measured as the UTF-8 byte length of
 * `data` once serialized, the same "wire size" measure server/ask/validate.ts's own body cap uses. */
const MAX_RECORD_DATA_BYTES = 32 * 1024;
/** Not itself from the spec (which only documents the app's own upload batching, "batches of 200") —
 * a generous defensive cap, comfortably above that, so one request can never carry an unbounded
 * number of changes regardless of what a client sends. */
const MAX_CHANGES_PER_REQUEST = 500;
const MAX_SHOP_NAME_CHARS = 120;
/** Record ids are lowercase UUIDs (docs/sme-phase-2-cloud.md "IDs"), the shop's own id, or a setting's
 * key ("whatsappTemplates", "subscription") — so a conservative URL- and path-safe alphabet covers all
 * of them and rules out '/', '.', '..', spaces and control characters by construction. */
const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** A photo id is the SHA-256 of the JPEG as lowercase hex (server/sync/handler.ts's photo_upload,
 * server/shared/crypto.ts's sha256Hex) — exactly what the iOS and Android apps hash too. It becomes part
 * of a Storage object path signed with the service-role key, so nothing else may ever get through. */
const PHOTO_ID_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_CODE_RE = /^\d{6}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

function isEntity(value: unknown): value is Entity {
  return typeof value === "string" && (ENTITIES as readonly string[]).includes(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPermissionsShape(value: unknown): value is Permissions {
  if (!isPlainObject(value)) return false;
  return typeof value.orders === "boolean" && typeof value.prepare === "boolean" && typeof value.money === "boolean" && typeof value.products === "boolean";
}

export interface CreateShopBody { action: "create_shop"; shopId: string; name: string; }

export interface ChangeInput {
  entity: Entity;
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  baseSeq: number;
}

export interface SyncBody { action: "sync"; shopId: string; cursor: number; changes: ChangeInput[]; }
export interface InviteCreateBody { action: "invite_create"; shopId: string; }
export interface InviteJoinBody { action: "invite_join"; code: string; }
export interface MembersListBody { action: "members_list"; shopId: string; }
export interface MembersUpdateBody { action: "members_update"; shopId: string; userId: string; permissions: Permissions; }
export interface MembersRemoveBody { action: "members_remove"; shopId: string; userId: string; }
export interface PhotoUploadBody { action: "photo_upload"; shopId: string; mimeType: string; data: string; }
export interface PhotoUrlBody { action: "photo_url"; shopId: string; photoId: string; }
/** No fields beyond the action itself — every shop the caller belongs to is derived entirely from
 * their session's userId (server/sync/store.ts's listShopsForUser), never from anything in the body. */
export interface ShopsListBody { action: "shops_list"; }

export type SyncRequestBody =
  | CreateShopBody
  | SyncBody
  | InviteCreateBody
  | InviteJoinBody
  | MembersListBody
  | MembersUpdateBody
  | MembersRemoveBody
  | PhotoUploadBody
  | PhotoUrlBody
  | ShopsListBody;

export type SyncValidationResult = { ok: true; body: SyncRequestBody } | { ok: false; error: "invalid_body" | "too_large" };

function invalid(): SyncValidationResult {
  return { ok: false, error: "invalid_body" };
}

function tooLarge(): SyncValidationResult {
  return { ok: false, error: "too_large" };
}

function validateCreateShop(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (!isNonEmptyString(json.name, MAX_SHOP_NAME_CHARS)) return invalid();
  return { ok: true, body: { action: "create_shop", shopId: json.shopId, name: json.name } };
}

function isChangeInput(value: unknown): { ok: true; change: ChangeInput } | { ok: false; error: "invalid_body" | "too_large" } {
  if (!isPlainObject(value)) return { ok: false, error: "invalid_body" };
  if (!isEntity(value.entity)) return { ok: false, error: "invalid_body" };
  if (typeof value.id !== "string" || !RECORD_ID_RE.test(value.id)) return { ok: false, error: "invalid_body" };
  if (!isPlainObject(value.data)) return { ok: false, error: "invalid_body" };
  if (value.deleted !== undefined && typeof value.deleted !== "boolean") return { ok: false, error: "invalid_body" };
  if (value.baseSeq !== undefined && !isNonNegativeInt(value.baseSeq)) return { ok: false, error: "invalid_body" };

  if (new TextEncoder().encode(JSON.stringify(value.data)).length > MAX_RECORD_DATA_BYTES) return { ok: false, error: "too_large" };

  return {
    ok: true,
    change: { entity: value.entity, id: value.id, data: value.data, deleted: value.deleted === true, baseSeq: (value.baseSeq as number | undefined) ?? 0 },
  };
}

function validateSync(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (!isNonNegativeInt(json.cursor)) return invalid();
  if (!Array.isArray(json.changes) || json.changes.length > MAX_CHANGES_PER_REQUEST) return invalid();

  const changes: ChangeInput[] = [];
  for (const raw of json.changes) {
    const result = isChangeInput(raw);
    if (!result.ok) return { ok: false, error: result.error };
    changes.push(result.change);
  }

  return { ok: true, body: { action: "sync", shopId: json.shopId, cursor: json.cursor, changes } };
}

function validateShopIdOnly<A extends "invite_create" | "members_list">(action: A, json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  return { ok: true, body: { action, shopId: json.shopId } };
}

function validateInviteJoin(json: Record<string, unknown>): SyncValidationResult {
  if (typeof json.code !== "string" || !INVITE_CODE_RE.test(json.code)) return invalid();
  return { ok: true, body: { action: "invite_join", code: json.code } };
}

function validateMembersUpdate(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (!isUuid(json.userId)) return invalid();
  if (!isPermissionsShape(json.permissions)) return invalid();
  return { ok: true, body: { action: "members_update", shopId: json.shopId, userId: json.userId, permissions: json.permissions } };
}

function validateMembersRemove(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (!isUuid(json.userId)) return invalid();
  return { ok: true, body: { action: "members_remove", shopId: json.shopId, userId: json.userId } };
}

function validatePhotoUpload(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (json.mimeType !== "image/jpeg" && json.mimeType !== "image/png" && json.mimeType !== "image/webp") return invalid();
  if (typeof json.data !== "string" || json.data.length === 0) return invalid();
  return { ok: true, body: { action: "photo_upload", shopId: json.shopId, mimeType: json.mimeType, data: json.data } };
}

function validatePhotoUrl(json: Record<string, unknown>): SyncValidationResult {
  if (!isUuid(json.shopId)) return invalid();
  if (typeof json.photoId !== "string" || !PHOTO_ID_RE.test(json.photoId)) return invalid();
  return { ok: true, body: { action: "photo_url", shopId: json.shopId, photoId: json.photoId } };
}

/** Validates a raw request body (the request's text, not yet parsed) and dispatches by `action` to
 * docs/sme-phase-2-cloud.md's per-action shape. Every action requires the caller to already be
 * signed in — the X-Orderat-Session header, checked separately in server/sync/handler.ts, not a
 * field of the body. */
export function validateSyncBody(raw: string): SyncValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  switch (json.action) {
    case "create_shop": return validateCreateShop(json);
    case "sync": return validateSync(json);
    case "invite_create": return validateShopIdOnly("invite_create", json);
    case "invite_join": return validateInviteJoin(json);
    case "members_list": return validateShopIdOnly("members_list", json);
    case "members_update": return validateMembersUpdate(json);
    case "members_remove": return validateMembersRemove(json);
    case "photo_upload": return validatePhotoUpload(json);
    case "photo_url": return validatePhotoUrl(json);
    case "shops_list": return { ok: true, body: { action: "shops_list" } };
    default: return invalid();
  }
}

export { MAX_BODY_BYTES, MAX_CHANGES_PER_REQUEST, MAX_RECORD_DATA_BYTES };
