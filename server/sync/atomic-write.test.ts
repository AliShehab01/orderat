// The atomic unit under the sync push (db/migrations/0010_order_stock.sql: orderat.sync_apply, apply_stock_effect, claim_invite;
// server/sync/store.ts writeAtomic): one record is written only while it, and everything the decision read, is still as read,
// together with its stock effects, allocation rows and stock_ops rows; anything that moved returns no row and writes nothing.
// The decisions that feed it are tested through the push path (stock-push.test.ts); this file is the function itself.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createCloudTestSql, execCloudTestSql } from "../cloud-pglite-test-support.ts";
import { findOrderStock, findRecord, findRecordsByIds, findStockOps, insertShopCloud, upsertRecord, writeAtomic, type AtomicWrite } from "./store.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";
const AT = "2026-10-03T09:00:00.000Z";

const empty: Omit<AtomicWrite, "primary"> = { deps: [], effects: [], orderStock: [], ops: [], listed: [] };
const primaryOrder = (expectSeq: number | undefined, data: Record<string, unknown> = { status: "confirmed" }): AtomicWrite["primary"] => ({ entity: "order", id: "o1", expectSeq, data, deleted: false });
const write = (w: Partial<AtomicWrite> & { primary: AtomicWrite["primary"] }) => writeAtomic(sql, SHOP_ID, OWNER_ID, { ...empty, ...w });
const rowsOf = async () => Object.fromEntries((await findOrderStock(sql, SHOP_ID, ["o1", "o2"])).map((r) => [`${r.orderId}/${r.productId}`, r.units]));
const opsOf = async (...ids: string[]) => [...(await findStockOps(sql, SHOP_ID, ids))].sort();
const md5Uuid = (text: string) => {
  const h = createHash("md5").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
});

describe("sync_apply / the primary record is a compare-and-swap", () => {
  it("inserts a record that does not exist yet, once; a second insert (it exists now) writes nothing", async () => {
    const first = await write({ primary: primaryOrder(undefined, { status: "new" }) });
    expect(first).toMatchObject({ entity: "order", id: "o1", data: { status: "new" }, deleted: false });
    expect(await write({ primary: primaryOrder(undefined, { status: "other" }) })).toBeUndefined();
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ status: "new" });
  });

  it("updates only the version it was decided on, with a fresh seq; a stale seq writes nothing", async () => {
    const seeded = await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    expect(await write({ primary: primaryOrder(seeded.seq - 1, { status: "stale" }) })).toBeUndefined();
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ status: "new" });
    const written = (await write({ primary: primaryOrder(seeded.seq, { status: "confirmed" }) }))!;
    expect(written.seq).toBeGreaterThan(seeded.seq);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!).toMatchObject({ data: { status: "confirmed" }, seq: written.seq });
    // The same expectation again is stale now.
    expect(await write({ primary: primaryOrder(seeded.seq, { status: "again" }) })).toBeUndefined();
  });

  it("writes a tombstone as such", async () => {
    const seeded = await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    const gone = (await write({ primary: { ...primaryOrder(seeded.seq), deleted: true } }))!;
    expect(gone.deleted).toBe(true);
  });
});

