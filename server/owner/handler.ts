// Owner screen for the webhook demo: lists orders the agent captured and lets the owner confirm them.
// Confirming sends the customer a confirmation on the channel they used. Routes:
//   GET  /owner                           owner page (HTML)
//   GET  /owner/api/orders                orders as JSON, newest first
//   POST /owner/api/orders/:id/confirm    confirm a pending order and message the customer
// Access control lives in the caller (the local runner only serves these routes to this computer).

import type { Product } from "../../src/lib/types.ts";
import { confirmationMessage, formatCollection } from "../agent/reply.ts";
import type { SendText } from "../agent/processor.ts";
import type { Channel, OrderStore, StoredOrder } from "../agent/store.ts";
import { MetaSendError } from "../meta/send-error.ts";
import { OWNER_PAGE } from "./page.ts";

export interface OwnerDeps {
  store: OrderStore;
  products: Product[];
  /** How to message customers on each channel. */
  senders: Partial<Record<Channel, SendText>>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function view(s: StoredOrder, products: Product[]) {
  const { order } = s;
  return {
    id: order.id,
    status: order.status,
    customerName: order.customerName,
    channel: s.channel,
    customerId: s.customerId,
    items: order.items.map((i) => {
      const p = products.find((x) => x.id === i.productId);
      return { name: p ? p.nameAr : i.rawText, quantity: i.quantity };
    }),
    collectionAt: order.collectionAt ?? null,
    collectionText: order.collectionAt ? formatCollection(order.collectionAt, "ar") : null,
    notes: order.notes ?? null,
    sourceText: s.sourceText ?? null,
    changes: order.changes,
    createdAt: order.createdAt,
  };
}

export function createOwnerHandler(deps: OwnerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const { pathname } = new URL(req.url);

    if (req.method === "GET" && (pathname === "/owner" || pathname === "/owner/")) {
      return new Response(OWNER_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET" && pathname === "/owner/api/orders") {
      const orders = (await deps.store.all()).sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
      return json(orders.map((s) => view(s, deps.products)));
    }

    const confirm = pathname.match(/^\/owner\/api\/orders\/([^/]+)\/confirm$/);
    if (req.method === "POST" && confirm) {
      const stored = await deps.store.get(decodeURIComponent(confirm[1]));
      if (!stored) return json({ error: "Order not found" }, 404);
      if (stored.order.status !== "pending") return json({ error: "Order is already confirmed" }, 409);
      const updated = (await deps.store.update(stored.order.id, { status: "confirmed" }))
        ?? { ...stored, order: { ...stored.order, status: "confirmed" as const } };
      const send = deps.senders[updated.channel];
      if (!send) return json({ order: view(updated, deps.products), messageSent: false, error: `No ${updated.channel} sender configured`, errorCode: null });
      try {
        await send(updated.customerId, confirmationMessage(updated.order, deps.products, updated.lang));
        return json({ order: view(updated, deps.products), messageSent: true });
      } catch (err) {
        return json({
          order: view(updated, deps.products),
          messageSent: false,
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof MetaSendError ? err.code ?? null : null,
        });
      }
    }

    return json({ error: "Not found" }, 404);
  };
}
