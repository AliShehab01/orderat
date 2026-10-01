// Security review 1 Oct 2026, F02: the AI functions' daily limits were keyed by the body's own
// installId and scaled by its own demo flag, so a script could reset them by sending a new installId
// (and claim the paid quota with demo=false). These are the limits a client cannot reset: per client IP
// for calls without a signed-in session (stricter still when they claim demo=false), and per account
// for calls with one — against db/migrations/0009_ai_trusted_limits.sql in a real (if WASM) Postgres.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createSession, newSessionToken, revokeSession, upsertUser } from "../auth/store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import { hashClientIp } from "../shared/crypto.ts";
import { checkCallerQuota, identifyAiCaller, incrementAccountUsage, incrementIpUsage, type AiCaller, type CallerLimits } from "./trusted-limits.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = "2026-10-01";
const SALT = "test-ip-salt";
const USER_ID = "11111111-1111-1111-1111-111111111111";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/orderat-studio", { method: "POST", headers });
}

async function signedIn(): Promise<string> {
  await upsertUser(sql, { id: USER_ID, provider: "apple", providerSub: "apple-sub-1" });
  const { token, tokenHash } = await newSessionToken();
  await createSession(sql, { tokenHash, userId: USER_ID, now: NOW });
  return token;
}

describe("identifyAiCaller", () => {
  it("without a session: anonymous, keyed by the salted hash of the client IP, never the IP itself", async () => {
    const caller = await identifyAiCaller(sql, request({ "x-forwarded-for": "203.0.113.7" }), { ipSalt: SALT, now: NOW });
    expect(caller).toEqual({ kind: "anonymous", ipHash: await hashClientIp(request({ "x-forwarded-for": "203.0.113.7" }), SALT) });
    expect(JSON.stringify(caller)).not.toContain("203.0.113.7");
  });

  it("with a valid X-Orderat-Session: the account", async () => {
    const token = await signedIn();
    expect(await identifyAiCaller(sql, request({ "x-orderat-session": token, "x-forwarded-for": "203.0.113.7" }), { ipSalt: SALT, now: NOW })).toEqual({ kind: "account", userId: USER_ID });
  });

  it("with an unknown, revoked or idle session: anonymous by IP, never an error (the call still works)", async () => {
    const token = await signedIn();
    const anonymous = { kind: "anonymous", ipHash: await hashClientIp(request(), SALT) };
    expect(await identifyAiCaller(sql, request({ "x-orderat-session": "not-a-session" }), { ipSalt: SALT, now: NOW })).toEqual(anonymous);
    expect(await identifyAiCaller(sql, request({ "x-orderat-session": token }), { ipSalt: SALT, now: new Date(NOW.getTime() + 181 * 86_400_000) })).toEqual(anonymous);
    const other = await newSessionToken();
    await createSession(sql, { tokenHash: other.tokenHash, userId: USER_ID, now: NOW });
    await revokeSession(sql, other.token);
    expect(await identifyAiCaller(sql, request({ "x-orderat-session": other.token }), { ipSalt: SALT, now: NOW })).toEqual(anonymous);
  });
});

