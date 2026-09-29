// Proves db/migrations/0004_cloud.sql's orderat.users/sessions tables (run against a real, if WASM,
// Postgres — not just that these queries are syntactically plausible against a mock), including the
// delete-account cascade reaching all the way through shops_cloud/shop_members/records that
// server/sync/store.ts owns — this file only proves the foreign keys themselves do that job, not
// server/sync's own logic.

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { sha256HexOfString } from "../shared/crypto.ts";
import {
  approvePairing,
  createSession,
  deleteAccount,
  deleteExpiredPairings,
  findPendingPairingByCode,
  findUserById,
  insertPairing,
  newPollToken,
  newSessionToken,
  pollPairing,
  resolveSession,
  revokeSession,
  upsertUser,
  WEB_SESSION_DAYS,
} from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

let sql: SqlClient;

beforeEach(async () => {
  sql = await createCloudTestSql();
});

describe("upsertUser", () => {
  it("inserts a brand-new user the first time an identity signs in", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1", email: "a@example.com", name: "Ali" });
    expect(user).toMatchObject({ id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1", email: "a@example.com", name: "Ali" });
  });

  it("keeps the original id on a later signin, even if the caller passes a different candidate id", async () => {
    const first = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1", email: "a@example.com" });
    const second = await upsertUser(sql, { id: "22222222-2222-2222-2222-222222222222", provider: "apple", providerSub: "apple-sub-1", email: "a@example.com" });
    expect(second.id).toBe(first.id);
  });

  it("never overwrites a known name/email with a later, empty one (coalesce, not blind overwrite)", async () => {
    await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1", email: "a@example.com", name: "Ali" });
    // Apple only sends the name on the very first grant; a later signin omits it.
    const second = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    expect(second).toMatchObject({ email: "a@example.com", name: "Ali" });
  });

  it("keeps apple and google identities separate even with the same provider_sub value", async () => {
    const appleUser = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "shared-sub" });
    const googleUser = await upsertUser(sql, { id: "22222222-2222-2222-2222-222222222222", provider: "google", providerSub: "shared-sub" });
    expect(appleUser.id).not.toBe(googleUser.id);
  });
});

describe("sessions", () => {
  it("creates a session and resolves it back to its user via the raw token", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id, deviceName: "Ali's iPhone" });

    const resolved = await resolveSession(sql, token, new Date());
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.session.deviceName).toBe("Ali's iPhone");
  });

  it("never resolves an unknown token", async () => {
    expect(await resolveSession(sql, "not-a-real-token", new Date())).toBeUndefined();
  });

  it("never resolves a token differing only in a trailing character (no accidental prefix match)", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id });
    expect(await resolveSession(sql, `${token}x`, new Date())).toBeUndefined();
  });

  it("bumps last_seen_at on every successful resolution", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id });

    const later = new Date(Date.now() + 60_000);
    await resolveSession(sql, token, later);
    const rows = await sql.query<{ last_seen_at: string }>(`select last_seen_at from orderat.sessions where token_hash = $1`, [tokenHash]);
    expect(new Date(rows[0]!.last_seen_at).getTime()).toBe(later.getTime());
  });

  it("stops resolving a signed-out (revoked) session", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id });

    await revokeSession(sql, token);
    expect(await resolveSession(sql, token, new Date())).toBeUndefined();
  });

  it("revoking an already-unknown token is a harmless no-op", async () => {
    await expect(revokeSession(sql, "never-issued")).resolves.toBeUndefined();
  });

  it("stores only the SHA-256 hash of the token, never the raw value", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id });

    expect(tokenHash).toBe(await sha256HexOfString(token));
    const rows = await sql.query<{ token_hash: string }>(`select token_hash from orderat.sessions`);
    expect(rows[0]!.token_hash).toBe(tokenHash);
    expect(rows[0]!.token_hash).not.toBe(token);
  });
});

