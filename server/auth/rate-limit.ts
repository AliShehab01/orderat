// Fixed-window rate limits for orderat-auth's phone-to-web login, backed by
// db/migrations/0006_web_pairing.sql: `pair_start` per client IP (orderat.pair_start_rate_limit) and
// `pair_approve` per account (orderat.pair_approve_rate_limit). The same pattern, and the same
// fixed-window simplification, as server/sync/rate-limit.ts's per-session sync limit: one atomic upsert
// per call that bumps the current 60-second window's count, or starts a new window once 60 seconds
// have passed since the current one started.

import type { SqlClient } from "../agent/postgres-store.ts";

/** pair_start calls a minute from one client IP: plenty for a person opening the website's login a few
 * times, and a brake on any one client filling up the pending pairings. */
export const MAX_PAIR_STARTS_PER_MINUTE = 10;
/** pair_approve calls a minute per account: plenty for a person scanning or typing a code, and a cap on
 * how fast one account can try codes at other people's pending pairings. */
export const MAX_PAIR_APPROVES_PER_MINUTE = 10;

// Each window's table and key column. Constants, never input, so interpolating them into the SQL below
// is safe; the key's value itself is always a bound parameter.
const PAIR_START_WINDOW = { table: "orderat.pair_start_rate_limit", key: "ip_hash" } as const;
const PAIR_APPROVE_WINDOW = { table: "orderat.pair_approve_rate_limit", key: "user_id" } as const;

async function bumpWindow(
  sql: SqlClient,
  { table, key }: typeof PAIR_START_WINDOW | typeof PAIR_APPROVE_WINDOW,
  value: string,
  now: Date,
): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into ${table} (${key}, window_started_at, count)
     values ($1, $2, 1)
     on conflict (${key}) do update
       set count = case when $2::timestamptz - ${table}.window_started_at >= interval '60 seconds' then 1 else ${table}.count + 1 end,
           window_started_at = case when $2::timestamptz - ${table}.window_started_at >= interval '60 seconds' then $2::timestamptz else ${table}.window_started_at end
     returning count`,
    [value, now.toISOString()],
  );
  return rows[0]!.count;
}

/** Bumps the pair_start window of the client IP hashed as `ipHash` (server/shared/crypto.ts's
 * hashClientIp) and returns its count; the caller refuses the call once the count is above
 * MAX_PAIR_STARTS_PER_MINUTE. */
export function bumpPairStartRateLimit(sql: SqlClient, ipHash: string, now: Date): Promise<number> {
  return bumpWindow(sql, PAIR_START_WINDOW, ipHash, now);
}

/** Bumps account `userId`'s pair_approve window and returns its count; the caller refuses the call
 * once the count is above MAX_PAIR_APPROVES_PER_MINUTE. Keyed by account rather than session, since a
 * fresh session is only a signin away. */
export function bumpPairApproveRateLimit(sql: SqlClient, userId: string, now: Date): Promise<number> {
  return bumpWindow(sql, PAIR_APPROVE_WINDOW, userId, now);
}
