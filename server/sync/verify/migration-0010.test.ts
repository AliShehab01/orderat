// Final verification, task 2: migration db/migrations/0010_order_stock.sql on a database shaped like production.
//
//  - The roles are production's: a NON-superuser migration role (Supabase's "postgres" is not a superuser: it holds the
//    orderat_app membership with SET, which is what 0001 grants), the app role `orderat_app` (the one the server connects as,
//    through the pooler), and Supabase's own anon / authenticated / service_role, so the `if exists (... 'anon')` branches of 0010
//    run for real (the shared test database has neither a non-superuser migrator nor those roles, so they never ran there).
//  - Every migration is applied the way scripts/hosting-migrate.mjs applies it: wrapped in begin ... insert into
//    schema_migrations ... commit, one file at a time, by the migration role.
//  - The database is filled through the OLD code path: the frozen copy of the server deployed before today's rounds
//    (old-server/, = origin/main c07cc28) served by the iOS 1.0 phones of phone.ts, plus staff phones, hand-made rows (moves with
//    no id), tombstones, orders in every status and a product whose list is at the 50 cap.
//  - Then 0010 runs (twice), and the NEW server, connecting as orderat_app, serves the old and the new clients on that data.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { createSyncHandler } from "../handler.ts";
import { moveKey } from "../stock-merge.ts";
import { Fleet, type J } from "./fleet.ts";
import { createSyncHandler as createOldSyncHandler } from "./old-server/handler.ts";
import { SimPhone, type RoundReport } from "./phone.ts";
import { seedLocalShop, type SeededShop } from "./seed.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db", "migrations");
const FILES = [
  "0001_orderat_isolation.sql", "0002_ai_usage.sql", "0003_marketing.sql", "0004_cloud.sql", "0005_web_sessions.sql",
  "0006_web_pairing.sql", "0007_apple_tokens.sql", "0008_shop_payment_methods.sql", "0009_ai_trusted_limits.sql", "0010_order_stock.sql",
];
const file = (name: string) => readFileSync(join(DIR, name), "utf8");

let db: InstanceType<typeof PGlite>;
let sql: SqlClient;

/** The migration role runs the file inside begin/commit with the bookkeeping insert, as hosting-migrate.mjs wraps it. */
async function applyMigration(name: string): Promise<void> {
  await db.exec("reset role");
  await db.exec("set role migrator");
  try {
    await db.exec(`begin;\n${file(name)}\ninsert into orderat.schema_migrations (filename) values ('${name}') on conflict (filename) do nothing;\ncommit;\n`);
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  } finally {
    await db.exec("reset role");
    await db.exec("set role orderat_app"); // the server connects as this role
  }
}

const q = async <T = J>(text: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(text, params)).rows;
/** Superuser view of the catalogs (the server role cannot see everything). */
async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  try {
    return await fn();
  } finally {
    await db.exec("set role orderat_app");
  }
}

const recordsDump = async (): Promise<string> =>
  JSON.stringify(
    (await q<J>(`select shop_id, entity, id, seq::text as seq, data, deleted, updated_by, updated_at from orderat.records order by shop_id, entity, id`)).map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() })),
  );
const stockOpIds = async (): Promise<string[]> => (await q<{ op_id: string }>(`select op_id from orderat.stock_ops order by op_id`)).map((r) => r.op_id);

/** What the runtime computes for every move of every product record's stored list: the keys 0010 must have listed. */
async function expectedListedKeys(): Promise<string[]> {
  const keys = new Set<string>();
  for (const r of await q<{ data: J }>(`select data from orderat.records where entity = 'product'`)) {
    for (const move of Array.isArray(r.data.stockMoves) ? (r.data.stockMoves as unknown[]) : []) {
      if (typeof move !== "object" || move === null || Array.isArray(move)) continue;
      const key = moveKey(move as J);
      if (key.length <= 600) keys.add(key);
    }
  }
  return [...keys].sort();
}

const expectClean = (label: string, r: RoundReport) => {
  expect(r.ok, `${label}: failed ${r.failedStatus}`).toBe(true);
  expect(r.rejected, `${label}: rejected`).toEqual([]);
  expect(r.conflicts, `${label}: conflicts`).toEqual([]);
};

