// FROZEN FIXTURE (final verification, 3 Oct 2026): this file is server/sync/handler.ts exactly as it is on origin/main (c07cc28),
// the server code deployed before the integrity rounds of 3 Oct, except that the relative imports of the other server folders
// point one level deeper. It is used only by ../migration-0010.test.ts to seed a database through the OLD code path before
// migration 0010 is applied. Do not edit it and do not import it from production code.
// HTTP handler for orderat-sync (docs/sme-phase-2-cloud.md's "Shops and members" and "Sync"). Plain
// Request -> Response, like server/shop/handler.ts, so it runs the same under Deno, Node or a test;
// supabase/functions/orderat-sync/index.ts only wires in env + the Storage dependencies (same
// documented exception as orderat-shop's uploadPhoto — see that function's own header).
//
// Every action authenticates itself from the X-Orderat-Session header (server/auth/store.ts's
// resolveSession) — never from anything in the body, the same convention server/auth/handler.ts uses
// for everything but `signin`. No CORS in this handler itself: the iPhone/Android apps call it
// directly, and the browser web app is let in by supabase/functions/orderat-sync/index.ts wrapping
// it with server/shared/cors.ts's withAppCors.

import type { SqlClient } from "../../../agent/postgres-store.ts";
import { resolveSession } from "../../../auth/store.ts";
import { sha256Hex, sha256HexOfString } from "../../../shared/crypto.ts";
import { decodeBase64, sniffImageMimeType } from "../../../shared/image.ts";
import { DEFAULT_STAFF_PERMISSIONS, hasPermission, normalizePermissions, OWNER_PERMISSIONS, type Member } from "./permissions.ts";
import { pullForMember, pushChanges } from "./push-pull.ts";
import { bumpSyncRateLimit, MAX_SYNCS_PER_MINUTE } from "./rate-limit.ts";
import { canPull, newlyVisibleEntities } from "./record-access.ts";
import {
  countStaff,
  findActiveInviteByCodeHash,
  findMembership,
  findShopCloudById,
  hasActiveInviteWithCodeHash,
  insertInvite,
  insertMembership,
  insertShopCloud,
  listMembers,
  listShopsForUser,
  markInviteUsed,
  removeMembership,
  resequenceRecords,
  updateMembershipPermissions,
} from "./store.ts";
import {
  validateSyncBody,
  type CreateShopBody,
  type InviteCreateBody,
  type InviteJoinBody,
  type MembersListBody,
  type MembersRemoveBody,
  type MembersUpdateBody,
  type PhotoUploadBody,
  type PhotoUrlBody,
  type SyncBody,
} from "./validate.ts";

/** docs/sme-phase-2-cloud.md: "Staff limit is 5 per shop in v1." */
const MAX_STAFF_PER_SHOP = 5;
/** docs/sme-phase-2-cloud.md: "valid for 48 hours". */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
/** How many times invite_create retries a freshly-generated 6-digit code before giving up, on the
 * (astronomically unlikely, with a 1,000,000-value space) chance it collides with a currently-active
 * invite — see store.ts's hasActiveInviteWithCodeHash for why this can't just be a database
 * constraint. */
const MAX_INVITE_CODE_ATTEMPTS = 10;
/** Not itself from docs/sme-phase-2-cloud.md (which gives no separate cap for this bucket) — kept
 * comfortably under the endpoint's own 2 MB body cap once base64 inflation (~1.37x) and JSON overhead
 * are accounted for, the same reasoning server/studio/validate.ts's body cap documents for its own
 * 2 MB *decoded* photo. */
const MAX_SYNC_PHOTO_BYTES = 1 * 1024 * 1024;
/** How long a signed photo URL stays valid — "short-lived" per docs/sme-phase-2-cloud.md, with no
 * exact figure given; an hour is generous enough for one app screen's worth of image loads without
 * leaving a link usable for long after. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type UploadPhoto = (args: { shopId: string; photoId: string; bytes: Uint8Array; mimeType: string }) => Promise<boolean>;
export type GetSignedPhotoUrl = (args: { shopId: string; photoId: string; expiresInSeconds: number }) => Promise<string | undefined>;

export interface SyncHandlerDeps {
  sql: SqlClient;
  uploadPhoto: UploadPhoto;
  getSignedPhotoUrl: GetSignedPhotoUrl;
  now?: () => Date;
  /** Structured, content-free log line per request — never a session token, an invite code, or
   * record data. */
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const unauthorizedResponse = () => jsonResponse({ error: "unauthorized" }, 401);
const forbiddenResponse = () => jsonResponse({ error: "forbidden" }, 403);
const notFoundResponse = () => jsonResponse({ error: "not_found" }, 404);
const rateLimitedResponse = () => jsonResponse({ error: "rate_limited" }, 429);

