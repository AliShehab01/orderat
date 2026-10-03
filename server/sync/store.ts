// Database access for shops, members, invites and the record log (docs/sme-phase-2-cloud.md's
// "Shops and members" and "Sync"), backed by db/migrations/0004_cloud.sql. Every query is
// parameterized; server/sync/handler.ts is the only caller, always after server/sync/validate.ts and
// server/sync/record-access.ts have already decided what's allowed. Pure CRUD only — no permission
// policy lives here (that's record-access.ts) and no request/response shaping (that's handler.ts).

import type { SqlClient } from "../agent/postgres-store.ts";
import type { Entity } from "./record-access.ts";
import { normalizePermissions, type Permissions, type Role } from "./permissions.ts";

/** A timestamptz as ISO 8601 UTC with milliseconds ("2026-09-29T12:00:00.000Z") — the format the
 * phones write and a browser's Date reads back exactly. Both SQL drivers (and PGlite in tests) hand a
 * timestamptz back as a JS Date, whose String() form ("Tue Sep 29 2026 …") is neither ISO nor
 * parseable the same way everywhere; a value that arrives as text is parsed and re-emitted, so the
 * wire format never depends on how a driver is configured. Only for a value known to be set. */
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

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
    joinedAt: toIso(row.joined_at),
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
    joinedAt: toIso(row.joined_at),
    email: (row.email as string | null) ?? undefined,
    name: (row.name as string | null) ?? undefined,
  }));
}

export async function countStaff(sql: SqlClient, shopId: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(`select count(*)::int as count from orderat.shop_members where shop_id = $1 and role = 'staff'`, [shopId]);
  return rows[0]?.count ?? 0;
}

export interface ShopListEntry {
  shopId: string;
  role: Role;
  name: string | null;
  updatedAt: string | null;
}

/** `name`'s source, per the entity table in docs/sme-phase-2-cloud.md's "Record formats": the shop's
 * canonical `shop` record (`nameAr` required, `nameEn` optional) — never `shops_cloud.name`, which is
 * only ever the value given once at create_shop time and is never touched again as the seller renames
 * their shop through an ordinary sync. `nameAr` wins when both are present, matching the Arabic-first
 * convention the rest of this codebase uses for display (server/agent/reply.ts). */
function shopNameFromRecordData(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.nameAr === "string" && obj.nameAr.trim().length > 0) return obj.nameAr;
  if (typeof obj.nameEn === "string" && obj.nameEn.trim().length > 0) return obj.nameEn;
  return null;
}

/**
 * Every shop `userId` is a member of, owner or staff — for server/sync/handler.ts's `shops_list`
 * action, which exists so a signed-in owner (or staff member) can find and restore an existing cloud
 * shop on a new phone. `name` and `updatedAt` both come from the shop's own `shop` entity record in
 * `orderat.records` (id = the shop's id, per the entity table in docs/sme-phase-2-cloud.md), not from
 * `shops_cloud`: that record is the seller's actual, currently-synced shop data, kept up to date by
 * every ordinary sync, while `shops_cloud.name`/`created_at` are only ever set once, at create_shop
 * time. Both are null until that record exists — e.g. between create_shop and the first real sync — or
 * if it was ever pushed as a tombstone (excluded by `r.deleted = false` in the join, though nothing in
 * server/sync ever deletes a shop's own record in practice).
 *
 * Ordered newest-first by that same record's `updated_at`, so the shop the seller most recently
 * touched from any device sorts first — the natural default when picking which shop to restore.
 * Shops with no `shop` record yet (nulls, sorted last by `nulls last`) fall back to
 * `shops_cloud.created_at` so freshly created, not-yet-synced shops still sort newest-first among
 * themselves.
 */
