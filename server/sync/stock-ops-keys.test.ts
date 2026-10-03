// R4 (fourth review, 3 Oct 2026): migration 0010 and the durable stock operation keys. `stock_ops` must hold exactly the keys the
// runtime computes (stock-merge.ts moveKey), for moves with ids and for moves without; the key rule is written once per language
// (SQL: orderat.stock_move_key, TypeScript: moveKey) and tested to agree; and every path that rewrites a product's stockMoves
// records the moves it holds first, so the 50-entry display list can trim them without a replay ever applying one twice.
// The acceptance sequence runs the REAL migration file against a populated database.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createCloudTestSql, execCloudTestSql } from "../cloud-pglite-test-support.ts";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { pushChanges } from "./push-pull.ts";
import { moveKey, movesOf } from "./stock-merge.ts";
import { findRecord, insertShopCloud, upsertRecord } from "./store.ts";
import type { ChangeInput } from "./validate.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";
const SERVER_NOW = new Date(Date.UTC(2026, 9, 3, 9, 0));
const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations", "0010_order_stock.sql"), "utf8");

const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
const ownerPhone = { name: "owner", member: { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS } as Member, by: OWNER_ID };
const productsPhone = { name: "products staff", member: staff({ products: true }), by: STAFF_ID };
type Phone = typeof ownerPhone;

const T = (minute: number) => new Date(Date.UTC(2026, 8, 1, 0, minute)).toISOString();
/** A move of the 50-entry history: `received` +1 at minute n, id `h<n>` (uppercase when `upper`). */
const history = (n: number, upper = false) => ({ id: upper ? `H${n}` : `h${n}`, delta: 1, reason: "received", orderId: null, note: null, at: T(n) });
/** The newest-first list of `count` moves ending at minute `newest`. */
const window = (newest: number, count: number, upper = false) => Array.from({ length: count }, (_, i) => history(newest - i, upper));
const PRODUCT = (stockQuantity: number, stockMoves: unknown[], extra: Record<string, unknown> = {}) => ({
  nameAr: "كيك", priceMinor: 6500, costMinor: 2500, trackStock: true, stockQuantity, lowStockThreshold: 3, stockMoves, createdAt: T(0), ...extra,
});
const ORDER = (status: string, units: number, ledger?: Record<string, number>) => ({
  customerId: "c1", status, fulfillmentType: "pickup", paymentStatus: "unpaid", deliveryFeeMinor: 0,
  items: [{ id: "i1", productId: "p1", nameSnapshot: "Cake", quantity: units, unitPriceMinor: 6500, unitCostMinor: 2500 }],
  payments: [], changes: [], updatedAt: T(0), ...(ledger ? { stockDeducted: ledger } : {}),
});
const ch = (entity: "order" | "product", id: string, data: Record<string, unknown>, baseSeq: number, deleted = false): ChangeInput => ({ entity, id, data, deleted, baseSeq });
const push = (phone: Phone, changes: ChangeInput[]) => pushChanges(sql, SHOP_ID, phone.member, changes, phone.by, { now: () => SERVER_NOW });

const seqOf = async (entity: "order" | "product", id: string) => (await findRecord(sql, SHOP_ID, entity, id))!.seq;
const productNow = async () => (await findRecord(sql, SHOP_ID, "product", "p1"))!.data as { stockQuantity: number; stockMoves: { id: string }[] };
const stockNow = async () => (await productNow()).stockQuantity;
const opKeys = async () => new Set((await sql.query<{ op_id: string }>(`select op_id from orderat.stock_ops where shop_id = $1`, [SHOP_ID])).map((r) => r.op_id));
const opRows = async () => sql.query<{ op_id: string; product_id: string | null; outcome: string }>(`select op_id, product_id, outcome from orderat.stock_ops where shop_id = $1 order by op_id`, [SHOP_ID]);

beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R4 / one key rule, written once in SQL and once in TypeScript", () => {
  /** Every shape of move the runtime may meet in a stored list or a push. */
  const FIXTURES: Record<string, unknown>[] = [
    { id: "abc-123", delta: -1 },
    { id: "ABC-123", delta: -1 },
    { id: "6B1F0A2E-3D4C-4E5F-8A9B-0C1D2E3F4A5B", delta: -3, reason: "orderConfirmed", orderId: "A1B2C3D4-0000-4000-8000-000000000001" }, // iOS: uppercase UUIDs
    { id: "6b1f0a2e-3d4c-4e5f-8a9b-0c1d2e3f4a5b", delta: -3 }, // the same move as Android spells it
    { id: "MiXeD_Case-09.z", delta: 1 },
    { id: "İSTANBUL-É-ß-Ω", delta: 1 }, // only ASCII letters change case: the same in every database locale
    { id: "a \"quoted\" id\\", delta: 1 },
    { id: " ", delta: 1 }, // a space is an id
    { id: "x", at: "2026-10-03T08:00:00.000Z", delta: 5, reason: "received", orderId: null, note: "n" }, // an id wins over the fields
    { at: "2026-10-03T08:00:00.000Z", delta: -3, reason: "orderConfirmed", orderId: "o1" }, // a legacy move with no id
    { at: "2026-10-03T08:00:00.000Z", delta: -3, reason: "orderConfirmed", orderId: "O1" }, // orderId is not folded
    { delta: 1 },
    {},
    { id: "", at: "2026-10-03T08:00:00.000Z", delta: 2, reason: "received" }, // an empty id is no id
    { id: 5, delta: 1 }, // an id that is not a string is no id
    { id: null, delta: 1, reason: "correction" },
    { at: "2026-10-03T08:00:00.000Z", delta: 0.5, reason: "received" },
    { at: "2026-10-03T08:00:00.000Z", delta: -3, reason: "orderCancelled" },
    { at: "2026-10-03T08:00:00.000Z", delta: 100000000000, reason: "received" },
    { at: "2026-10-03T08:00:00.000Z", delta: 0, reason: "received", orderId: null },
    { at: 12345, delta: "7", reason: 8, orderId: 9 }, // numbers where text belongs and the other way round
    { at: true, delta: [1], reason: { a: 1 }, orderId: [] }, // other types count as missing
    { reason: "a\"b\\c\nd\te é \u0001 😀 \u007f  ", orderId: "o\u0001\u001f" }, // everything JSON writes an escape for
    { at: "الخليج العربي", reason: "تصحيح", orderId: "طلب-١" },
    ...[1e-6, 1e-7, 1.5e-7, 5e-324, 1e20, 123456789012345680000, 1e21, 1.7976931348623157e308, -1e21, -1e-7, 0.1 + 0.2, 12345.6789, -0].map((delta) => ({ delta, reason: "received" })), // where JavaScript and PostgreSQL print a number differently, both say null
  ];

  it("orderat.stock_move_key and moveKey agree on every fixture: uppercase ids, ids that are not strings, moves with no id, every escape", async () => {
    for (const move of FIXTURES) {
      const rows = await sql.query<{ key: string }>(`select orderat.stock_move_key($1::text::jsonb) as key`, [JSON.stringify(move)]);
      expect(rows[0]!.key, JSON.stringify(move)).toBe(moveKey(move));
    }
  });

  it("a seeded fuzz of 3,000 moves with every awkward character agrees too (ids, fields, numbers, missing keys)", async () => {
    let seed = 20261003;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = ["a", "Z", "0", "9", "-", "_", ".", " ", '"', "\\", "/", "\n", "\t", "\r", "\u0001", "\u001f", "\u007f", "\u0080", "é", "É", "İ", "ß", "Ω", "ı", "ﬁ", "😀", "𝒜", "ا", "\u2028", "\u00a0", "%", "'", "$", "{", "[", ":", ","];
    const word = () => Array.from({ length: Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
    const moves: Record<string, unknown>[] = [];
    for (let i = 0; i < 3000; i++) {
      const move: Record<string, unknown> = {};
      if (rand() < 0.5) move.id = word();
      if (rand() < 0.7) move.at = rand() < 0.8 ? word() : Math.floor(rand() * 1e12);
      if (rand() < 0.7) move.delta = rand() < 0.6 ? Math.floor(rand() * 200 - 100) : rand() < 0.8 ? Math.round((rand() * 20 - 10) * 100) / 100 : (rand() - 0.5) * 10 ** Math.floor(rand() * 60 - 30);
      if (rand() < 0.7) move.reason = word();
      if (rand() < 0.5) move.orderId = rand() < 0.8 ? word() : null;
      moves.push(move);
    }
    const rows = await sql.query<{ key: string }>(`select orderat.stock_move_key(m) as key from jsonb_array_elements($1::text::jsonb) with ordinality as t(m, ord) order by ord`, [JSON.stringify(moves)]);
    expect(rows).toHaveLength(moves.length);
    const different = moves.map((move, i) => ({ move, sql: rows[i]!.key, ts: moveKey(move) })).filter((r) => r.sql !== r.ts);
    expect(different.slice(0, 3)).toEqual([]);
  });

  it("the rule: an id is compared without ASCII case, so the iOS and Android spellings of one move are one key; a move with no id is its fields", () => {
    expect(moveKey({ id: "6B1F0A2E-3D4C" })).toBe("id:6b1f0a2e-3d4c");
    expect(moveKey({ id: "6b1f0a2e-3d4c" })).toBe(moveKey({ id: "6B1F0A2E-3D4C" }));
    expect(moveKey({ id: "İ" })).toBe("id:İ"); // not folded: no locale decides
    expect(moveKey({ at: "2026-10-03T08:00:00.000Z", delta: -3, reason: "orderConfirmed", orderId: "o1" })).toBe('f:["2026-10-03T08:00:00.000Z",-3,"orderConfirmed","o1"]');
    expect(moveKey({ delta: 1 })).toBe("f:[null,1,null,null]");
    expect(moveKey({ id: "", delta: 1 })).toBe("f:[null,1,null,null]");
    expect(moveKey({ id: 5, delta: 1 })).toBe("f:[null,1,null,null]");
  });

  it("the key of a move whose id differs only by case is one key, in SQL too", async () => {
    const rows = await sql.query<{ a: string; b: string }>(`select orderat.stock_move_key('{"id":"FFEEDDCC-1111"}'::jsonb) as a, orderat.stock_move_key('{"id":"ffeeddcc-1111"}'::jsonb) as b`);
    expect(rows[0]!.a).toBe(rows[0]!.b);
    expect(rows[0]!.a).toBe("id:ffeeddcc-1111");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R4 / the migration lists exactly the keys the runtime computes", () => {
  it("every move in every product's stored list, with an id or without, only for products; running the file again changes nothing", async () => {
    const lists: Record<string, unknown[]> = {
      p1: [{ id: "AAAA-1", delta: -1 }, { id: "bbbb-2", delta: 1 }, { delta: 1 }, { at: T(5), delta: -3, reason: "orderConfirmed", orderId: "o1" }, "junk", { id: 5 }, ["nested"], null],
      p2: [history(1, true), history(2)],
      p3: [],
    };
    for (const [id, moves] of Object.entries(lists)) await upsertRecord(sql, SHOP_ID, "product", id, { stockMoves: moves }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "product", "p4", { stockMoves: "not a list" }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "product", "p5", { nameAr: "no list" }, false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "product", "pDeleted", { stockMoves: [history(9)] }, true, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "o1", { stockMoves: [{ id: "NOT-A-PRODUCT" }] }, false, OWNER_ID);
    expect((await opRows()).length).toBe(0); // the old server never wrote the table

    await execCloudTestSql(migration);
    await execCloudTestSql(migration);

    // What the runtime computes for the same stored lists: moveKey of every object in each list.
    const expected = new Map<string, string>();
    for (const [id, moves] of [...Object.entries(lists), ["pDeleted", [history(9)]] as [string, unknown[]]]) {
      for (const move of movesOf(moves)) expected.set(moveKey(move), id);
    }
    const rows = await opRows();
    expect(new Map(rows.map((r) => [r.op_id, r.product_id]))).toEqual(expected);
    expect(rows.every((r) => r.outcome === "listed")).toBe(true);
    expect(rows.map((r) => r.op_id)).toContain("id:aaaa-1"); // the uppercase spelling is stored as the runtime looks it up
    expect(rows.map((r) => r.op_id)).toContain('f:["' + T(5) + '",-3,"orderConfirmed","o1"]'); // a move with no id by its fields
    expect(rows.map((r) => r.op_id)).not.toContain("AAAA-1");
    expect(rows.map((r) => r.op_id)).not.toContain("aaaa-1"); // the draft's bare lowercase id is not a key anything looks up
  });

  it("takes out the bare ids an earlier draft of this migration listed, and nothing else", async () => {
    await sql.query(`insert into orderat.stock_ops (shop_id, op_id, product_id, outcome) values ($1, 'aaaa-1', 'p1', 'listed'), ($1, 'id:kept', 'p1', 'applied'), ($1, 'id:kept2', 'p1', 'listed'), ($1, 'f:[null,1,null,null]', 'p1', 'listed'), ($1, 'bare-applied', 'p1', 'applied')`, [SHOP_ID]);
    await execCloudTestSql(migration);
    expect((await opRows()).map((r) => r.op_id)).toEqual(["bare-applied", "f:[null,1,null,null]", "id:kept", "id:kept2"]);
  });

  it("a lookup by the runtime's key finds a backfilled move: the stale phone's old move is known", async () => {
    await upsertRecord(sql, SHOP_ID, "product", "p1", PRODUCT(100, window(49, 50, true)), false, OWNER_ID);
    await execCloudTestSql(migration);
    const keys = await opKeys();
    for (const move of window(49, 50, false)) expect(keys.has(moveKey(move)), move.id).toBe(true); // lowercase, as Android sends them
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R4 / every path that rewrites a product's stockMoves records the moves it holds first", () => {
  /** A product the old server left: 50 moves in its list, none of them in stock_ops (the migration's backfill missed them, or an
   * old function instance wrote them after it ran). */
  const seedFull = async () => {
    const stored = window(49, 50);
    await upsertRecord(sql, SHOP_ID, "product", "p1", PRODUCT(100, stored), false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "oA", ORDER("newOrder", 3), false, OWNER_ID);
    expect((await opRows()).length).toBe(0);
    return stored;
  };
  const expectRecorded = async (moves: Record<string, unknown>[]) => {
    const keys = await opKeys();
    for (const move of moves) expect(keys.has(moveKey(move)), String(move.id)).toBe(true);
  };

  it("the server's own stock effect (an order's ledger): the oldest move the new one pushes off the list is recorded, and every other", async () => {
    const stored = await seedFull();
    await push(ownerPhone, [ch("order", "oA", ORDER("confirmed", 3, { p1: 3 }), await seqOf("order", "oA"))]);
    const after = await productNow();
    expect(after.stockQuantity).toBe(97);
    expect(after.stockMoves).toHaveLength(50);
    expect(after.stockMoves.map((m) => m.id)).not.toContain("h0"); // the oldest was trimmed
    await expectRecorded(stored);
  });

  for (const phone of [ownerPhone, productsPhone]) {
    it(`a client push merged onto the stored list (${phone.name}): a new move pushes the oldest off, all are recorded first`, async () => {
      const stored = await seedFull();
      const fresh = { id: "n1", delta: 5, reason: "received", orderId: null, note: null, at: T(60) };
      await push(phone, [ch("product", "p1", PRODUCT(105, [fresh, ...stored]), await seqOf("product", "p1"))]);
      expect(await stockNow()).toBe(105);
      expect((await productNow()).stockMoves.map((m) => m.id)).not.toContain("h0");
      await expectRecorded(stored);
      expect((await opKeys()).has("id:n1")).toBe(true);
    });
  }

  it("a plain owner push that replaces the list (no stockMoves in it): the moves it replaces are recorded", async () => {
    const stored = await seedFull();
    const { stockMoves: _drop, ...noList } = PRODUCT(100, []);
    void _drop;
    await push(ownerPhone, [ch("product", "p1", { ...noList, priceMinor: 7000 }, await seqOf("product", "p1"))]);
    expect((await productNow() as unknown as { stockMoves?: unknown }).stockMoves).toBeUndefined();
    await expectRecorded(stored);
  });

  it("a product that is deleted and one that comes back with another list: the moves of both versions are recorded", async () => {
    const stored = await seedFull();
    await push(ownerPhone, [ch("product", "p1", PRODUCT(100, stored.slice(0, 10)), await seqOf("product", "p1"), true)]); // deleted, carrying a shorter list
    await expectRecorded(stored);
    const comeBack = window(80, 20);
    await push(ownerPhone, [ch("product", "p1", PRODUCT(100, comeBack), await seqOf("product", "p1"))]);
    expect((await productNow()).stockMoves).toHaveLength(20);
    await expectRecorded(stored);
    // The list it came back with is the stored one now: recorded when it is next rewritten.
    await push(ownerPhone, [ch("product", "p1", PRODUCT(100, [{ id: "z", delta: 1, reason: "received", orderId: null, note: null, at: T(90) }]), await seqOf("product", "p1"))]);
    await expectRecorded(comeBack);
  });

  it("a brand-new product has nothing stored to record, and its pushes write no stock_ops rows of their own", async () => {
    await push(ownerPhone, [ch("product", "p1", PRODUCT(5, window(3, 3)), 0)]);
    expect((await opRows()).length).toBe(0);
    expect((await productNow()).stockMoves).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R4 acceptance / a populated database, the migration file, an order confirmation, an offline phone's old snapshot", () => {
  /** The shop as the old server left it: quantity 100 and 50 historical moves (iOS-style uppercase ids, one move with no id among
   * them: a legacy Android row), and an order of 3 units that was never confirmed. The old server never wrote stock_ops. The
   * OLDEST move, the one the confirmation will trim, has an id (`id`) or has none (`legacy`). */
  const populate = async (oldest: "id" | "legacy") => {
    const historical: Record<string, unknown>[] = window(49, 50, true); // H49 ... H0, newest first
    historical[20] = { delta: 1, reason: "received", orderId: null, note: null, at: T(29) }; // a legacy row in the middle
    if (oldest === "legacy") historical[49] = { delta: 1, reason: "received", orderId: null, note: null, at: T(0) };
    await upsertRecord(sql, SHOP_ID, "product", "p1", PRODUCT(100, historical), false, OWNER_ID);
    await upsertRecord(sql, SHOP_ID, "order", "oA", ORDER("newOrder", 3), false, OWNER_ID);
    return historical;
  };

  for (const oldest of ["id", "legacy"] as const) {
    for (const phone of [ownerPhone, productsPhone]) {
     for (const confirmation of ["the order alone", "the phone's batch (its product with its own move, then the order)"] as const) {
      it(`oldest move with ${oldest === "id" ? "an id" : "no id"}, ${phone.name}, confirmed by ${confirmation}: 97 after the first write, the old snapshot replayed (twice) leaves 97, a new offline move applies exactly once`, async () => {
        const historical = await populate(oldest);
        expect((await opRows()).length).toBe(0);

        await execCloudTestSql(migration); // the real file
        expect((await opRows()).length).toBe(50); // every move of the list, with the keys the runtime computes
        for (const move of historical) expect((await opKeys()).has(moveKey(move))).toBe(true);

        // The first write that touches the product is an order confirmation: 3 units, 97, and the oldest move leaves the list.
        const confirm = ch("order", "oA", ORDER("confirmed", 3, { p1: 3 }), await seqOf("order", "oA"));
        if (confirmation === "the order alone") await push(ownerPhone, [confirm]);
        else await push(ownerPhone, [ch("product", "p1", PRODUCT(97, [{ id: "c1", delta: -3, reason: "orderConfirmed", orderId: "oA", note: null, at: T(65) }, ...historical]), await seqOf("product", "p1")), confirm]);
        expect(await stockNow()).toBe(97);
        const listed = (await productNow()).stockMoves;
        expect(listed).toHaveLength(50);
        const trimmed = historical[49]!;
        expect(listed.some((m) => moveKey(m) === moveKey(trimmed))).toBe(false); // the oldest is off the display list...
        expect((await opKeys()).has(moveKey(trimmed))).toBe(true); // ...and still known

        // An offline phone replays its old snapshot (quantity 100 and the 50 moves as it held them): nothing is added or restored.
        const snapshot = () => ch("product", "p1", PRODUCT(100, historical), 1);
        await push(phone, [snapshot()]);
        expect(await stockNow()).toBe(97);
        await push(phone, [snapshot()]);
        expect(await stockNow()).toBe(97);

        // The same snapshot with one new offline move: the new move applies once (+5), the old ones never again.
        const offline = { id: "offline-1", delta: 5, reason: "received", orderId: null, note: null, at: T(70) };
        const withNew = () => ch("product", "p1", PRODUCT(105, [offline, ...historical]), 1);
        await push(phone, [withNew()]);
        expect(await stockNow()).toBe(102);
        await push(phone, [withNew()]);
        await push(phone, [snapshot()]);
        await push(ownerPhone, [withNew()]);
        expect(await stockNow()).toBe(102);

        // Cancelling the order gives its 3 units back, once.
        await push(ownerPhone, [ch("order", "oA", ORDER("cancelled", 3, {}), await seqOf("order", "oA"))]);
        expect(await stockNow()).toBe(105);
      });
     }
    }
  }
});
