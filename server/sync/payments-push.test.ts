// Payments from two devices both survive (third review, 3 Oct 2026, F4), through the real push path against a real (WASM)
// Postgres. Two devices record different payments on the same order from the same copy; the order record is
// last-writer-wins, so the later push used to replace the other device's payment. A stale push (its baseSeq is behind the
// stored seq) now keeps the stored payments it lacks; only an up-to-date copy may remove one. Pure rules:
// record-access.test.ts ("decidePush / F4") and payments-merge.test.ts.

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
type Phone = typeof ownerPhone;

const AT = "2026-10-03T08:00:00.000Z";
const payA = { id: "payA", amountMinor: 2000, method: "cash", note: null, paidAt: AT };
const payB = { id: "payB", amountMinor: 3000, method: "benefit", note: null, paidAt: AT };
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

let base: number;
beforeEach(async () => {
  sql = await createCloudTestSql();
  await upsertUser(sql, { id: OWNER_ID, provider: "apple", providerSub: "owner-sub" });
  await insertShopCloud(sql, { id: SHOP_ID, ownerUserId: OWNER_ID, name: "Sara's Cakes" });
  expect(await push(ownerPhone, ORDER([], "unpaid"), 0)).toEqual({ conflicts: [], rejected: [] });
  base = (await orderNow()).seq;
});

const PAIRS: [Phone, Phone][] = [[ownerPhone, ownerPhone], [ordersPhone, ownerPhone], [moneyPhone, moneyPhone], [ownerPhone, moneyPhone]];

describe("F4 / payments A (2,000) and B (3,000) from the same base both survive", () => {
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

  it("a deliberate removal from an up-to-date copy still removes; from a stale copy it does not", async () => {
    await push(ownerPhone, ORDER([payA], "deposit"), base);
    await push(moneyPhone, ORDER([payB], "deposit"), base); // union: A and B
    // The stale copy (it never saw A or B) leaves a payment out: nothing is removed.
    await push(ownerPhone, ORDER([], "unpaid"), base);
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    // An up-to-date copy (based on the seq the server holds now) removes B on purpose.
    const upToDate = (await orderNow()).seq;
    expect((await push(ownerPhone, ORDER([payA], "deposit"), upToDate)).conflicts).toEqual([]);
    expect(await paymentIds()).toEqual(["payA"]);
    expect((await orderNow()).data.paymentStatus).toBe("deposit");
    // ...and money-only staff too.
    expect((await push(moneyPhone, ORDER([], "unpaid"), (await orderNow()).seq)).conflicts).toEqual([]);
    expect(await paymentIds()).toEqual([]);
    expect((await orderNow()).data.paymentStatus).toBe("unpaid");
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

  it("the rest of a stale whole-order push stands (items, notes), only the payments are merged", async () => {
    await push(moneyPhone, ORDER([payA], "deposit"), base);
    await push(ownerPhone, ORDER([payB], "deposit", { notes: "B's note", deliveryFeeMinor: 500 }), base);
    const stored = (await orderNow()).data;
    expect(stored).toMatchObject({ notes: "B's note", deliveryFeeMinor: 500 });
    expect(await paymentIds()).toEqual(["payA", "payB"]);
    expect(stored.paymentStatus).toBe("deposit"); // 5,000 of 5,500 now
  });

  it("an order pushed by prepare-only staff never touches payments", async () => {
    await push(moneyPhone, ORDER([payA], "deposit"), base);
    const preparePhone = { name: "prepare staff", member: staff({ prepare: true }), by: STAFF_ID };
    await push(preparePhone, ORDER([], "unpaid", { status: "ready" }), base);
    expect(await paymentIds()).toEqual(["payA"]);
    expect((await orderNow()).data.status).toBe("ready");
  });
});
