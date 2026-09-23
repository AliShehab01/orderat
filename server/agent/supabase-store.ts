// Order store backed by Postgres, talked to over PostgREST with plain fetch (no @supabase/supabase-js
// dependency needed for this). Used by the Supabase Edge Function deployment, where MemoryStore's
// in-process array would not survive the isolate being recycled between requests.
//
// Auth: the service role / secret key (never the anon key) in both `apikey` and `Authorization:
// Bearer`, which bypasses Row Level Security — required, since supabase/migrations/*_orders.sql
// enables RLS on these tables with no public policies at all. This key must never reach the client.

import type { Order } from "../../src/lib/types.ts";
import type { Channel, Lang, OrderStore, StoredOrder } from "./store.ts";

export interface SupabaseStoreConfig {
  /** Project URL, e.g. https://<project-ref>.supabase.co (Deno.env SUPABASE_URL / process.env SUPABASE_URL). */
  url: string;
  /** Service role (or new-style secret) key. Bypasses RLS — server-side only, never sent to a client. */
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

interface OrderRow {
  id: string;
  channel: Channel;
  customer_id: string;
  customer_name: string;
  items: Order["items"];
  collection_at: string | null;
  notes: string | null;
  status: Order["status"];
  changes: string[];
  lang: Lang;
  source_text: string | null;
  created_at: string;
}

function toStoredOrder(row: OrderRow): StoredOrder {
  return {
    order: {
      id: row.id,
      customerName: row.customer_name,
      items: row.items,
      collectionAt: row.collection_at ?? undefined,
      notes: row.notes ?? undefined,
      status: row.status,
      changes: row.changes ?? [],
      createdAt: row.created_at,
    },
    channel: row.channel,
    customerId: row.customer_id,
    lang: row.lang,
    sourceText: row.source_text ?? undefined,
  };
}

function toRow(stored: StoredOrder): OrderRow {
  return {
    id: stored.order.id,
    channel: stored.channel,
    customer_id: stored.customerId,
    customer_name: stored.order.customerName,
    items: stored.order.items,
    collection_at: stored.order.collectionAt ?? null,
    notes: stored.order.notes ?? null,
    status: stored.order.status,
    changes: stored.order.changes,
    lang: stored.lang,
    source_text: stored.sourceText ?? null,
    created_at: stored.order.createdAt,
  };
}

/** Only the Order fields present in `patch` become columns in the PATCH body. */
function patchToRow(patch: Partial<Order>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("customerName" in patch) row.customer_name = patch.customerName;
  if ("items" in patch) row.items = patch.items;
  if ("collectionAt" in patch) row.collection_at = patch.collectionAt ?? null;
  if ("notes" in patch) row.notes = patch.notes ?? null;
  if ("status" in patch) row.status = patch.status;
  if ("changes" in patch) row.changes = patch.changes;
  if ("createdAt" in patch) row.created_at = patch.createdAt;
  return row;
}

export class SupabaseStore implements OrderStore {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: SupabaseStoreConfig) {
    this.base = `${cfg.url.replace(/\/+$/, "")}/rest/v1`;
    this.headers = {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
      "content-type": "application/json",
    };
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...this.headers, ...(init.headers as Record<string, string> | undefined) };
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Supabase request failed (${res.status} ${path}): ${detail.slice(0, 300)}`);
    }
    return res;
  }

  /** Insert-ignore-conflict on the id primary key: true the first time, false on a retried delivery. */
  async markSeen(messageId: string): Promise<boolean> {
    const res = await this.request(`/processed_messages?on_conflict=id`, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: JSON.stringify([{ id: messageId }]),
    });
    const rows = (await res.json()) as unknown[];
    return rows.length > 0;
  }

  async openOrdersFor(channel: Channel, customerId: string, now: Date): Promise<StoredOrder[]> {
    const params = new URLSearchParams({
      channel: `eq.${channel}`,
      customer_id: `eq.${customerId}`,
      status: "neq.collected",
      or: `(collection_at.is.null,collection_at.gte.${now.toISOString()})`,
      order: "created_at.desc",
    });
    const res = await this.request(`/orders?${params.toString()}`);
    return ((await res.json()) as OrderRow[]).map(toStoredOrder);
  }

  async get(orderId: string): Promise<StoredOrder | undefined> {
    const params = new URLSearchParams({ id: `eq.${orderId}`, limit: "1" });
    const res = await this.request(`/orders?${params.toString()}`);
    const rows = (await res.json()) as OrderRow[];
    return rows[0] ? toStoredOrder(rows[0]) : undefined;
  }

  async add(stored: StoredOrder): Promise<void> {
    await this.request(`/orders`, {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify([toRow(stored)]),
    });
  }

  async update(orderId: string, patch: Partial<Order>): Promise<StoredOrder | undefined> {
    const body = patchToRow(patch);
    const params = new URLSearchParams({ id: `eq.${orderId}` });
    const res = await this.request(`/orders?${params.toString()}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(body),
    });
    const rows = (await res.json()) as OrderRow[];
    return rows[0] ? toStoredOrder(rows[0]) : undefined;
  }

  async all(): Promise<StoredOrder[]> {
    const res = await this.request(`/orders?order=created_at.desc`);
    return ((await res.json()) as OrderRow[]).map(toStoredOrder);
  }
}
