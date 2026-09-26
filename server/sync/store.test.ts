// Proves db/migrations/0004_cloud.sql's shops_cloud/shop_members/invites/records tables against a
// real (if WASM) Postgres. server/sync/push-pull.test.ts covers the higher-level push/pull
// orchestration (conflicts, tombstones, permission filtering); this file sticks to the CRUD each of
// those calls is built from, plus the shop/member/invite bookkeeping push-pull.ts never touches.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { upsertUser } from "../auth/store.ts";
import { DEFAULT_STAFF_PERMISSIONS, OWNER_PERMISSIONS } from "./permissions.ts";
import {
  countStaff,
  findActiveInviteByCodeHash,
  findMembership,
  findRecord,
  findShopCloudById,
  hasActiveInviteWithCodeHash,
  insertInvite,
  insertMembership,
  insertShopCloud,
  listMembers,
  markInviteUsed,
  pullRecords,
  removeMembership,
  updateMembershipPermissions,
  upsertRecord,
} from "./store.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";

beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await upsertUser(sql, { id: STAFF_ID, provider: "google", providerSub: "staff-sub" });
});

describe("shops_cloud", () => {
  it("inserts and finds a shop by id", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    const shop = await findShopCloudById(sql, SHOP_ID);
    expect(shop).toMatchObject({ id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  });

  it("returns undefined for an unknown shop id", async () => {
    expect(await findShopCloudById(sql, SHOP_ID)).toBeUndefined();
  });
});

describe("shop_members", () => {
  beforeEach(async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
  });

  it("finds the owner's membership", async () => {
    const membership = await findMembership(sql, SHOP_ID, OWNER_ID);
    expect(membership).toMatchObject({ role: "owner", permissions: OWNER_PERMISSIONS });
  });

  it("inserting the same membership twice is a harmless no-op", async () => {
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    const rows = await sql.query(`select 1 from orderat.shop_members where shop_id = $1 and user_id = $2`, [SHOP_ID, OWNER_ID]);
    expect(rows.length).toBe(1);
  });

  it("adds a staff member with default (all-false) permissions", async () => {
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    const membership = await findMembership(sql, SHOP_ID, STAFF_ID);
    expect(membership).toMatchObject({ role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
  });

  it("updates a staff member's permissions and reports success", async () => {
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    const updated = await updateMembershipPermissions(sql, SHOP_ID, STAFF_ID, { orders: true, prepare: false, money: false, products: true });
    expect(updated).toBe(true);
    const membership = await findMembership(sql, SHOP_ID, STAFF_ID);
    expect(membership?.permissions).toEqual({ orders: true, prepare: false, money: false, products: true });
  });

  it("never updates the owner's own row, even when explicitly targeted", async () => {
    const updated = await updateMembershipPermissions(sql, SHOP_ID, OWNER_ID, DEFAULT_STAFF_PERMISSIONS);
    expect(updated).toBe(false);
    const membership = await findMembership(sql, SHOP_ID, OWNER_ID);
    expect(membership?.permissions).toEqual(OWNER_PERMISSIONS);
  });

  it("removes a staff member and reports success", async () => {
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    expect(await removeMembership(sql, SHOP_ID, STAFF_ID)).toBe(true);
    expect(await findMembership(sql, SHOP_ID, STAFF_ID)).toBeUndefined();
  });

  it("never removes the owner, even when explicitly targeted", async () => {
    expect(await removeMembership(sql, SHOP_ID, OWNER_ID)).toBe(false);
    expect(await findMembership(sql, SHOP_ID, OWNER_ID)).toBeDefined();
  });

  it("lists members with the owner first, then staff by join order, with email/name attached", async () => {
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    const members = await listMembers(sql, SHOP_ID);
    expect(members.map((m) => m.role)).toEqual(["owner", "staff"]);
    expect(members[1]).toMatchObject({ userId: STAFF_ID });
  });

  it("counts only staff, not the owner", async () => {
    expect(await countStaff(sql, SHOP_ID)).toBe(0);
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });
    expect(await countStaff(sql, SHOP_ID)).toBe(1);
  });
});

