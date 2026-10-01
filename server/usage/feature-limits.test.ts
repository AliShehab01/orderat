// Proves db/migrations/0003_marketing.sql's orderat.feature_usage/feature_usage_daily tables (run
// against a real, if WASM, Postgres — not just that these queries are syntactically plausible against
// a mock) and that the atomic upsert counters behave the way concurrent requests need them to. Same
// shape as server/ask/limits.test.ts, parametrized over `feature` and adding coverage for the two
// features never colliding with each other.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import {
  checkAndRecordFeatureUsage,
  dayKey,
  DEFAULT_CAPTION_LIMITS,
  DEFAULT_PARSE_LIMITS,
  DEFAULT_PHOTO_LIMITS,
  incrementFeatureDailyUsage,
  incrementFeatureInstallUsage,
} from "./feature-limits.ts";
import type { AiCaller } from "./trusted-limits.ts";

/** A call without a signed-in session, from one client IP (its salted hash). */
const ANON: AiCaller = { kind: "anonymous", ipHash: "ip-hash-a" };

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
  // Per IP (docs/security-review-2026-10-01.md, F02): two paid installs' worth of calls without a session,
  // of which one paid install's worth may claim demo=false.
  it("match docs/marketing-tools.md for captions", () => {
    expect(DEFAULT_CAPTION_LIMITS).toEqual({ perInstall: 20, perInstallDemo: 3, globalCap: 3000, perIp: 40, perIpPaidClaim: 20 });
  });

  it("match docs/marketing-tools.md for photos", () => {
    expect(DEFAULT_PHOTO_LIMITS).toEqual({ perInstall: 10, perInstallDemo: 2, globalCap: 300, perIp: 20, perIpPaidClaim: 10 });
  });

  it("match docs/sme-phase-2-cloud.md for AI order entry (parse)", () => {
    expect(DEFAULT_PARSE_LIMITS).toEqual({ perInstall: 50, perInstallDemo: 5, globalCap: 5000, perIp: 100, perIpPaidClaim: 50 });
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
      const result = await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-a", demo: false, now, limits });
      expect(result).toEqual({ ok: true, remainingToday: 20 - i });
    }
  });

  it("blocks the 21st caption of the day for a non-demo install with daily_limit", async () => {
    for (let i = 0; i < 20; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-a", demo: false, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-a", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 4th demo caption of the day with daily_limit (3/day in demo mode)", async () => {
    for (let i = 0; i < 3; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-demo", demo: true, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-demo", demo: true, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 11th photo of the day for a non-demo install (10/day)", async () => {
    for (let i = 0; i < 10; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-a", demo: false, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-a", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 3rd demo photo of the day (2/day in demo mode)", async () => {
    for (let i = 0; i < 2; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-demo", demo: true, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-demo", demo: true, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("keeps an install's caption limit independent of its own photo limit", async () => {
    for (let i = 0; i < 10; i++) await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "shared-install", demo: false, now });
    // The photo allowance (10/day) is now spent, but captions (a different feature) are untouched.
    expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "shared-install", demo: false, now })).ok).toBe(true);
  });

  it("blocks with busy once the feature's global cap is reached, even for installs under their own limit", async () => {
    const limits = { perInstall: 20, perInstallDemo: 3, globalCap: 2 };
    expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-b", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-c", demo: false, now, limits })).toEqual({ ok: false, reason: "busy" });
  });

  it("checks the per-install limit before the global cap, so an over-limit install never spends the global budget", async () => {
    const limits = { perInstall: 1, perInstallDemo: 1, globalCap: 3000 };
    expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-a", demo: false, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
    expect(await incrementFeatureDailyUsage(sql, "photo", dayKey(now))).toBe(2);
  });

  it("uses the feature's own default limits when no override is given", async () => {
    const result = await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "photo", installId: "install-defaults", demo: false, now });
    expect(result).toEqual({ ok: true, remainingToday: 9 });
  });

  // Security review F02: limits the client cannot reset.
  it("a new installId on every call stops at the client IP's cap, and spends no global budget past it", async () => {
    const limits = { perInstall: 20, perInstallDemo: 3, globalCap: 3000, perIp: 4, perIpPaidClaim: 2 };
    for (let i = 0; i < 4; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: `install-${i}`, demo: true, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "install-new", demo: true, now, limits })).toEqual({ ok: false, reason: "daily_limit" });
    expect(await incrementFeatureDailyUsage(sql, "caption", dayKey(now))).toBe(5);
    // Another client IP is not affected.
    expect((await checkAndRecordFeatureUsage(sql, { caller: { kind: "anonymous", ipHash: "ip-hash-b" }, feature: "caption", installId: "install-new", demo: true, now, limits })).ok).toBe(true);
  });

  it("demo=false without a session: at most one paid install's quota per IP, whatever the installIds", async () => {
    for (let i = 0; i < 20; i++) expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: `paid-${i}`, demo: false, now })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "caption", installId: "paid-new", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("a signed-in account is counted on the account: neither a new installId nor another IP resets it", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    await upsertUser(sql, { id: userId, provider: "apple", providerSub: "apple-sub-1" });
    const account: AiCaller = { kind: "account", userId };
    for (let i = 0; i < 10; i++) {
      expect(await checkAndRecordFeatureUsage(sql, { caller: account, feature: "photo", installId: `install-${i}`, demo: false, now })).toEqual({ ok: true, remainingToday: 9 - i });
    }
    expect(await checkAndRecordFeatureUsage(sql, { caller: account, feature: "photo", installId: "install-new", demo: false, now })).toEqual({ ok: false, reason: "daily_limit" });
    // Its calls left the install counters alone.
    expect(await incrementFeatureInstallUsage(sql, "photo", "install-0", dayKey(now))).toBe(1);
  });

  it("keeps the global cap for every caller", async () => {
    const limits = { perInstall: 20, perInstallDemo: 3, globalCap: 1, perIp: 40, perIpPaidClaim: 20 };
    const userId = "11111111-1111-1111-1111-111111111111";
    await upsertUser(sql, { id: userId, provider: "apple", providerSub: "apple-sub-1" });
    expect((await checkAndRecordFeatureUsage(sql, { caller: ANON, feature: "parse", installId: "install-a", demo: false, now, limits })).ok).toBe(true);
    expect(await checkAndRecordFeatureUsage(sql, { caller: { kind: "account", userId }, feature: "parse", installId: "install-b", demo: false, now, limits })).toEqual({ ok: false, reason: "busy" });
  });
});
