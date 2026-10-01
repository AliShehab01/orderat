import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { sha256HexOfString } from "../shared/crypto.ts";
import { APPLE_REVOKE_URL, APPLE_TOKEN_URL, createAppleTokenClient, type AppleKeyConfig } from "./apple-tokens.ts";
import { createAuthHandler, type AuthHandlerDeps } from "./handler.ts";
import { createJwksCache } from "./jwks.ts";
import { fakeJwksFetch, generateTestKeyPair, signTestToken, type TestKeyPair } from "./jwt-test-support.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const APPLE_AUD = "com.ams.orderat";
const GOOGLE_AUD = "google-client-id";

let sql: SqlClient;
let appleKeyPair: TestKeyPair;
let googleKeyPair: TestKeyPair;

function makeHandler(now: () => Date = () => NOW, overrides: Partial<AuthHandlerDeps> = {}) {
  return createAuthHandler({
    sql,
    appleJwks: createJwksCache("https://appleid.apple.com/auth/keys", { fetchImpl: fakeJwksFetch([appleKeyPair]) }),
    googleJwks: createJwksCache("https://www.googleapis.com/oauth2/v3/certs", { fetchImpl: fakeJwksFetch([googleKeyPair]) }),
    appleAudiences: [APPLE_AUD],
    googleAudiences: [GOOGLE_AUD],
    ipSalt: "test-ip-salt",
    now,
    log: () => {},
    ...overrides,
  });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/orderat-auth", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function appleSigninToken(overrides: Record<string, unknown> = {}) {
  return signTestToken(appleKeyPair, {
    iss: "https://appleid.apple.com",
    aud: APPLE_AUD,
    sub: "apple-sub-1",
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    email: "seller@example.com",
    ...overrides,
  });
}

beforeEach(async () => {
  sql = await createCloudTestSql();
  appleKeyPair = await generateTestKeyPair("apple-key-1");
  googleKeyPair = await generateTestKeyPair("google-key-1");
});

describe("createAuthHandler / signin", () => {
  it("signs in with a valid Apple ID token and returns a session + user", async () => {
    const handler = makeHandler();
    const idToken = await appleSigninToken();
    const res = await handler(post({ action: "signin", provider: "apple", idToken, deviceName: "iPhone" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.session).toBe("string");
    expect(body.session.length).toBeGreaterThan(20);
    expect(body.user).toMatchObject({ provider: "apple", email: "seller@example.com" });
  });

  it("signs in with a valid Google ID token", async () => {
    const handler = makeHandler();
    const idToken = await signTestToken(googleKeyPair, {
      iss: "accounts.google.com",
      aud: GOOGLE_AUD,
      sub: "google-sub-1",
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    const res = await handler(post({ action: "signin", provider: "google", idToken }));
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ provider: "google" });
  });

  it("verifies the Apple nonce as a SHA-256 of the app's raw nonce", async () => {
    const handler = makeHandler();
    const idToken = await appleSigninToken({ nonce: await sha256HexOfString("raw-nonce") });
    const res = await handler(post({ action: "signin", provider: "apple", idToken, nonce: "raw-nonce" }));
    expect(res.status).toBe(200);
  });

  it("rejects a nonce mismatch with invalid_token", async () => {
    const handler = makeHandler();
    const idToken = await appleSigninToken({ nonce: "some-other-hash" });
    const res = await handler(post({ action: "signin", provider: "apple", idToken, nonce: "raw-nonce" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("rejects a token signed for a different audience", async () => {
    const handler = makeHandler();
    const idToken = await appleSigninToken({ aud: "some-other-app" });
    const res = await handler(post({ action: "signin", provider: "apple", idToken }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("rejects an expired token", async () => {
    const handler = makeHandler();
    const idToken = await appleSigninToken({ exp: Math.floor(NOW.getTime() / 1000) - 10 });
    const res = await handler(post({ action: "signin", provider: "apple", idToken }));
    expect(res.status).toBe(401);
  });

  it("reuses the same user id across repeated signins from the same identity", async () => {
    const handler = makeHandler();
    const first = await (await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken() }))).json();
    const second = await (await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken() }))).json();
    expect(second.user.id).toBe(first.user.id);
    expect(second.session).not.toBe(first.session); // A new session token each time.
  });

  it("returns provider_unavailable (502), not invalid_token, when the JWKS endpoint is unreachable", async () => {
    const handler = createAuthHandler({
      sql,
      appleJwks: createJwksCache("https://appleid.apple.com/auth/keys", { fetchImpl: (async () => new Response("down", { status: 500 })) as unknown as typeof fetch }),
      googleJwks: createJwksCache("https://www.googleapis.com/oauth2/v3/certs", { fetchImpl: fakeJwksFetch([googleKeyPair]) }),
      appleAudiences: [APPLE_AUD],
      googleAudiences: [GOOGLE_AUD],
      ipSalt: "test-ip-salt",
      now: () => NOW,
      log: () => {},
    });
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken() }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "provider_unavailable" });
  });
});

describe("createAuthHandler / session-authenticated actions", () => {
  async function signIn(handler: (req: Request) => Promise<Response>): Promise<string> {
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken() }));
    return (await res.json()).session as string;
  }

  it("me returns the signed-in user", async () => {
    const handler = makeHandler();
    const session = await signIn(handler);
    const res = await handler(post({ action: "me" }, { "x-orderat-session": session }));
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ provider: "apple", email: "seller@example.com" });
  });

  it("me without a session header is unauthorized", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "me" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("me with a garbage session token is unauthorized", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "me" }, { "x-orderat-session": "garbage" }));
    expect(res.status).toBe(401);
  });

  it("signout revokes the session so a later me fails", async () => {
    const handler = makeHandler();
    const session = await signIn(handler);
    const signoutRes = await handler(post({ action: "signout" }, { "x-orderat-session": session }));
    expect(signoutRes.status).toBe(200);
    expect(await signoutRes.json()).toEqual({ ok: true });

    const meRes = await handler(post({ action: "me" }, { "x-orderat-session": session }));
    expect(meRes.status).toBe(401);
  });

  it("delete_account removes the user so a later me fails", async () => {
    const handler = makeHandler();
    const session = await signIn(handler);
    const deleteRes = await handler(post({ action: "delete_account" }, { "x-orderat-session": session }));
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    const meRes = await handler(post({ action: "me" }, { "x-orderat-session": session }));
    expect(meRes.status).toBe(401);
  });
});