describe("sync_apply / what the decision read must not have moved", () => {
  it("dependencies: a record read but not written must still have the seq that was read, or nothing is written", async () => {
    const dep = await upsertRecord(sql, SHOP_ID, "order", "o2", { status: "new" }, false, OWNER_ID);
    const product = await upsertRecord(sql, SHOP_ID, "product", "p1", { stockQuantity: 5, stockMoves: [] }, false, OWNER_ID);
    const productWrite = { entity: "product" as const, id: "p1", expectSeq: product.seq, data: { stockQuantity: 1 }, deleted: false };
    expect(await write({ primary: productWrite, deps: [{ entity: "order", id: "o2", seq: dep.seq }] })).toBeDefined();
    // The order is rewritten meanwhile: the product write that was decided on its old version is refused...
    await upsertRecord(sql, SHOP_ID, "order", "o2", { status: "changed" }, false, OWNER_ID);
    const again = (await findRecord(sql, SHOP_ID, "product", "p1"))!;
    expect(await write({ primary: { ...productWrite, expectSeq: again.seq, data: { stockQuantity: 99 } }, deps: [{ entity: "order", id: "o2", seq: dep.seq }] })).toBeUndefined();
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.data).toEqual({ stockQuantity: 1 });
    // ...and so is one decided on an order that does not exist.
    expect(await write({ primary: { ...productWrite, expectSeq: again.seq }, deps: [{ entity: "order", id: "missing", seq: 1 }] })).toBeUndefined();
  });

  it("allocation rows: each must still hold what was read (absent included); a mismatch writes nothing, not even the primary", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    const seq = (await findRecord(sql, SHOP_ID, "order", "o1"))!.seq;
    const row = (expect: number | null, units: number, writeIt = true) => ({ orderId: "o1", productId: "p1", expect, units, write: writeIt });
    // Nothing there: expecting a number is a mismatch; expecting absent writes the row.
    expect(await write({ primary: primaryOrder(seq), orderStock: [row(2, 3)] })).toBeUndefined();
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ status: "new" });
    const written = (await write({ primary: primaryOrder(seq), orderStock: [row(null, 3)] }))!;
    expect(await rowsOf()).toEqual({ "o1/p1": 3 });
    // Expecting absent when a row exists, or the wrong number, is a mismatch.
    expect(await write({ primary: primaryOrder(written.seq, { status: "x" }), orderStock: [row(null, 4)] })).toBeUndefined();
    expect(await write({ primary: primaryOrder(written.seq, { status: "x" }), orderStock: [row(2, 4)] })).toBeUndefined();
    expect(await rowsOf()).toEqual({ "o1/p1": 3 });
    // A row that is only read (write: false) is guarded, not changed; a written one is set.
    expect(await write({ primary: primaryOrder(written.seq, { status: "y" }), orderStock: [row(3, 99, false), { orderId: "o1", productId: "p2", expect: null, units: 0, write: true }] })).toBeDefined();
    expect(await rowsOf()).toEqual({ "o1/p1": 3, "o1/p2": 0 });
    const next = (await findRecord(sql, SHOP_ID, "order", "o1"))!.seq;
    await write({ primary: primaryOrder(next, { status: "z" }), orderStock: [row(3, 0)] });
    expect(await rowsOf()).toEqual({ "o1/p1": 0, "o1/p2": 0 });
  });

  it("stock_ops: an id that exists makes the write refuse and leaves the ids it would have inserted out; new ids are recorded with the write", async () => {
    const seeded = await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    await write({ primary: primaryOrder(seeded.seq), ops: [{ opId: "id:taken", productId: "p1", outcome: "applied" }] });
    expect(await opsOf("id:taken")).toEqual(["id:taken"]);
    const now = (await findRecord(sql, SHOP_ID, "order", "o1"))!.seq;
    const refused = await write({ primary: primaryOrder(now, { status: "nope" }), ops: [{ opId: "id:fresh", productId: "p1", outcome: "applied" }, { opId: "id:taken", productId: "p1", outcome: "applied" }] });
    expect(refused).toBeUndefined();
    expect(await opsOf("id:fresh", "id:taken")).toEqual(["id:taken"]); // the fresh one was taken back
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.data).toEqual({ status: "confirmed" });
    // Listed ids are best effort: recorded when missing, never a reason to refuse.
    expect(await write({ primary: primaryOrder(now, { status: "listed" }), listed: [{ opId: "id:taken", productId: "p1" }, { opId: "id:listed", productId: "p1" }] })).toBeDefined();
    expect(await opsOf("id:listed", "id:taken")).toEqual(["id:listed", "id:taken"]);
  });
});

