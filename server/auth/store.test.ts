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
  createSession,
  deleteAccount,
  findUserById,
  newSessionToken,
  resolveSession,
  revokeSession,
  upsertUser,
} from "./store.ts";

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