export async function listShopsForUser(sql: SqlClient, userId: string): Promise<ShopListEntry[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select m.shop_id, m.role, r.data as shop_data, r.updated_at as shop_updated_at
     from orderat.shop_members m
     join orderat.shops_cloud s on s.id = m.shop_id
     left join orderat.records r
       on r.shop_id = m.shop_id and r.entity = 'shop' and r.id = m.shop_id::text and r.deleted = false
     where m.user_id = $1
     order by r.updated_at desc nulls last, s.created_at desc`,
    [userId],
  );
  return rows.map((row) => ({
    shopId: row.shop_id as string,
    role: row.role as Role,
    name: shopNameFromRecordData(row.shop_data),
    updatedAt: row.shop_updated_at ? toIso(row.shop_updated_at) : null,
  }));
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

export type InviteClaim =
  | { outcome: "invalid" }
  | { outcome: "staff_limit" }
  | { outcome: "joined" | "already_member"; shopId: string; role: Role; permissions: Permissions };

/**
 * Claims the active invite for `codeHash` for `userId` and creates the staff membership, in ONE call
 * (orderat.claim_invite, db/migrations/0010_order_stock.sql; third review, 3 Oct 2026, F5): the invite is locked, so
 * two accounts racing for one code get exactly one membership and the other the plain "invalid" answer, and the
 * staff count is read under a lock on the shop, so the limit holds when two different invites race for the last
 * seat. "joined": a new staff member; "already_member": the user already belongs to the shop (the invite is
 * used up, nothing is added, the existing role comes back); "staff_limit": the shop is full and the invite stays
 * unused; "invalid": no unused, unexpired invite with that code.
 */
export async function claimInvite(
  sql: SqlClient,
  input: { codeHash: string; userId: string; now: Date; permissions: Permissions; maxStaff: number },
): Promise<InviteClaim> {
  const rows = await sql.query<{ result: Record<string, unknown> }>(
    `select orderat.claim_invite($1, $2::uuid, $3::timestamptz, $4::text::jsonb, $5::int) as result`,
    [input.codeHash, input.userId, input.now.toISOString(), JSON.stringify(input.permissions), input.maxStaff],
  );
  const result = rows[0]?.result;
  const outcome = result?.outcome;
  if (outcome === "joined" || outcome === "already_member") {
    return { outcome, shopId: String(result!.shopId), role: result!.role as Role, permissions: normalizePermissions(result!.permissions) };
  }
  return { outcome: outcome === "staff_limit" ? "staff_limit" : "invalid" };
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

const RECORD_COLUMNS = "entity, id, data, deleted, seq, updated_at";

function toRecordRow(row: Record<string, unknown>): RecordRow {
  return {
    entity: row.entity as Entity,
    id: row.id as string,
    data: row.data as Record<string, unknown>,
    deleted: row.deleted as boolean,
    seq: Number(row.seq),
    updatedAt: toIso(row.updated_at),
  };
}

export async function findRecord(sql: SqlClient, shopId: string, entity: Entity, id: string): Promise<RecordRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(
    `select ${RECORD_COLUMNS} from orderat.records where shop_id = $1 and entity = $2 and id = $3`,
    [shopId, entity, id],
  );
  return rows[0] ? toRecordRow(rows[0]) : undefined;
}

/** The records of `entity` with these ids (those that exist, deleted or not), in one read. */
export async function findRecordsByIds(sql: SqlClient, shopId: string, entity: Entity, ids: string[]): Promise<RecordRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql.query<Record<string, unknown>>(
    `select ${RECORD_COLUMNS} from orderat.records where shop_id = $1 and entity = $2 and id in (select jsonb_array_elements_text($3::text::jsonb))`,
    [shopId, entity, JSON.stringify(ids)],
  );
  return rows.map(toRecordRow);
}

/** The server's applied stock allocations (db/migrations/0010_order_stock.sql order_stock) of these orders. */
export async function findOrderStock(sql: SqlClient, shopId: string, orderIds: string[]): Promise<{ orderId: string; productId: string; units: number }[]> {
  if (orderIds.length === 0) return [];
  const rows = await sql.query<{ order_id: string; product_id: string; units: number }>(
    `select order_id, product_id, units from orderat.order_stock where shop_id = $1 and order_id in (select jsonb_array_elements_text($2::text::jsonb))`,
    [shopId, JSON.stringify(orderIds)],
  );
  return rows.map((r) => ({ orderId: r.order_id, productId: r.product_id, units: Number(r.units) }));
}

/** Which of these stock move keys stock_ops already holds (applied or ignored before). */
export async function findStockOps(sql: SqlClient, shopId: string, opIds: string[]): Promise<Set<string>> {
  if (opIds.length === 0) return new Set();
  const rows = await sql.query<{ op_id: string }>(
    `select op_id from orderat.stock_ops where shop_id = $1 and op_id in (select jsonb_array_elements_text($2::text::jsonb))`,
    [shopId, JSON.stringify(opIds)],
  );
  return new Set(rows.map((r) => r.op_id));
}

/** One record write together with the stock bookkeeping that must commit with it (see writeAtomic). */
export interface AtomicWrite {
  primary: { entity: Entity; id: string; /** The seq it was decided on; undefined: it must not exist yet. */ expectSeq: number | undefined; data: Record<string, unknown>; deleted: boolean };
  /** Records read but not written (the orders a product push's stock moves were judged against), with the seq read. */
  deps: { entity: Entity; id: string; seq: number }[];
  /** Relative stock updates of products, each with a server-made move (see sync_apply). */
  effects: { productId: string; orderId: string; delta: number; reason: string; at: string }[];
  orderStock: { orderId: string; productId: string; expect: number | null; units: number; write: boolean }[];
  ops: { opId: string; productId: string | null; outcome: "applied" | "ignored" }[];
  listed: { opId: string; productId: string | null }[];
}

/**
 * The sync push's multi-record compare-and-swap (orderat.sync_apply, db/migrations/0010_order_stock.sql): writes
 * the primary record only while it, and everything the decision read, is still as read, together with its stock
 * effects, allocation rows and stock_ops rows, all or nothing. ONE call, so it is atomic for the transaction
 * pooler and both SQL drivers without a client-side transaction, exactly as writeRecordIfUnchanged is for one
 * record. Returns the primary record as stored (with its fresh seq), or undefined when anything moved
 * meanwhile and nothing was written: the caller reads and decides again (server/sync/push-pull.ts).
 */
export async function writeAtomic(sql: SqlClient, shopId: string, updatedBy: string, write: AtomicWrite): Promise<RecordRow | undefined> {
  const { primary } = write;
  const rows = await sql.query<Record<string, unknown>>(
    `select entity, id, data, deleted, seq, updated_at
       from orderat.sync_apply($1::uuid, $2::uuid, $3::text::jsonb, $4::text::jsonb, $5::text::jsonb, $6::text::jsonb, $7::text::jsonb, $8::text::jsonb)`,
    [
      shopId,
      updatedBy,
      JSON.stringify({ entity: primary.entity, id: primary.id, expect_seq: primary.expectSeq ?? null, data: primary.data, deleted: primary.deleted }),
      JSON.stringify(write.deps),
      JSON.stringify(write.effects.map((e) => ({ product_id: e.productId, order_id: e.orderId, delta: e.delta, reason: e.reason, at: e.at }))),
      JSON.stringify(write.orderStock.map((o) => ({ order_id: o.orderId, product_id: o.productId, expect: o.expect, units: o.units, write: o.write }))),
      JSON.stringify(write.ops.map((o) => ({ op_id: o.opId, product_id: o.productId, outcome: o.outcome }))),
      JSON.stringify(write.listed.map((o) => ({ op_id: o.opId, product_id: o.productId }))),
    ],
  );
  return rows[0] ? toRecordRow(rows[0]) : undefined;
}

/**
 * Inserts or updates one record and returns the row as stored, always carrying a freshly-drawn `seq`
 * — "last writer wins" (docs/sme-phase-2-cloud.md) is decided purely by which write's `seq` ends up
 * highest, so the UPDATE branch re-draws from the bigserial's own sequence explicitly
 * (`nextval(pg_get_serial_sequence(...))`) rather than relying on its DEFAULT, which Postgres only
 * ever applies on INSERT. A blind write, whatever the record holds by then: the sync push writes
 * through writeRecordIfUnchanged below instead (security retest 1 Oct 2026, R01).
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
     returning ${RECORD_COLUMNS}`,
    [shopId, entity, id, JSON.stringify(data), deleted, updatedBy],
  );
  return toRecordRow(rows[0]!);
}

