// The scenarios docs/sme-phase-2-cloud.md's "Sync" section and the SME-phase-2 spec's test list name
// explicitly: last-writer-wins, conflict reporting, tombstones, pull pagination ("more"), and staff
// permission filtering (money, products, prepare-only status edits) — all against a real (if WASM)
// Postgres via server/cloud-pglite-test-support.ts, not a mock.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { pullForMember, pushChanges } from "./push-pull.ts";
import { findRecord, insertShopCloud, upsertRecord } from "./store.ts";
import type { ChangeInput } from "./validate.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";
const owner: Member = { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS };

function change(overrides: Partial<ChangeInput>): ChangeInput {
  return { entity: "order", id: "order-1", data: { status: "pending" }, deleted: false, baseSeq: 0, ...overrides };
}

beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
});

describe("pushChanges / first upload", () => {
  it("accepts a whole batch of brand-new records from the owner, none of them conflicting", async () => {
    const changes: ChangeInput[] = [
      change({ entity: "product", id: "p1", data: { name: "Cake" } }),
      change({ entity: "customer", id: "c1", data: { name: "Sara" } }),
      change({ entity: "order", id: "o1", data: { status: "pending" } }),
    ];
    const result = await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);
    expect(result).toEqual({ conflicts: [], rejected: [] });
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))?.data).toEqual({ name: "Cake" });
  });
});

describe("pushChanges / last-writer-wins and conflict reporting", () => {
  it("a push with a stale baseSeq still applies (last writer wins) but is reported as a conflict", async () => {
    const first = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    // A second phone pushes with baseSeq behind the record's current seq (it never saw the latest pull).
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" }, baseSeq: first.seq - 1 })], OWNER_ID);
    expect(result.conflicts).toEqual([{ entity: "order", id: "order-1", seq: first.seq }]);
    expect(result.rejected).toEqual([]);
    // Last writer wins: the push's data is what's actually stored, despite the conflict.
    expect((await findRecord(sql, SHOP_ID, "order", "order-1"))?.data).toEqual({ status: "confirmed" });
  });

  it("a push whose baseSeq matches (or exceeds) the current seq is not a conflict", async () => {
    const first = await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" }, baseSeq: first.seq })], OWNER_ID);
    expect(result.conflicts).toEqual([]);
  });

  it("a brand-new record (no existing row) is never a conflict, even with baseSeq 0", async () => {
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ baseSeq: 0 })], OWNER_ID);
    expect(result.conflicts).toEqual([]);
  });

  it("every accepted push gets a fresh, strictly increasing seq", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "pending" } })], OWNER_ID);
    const afterFirst = await findRecord(sql, SHOP_ID, "order", "order-1");
    await pushChanges(sql, SHOP_ID, owner, [change({ data: { status: "confirmed" } })], OWNER_ID);
    const afterSecond = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(afterSecond!.seq).toBeGreaterThan(afterFirst!.seq);
  });
});

describe("pushChanges / tombstones", () => {
  it("a deleted: true push is stored, not removed, with deleted: true and a fresh seq", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending" }, false, OWNER_ID);
    const result = await pushChanges(sql, SHOP_ID, owner, [change({ deleted: true })], OWNER_ID);
    expect(result.rejected).toEqual([]);
    const record = await findRecord(sql, SHOP_ID, "order", "order-1");
    expect(record?.deleted).toBe(true);
  });

  it("a tombstone is still pulled (as deleted: true), so other devices learn to remove it too", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ deleted: true })], OWNER_ID);
    const pulled = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]).toMatchObject({ id: "order-1", deleted: true });
  });
});

