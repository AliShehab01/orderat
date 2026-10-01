// Per-install and global daily limits for "Ask Orderat" (docs/ask-orderat.md), backed by
// db/migrations/0002_ai_usage.sql. Each counter is a single atomic "insert ... on conflict ... do
// update set count = count + 1 ... returning count" — increment-then-check, not check-then-increment
// — so a burst of concurrent requests can only ever push a counter a little past its limit (bounded
// by how many requests were in flight at once), never let an unbounded number through the way a
// separate SELECT-then-UPDATE would. Requests are only ever counted here after body validation has
// already passed (server/ask/validate.ts) and are never uncounted afterwards, even if the request
// then turns out to be over a limit or Gemini fails — see 0002_ai_usage.sql's comment on
// orderat.ai_usage_daily for why.
//
// Since the security review of 1 Oct 2026 (F02), the per-install counter is no longer the only one: the
// limits a client cannot reset (server/usage/trusted-limits.ts — per account for a signed-in call, per
// client IP otherwise) are checked first, so a new installId no longer starts a fresh quota.

import type { SqlClient } from "../agent/postgres-store.ts";
import { checkCallerQuota, type AiCaller, type CallerLimits } from "../usage/trusted-limits.ts";

export interface AskLimits extends CallerLimits {
  /** Questions/day for a single install (or, signed in, a single account). */
  perInstall: number;
  /** Questions/day for a single install (or account) while the request's `demo` flag is true. */
  perInstallDemo: number;
  /** Shared budget across every install, per day (env ORDERAT_ASK_DAILY_CAP). */
  globalCap: number;
}

/** docs/ask-orderat.md: 30/day per install, 3/day in demo mode, global cap default 3000. Without a
 * signed-in session, 200/day per client IP, of which 100 may claim demo=false (high enough for many
 * phones sharing one carrier-grade NAT address; the global cap still bounds spend)
 * (docs/security-review-2026-10-01.md). */
export const DEFAULT_LIMITS: AskLimits = {
  perInstall: 30,
  perInstallDemo: 3,
  globalCap: 3000,
  perIp: 200,
  perIpPaidClaim: 100,
};

/** `date`-typed columns take a plain "YYYY-MM-DD" string from both the Node and Deno postgres
 * drivers; using UTC (not the caller's local time zone) keeps "today" the same value everywhere the
 * app runs from, matching how the tables are keyed. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Atomically increments today's count for one install and returns the new total (including this
 * request) — exported mainly for tests; callers normally go through checkAndRecordUsage. */
export async function incrementInstallUsage(sql: SqlClient, installId: string, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.ai_usage (install_id, day, count)
     values ($1, $2, 1)
     on conflict (install_id, day) do update set count = orderat.ai_usage.count + 1
     returning count`,
    [installId, day],
  );
  return rows[0]!.count;
}

/** Atomically increments today's shared total across every install and returns the new total. */
export async function incrementDailyUsage(sql: SqlClient, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.ai_usage_daily (day, count)
     values ($1, 1)
     on conflict (day) do update set count = orderat.ai_usage_daily.count + 1
     returning count`,
    [day],
  );
  return rows[0]!.count;
}

export interface UsageAllowed {
  ok: true;
  /** Questions left today for this caller, after this one, on the tightest of its own limits —
   * docs/ask-orderat.md's `remainingToday`. */
  remainingToday: number;
}

export interface UsageBlocked {
  ok: false;
  /** `daily_limit`: this caller is over one of its own per-day limits (its install's, its client IP's
   * or its account's). `busy`: the global daily budget is spent. */
  reason: "daily_limit" | "busy";
}

export type UsageResult = UsageAllowed | UsageBlocked;

/**
 * Records this request against the caller's own counters (server/usage/trusted-limits.ts: its account
 * when signed in, else its client IP and then its install) and then the global one, and reports whether
 * it's within the limits — the caller's first, so one already over its own limit never eats into the
 * global budget. Call this once per request, before calling Gemini, after body validation. `limits` is
 * laid over DEFAULT_LIMITS.
 */
export async function checkAndRecordUsage(
  sql: SqlClient,
  opts: { caller: AiCaller; installId: string; demo: boolean; now: Date; limits?: Partial<AskLimits> },
): Promise<UsageResult> {
  const limits: AskLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const day = dayKey(opts.now);

  const own = await checkCallerQuota(sql, {
    feature: "ask",
    caller: opts.caller,
    demo: opts.demo,
    day,
    limits,
    incrementInstall: () => incrementInstallUsage(sql, opts.installId, day),
  });
  if (!own.ok) return { ok: false, reason: "daily_limit" };

  const globalCount = await incrementDailyUsage(sql, day);
  if (globalCount > limits.globalCap) return { ok: false, reason: "busy" };

  return { ok: true, remainingToday: Math.max(0, own.remaining) };
}
