// FROZEN FIXTURE (final verification, 3 Oct 2026): this file is server/sync/rate-limit.ts exactly as it is on origin/main (c07cc28),
// the server code deployed before the integrity rounds of 3 Oct, except that the relative imports of the other server folders
// point one level deeper. It is used only by ../migration-0010.test.ts to seed a database through the OLD code path before
// migration 0010 is applied. Do not edit it and do not import it from production code.
// Fixed-window rate limit for orderat-sync's `sync` action (docs/sme-phase-2-cloud.md: "60 syncs per
// minute per session"), backed by db/migrations/0004_cloud.sql's orderat.sync_rate_limit — one row
// per session that has ever called `sync`. A fixed (not sliding) 60-second window is the same
// simplification server/shop/store.ts's bumpPublishCounter makes for its own per-day limit: at most a
// little more permissive right at a window boundary, an acceptable trade for one atomic UPDATE
// instead of tracking every individual request's timestamp.

import type { SqlClient } from "../../../agent/postgres-store.ts";

/** docs/sme-phase-2-cloud.md: "60 syncs per minute per session". */
export const MAX_SYNCS_PER_MINUTE = 60;

/**
 * Atomically bumps (or, once 60 seconds have elapsed since the window it's currently tracking
 * started, resets) `tokenHash`'s counter and returns the new count for the current window — the
 * session's first-ever `sync` call inserts its row; every call after that updates in place.
 */
export async function bumpSyncRateLimit(sql: SqlClient, tokenHash: string, now: Date): Promise<number> {
  const nowIso = now.toISOString();
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.sync_rate_limit (token_hash, window_started_at, count)
     values ($1, $2, 1)
     on conflict (token_hash) do update
       set count = case when $2::timestamptz - orderat.sync_rate_limit.window_started_at >= interval '60 seconds' then 1 else orderat.sync_rate_limit.count + 1 end,
           window_started_at = case when $2::timestamptz - orderat.sync_rate_limit.window_started_at >= interval '60 seconds' then $2::timestamptz else orderat.sync_rate_limit.window_started_at end
     returning count`,
    [tokenHash, nowIso],
  );
  return rows[0]!.count;
}