// Google sign-in from the iPhone (ORDERAT_GOOGLE_IOS_CLIENT_ID): the token's aud is the iOS OAuth client,
// and Google copies the nonce it was given verbatim, so the signin body's nonce must be that same value.
describe("createAuthHandler / Google sign-in from the iPhone's own client", () => {
  const IOS_AUD = "ios-client.apps.googleusercontent.com";
  const googleToken = async (claims: Record<string, unknown>) =>
    signTestToken(googleKeyPair, { iss: "https://accounts.google.com", sub: "g-ios", exp: Math.floor(NOW.getTime() / 1000) + 3600, ...claims });

  it("accepts a token for the iOS client once it is among the Google audiences", async () => {
    const handler = makeHandler(() => NOW, { googleAudiences: [GOOGLE_AUD, IOS_AUD] });
    expect((await handler(post({ action: "signin", provider: "google", idToken: await googleToken({ aud: IOS_AUD }) }))).status).toBe(200);
    const without = makeHandler();
    expect((await without(post({ action: "signin", provider: "google", idToken: await googleToken({ aud: IOS_AUD }) }))).status).toBe(401);
  });

  it("compares the body's nonce with the token's verbatim: send the exact value given to Google", async () => {
    const handler = makeHandler(() => NOW, { googleAudiences: [GOOGLE_AUD, IOS_AUD] });
    const raw = "raw-nonce-123";
    const hashed = await sha256HexOfString(raw);
    const idToken = await googleToken({ aud: IOS_AUD, nonce: hashed }); // the app gave Google SHA-256(raw)
    expect((await handler(post({ action: "signin", provider: "google", idToken, nonce: hashed }))).status).toBe(200);
    expect((await handler(post({ action: "signin", provider: "google", idToken, nonce: raw }))).status).toBe(401);
  });
});

