// Database access for shops, members, invites and the record log (docs/sme-phase-2-cloud.md's
// "Shops and members" and "Sync"), backed by db/migrations/0004_cloud.sql. Every query is
// parameterized; server/sync/handler.ts is the only caller, always after server/sync/validate.ts and
// server/sync/record-access.ts have already decided what's allowed. Pure CRUD only — no permission
// policy lives here (that's record-access.ts) and no request/response shaping (that's handler.ts).

import type { SqlClient } from "../agent/postgres-store.ts";
import type { Entity } from "./record-access.ts";
import { normalizePermissions, type Permissions, type Role } from "./permissions.ts";

export interface ShopCloudRow {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
}

function toShopCloudRow(row: Record<string, unknown>): ShopCloudRow {
  return { id: row.id as string, ownerUserId: row.owner_user_id as string, name: row.name as string, createdAt: String(row.created_at) };
}

export async function findShopCloudById(sql: SqlClient, shopId: string): Promise<ShopCloudRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(`select id, owner_user_id, name, created_at from orderat.shops_cloud where id = $1`, [shopId]);
  return rows[0] ? toShopCloudRow(rows[0]) : undefined;
}

export async function insertShopCloud(sql: SqlClient, input: { id: string; ownerUserId: string; name: string }): Promise<void> {
  await sql.query(`insert into orderat.shops_cloud (id, owner_user_id, name) values ($1, $2, $3)`, [input.id, input.ownerUserId, input.name]);
}

export interface MembershipRow {
  shopId: string;
  userId: string;
  role: Role;
  permissions: Permissions;
  joinedAt: string;
}

function toMembershipRow(row: Record<string, unknown>): MembershipRow {
  return {
    shopId: row.shop_id as string,
    userId: row.user_id as string,
    role: row.role as Role,
    permissions: normalizePermissions(row.permissions),
    joinedAt: String(row.joined_at),
  };
}

export async function findMembership(sql: SqlClient, shopId: string, userId: string): Promise<MembershipRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(
    `select shop_id, user_id, role, permissions, joined_at from orderat.shop_members where shop_id = $1 and user_id = $2`,
    [shopId, userId],
  );
  return rows[0] ? toMembershipRow(rows[0]) : undefined;
}

export async function insertMembership(sql: SqlClient, input: { shopId: string; userId: string; role: Role; permissions: Permissions }): Promise<void> {
  await sql.query(
    `insert into orderat.shop_members (shop_id, user_id, role, permissions) values ($1, $2, $3, $4::text::jsonb)
     on conflict (shop_id, user_id) do nothing`,
    [input.shopId, input.userId, input.role, JSON.stringify(input.permissions)],
  );
}

/** Updates a *staff* member's permissions (never the owner's — the `role = 'staff'` guard means a
 * call targeting the owner's own row simply matches nothing). Returns whether a row was actually
 * updated, so server/sync/handler.ts can tell "no such staff member" apart from success. */
export async function updateMembershipPermissions(sql: SqlClient, shopId: string, userId: string, permissions: Permissions): Promise<boolean> {
  const rows = await sql.query<{ user_id: string }>(
    `update orderat.shop_members set permissions = $3::text::jsonb where shop_id = $1 and user_id = $2 and role = 'staff' returning user_id`,
    [shopId, userId, JSON.stringify(permissions)],
  );
  return rows.length > 0;
}

/** Removes a *staff* member (never the owner — same `role = 'staff'` guard as above). Returns whether
 * a row was actually removed. */
export async function removeMembership(sql: SqlClient, shopId: string, userId: string): Promise<boolean> {
  const rows = await sql.query<{ user_id: string }>(
    `delete from orderat.shop_members where shop_id = $1 and user_id = $2 and role = 'staff' returning user_id`,
    [shopId, userId],
  );
  return rows.length > 0;
}

export interface MemberListEntry {
  userId: string;
  role: Role;
  permissions: Permissions;
  joinedAt: string;
  email?: string;
  name?: string;
}

/** Every member of a shop, owner first then staff by join order — joined to `users` for display
 * (email/name); the inner join is safe because a membership row can never outlive its user (both
 * foreign keys in 0004_cloud.sql cascade). */
