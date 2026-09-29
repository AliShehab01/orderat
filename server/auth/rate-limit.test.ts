import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { bumpPairApproveRateLimit, bumpPairStartRateLimit } from "./rate-limit.ts";
import { deleteAccount, upsertUser } from "./store.ts";

let sql: SqlClient;
const now = new Date("2026-09-29T12:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

beforeEach(async () => {
  sql = await createCloudTestSql();
});

/** The fixed-window behavior both limits share, run against one of them with two keys from `keys`. */
function fixedWindowTests(bump: (sql: SqlClient, key: string, now: Date) => Promise<number>, keys: () => Promise<[string, string]>) {
  it("starts a key's counter at 1 and counts every call within the window", async () => {
    const [a] = await keys();
    expect(await bump(sql, a, now)).toBe(1);
    expect(await bump(sql, a, later(1000))).toBe(2);
    expect(await bump(sql, a, later(2000))).toBe(3);
  });

  it("keeps different keys' counters independent", async () => {
    const [a, b] = await keys();
    expect(await bump(sql, a, now)).toBe(1);
    expect(await bump(sql, b, now)).toBe(1);
    expect(await bump(sql, a, now)).toBe(2);
  });

  it("starts a new window 60 seconds after the current one started, and not at 59", async () => {
    const [a] = await keys();
    for (let i = 0; i < 11; i++) await bump(sql, a, now);
    expect(await bump(sql, a, later(59_000))).toBe(12);
    expect(await bump(sql, a, later(60_000))).toBe(1);
  });
}

describe("bumpPairStartRateLimit (per client IP hash)", () => {
  fixedWindowTests(bumpPairStartRateLimit, async () => ["ip-hash-a", "ip-hash-b"]);
});

describe("bumpPairApproveRateLimit (per account)", () => {
  async function users(): Promise<[string, string]> {
    const a = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "sub-a" });
    const b = await upsertUser(sql, { id: "22222222-2222-2222-2222-222222222222", provider: "google", providerSub: "sub-b" });
    return [a.id, b.id];
  }

  fixedWindowTests(bumpPairApproveRateLimit, users);

  it("goes with the account when it is deleted", async () => {
    const [a, b] = await users();
    await bumpPairApproveRateLimit(sql, a, now);
    await bumpPairApproveRateLimit(sql, b, now);

    await deleteAccount(sql, a);

    expect(await sql.query(`select user_id from orderat.pair_approve_rate_limit`)).toEqual([{ user_id: b }]);
  });
});
