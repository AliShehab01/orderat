// In-memory order store for the webhook demo.
// Data is lost when the process restarts. A database (Supabase) replaces this later.

import type { Order } from "../../src/lib/types";

export interface StoredOrder {
  /** Orders captured by the agent start as status "pending" until the owner confirms them. */
  order: Order;
  /** WhatsApp number of the customer who sent the order. */
  customerPhone: string;
}

const SEEN_LIMIT = 5000;

export class MemoryStore {
  private orders: StoredOrder[] = [];
  private seen = new Set<string>();

  /** Returns false when this message id was already handled (Meta retries deliveries). */
  markSeen(messageId: string): boolean {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }

  /** This customer's orders that are not collected and whose collection time has not passed, newest first. */
  openOrdersFor(phone: string, now: Date): StoredOrder[] {
    return this.orders
      .filter((s) => s.customerPhone === phone && s.order.status !== "collected")
      .filter((s) => !s.order.collectionAt || new Date(s.order.collectionAt).getTime() >= now.getTime())
      .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
  }

  add(stored: StoredOrder): void {
    this.orders.push(stored);
  }

  all(): StoredOrder[] {
    return [...this.orders];
  }
}
