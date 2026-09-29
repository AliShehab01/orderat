// Database access for accounts and sessions (docs/sme-phase-2-cloud.md's "Accounts"), backed by
// db/migrations/0004_cloud.sql's orderat.users / sessions (and 0005's sessions.expires_at), plus
// 0006's orderat.web_pairings for the phone-to-web login. Every query is parameterized;
// server/auth/handler.ts is the only caller, always after server/auth/verify-token.ts has already
// verified whatever it's about to trust.

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

// --- Phone-to-web login ("Open on computer"): db/migrations/0006_web_pairing.sql's web_pairings ---

/** A pairing's poll token, which pair_start returns to the website once: the same shape as a session
 * token (32 random bytes, base64url), so it is minted by newSessionToken. Only its SHA-256 hex
 * (`pollHash`) is stored, in web_pairings.poll_hash. */
export async function newPollToken(): Promise<{ pollToken: string; pollHash: string }> {
  const { token, tokenHash } = await newSessionToken();
  return { pollToken: token, pollHash: tokenHash };
}

/** Deletes every pairing whose time is up (expires_at <= now, found through
 * web_pairings_expires_at_idx), whatever its status. Every pairing call runs this first, so the table
 * only holds pairings still in progress. An approved pairing whose website never came back for its
 * session takes that raw session token with it, and the session, started for nobody, is revoked. */
export async function deleteExpiredPairings(sql: SqlClient, now: Date): Promise<void> {
  const deleted = await sql.query<{ session_token: string | null }>(
    `delete from orderat.web_pairings where expires_at <= $1 returning session_token`,
    [now.toISOString()],
  );
  // Only an approved, uncollected pairing still holds its token; a collected one's was cleared on the poll.
  for (const { session_token: sessionToken } of deleted) if (sessionToken) await revokeSession(sql, sessionToken);
}

/** How many pairings are pending (not yet approved) and unexpired: what pair_start caps. */
export async function countPendingPairings(sql: SqlClient, now: Date): Promise<number> {
  const rows = await sql.query<{ total: number }>(
    `select count(*)::int as total from orderat.web_pairings where status = 'pending' and expires_at > $1`,
    [now.toISOString()],
  );
  return rows[0]!.total;
}

/** Inserts a new pending pairing, or, when `code` is already another pending pairing's
 * (web_pairings_pending_code_idx), inserts nothing and returns false so the caller can retry with a
 * fresh code. */
export async function insertPairing(
  sql: SqlClient,
  input: { id: string; code: string; pollHash: string; expiresAt: Date },
): Promise<boolean> {
  const rows = await sql.query(
    `insert into orderat.web_pairings (id, code, poll_hash, status, expires_at) values ($1, $2, $3, 'pending', $4)
     on conflict do nothing
     returning id`,
    [input.id, input.code, input.pollHash, input.expiresAt.toISOString()],
  );
  return rows.length > 0;
}

/** The unexpired pending pairing showing `code`, if any (at most one: web_pairings_pending_code_idx). */
export async function findPendingPairingByCode(sql: SqlClient, code: string, now: Date): Promise<{ id: string } | undefined> {
  const rows = await sql.query<{ id: string }>(
    `select id from orderat.web_pairings where code = $1 and status = 'pending' and expires_at > $2`,
    [code, now.toISOString()],
  );
  return rows[0] ? { id: rows[0].id } : undefined;
}

/** Marks pairing `id` approved by `userId`, holding `sessionToken` (the raw token of the web session
 * just created for it) for the website's next poll, but only while it is still pending and unexpired.
 * One conditional UPDATE, so of two phones approving the same code at once only one wins; false, with
 * nothing changed, for the other (or for a pairing whose five minutes ran out). An approval in the
 * pairing's last minute moves its expiry to a minute after the approval, so the website's next poll
 * can still collect the session. */
export async function approvePairing(
  sql: SqlClient,
  input: { id: string; userId: string; sessionToken: string; now: Date },
): Promise<boolean> {
  const rows = await sql.query(
    `update orderat.web_pairings
        set status = 'approved', user_id = $2, session_token = $3, approved_at = $4,
            expires_at = greatest(expires_at, $4::timestamptz + interval '60 seconds')
      where id = $1 and status = 'pending' and expires_at > $4
      returning id`,
    [input.id, input.userId, input.sessionToken, input.now.toISOString()],
  );
  return rows.length > 0;
}

export type PairingPoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; sessionToken: string; user: UserRow };

/**
 * The website's poll of pairing `pairId`, authenticated by the poll token pair_start gave it: the
 * token's SHA-256 hex is compared with the stored poll_hash in constant time (constantTimeEqualHex).
 * The row is looked up by id, so, unlike in resolveSession, that comparison is what decides. An unknown
 * pairing, a wrong poll token, a pairing past its expiry and one whose session was already collected
 * all answer the same "expired", so a poll never reveals which it was. An approved pairing's session
 * token is handed out exactly once: a single statement (so a single transaction) returns it and clears
 * it, marking the pairing consumed.
 */
export async function pollPairing(sql: SqlClient, pairId: string, pollToken: string, now: Date): Promise<PairingPoll> {
  const pollHash = await sha256HexOfString(pollToken);
  const rows = await sql.query<Record<string, unknown>>(`select poll_hash, status, expires_at from orderat.web_pairings where id = $1`, [pairId]);
  const row = rows[0];
  if (!row || !constantTimeEqualHex(row.poll_hash as string, pollHash)) return { status: "expired" };
  if (new Date(row.expires_at as string | Date).getTime() <= now.getTime()) return { status: "expired" };
  if (row.status === "pending") return { status: "pending" };
  if (row.status !== "approved") return { status: "expired" }; // Consumed: its session was already handed out.

  // FOR UPDATE makes a concurrent poll that got here too wait for this one, then re-check the row: by
  // then it is consumed, so that poll's CTE is empty and the token is never returned twice.
  const consumed = await sql.query<Record<string, unknown>>(
    `with approved as (
       select id, session_token, user_id from orderat.web_pairings
        where id = $1 and status = 'approved' and expires_at > $2
        for update
     )
     update orderat.web_pairings p
        set status = 'consumed', session_token = null
       from approved join orderat.users u on u.id = approved.user_id
      where p.id = approved.id
     returning approved.session_token, u.id, u.provider, u.provider_sub, u.email, u.name, u.created_at`,
    [pairId, now.toISOString()],
  );
  const claimed = consumed[0];
  if (!claimed) return { status: "expired" };
  return { status: "approved", sessionToken: claimed.session_token as string, user: toUserRow(claimed) };
}