describe("session expiry (web sessions)", () => {
  const CREATED = new Date("2026-09-27T12:00:00Z");

  async function newSession(expiresAt?: Date) {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id, expiresAt });
    return { user, token, tokenHash };
  }

  it("keeps a browser session for 30 days", () => {
    expect(WEB_SESSION_DAYS).toBe(30);
  });

  it("a session created without an expiry (a phone's) never expires, however long ago it was made", async () => {
    const { user, token, tokenHash } = await newSession();

    const rows = await sql.query<{ expires_at: Date | null }>(`select expires_at from orderat.sessions where token_hash = $1`, [tokenHash]);
    expect(rows[0]!.expires_at).toBeNull();
    const resolved = await resolveSession(sql, token, new Date(CREATED.getTime() + 400 * DAY_MS));
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.session.expiresAt).toBeUndefined();
  });

  it("resolves a session until its expiry instant and not at or after it", async () => {
    const expiresAt = new Date(CREATED.getTime() + WEB_SESSION_DAYS * DAY_MS);
    const { user, token } = await newSession(expiresAt);

    const before = await resolveSession(sql, token, new Date(expiresAt.getTime() - 1));
    expect(before?.user.id).toBe(user.id);
    expect(before?.session.expiresAt).toEqual(expiresAt);
    // The instant itself already counts as expired (expires_at <= now), as does anything later.
    expect(await resolveSession(sql, token, expiresAt)).toBeUndefined();
    expect(await resolveSession(sql, token, new Date(expiresAt.getTime() + 1))).toBeUndefined();
  });

  it("does not touch last_seen_at when the session has expired", async () => {
    const expiresAt = new Date(CREATED.getTime() + WEB_SESSION_DAYS * DAY_MS);
    const { token, tokenHash } = await newSession(expiresAt);
    const seenBefore = await sql.query<{ last_seen_at: Date }>(`select last_seen_at from orderat.sessions where token_hash = $1`, [tokenHash]);

    await resolveSession(sql, token, new Date(expiresAt.getTime() + DAY_MS));

    const seenAfter = await sql.query<{ last_seen_at: Date }>(`select last_seen_at from orderat.sessions where token_hash = $1`, [tokenHash]);
    expect(new Date(seenAfter[0]!.last_seen_at).getTime()).toBe(new Date(seenBefore[0]!.last_seen_at).getTime());
  });

  it("an expired session's user and other sessions are unaffected", async () => {
    const expiresAt = new Date(CREATED.getTime() + WEB_SESSION_DAYS * DAY_MS);
    const { user, token: webToken } = await newSession(expiresAt);
    const phone = await newSessionToken();
    await createSession(sql, { tokenHash: phone.tokenHash, userId: user.id, deviceName: "iPhone" });

    const later = new Date(expiresAt.getTime() + DAY_MS);
    expect(await resolveSession(sql, webToken, later)).toBeUndefined();
    expect((await resolveSession(sql, phone.token, later))?.user.id).toBe(user.id);
    expect(await findUserById(sql, user.id)).toBeDefined();
  });
});

