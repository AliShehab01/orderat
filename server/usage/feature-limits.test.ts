// Proves db/migrations/0003_marketing.sql's orderat.feature_usage/feature_usage_daily tables (run
// against a real, if WASM, Postgres — not just that these queries are syntactically plausible against
// a mock) and that the atomic upsert counters behave the way concurrent requests need them to. Same
// shape as server/ask/limits.test.ts, parametrized over `feature` and adding coverage for the two
// features never colliding with each other.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import {
  checkAndRecordFeatureUsage,
  dayKey,
  DEFAULT_CAPTION_LIMITS,
  DEFAULT_PHOTO_LIMITS,
  incrementFeatureDailyUsage,
  incrementFeatureInstallUsage,
} from "./feature-limits.ts";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

describe("dayKey", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(dayKey(new Date("2026-09-26T23:59:00Z"))).toBe("2026-09-26");
  });
});

describe("default limits", () => {
  it("match docs/marketing-tools.md for captions", () => {
    expect(DEFAULT_CAPTION_LIMITS).toEqual({ perInstall: 20, perInstallDemo: 3, globalCap: 3000 });
  });

  it("match docs/marketing-tools.md for photos", () => {
    expect(DEFAULT_PHOTO_LIMITS).toEqual({ perInstall: 10, perInstallDemo: 2, globalCap: 300 });
  });
});

describe("incrementFeatureInstallUsage / incrementFeatureDailyUsage", () => {
  it("starts a feature/install/day at 1 and increments by 1 each call", async () => {
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-a", "2026-09-26")).toBe(1);
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-a", "2026-09-26")).toBe(2);
  });

  it("keeps caption and photo counters independent for the same install/day", async () => {
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-a", "2026-09-26")).toBe(1);
    expect(await incrementFeatureInstallUsage(sql, "photo", "install-a", "2026-09-26")).toBe(1);
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-a", "2026-09-26")).toBe(2);
    expect(await incrementFeatureInstallUsage(sql, "photo", "install-a", "2026-09-26")).toBe(2);
  });

  it("keeps different installs independent", async () => {
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-a", "2026-09-26")).toBe(1);
    expect(await incrementFeatureInstallUsage(sql, "caption", "install-b", "2026-09-26")).toBe(1);
  });

  it("keeps the global daily counter independent per feature", async () => {
    expect(await incrementFeatureDailyUsage(sql, "caption", "2026-09-26")).toBe(1);
    expect(await incrementFeatureDailyUsage(sql, "photo", "2026-09-26")).toBe(1);
    expect(await incrementFeatureDailyUsage(sql, "caption", "2026-09-26")).toBe(2);
  });

  it("never loses an increment under concurrent calls", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => incrementFeatureInstallUsage(sql, "caption", "install-concurrent", "2026-09-26")));
    expect(results.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("checkAndRecordFeatureUsage", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("allows a request within the per-install limit and reports what's left", async () => {
    const limits = { perInstall: 20, perInstallDemo: 3, globalCap: 3000 };
    for (let i = 1; i <= 5; i++) {
      const result = await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-a", demo: false, now, limits });
      expect(result).toEqual({ ok: true, remainingToday: 20 - i });
    }
  });

  it("blocks the 21st caption of the day for a non-demo install with daily_limit", async () => {
    for (let i = 0; i < 20; i++) expect((await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-a", demo: false, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-a", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 4th demo caption of the day with daily_limit (3/day in demo mode)", async () => {
    for (let i = 0; i < 3; i++) expect((await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-demo", demo: true, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-demo", demo: true, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 11th photo of the day for a non-demo install (10/day)", async () => {
    for (let i = 0; i < 10; i++) expect((await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-a", demo: false, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-a", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 3rd demo photo of the day (2/day in demo mode)", async () => {
    for (let i = 0; i < 2; i++) expect((await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-demo", demo: true, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-demo", demo: true, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("keeps an install's caption limit independent of its own photo limit", async () => {
    for (let i = 0; i < 10; i++) await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "shared-install", demo: false, now });
    // The photo allowance (10/day) is now spent, but captions (a different feature) are untouched.
    expect((await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "shared-install", demo: false, now })).ok).toBe(true);
  });

  it("blocks with busy once the feature's global cap is reached, even for installs under their own limit", async () => {
    const limits = { perInstall: 20, perInstallDemo: 3, globalCap: 2 };
    expect((await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect((await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-b", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "caption", installId: "install-c", demo: false, now, limits })).toEqual({ ok: false, reason: "busy" });
  });

  it("checks the per-install limit before the global cap, so an over-limit install never spends the global budget", async () => {
    const limits = { perInstall: 1, perInstallDemo: 1, globalCap: 3000 };
    expect((await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-a", demo: false, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
    expect(await incrementFeatureDailyUsage(sql, "photo", dayKey(now))).toBe(2);
  });

  it("uses the feature's own default limits when no override is given", async () => {
    const result = await checkAndRecordFeatureUsage(sql, { feature: "photo", installId: "install-defaults", demo: false, now });
    expect(result).toEqual({ ok: true, remainingToday: 9 });
  });
});
