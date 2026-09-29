// Database access for accounts and sessions (docs/sme-phase-2-cloud.md's "Accounts"), backed by
// db/migrations/0004_cloud.sql's orderat.users / sessions (and 0005's sessions.expires_at). Every
// query is parameterized; server/auth/handler.ts is the only caller, always after
// server/auth/verify-token.ts has already verified whatever it's about to trust.

import type { SqlClient } from "../agent/postgres-store.ts";
import { constantTimeEqualHex, sha256HexOfString } from "../shared/crypto.ts";
import type { Provider } from "./providers.ts";

export interface UserRow {
  id: string;
  provider: Provider;
  providerSub: string;
  email?: string;
  name?: string;
  createdAt: string;
}

function toUserRow(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    provider: row.provider as Provider,
    providerSub: row.provider_sub as string,
    email: (row.email as string | null) ?? undefined,
    name: (row.name as string | null) ?? undefined,
    createdAt: String(row.created_at),
  };
}

const USER_COLUMNS = "id, provider, provider_sub, email, name, created_at";

export async function findUserById(sql: SqlClient, id: string): Promise<UserRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(`select ${USER_COLUMNS} from orderat.users where id = $1`, [id]);
  return rows[0] ? toUserRow(rows[0]) : undefined;
}

/**
 * Upserts the user identified by a verified ID token's (provider, sub): inserts a brand-new user
 * (with a fresh, caller-supplied id) the first time this identity signs in, or refreshes email/name on
 * every signin after — a provider can send a fuller profile on a later signin than the first (Apple
 * only ever sends a display name once, at the very first grant, then omits it) so an already-known
 * field is never overwritten with a later, emptier one (`coalesce(excluded.x, ...x)`). `id` itself is
 * never touched by the update branch: Postgres leaves a column out of `on conflict do update`'s SET
 * list unchanged, so RETURNING here always reports the identity's original id, not the fresh one this
 * call happened to generate.
 */
export async function upsertUser(
  sql: SqlClient,
  input: { id: string; provider: Provider; providerSub: string; email?: string; name?: string },
): Promise<UserRow> {
  const rows = await sql.query<Record<string, unknown>>(
    `insert into orderat.users (id, provider, provider_sub, email, name)
     values ($1, $2, $3, $4, $5)
     on conflict (provider, provider_sub) do update
       set email = coalesce(excluded.email, orderat.users.email),
           name = coalesce(excluded.name, orderat.users.name)
     returning ${USER_COLUMNS}`,
    [input.id, input.provider, input.providerSub, input.email ?? null, input.name ?? null],
  );
  return toUserRow(rows[0]!);
}

/** "Delete my account" (docs/sme-phase-2-cloud.md): removes the user row, which cascades — via the
 * foreign keys in db/migrations/0004_cloud.sql — to every session, every shop this user owns (and, in
 * turn, that shop's members/invites/records), and this user's own membership rows in shops owned by
 * someone else. A single DELETE, not a hand-written multi-table teardown, is what "with its data"
 * means here: the database's own constraints guarantee nothing is left behind, the same trust the rest
 * of this codebase places in ownership/RLS rather than re-deriving it in application code. */
export async function deleteAccount(sql: SqlClient, userId: string): Promise<void> {
  await sql.query(`delete from orderat.users where id = $1`, [userId]);
}

export interface NewSessionToken {
  /** The secret value returned to the app exactly once — never stored, never logged. */
  token: string;
  /** SHA-256 hex of `token`, the only thing ever written to `orderat.sessions.token_hash`. */
  tokenHash: string;
}

/** A fresh session token: 32 random bytes, base64url-encoded — the same shape as
 * server/shared/crypto.ts's newEditToken (32 random bytes via crypto.getRandomValues, base64url), kept
 * as its own function because a session token and a shop edit token are different secrets with
 * different lifetimes and stores, not because the encoding differs. */
export async function newSessionToken(): Promise<NewSessionToken> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(binary, "binary").toString("base64") : btoa(binary);
  const token = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { token, tokenHash: await sha256HexOfString(token) };
}