let fleet: Fleet;
let owner: { userId: string; session: string };
let shop: SeededShop;
let A: SimPhone; // iOS 1.0, the owner's phone that uploaded the shop
let B: SimPhone; // iOS 1.0, the owner's second phone
let C: SimPhone; // iOS 1.0, a phone that was last online BEFORE the migration and comes back after it, holding old snapshots
let Z: string; // a product with quantity 100 and 50 historical moves that the old server then keeps writing orders on (its oldest moves are trimmed before the migration)
let Y: string; // a product with quantity 100 and 50 historical moves that nothing touches before the migration (the R4 acceptance)
let zOrderPre: string; // an order on Z confirmed before the migration
const snapshotBefore: { records?: string; opsBefore?: string[] } = {};
const OLD_CONFIRMED: { cake?: string } = {};
/** What C's first push after the migration did to Z (a product the old server kept writing after C's snapshot): the documented limit. */
const limit: { before?: number; after?: number } = {};

beforeAll(async () => {
  db = new PGlite();
  // Supabase's roles exist in production; the migration role is not a superuser.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role migrator createrole; grant create on database postgres to migrator;
  `);
  for (const name of FILES.slice(0, 9)) {
    // 0001 creates orderat_app, so the role switch below can only happen after it.
    await db.exec("reset role");
    await db.exec("set role migrator");
    await db.exec(`begin;\n${file(name)}\ninsert into orderat.schema_migrations (filename) values ('${name}') on conflict (filename) do nothing;\ncommit;\n`);
    await db.exec("reset role");
  }
  await db.exec("set role orderat_app");
  sql = {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await db.query<T>(text, params)).rows;
    },
  };

  // ---- the OLD server serves yesterday's shop
  fleet = new Fleet(sql);
  fleet.useHandler(createOldSyncHandler);
  owner = await fleet.newUser("owner");
  A = new SimPhone(fleet, owner.session, "ios1", "A");
  B = new SimPhone(fleet, owner.session, "ios1", "B");
  C = new SimPhone(fleet, owner.session, "ios1", "C");
  shop = seedLocalShop(A);
  Z = A.createProduct({ name: "Zaatar bread", priceMinor: 500, costMinor: 150, track: true, stock: 0, low: 5 });
  for (let i = 0; i < 50; i++) A.adjustStockManually(Z, 2, "received", `delivery ${i}`); // quantity 100, 50 moves
  expect(A.get("product", Z).stockQuantity).toBe(100);
  expect(A.get("product", Z).stockMoves).toHaveLength(50);
  Y = A.createProduct({ name: "Yogurt cup", priceMinor: 400, costMinor: 100, track: true, stock: 0, low: 5 });
  for (let i = 0; i < 50; i++) A.adjustStockManually(Y, 2, "received", `crate ${i}`); // quantity 100, 50 moves
  expect(A.get("product", Y).stockQuantity).toBe(100);
  await fleet.createShop(owner.session);
  A.attach();
  expectClean("old upload", await A.sync());
  B.cloudOn = true;
  C.cloudOn = true;
  expectClean("old restore B", await B.sync());
  expectClean("old restore C", await C.sync());

  // a day of use on the old server: orders in every status, payments, edits, a cancelled order
  const day = A.createOrder({ customerId: shop.customers[0]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 2, priceMinor: 6500 }, { productId: Z, name: "Zaatar bread", qty: 4, priceMinor: 500 }] });
  A.setStatus(day, "confirmed");
  zOrderPre = A.createOrder({ customerId: shop.customers[1]!, lines: [{ productId: Z, name: "Zaatar bread", qty: 6, priceMinor: 500 }] });
  A.setStatus(zOrderPre, "confirmed");
  A.recordPayment(day, 4000);
  const gone = A.recordPayment(day, 1000);
  A.removePayment(day, gone);
  OLD_CONFIRMED.cake = day;
  expectClean("old day", await A.sync());
  expectClean("old day B", await B.sync());
  B.setStatus(shop.orders.confirmedDeposit!, "cancelled");
  B.editItems(shop.orders.edited!, [{ productId: shop.products.cookie, name: "Cookies box", qty: 1, priceMinor: 2500 }]);
  expectClean("old day B pushes", await B.sync());
  expectClean("old day A pulls", await A.sync());

  // staff on the old server: a prepare phone confirms an order, a money phone records a payment
  const prepare = await fleet.addStaff(owner.session, "prep", { orders: false, prepare: true, money: false, products: false });
  const money = await fleet.addStaff(owner.session, "money", { orders: false, prepare: false, money: true, products: false });
  const P = new SimPhone(fleet, prepare.session, "ios1", "P");
  const M = new SimPhone(fleet, money.session, "ios1", "M");
  P.cloudOn = true;
  M.cloudOn = true;
  expectClean("old staff P restore", await P.sync());
  expectClean("old staff M restore", await M.sync());
  const staffOrder = A.createOrder({ customerId: shop.customers[2]!, lines: [{ productId: shop.products.tart, name: "Lemon tart", qty: 2, priceMinor: 4000 }] });
  expectClean("old staff order", await A.sync());
  expectClean("old P pulls", await P.sync());
  expectClean("old M pulls", await M.sync());
  P.setStatus(staffOrder, "confirmed");
  expectClean("old P confirms", await P.sync());
  expectClean("old M pulls the confirm", await M.sync());
  M.recordPayment(staffOrder, 3000);
  expectClean("old M pays", await M.sync());

  // hand-made rows the old server also holds: a legacy Android product whose moves have no id, and tombstones
  const legacy = await fleet.call(owner.session, {
    action: "sync", shopId: fleet.shopId, cursor: 0,
    changes: [
      { entity: "product", id: "legacy-android-product", baseSeq: 0, deleted: false, data: { nameAr: "قديم", priceMinor: 900, trackStock: true, stockQuantity: 7, lowStockThreshold: 1, createdAt: fleet.now(), stockMoves: [
        { delta: -2, reason: "orderConfirmed", orderId: staffOrder, note: null, at: "2026-09-30T10:00:00.000Z" },
        { delta: 9, reason: "received", orderId: null, note: null, at: "2026-09-29T10:00:00.000Z" },
        { id: "LegacyUpperId-1", delta: 1, reason: "correction", orderId: null, note: null, at: "2026-09-28T10:00:00.000Z" },
      ] } },
      { entity: "product", id: "deleted-product", baseSeq: 0, deleted: true, data: { nameAr: "محذوف", stockQuantity: 3, stockMoves: [{ id: "move-in-a-deleted-product", delta: 3, reason: "received", orderId: null, note: null, at: "2026-09-27T10:00:00.000Z" }] } },
      { entity: "customer", id: "deleted-customer", baseSeq: 0, deleted: true, data: { name: "x", phone: "1" } },
      { entity: "order", id: "deleted-order", baseSeq: 0, deleted: true, data: { status: "cancelled", items: [], payments: [], changes: [] } },
    ],
  });
  expect(legacy.status).toBe(200);
  expect(legacy.json.rejected).toEqual([]);

  // C goes offline here, holding Z and Y at 100 with their 50 moves each
  C.online = false;
  expect(C.get("product", Z).stockQuantity).toBe(100);
  expect(C.get("product", Y).stockQuantity).toBe(100);

  snapshotBefore.records = await recordsDump();
});

afterAll(async () => {
  await db?.close();
});

describe("migration 0010 / applying it to a production-shaped database", () => {
  it("the database before it has exactly 0001-0009 and none of 0010's objects", async () => {
    const applied = (await asAdmin(() => q<{ filename: string }>(`select filename from orderat.schema_migrations order by filename`))).map((r) => r.filename);
    expect(applied).toEqual(FILES.slice(0, 9));
    expect(await asAdmin(() => q(`select to_regclass('orderat.stock_ops') as t, to_regclass('orderat.order_stock') as o`))).toEqual([{ t: null, o: null }]);
    // The data really is a production-shaped mix: every status, a product at the cap, moves without ids, tombstones.
    const orders = await q<{ status: string }>(`select data->>'status' as status from orderat.records where entity = 'order' and not deleted`);
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(["newOrder", "confirmed", "ready", "collected", "cancelled"]));
    expect(Number((await q<{ n: number }>(`select count(*) as n from orderat.records where deleted`))[0]!.n)).toBe(3);
    expect((await q<{ data: J }>(`select data from orderat.records where entity = 'product' and id = 'legacy-android-product'`))[0]!.data.stockMoves.filter((m: J) => m.id === undefined)).toHaveLength(2);
  });

  it("the old server and the migration role cannot step on each other: 0010 applies as the NON-superuser migration role, in its transaction wrapper", async () => {
    await applyMigration(FILES[9]!);
    const applied = (await asAdmin(() => q<{ filename: string }>(`select filename from orderat.schema_migrations order by filename`))).map((r) => r.filename);
    expect(applied).toEqual(FILES);
    expect(await recordsDump(), "the migration left every record exactly as it was (data, seq, updated_at, deleted)").toBe(snapshotBefore.records);
  });

  it("stock_ops holds exactly the keys the runtime computes for every move in every stored list (with ids, uppercase ids, no id, tombstoned products)", async () => {
    const expected = await expectedListedKeys();
    expect(expected.length).toBeGreaterThan(60);
    expect(await stockOpIds()).toEqual(expected);
    expect(expected).toContain("id:legacyupperid-1"); // the uppercase id, folded
    expect(expected.some((k) => k.startsWith("f:["))).toBe(true); // the moves with no id
    expect(expected).toContain("id:move-in-a-deleted-product");
    const outcomes = await q<{ outcome: string }>(`select distinct outcome from orderat.stock_ops`);
    expect(outcomes).toEqual([{ outcome: "listed" }]);
    expect(Number((await q<{ n: number }>(`select count(*) as n from orderat.order_stock`))[0]!.n)).toBe(0);
    snapshotBefore.opsBefore = await stockOpIds();
  });

  it("running 0010 a second time (the migration is idempotent) changes nothing and raises nothing", async () => {
    await applyMigration(FILES[9]!);
    expect(await stockOpIds()).toEqual(snapshotBefore.opsBefore);
    expect(await recordsDump()).toBe(snapshotBefore.records);
    expect(Number((await q<{ n: number }>(`select count(*) as n from orderat.order_stock`))[0]!.n)).toBe(0);
    // The bookkeeping insert is "on conflict do nothing": still one row for 0010.
    expect(Number((await asAdmin(() => q<{ n: number }>(`select count(*) as n from orderat.schema_migrations where filename = '0010_order_stock.sql'`)))[0]!.n)).toBe(1);
  });

  it("ownership and privileges: the tables belong to orderat_app, RLS is on, only orderat_app may execute the functions, anon and authenticated may do nothing", async () => {
    const tables = await asAdmin(() => q<J>(`select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'orderat' and c.relname in ('order_stock', 'stock_ops') order by 1`));
    expect(tables).toEqual([{ relname: "order_stock", owner: "orderat_app", rls: true }, { relname: "stock_ops", owner: "orderat_app", rls: true }]);
    const functions = await asAdmin(() => q<J>(`
      select p.proname, p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner,
             has_function_privilege('orderat_app', p.oid, 'execute') as app,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'orderat' and p.proname in ('sync_apply', 'apply_stock_effect', 'claim_invite', 'stock_move_key', 'stock_move_key_token', 'record_listed_moves')
       order by 1`));
    expect(functions.map((f) => f.proname)).toEqual(["apply_stock_effect", "claim_invite", "record_listed_moves", "stock_move_key", "stock_move_key_token", "sync_apply"]);
    for (const f of functions) {
      expect(f, `${f.proname} runs as the caller (SECURITY INVOKER)`).toMatchObject({ definer: false, app: true, anon: false, auth: false, public_exec: 0 });
    }
    const tablePrivileges = await asAdmin(() => q<J>(`select has_table_privilege('anon', 'orderat.stock_ops', 'select') as anon_select, has_table_privilege('authenticated', 'orderat.order_stock', 'select') as auth_select`));
    expect(tablePrivileges).toEqual([{ anon_select: false, auth_select: false }]);
  });

  it("the app role can really run them: every function called as orderat_app, the way the server calls it", async () => {
    expect((await q<J>(`select current_user as u`))[0]!.u).toBe("orderat_app");
    expect((await q<J>(`select orderat.stock_move_key('{"id":"AbC"}'::jsonb) as k`))[0]!.k).toBe("id:abc");
    expect((await q<J>(`select orderat.apply_stock_effect('{"stockQuantity": 5}'::jsonb, -2, '{"id":"m"}'::jsonb) as d`))[0]!.d).toEqual({ stockQuantity: 3, stockMoves: [{ id: "m" }] });
    const nothing = await q(`select * from orderat.sync_apply($1::uuid, $2::uuid, $3::text::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [fleet.shopId, owner.userId, JSON.stringify({ entity: "order", id: "does-not-exist", expect_seq: 5, data: {}, deleted: false })]);
    expect(nothing).toEqual([]); // a stale expectation writes nothing and returns no row
    expect((await q<J>(`select orderat.claim_invite('0'::text, $1::uuid, now(), '{}'::jsonb, 5) as r`, [owner.userId]))[0]!.r).toEqual({ outcome: "invalid" });
  });
});

