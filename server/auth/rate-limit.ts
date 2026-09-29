// Fixed-window rate limit for orderat-auth's `pair_approve` (the phone approving a phone-to-web login),
// backed by db/migrations/0006_web_pairing.sql's orderat.pair_approve_rate_limit: one row per session
// that has ever approved a pairing. The same pattern, and the same fixed-window simplification, as
// server/sync/rate-limit.ts's per-session sync limit. Ten a minute is plenty for a person scanning or
// typing a code, and caps how fast any one session can try codes at other people's pending pairings.

import type { SqlClient } from "../agent/postgres-store.ts";

export const MAX_PAIR_APPROVES_PER_MINUTE = 10;

/**
 * Atomically bumps (or, once 60 seconds have elapsed since the window it's currently tracking started,
 * resets) `tokenHash`'s counter and returns the new count for the current window. Every call counts,
 * whatever it goes on to answer; the caller rejects the call once the count is above
 * MAX_PAIR_APPROVES_PER_MINUTE.
 */
export async function bumpPairApproveRateLimit(sql: SqlClient, tokenHash: string, now: Date): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.pair_approve_rate_limit (token_hash, window_started_at, count)
     values ($1, $2, 1)
     on conflict (token_hash) do update
       set count = case when $2::timestamptz - orderat.pair_approve_rate_limit.window_started_at >= interval '60 seconds' then 1 else orderat.pair_approve_rate_limit.count + 1 end,
           window_started_at = case when $2::timestamptz - orderat.pair_approve_rate_limit.window_started_at >= interval '60 seconds' then $2::timestamptz else orderat.pair_approve_rate_limit.window_started_at end
     returning count`,
    [tokenHash, now.toISOString()],
  );
  return rows[0]!.count;
}