describe("invites", () => {
  beforeEach(async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  });

  it("finds an active invite by its code hash", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    await insertInvite(sql, { id: "44444444-4444-4444-4444-444444444444", shopId: SHOP_ID, codeHash: "hash-1", expiresAt: new Date(now.getTime() + 48 * 3600 * 1000) });
    const invite = await findActiveInviteByCodeHash(sql, "hash-1", now);
    expect(invite).toEqual({ id: "44444444-4444-4444-4444-444444444444", shopId: SHOP_ID });
  });

  it("does not find an invite that has expired", async () => {
    const created = new Date("2026-09-27T12:00:00Z");
    await insertInvite(sql, { id: "44444444-4444-4444-4444-444444444444", shopId: SHOP_ID, codeHash: "hash-1", expiresAt: new Date(created.getTime() + 48 * 3600 * 1000) });
    const justAfterExpiry = new Date(created.getTime() + 48 * 3600 * 1000 + 1000);
    expect(await findActiveInviteByCodeHash(sql, "hash-1", justAfterExpiry)).toBeUndefined();
  });

  it("does not find an invite that has already been used (single use)", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    await insertInvite(sql, { id: "44444444-4444-4444-4444-444444444444", shopId: SHOP_ID, codeHash: "hash-1", expiresAt: new Date(now.getTime() + 48 * 3600 * 1000) });
    await markInviteUsed(sql, "44444444-4444-4444-4444-444444444444", STAFF_ID, now);
    expect(await findActiveInviteByCodeHash(sql, "hash-1", now)).toBeUndefined();
  });

  it("hasActiveInviteWithCodeHash mirrors findActiveInviteByCodeHash's active/expired/used rules", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(await hasActiveInviteWithCodeHash(sql, "hash-1", now)).toBe(false);
    await insertInvite(sql, { id: "44444444-4444-4444-4444-444444444444", shopId: SHOP_ID, codeHash: "hash-1", expiresAt: new Date(now.getTime() + 48 * 3600 * 1000) });
    expect(await hasActiveInviteWithCodeHash(sql, "hash-1", now)).toBe(true);
    await markInviteUsed(sql, "44444444-4444-4444-4444-444444444444", STAFF_ID, now);
    expect(await hasActiveInviteWithCodeHash(sql, "hash-1", now)).toBe(false);
  });
});

describe("records", () => {
  beforeEach(async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  });

  it("upserting a brand-new record assigns a seq and stores it, findable by (shop, entity, id)", async () => {
    const row = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    expect(row.seq).toBeGreaterThan(0);
    const found = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(found).toMatchObject({ entity: "order", id: "order-1", data: { status: "pending" }, deleted: false, seq: row.seq });
  });

  it("upserting an existing record draws a fresh, higher seq every time, not just on insert", async () => {
    const first = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    const second = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "confirmed" }, false, OWNER_ID);
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(second.data).toEqual({ status: "confirmed" });
  });

  it("a tombstoned (deleted) record is kept, not removed, and reported with deleted: true", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, true, OWNER_ID);
    const found = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(found?.deleted).toBe(true);
  });

  it("pullRecords returns rows strictly after cursor, ordered by seq, up to the given limit", async () => {
    const a = await upsertRecord(sql, SHOP_ID, "order", "order-a", {}, false, OWNER_ID);
    const b = await upsertRecord(sql, SHOP_ID, "order", "order-b", {}, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "order-c", {}, false, OWNER_ID);

    const page = await pullRecords(sql, SHOP_ID, a.seq, 1);
    expect(page).toHaveLength(1);
    expect(page[0]!.id).toBe("order-b");
    expect(page[0]!.seq).toBe(b.seq);
  });

  it("keeps different shops' records independent", async () => {
    const otherShopId = "55555555-5555-5555-5555-555555555555";
    await insertShopCloud(sql, { id: otherShopId, ownerUserId: OWNER_ID, name: "Other shop" });
    await upsertRecord(sql, SHOP_ID, "order", "order-1", {}, false, OWNER_ID);
    await upsertRecord(sql, otherShopId, "order", "order-1", {}, false, OWNER_ID);
    expect(await pullRecords(sql, SHOP_ID, 0, 500)).toHaveLength(1);
    expect(await pullRecords(sql, otherShopId, 0, 500)).toHaveLength(1);
  });
});
