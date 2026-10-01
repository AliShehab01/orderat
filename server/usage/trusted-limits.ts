// The AI functions' daily limits that a client cannot reset (security review 1 Oct 2026, F02;
// docs/security-review-2026-10-01.md), backed by db/migrations/0009_ai_trusted_limits.sql. Shared by
// orderat-ask (server/ask/limits.ts), orderat-studio's caption and photo, and orderat-parse
// (server/usage/feature-limits.ts).
//
// Each call's own limit used to be keyed by the body's `installId` and scaled by its `demo` flag, both
// chosen by the client: a script could start over by sending a new installId, and take the paid quota
// with demo=false. The installId and demo flag stay (the apps show "remaining today" per install), and
// these limits now sit in front of them, keyed by what the server itself establishes:
//   - a call with a valid X-Orderat-Session (identifyAiCaller): its account. The per-account count
//     replaces the per-install one (perInstall, or perInstallDemo when the call says demo); no IP cap.
//   - any other call: the client IP (server/shared/crypto.ts's hashClientIp, salted with
//     ORDERAT_AUTH_IP_SALT): at most `perIp` calls a day from one IP, demo or not, and of those at most
//     `perIpPaidClaim` that claim demo=false — one paid install's quota per IP, however many installIds.
//     The per-install count still applies on top.
// Then the feature's global daily cap, as before (in the callers). Every counter is the same atomic
// "insert ... on conflict ... do update set count = count + 1 ... returning count" as the others
// (increment-then-check), and a refused call is never uncounted.

import type { SqlClient } from "../agent/postgres-store.ts";
import { resolveSession } from "../auth/store.ts";
import { hashClientIp } from "../shared/crypto.ts";

export type AiFeature = "ask" | "caption" | "photo" | "parse";

/** Who an AI call is counted against: the signed-in account, or the client IP (as its salted hash). */
export type AiCaller = { kind: "account"; userId: string } | { kind: "anonymous"; ipHash: string };

export interface CallerLimits {
  /** Calls a day for one install without a session, or for one signed-in account. */
  perInstall: number;
  /** The same while the call's `demo` flag is true. */
  perInstallDemo: number;
  /** Calls a day from one client IP without a signed-in session, demo or not. */
  perIp: number;
  /** Of those, the calls a day from one client IP that claim demo=false. */
  perIpPaidClaim: number;
}

/** The account behind the call's X-Orderat-Session when it is valid (server/auth/store.ts's
 * resolveSession: not unknown, revoked, expired or idle); otherwise the client IP. A bad session is
 * never an error here: the call is simply counted by IP, like one from an app that is not signed in. */
export async function identifyAiCaller(sql: SqlClient, req: Request, opts: { ipSalt: string; now: Date }): Promise<AiCaller> {
  const token = req.headers.get("x-orderat-session");
  if (token) {
    const resolved = await resolveSession(sql, token, opts.now);
    if (resolved) return { kind: "account", userId: resolved.user.id };
  }
  return { kind: "anonymous", ipHash: await hashClientIp(req, opts.ipSalt) };
}

/** Atomically counts one call from `ipHash` in `bucket` ("all" calls without a session, or the
 * "paid_claim" ones among them) and returns the new count for the day. */
export async function incrementIpUsage(sql: SqlClient, feature: AiFeature, bucket: "all" | "paid_claim", ipHash: string, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.ai_ip_usage (feature, bucket, ip_hash, day, count)
     values ($1, $2, $3, $4, 1)
     on conflict (feature, bucket, ip_hash, day) do update set count = orderat.ai_ip_usage.count + 1
     returning count`,
    [feature, bucket, ipHash, day],
  );
  return rows[0]!.count;
}

/** Atomically counts one call by account `userId` and returns the new count for the day. */
export async function incrementAccountUsage(sql: SqlClient, feature: AiFeature, userId: string, day: string): Promise<number> {
  const rows = await sql.query<{ count: number }>(
    `insert into orderat.ai_account_usage (feature, user_id, day, count)
     values ($1, $2, $3, 1)
     on conflict (feature, user_id, day) do update set count = orderat.ai_account_usage.count + 1
     returning count`,
    [feature, userId, day],
  );
  return rows[0]!.count;
}

export type CallerQuotaResult = { ok: true; remaining: number } | { ok: false };

/**
 * Counts one call against the caller's own daily limits and says whether it is within them, with the
 * calls left today on the tightest one. An account is counted on its own counter only. A call without a
 * session is counted on its IP first (so a script past its cap adds no install rows), then, when it
 * claims demo=false, on the IP's stricter paid-claim counter, then on the install's own counter
 * (`incrementInstall`, the feature's existing per-install ledger). The caller then checks the global
 * cap, which a refused call here never reaches.
 */
export async function checkCallerQuota(
  sql: SqlClient,
  opts: { feature: AiFeature; caller: AiCaller; demo: boolean; day: string; limits: CallerLimits; incrementInstall: () => Promise<number> },
): Promise<CallerQuotaResult> {
  const { feature, caller, demo, day, limits } = opts;
  const ownLimit = demo ? limits.perInstallDemo : limits.perInstall;

  if (caller.kind === "account") {
    const count = await incrementAccountUsage(sql, feature, caller.userId, day);
    return count > ownLimit ? { ok: false } : { ok: true, remaining: ownLimit - count };
  }

  const ipCount = await incrementIpUsage(sql, feature, "all", caller.ipHash, day);
  if (ipCount > limits.perIp) return { ok: false };
  let remaining = limits.perIp - ipCount;

  if (!demo) {
    const claimCount = await incrementIpUsage(sql, feature, "paid_claim", caller.ipHash, day);
    if (claimCount > limits.perIpPaidClaim) return { ok: false };
    remaining = Math.min(remaining, limits.perIpPaidClaim - claimCount);
  }

  const installCount = await opts.incrementInstall();
  if (installCount > ownLimit) return { ok: false };
  return { ok: true, remaining: Math.min(remaining, ownLimit - installCount) };
}