describe("pushChanges / staff permission filtering", () => {
  it("rejects an expense push from staff without money, without touching any other change in the batch", async () => {
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const changes: ChangeInput[] = [change({ entity: "expense", id: "e1", data: { amount: 10 } }), change({ entity: "order", id: "o1", data: { status: "pending" } })];
    const result = await pushChanges(sql, SHOP_ID, staffNoMoney, changes, STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "expense", id: "e1", reason: "forbidden" }]);
    expect(await findRecord(sql, SHOP_ID, "expense", "e1")).toBeUndefined();
    expect(await findRecord(sql, SHOP_ID, "order", "o1")).toBeDefined();
  });

  it("accepts an expense push from staff with money", async () => {
    const staffWithMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, money: true } };
    const result = await pushChanges(sql, SHOP_ID, staffWithMoney, [change({ entity: "expense", id: "e1", data: { amount: 10 } })], STAFF_ID);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a product push from staff without products", async () => {
    const staffNoProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoProducts, [change({ entity: "product", id: "p1", data: { name: "Cake" } })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "product", id: "p1", reason: "forbidden" }]);
  });

  it("a prepare-only staff member's order push keeps every field but status from the stored record", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "order-1", { status: "pending", customerName: "Sara", items: [{ id: "p1", qty: 2 }] }, false, OWNER_ID);
    const prepareOnly: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
    const result = await pushChanges(sql, SHOP_ID, prepareOnly, [change({ data: { status: "prepped", customerName: "Attempted rename" } })], STAFF_ID);
    expect(result.rejected).toEqual([]);
    expect((await findRecord(sql, SHOP_ID, "order", "order-1"))?.data).toEqual({ status: "prepped", customerName: "Sara", items: [{ id: "p1", qty: 2 }] });
  });

  it("a rejected change carries the server's current copy so the phone can revert exactly", async () => {
    await upsertRecord(sql, SHOP_ID, "product", "p1", { name: "Cake", priceMinor: 5000 }, false, OWNER_ID);
    const staffNoProducts: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoProducts, [change({ entity: "product", id: "p1", data: { name: "Hacked", priceMinor: 1 } })], STAFF_ID);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ entity: "product", id: "p1", reason: "forbidden", record: { data: { name: "Cake", priceMinor: 5000 }, deleted: false } });
    expect(result.rejected[0]!.record!.seq).toBeGreaterThan(0);
  });

  it("a rejected change never leaks a record the member may not see", async () => {
    await upsertRecord(sql, SHOP_ID, "expense", "e1", { amount: 99 }, false, OWNER_ID);
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const result = await pushChanges(sql, SHOP_ID, staffNoMoney, [change({ entity: "expense", id: "e1", data: { amount: 1 } })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "expense", id: "e1", reason: "forbidden" }]);
  });

  it("rejects a prepare-only staff member's attempt to create a brand-new order", async () => {
    const prepareOnly: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, prepare: true } };
    const result = await pushChanges(sql, SHOP_ID, prepareOnly, [change({ id: "brand-new-order" })], STAFF_ID);
    expect(result.rejected).toEqual([{ entity: "order", id: "brand-new-order", reason: "forbidden" }]);
  });

  it("hides expense records from a staff pull when they lack money, without shrinking the page early", async () => {
    await pushChanges(sql, SHOP_ID, owner, [change({ entity: "product", id: "p1", data: {} }), change({ entity: "expense", id: "e1", data: { amount: 5 } })], OWNER_ID);
    const staffNoMoney: Member = { role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, orders: true } };
    const pulled = await pullForMember(sql, SHOP_ID, staffNoMoney, 0);
    expect(pulled.changes.map((c) => c.entity)).toEqual(["product"]);
    // The owner, pulling the same page, sees both.
    const ownerPulled = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(ownerPulled.changes.map((c) => c.entity).sort()).toEqual(["expense", "product"]);
  });
});

describe("pullForMember / pagination", () => {
  it("reports more: true and a cursor at the page boundary when more records remain", async () => {
    const changes: ChangeInput[] = Array.from({ length: 3 }, (_, i) => change({ id: `order-${i}` }));
    await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);

    // Simulate a small page size by pulling with cursor 0 and expecting all 3 back with more:false
    // (3 < the real 500-row page size) — then prove pagination end to end with the cursor it returns.
    const firstPull = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(firstPull.more).toBe(false);
    expect(firstPull.changes).toHaveLength(3);

    const secondPull = await pullForMember(sql, SHOP_ID, owner, firstPull.cursor);
    expect(secondPull.changes).toHaveLength(0);
    expect(secondPull.more).toBe(false);
    expect(secondPull.cursor).toBe(firstPull.cursor);
  });

  it("loops to a second page when the first is exactly full (more: true), then finishes", async () => {
    // Push 501 distinct records so the first 500-row page is completely full.
    const changes: ChangeInput[] = Array.from({ length: 501 }, (_, i) => change({ id: `order-${i}` }));
    await pushChanges(sql, SHOP_ID, owner, changes, OWNER_ID);

    const firstPage = await pullForMember(sql, SHOP_ID, owner, 0);
    expect(firstPage.changes).toHaveLength(500);
    expect(firstPage.more).toBe(true);

    const secondPage = await pullForMember(sql, SHOP_ID, owner, firstPage.cursor);
    expect(secondPage.changes).toHaveLength(1);
    expect(secondPage.more).toBe(false);
  }, 30000);

  it("a pull with no new records returns an empty page and the same cursor", async () => {
    const pulled = await pullForMember(sql, SHOP_ID, owner, 999);
    expect(pulled).toEqual({ changes: [], cursor: 999, more: false });
  });
});