/**
 * Writes one record only if it is still the version the caller read (security retest 1 Oct 2026, R01):
 * a compare-and-swap on `seq`, which every write to a record re-draws, so a seq that still matches
 * means no other write landed in between. `expectedSeq` is the seq the caller read, or undefined when
 * it read no row at all: the write then only inserts, and only while the record still does not exist.
 * One statement either way, so it is atomic without a transaction (the transaction pooler and both SQL
 * drivers run it as is): under READ COMMITTED, an UPDATE that has to wait for a concurrent write to the
 * same row re-checks `seq` on the row that write left, and an INSERT that meets a row inserted
 * meanwhile does nothing.
 *
 * Returns the row as stored, with a fresh seq, or undefined when another write got there first and
 * nothing was written: the caller reads the record again and decides afresh (server/sync/push-pull.ts).
 */
export async function writeRecordIfUnchanged(
  sql: SqlClient,
  shopId: string,
  entity: Entity,
  id: string,
  data: Record<string, unknown>,
  deleted: boolean,
  updatedBy: string,
  expectedSeq: number | undefined,
): Promise<RecordRow | undefined> {
  const rows = expectedSeq === undefined
    ? await sql.query<Record<string, unknown>>(
        `insert into orderat.records (shop_id, entity, id, data, deleted, updated_by, updated_at)
         values ($1, $2, $3, $4::text::jsonb, $5, $6, now())
         on conflict (shop_id, entity, id) do nothing
         returning ${RECORD_COLUMNS}`,
        [shopId, entity, id, JSON.stringify(data), deleted, updatedBy],
      )
    : await sql.query<Record<string, unknown>>(
        `update orderat.records
            set data = $4::text::jsonb,
                deleted = $5,
                updated_by = $6,
                updated_at = now(),
                seq = nextval(pg_get_serial_sequence('orderat.records', 'seq'))
          where shop_id = $1 and entity = $2 and id = $3 and seq = $7
          returning ${RECORD_COLUMNS}`,
        [shopId, entity, id, JSON.stringify(data), deleted, updatedBy, expectedSeq],
      );
  return rows[0] ? toRecordRow(rows[0]) : undefined;
}