describe("sync_apply / stock effects: a relative update of each live product, with a server-made move", () => {
  const seedProduct = (data: Record<string, unknown>, id = "p1") => upsertRecord(sql, SHOP_ID, "product", id, data, false, OWNER_ID);

  it("moves the quantity by the delta from whatever it is now, lists the server's move first (deterministic id), bumps the seq, records the move id", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    const product = await seedProduct({ nameAr: "كيك", stockQuantity: 10, stockMoves: [{ id: "x", delta: 5, reason: "received", orderId: null, note: null, at: AT }] });
    const order = (await findRecord(sql, SHOP_ID, "order", "o1"))!;
    const written = (await write({
      primary: primaryOrder(order.seq),
      effects: [{ productId: "p1", orderId: "o1", delta: -3, reason: "orderConfirmed", at: AT }],
    }))!;
    const after = (await findRecord(sql, SHOP_ID, "product", "p1"))!;
    const moveId = md5Uuid(`o1:${written.seq}:p1`);
    expect(after.data).toEqual({
      nameAr: "كيك",
      stockQuantity: 7,
      stockMoves: [{ id: moveId, delta: -3, reason: "orderConfirmed", orderId: "o1", note: null, at: AT }, { id: "x", delta: 5, reason: "received", orderId: null, note: null, at: AT }],
    });
    expect(after.seq).toBeLessThan(written.seq); // before the order (fourth review, R1): a pull in seq order delivers the product first
    expect(after.seq).toBeGreaterThan(product.seq);
    expect(await opsOf(`id:${moveId}`)).toEqual([`id:${moveId}`]);
    // A quantity another write changed meanwhile is moved from where it is: -3 on top of the new value, not on the value that was read.
    await upsertRecord(sql, SHOP_ID, "product", "p1", { ...after.data, stockQuantity: 100 }, false, OWNER_ID);
    const again = (await write({ primary: primaryOrder((await findRecord(sql, SHOP_ID, "order", "o1"))!.seq), effects: [{ productId: "p1", orderId: "o1", delta: 3, reason: "orderCancelled", at: AT }] }))!;
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.data.stockQuantity).toBe(103);
    expect(again.seq).toBeGreaterThan(written.seq);
  });

  it("R1: every product an effect moves has a lower seq than the order written with it, whatever the number of products, and a refused write moves none", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    for (const id of ["p1", "p2", "p3"]) await seedProduct({ stockQuantity: 10, stockMoves: [] }, id);
    const order = (await findRecord(sql, SHOP_ID, "order", "o1"))!;
    const effect = (productId: string) => ({ productId, orderId: "o1", delta: -1, reason: "orderConfirmed", at: AT });
    const seqsOf = () => Promise.all(["p1", "p2", "p3"].map(async (id) => (await findRecord(sql, SHOP_ID, "product", id))!.seq));
    const written = (await write({ primary: primaryOrder(order.seq), effects: [effect("p3"), effect("p1"), effect("p2"), effect("pMissing")] }))!;
    const seqs = await seqsOf();
    expect(new Set(seqs).size).toBe(3); // each product has a seq of its own: every device pulls each of them
    for (const seq of seqs) {
      expect(seq).toBeGreaterThan(order.seq);
      expect(seq).toBeLessThan(written.seq);
    }
    // A stale expectation writes nothing: no product moves and the order keeps its seq.
    expect(await write({ primary: primaryOrder(order.seq, { status: "stale" }), effects: [effect("p1")] })).toBeUndefined();
    expect(await seqsOf()).toEqual(seqs);
    expect((await findRecord(sql, SHOP_ID, "order", "o1"))!.seq).toBe(written.seq);
    // A new order (the primary does not exist yet) is written after its products too.
    const created = (await write({ primary: { entity: "order", id: "o2", expectSeq: undefined, data: { status: "confirmed" }, deleted: false }, effects: [{ ...effect("p1"), orderId: "o2" }] }))!;
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.seq).toBeLessThan(created.seq);
  });

  it("R4: the moves a product's list holds are recorded before the server's move can push one off it; a short list and a move with no id are recorded too", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `M${i}`, delta: 1, reason: "received", orderId: null, note: null, at: AT }));
    await seedProduct({ stockQuantity: 20, stockMoves: fifty });
    await seedProduct({ stockQuantity: 5, stockMoves: [{ id: "S1", delta: 1, reason: "received", orderId: null, note: null, at: AT }, { delta: 2 }] }, "p2");
    expect(await opsOf("id:m0", "id:m49")).toEqual([]); // nothing in stock_ops yet
    const order = (await findRecord(sql, SHOP_ID, "order", "o1"))!;
    await write({ primary: primaryOrder(order.seq), effects: [{ productId: "p1", orderId: "o1", delta: -2, reason: "orderConfirmed", at: AT }, { productId: "p2", orderId: "o1", delta: -1, reason: "orderConfirmed", at: AT }] });
    const moves = (await findRecord(sql, SHOP_ID, "product", "p1"))!.data.stockMoves as { id: string }[];
    expect(moves).toHaveLength(50);
    expect(moves.some((m) => m.id === "M49")).toBe(false); // trimmed off the list...
    expect(await opsOf("id:m0", "id:m49")).toEqual(["id:m0", "id:m49"]); // ...and recorded, with every other
    expect(await opsOf("id:s1", "f:[null,2,null,null]")).toEqual(["f:[null,2,null,null]", "id:s1"]);
    // A missing or deleted product has nothing to list and nothing fails.
    await upsertRecord(sql, SHOP_ID, "product", "pDeleted", { stockMoves: [{ id: "GONE" }] }, true, OWNER_ID);
    const again = (await findRecord(sql, SHOP_ID, "order", "o1"))!;
    expect(await write({ primary: primaryOrder(again.seq), effects: [{ productId: "pDeleted", orderId: "o1", delta: -1, reason: "orderConfirmed", at: AT }, { productId: "pMissing", orderId: "o1", delta: -1, reason: "orderConfirmed", at: AT }] })).toBeDefined();
    expect(await opsOf("id:gone")).toEqual([]);
  });

  it("R4: a product the primary replaces has the moves of its stored list recorded first, a tombstone's included; a new product has none to record", async () => {
    await seedProduct({ stockQuantity: 3, stockMoves: [{ id: "A1", delta: 1 }, { id: "a2", delta: 1 }] });
    const stored = (await findRecord(sql, SHOP_ID, "product", "p1"))!;
    const replace = (expectSeq: number | undefined, id = "p1", deleted = false) => ({ entity: "product" as const, id, expectSeq, data: { stockQuantity: 9, stockMoves: [{ id: "B1", delta: 1 }] }, deleted });
    expect(await write({ primary: replace(stored.seq - 1) })).toBeUndefined(); // refused: nothing recorded
    expect(await opsOf("id:a1", "id:a2")).toEqual([]);
    await write({ primary: replace(stored.seq) });
    expect(await opsOf("id:a1", "id:a2", "id:b1")).toEqual(["id:a1", "id:a2"]); // the replaced list, not the new one (the caller records its own)
    await write({ primary: replace(undefined, "pNew") });
    expect(await opsOf("id:b1")).toEqual([]);
    // A tombstone's list is replaced when the product comes back.
    await write({ primary: replace((await findRecord(sql, SHOP_ID, "product", "p1"))!.seq, "p1", true) });
    await write({ primary: { entity: "product", id: "p1", expectSeq: (await findRecord(sql, SHOP_ID, "product", "p1"))!.seq, data: { stockMoves: [] }, deleted: false } });
    expect(await opsOf("id:b1")).toEqual(["id:b1"]);
  });

  it("keeps the newest 50 moves, and the quantity under the web's old name qty when the product has it", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, delta: 1, reason: "received", orderId: null, note: null, at: AT }));
    await seedProduct({ qty: 20, stockQuantity: 20, stockMoves: fifty });
    await write({ primary: primaryOrder((await findRecord(sql, SHOP_ID, "order", "o1"))!.seq), effects: [{ productId: "p1", orderId: "o1", delta: -2, reason: "orderConfirmed", at: AT }] });
    const data = (await findRecord(sql, SHOP_ID, "product", "p1"))!.data;
    expect(data).toMatchObject({ qty: 18, stockQuantity: 18 });
    const moves = data.stockMoves as { id: string }[];
    expect(moves).toHaveLength(50);
    expect(moves[1]!.id).toBe("m0");
    expect(moves.some((m) => m.id === "m49")).toBe(false);
  });

  it("a product with no quantity or no list yet starts from 0 and an empty list; a missing or deleted product is skipped without an error", async () => {
    await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    await seedProduct({ nameAr: "x" });
    await upsertRecord(sql, SHOP_ID, "product", "pDeleted", { stockQuantity: 5, stockMoves: [] }, true, OWNER_ID);
    const effect = (productId: string, delta: number) => ({ productId, orderId: "o1", delta, reason: "orderConfirmed", at: AT });
    const written = await write({
      primary: primaryOrder((await findRecord(sql, SHOP_ID, "order", "o1"))!.seq),
      effects: [effect("p1", -2), effect("pMissing", -9), effect("pDeleted", -9)],
    });
    expect(written).toBeDefined();
    expect((await findRecord(sql, SHOP_ID, "product", "p1"))!.data).toMatchObject({ stockQuantity: -2, stockMoves: [{ delta: -2 }] });
    expect(await findRecord(sql, SHOP_ID, "product", "pMissing")).toBeUndefined();
    expect((await findRecord(sql, SHOP_ID, "product", "pDeleted"))!.data.stockQuantity).toBe(5);
    expect((await findRecordsByIds(sql, SHOP_ID, "product", ["p1", "pMissing", "pDeleted"])).map((r) => r.id).sort()).toEqual(["p1", "pDeleted"]);
  });
});