export async function listMembers(sql: SqlClient, shopId: string): Promise<MemberListEntry[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select m.user_id, m.role, m.permissions, m.joined_at, u.email, u.name
     from orderat.shop_members m
     join orderat.users u on u.id = m.user_id
     where m.shop_id = $1
     order by (m.role = 'owner') desc, m.joined_at asc`,
    [shopId],
  );
  return rows.map((row) => ({
    userId: row.user_id as string,
    role: row.role as Role,
    permissions: normalizePermissions(row.permissions),
    joinedAt: String(row.joined_at),
    email: (row.email as string | null) ?? undefined,
    name: (row.name as string | null) ?? undefined,
  }));
}

export async function countStaff(sql: SqlClient, shopId: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(`select count(*)::int as count from orderat.shop_members where shop_id = $1 and role = 'staff'`, [shopId]);
  return rows[0]?.count ?? 0;
}

// --- Invites -----------------------------------------------------------------------------------

/** Whether an active (unused, unexpired) invite already uses `codeHash` — checked by
 * server/sync/handler.ts before inserting a freshly-generated code, since a 6-digit code has no
 * database-level uniqueness constraint (see db/migrations/0004_cloud.sql's comment on
 * orderat.invites for why: a partial unique index can't reference now()). */
export async function hasActiveInviteWithCodeHash(sql: SqlClient, codeHash: string, now: Date): Promise<boolean> {
  const rows = await sql.query(
    `select 1 from orderat.invites where code_hash = $1 and used_at is null and expires_at > $2 limit 1`,
    [codeHash, now.toISOString()],
  );
  return rows.length > 0;
}

export async function insertInvite(sql: SqlClient, input: { id: string; shopId: string; codeHash: string; expiresAt: Date }): Promise<void> {
  await sql.query(
    `insert into orderat.invites (id, shop_id, code_hash, expires_at) values ($1, $2, $3, $4)`,
    [input.id, input.shopId, input.codeHash, input.expiresAt.toISOString()],
  );
}

export interface ActiveInvite {
  id: string;
  shopId: string;
}

/** The active (unused, unexpired) invite for `codeHash`, if any — the most recently created one,
 * for the vanishingly rare case where an old, already-expired-or-used row happens to share the same
 * code_hash as a currently-active one (no uniqueness is enforced; see hasActiveInviteWithCodeHash). */
export async function findActiveInviteByCodeHash(sql: SqlClient, codeHash: string, now: Date): Promise<ActiveInvite | undefined> {
  const rows = await sql.query<{ id: string; shop_id: string }>(
    `select id, shop_id from orderat.invites where code_hash = $1 and used_at is null and expires_at > $2 order by created_at desc limit 1`,
    [codeHash, now.toISOString()],
  );
  return rows[0] ? { id: rows[0].id, shopId: rows[0].shop_id } : undefined;
}

export async function markInviteUsed(sql: SqlClient, inviteId: string, usedByUserId: string, now: Date): Promise<void> {
  await sql.query(`update orderat.invites set used_at = $2, used_by_user_id = $3 where id = $1`, [inviteId, now.toISOString(), usedByUserId]);
}

// --- Records -------------------------------------------------------------------------------------

export interface RecordRow {
  entity: Entity;
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  seq: number;
  updatedAt: string;
}

function toRecordRow(row: Record<string, unknown>): RecordRow {
  return {
    entity: row.entity as Entity,
    id: row.id as string,
    data: row.data as Record<string, unknown>,
    deleted: row.deleted as boolean,
    seq: Number(row.seq),
    updatedAt: String(row.updated_at),
  };
}

export async function findRecord(sql: SqlClient, shopId: string, entity: Entity, id: string): Promise<RecordRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(
    `select entity, id, data, deleted, seq, updated_at from orderat.records where shop_id = $1 and entity = $2 and id = $3`,
    [shopId, entity, id],
  );
  return rows[0] ? toRecordRow(rows[0]) : undefined;
}

/**
 * Inserts or updates one record and returns the row as stored, always carrying a freshly-drawn `seq`
 * — "last writer wins" (docs/sme-phase-2-cloud.md) is decided purely by which write's `seq` ends up
 * highest, so the UPDATE branch re-draws from the bigserial's own sequence explicitly
 * (`nextval(pg_get_serial_sequence(...))`) rather than relying on its DEFAULT, which Postgres only
 * ever applies on INSERT.
 */
export async function upsertRecord(
  sql: SqlClient,
  shopId: string,
  entity: Entity,
  id: string,
  data: Record<string, unknown>,
  deleted: boolean,
  updatedBy: string,
): Promise<RecordRow> {
  const rows = await sql.query<Record<string, unknown>>(
    `insert into orderat.records (shop_id, entity, id, data, deleted, updated_by, updated_at)
     values ($1, $2, $3, $4::text::jsonb, $5, $6, now())
     on conflict (shop_id, entity, id) do update
       set data = excluded.data,
           deleted = excluded.deleted,
           updated_by = excluded.updated_by,
           updated_at = now(),
           seq = nextval(pg_get_serial_sequence('orderat.records', 'seq'))
     returning entity, id, data, deleted, seq, updated_at`,
    [shopId, entity, id, JSON.stringify(data), deleted, updatedBy],
  );
  return toRecordRow(rows[0]!);
}

/** Up to `limit` records for `shopId` with seq > cursor, oldest-first — the exact "records with
 * seq > cursor, up to 500" page docs/sme-phase-2-cloud.md's `sync` action pulls, before
 * server/sync/push-pull.ts filters it by the caller's own permissions. */
export async function pullRecords(sql: SqlClient, shopId: string, cursor: number, limit: number): Promise<RecordRow[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select entity, id, data, deleted, seq, updated_at from orderat.records where shop_id = $1 and seq > $2 order by seq asc limit $3`,
    [shopId, cursor, limit],
  );
  return rows.map(toRecordRow);
}
