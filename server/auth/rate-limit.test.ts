import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { bumpPairApproveRateLimit } from "./rate-limit.ts";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createCloudTestSql();
});

describe("bumpPairApproveRateLimit", () => {
  const now = new Date("2026-09-29T12:00:00Z");

  it("starts a session's counter at 1 and counts every call within the window", async () => {
    expect(await bumpPairApproveRateLimit(sql, "hash-a", now)).toBe(1);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", new Date(now.getTime() + 1000))).toBe(2);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", new Date(now.getTime() + 2000))).toBe(3);
  });

  it("keeps different sessions' counters independent", async () => {
    expect(await bumpPairApproveRateLimit(sql, "hash-a", now)).toBe(1);
    expect(await bumpPairApproveRateLimit(sql, "hash-b", now)).toBe(1);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", now)).toBe(2);
  });

  it("does not share its counter with the sync rate limit", async () => {
    await sql.query(`insert into orderat.sync_rate_limit (token_hash, window_started_at, count) values ('hash-a', $1, 60)`, [now.toISOString()]);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", now)).toBe(1);
  });

  it("starts a new window 60 seconds after the current one started, and not at 59", async () => {
    for (let i = 0; i < 11; i++) await bumpPairApproveRateLimit(sql, "hash-a", now);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", new Date(now.getTime() + 59_000))).toBe(12);
    expect(await bumpPairApproveRateLimit(sql, "hash-a", new Date(now.getTime() + 60_000))).toBe(1);
  });
});
