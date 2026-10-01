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
  listShopsForUser,
  markInviteUsed,
  pullRecords,
  removeMembership,
  resequenceRecords,
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

  it("resequenceRecords gives one entity of one shop fresh seqs, and touches nothing else", async () => {
    const otherShopId = "55555555-5555-5555-5555-555555555555";
    await insertShopCloud(sql, { id: otherShopId, ownerUserId: OWNER_ID, name: "Other shop" });
    const order = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "new" }, false, OWNER_ID);
    const gone = await upsertRecord(sql, SHOP_ID, "order", "order-2", { status: "new" }, true, OWNER_ID);
    const customer = await upsertRecord(sql, SHOP_ID, "customer", "c1", { name: "Sara" }, false, OWNER_ID);
    const elsewhere = await upsertRecord(sql, otherShopId, "order", "order-1", {}, false, OWNER_ID);

    expect(await resequenceRecords(sql, SHOP_ID, "order")).toBe(2);

    // Both orders now sort after the customer; within one entity the new seqs come in no set order.
    const after = (await pullRecords(sql, SHOP_ID, customer.seq, 500)).sort((a, b) => a.id.localeCompare(b.id));
    expect(after.map((r) => r.id)).toEqual(["order-1", "order-2"]);
    expect(after[0]).toEqual({ ...order, seq: after[0]!.seq });
    expect(after[1]).toEqual({ ...gone, seq: after[1]!.seq });
    expect((await findRecord(sql, SHOP_ID, "customer", "c1"))?.seq).toBe(customer.seq);
    expect((await findRecord(sql, otherShopId, "order", "order-1"))?.seq).toBe(elsewhere.seq);
    expect(await resequenceRecords(sql, SHOP_ID, "expense")).toBe(0);
  });
});

describe("listShopsForUser", () => {
  const OTHER_SHOP_ID = "66666666-6666-6666-6666-666666666666";

  it("returns an empty array for a user with no shop memberships", async () => {
    expect(await listShopsForUser(sql, OWNER_ID)).toEqual([]);
  });

  it("lists a shop the user owns, with name/updatedAt null before any 'shop' record is synced", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });

    expect(await listShopsForUser(sql, OWNER_ID)).toEqual([{ shopId: SHOP_ID, role: "owner", name: null, updatedAt: null }]);
  });

  it("takes name and updatedAt from the shop's own 'shop' entity record, not shops_cloud.name", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes (signup name)" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    const record = await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameAr: "كيكس سارة", nameEn: "Sara's Cakes" }, false, OWNER_ID);

    expect(await listShopsForUser(sql, OWNER_ID)).toEqual([{ shopId: SHOP_ID, role: "owner", name: "كيكس سارة", updatedAt: record.updatedAt }]);
  });

  it("falls back to nameEn when the shop record has no nameAr", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameEn: "Sara's Cakes EN only" }, false, OWNER_ID);

    const shops = await listShopsForUser(sql, OWNER_ID);
    expect(shops[0]?.name).toBe("Sara's Cakes EN only");
  });

  it("treats a tombstoned shop record the same as no record at all", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameAr: "كيكس سارة" }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameAr: "كيكس سارة" }, true, OWNER_ID);

    expect(await listShopsForUser(sql, OWNER_ID)).toEqual([{ shopId: SHOP_ID, role: "owner", name: null, updatedAt: null }]);
  });

  it("includes a shop the user is staff on, reporting role: staff", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await insertMembership(sql, { shopId: SHOP_ID, userId: STAFF_ID, role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS });

    expect(await listShopsForUser(sql, STAFF_ID)).toEqual([{ shopId: SHOP_ID, role: "staff", name: null, updatedAt: null }]);
  });

  it("sorts a shop with real synced activity ahead of a more-recently-created but never-synced shop", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Older shop" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await insertShopCloud(sql, { id: OTHER_SHOP_ID, ownerUserId: OWNER_ID, name: "Newer shop" });
    await insertMembership(sql, { shopId: OTHER_SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameAr: "Older" }, false, OWNER_ID);

    const shops = await listShopsForUser(sql, OWNER_ID);
    expect(shops.map((s) => s.shopId)).toEqual([SHOP_ID, OTHER_SHOP_ID]);
  });

  it("falls back to created_at (newest first) when neither shop has synced a shop record yet", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Older shop" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
    await insertShopCloud(sql, { id: OTHER_SHOP_ID, ownerUserId: OWNER_ID, name: "Newer shop" });
    await insertMembership(sql, { shopId: OTHER_SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });

    const shops = await listShopsForUser(sql, OWNER_ID);
    expect(shops.map((s) => s.shopId)).toEqual([OTHER_SHOP_ID, SHOP_ID]);
  });

  it("never returns a shop belonging only to another user", async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });

    expect(await listShopsForUser(sql, STAFF_ID)).toEqual([]);
  });
});

