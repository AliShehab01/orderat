// Per-install and global daily limits for "Ask Orderat" (docs/ask-orderat.md), backed by
// db/migrations/0002_ai_usage.sql. Each counter is a single atomic "insert ... on conflict ... do
// update set count = count + 1 ... returning count" — increment-then-check, not check-then-increment
// — so a burst of concurrent requests can only ever push a counter a little past its limit (bounded
// by how many requests were in flight at once), never let an unbounded number through the way a
// separate SELECT-then-UPDATE would. Requests are only ever counted here after body validation has
// already passed (server/ask/validate.ts) and are never uncounted afterwards, even if the request
// then turns out to be over a limit or Gemini fails — see 0002_ai_usage.sql's comment on
// orderat.ai_usage_daily for why.

import type { SqlClient } from "../agent/postgres-store.ts";

export interface AskLimits {
  /** Questions/day for a single install. */
  perInstall: number;
  /** Questions/day for a single install while the request's `demo` flag is true. */
  perInstallDemo: number;
  /** Shared budget across every install, per day (env ORDERAT_ASK_DAILY_CAP). */
  globalCap: number;
}

/** docs/ask-orderat.md: 30/day per install, 3/day in demo mode, global cap default 3000. */
export const DEFAULT_LIMITS: AskLimits = {
  perInstall: 30,
  perInstallDemo: 3,
  globalCap: 3000,
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
  /** Questions left today for this install, after this one — docs/ask-orderat.md's `remainingToday`. */
  remainingToday: number;
}

export interface UsageBlocked {
  ok: false;
  /** `daily_limit`: this install is over its own per-day limit. `busy`: the global daily budget is spent. */
  reason: "daily_limit" | "busy";
}

export type UsageResult = UsageAllowed | UsageBlocked;

/**
 * Records this request against both counters and reports whether it's within the limits —
 * per-install first (so an install that's already over its own limit never eats into the global
 * budget), then global. Call this once per request, before calling Gemini, after body validation.
 */
export async function checkAndRecordUsage(
  sql: SqlClient,
  opts: { installId: string; demo: boolean; now: Date; limits?: AskLimits },
): Promise<UsageResult> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const day = dayKey(opts.now);
  const perInstallLimit = opts.demo ? limits.perInstallDemo : limits.perInstall;

  const installCount = await incrementInstallUsage(sql, opts.installId, day);
  if (installCount > perInstallLimit) return { ok: false, reason: "daily_limit" };

  const globalCount = await incrementDailyUsage(sql, day);
  if (globalCount > limits.globalCap) return { ok: false, reason: "busy" };

  return { ok: true, remainingToday: Math.max(0, perInstallLimit - installCount) };
}
