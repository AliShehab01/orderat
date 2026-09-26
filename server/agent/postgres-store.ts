// Order store backed by Postgres, talked to directly over the wire protocol (not PostgREST) as the
// least-privilege "orderat_app" role — see db/migrations/0001_orderat_isolation.sql. This replaces
// SupabaseStore: Orderat no longer needs a Supabase-wide service role key at all, which matters once
// it shares a Postgres instance with another, unrelated project (see README.md "Hosting").
//
// `SqlClient` is the only thing this file knows about "how to run a query" — deliberately tiny and
// driver-agnostic, so the same store class works from two different SQL drivers: the Node "postgres"
// package (server/agent/postgres-client.ts, used by server/dev.ts) and Deno's "npm:postgres" build
// (supabase/functions/_shared/db.ts, used by the hosted Edge Functions). Every query here is
// parameterized ($1, $2, ...); no user-controlled value is ever interpolated into SQL text.

import type { Order } from "../../src/lib/types.ts";
import type { Channel, Lang, OrderStore, StoredOrder } from "./store.ts";

/** The one thing a SQL driver needs to provide. Both adapters wrap their driver's own parameterized
 * "raw query" entry point (Node: `sql.unsafe`, Deno: the same, via npm:postgres) to satisfy this. */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

interface OrderRow {
  id: string;
  channel: Channel;
  customer_id: string;
  customer_name: string;
  items: Order["items"];
  // The Node and Deno postgres drivers both parse `timestamptz` columns into JS Date objects; the
  // rest of the codebase (like SupabaseStore/PostgREST before it) expects ISO strings, so every read
  // path below normalizes with `toIso`.
  collection_at: string | Date | null;
  notes: string | null;
  status: Order["status"];
  changes: string[];
  lang: Lang;
  source_text: string | null;
  created_at: string | Date;
}

function toIso(value: string | Date): string;
function toIso(value: string | Date | null): string | null;
function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toStoredOrder(row: OrderRow): StoredOrder {
  return {
    order: {
      id: row.id,
      customerName: row.customer_name,
      // jsonb columns round-trip as plain JS values already (both drivers parse jsonb for us), so
      // items/changes need no extra decoding here.
      items: row.items,
      collectionAt: toIso(row.collection_at) ?? undefined,
      notes: row.notes ?? undefined,
      status: row.status,
      changes: row.changes ?? [],
      createdAt: toIso(row.created_at),
    },
    channel: row.channel,
    customerId: row.customer_id,
    lang: row.lang,
    sourceText: row.source_text ?? undefined,
  };
}

export class PostgresStore implements OrderStore {
  constructor(private readonly sql: SqlClient) {}

  /** Insert-ignore-conflict on the id primary key: true the first time, false on a retried delivery. */
  async markSeen(messageId: string): Promise<boolean> {
    const rows = await this.sql.query<{ id: string }>(
      `insert into orderat.processed_messages (id) values ($1)
       on conflict (id) do nothing
       returning id`,
      [messageId],
    );
    return rows.length > 0;
  }

  async openOrdersFor(channel: Channel, customerId: string, now: Date): Promise<StoredOrder[]> {
    const rows = await this.sql.query<OrderRow>(
      `select * from orderat.orders
       where channel = $1
         and customer_id = $2
         and status <> 'collected'
         and (collection_at is null or collection_at >= $3)
       order by created_at desc`,
      [channel, customerId, now.toISOString()],
    );
    return rows.map(toStoredOrder);
  }

  async get(orderId: string): Promise<StoredOrder | undefined> {
    const rows = await this.sql.query<OrderRow>(`select * from orderat.orders where id = $1 limit 1`, [orderId]);
    return rows[0] ? toStoredOrder(rows[0]) : undefined;
  }

  async add(stored: StoredOrder): Promise<void> {
    await this.sql.query(
      `insert into orderat.orders
         (id, channel, customer_id, customer_name, items, collection_at, notes, status, changes, lang, source_text, created_at)
       values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::text::jsonb, $10, $11, $12)`,
      [
        stored.order.id,
        stored.channel,
        stored.customerId,
        stored.order.customerName,
        JSON.stringify(stored.order.items),
        stored.order.collectionAt ?? null,
        stored.order.notes ?? null,
        stored.order.status,
        JSON.stringify(stored.order.changes),
        stored.lang,
        stored.sourceText ?? null,
        stored.order.createdAt,
      ],
    );
  }

  async update(orderId: string, patch: Partial<Order>): Promise<StoredOrder | undefined> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if ("customerName" in patch) set("customer_name", patch.customerName);
    if ("items" in patch) set("items", JSON.stringify(patch.items), "::text::jsonb");
    if ("collectionAt" in patch) set("collection_at", patch.collectionAt ?? null);
    if ("notes" in patch) set("notes", patch.notes ?? null);
    if ("status" in patch) set("status", patch.status);
    if ("changes" in patch) set("changes", JSON.stringify(patch.changes), "::text::jsonb");
    if ("createdAt" in patch) set("created_at", patch.createdAt);

    if (sets.length === 0) return this.get(orderId);

    params.push(orderId);
    const rows = await this.sql.query<OrderRow>(
      `update orderat.orders set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    return rows[0] ? toStoredOrder(rows[0]) : undefined;
  }

  async all(): Promise<StoredOrder[]> {
    const rows = await this.sql.query<OrderRow>(`select * from orderat.orders order by created_at desc`);
    return rows.map(toStoredOrder);
  }
}
