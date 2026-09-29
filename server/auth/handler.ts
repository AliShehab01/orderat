// HTTP handler for orderat-auth (docs/sme-phase-2-cloud.md's "Accounts"). Plain Request -> Response,
// like server/ask/handler.ts and server/shop/handler.ts, so it runs the same under Deno, Node or a
// test; supabase/functions/orderat-auth/index.ts only wires in env + the two JWKS caches.
//
// `signin` verifies the provider's ID token and starts a session; every other action authenticates
// itself from the X-Orderat-Session header (docs/sme-phase-2-cloud.md: "Every other call sends
// Authorization: Bearer <anon key> ... plus X-Orderat-Session: <session token>") rather than from
// anything in the body — server/sync/handler.ts and server/parse/handler.ts follow the same header
// convention for the actions that need a signed-in caller.
//
// A `signin` body may say `client: "web"` (the browser app): that session then expires
// WEB_SESSION_DAYS after signin (server/auth/store.ts). Without it, or with `client: "app"` (the
// phones), the session never expires.

import type { SqlClient } from "../agent/postgres-store.ts";
import type { JwksCache } from "./jwks.ts";
import { appleConfig, googleConfig } from "./providers.ts";
import { createSession, deleteAccount, newSessionToken, resolveSession, revokeSession, upsertUser, WEB_SESSION_DAYS, type UserRow } from "./store.ts";
import { validateAuthBody, type SigninBody } from "./validate.ts";
import { expectedNonceFor, verifyIdToken } from "./verify-token.ts";

export interface AuthHandlerDeps {
  sql: SqlClient;
  appleJwks: JwksCache;
  googleJwks: JwksCache;
  appleAudiences: string[];
  googleAudiences: string[];
  now?: () => Date;
  /** Structured, content-free log line per request — never an ID token, a session token, an email or
   * a name. */
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const invalidTokenResponse = () => jsonResponse({ error: "invalid_token" }, 401);
const unauthorizedResponse = () => jsonResponse({ error: "unauthorized" }, 401);
const providerUnavailableResponse = () => jsonResponse({ error: "provider_unavailable" }, 502);

const WEB_SESSION_MS = WEB_SESSION_DAYS * 24 * 60 * 60 * 1000;

function userJson(user: UserRow) {
  return { id: user.id, provider: user.provider, email: user.email, name: user.name };
}

export function createAuthHandler(deps: AuthHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

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
    const { token, tokenHash } = await newSessionToken();
    // Only a browser's session ends (WEB_SESSION_DAYS from this signin); a phone's, whose body says
    // `client: "app"` or nothing at all, has no end.
    const expiresAt = body.client === "web" ? new Date(now().getTime() + WEB_SESSION_MS) : undefined;
    await createSession(deps.sql, { tokenHash, userId: user.id, deviceName: body.deviceName, expiresAt });

    log({ event: "auth_signin", status: 200, provider: body.provider });
    return jsonResponse({ session: token, user: userJson(user) }, 200);
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

    const sessionToken = req.headers.get("x-orderat-session") ?? "";
    const resolved = sessionToken ? await resolveSession(deps.sql, sessionToken, now()) : undefined;
    if (!resolved) {
      log({ event: "auth", status: 401, action: body.action });
      return unauthorizedResponse();
    }

    if (body.action === "signout") {
      await revokeSession(deps.sql, sessionToken);
      log({ event: "auth_signout", status: 200 });
      return jsonResponse({ ok: true }, 200);
    }

    if (body.action === "me") {
      log({ event: "auth_me", status: 200 });
      return jsonResponse({ user: userJson(resolved.user) }, 200);
    }

    // delete_account
    await deleteAccount(deps.sql, resolved.user.id);
    log({ event: "auth_delete_account", status: 200 });
    return jsonResponse({ ok: true }, 200);
  };
}