/** How long a browser's session lasts, counted from its signin (docs/superpowers/specs/
 * 2026-09-29-orderat-web-design.md). A browser keeps its session in localStorage, where a forgotten or
 * stolen one would otherwise stay valid for good; the phones' sessions have no expiry at all. */
export const WEB_SESSION_DAYS = 30;

/** `expiresAt` is set only for a browser's session (server/auth/handler.ts passes WEB_SESSION_DAYS from
 * now); left out, the session never expires, which is every phone's. */
export async function createSession(
  sql: SqlClient,
  input: { tokenHash: string; userId: string; deviceName?: string; expiresAt?: Date },
): Promise<void> {
  await sql.query(
    `insert into orderat.sessions (token_hash, user_id, device_name, expires_at) values ($1, $2, $3, $4)`,
    [input.tokenHash, input.userId, input.deviceName ?? null, input.expiresAt?.toISOString() ?? null],
  );
}

export interface SessionRow {
  tokenHash: string;
  userId: string;
  deviceName?: string;
  revokedAt?: string;
  /** The instant this session stops working; absent for one that never expires (every phone's). */
  expiresAt?: Date;
}

function toSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    tokenHash: row.token_hash as string,
    userId: row.user_id as string,
    deviceName: (row.device_name as string | null) ?? undefined,
    revokedAt: (row.revoked_at as string | null) ?? undefined,
    // `new Date(...)` takes the Date both SQL drivers hand a timestamptz back as, and the ISO text a
    // driver configured otherwise would.
    expiresAt: row.expires_at == null ? undefined : new Date(row.expires_at as string | Date),
  };
}

async function findSessionByTokenHash(sql: SqlClient, tokenHash: string): Promise<SessionRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(
    `select token_hash, user_id, device_name, revoked_at, expires_at from orderat.sessions where token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ? toSessionRow(rows[0]) : undefined;
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
}

/**
 * Resolves a raw session token (the app's X-Orderat-Session header) to its session + user, or
 * undefined for anything that doesn't authenticate: unknown, revoked, expired (a browser session past
 * its WEB_SESSION_DAYS, from `expires_at <= now` on), or belonging to a since-deleted user. Hashes
 * the token, looks the hash up, then re-checks the found row's own hash
 * against the computed one with a constant-time comparison before trusting it — the same
 * belt-and-suspenders pattern as server/shop/store.ts's findShopByToken (see that file's comment for
 * the full reasoning: the lookup already matched on equality, so this can only ever agree with it,
 * but it keeps a plain, potentially-short-circuiting `===` from ever being the thing that decided
 * authentication). Bumps `last_seen_at` on every successful resolution, per
 * docs/sme-phase-2-cloud.md. Every other caller that authenticates by session (server/sync/handler.ts,
 * server/auth/handler.ts itself) goes through this, never findSessionByTokenHash directly.
 */
export async function resolveSession(sql: SqlClient, token: string, now: Date): Promise<ResolvedSession | undefined> {
  const tokenHash = await sha256HexOfString(token);
  const session = await findSessionByTokenHash(sql, tokenHash);
  if (!session || !constantTimeEqualHex(session.tokenHash, tokenHash)) return undefined;
  if (session.revokedAt) return undefined;
  // From its expiry instant on, a web session is treated exactly like an unknown token (the browser is
  // simply signed out). Checked before the user lookup and the last_seen_at bump, so an expired
  // session does no more work than a revoked one.
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) return undefined;

  const user = await findUserById(sql, session.userId);
  if (!user) return undefined; // Should be unreachable (FK cascade removes sessions with their user); defensive.

  await sql.query(`update orderat.sessions set last_seen_at = $2 where token_hash = $1`, [tokenHash, now.toISOString()]);
  return { session, user };
}

/** Revokes the session identified by a raw token — a no-op (not an error) if it's already
 * unknown or revoked, matching "signout" having nothing more specific to fail with. */
export async function revokeSession(sql: SqlClient, token: string): Promise<void> {
  const tokenHash = await sha256HexOfString(token);
  await sql.query(`update orderat.sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, [tokenHash]);
}