describe("incrementIpUsage / incrementAccountUsage (migration 0009)", () => {
  it("counts per feature, bucket, IP hash and day, each on its own", async () => {
    expect(await incrementIpUsage(sql, "caption", "all", "ip-a", DAY)).toBe(1);
    expect(await incrementIpUsage(sql, "caption", "all", "ip-a", DAY)).toBe(2);
    expect(await incrementIpUsage(sql, "caption", "paid_claim", "ip-a", DAY)).toBe(1);
    expect(await incrementIpUsage(sql, "photo", "all", "ip-a", DAY)).toBe(1);
    expect(await incrementIpUsage(sql, "caption", "all", "ip-b", DAY)).toBe(1);
    expect(await incrementIpUsage(sql, "caption", "all", "ip-a", "2026-10-02")).toBe(1);
  });

  it("counts per feature, account and day", async () => {
    await upsertUser(sql, { id: USER_ID, provider: "apple", providerSub: "apple-sub-1" });
    expect(await incrementAccountUsage(sql, "ask", USER_ID, DAY)).toBe(1);
    expect(await incrementAccountUsage(sql, "ask", USER_ID, DAY)).toBe(2);
    expect(await incrementAccountUsage(sql, "parse", USER_ID, DAY)).toBe(1);
  });

  it("never loses an increment under concurrent calls", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => incrementIpUsage(sql, "parse", "all", "ip-a", DAY)));
    expect(results.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("checkCallerQuota", () => {
  const limits: CallerLimits = { perInstall: 5, perInstallDemo: 2, perIp: 6, perIpPaidClaim: 3 };
  const ipA: AiCaller = { kind: "anonymous", ipHash: "ip-a" };
  const ipB: AiCaller = { kind: "anonymous", ipHash: "ip-b" };
  const account: AiCaller = { kind: "account", userId: USER_ID };

  // The app's own per-install counter, a fresh installId on every call: the reset trick F02 describes.
  let installs: Map<string, number>;
  let next = 0;
  const freshInstall = () => {
    const id = `install-${next++}`;
    return async () => {
      const count = (installs.get(id) ?? 0) + 1;
      installs.set(id, count);
      return count;
    };
  };
  const call = (caller: AiCaller, demo: boolean, incrementInstall = freshInstall()) =>
    checkCallerQuota(sql, { feature: "caption", caller, demo, day: DAY, limits, incrementInstall });

  beforeEach(async () => {
    installs = new Map();
    await upsertUser(sql, { id: USER_ID, provider: "apple", providerSub: "apple-sub-1" });
  });

  it("a new installId on every call cannot get past the client IP's daily cap", async () => {
    for (let i = 0; i < 6; i++) expect((await call(ipA, true)).ok).toBe(true);
    expect(await call(ipA, true)).toEqual({ ok: false });
    expect(await call(ipA, true)).toEqual({ ok: false });
  });

  it("claiming demo=false without a session gets the stricter per-IP cap, whatever the installId", async () => {
    for (let i = 0; i < 3; i++) expect((await call(ipA, false)).ok).toBe(true);
    expect(await call(ipA, false)).toEqual({ ok: false });
    // The IP's overall budget still has room for demo calls: 4 of 6 are spent (the refused one counts).
    expect((await call(ipA, true)).ok).toBe(true);
    expect((await call(ipA, true)).ok).toBe(true);
    expect(await call(ipA, true)).toEqual({ ok: false });
  });

  it("another IP has its own counters", async () => {
    for (let i = 0; i < 6; i++) await call(ipA, true);
    expect(await call(ipA, true)).toEqual({ ok: false });
    expect((await call(ipB, true)).ok).toBe(true);
  });

  it("still applies the per-install limit to an anonymous call (the app's own remaining count)", async () => {
    const sameInstall = freshInstall();
    expect(await call(ipA, true, sameInstall)).toEqual({ ok: true, remaining: 1 });
    expect(await call(ipA, true, sameInstall)).toEqual({ ok: true, remaining: 0 });
    expect(await call(ipA, true, sameInstall)).toEqual({ ok: false });
  });

  it("reports the tightest remaining count of the counters that apply", async () => {
    // demo=false: install 5, IP 6, paid claim 3 → paid claim is tightest.
    expect(await call(ipA, false)).toEqual({ ok: true, remaining: 2 });
    // demo=true, fresh install: install 2-1=1, IP 6-2=4 → install is tightest.
    expect(await call(ipA, true)).toEqual({ ok: true, remaining: 1 });
  });

  it("a signed-in account is limited per account instead: new installIds and other IPs do not reset it", async () => {
    for (let i = 0; i < 5; i++) expect(await call(account, false)).toEqual({ ok: true, remaining: 4 - i });
    expect(await call(account, false)).toEqual({ ok: false });
    // The account's calls never touched any install or IP counter.
    expect(installs.size).toBe(0);
    expect(await incrementIpUsage(sql, "caption", "all", "ip-a", DAY)).toBe(1);
  });

  it("a signed-in account's demo call gets the demo quota, counted on the same account", async () => {
    expect(await call(account, true)).toEqual({ ok: true, remaining: 1 });
    expect(await call(account, true)).toEqual({ ok: true, remaining: 0 });
    expect(await call(account, true)).toEqual({ ok: false });
  });
});
