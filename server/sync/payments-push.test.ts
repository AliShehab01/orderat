// Payments are add-only (third review, 3 Oct 2026, F4; fourth review, same day, R2 and R3), through the real push path against a
// real (WASM) Postgres. The absence of a payment in a pushed order never removes it, whatever the push's baseSeq; a payment is
// removed by listing its id in the order's grow-only `removedPaymentIds` (or, for the released iOS 1.0, by its history entry).
// Every scenario is a deterministic interleaving of phones' pushes with explicit baseSeqs, each with retries. Pure rules:
// payments-merge.test.ts and record-access.test.ts ("decidePush / payments").

import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { upsertUser } from "../auth/store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { DEFAULT_STAFF_PERMISSIONS, type Member } from "./permissions.ts";
import { pushChanges } from "./push-pull.ts";
import { findRecord, insertShopCloud } from "./store.ts";
import type { ChangeInput } from "./validate.ts";

let sql: SqlClient;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const SHOP_ID = "33333333-3333-3333-3333-333333333333";
const staff = (flags: Partial<Member["permissions"]>): Member => ({ role: "staff", permissions: { ...DEFAULT_STAFF_PERMISSIONS, ...flags } });
const ownerPhone = { name: "owner", member: { role: "owner", permissions: DEFAULT_STAFF_PERMISSIONS } as Member, by: OWNER_ID };
const ordersPhone = { name: "orders staff", member: staff({ orders: true }), by: STAFF_ID };
const moneyPhone = { name: "money staff", member: staff({ money: true }), by: STAFF_ID };
const preparePhone = { name: "prepare staff", member: staff({ prepare: true }), by: STAFF_ID };
const productsPhone = { name: "products staff", member: staff({ products: true }), by: STAFF_ID };
const nonePhone = { name: "staff with no permission", member: staff({}), by: STAFF_ID };
type Phone = typeof ownerPhone;
/** The members who may write payments, and what each of them pushes of an order. */
const WRITERS: Phone[] = [ownerPhone, ordersPhone, moneyPhone];

const AT = "2026-10-03T08:00:00.000Z";
const payA = { id: "payA", amountMinor: 2000, method: "cash", note: null, paidAt: AT };
const payB = { id: "payB", amountMinor: 3000, method: "benefit", note: null, paidAt: AT };
const payC = { id: "payC", amountMinor: 500, method: "cash", note: null, paidAt: AT };
/** A 5,000 order: one line, no delivery fee, no VAT. */
const ORDER = (payments: unknown[], paymentStatus: string, extra: Record<string, unknown> = {}) => ({
  customerId: "c1",
  status: "confirmed",
  fulfillmentType: "pickup",
  deliveryFeeMinor: 0,
  items: [{ id: "i1", productId: null, nameSnapshot: "Cake", quantity: 1, unitPriceMinor: 5000, unitCostMinor: 2000 }],
  paymentStatus,
  payments,
  changes: [],
  updatedAt: AT,
  ...extra,
});

const push = (phone: Phone, data: Record<string, unknown>, baseSeq: number) => {
  const change: ChangeInput = { entity: "order", id: "o1", data, deleted: false, baseSeq };
  return pushChanges(sql, SHOP_ID, phone.member, [change], phone.by);
};
const orderNow = async () => (await findRecord(sql, SHOP_ID, "order", "o1"))!;
const paymentIds = async () => ((await orderNow()).data.payments as { id: string }[]).map((p) => p.id);
const removedNow = async () => (await orderNow()).data.removedPaymentIds;
const seqNow = async () => (await orderNow()).seq;

