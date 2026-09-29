// HTTP handler for orderat-auth (docs/sme-phase-2-cloud.md's "Accounts"). Plain Request -> Response,
// like server/ask/handler.ts and server/shop/handler.ts, so it runs the same under Deno, Node or a
// test; supabase/functions/orderat-auth/index.ts only wires in env + the two JWKS caches.
//
// `signin` verifies the provider's ID token and starts a session; every other action except the
// website's two pairing calls (below) authenticates itself from the X-Orderat-Session header
// (docs/sme-phase-2-cloud.md: "Every other call sends Authorization: Bearer <anon key> ... plus
// X-Orderat-Session: <session token>") rather than from anything in the body — server/sync/handler.ts
// and server/parse/handler.ts follow the same header convention for the actions that need a signed-in
// caller.
//
// A `signin` body may say `client: "web"` (the browser app): that session then expires
// WEB_SESSION_DAYS after signin (server/auth/store.ts). Without it, or with `client: "app"` (the
// phones), the session never expires.
//
// Phone-to-web login ("Open on computer"): the website calls `pair_start` (no session: getting one is
// the point) and shows the pairing's code as a QR code and as 6 digits; the seller's signed-in phone
// scans or types it and calls `pair_approve`, which creates a web session for the phone's account
// exactly as a `client: "web"` signin would; the website's `pair_poll` then collects that session, once.
// The pairing lives five minutes (db/migrations/0006_web_pairing.sql). pair_start is open to anyone,
// so it is limited per client IP and refused while MAX_PENDING_PAIRINGS are pending.

import type { SqlClient } from "../agent/postgres-store.ts";
import { hashClientIp } from "../shared/crypto.ts";
import type { JwksCache } from "./jwks.ts";
import { appleConfig, googleConfig } from "./providers.ts";
import { bumpPairApproveRateLimit, bumpPairStartRateLimit, MAX_PAIR_APPROVES_PER_MINUTE, MAX_PAIR_STARTS_PER_MINUTE } from "./rate-limit.ts";
import {
  approvePairing,
  countPendingPairings,
  createSession,
  deleteAccount,
  deleteExpiredPairings,
  findPendingPairingByCode,
  insertPairing,
  newPollToken,
  newSessionToken,
  pollPairing,
  resolveSession,
  revokeSession,
  upsertUser,
  WEB_SESSION_DAYS,
  type ResolvedSession,
  type UserRow,
} from "./store.ts";
import { validateAuthBody, type PairApproveBody, type PairPollBody, type SigninBody } from "./validate.ts";
import { expectedNonceFor, verifyIdToken } from "./verify-token.ts";

