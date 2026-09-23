// Order storage. MemoryStore is the in-process implementation used by tests and local dev
// (server/dev.ts) — data is lost when the process restarts. SupabaseStore (supabase-store.ts)
// persists to Postgres over PostgREST, for the Edge Function deployment, where each request may
// hit a different, freshly-started isolate.
//
// The interface is async throughout, even for MemoryStore, so the agent and owner handler code
// is identical whichever store backs them: they always `await` and always persist through
// `update`/`add` rather than relying on mutating an object returned earlier.

import type { Order } from "../../src/lib/types.ts";

export type Lang = "ar" | "en";
export type Channel = "whatsapp" | "instagram";

export interface StoredOrder {
  /** Orders captured by the agent start as status "pending" until the owner confirms them. */
  order: Order;
  channel: Channel;
  /** WhatsApp number, or Instagram-scoped user ID (IGSID), of the customer who sent the order. */
  customerId: string;
  /** Language the customer wrote in, used for later messages such as the confirmation. */
  lang: Lang;
  /** The customer's words: message text, or the transcript of a voice note or image. Shown to the owner for review. */
  sourceText?: string;
}

export interface OrderStore {
  /** Returns false when this message id was already handled (Meta retries deliveries). */
  markSeen(messageId: string): Promise<boolean>;
  /** This customer's orders that are not collected and whose collection time has not passed, newest first. */
  openOrdersFor(channel: Channel, customerId: string, now: Date): Promise<StoredOrder[]>;
  get(orderId: string): Promise<StoredOrder | undefined>;
  add(stored: StoredOrder): Promise<void>;
  /** Merges `patch` into the order's fields and persists it. Returns the updated record, or undefined if orderId is unknown. */
  update(orderId: string, patch: Partial<Order>): Promise<StoredOrder | undefined>;
  all(): Promise<StoredOrder[]>;
}

const SEEN_LIMIT = 5000;

export class MemoryStore implements OrderStore {
  private orders: StoredOrder[] = [];
  private seen = new Set<string>();

  async markSeen(messageId: string): Promise<boolean> {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }

  async openOrdersFor(channel: Channel, customerId: string, now: Date): Promise<StoredOrder[]> {
    return this.orders
      .filter((s) => s.channel === channel && s.customerId === customerId && s.order.status !== "collected")
      .filter((s) => !s.order.collectionAt || new Date(s.order.collectionAt).getTime() >= now.getTime())
      .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
  }

  async get(orderId: string): Promise<StoredOrder | undefined> {
    return this.orders.find((s) => s.order.id === orderId);
  }

  async add(stored: StoredOrder): Promise<void> {
    this.orders.push(stored);
  }

  async update(orderId: string, patch: Partial<Order>): Promise<StoredOrder | undefined> {
    const idx = this.orders.findIndex((s) => s.order.id === orderId);
    if (idx === -1) return undefined;
    const updated: StoredOrder = { ...this.orders[idx], order: { ...this.orders[idx].order, ...patch } };
    this.orders[idx] = updated;
    return updated;
  }

  async all(): Promise<StoredOrder[]> {
    return [...this.orders];
  }
}