describe("the migration", () => {
  const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations", "0010_order_stock.sql"), "utf8");

  it("is idempotent and backfills stock_ops with the keys the runtime computes for the moves already in products' stored lists (stock-ops-keys.test.ts covers the rule), only for products", async () => {
    const moves = [{ id: "AAAA-1", delta: -1 }, { id: "bbbb-2", delta: 1 }, { delta: 1 }, "junk", { id: 5 }];
    await upsertRecord(sql, SHOP_ID, "product", "p1", { stockMoves: moves }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "product", "p2", { stockMoves: "not a list" }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "o1", { stockMoves: [{ id: "NOT-A-PRODUCT" }] }, false, OWNER_ID);
    await execCloudTestSql(migration);
    await execCloudTestSql(migration);
    const rows = await sql.query<{ op_id: string; product_id: string; outcome: string }>(`select op_id, product_id, outcome from orderat.stock_ops where shop_id = $1 order by op_id`, [SHOP_ID]);
    // A move with an id is `id:` and the id with its ASCII capitals folded; one with no id, or an id that is not a string, is its fields.
    expect(rows).toEqual([
      { op_id: "f:[null,1,null,null]", product_id: "p1", outcome: "listed" },
      { op_id: "f:[null,null,null,null]", product_id: "p1", outcome: "listed" },
      { op_id: "id:aaaa-1", product_id: "p1", outcome: "listed" },
      { op_id: "id:bbbb-2", product_id: "p1", outcome: "listed" },
    ]);
  });

  it("is additive: it touches no existing table (records keep their rows and seqs) and leaves only orderat_app able to call the functions", async () => {
    const seeded = await upsertRecord(sql, SHOP_ID, "order", "o1", { status: "new" }, false, OWNER_ID);
    await execCloudTestSql(migration);
    expect(await findRecord(sql, SHOP_ID, "order", "o1")).toMatchObject({ seq: seeded.seq, data: { status: "new" } });
    const grants = await sql.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'orderat' and routine_name in ('sync_apply', 'apply_stock_effect', 'claim_invite', 'stock_move_key', 'stock_move_key_token', 'record_listed_moves') and privilege_type = 'EXECUTE' order by routine_name, grantee`,
    );
    const grantees = new Set(grants.map((g) => g.grantee));
    expect(grantees.has("PUBLIC")).toBe(false);
    expect(grantees.has("orderat_app")).toBe(true);
    const tables = await sql.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type from information_schema.table_privileges where table_schema = 'orderat' and table_name in ('order_stock', 'stock_ops') and grantee = 'PUBLIC'`,
    );
    expect(tables).toEqual([]);
  });
});