/** The order exists with nothing paid: every scenario starts from here (seq `base`). */
let base: number;
beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  expect(await push(ownerPhone, ORDER([], "unpaid"), 0)).toEqual({ conflicts: [], rejected: [] });
  base = await seqNow();
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R3 / a removal accepted from an up-to-date phone is not undone by an older phone's copy that still holds the payment", () => {
  for (const remover of WRITERS) {
    for (const older of [...WRITERS, preparePhone]) {
      it(`${remover.name} removes A; ${older.name}'s older copy still holding A edits something else: A stays removed (and a retry changes nothing)`, async () => {
        await push(ownerPhone, ORDER([payA], "deposit"), base);
        const holding = await seqNow(); // both phones hold A at this seq
        expect(await paymentIds()).toEqual(["payA"]);

        expect((await push(remover, ORDER([], "unpaid", { removedPaymentIds: ["payA"] }), holding)).conflicts).toEqual([]);
        expect(await paymentIds()).toEqual([]);
        expect(await removedNow()).toEqual(["payA"]);
        expect((await orderNow()).data.paymentStatus).toBe("unpaid");

        // The older phone (it never saw the removal) pushes a notes/status edit, still holding A, based on `holding`.
        const olderPush = ORDER([payA], "deposit", { notes: "edited on the older phone", status: "ready" });
        const result = await push(older, olderPush, holding);
        expect(result.rejected).toEqual([]);
        expect(result.conflicts).toEqual([{ entity: "order", id: "o1", seq: expect.any(Number) }]); // stale: reported, applied
        expect(await paymentIds()).toEqual([]);
        expect(await removedNow()).toEqual(["payA"]);
        expect((await orderNow()).data.paymentStatus).toBe("unpaid");
        // The edit itself landed, as far as the member may write it: money-only staff write no status or notes.
        if (older.member.role === "owner" || older.member.permissions.orders || older.member.permissions.prepare) expect((await orderNow()).data).toMatchObject({ status: "ready" });
        if (older.member.role === "owner" || older.member.permissions.orders) expect((await orderNow()).data).toMatchObject({ notes: "edited on the older phone" });

        for (let retry = 0; retry < 2; retry++) {
          await push(older, olderPush, holding);
          await push(remover, ORDER([], "unpaid", { removedPaymentIds: ["payA"] }), holding);
          expect(await paymentIds()).toEqual([]);
          expect(await removedNow()).toEqual(["payA"]);
        }
      });
    }
  }

  it("with another surviving payment too: B stays, A stays removed, and the status follows what is left", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    await push(moneyPhone, ORDER([payA, payB], "paid"), await seqNow());
    const holding = await seqNow();
    expect(await paymentIds()).toEqual(["payA", "payB"]);

    await push(ordersPhone, ORDER([payB], "deposit", { removedPaymentIds: ["payA"] }), holding);
    expect(await paymentIds()).toEqual(["payB"]);
    // The older copy holds both and says "paid".
    await push(ownerPhone, ORDER([payA, payB], "paid", { notes: "older" }), holding);
    expect(await paymentIds()).toEqual(["payB"]);
    expect(await removedNow()).toEqual(["payA"]);
    expect((await orderNow()).data).toMatchObject({ paymentStatus: "deposit", notes: "older" }); // 3,000 of 5,000
  });

  for (const arrival of ["removal first", "addition first"] as const) {
    it(`a payment added concurrently survives (${arrival}): C is stored whichever push arrives first, A stays removed`, async () => {
      await push(ownerPhone, ORDER([payA], "deposit"), base);
      const holding = await seqNow();
      const removal = () => push(ownerPhone, ORDER([], "unpaid", { removedPaymentIds: ["payA"] }), holding);
      const addition = () => push(moneyPhone, ORDER([payA, payC], "deposit"), holding); // the older phone adds C on top of its copy
      if (arrival === "removal first") { await removal(); await addition(); } else { await addition(); await removal(); }
      expect(await paymentIds()).toEqual(["payC"]);
      expect(await removedNow()).toEqual(["payA"]);
      expect((await orderNow()).data.paymentStatus).toBe("deposit");
      await removal();
      await addition();
      expect(await paymentIds()).toEqual(["payC"]);
    });
  }

  it("the removal ids are grow-only: a later push that lists none (or other ids) never drops one", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    await push(ownerPhone, ORDER([payB], "deposit", { removedPaymentIds: ["payA"] }), await seqNow());
    await push(ordersPhone, ORDER([payB], "deposit"), await seqNow()); // an older app that does not know the field
    expect(await removedNow()).toEqual(["payA"]);
    await push(ownerPhone, ORDER([], "unpaid", { removedPaymentIds: ["payB"] }), await seqNow());
    expect(await removedNow()).toEqual(["payA", "payB"]);
    await push(ownerPhone, ORDER([payA, payB], "paid", { removedPaymentIds: [] }), await seqNow());
    expect(await removedNow()).toEqual(["payA", "payB"]);
    expect(await paymentIds()).toEqual([]);
  });

  it("ids are matched without case: iOS lists an uppercase UUID, the payment was written lowercase by Android", async () => {
    const lower = { ...payA, id: "3f2a9c1e-0000-4000-8000-000000000001" };
    await push(ownerPhone, ORDER([lower], "deposit"), base);
    await push(ownerPhone, ORDER([], "unpaid", { removedPaymentIds: ["3F2A9C1E-0000-4000-8000-000000000001"] }), await seqNow());
    expect(await paymentIds()).toEqual([]);
    await push(ownerPhone, ORDER([lower], "deposit"), base);
    expect(await paymentIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R2 / the iOS wire sequence: an old payments list with the CURRENT seq is not a deliberate removal", () => {
  for (const phone1 of WRITERS) {
    it(`phone 1 (${phone1.name}) holds [A]; phone 2 adds B; phone 1 pushes [A] with the current seq: A and B are both stored (5,000, paid)`, async () => {
      await push(ownerPhone, ORDER([payA], "deposit"), base);
      const phone1Copy = [payA]; // what phone 1 holds
      await push(ordersPhone, ORDER([payA, payB], "paid"), await seqNow()); // phone 2 adds B
      expect(await paymentIds()).toEqual(["payA", "payB"]);

      // iOS refreshed its recorded seq for the record it skipped: the push looks up to date, with its old list.
      const result = await push(phone1, ORDER(phone1Copy, "deposit", { notes: "edited meanwhile" }), await seqNow());
      expect(result.rejected).toEqual([]);
      expect(result.conflicts).toEqual([]); // it IS based on the current seq, as far as the server can tell
      expect(await paymentIds()).toEqual(["payA", "payB"]);
      expect((await orderNow()).data.payments).toEqual([payA, payB]);
      expect((await orderNow()).data.paymentStatus).toBe("paid"); // recomputed: the phone said "deposit"
      expect(await removedNow()).toBeUndefined();

      // Retries and the reverse arrival change nothing.
      await push(phone1, ORDER(phone1Copy, "deposit"), await seqNow());
      expect(await paymentIds()).toEqual(["payA", "payB"]);
    });
  }

  it("with every kind of baseSeq (up to date, stale, newer than the server's, none at all) an empty list removes nothing", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    const current = await seqNow();
    for (const baseSeq of [0, base, current - 1, current, current + 100]) {
      for (const phone of WRITERS) {
        await push(phone, ORDER([], "unpaid"), baseSeq);
        expect(await paymentIds(), `${phone.name} base ${baseSeq}`).toEqual(["payA", "payB"]);
        expect((await orderNow()).data.paymentStatus).toBe("paid");
      }
    }
    // A change with no baseSeq on the wire at all arrives as 0 (server/sync/validate.ts).
    await pushChanges(sql, SHOP_ID, ownerPhone.member, [{ entity: "order", id: "o1", data: ORDER([], "unpaid"), deleted: false } as unknown as ChangeInput], OWNER_ID);
    expect(await paymentIds()).toEqual(["payA", "payB"]);
  });

  it("a push that carries no payments list at all (an app that does not write one) keeps the stored list", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    const { payments: _omit, ...withoutList } = ORDER([], "unpaid", { notes: "no list" });
    void _omit;
    await push(ownerPhone, withoutList, await seqNow());
    expect(await paymentIds()).toEqual(["payA"]);
    expect((await orderNow()).data).toMatchObject({ notes: "no list", paymentStatus: "deposit" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the released iOS 1.0 deletes by absence and logs `payment: <amount> -> removed`", () => {
  const entry = (id: string, amount: string, at = "2026-10-03T09:00:00.000Z") => ({ id, field: "payment", oldValue: amount, newValue: "removed", note: null, at });

  for (const phone of WRITERS) {
    it(`${phone.name}: a push without removedPaymentIds, A missing, and that entry removes A and records it; without the entry A is kept; retries are stable`, async () => {
      await push(ownerPhone, ORDER([payA, payB], "paid"), base);
      const synced = await seqNow();

      // Without the history entry A is only missing: kept.
      await push(phone, ORDER([payB], "deposit"), synced);
      expect(await paymentIds()).toEqual(["payA", "payB"]);
      expect(await removedNow()).toBeUndefined();

      // With the entry for A's amount (2,000): removed and recorded, and iOS's own status stands.
      const removal = ORDER([payB], "deposit", { changes: [entry("h1", "2000")] });
      expect((await push(phone, removal, await seqNow())).rejected).toEqual([]);
      expect(await paymentIds()).toEqual(["payB"]);
      expect(await removedNow()).toEqual(["payA"]);
      expect((await orderNow()).data.paymentStatus).toBe("deposit");
      expect(((await orderNow()).data.changes as { id: string }[]).map((c) => c.id)).toEqual(["h1"]); // its history entry is kept

      // The same push again (the entry is stored now), and a stale iOS copy that still holds A: nothing comes back.
      await push(phone, removal, await seqNow());
      await push(phone, ORDER([payA, payB], "paid", { changes: [] }), synced);
      expect(await paymentIds()).toEqual(["payB"]);
      expect(await removedNow()).toEqual(["payA"]);
    });
  }

  it("ambiguous means keep: two stored payments of the amount are missing and one entry says one was removed", async () => {
    const a2 = { ...payA, id: "payA2" };
    await push(ownerPhone, ORDER([payA, a2], "paid"), base);
    await push(ownerPhone, ORDER([], "unpaid", { changes: [entry("h1", "2000")] }), await seqNow());
    expect(await paymentIds()).toEqual(["payA", "payA2"]);
    expect(await removedNow()).toBeUndefined();
    // Two NEW entries (h1 is stored by now) and two missing payments: both are removed.
    await push(ownerPhone, ORDER([], "unpaid", { changes: [entry("h1", "2000"), entry("h2", "2000"), entry("h3", "2000")] }), await seqNow());
    expect(await paymentIds()).toEqual([]);
    expect(await removedNow()).toEqual(["payA", "payA2"]);
  });

  it("only the amount its entry names is removed: a payment the removing phone never saw (B) stays", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    await push(ownerPhone, ORDER([], "unpaid", { changes: [entry("h1", "2000")] }), await seqNow()); // never saw B
    expect(await paymentIds()).toEqual(["payB"]);
    expect(await removedNow()).toEqual(["payA"]);
  });

  it("prepare-only staff cannot remove payments this way either", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    await push(preparePhone, ORDER([payB], "deposit", { status: "ready", changes: [entry("h1", "2000")] }), await seqNow());
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    expect(await removedNow()).toBeUndefined();
    expect((await orderNow()).data).toMatchObject({ status: "ready", paymentStatus: "paid" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R2 + R3 / a payment recorded and removed before the sync that carried it returned", () => {
  for (const arrival of ["the creation first", "the removal first (a late retry of the creation)"] as const) {
    for (const phone of WRITERS) {
      it(`${phone.name}: add P, remove P (${arrival}): P is gone and stays gone`, async () => {
        const P = { id: "payP", amountMinor: 4000, method: "cash", note: null, paidAt: AT };
        const creation = () => push(phone, ORDER([P], "deposit"), base); // in flight when the user removes P
        const removal = () => push(phone, ORDER([], "unpaid", { removedPaymentIds: ["payP"] }), base); // still based on the older copy
        if (arrival === "the creation first") { await creation(); await removal(); } else { await removal(); await creation(); }
        expect(await paymentIds()).toEqual([]);
        expect(await removedNow()).toEqual(["payP"]);
        expect((await orderNow()).data.paymentStatus).toBe("unpaid");
        await creation();
        await removal();
        expect(await paymentIds()).toEqual([]);
      });
    }
  }

  it("the released iOS 1.0, add P then remove P: the creation then the removal entry removes it, and a retry of the creation does not bring it back", async () => {
    const P = { id: "payP", amountMinor: 4000, method: "cash", note: null, paidAt: AT };
    const removal = ORDER([], "unpaid", { changes: [{ id: "h1", field: "payment", oldValue: "4000", newValue: "removed", note: null, at: "2026-10-03T09:00:00.000Z" }] });
    await push(ownerPhone, ORDER([P], "deposit"), base);
    await push(ownerPhone, removal, base);
    expect(await paymentIds()).toEqual([]);
    expect(await removedNow()).toEqual(["payP"]);
    await push(ownerPhone, ORDER([P], "deposit"), base); // a retry of the creation
    expect(await paymentIds()).toEqual([]);
  });

  it("known limit (released iOS 1.0 only): a removal that reaches the server BEFORE the creation it undoes names no stored payment, so a late creation is stored", async () => {
    const P = { id: "payP", amountMinor: 4000, method: "cash", note: null, paidAt: AT };
    const removal = ORDER([], "unpaid", { changes: [{ id: "h1", field: "payment", oldValue: "4000", newValue: "removed", note: null, at: "2026-10-03T09:00:00.000Z" }] });
    await push(ownerPhone, removal, base);
    await push(ownerPhone, ORDER([P], "deposit"), base); // the creation arrives late (a phone's own pushes arrive in order; only a lost-response retry can do this)
    expect(await paymentIds()).toEqual(["payP"]);
    expect(await removedNow()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("F4 / payments A (2,000) and B (3,000) from the same base both survive", () => {
  const PAIRS: [Phone, Phone][] = [[ownerPhone, ownerPhone], [ordersPhone, ownerPhone], [moneyPhone, moneyPhone], [ownerPhone, moneyPhone]];
  for (const [phoneA, phoneB] of PAIRS) {
    for (const arrival of ["A then B", "B then A"] as const) {
      it(`${phoneA.name} + ${phoneB.name}, ${arrival}: both are stored (5,000), the status follows them, and retries duplicate nothing`, async () => {
        const fromA = () => push(phoneA, ORDER([payA], "deposit"), base);
        const fromB = () => push(phoneB, ORDER([payB], "deposit"), base);
        const [first, second] = arrival === "A then B" ? [fromA, fromB] : [fromB, fromA];

        expect(await first()).toEqual({ conflicts: [], rejected: [] });
        const result = await second();
        expect(result.rejected).toEqual([]);
        expect(result.conflicts).toEqual([{ entity: "order", id: "o1", seq: expect.any(Number) }]); // stale: reported, applied
        const stored = (await orderNow()).data;
        expect((stored.payments as { id: string }[]).map((p) => p.id).sort()).toEqual(["payA", "payB"]);
        expect((stored.payments as { amountMinor: number }[]).reduce((sum, p) => sum + p.amountMinor, 0)).toBe(5000);
        expect(stored.paymentStatus).toBe("paid"); // neither phone knew: each alone thought "deposit"

        // Retries of either push (still carrying the old base) add nothing and remove nothing.
        const settled = await paymentIds();
        for (let retry = 0; retry < 2; retry++) {
          await fromA();
          await fromB();
          expect(await paymentIds()).toEqual(settled);
        }
        expect((await orderNow()).data.paymentStatus).toBe("paid");
      });
    }
  }

  it("a payment present in both takes the incoming copy (an amount corrected on one phone)", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    const corrected = { ...payA, amountMinor: 2500, note: "corrected" };
    await push(ordersPhone, ORDER([corrected, payB], "paid"), base); // 2,500 + 3,000: the pushing phone knows both
    expect((await orderNow()).data.payments).toEqual([corrected, payB]);
    expect((await orderNow()).data.paymentStatus).toBe("paid");
  });

  it("a deliberate removal still removes, from an up-to-date or a stale copy alike, and only by id", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    await push(moneyPhone, ORDER([payB], "deposit"), base); // union: A and B
    // A copy that leaves a payment out removes nothing, stale or up to date.
    await push(ownerPhone, ORDER([], "unpaid"), base);
    await push(ownerPhone, ORDER([], "unpaid"), await seqNow());
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    // Listing B's id removes it...
    expect((await push(ownerPhone, ORDER([payA], "deposit", { removedPaymentIds: ["payB"] }), await seqNow())).conflicts).toEqual([]);
    expect(await paymentIds()).toEqual(["payA"]);
    expect((await orderNow()).data.paymentStatus).toBe("deposit");
    // ...and money-only staff may do it too, from a stale copy as well.
    expect((await push(moneyPhone, ORDER([], "unpaid", { removedPaymentIds: ["payA"] }), base)).rejected).toEqual([]);
    expect(await paymentIds()).toEqual([]);
    expect((await orderNow()).data.paymentStatus).toBe("unpaid");
    expect(await removedNow()).toEqual(["payB", "payA"]);
  });

  it("an order write landing between a push's read and its write: the compare-and-swap fails, and the retry keeps both payments", async () => {
    // B reads the order (no payments), A's push lands, B writes: its check on the seq fails and B is decided again on A's copy.
    const aLands = async () => { await push(ownerPhone, ORDER([payA], "deposit"), base); };
    let left = 1;
    const racing: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        const rows = await sql.query<T>(text, params);
        if (left > 0 && /from orderat\.records where shop_id = \$1 and entity = \$2 and id = \$3/.test(text)) {
          left--;
          await aLands();
        }
        return rows;
      },
    };
    const result = await pushChanges(racing, SHOP_ID, ordersPhone.member, [{ entity: "order", id: "o1", data: ORDER([payB], "deposit"), deleted: false, baseSeq: base }], STAFF_ID);
    expect(result.rejected).toEqual([]);
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    expect((await orderNow()).data.paymentStatus).toBe("paid");
  });

  it("a removal racing a payment added by another phone: both land (the other phone's write is re-read, then merged)", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    const holding = await seqNow();
    const cLands = async () => { await push(moneyPhone, ORDER([payA, payC], "deposit"), holding); };
    let left = 1;
    const racing: SqlClient = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
        const rows = await sql.query<T>(text, params);
        if (left > 0 && /from orderat\.records where shop_id = \$1 and entity = \$2 and id = \$3/.test(text)) {
          left--;
          await cLands();
        }
        return rows;
      },
    };
    await pushChanges(racing, SHOP_ID, ordersPhone.member, [{ entity: "order", id: "o1", data: ORDER([], "unpaid", { removedPaymentIds: ["payA"] }), deleted: false, baseSeq: holding }], STAFF_ID);
    expect(await paymentIds()).toEqual(["payC"]);
    expect(await removedNow()).toEqual(["payA"]);
  });

  it("the rest of a stale whole-order push stands (items, notes), only the payments are merged", async () => {
    await push(moneyPhone, ORDER([payA], "deposit"), base);
    await push(ownerPhone, ORDER([payB], "deposit", { notes: "B's note", deliveryFeeMinor: 500 }), base);
    const stored = (await orderNow()).data;
    expect(stored).toMatchObject({ notes: "B's note", deliveryFeeMinor: 500 });
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    expect(stored.paymentStatus).toBe("deposit"); // 5,000 of 5,500 now
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("who may write payments and removal ids, and what an invalid value does", () => {
  beforeEach(async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid", { removedPaymentIds: ["old"] }), base);
  });

  it("money-only staff remove a payment by id; the rest of what they send (items, notes, status) is not stored", async () => {
    const before = (await orderNow()).data;
    await push(moneyPhone, ORDER([payB], "deposit", { removedPaymentIds: ["payA"], notes: "sneaky", status: "cancelled", items: [] }), await seqNow());
    const after = (await orderNow()).data;
    expect(after.payments).toEqual([payB]);
    expect(after.removedPaymentIds).toEqual(["old", "payA"]);
    expect(after.paymentStatus).toBe("deposit");
    expect(after.notes).toBeUndefined();
    expect(after.status).toBe("confirmed");
    expect(after.items).toEqual(before.items);
  });

  it("prepare-only staff cannot remove a payment: their status change lands, the payments and the stored ids stay", async () => {
    await push(preparePhone, ORDER([], "unpaid", { removedPaymentIds: ["payA", "payB"], status: "ready" }), await seqNow());
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    expect(await removedNow()).toEqual(["old"]);
    expect((await orderNow()).data).toMatchObject({ status: "ready", paymentStatus: "paid" });
  });

  it("a member with neither permission is refused, and the order does not change", async () => {
    for (const phone of [nonePhone, productsPhone]) {
      const result = await push(phone, ORDER([], "unpaid", { removedPaymentIds: ["payA", "payB"] }), await seqNow());
      expect(result.rejected).toEqual([expect.objectContaining({ entity: "order", id: "o1", reason: "forbidden" })]);
      expect(await paymentIds()).toEqual(["payA", "payB"]);
      expect(await removedNow()).toEqual(["old"]);
    }
  });

  it("an invalid removedPaymentIds is ignored as a whole (the push still lands): a string, a mixed array, an empty id, 65 characters, 501 ids", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => (i === 0 ? "payA" : `x${i}`));
    for (const bad of ["payA", ["payA", 7], ["payA", ""], ["payA", "x".repeat(65)], tooMany]) {
      for (const phone of WRITERS) {
        const result = await push(phone, ORDER([payB], "deposit", { removedPaymentIds: bad, notes: "pushed" }), await seqNow());
        expect(result.rejected).toEqual([]);
        expect(await paymentIds(), `${phone.name} ${JSON.stringify(bad)?.slice(0, 30)}`).toEqual(["payA", "payB"]);
        expect(await removedNow()).toEqual(["old"]);
      }
    }
  });

  it("500 valid ids are accepted, and so is an id of 64 characters", async () => {
    const long = "y".repeat(64);
    const withLong = { ...payC, id: long };
    await push(ownerPhone, ORDER([payA, payB, withLong], "paid", { removedPaymentIds: ["old"] }), await seqNow());
    const ids = Array.from({ length: 500 }, (_, i) => (i === 0 ? "payA" : i === 1 ? long : `x${i}`));
    await push(moneyPhone, ORDER([payB], "deposit", { removedPaymentIds: ids }), await seqNow());
    expect(await paymentIds()).toEqual(["payB"]);
    expect(((await removedNow()) as string[]).length).toBe(501); // "old" and the 500
  });

  it("a payment id listed as removed that appears again in a stale push stays removed, however many times it is pushed", async () => {
    await push(ownerPhone, ORDER([payB], "deposit", { removedPaymentIds: ["payA"] }), await seqNow());
    for (let i = 0; i < 3; i++) {
      for (const phone of WRITERS) {
        await push(phone, ORDER([payA, payB], "paid"), base);
        expect(await paymentIds()).toEqual(["payB"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("released apps that send none of the new fields", () => {
  it("Android 1.5.5 and the web app of before this change delete a payment by leaving it out (Android logs only a paymentStatus entry): the payment stays, nothing is lost; adding one still works; an app that writes removedPaymentIds removes it", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    const synced = await seqNow();
    // Android's deletePayment: the payments list without A, and a history entry about the status only (what it was, what it is now).
    const androidDeletes = ORDER([payB], "deposit", { changes: [{ id: "h1", field: "paymentStatus", oldValue: "paid", newValue: "deposit", note: null, at: "2026-10-03T09:00:00.000Z" }] });
    for (const phone of WRITERS) {
      const result = await push(phone, androidDeletes, synced);
      expect(result.rejected).toEqual([]);
      expect(await paymentIds(), phone.name).toEqual(["payA", "payB"]); // it comes back on the phone's next pull
      expect((await orderNow()).data.paymentStatus).toBe("paid"); // the status is what the payments say
      expect(await removedNow()).toBeUndefined();
    }
    // The same phone records another payment: that works as always.
    await push(ordersPhone, ORDER([payB, payC], "paid"), await seqNow());
    expect(await paymentIds()).toEqual(["payA", "payB", "payC"]);
    // After an update the phone's deletion is the id.
    await push(ordersPhone, ORDER([payB, payC], "paid", { removedPaymentIds: ["payA"] }), await seqNow());
    expect(await paymentIds()).toEqual(["payB", "payC"]);
  });

  it("a pull gives every app the server's payments and removedPaymentIds, and the app that does not know the field sends it back as it found it (unknown keys are kept)", async () => {
    await push(ownerPhone, ORDER([payA, payB], "paid"), base);
    await push(ownerPhone, ORDER([payB], "deposit", { removedPaymentIds: ["payA"] }), await seqNow());
    const pulled = (await orderNow()).data;
    expect(pulled.removedPaymentIds).toEqual(["payA"]);
    // An older app pulls that, edits the notes and pushes the whole record back with the unknown key as it found it...
    await push(ordersPhone, { ...pulled, notes: "edited on an older app" }, await seqNow());
    expect((await orderNow()).data).toMatchObject({ notes: "edited on an older app", removedPaymentIds: ["payA"] });
    expect(await paymentIds()).toEqual(["payB"]);
    // ...and one that drops the key altogether changes nothing either.
    const { removedPaymentIds: _drop, ...without } = pulled;
    void _drop;
    await push(ordersPhone, { ...without, notes: "dropped the key" }, await seqNow());
    expect((await orderNow()).data).toMatchObject({ notes: "dropped the key", removedPaymentIds: ["payA"] });
    expect(await paymentIds()).toEqual(["payB"]);
  });
});