describe("deleteAccount", () => {
  it("removes the user and their sessions", async () => {
    const user = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1" });
    const { token, tokenHash } = await newSessionToken();
    await createSession(sql, { tokenHash, userId: user.id });

    await deleteAccount(sql, user.id);

    expect(await findUserById(sql, user.id)).toBeUndefined();
    expect(await resolveSession(sql, token, new Date())).toBeUndefined();
  });

  it("cascades to every shop the user owns, and that shop's members/invites/records", async () => {
    const owner = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "owner-sub" });
    const staff = await upsertUser(sql, { id: "22222222-2222-2222-2222-222222222222", provider: "google", providerSub: "staff-sub" });
    const shopId = "33333333-3333-3333-3333-333333333333";

    await sql.query(`insert into orderat.shops_cloud (id, owner_user_id, name) values ($1, $2, 'Sara''s Cakes')`, [shopId, owner.id]);
    await sql.query(`insert into orderat.shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [shopId, owner.id]);
    await sql.query(`insert into orderat.shop_members (shop_id, user_id, role) values ($1, $2, 'staff')`, [shopId, staff.id]);
    await sql.query(`insert into orderat.invites (id, shop_id, code_hash, expires_at) values ('44444444-4444-4444-4444-444444444444', $1, 'somehash', now() + interval '48 hours')`, [shopId]);
    await sql.query(`insert into orderat.records (shop_id, entity, id, data) values ($1, 'order', 'order-1', '{}'::jsonb)`, [shopId]);

    await deleteAccount(sql, owner.id);

    expect((await sql.query(`select 1 from orderat.shops_cloud where id = $1`, [shopId])).length).toBe(0);
    expect((await sql.query(`select 1 from orderat.shop_members where shop_id = $1`, [shopId])).length).toBe(0);
    expect((await sql.query(`select 1 from orderat.invites where shop_id = $1`, [shopId])).length).toBe(0);
    expect((await sql.query(`select 1 from orderat.records where shop_id = $1`, [shopId])).length).toBe(0);
    // The staff member's own account is untouched — only their membership in the deleted owner's shop.
    expect(await findUserById(sql, staff.id)).toBeDefined();
  });

  it("removes a staff member's own account without touching a shop they don't own", async () => {
    const owner = await upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "owner-sub" });
    const staff = await upsertUser(sql, { id: "22222222-2222-2222-2222-222222222222", provider: "google", providerSub: "staff-sub" });
    const shopId = "33333333-3333-3333-3333-333333333333";
    await sql.query(`insert into orderat.shops_cloud (id, owner_user_id, name) values ($1, $2, 'Sara''s Cakes')`, [shopId, owner.id]);
    await sql.query(`insert into orderat.shop_members (shop_id, user_id, role) values ($1, $2, 'staff')`, [shopId, staff.id]);

    await deleteAccount(sql, staff.id);

    expect((await sql.query(`select 1 from orderat.shops_cloud where id = $1`, [shopId])).length).toBe(1);
    expect((await sql.query(`select 1 from orderat.shop_members where shop_id = $1 and user_id = $2`, [shopId, staff.id])).length).toBe(0);
  });

  it("deleting an unknown user id is a harmless no-op", async () => {
    await expect(deleteAccount(sql, "99999999-9999-9999-9999-999999999999")).resolves.toBeUndefined();
  });
});

// Phone-to-web login (db/migrations/0006_web_pairing.sql's orderat.web_pairings): the website starts a
// pairing, the signed-in phone approves its code, the website polls until it collects its session.
describe("web pairings", () => {
  const T0 = new Date("2026-09-29T12:00:00Z");
  const MINUTE_MS = 60 * 1000;
  const EXPIRES_AT = new Date(T0.getTime() + 5 * MINUTE_MS);
  const PAIR_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const OTHER_PAIR_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const RAW_SESSION = "raw-web-session-token";

  async function phoneUser() {
    return upsertUser(sql, { id: "11111111-1111-1111-1111-111111111111", provider: "apple", providerSub: "apple-sub-1", email: "seller@example.com" });
  }

  async function startPairing(id = PAIR_ID, code = "123456", expiresAt = EXPIRES_AT) {
    const { pollToken, pollHash } = await newPollToken();
    const inserted = await insertPairing(sql, { id, code, pollHash, expiresAt });
    return { pollToken, pollHash, inserted };
  }

  async function pairingRow(id = PAIR_ID) {
    const rows = await sql.query<Record<string, unknown>>(`select * from orderat.web_pairings where id = $1`, [id]);
    return rows[0];
  }

  it("mints a poll token of 32 random bytes, base64url, with its SHA-256 hex", async () => {
    const { pollToken, pollHash } = await newPollToken();
    expect(pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pollHash).toBe(await sha256HexOfString(pollToken));
    expect((await newPollToken()).pollToken).not.toBe(pollToken);
  });

  it("inserts a pending pairing that stores only the poll token's hash", async () => {
    const { pollToken, pollHash, inserted } = await startPairing();

    expect(inserted).toBe(true);
    const row = await pairingRow();
    expect(row).toMatchObject({ id: PAIR_ID, code: "123456", poll_hash: pollHash, status: "pending", user_id: null, session_token: null, approved_at: null });
    expect(new Date(row!.expires_at as Date).toISOString()).toBe("2026-09-29T12:05:00.000Z");
    expect(JSON.stringify(row)).not.toContain(pollToken);
  });

  it("refuses a second pending pairing with the same code, and allows the code again once the first is no longer pending", async () => {
    const user = await phoneUser();
    await startPairing(PAIR_ID, "123456");

    expect((await startPairing(OTHER_PAIR_ID, "123456")).inserted).toBe(false);
    expect(await pairingRow(OTHER_PAIR_ID)).toBeUndefined();

    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });
    expect((await startPairing(OTHER_PAIR_ID, "123456")).inserted).toBe(true);
  });

  it("finds a pending pairing by its code only until it expires", async () => {
    await startPairing(PAIR_ID, "123456");

    expect(await findPendingPairingByCode(sql, "123456", T0)).toEqual({ id: PAIR_ID });
    expect(await findPendingPairingByCode(sql, "654321", T0)).toBeUndefined();
    expect(await findPendingPairingByCode(sql, "123456", new Date(EXPIRES_AT.getTime() - 1))).toEqual({ id: PAIR_ID });
    expect(await findPendingPairingByCode(sql, "123456", EXPIRES_AT)).toBeUndefined();
  });

  it("no longer finds a pairing by its code once it is approved", async () => {
    const user = await phoneUser();
    await startPairing(PAIR_ID, "123456");
    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

    expect(await findPendingPairingByCode(sql, "123456", T0)).toBeUndefined();
  });

  it("approves a pending pairing for the phone's user, holding the raw session token for the website", async () => {
    const user = await phoneUser();
    await startPairing();
    const approvedAt = new Date(T0.getTime() + MINUTE_MS);

    expect(await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: approvedAt })).toBe(true);

    const row = await pairingRow();
    expect(row).toMatchObject({ status: "approved", user_id: user.id, session_token: RAW_SESSION });
    expect(new Date(row!.approved_at as Date).toISOString()).toBe(approvedAt.toISOString());
  });

  it("approves a pairing only once, and never after it expires", async () => {
    const user = await phoneUser();
    await startPairing(PAIR_ID, "123456");
    await startPairing(OTHER_PAIR_ID, "654321");

    expect(await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 })).toBe(true);
    expect(await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: "another-token", now: T0 })).toBe(false);
    expect((await pairingRow(PAIR_ID))!.session_token).toBe(RAW_SESSION);

    expect(await approvePairing(sql, { id: OTHER_PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: EXPIRES_AT })).toBe(false);
    expect((await pairingRow(OTHER_PAIR_ID))!.status).toBe("pending");
  });

  describe("pollPairing", () => {
    it("is pending until the phone approves", async () => {
      const { pollToken } = await startPairing();
      expect(await pollPairing(sql, PAIR_ID, pollToken, T0)).toEqual({ status: "pending" });
    });

    it("hands an approved pairing's session token and user out once, clearing the token from the row", async () => {
      const user = await phoneUser();
      const { pollToken } = await startPairing();
      await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

      const first = await pollPairing(sql, PAIR_ID, pollToken, T0);
      expect(first).toEqual({ status: "approved", sessionToken: RAW_SESSION, user: expect.objectContaining({ id: user.id, provider: "apple", email: "seller@example.com" }) });
      expect(await pairingRow()).toMatchObject({ status: "consumed", session_token: null });

      expect(await pollPairing(sql, PAIR_ID, pollToken, T0)).toEqual({ status: "expired" });
    });

    it("answers expired for a wrong poll token without handing out the session", async () => {
      const user = await phoneUser();
      await startPairing();
      await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });
      const { pollToken: someoneElses } = await newPollToken();

      expect(await pollPairing(sql, PAIR_ID, someoneElses, T0)).toEqual({ status: "expired" });
      expect(await pairingRow()).toMatchObject({ status: "approved", session_token: RAW_SESSION });
    });

    it("answers expired for an unknown pairing", async () => {
      const { pollToken } = await startPairing();
      expect(await pollPairing(sql, OTHER_PAIR_ID, pollToken, T0)).toEqual({ status: "expired" });
    });

    it("answers expired from the pairing's expiry instant on, approved or not", async () => {
      const user = await phoneUser();
      const pending = await startPairing(PAIR_ID, "123456");
      const approved = await startPairing(OTHER_PAIR_ID, "654321");
      await approvePairing(sql, { id: OTHER_PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

      expect(await pollPairing(sql, PAIR_ID, pending.pollToken, new Date(EXPIRES_AT.getTime() - 1))).toEqual({ status: "pending" });
      expect(await pollPairing(sql, PAIR_ID, pending.pollToken, EXPIRES_AT)).toEqual({ status: "expired" });
      expect(await pollPairing(sql, OTHER_PAIR_ID, approved.pollToken, EXPIRES_AT)).toEqual({ status: "expired" });
      expect((await pairingRow(OTHER_PAIR_ID))!.status).toBe("approved"); // Not handed out.
    });
  });

  it("deletes every pairing whose five minutes are up, approved ones with their raw session token included", async () => {
    const user = await phoneUser();
    await startPairing(PAIR_ID, "123456", EXPIRES_AT);
    await startPairing(OTHER_PAIR_ID, "654321", new Date(EXPIRES_AT.getTime() + MINUTE_MS));
    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

    await deleteExpiredPairings(sql, new Date(EXPIRES_AT.getTime() - 1));
    expect(await pairingRow(PAIR_ID)).toBeDefined();

    await deleteExpiredPairings(sql, EXPIRES_AT);
    expect(await pairingRow(PAIR_ID)).toBeUndefined();
    expect(await pairingRow(OTHER_PAIR_ID)).toBeDefined();
  });

  it("gives a pairing approved in its last minute a minute from the approval for the website to collect it", async () => {
    const user = await phoneUser();
    await startPairing();
    const lastSecond = new Date(EXPIRES_AT.getTime() - 1000);

    expect(await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: lastSecond })).toBe(true);

    expect(new Date((await pairingRow())!.expires_at as Date).toISOString()).toBe("2026-09-29T12:05:59.000Z");
  });

  it("keeps a pairing's own expiry when it is approved with more than a minute left", async () => {
    const user = await phoneUser();
    await startPairing();
    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

    expect(new Date((await pairingRow())!.expires_at as Date).toISOString()).toBe(EXPIRES_AT.toISOString());
  });

  it("revokes the session of an expired pairing nobody collected, and leaves a collected pairing's session alone", async () => {
    const user = await phoneUser();
    const uncollected = await newSessionToken();
    const collected = await newSessionToken();
    await createSession(sql, { tokenHash: uncollected.tokenHash, userId: user.id, deviceName: "Web (paired)" });
    await createSession(sql, { tokenHash: collected.tokenHash, userId: user.id, deviceName: "Web (paired)" });
    await startPairing(PAIR_ID, "123456");
    const other = await startPairing(OTHER_PAIR_ID, "654321");
    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: uncollected.token, now: T0 });
    await approvePairing(sql, { id: OTHER_PAIR_ID, userId: user.id, sessionToken: collected.token, now: T0 });
    expect((await pollPairing(sql, OTHER_PAIR_ID, other.pollToken, T0)).status).toBe("approved");

    await deleteExpiredPairings(sql, EXPIRES_AT);

    expect(await resolveSession(sql, uncollected.token, EXPIRES_AT)).toBeUndefined();
    expect((await resolveSession(sql, collected.token, EXPIRES_AT))?.user.id).toBe(user.id);
  });

  it("finds the expired pairings it deletes through web_pairings_expires_at_idx", async () => {
    const sent: { text: string; params?: unknown[] }[] = [];
    const recording: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        sent.push({ text, params });
        return sql.query<T>(text, params);
      },
    };
    await deleteExpiredPairings(recording, EXPIRES_AT);
    const cleanup = sent.find(({ text }) => text.startsWith("delete from orderat.web_pairings"));
    expect(cleanup).toBeDefined();

    // With sequential scans priced out, the plan shows whether the query can use the index at all.
    await sql.query(`set enable_seqscan = off`);
    try {
      const plan = await sql.query<{ "QUERY PLAN": string }>(`explain ${cleanup!.text}`, cleanup!.params);
      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("web_pairings_expires_at_idx");
    } finally {
      await sql.query(`reset enable_seqscan`);
    }
  });

  it("deleting the approving user's account deletes the pairing with it", async () => {
    const user = await phoneUser();
    await startPairing();
    await approvePairing(sql, { id: PAIR_ID, userId: user.id, sessionToken: RAW_SESSION, now: T0 });

    await deleteAccount(sql, user.id);

    expect(await pairingRow()).toBeUndefined();
  });
});