describe("migration 0010 / the new server on the migrated data, as the app role", () => {
  let N: SimPhone; // a NEW iOS phone (writes the ledger)
  let W: SimPhone; // the live web (old)

  beforeAll(() => {
    fleet.useHandler(createSyncHandler);
  });

  it("the old phones carry on with no rejection and no conflict: A and B pull, edit, confirm and cancel across the migration", async () => {
    expectClean("A pulls", await A.sync());
    expectClean("B pulls", await B.sync());
    const o = A.createOrder({ customerId: shop.customers[3]!, lines: [{ productId: shop.products.cake, name: "Chocolate cake", qty: 3, priceMinor: 6500 }] });
    A.setStatus(o, "confirmed");
    expectClean("A confirm after the migration", await A.sync());
    expectClean("B pulls it", await B.sync());
    expect(B.get("order", o).status).toBe("confirmed");
    expect((await fleet.storedData("product", shop.products.cake)).stockQuantity).toBe(A.get("product", shop.products.cake).stockQuantity);
    // A legacy order confirmed BEFORE the migration (no ledger, no allocation row, its move still in the list) is cancelled once.
    const cake = shop.products.cake;
    const before = (await fleet.storedData("product", cake)).stockQuantity as number;
    const held = (OLD_CONFIRMED.cake && (A.get("order", OLD_CONFIRMED.cake).items as J[]).filter((i) => i.productId === cake).reduce((s, i) => s + i.quantity, 0)) as number;
    A.setStatus(OLD_CONFIRMED.cake!, "cancelled");
    expectClean("A cancels a pre-migration order", await A.sync());
    expect((await fleet.storedData("product", cake)).stockQuantity, "its units come back exactly once").toBe(before + held);
    expectClean("B pulls the cancel", await B.sync());
    expect(B.get("product", cake).stockQuantity).toBe(before + held);
    // Pre-migration payments survive and a payment deleted before the migration stays deleted.
    const payments = (await fleet.storedData("order", OLD_CONFIRMED.cake!)).payments as J[];
    expect(payments.map((p) => p.amountMinor)).toEqual([4000]);
  });

  it("the R4 acceptance on the real file: quantity 100 with 50 old moves, an order confirmation is the first write (97), the pre-migration snapshot of an offline phone is replayed: still 97; a new offline move applies once", async () => {
    N = new SimPhone(fleet, owner.session, "iosNew", "N");
    N.cloudOn = true;
    expectClean("N restores the migrated shop", await N.sync());
    expect((await fleet.storedData("product", Y)).stockQuantity).toBe(100);
    const o = N.createOrder({ customerId: shop.customers[4]!, lines: [{ productId: Y, name: "Yogurt cup", qty: 3, priceMinor: 400 }] });
    N.setStatus(o, "confirmed");
    expectClean("N confirms 3", await N.sync());
    expect((await fleet.storedData("product", Y)).stockQuantity).toBe(97);
    expect(((await fleet.storedData("product", Y)).stockMoves as J[])).toHaveLength(50); // the oldest of the 50 historical moves has been trimmed off the display list
    // C comes back online holding the snapshot from before the migration (100 and its 50 old moves) and edits the product.
    C.online = true;
    C.editProduct(Y, { priceMinor: 450 });
    C.editProduct(Z, { priceMinor: 550 }); // Z too: see the documented limit below
    limit.before = (await fleet.storedData("product", Z)).stockQuantity as number;
    const r = await C.sync();
    limit.after = (await fleet.storedData("product", Z)).stockQuantity as number;
    expect(r.ok).toBe(true);
    expect(r.rejected).toEqual([]);
    const after = await fleet.storedData("product", Y);
    expect(after.stockQuantity, "the replayed snapshot must not bring a trimmed move back").toBe(97);
    expect(after.priceMinor).toBe(450);
    // The oldest historical move is known to the server only through the migration's backfill.
    const oldest = (A.get("product", Y).stockMoves as J[]).at(-1)!;
    expect(await q<{ outcome: string }>(`select outcome from orderat.stock_ops where op_id = $1`, [moveKey(oldest)])).toEqual([{ outcome: "listed" }]);
    // And a NEW move made offline by C applies exactly once, however often it is pushed.
    C.adjustStockManually(Y, 10, "received", "offline delivery");
    expectClean("C pushes its new move", await C.sync());
    expect((await fleet.storedData("product", Y)).stockQuantity).toBe(107);
    C.markDirty("product", Y);
    expectClean("C pushes it again", await C.sync());
    expect((await fleet.storedData("product", Y)).stockQuantity).toBe(107);
    expectClean("N pulls", await N.sync());
    N.setStatus(o, "cancelled");
    expectClean("N cancels the new order", await N.sync());
    expect((await fleet.storedData("product", Y)).stockQuantity).toBe(110);
  });

  it("an order confirmed before the migration, on a product whose moves are all still listed, is cancelled by a NEW phone: its units come back once (derived from the stored moves)", async () => {
    N = N ?? new SimPhone(fleet, owner.session, "iosNew", "N");
    N.cloudOn = true;
    expectClean("N pulls", await N.sync());
    const before = (await fleet.storedData("product", Z)).stockQuantity as number;
    N.setStatus(zOrderPre, "cancelled"); // 6 units of Z, confirmed on the OLD server by an iOS 1.0 phone
    expectClean("N cancels the pre-migration order", await N.sync());
    expect((await fleet.storedData("product", Z)).stockQuantity).toBe(before + 6);
    N.setStatus(zOrderPre, "confirmed"); // and takes them again
    expectClean("N confirms it again", await N.sync());
    expect((await fleet.storedData("product", Z)).stockQuantity).toBe(before);
    expect(await q(`select product_id, units from orderat.order_stock where order_id = $1`, [zOrderPre])).toEqual([{ product_id: Z, units: 6 }]);
  });

  it("DOCUMENTED LIMIT (security review, third review limits): a phone offline since before the migration that holds moves the OLD server had already trimmed applies them again", () => {
    // Z was written by the old server after C took its snapshot, so its two oldest moves (+2 each) were trimmed from the stored list
    // before the migration could list them. Nothing can know them now; C's first push after the migration brings them back as new moves.
    // (Y, whose list nothing touched before the migration, is exact: see the R4 test above.)
    expect(limit.after! - limit.before!).toBe(4);
  });

  it("the live web (old) works on the migrated shop too: confirm, then cancel, one record at a time, products before orders", async () => {
    W = new SimPhone(fleet, owner.session, "webOld", "W");
    W.cloudOn = true;
    expectClean("W restores", await W.sync());
    const tart = shop.products.tart;
    const before = (await fleet.storedData("product", tart)).stockQuantity as number;
    const o = W.createOrder({ customerId: shop.customers[5]!, lines: [{ productId: tart, name: "Lemon tart", qty: 2, priceMinor: 4000 }] });
    W.setStatus(o, "confirmed");
    expectClean("W confirms", await W.sync());
    expect((await fleet.storedData("product", tart)).stockQuantity).toBe(before - 2);
    W.setStatus(o, "cancelled");
    expectClean("W cancels", await W.sync());
    expect((await fleet.storedData("product", tart)).stockQuantity).toBe(before);
  });

  it("an invite is claimed by exactly one account after the migration (orderat.claim_invite as the app role): the second account gets the plain invalid answer, a sixth staff member the limit", async () => {
    const invite = await fleet.call(owner.session, { action: "invite_create", shopId: fleet.shopId });
    expect(invite.status).toBe(200);
    const first = await fleet.newUser("joiner-1");
    const second = await fleet.newUser("joiner-2");
    const a = await fleet.call(first.session, { action: "invite_join", code: invite.json.code });
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ role: "staff", permissions: { orders: false, prepare: false, money: false, products: false } });
    const b = await fleet.call(second.session, { action: "invite_join", code: invite.json.code });
    expect(b.status).toBe(404);
    expect(b.json).toEqual({ error: "invalid_code" });
    // The shop has 3 staff now (two from before the migration + this one); two more fill it, the next is refused and keeps its invite.
    for (let i = 0; i < 2; i++) await fleet.addStaff(owner.session, `fill-${i}`, { orders: false, prepare: false, money: false, products: false });
    const last = await fleet.call(owner.session, { action: "invite_create", shopId: fleet.shopId });
    const sixth = await fleet.newUser("sixth");
    const refused = await fleet.call(sixth.session, { action: "invite_join", code: last.json.code });
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({ error: "staff_limit" });
  });

  it("staff keep working after the migration: the prepare and money phones (iOS 1.0) are still served", async () => {
    const rows = await q<{ user_id: string; permissions: J }>(`select user_id, permissions from orderat.shop_members where role = 'staff' order by joined_at`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const prepare = rows.find((r) => r.permissions.prepare)!;
    expect(prepare).toBeDefined();
    // (A staff phone's session belongs to its own user; a fresh login for the same user.)
    const { session } = await (async () => {
      const { createSession, newSessionToken } = await import("../../auth/store.ts");
      const token = await newSessionToken();
      await createSession(sql, { tokenHash: token.tokenHash, userId: prepare.user_id, now: new Date(fleet.clock) });
      return { session: token.token };
    })();
    const P2 = new SimPhone(fleet, session, "ios1", "P2");
    P2.cloudOn = true;
    expectClean("prepare staff restores", await P2.sync());
    const o = A.createOrder({ customerId: shop.customers[6]!, lines: [{ productId: shop.products.cookie, name: "Cookies box", qty: 2, priceMinor: 2500 }] });
    expectClean("owner makes an order", await A.sync());
    expectClean("staff pulls", await P2.sync());
    const before = (await fleet.storedData("product", shop.products.cookie)).stockQuantity as number;
    P2.setStatus(o, "confirmed");
    expectClean("prepare staff confirms", await P2.sync());
    expect((await fleet.storedData("product", shop.products.cookie)).stockQuantity).toBe(before - 2);
    P2.setStatus(o, "cancelled");
    expectClean("prepare staff cancels", await P2.sync());
    expect((await fleet.storedData("product", shop.products.cookie)).stockQuantity).toBe(before);
  });

  it("ROLLBACK: the previous server serves the migrated database after the new one has run on it (no error, no rejection), and the new one takes over again with the books right", async () => {
    fleet.useHandler(createOldSyncHandler);
    for (const phone of [A, B, C, N, W]) {
      phone.online = true;
      const r = await phone.sync();
      expect(r.ok, `${phone.label} syncs with the old server`).toBe(true);
      expect(r.rejected).toEqual([]);
    }
    // Work done while the old server is back: a confirm of 2 cookies (the old server stores what the phone pushed).
    const cookie = shop.products.cookie;
    const o = A.createOrder({ customerId: shop.customers[7]!, lines: [{ productId: cookie, name: "Cookies box", qty: 2, priceMinor: 2500 }] });
    A.setStatus(o, "confirmed");
    const during = (await fleet.storedData("product", cookie)).stockQuantity as number;
    const r = await A.sync();
    expect(r.ok).toBe(true);
    expect(r.rejected).toEqual([]);
    expect((await fleet.storedData("product", cookie)).stockQuantity).toBe(during - 2);
    // The new server comes back: the cancel gives the 2 back once (the confirm's move is in the product's stored list).
    fleet.useHandler(createSyncHandler);
    A.setStatus(o, "cancelled");
    expect((await A.sync()).ok).toBe(true);
    expect((await fleet.storedData("product", cookie)).stockQuantity).toBe(during);
    for (const phone of [B, N, W]) expect((await phone.sync()).ok).toBe(true);
  });

  it("everything the server wrote after the migration is bookkept: no product list holds a move that stock_ops does not know", async () => {
    const known = new Set(await stockOpIds());
    for (const r of await q<{ id: string; data: J }>(`select id, data from orderat.records where entity = 'product' and not deleted`)) {
      // A product the server has not rewritten since the migration keeps its list; every other one was recorded before its list could trim.
      const written = (await q<{ n: number }>(`select count(*) as n from orderat.stock_ops where product_id = $1`, [r.id]))[0]!.n;
      if (Number(written) === 0) continue;
      for (const move of r.data.stockMoves as J[]) {
        const key = moveKey(move);
        if (key.length <= 600) expect(known.has(key), `${r.id}: move ${key} is in the list but not in stock_ops`).toBe(true);
      }
    }
  });
});