/**
 * Gives one record a fresh seq, nothing else of it touched (data, deleted, updated_at and updated_by stay), but only while it
 * still has `expectedSeq`: a compare-and-swap like writeRecordIfUnchanged, so a record another write has changed since is left
 * exactly as that write made it. Returns the new seq, or undefined when the record had moved on.
 *
 * Fourth review, R1: the order a push wrote is given its seq again after the products of its lines, so a pull in seq order
 * delivers the products first (server/sync/push-pull.ts orderAfterItsProducts).
 */
export async function resequenceRecordIfUnchanged(sql: SqlClient, shopId: string, entity: Entity, id: string, expectedSeq: number): Promise<number | undefined> {
  const rows = await sql.query<{ seq: number }>(
    `update orderat.records
        set seq = nextval(pg_get_serial_sequence('orderat.records', 'seq'))
      where shop_id = $1 and entity = $2 and id = $3 and seq = $4
      returning seq`,
    [shopId, entity, id, expectedSeq],
  );
  return rows[0] ? Number(rows[0].seq) : undefined;
}

/**
 * Gives every record of `entity` in `shopId` a fresh seq — data, deleted, updated_at and updated_by
 * untouched — so every device of the shop pulls them again from wherever its cursor is. For
 * server/sync/handler.ts's members_update: records a staff member was not allowed to pull went past
 * their phone's cursor unsent, and a grant must bring them. Returns how many records moved.
 */
export async function resequenceRecords(sql: SqlClient, shopId: string, entity: Entity): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `with moved as (
       update orderat.records set seq = nextval(pg_get_serial_sequence('orderat.records', 'seq'))
       where shop_id = $1 and entity = $2
       returning 1
     )
     select count(*)::int as count from moved`,
    [shopId, entity],
  );
  return rows[0]?.count ?? 0;
}

/** Up to `limit` records for `shopId` with seq > cursor, oldest-first — the exact "records with
 * seq > cursor, up to 500" page docs/sme-phase-2-cloud.md's `sync` action pulls, before
 * server/sync/push-pull.ts filters it by the caller's own permissions. */
export async function pullRecords(sql: SqlClient, shopId: string, cursor: number, limit: number): Promise<RecordRow[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select ${RECORD_COLUMNS} from orderat.records where shop_id = $1 and seq > $2 order by seq asc limit $3`,
    [shopId, cursor, limit],
  );
  return rows.map(toRecordRow);
}
