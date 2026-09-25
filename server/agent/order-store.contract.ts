// One shared behavior contract, run against every OrderStore implementation, so MemoryStore and
// PostgresStore are proven to behave identically rather than trusted to by inspection. See
// server/agent/store.test.ts (MemoryStore) and server/agent/postgres-store.test.ts (PostgresStore,
// backed by PGlite — a real Postgres, so this also exercises the actual SQL in
// db/migrations/0001_orderat_isolation.sql and jsonb/timestamptz round-tripping, not just a mock).

import { beforeEach, describe, expect, it } from "vitest";
import type { OrderStore, StoredOrder } from "./store.ts";

/** A fresh, minimal, valid order. Override only the fields a test cares about. */
function order(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    order: {
      id: crypto.randomUUID(),
      customerName: "Sara",
      items: [{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 20 }],
      collectionAt: "2026-09-26T07:00:00.000Z",
      notes: undefined,
      status: "pending",
      changes: [],
      createdAt: "2026-09-21T06:00:00.000Z",
    },
    channel: "whatsapp",
    customerId: "97333333333",
    lang: "ar",
    sourceText: "بغيت 20 تشيز كيك كب للسبت",
    ...overrides,
  };
}

/**
 * Runs the OrderStore contract against a fresh store from `createStore()`, called before every
 * test so implementations don't need their own isolation/reset logic beyond that factory.
 */
export function describeOrderStoreContract(name: string, createStore: () => OrderStore | Promise<OrderStore>): void {
  describe(`OrderStore contract (${name})`, () => {
    let store: OrderStore;

    beforeEach(async () => {
      store = await createStore();
    });

    it("markSeen: true the first time a message id is seen, false on a retried delivery", async () => {
      const id = `wamid.${crypto.randomUUID()}`;
      expect(await store.markSeen(id)).toBe(true);
      expect(await store.markSeen(id)).toBe(false);
      expect(await store.markSeen(id)).toBe(false);
    });

    it("markSeen: different message ids are independent", async () => {
      expect(await store.markSeen("a")).toBe(true);
      expect(await store.markSeen("b")).toBe(true);
    });

    it("add + get: round-trips every field, including jsonb items/changes and an unset notes/collectionAt", async () => {
      const stored = order({
        order: {
          id: crypto.randomUUID(),
          customerName: "Ahmed",
          items: [
            { productId: "p-cheesecake", rawText: "تشيز كيك", quantity: 3 },
            { rawText: "براونيز بدون مكسرات", quantity: 12 },
          ],
          collectionAt: undefined,
          notes: undefined,
          status: "pending",
          changes: [],
          createdAt: "2026-09-21T06:00:00.000Z",
        },
      });
      await store.add(stored);
      const result = await store.get(stored.order.id);
      expect(result).toEqual(stored);
    });

    it("add + get: round-trips a set notes and collectionAt, and a non-empty changes list", async () => {
      const stored = order({
        order: {
          id: crypto.randomUUID(),
          customerName: "Layla",
          items: [{ productId: "p-brownie", rawText: "براونيز", quantity: 5 }],
          collectionAt: "2026-09-27T07:00:00.000Z",
          notes: "no nuts",
          status: "confirmed",
          changes: ["time: - -> 2026-09-27T07:00:00.000Z"],
          createdAt: "2026-09-22T10:15:30.000Z",
        },
      });
      await store.add(stored);
      const result = await store.get(stored.order.id);
      expect(result).toEqual(stored);
    });

    it("get: undefined for an id that was never added", async () => {
      expect(await store.get(crypto.randomUUID())).toBeUndefined();
    });

    it("update: merges the patch into the order and persists it", async () => {
      const stored = order({ order: { ...order().order, id: crypto.randomUUID(), status: "pending" } });
      await store.add(stored);
      const updated = await store.update(stored.order.id, { status: "confirmed", changes: ["confirmed by owner"] });
      expect(updated?.order.status).toBe("confirmed");
      expect(updated?.order.changes).toEqual(["confirmed by owner"]);
      // customerName wasn't in the patch, so it survives untouched.
      expect(updated?.order.customerName).toBe(stored.order.customerName);
      const persisted = await store.get(stored.order.id);
      expect(persisted).toEqual(updated);
    });

    it("update: an unknown order id returns undefined and adds nothing", async () => {
      expect(await store.update(crypto.randomUUID(), { status: "confirmed" })).toBeUndefined();
    });

    it("openOrdersFor: matches channel + customerId, excludes collected, newest first", async () => {
      const customerId = `cust-${crypto.randomUUID()}`;
      const older = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-20T06:00:00.000Z", status: "pending" },
      });
      const newer = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-21T06:00:00.000Z", status: "confirmed" },
      });
      const collected = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-22T06:00:00.000Z", status: "collected" },
      });
      const otherCustomer = order({
        channel: "whatsapp",
        customerId: `other-${crypto.randomUUID()}`,
        order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-23T06:00:00.000Z" },
      });
      const otherChannel = order({
        channel: "instagram",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-23T06:00:00.000Z" },
      });
      for (const s of [older, newer, collected, otherCustomer, otherChannel]) await store.add(s);

      const result = await store.openOrdersFor("whatsapp", customerId, new Date("2026-09-25T00:00:00.000Z"));
      expect(result.map((s) => s.order.id)).toEqual([newer.order.id, older.order.id]);
    });

    it("openOrdersFor: excludes an order whose collectionAt has already passed, keeps one with no collectionAt", async () => {
      const customerId = `cust-${crypto.randomUUID()}`;
      const now = new Date("2026-09-25T12:00:00.000Z");
      const past = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), collectionAt: "2026-09-24T00:00:00.000Z" },
      });
      const future = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), collectionAt: "2026-09-26T00:00:00.000Z" },
      });
      const openEnded = order({
        channel: "whatsapp",
        customerId,
        order: { ...order().order, id: crypto.randomUUID(), collectionAt: undefined },
      });
      for (const s of [past, future, openEnded]) await store.add(s);

      const result = await store.openOrdersFor("whatsapp", customerId, now);
      const ids = result.map((s) => s.order.id).sort();
      expect(ids).toEqual([future.order.id, openEnded.order.id].sort());
    });

    it("all: every added order, and nothing else — order.ts's own callers (e.g. server/owner/handler.ts) sort by createdAt themselves, so all() makes no ordering promise", async () => {
      const a = order({ order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-20T06:00:00.000Z" } });
      const b = order({ order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-22T06:00:00.000Z" } });
      const c = order({ order: { ...order().order, id: crypto.randomUUID(), createdAt: "2026-09-21T06:00:00.000Z" } });
      for (const s of [a, b, c]) await store.add(s);

      const result = await store.all();
      expect(result.map((s) => s.order.id).sort()).toEqual([a.order.id, b.order.id, c.order.id].sort());
    });
  });
}
