import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { sha256HexOfString } from "../shared/crypto.ts";
import { createAuthHandler } from "./handler.ts";
import { createJwksCache } from "./jwks.ts";
import { fakeJwksFetch, generateTestKeyPair, signTestToken, type TestKeyPair } from "./jwt-test-support.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const APPLE_AUD = "com.ams.orderat";
const GOOGLE_AUD = "google-client-id";

let sql: SqlClient;
let appleKeyPair: TestKeyPair;
let googleKeyPair: TestKeyPair;

function makeHandler(now: () => Date = () => NOW) {
  return createAuthHandler({
    sql,
    appleJwks: createJwksCache("https://appleid.apple.com/auth/keys", { fetchImpl: fakeJwksFetch([appleKeyPair]) }),
    googleJwks: createJwksCache("https://www.googleapis.com/oauth2/v3/certs", { fetchImpl: fakeJwksFetch([googleKeyPair]) }),
    appleAudiences: [APPLE_AUD],
    googleAudiences: [GOOGLE_AUD],
    now,
    log: () => {},
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

  it("a session from a signin with no client (a phone's) never expires", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, {});

    clock = new Date(NOW.getTime() + 400 * DAY_MS);
    expect((await me(handler, session)).status).toBe(200);
    const rows = await sql.query<{ expires_at: Date | null }>(`select expires_at from orderat.sessions`);
    expect(rows[0]!.expires_at).toBeNull();
  });

  it("client: \"app\" is a phone too: no expiry", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const session = await signInAs(handler, { client: "app", deviceName: "iPhone" });

    clock = new Date(NOW.getTime() + 400 * DAY_MS);
    expect((await me(handler, session)).status).toBe(200);
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