// Sign in with Apple revocation (App Store Review Guideline 5.1.1(v)): an Apple signin's
// authorizationCode is exchanged for a refresh token, which delete_account revokes. Apple's endpoints
// are a fake fetch here.
describe("createAuthHandler / Sign in with Apple token revocation", () => {
  let appleKey: AppleKeyConfig;
  let calls: { url: string; fields: URLSearchParams }[];
  let revokeStatus: number;

  beforeEach(async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const b64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    appleKey = { teamId: "TEAM123456", keyId: "KEY1234567", privateKeyPem: `-----BEGIN PRIVATE KEY-----
${b64}
-----END PRIVATE KEY-----` };
    calls = [];
    revokeStatus = 200;
  });

  const appleFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const fields = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, fields });
    if (url === APPLE_TOKEN_URL) {
      return fields.get("code") === "good-code" ? Response.json({ refresh_token: `refresh-for-${fields.get("client_id")}` }) : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url === APPLE_REVOKE_URL) return new Response("", { status: revokeStatus });
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  function handlerWithApple(log: (entry: Record<string, unknown>) => void = () => {}) {
    return makeHandler(() => NOW, {
      appleAudiences: [APPLE_AUD, "com.ams.orderat.web"],
      appleTokens: createAppleTokenClient(appleKey, { fetchImpl: appleFetch, now: () => NOW }),
      log,
    });
  }

  async function storedTokens() {
    return sql.query<{ client_id: string; refresh_token: string }>(`select client_id, refresh_token from orderat.apple_tokens order by client_id`);
  }

  it("exchanges the code for the client id the ID token was issued to and keeps the refresh token", async () => {
    const handler = handlerWithApple();
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken({ aud: "com.ams.orderat.web" }), authorizationCode: "good-code", client: "web" }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => [c.url, c.fields.get("client_id")])).toEqual([[APPLE_TOKEN_URL, "com.ams.orderat.web"]]);
    expect(await storedTokens()).toEqual([{ client_id: "com.ams.orderat.web", refresh_token: "refresh-for-com.ams.orderat.web" }]);
  });

  it("still signs in when Apple refuses the code, and keeps nothing", async () => {
    const handler = handlerWithApple();
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), authorizationCode: "bad-code" }));
    expect(res.status).toBe(200);
    expect(await storedTokens()).toEqual([]);
  });

  it("revokes every kept token at Apple and removes it when the account is deleted", async () => {
    const handler = handlerWithApple();
    await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), authorizationCode: "good-code" }));
    const web = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken({ aud: "com.ams.orderat.web" }), authorizationCode: "good-code", client: "web" }));
    const session = (await web.json()).session as string;
    calls = [];

    const res = await handler(post({ action: "delete_account" }, { "x-orderat-session": session }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => [c.url, c.fields.get("client_id"), c.fields.get("token")])).toEqual([
      [APPLE_REVOKE_URL, "com.ams.orderat", "refresh-for-com.ams.orderat"],
      [APPLE_REVOKE_URL, "com.ams.orderat.web", "refresh-for-com.ams.orderat.web"],
    ]);
    expect(await storedTokens()).toEqual([]);
  });

  it("still deletes the account (and its tokens) when Apple refuses the revoke", async () => {
    const handler = handlerWithApple();
    const signin = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), authorizationCode: "good-code" }));
    const session = (await signin.json()).session as string;
    revokeStatus = 500;
    expect((await handler(post({ action: "delete_account" }, { "x-orderat-session": session }))).status).toBe(200);
    expect((await handler(post({ action: "me" }, { "x-orderat-session": session }))).status).toBe(401);
    expect(await storedTokens()).toEqual([]);
  });

  it("ignores an authorizationCode on a Google signin", async () => {
    const handler = handlerWithApple();
    const idToken = await signTestToken(googleKeyPair, { iss: "https://accounts.google.com", aud: GOOGLE_AUD, sub: "g-1", exp: Math.floor(NOW.getTime() / 1000) + 3600 });
    expect((await handler(post({ action: "signin", provider: "google", idToken, authorizationCode: "good-code" }))).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("without the Apple secrets, skips the exchange and logs that only once", async () => {
    const entries: Record<string, unknown>[] = [];
    const handler = makeHandler(() => NOW, { log: (e) => entries.push(e) });
    for (let i = 0; i < 2; i++) {
      expect((await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), authorizationCode: "good-code" }))).status).toBe(200);
    }
    expect(entries.filter((e) => e.event === "auth_apple_token")).toEqual([{ event: "auth_apple_token", status: "skipped", reason: "not_configured" }]);
    expect(await storedTokens()).toEqual([]);
  });
});

