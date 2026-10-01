// Generic per-install and global daily limits for the marketing AI features (docs/marketing-tools.md
// "Usage ledger"), backed by db/migrations/0003_marketing.sql's orderat.feature_usage /
// feature_usage_daily. Same atomic "insert ... on conflict ... do update set count = count + 1 ...
// returning count" (increment-then-check, not check-then-increment) as server/ask/limits.ts — see
// that file's header for why: a burst of concurrent requests can only ever push a counter a little
// past its limit, never let an unbounded number through the way a separate SELECT-then-UPDATE would.
// Parametrized by `feature` ("caption" | "photo" | "parse") so every feature's counters share one
// table pair without colliding; Ask Orderat keeps its own separate ai_usage tables
// (0002_ai_usage.sql) and is untouched by this file. Requests are only ever counted here after body
// validation has already passed (server/studio/validate.ts, server/parse/validate.ts) and are never
// uncounted afterwards, even if the request then turns out to be over a limit or Gemini fails.
//
// "parse" (docs/sme-phase-2-cloud.md's AI order entry, server/parse/handler.ts) was added for SME
// phase 2 alongside "caption"/"photo" from the marketing tools — same ledger, same reasoning, just one
// more feature name sharing it.
//
// Since the security review of 1 Oct 2026 (F02), the per-install counter is no longer the only one: the
// limits a client cannot reset (server/usage/trusted-limits.ts — per account for a signed-in call, per
// client IP otherwise) are checked first, so a new installId no longer starts a fresh quota.

import type { SqlClient } from "../agent/postgres-store.ts";
import { checkCallerQuota, type AiCaller, type CallerLimits } from "./trusted-limits.ts";

export type Feature = "caption" | "photo" | "parse";

export interface FeatureLimits extends CallerLimits {
  /** Requests/day for a single install (or, signed in, a single account). */
  perInstall: number;
  /** Requests/day for a single install (or account) while the request's `demo` flag is true. */
  perInstallDemo: number;
  /** Shared budget across every install, per day. */
  globalCap: number;
}

/** docs/marketing-tools.md: captions 20/day per install, 3/day in demo mode, global cap default
 * 3000 (env ORDERAT_CAPTION_DAILY_CAP). Without a signed-in session, 40/day per client IP, of which 20
 * may claim demo=false (docs/security-review-2026-10-01.md). */
export const DEFAULT_CAPTION_LIMITS: FeatureLimits = { perInstall: 20, perInstallDemo: 3, globalCap: 3000, perIp: 40, perIpPaidClaim: 20 };

/** docs/marketing-tools.md: photos 10/day per install, 2/day in demo mode, global cap default 300
 * (env ORDERAT_PHOTO_DAILY_CAP) — image models are paid only, hence the much smaller global budget
 * than captions. Without a session, 20/day per client IP, of which 10 may claim demo=false. */
export const DEFAULT_PHOTO_LIMITS: FeatureLimits = { perInstall: 10, perInstallDemo: 2, globalCap: 300, perIp: 20, perIpPaidClaim: 10 };

/** docs/sme-phase-2-cloud.md: AI order entry 50/day per install, 5/day in demo mode, global cap
 * default 5000 (env ORDERAT_PARSE_DAILY_CAP). Without a session, 100/day per client IP, of which 50
 * may claim demo=false. */
export const DEFAULT_PARSE_LIMITS: FeatureLimits = { perInstall: 50, perInstallDemo: 5, globalCap: 5000, perIp: 100, perIpPaidClaim: 50 };

export function defaultLimitsFor(feature: Feature): FeatureLimits {
  if (feature === "caption") return DEFAULT_CAPTION_LIMITS;
  if (feature === "photo") return DEFAULT_PHOTO_LIMITS;
  return DEFAULT_PARSE_LIMITS;
}

/** `date`-typed columns take a plain "YYYY-MM-DD" string from both the Node and Deno postgres
 * drivers; UTC (not the caller's local time zone) keeps "today" the same value everywhere the app
 * runs from, matching how the tables are keyed — a deliberate duplicate of server/ask/limits.ts's own
 * dayKey rather than an import from it, so this module has no dependency on server/ask/*. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Atomically increments today's count for one feature/install and returns the new total (including
 * this request) — exported mainly for tests; callers normally go through checkAndRecordFeatureUsage. */
export async function incrementFeatureInstallUsage(sql: SqlClient, feature: Feature, installId: string, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.feature_usage (feature, install_id, day, count)
     values ($1, $2, $3, 1)
     on conflict (feature, install_id, day) do update set count = orderat.feature_usage.count + 1
     returning count`,
    [feature, installId, day],
  );
  return rows[0]!.count;
}

/** Atomically increments today's shared total for one feature across every install and returns the
 * new total. */
export async function incrementFeatureDailyUsage(sql: SqlClient, feature: Feature, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.feature_usage_daily (feature, day, count)
     values ($1, $2, 1)
     on conflict (feature, day) do update set count = orderat.feature_usage_daily.count + 1
     returning count`,
    [feature, day],
  );
  return rows[0]!.count;
}

export interface UsageAllowed {
  ok: true;
  /** Requests left today for this caller, after this one, on the tightest of its own limits —
   * docs/marketing-tools.md's `remainingToday`. */
  remainingToday: number;
}

export interface UsageBlocked {
  ok: false;
  /** `daily_limit`: this caller is over one of its own per-day limits (its install's, its client IP's
   * or its account's). `busy`: the global daily budget for this feature is spent. */
  reason: "daily_limit" | "busy";
}

export type UsageResult = UsageAllowed | UsageBlocked;

/**
 * Records this request against the caller's own counters for `feature` (server/usage/trusted-limits.ts:
 * its account when signed in, else its client IP and then its install) and then the global one, and
 * reports whether it's within the limits — the caller's first, so one already over its own limit never
 * eats into the global budget. Call this once per request, before calling Gemini, after body
 * validation. `limits` is laid over the feature's own DEFAULT_*_LIMITS.
 */
export async function checkAndRecordFeatureUsage(
  sql: SqlClient,
  opts: { feature: Feature; caller: AiCaller; installId: string; demo: boolean; now: Date; limits?: Partial<FeatureLimits> },
): Promise<UsageResult> {
  const limits: FeatureLimits = { ...defaultLimitsFor(opts.feature), ...opts.limits };
  const day = dayKey(opts.now);

  const own = await checkCallerQuota(sql, {
    feature: opts.feature,
    caller: opts.caller,
    demo: opts.demo,
    day,
    limits,
    incrementInstall: () => incrementFeatureInstallUsage(sql, opts.feature, opts.installId, day),
  });
  if (!own.ok) return { ok: false, reason: "daily_limit" };

  const globalCount = await incrementFeatureDailyUsage(sql, opts.feature, day);
  if (globalCount > limits.globalCap) return { ok: false, reason: "busy" };

  return { ok: true, remainingToday: Math.max(0, own.remaining) };
}