export interface AuthHandlerDeps {
  sql: SqlClient;
  appleJwks: JwksCache;
  googleJwks: JwksCache;
  appleAudiences: string[];
  googleAudiences: string[];
  /** Salt for hashing a client IP (pair_start's per-IP rate limit) before it is written to a row —
   * never the raw IP. */
  ipSalt: string;
  now?: () => Date;
  /** Structured, content-free log line per request — never an ID token, a session token, an email or
   * a name (nor a pairing's code or poll token). */
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const invalidTokenResponse = () => jsonResponse({ error: "invalid_token" }, 401);
const unauthorizedResponse = () => jsonResponse({ error: "unauthorized" }, 401);
const forbiddenResponse = () => jsonResponse({ error: "forbidden" }, 403);
const invalidCodeResponse = () => jsonResponse({ error: "invalid_code" }, 404);
const rateLimitedResponse = () => jsonResponse({ error: "rate_limited" }, 429);
const providerUnavailableResponse = () => jsonResponse({ error: "provider_unavailable" }, 502);

const WEB_SESSION_MS = WEB_SESSION_DAYS * 24 * 60 * 60 * 1000;
/** How long a pairing's code works, from pair_start. */
const PAIRING_TTL_MS = 5 * 60 * 1000;
/** At most this many pairings pending at once, from everyone: pair_start answers rate_limited above
 * it. Pairings are anonymous and cheap to start, and every pending code is one a phone can approve
 * (even by mistyping its own), so this keeps any flood to a sliver (0.05%) of the million codes. */
const MAX_PENDING_PAIRINGS = 500;
/** How many fresh codes pair_start draws before giving up, when each one it draws is already another
 * pending pairing's — with 1,000,000 codes and pairings that live five minutes, one clash is already
 * rare (same reasoning as server/sync/handler.ts's MAX_INVITE_CODE_ATTEMPTS). */
const MAX_PAIR_CODE_ATTEMPTS = 10;
/** The device name of a web session started by pairing, as a signin's is the app's `deviceName`. */
const PAIRED_DEVICE_NAME = "Web (paired)";

function userJson(user: UserRow) {
  return { id: user.id, provider: user.provider, email: user.email, name: user.name };
}

/** Six random digits: the same generator as server/sync/handler.ts's randomInviteCode. */
function randomPairCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function createAuthHandler(deps: AuthHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  /** Starts a session for `userId` and returns its raw token, of which only the SHA-256 hex is stored.
   * Only a browser's session ends, WEB_SESSION_DAYS from now: a `client: "web"` signin's and every
   * session a pairing starts. A phone's, whose signin says `client: "app"` or nothing at all, has no
   * end. */
  async function startSession(userId: string, deviceName: string | undefined, client: "web" | "app" | undefined): Promise<string> {
    const { token, tokenHash } = await newSessionToken();
    const expiresAt = client === "web" ? new Date(now().getTime() + WEB_SESSION_MS) : undefined;
    await createSession(deps.sql, { tokenHash, userId, deviceName, expiresAt });
    return token;
  }

  async function handleSignin(body: SigninBody): Promise<Response> {
    const config = body.provider === "apple"
      ? { ...appleConfig(deps.appleAudiences), jwks: deps.appleJwks }
      : { ...googleConfig(deps.googleAudiences), jwks: deps.googleJwks };

    const expectedNonce = body.nonce !== undefined ? await expectedNonceFor(body.provider, body.nonce) : undefined;

    const verified = await verifyIdToken(body.idToken, {
      issuers: config.issuers,
      audiences: config.audiences,
      jwks: config.jwks,
      now: now(),
      expectedNonce,
    }).catch((err: unknown) => {
      log({ event: "auth_signin", status: 502, provider: body.provider, reason: "jwks_unavailable", detail: err instanceof Error ? err.message : String(err) });
      return undefined;
    });
    if (verified === undefined) return providerUnavailableResponse();
    if (!verified.ok) {
      log({ event: "auth_signin", status: 401, provider: body.provider, reason: verified.error });
      return invalidTokenResponse();
    }

    // Every (provider, sub) maps to at most one user row (db/migrations/0004_cloud.sql's unique
    // index); a brand-new random id here is only ever actually used the first time this identity
    // signs in — store.ts's upsertUser keeps the original id on every signin after that.
    const user = await upsertUser(deps.sql, { id: crypto.randomUUID(), provider: body.provider, providerSub: verified.token.sub, email: verified.token.email, name: verified.token.name });
    const session = await startSession(user.id, body.deviceName, body.client);

    log({ event: "auth_signin", status: 200, provider: body.provider });
    return jsonResponse({ session, user: userJson(user) }, 200);
  }

  async function handlePairStart(req: Request): Promise<Response> {
    const at = now();
    const ipHash = await hashClientIp(req, deps.ipSalt);
    if ((await bumpPairStartRateLimit(deps.sql, ipHash, at)) > MAX_PAIR_STARTS_PER_MINUTE) {
      log({ event: "auth_pair_start", status: 429, reason: "client_limit" });
      return rateLimitedResponse();
    }

    await deleteExpiredPairings(deps.sql, at);
    if ((await countPendingPairings(deps.sql, at)) >= MAX_PENDING_PAIRINGS) {
      log({ event: "auth_pair_start", status: 429, reason: "pending_cap" });
      return rateLimitedResponse();
    }

    const pairId = crypto.randomUUID();
    const { pollToken, pollHash } = await newPollToken();
    const expiresAt = new Date(at.getTime() + PAIRING_TTL_MS);

    let code: string | undefined;
    for (let attempt = 0; attempt < MAX_PAIR_CODE_ATTEMPTS && code === undefined; attempt++) {
      const candidate = randomPairCode();
      if (await insertPairing(deps.sql, { id: pairId, code: candidate, pollHash, expiresAt })) code = candidate;
    }
    if (code === undefined) throw new Error("Could not generate a unique pairing code after several attempts");

    log({ event: "auth_pair_start", status: 200 });
    return jsonResponse({ pairId, code, pollToken, expiresAt: expiresAt.toISOString() }, 200);
  }

  async function handlePairApprove(body: PairApproveBody, resolved: ResolvedSession): Promise<Response> {
    // Only a phone's session, which never expires, approves. A browser's (a web signin's, or one a
    // pairing started) could otherwise keep pairing fresh browsers and never run out its 30 days.
    if (resolved.session.expiresAt) {
      log({ event: "auth_pair_approve", status: 403, reason: "web_session" });
      return forbiddenResponse();
    }

    const at = now();
    if ((await bumpPairApproveRateLimit(deps.sql, resolved.user.id, at)) > MAX_PAIR_APPROVES_PER_MINUTE) {
      log({ event: "auth_pair_approve", status: 429 });
      return rateLimitedResponse();
    }

    await deleteExpiredPairings(deps.sql, at);
    const pairing = await findPendingPairingByCode(deps.sql, body.code, at);
    if (!pairing) {
      log({ event: "auth_pair_approve", status: 404 });
      return invalidCodeResponse();
    }

    const sessionToken = await startSession(resolved.user.id, PAIRED_DEVICE_NAME, "web");
    if (!(await approvePairing(deps.sql, { id: pairing.id, userId: resolved.user.id, sessionToken, now: at }))) {
      // Another phone approved this code, or its five minutes ran out, since the lookup above: the
      // session just started for it will never be handed out, so it must never work either.
      await revokeSession(deps.sql, sessionToken);
      log({ event: "auth_pair_approve", status: 404, reason: "no_longer_pending" });
      return invalidCodeResponse();
    }

    log({ event: "auth_pair_approve", status: 200 });
    return jsonResponse({ ok: true }, 200);
  }

  async function handlePairPoll(body: PairPollBody): Promise<Response> {
    const at = now();
    await deleteExpiredPairings(deps.sql, at);
    const polled = await pollPairing(deps.sql, body.pairId, body.pollToken, at);

    // Only the answer that ends the polling is logged: the website asks every few seconds while pending.
    if (polled.status !== "pending") log({ event: "auth_pair_poll", status: 200, result: polled.status });
    if (polled.status !== "approved") return jsonResponse({ status: polled.status }, 200);
    return jsonResponse({ status: "approved", session: polled.sessionToken, user: userJson(polled.user) }, 200);
  }

  return async (req) => {
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateAuthBody(raw);
    if (!validated.ok) {
      log({ event: "auth", status: validated.error === "too_large" ? 413 : 400 });
      return validated.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
    }
    const body = validated.body;

    if (body.action === "signin") return handleSignin(body);
    // The website's side of a pairing needs no session (a session is what it is pairing for), and
    // ignores one if sent.
    if (body.action === "pair_start") return handlePairStart(req);
    if (body.action === "pair_poll") return handlePairPoll(body);

    const sessionToken = req.headers.get("x-orderat-session") ?? "";
    const resolved = sessionToken ? await resolveSession(deps.sql, sessionToken, now()) : undefined;
    if (!resolved) {
      log({ event: "auth", status: 401, action: body.action });
      return unauthorizedResponse();
    }

    // Every action by name, delete_account included, so no action ever lands in another's branch.
    switch (body.action) {
      case "signout":
        await revokeSession(deps.sql, sessionToken);
        log({ event: "auth_signout", status: 200 });
        return jsonResponse({ ok: true }, 200);
      case "me":
        log({ event: "auth_me", status: 200 });
        return jsonResponse({ user: userJson(resolved.user) }, 200);
      case "pair_approve":
        return handlePairApprove(body, resolved);
      case "delete_account":
        await deleteAccount(deps.sql, resolved.user.id);
        log({ event: "auth_delete_account", status: 200 });
        return jsonResponse({ ok: true }, 200);
      default: {
        // `never`: an action the validator accepts but this switch has no case for is a compile error
        // here. Should one ever get this far anyway, it is refused, never run as some other action.
        const unhandled: never = body;
        log({ event: "auth", status: 400, action: (unhandled as { action: string }).action });
        return invalidBodyResponse();
      }
    }
  };
}