// A browser signs in with client: "web" and its session lasts 30 days; the phones send no client (or
// "app") and their sessions never expire (docs/superpowers/specs/2026-09-29-orderat-web-design.md).
describe("createAuthHandler / session lifetime", () => {
  async function signInAs(handler: (req: Request) => Promise<Response>, extra: Record<string, unknown>): Promise<string> {
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), ...extra }));
    expect(res.status).toBe(200);
    return (await res.json()).session as string;
  }

  const me = (handler: (req: Request) => Promise<Response>, session: string) => handler(post({ action: "me" }, { "x-orderat-session": session }));

  it("a web session works now and after 29 days, but is unauthorized 31 days after signin", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, { client: "web" });

    expect((await me(handler, session)).status).toBe(200);
    clock = new Date(NOW.getTime() + 29 * DAY_MS);
    expect((await me(handler, session)).status).toBe(200);
    clock = new Date(NOW.getTime() + 31 * DAY_MS);
    const expired = await me(handler, session);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "unauthorized" });
  });

  it("stores a web session's expiry as exactly 30 days after signin", async () => {
    const handler = makeHandler();
    await signInAs(handler, { client: "web" });
    const rows = await sql.query<{ expires_at: Date }>(`select expires_at from orderat.sessions`);
    expect(new Date(rows[0]!.expires_at).toISOString()).toBe(new Date(NOW.getTime() + 30 * DAY_MS).toISOString());
  });

  it("an expired web session cannot sign out or delete the account either", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, { client: "web" });
    clock = new Date(NOW.getTime() + 31 * DAY_MS);

    expect((await handler(post({ action: "signout" }, { "x-orderat-session": session }))).status).toBe(401);
    expect((await handler(post({ action: "delete_account" }, { "x-orderat-session": session }))).status).toBe(401);
    expect((await sql.query(`select 1 from orderat.users`)).length).toBe(1); // The account is still there.
  });

  it("a session from a signin with no client (a phone's) has no fixed end: in use, it outlives 400 days", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, {});

    for (const day of [150, 300, 400]) {
      clock = new Date(NOW.getTime() + day * DAY_MS);
      expect((await me(handler, session)).status).toBe(200);
    }
    const rows = await sql.query<{ expires_at: Date | null }>(`select expires_at from orderat.sessions`);
    expect(rows[0]!.expires_at).toBeNull();
  });

  it("client: \"app\" is a phone too: no fixed end", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, { client: "app", deviceName: "iPhone" });

    for (const day of [179, 358]) {
      clock = new Date(NOW.getTime() + day * DAY_MS);
      expect((await me(handler, session)).status).toBe(200);
    }
  });

  // Security review 1 Oct 2026, F05: an app session unused for 180 days is signed out.
  it("a phone session unused for 180 days is unauthorized, and stays so", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, { client: "app", deviceName: "iPhone" });

    clock = new Date(NOW.getTime() + 180 * DAY_MS);
    const idle = await me(handler, session);
    expect(idle.status).toBe(401);
    expect(await idle.json()).toEqual({ error: "unauthorized" });
    clock = NOW;
    expect((await me(handler, session)).status).toBe(401);
    expect((await sql.query(`select 1 from orderat.users`)).length).toBe(1); // Signed out, not deleted.
  });

  it("starts a new session's idle window at the signin's own clock", async () => {
    const handler = makeHandler();
    await signInAs(handler, {});
    const rows = await sql.query<{ last_seen_at: Date; created_at: Date }>(`select last_seen_at, created_at from orderat.sessions`);
    expect(new Date(rows[0]!.last_seen_at).toISOString()).toBe(NOW.toISOString());
    expect(new Date(rows[0]!.created_at).toISOString()).toBe(NOW.toISOString());
  });

  it("a web signin does not shorten the same user's phone session", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInAs(handler, {});
    const web = await signInAs(handler, { client: "web" });

    clock = new Date(NOW.getTime() + 31 * DAY_MS);
    expect((await me(handler, web)).status).toBe(401);
    expect((await me(handler, phone)).status).toBe(200);
  });

  it("rejects an unknown client with invalid_body and issues no session", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), client: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect((await sql.query(`select 1 from orderat.sessions`)).length).toBe(0);
  });
});

