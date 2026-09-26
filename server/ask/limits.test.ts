// Proves db/migrations/0002_ai_usage.sql itself (run against a real, if WASM, Postgres — not just
// that these queries are syntactically plausible against a mock) and that the atomic upsert counter
// behaves the way concurrent requests need it to: increments are never lost, and each install/day or
// global/day is independent. See server/ask/pglite-test-support.ts for the shared instance.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { checkAndRecordUsage, dayKey, incrementDailyUsage, incrementInstallUsage } from "./limits.ts";
import { createAskUsageTestSql } from "./pglite-test-support.ts";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createAskUsageTestSql();
});

describe("dayKey", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(dayKey(new Date("2026-09-26T23:59:00Z"))).toBe("2026-09-26");
    expect(dayKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("incrementInstallUsage / incrementDailyUsage (migration 0002 + the atomic upsert)", () => {
  it("starts an install/day at 1 on first use and increments by 1 each call", async () => {
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(1);
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(2);
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(3);
  });

  it("keeps different installs independent", async () => {
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(1);
    expect(await incrementInstallUsage(sql, "install-b", "2026-09-26")).toBe(1);
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(2);
  });

  it("keeps different days independent for the same install", async () => {
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-25")).toBe(1);
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-26")).toBe(1);
    expect(await incrementInstallUsage(sql, "install-a", "2026-09-25")).toBe(2);
  });

  it("tracks the global daily count independently of any install", async () => {
    expect(await incrementDailyUsage(sql, "2026-09-26")).toBe(1);
    expect(await incrementDailyUsage(sql, "2026-09-26")).toBe(2);
    await incrementInstallUsage(sql, "install-a", "2026-09-26");
    expect(await incrementDailyUsage(sql, "2026-09-26")).toBe(3);
  });

  it("never loses an increment under concurrent calls for the same install/day", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => incrementInstallUsage(sql, "install-concurrent", "2026-09-26")));
    expect(results.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await incrementInstallUsage(sql, "install-concurrent", "2026-09-26")).toBe(11);
  });

  it("never loses an increment under concurrent calls for the global daily counter", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => incrementDailyUsage(sql, "2026-09-26")));
    expect(results.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("checkAndRecordUsage", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("allows a request within the per-install limit and reports what's left", async () => {
    const limits = { perInstall: 30, perInstallDemo: 3, globalCap: 3000 };
    for (let i = 1; i <= 5; i++) {
      const result = await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits });
      expect(result).toEqual({ ok: true, remainingToday: 30 - i });
    }
  });

  it("blocks the 31st question of the day for a non-demo install with daily_limit", async () => {
    const limits = { perInstall: 30, perInstallDemo: 3, globalCap: 3000 };
    for (let i = 0; i < 30; i++) expect((await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 4th question of the day for a demo install with daily_limit", async () => {
    const limits = { perInstall: 30, perInstallDemo: 3, globalCap: 3000 };
    for (let i = 0; i < 3; i++) expect((await checkAndRecordUsage(sql, { installId: "install-demo", demo: true, now, limits })).ok).toBe(true);
    expect(await checkAndRecordUsage(sql, { installId: "install-demo", demo: true, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("keeps demo and non-demo limits independent even for the same install id", async () => {
    const limits = { perInstall: 30, perInstallDemo: 3, globalCap: 3000 };
    // Three demo questions use up the demo allowance...
    for (let i = 0; i < 3; i++) expect((await checkAndRecordUsage(sql, { installId: "shared-install", demo: true, now, limits })).ok).toBe(true);
    expect(await checkAndRecordUsage(sql, { installId: "shared-install", demo: true, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
    // ...but the same install id in non-demo mode is a separate counter entirely (still fresh).
    expect((await checkAndRecordUsage(sql, { installId: "shared-install", demo: false, now, limits })).ok).toBe(true);
  });

  it("blocks with busy once the global cap is reached, even for installs under their own limit", async () => {
    const limits = { perInstall: 30, perInstallDemo: 3, globalCap: 2 };
    expect((await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect((await checkAndRecordUsage(sql, { installId: "install-b", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordUsage(sql, { installId: "install-c", demo: false, now, limits })).toEqual({ ok: false, reason: "busy" });
  });

  it("checks the per-install limit before the global cap, so an over-limit install never spends the global budget", async () => {
    const limits = { perInstall: 1, perInstallDemo: 1, globalCap: 3000 };
    expect((await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordUsage(sql, { installId: "install-a", demo: false, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
    // The global counter should have recorded only the first (allowed) request, not the blocked one.
    expect(await incrementDailyUsage(sql, dayKey(now))).toBe(2);
  });

  it("uses DEFAULT_LIMITS (30/3/3000) when no limits override is given", async () => {
    const result = await checkAndRecordUsage(sql, { installId: "install-defaults", demo: false, now });
    expect(result).toEqual({ ok: true, remainingToday: 29 });
  });
});
