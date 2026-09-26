import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { bumpSyncRateLimit, MAX_SYNCS_PER_MINUTE } from "./rate-limit.ts";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createCloudTestSql();
});

describe("bumpSyncRateLimit", () => {
  it("starts a session's counter at 1 and increments by 1 each call within the window", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(await bumpSyncRateLimit(sql, "hash-a", now)).toBe(1);
    expect(await bumpSyncRateLimit(sql, "hash-a", new Date(now.getTime() + 1000))).toBe(2);
    expect(await bumpSyncRateLimit(sql, "hash-a", new Date(now.getTime() + 2000))).toBe(3);
  });

  it("keeps different sessions' counters independent", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(await bumpSyncRateLimit(sql, "hash-a", now)).toBe(1);
    expect(await bumpSyncRateLimit(sql, "hash-b", now)).toBe(1);
    expect(await bumpSyncRateLimit(sql, "hash-a", now)).toBe(2);
  });

  it("allows exactly 60 calls within a minute, per docs/sme-phase-2-cloud.md's limit", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    let last = 0;
    for (let i = 0; i < MAX_SYNCS_PER_MINUTE; i++) last = await bumpSyncRateLimit(sql, "hash-a", now);
    expect(last).toBe(MAX_SYNCS_PER_MINUTE);
  });

  it("the 61st call within the same window pushes the count past the limit (caller rejects it)", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    for (let i = 0; i < MAX_SYNCS_PER_MINUTE; i++) await bumpSyncRateLimit(sql, "hash-a", now);
    const count = await bumpSyncRateLimit(sql, "hash-a", now);
    expect(count).toBe(MAX_SYNCS_PER_MINUTE + 1);
    expect(count > MAX_SYNCS_PER_MINUTE).toBe(true);
  });

  it("resets the counter once 60 seconds have elapsed since the window started", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    for (let i = 0; i < MAX_SYNCS_PER_MINUTE; i++) await bumpSyncRateLimit(sql, "hash-a", now);
    const nextWindow = new Date(now.getTime() + 60_000);
    expect(await bumpSyncRateLimit(sql, "hash-a", nextWindow)).toBe(1);
  });

  it("does not yet reset at 59 seconds", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    await bumpSyncRateLimit(sql, "hash-a", now);
    const stillSameWindow = new Date(now.getTime() + 59_000);
    expect(await bumpSyncRateLimit(sql, "hash-a", stillSameWindow)).toBe(2);
  });
});