// Every timestamp this store hands back is ISO 8601 UTC with milliseconds ("2026-09-29T12:00:00.000Z"),
// the format the phones already write and a browser's Date reads back exactly. The SQL drivers give a
// timestamptz as a JS Date, and String(Date) of that ("Tue Sep 29 2026 …") is neither.
describe("timestamps", () => {
  const ISO_WITH_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  beforeEach(async () => {
    await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
    await insertMembership(sql, { shopId: SHOP_ID, userId: OWNER_ID, role: "owner", permissions: OWNER_PERMISSIONS });
  });

  it("findMembership and listMembers report joinedAt as ISO 8601 with milliseconds", async () => {
    const membership = await findMembership(sql, SHOP_ID, OWNER_ID);
    const [member] = await listMembers(sql, SHOP_ID);
    expect(membership?.joinedAt).toMatch(ISO_WITH_MS);
    expect(member?.joinedAt).toBe(membership?.joinedAt);
  });

  it("listShopsForUser reports updatedAt as ISO 8601 with milliseconds", async () => {
    const record = await upsertRecord(sql, SHOP_ID, "shop", SHOP_ID, { nameAr: "كيكس سارة" }, false, OWNER_ID);
    const [shop] = await listShopsForUser(sql, OWNER_ID);
    expect(shop?.updatedAt).toMatch(ISO_WITH_MS);
    expect(shop?.updatedAt).toBe(record.updatedAt);
  });

  it("upsertRecord, findRecord and pullRecords report updatedAt as ISO 8601 with milliseconds, for the instant stored", async () => {
    const written = await upsertRecord(sql, SHOP_ID, "order", "order-1", {}, false, OWNER_ID);
    expect(written.updatedAt).toMatch(ISO_WITH_MS);
    expect((await findRecord(sql, SHOP_ID, "order", "order-1"))?.updatedAt).toBe(written.updatedAt);
    expect((await pullRecords(sql, SHOP_ID, 0, 10))[0]?.updatedAt).toBe(written.updatedAt);

    const stored = await sql.query<{ ms: string }>(
      `select floor(extract(epoch from updated_at) * 1000)::text as ms from orderat.records where shop_id = $1 and entity = 'order' and id = 'order-1'`,
      [SHOP_ID],
    );
    expect(new Date(written.updatedAt).getTime()).toBe(Number(stored[0]!.ms));
  });

  it("also normalizes a driver that returns timestamps as text instead of Date objects", async () => {
    const textDriver: SqlClient = {
      async query<T = Record<string, unknown>>(text: string): Promise<T[]> {
        const row = text.includes("from orderat.shop_members")
          ? { shop_id: SHOP_ID, user_id: OWNER_ID, role: "owner", permissions: {}, joined_at: "2026-09-29 12:00:00.123+00" }
          : { entity: "order", id: "order-1", data: {}, deleted: false, seq: "7", updated_at: "2026-09-29 12:00:00.456+00" };
        return [row as unknown as T];
      },
    };
    expect((await findMembership(textDriver, SHOP_ID, OWNER_ID))?.joinedAt).toBe("2026-09-29T12:00:00.123Z");
    expect((await findRecord(textDriver, SHOP_ID, "order", "order-1"))?.updatedAt).toBe("2026-09-29T12:00:00.456Z");
  });
});
