import { describe, expect, it } from "vitest";
import { SupabaseStore } from "./supabase-store";
import type { StoredOrder } from "./store";

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A fake fetch that records every call and returns canned responses in order (or `handler(call)` when given). */
function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    calls.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i++, responses.length - 1)];
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const CFG = { url: "https://demo-project.supabase.co", serviceRoleKey: "s3cret-service-role" };

const ROW = {
  id: "o1",
  channel: "whatsapp",
  customer_id: "97333333333",
  customer_name: "Sara",
  items: [{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 20 }],
  collection_at: "2026-09-26T07:00:00.000Z",
  notes: null,
  status: "pending",
  changes: [],
  lang: "ar",
  source_text: "بغيت 20 تشيز كيك كب للسبت",
  created_at: "2026-09-21T06:00:00.000Z",
};

const STORED: StoredOrder = {
  order: {
    id: "o1",
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
};

describe("SupabaseStore", () => {
  it("sends the service role key in both apikey and Authorization on every request", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [] }]);
    await new SupabaseStore({ ...CFG, fetchImpl }).all();
    expect(calls[0].headers.apikey).toBe("s3cret-service-role");
    expect(calls[0].headers.authorization).toBe("Bearer s3cret-service-role");
  });

  it("all() reads /orders newest first and maps rows to StoredOrder", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [ROW] }]);
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).all();
    expect(calls[0].url).toBe("https://demo-project.supabase.co/rest/v1/orders?order=created_at.desc");
    expect(calls[0].method).toBe("GET");
    expect(result).toEqual([STORED]);
  });

  it("get() filters by id and takes the first row", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [ROW] }]);
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).get("o1");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/rest/v1/orders");
    expect(url.searchParams.get("id")).toBe("eq.o1");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(result).toEqual(STORED);
  });

  it("get() returns undefined when no row matches", async () => {
    const { fetchImpl } = fakeFetch([{ body: [] }]);
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).get("missing");
    expect(result).toBeUndefined();
  });

  it("openOrdersFor() filters by channel, customer, status and an open-ended collection time", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [ROW] }]);
    const now = new Date("2026-09-21T06:00:00Z");
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).openOrdersFor("whatsapp", "97333333333", now);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("channel")).toBe("eq.whatsapp");
    expect(url.searchParams.get("customer_id")).toBe("eq.97333333333");
    expect(url.searchParams.get("status")).toBe("neq.collected");
    expect(url.searchParams.get("or")).toBe("(collection_at.is.null,collection_at.gte.2026-09-21T06:00:00.000Z)");
    expect(url.searchParams.get("order")).toBe("created_at.desc");
    expect(result).toEqual([STORED]);
  });

  it("add() posts one row mapped from StoredOrder, without asking for a response body", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: null }]);
    await new SupabaseStore({ ...CFG, fetchImpl }).add(STORED);
    expect(calls[0].url).toBe("https://demo-project.supabase.co/rest/v1/orders");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.prefer).toBe("return=minimal");
    expect(calls[0].body).toEqual([ROW]);
  });

  it("update() PATCHes only the changed columns and returns the merged row", async () => {
    const updatedRow = { ...ROW, status: "confirmed" };
    const { fetchImpl, calls } = fakeFetch([{ body: [updatedRow] }]);
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).update("o1", { status: "confirmed" });
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe("PATCH");
    expect(url.searchParams.get("id")).toBe("eq.o1");
    expect(calls[0].body).toEqual({ status: "confirmed" });
    expect(calls[0].headers.prefer).toBe("return=representation");
    expect(result?.order.status).toBe("confirmed");
  });

  it("update() maps every patchable Order field to its column name", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [ROW] }]);
    await new SupabaseStore({ ...CFG, fetchImpl }).update("o1", {
      items: [{ productId: "p-brownie", rawText: "براونيز", quantity: 5 }],
      collectionAt: "2026-09-27T07:00:00.000Z",
      notes: "no nuts",
      changes: ["time: - -> 2026-09-27T07:00:00.000Z"],
    });
    expect(calls[0].body).toEqual({
      items: [{ productId: "p-brownie", rawText: "براونيز", quantity: 5 }],
      collection_at: "2026-09-27T07:00:00.000Z",
      notes: "no nuts",
      changes: ["time: - -> 2026-09-27T07:00:00.000Z"],
    });
  });

  it("update() returns undefined when the id does not match any row", async () => {
    const { fetchImpl } = fakeFetch([{ body: [] }]);
    const result = await new SupabaseStore({ ...CFG, fetchImpl }).update("missing", { status: "confirmed" });
    expect(result).toBeUndefined();
  });

  it("markSeen() ignores conflicts on the id primary key: true when inserted, false when already seen", async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: [{ id: "wamid.1" }] }, { body: [] }]);
    const store = new SupabaseStore({ ...CFG, fetchImpl });
    expect(await store.markSeen("wamid.1")).toBe(true);
    expect(await store.markSeen("wamid.1")).toBe(false);
    expect(calls[0].url).toBe("https://demo-project.supabase.co/rest/v1/processed_messages?on_conflict=id");
    expect(calls[0].headers.prefer).toBe("resolution=ignore-duplicates,return=representation");
    expect(calls[0].body).toEqual([{ id: "wamid.1" }]);
  });

  it("throws with the status and body when a request fails", async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { message: "invalid api key" } }]);
    await expect(new SupabaseStore({ ...CFG, fetchImpl }).all()).rejects.toThrow(/401/);
  });
});