function randomInviteCode(): string {
  // crypto.getRandomValues, not Math.random: a join code is short-lived and single-use, but there's
  // no reason to reach for a weaker source when a strong one is this cheap.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function createSyncHandler(deps: SyncHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  async function handleCreateShop(userId: string, body: CreateShopBody): Promise<Response> {
    const existing = await findShopCloudById(deps.sql, body.shopId);
    if (existing) {
      if (existing.ownerUserId !== userId) {
        log({ event: "sync_create_shop", status: 409 });
        return jsonResponse({ error: "shop_exists" }, 409);
      }
      // Idempotent retry of a call the app already made (e.g. a dropped response) — ensure the
      // owner's own membership row exists (it always should) and return the same shape either way.
      await insertMembership(deps.sql, { shopId: existing.id, userId, role: "owner", permissions: OWNER_PERMISSIONS });
      log({ event: "sync_create_shop", status: 200, firstUpload: false });
      return jsonResponse({ shop: { id: existing.id, name: existing.name, role: "owner", permissions: OWNER_PERMISSIONS } }, 200);
    }

    await insertShopCloud(deps.sql, { id: body.shopId, ownerUserId: userId, name: body.name });
    await insertMembership(deps.sql, { shopId: body.shopId, userId, role: "owner", permissions: OWNER_PERMISSIONS });
    log({ event: "sync_create_shop", status: 200, firstUpload: true });
    return jsonResponse({ shop: { id: body.shopId, name: body.name, role: "owner", permissions: OWNER_PERMISSIONS } }, 200);
  }

  /** So a signed-in owner (or staff member) can find and restore an existing cloud shop on a new
   * phone: every shop `userId` belongs to, without needing to already know a shopId — unlike every
   * other action here, which takes one. No permission check beyond a valid session: this only ever
   * reads back shops the caller is already a member of (server/sync/store.ts's listShopsForUser scopes
   * the query to `userId` itself), the same posture as sync's own membership-scoped pull. Not rate
   * limited, matching every other read-only action here (members_list, photo_url) — only `sync` itself
   * is (docs/sme-phase-2-cloud.md: "60 syncs per minute per session"). */
  async function handleShopsList(userId: string): Promise<Response> {
    const shops = await listShopsForUser(deps.sql, userId);
    log({ event: "sync_shops_list", status: 200, count: shops.length });
    return jsonResponse({ shops }, 200);
  }

  async function handleSync(userId: string, sessionTokenHash: string, body: SyncBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership) {
      log({ event: "sync", status: 403 });
      return forbiddenResponse();
    }

    const count = await bumpSyncRateLimit(deps.sql, sessionTokenHash, now());
    if (count > MAX_SYNCS_PER_MINUTE) {
      log({ event: "sync", status: 429 });
      return rateLimitedResponse();
    }

    const member: Member = { role: membership.role, permissions: membership.permissions };
    const { conflicts, rejected } = await pushChanges(deps.sql, body.shopId, member, body.changes, userId);
    const pulled = await pullForMember(deps.sql, body.shopId, member, body.cursor);

    log({ event: "sync", status: 200, pushed: body.changes.length, conflicts: conflicts.length, rejected: rejected.length, pulled: pulled.changes.length, more: pulled.more });
    return jsonResponse(
      {
        changes: pulled.changes.map((r) => ({ entity: r.entity, id: r.id, data: r.data, deleted: r.deleted, seq: r.seq, updatedAt: r.updatedAt })),
        cursor: pulled.cursor,
        more: pulled.more,
        conflicts,
        rejected,
        // The caller's CURRENT role and permissions, re-read on every sync, so an owner's change to a
        // staff member's toggles reaches that phone's screens on its next sync instead of only after
        // re-joining. The server-side checks above are the real enforcement either way.
        membership: { role: membership.role, permissions: membership.permissions },
      },
      200,
    );
  }

  async function handleInviteCreate(userId: string, body: InviteCreateBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership || membership.role !== "owner") {
      log({ event: "sync_invite_create", status: 403 });
      return forbiddenResponse();
    }

    let codeHash = "";
    let code = "";
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
      code = randomInviteCode();
      codeHash = await sha256HexOfString(code);
      if (!(await hasActiveInviteWithCodeHash(deps.sql, codeHash, now()))) break;
      code = ""; // Collided with a currently-active invite; try again.
    }
    if (!code) throw new Error("Could not generate a unique invite code after several attempts");

    const expiresAt = new Date(now().getTime() + INVITE_TTL_MS);
    await insertInvite(deps.sql, { id: crypto.randomUUID(), shopId: body.shopId, codeHash, expiresAt });

    log({ event: "sync_invite_create", status: 200 });
    return jsonResponse({ code, expiresAt: expiresAt.toISOString() }, 200);
  }

  async function handleInviteJoin(userId: string, body: InviteJoinBody): Promise<Response> {
    const codeHash = await sha256HexOfString(body.code);
    const invite = await findActiveInviteByCodeHash(deps.sql, codeHash, now());
    if (!invite) {
      log({ event: "sync_invite_join", status: 404 });
      return jsonResponse({ error: "invalid_code" }, 404);
    }

    const existingMembership = await findMembership(deps.sql, invite.shopId, userId);
    if (!existingMembership) {
      const staffCount = await countStaff(deps.sql, invite.shopId);
      if (staffCount >= MAX_STAFF_PER_SHOP) {
        log({ event: "sync_invite_join", status: 403, reason: "staff_limit" });
        return jsonResponse({ error: "staff_limit" }, 403);
      }
      await insertMembership(deps.sql, { shopId: invite.shopId, userId, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    }
    await markInviteUsed(deps.sql, invite.id, userId, now());

    const shop = await findShopCloudById(deps.sql, invite.shopId);
    const role = existingMembership?.role ?? "staff";
    const permissions = existingMembership?.permissions ?? DEFAULT_STAFF_PERMISSIONS;

    log({ event: "sync_invite_join", status: 200, alreadyMember: !!existingMembership });
    return jsonResponse({ shop: { id: shop!.id, name: shop!.name }, role, permissions }, 200);
  }

  async function handleMembersList(userId: string, body: MembersListBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership || membership.role !== "owner") {
      log({ event: "sync_members_list", status: 403 });
      return forbiddenResponse();
    }
    const members = await listMembers(deps.sql, body.shopId);
    log({ event: "sync_members_list", status: 200, count: members.length });
    return jsonResponse({ members }, 200);
  }

  /** Sets a staff member's flags. A grant that lets them pull records they could not before gives those
   * records a fresh seq (server/sync/record-access.ts's newlyVisibleEntities, in the order a phone needs
   * them): their phone's cursor already went past them unsent, and the phones keep their cursor when
   * flags change, so this is what brings them on the next sync. */
  async function handleMembersUpdate(userId: string, body: MembersUpdateBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership || membership.role !== "owner") {
      log({ event: "sync_members_update", status: 403 });
      return forbiddenResponse();
    }
    const before = await findMembership(deps.sql, body.shopId, body.userId);
    const permissions = normalizePermissions(body.permissions);
    const updated = await updateMembershipPermissions(deps.sql, body.shopId, body.userId, permissions);
    if (!updated || !before) {
      log({ event: "sync_members_update", status: 404 });
      return notFoundResponse();
    }
    const resend = newlyVisibleEntities({ role: before.role, permissions: before.permissions }, { role: before.role, permissions });
    let resent = 0;
    for (const entity of resend) resent += await resequenceRecords(deps.sql, body.shopId, entity);
    log({ event: "sync_members_update", status: 200, resentEntities: resend, resent });
    return jsonResponse({ ok: true }, 200);
  }

  async function handleMembersRemove(userId: string, body: MembersRemoveBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership || membership.role !== "owner") {
      log({ event: "sync_members_remove", status: 403 });
      return forbiddenResponse();
    }
    const removed = await removeMembership(deps.sql, body.shopId, body.userId);
    log({ event: "sync_members_remove", status: 200, removed });
    return jsonResponse({ ok: true, removed }, 200);
  }

  /** A product photo (`products`) or an expense's receipt photo (`money`): the two records that carry a
   * photo id and the two flags allowed to write them (server/sync/record-access.ts). */
  async function handlePhotoUpload(userId: string, body: PhotoUploadBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    const member = membership ? { role: membership.role, permissions: membership.permissions } : undefined;
    if (!member || !(hasPermission(member, "products") || hasPermission(member, "money"))) {
      log({ event: "sync_photo_upload", status: 403 });
      return forbiddenResponse();
    }

    const bytes = decodeBase64(body.data);
    if (!bytes) {
      log({ event: "sync_photo_upload", status: 400, reason: "bad_base64" });
      return invalidBodyResponse();
    }
    if (bytes.length > MAX_SYNC_PHOTO_BYTES) {
      log({ event: "sync_photo_upload", status: 413 });
      return tooLargeResponse();
    }
    const sniffed = sniffImageMimeType(bytes);
    if (!sniffed || sniffed !== body.mimeType) {
      log({ event: "sync_photo_upload", status: 400, reason: "mime_mismatch" });
      return invalidBodyResponse();
    }

    const photoId = await sha256Hex(bytes);
    const uploaded = await deps.uploadPhoto({ shopId: body.shopId, photoId, bytes, mimeType: sniffed });
    if (!uploaded) {
      log({ event: "sync_photo_upload", status: 502 });
      return jsonResponse({ error: "upload_failed" }, 502);
    }

    log({ event: "sync_photo_upload", status: 200 });
    return jsonResponse({ photoId }, 200);
  }

  /** Any member who may pull a record carrying a photo id (a product's, an expense's): any flag at all.
   * A member with every flag off pulls no such record, so has no photo to fetch. */
  async function handlePhotoUrl(userId: string, body: PhotoUrlBody): Promise<Response> {
    const membership = await findMembership(deps.sql, body.shopId, userId);
    if (!membership || !canPull({ role: membership.role, permissions: membership.permissions }, "product", "")) {
      log({ event: "sync_photo_url", status: 403 });
      return forbiddenResponse();
    }

    const url = await deps.getSignedPhotoUrl({ shopId: body.shopId, photoId: body.photoId, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
    if (!url) {
      log({ event: "sync_photo_url", status: 404 });
      return notFoundResponse();
    }

    log({ event: "sync_photo_url", status: 200 });
    return jsonResponse({ url, expiresAt: new Date(now().getTime() + SIGNED_URL_TTL_SECONDS * 1000).toISOString() }, 200);
  }

  return async (req) => {
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateSyncBody(raw);
    if (!validated.ok) {
      log({ event: "sync_request", status: validated.error === "too_large" ? 413 : 400 });
      return validated.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
    }
    const body = validated.body;

    const sessionToken = req.headers.get("x-orderat-session") ?? "";
    const resolved = sessionToken ? await resolveSession(deps.sql, sessionToken, now()) : undefined;
    if (!resolved) {
      log({ event: "sync_request", status: 401, action: body.action });
      return unauthorizedResponse();
    }
    const userId = resolved.user.id;

    switch (body.action) {
      case "create_shop": return handleCreateShop(userId, body);
      case "shops_list": return handleShopsList(userId);
      case "sync": return handleSync(userId, resolved.session.tokenHash, body);
      case "invite_create": return handleInviteCreate(userId, body);
      case "invite_join": return handleInviteJoin(userId, body);
      case "members_list": return handleMembersList(userId, body);
      case "members_update": return handleMembersUpdate(userId, body);
      case "members_remove": return handleMembersRemove(userId, body);
      case "photo_upload": return handlePhotoUpload(userId, body);
      case "photo_url": return handlePhotoUrl(userId, body);
      default: return invalidBodyResponse();
    }
  };
}