describe("createAuthHandler / request shape", () => {
  it("rejects a non-POST request", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("https://example.test/orderat-auth", { method: "GET" }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with invalid_body", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("https://example.test/orderat-auth", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("rejects an oversized body with too_large", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "signin", provider: "apple", idToken: "a".repeat(20000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });
});

// Phone-to-web login ("Open on computer"): the website starts a pairing and shows its code (a QR code
// and 6 digits), the seller's signed-in phone approves that code, and the website, polling, receives a
// web session for the phone's account.
describe("createAuthHandler / phone-to-web pairing", () => {
  const MINUTE_MS = 60 * 1000;
  type Handler = (req: Request) => Promise<Response>;
  interface Pairing { pairId: string; code: string; pollToken: string; expiresAt: string; }

  async function signInPhone(handler: Handler, sub = "apple-sub-1", email = "seller@example.com"): Promise<string> {
    const res = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken({ sub, email }), deviceName: "iPhone" }));
    expect(res.status).toBe(200);
    return (await res.json()).session as string;
  }

  async function start(handler: Handler): Promise<Pairing> {
    const res = await handler(post({ action: "pair_start" }));
    expect(res.status).toBe(200);
    return (await res.json()) as Pairing;
  }

  const approve = (handler: Handler, code: string, session?: string) =>
    handler(post({ action: "pair_approve", code }, session ? { "x-orderat-session": session } : {}));

  async function poll(handler: Handler, pairing: Pick<Pairing, "pairId" | "pollToken">) {
    const res = await handler(post({ action: "pair_poll", pairId: pairing.pairId, pollToken: pairing.pollToken }));
    expect(res.status).toBe(200);
    return res.json();
  }

  const me = (handler: Handler, session: string) => handler(post({ action: "me" }, { "x-orderat-session": session }));

  async function pairingRow(pairId: string) {
    return (await sql.query<Record<string, unknown>>(`select * from orderat.web_pairings where id = $1`, [pairId]))[0];
  }

  /** A 6-digit code that differs from `code`. */
  const otherCode = (code: string) => (code === "000000" ? "000001" : "000000");

  it("starts a pairing without a session: an id, a 6-digit code, a poll token and an expiry 5 minutes out", async () => {
    const pairing = await start(makeHandler());
    expect(pairing.pairId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pairing.code).toMatch(/^\d{6}$/);
    expect(pairing.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairing.expiresAt).toBe("2026-09-27T12:05:00.000Z");
    expect(Object.keys(pairing).sort()).toEqual(["code", "expiresAt", "pairId", "pollToken"]);
  });

  it("polls as pending until the phone approves", async () => {
    const handler = makeHandler();
    const pairing = await start(handler);
    expect(await poll(handler, pairing)).toEqual({ status: "pending" });
  });

  it("start, approve, poll: the website receives a session for the phone's account that works for me", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const phoneUser = (await (await me(handler, phone)).json()).user;
    const pairing = await start(handler);

    const approved = await approve(handler, pairing.code, phone);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ ok: true });

    const polled = await poll(handler, pairing);
    expect(polled).toEqual({ status: "approved", session: expect.any(String), user: phoneUser });
    expect(polled.session).not.toBe(phone);
    const meRes = await me(handler, polled.session);
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user).toEqual(phoneUser);
  });

  it("hands the session out once: a second poll is expired and the pairing no longer holds the token", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    await approve(handler, pairing.code, phone);

    expect((await poll(handler, pairing)).status).toBe("approved");
    expect(await poll(handler, pairing)).toEqual({ status: "expired" });
    expect(await pairingRow(pairing.pairId)).toMatchObject({ status: "consumed", session_token: null });
  });

  it("answers a wrong poll token and an unknown pairing the same expired, and still hands the session to the right poll", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    const other = await start(handler);
    await approve(handler, pairing.code, phone);

    expect(await poll(handler, { pairId: pairing.pairId, pollToken: other.pollToken })).toEqual({ status: "expired" });
    expect(await poll(handler, { pairId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", pollToken: pairing.pollToken })).toEqual({ status: "expired" });
    expect((await poll(handler, pairing)).status).toBe("approved");
  });

  it("an expired pairing can no longer be approved (404 invalid_code) and polls as expired", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInPhone(handler);
    const pairing = await start(handler);

    clock = new Date(NOW.getTime() + 5 * MINUTE_MS);
    const res = await approve(handler, pairing.code, phone);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(await poll(handler, pairing)).toEqual({ status: "expired" });
  });

  it("rejects a code no pending pairing shows with 404 invalid_code", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const pairing = await start(handler);

    const res = await approve(handler, otherCode(pairing.code), phone);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(await poll(handler, pairing)).toEqual({ status: "pending" });
  });

  it("approve without a session, or with an unknown one, is unauthorized and leaves the pairing pending", async () => {
    const handler = makeHandler();
    const pairing = await start(handler);

    const res = await approve(handler, pairing.code);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect((await approve(handler, pairing.code, "garbage")).status).toBe(401);
    expect(await poll(handler, pairing)).toEqual({ status: "pending" });
  });

  it("a browser's session, signed in or paired, cannot approve (403), so a web session never mints another", async () => {
    const handler = makeHandler();
    const signin = await handler(post({ action: "signin", provider: "apple", idToken: await appleSigninToken(), client: "web" }));
    const webSession = (await signin.json()).session as string;
    const phone = await signInPhone(handler);
    const first = await start(handler);
    await approve(handler, first.code, phone);
    const pairedSession = (await poll(handler, first)).session as string;
    const pairing = await start(handler);

    for (const session of [webSession, pairedSession]) {
      const res = await approve(handler, pairing.code, session);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(await poll(handler, pairing)).toEqual({ status: "pending" });
  });

  it("a code approved by one phone cannot be approved again by another", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const otherPhone = await signInPhone(handler, "apple-sub-2", "other@example.com");
    const pairing = await start(handler);

    expect((await approve(handler, pairing.code, phone)).status).toBe(200);
    const second = await approve(handler, pairing.code, otherPhone);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "invalid_code" });
    expect((await poll(handler, pairing)).user.email).toBe("seller@example.com");
  });

  it("revokes the session it created when another phone approves the same code first, and answers 404", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const otherPhone = await signInPhone(handler, "apple-sub-2", "other@example.com");
    const pairing = await start(handler);
    // The other phone's approval lands between this call finding the code and claiming it: just as
    // this call writes the web session it made for the pairing.
    let raced = false;
    const racingSql: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        if (!raced && text.startsWith("insert into orderat.sessions")) {
          raced = true;
          expect((await approve(handler, pairing.code, otherPhone)).status).toBe(200);
        }
        return sql.query<T>(text, params);
      },
    };

    const res = await approve(makeHandler(() => NOW, { sql: racingSql }), pairing.code, phone);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_code" });

    const polled = await poll(handler, pairing);
    expect(polled.user.email).toBe("other@example.com");
    const paired = await sql.query<{ token_hash: string; revoked_at: Date | null }>(`select token_hash, revoked_at from orderat.sessions where device_name = 'Web (paired)'`);
    expect(paired).toHaveLength(2);
    expect(paired.filter((row) => row.revoked_at === null).map((row) => row.token_hash)).toEqual([await sha256HexOfString(polled.session)]);
  });

  it("limits an account to 10 approvals a minute: the 11th is rate_limited whatever its code", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInPhone(handler);
    const pairing = await start(handler);

    for (let i = 0; i < 10; i++) expect((await approve(handler, otherCode(pairing.code), phone)).status).toBe(404);
    const limited = await approve(handler, pairing.code, phone);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(await poll(handler, pairing)).toEqual({ status: "pending" });

    clock = new Date(NOW.getTime() + MINUTE_MS);
    expect((await approve(handler, pairing.code, phone)).status).toBe(200);
  });

  it("counts an account's approvals across all its sessions: a fresh signin buys no fresh tries", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    for (let i = 0; i < 10; i++) await approve(handler, otherCode(pairing.code), phone);

    const secondSession = await signInPhone(handler); // The same Apple account again.
    expect((await approve(handler, pairing.code, secondSession)).status).toBe(429);
    const otherAccount = await signInPhone(handler, "apple-sub-2", "other@example.com");
    expect((await approve(handler, pairing.code, otherAccount)).status).toBe(200);
  });

  it("limits pair_start to 10 a minute per client IP, the first entry of x-forwarded-for", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const startFrom = (forwardedFor: string) => handler(post({ action: "pair_start" }, { "x-forwarded-for": forwardedFor }));

    for (let i = 0; i < 10; i++) expect((await startFrom(`203.0.113.7, 10.0.0.${i}`)).status).toBe(200);
    const limited = await startFrom("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await startFrom("198.51.100.9")).status).toBe(200); // Another client is unaffected.

    clock = new Date(NOW.getTime() + MINUTE_MS);
    expect((await startFrom("203.0.113.7")).status).toBe(200);
  });

  it("counts pair_start calls without x-forwarded-for together, as the one client \"unknown\"", async () => {
    const handler = makeHandler();
    for (let i = 0; i < 10; i++) await start(handler);
    const limited = await handler(post({ action: "pair_start" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });

  it("keeps only a salted hash of the client IP, never the IP itself", async () => {
    const handler = makeHandler();
    await handler(post({ action: "pair_start" }, { "x-forwarded-for": "203.0.113.7" }));

    const rows = await sql.query<{ ip_hash: string }>(`select ip_hash from orderat.pair_start_rate_limit`);
    expect(rows).toEqual([{ ip_hash: await sha256HexOfString("test-ip-salt:203.0.113.7") }]);
  });

  it("caps pending pairings at 500: pair_start is rate_limited until one stops pending", async () => {
    const handler = makeHandler();
    // 499 pending pairings from 499 other websites, inserted directly (one client couldn't start them all).
    await sql.query(
      `insert into orderat.web_pairings (id, code, poll_hash, status, expires_at)
       select gen_random_uuid(), lpad(n::text, 6, '0'), 'hash', 'pending', $1 from generate_series(1, 499) as n`,
      [new Date(NOW.getTime() + 5 * MINUTE_MS).toISOString()],
    );
    const fiveHundredth = await start(handler);

    const capped = await handler(post({ action: "pair_start" }, { "x-forwarded-for": "198.51.100.9" }));
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "rate_limited" });

    await approve(handler, fiveHundredth.code, await signInPhone(handler));
    expect((await handler(post({ action: "pair_start" }, { "x-forwarded-for": "198.51.100.9" }))).status).toBe(200);
  });

  it("does not count expired pairings toward the cap", async () => {
    const handler = makeHandler();
    await sql.query(
      `insert into orderat.web_pairings (id, code, poll_hash, status, expires_at)
       select gen_random_uuid(), lpad(n::text, 6, '0'), 'hash', 'pending', $1 from generate_series(1, 500) as n`,
      [NOW.toISOString()],
    );
    expect((await handler(post({ action: "pair_start" }))).status).toBe(200);
  });

  it("the paired web session lasts 30 days from the approval, like a web signin's", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    const approvedAt = new Date(NOW.getTime() + MINUTE_MS);
    clock = approvedAt;
    await approve(handler, pairing.code, phone);
    const { session } = await poll(handler, pairing);

    const rows = await sql.query<{ expires_at: Date; device_name: string }>(`select expires_at, device_name from orderat.sessions where token_hash = $1`, [await sha256HexOfString(session)]);
    expect(rows[0]!.device_name).toBe("Web (paired)");
    expect(new Date(rows[0]!.expires_at).toISOString()).toBe("2026-10-27T12:01:00.000Z");

    clock = new Date(approvedAt.getTime() + 29 * DAY_MS);
    expect((await me(handler, session)).status).toBe(200);
    clock = new Date(approvedAt.getTime() + 31 * DAY_MS);
    expect((await me(handler, session)).status).toBe(401);
    expect((await me(handler, phone)).status).toBe(200); // The phone's own session never expires.
  });

  it("an approved pairing the website never collects loses its raw session token, and the session, once it expires", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    await approve(handler, pairing.code, phone);
    const rawSession = (await pairingRow(pairing.pairId))!.session_token as string;
    expect((await me(handler, rawSession)).status).toBe(200);

    clock = new Date(NOW.getTime() + 5 * MINUTE_MS);
    await start(handler); // Any pairing call (here another website's) first deletes the expired pairings.
    expect(await pairingRow(pairing.pairId)).toBeUndefined();
    expect(await poll(handler, pairing)).toEqual({ status: "expired" });
    expect((await me(handler, rawSession)).status).toBe(401);
    const paired = await sql.query<{ revoked_at: Date | null }>(`select revoked_at from orderat.sessions where device_name = 'Web (paired)'`);
    expect(paired).toEqual([{ revoked_at: expect.any(Date) }]);
  });

  it("a phone approving in a pairing's last second leaves the website a minute to collect the session", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const phone = await signInPhone(handler);
    const pairing = await start(handler);

    clock = new Date(NOW.getTime() + 5 * MINUTE_MS - 1000);
    expect((await approve(handler, pairing.code, phone)).status).toBe(200);
    clock = new Date(NOW.getTime() + 5 * MINUTE_MS + 30_000);
    const polled = await poll(handler, pairing);
    expect(polled.status).toBe("approved");
    expect((await me(handler, polled.session)).status).toBe(200);
  });

  it("two polls racing for one approved pairing: exactly one receives the session, the other answers expired", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    await approve(handler, pairing.code, phone);
    // The inner poll runs start to finish just as the outer one, past its own check that the pairing is
    // approved, sends the statement that consumes it: the order two concurrent polls take when the
    // inner one wins the row lock.
    let inner: { status: string; session?: string } | undefined;
    const racingSql: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        if (!inner && text.startsWith("with approved as")) inner = await poll(handler, pairing);
        return sql.query<T>(text, params);
      },
    };

    const outer = await poll(makeHandler(() => NOW, { sql: racingSql }), pairing);

    expect(inner?.status).toBe("approved");
    expect(outer).toEqual({ status: "expired" });
    expect((await me(handler, inner!.session!)).status).toBe(200);
    expect(await pairingRow(pairing.pairId)).toMatchObject({ status: "consumed", session_token: null });
  });

  it("never gives two pending pairings the same code: a code already showing is redrawn", async () => {
    const handler = makeHandler();
    const first = await start(handler);
    // The next two 6-digit draws: the first pairing's code again, then 246810.
    const draws = [Number(first.code), 246810];
    const realGetRandomValues = crypto.getRandomValues.bind(crypto);
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((array: Uint8Array) => {
      if (array.length !== 4 || draws.length === 0) return realGetRandomValues(array);
      new DataView(array.buffer, array.byteOffset, array.byteLength).setUint32(0, draws.shift()!);
      return array;
    }) as typeof crypto.getRandomValues);
    try {
      expect((await start(handler)).code).toBe("246810");
    } finally {
      spy.mockRestore();
    }
    expect(draws).toEqual([]);
    expect((await sql.query(`select 1 from orderat.web_pairings where status = 'pending'`)).length).toBe(2);
  });

  it("pair_start and pair_poll ignore a session header and never act on the account", async () => {
    const handler = makeHandler();
    const phone = await signInPhone(handler);
    const headers = { "x-orderat-session": phone };

    const started = await handler(post({ action: "pair_start" }, headers));
    expect(started.status).toBe(200);
    const pairing = (await started.json()) as Pairing;
    const polled = await handler(post({ action: "pair_poll", pairId: pairing.pairId, pollToken: pairing.pollToken }, headers));
    expect(await polled.json()).toEqual({ status: "pending" });
    expect((await me(handler, phone)).status).toBe(200); // Account and session untouched.
  });

  it("never logs a code, a poll token or a session token", async () => {
    const entries: Record<string, unknown>[] = [];
    const handler = makeHandler(() => NOW, { log: (entry) => entries.push(entry) });
    const phone = await signInPhone(handler);
    const pairing = await start(handler);
    await approve(handler, pairing.code, phone);
    const { session } = await poll(handler, pairing);

    expect(entries.map((entry) => entry.event)).toEqual(expect.arrayContaining(["auth_pair_start", "auth_pair_approve", "auth_pair_poll"]));
    const logged = JSON.stringify(entries);
    for (const secret of [pairing.code, pairing.pollToken, session, phone]) expect(logged).not.toContain(secret);
  });

  it("writes no log line for a pending poll (the website polls every few seconds)", async () => {
    const entries: Record<string, unknown>[] = [];
    const handler = makeHandler(() => NOW, { log: (entry) => entries.push(entry) });
    const pairing = await start(handler);
    entries.length = 0;

    expect(await poll(handler, pairing)).toEqual({ status: "pending" });
    expect(entries).toEqual([]);
  });
});
