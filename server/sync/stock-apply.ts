// The reads behind a push's stock decisions (third review, 3 Oct 2026, F1-F3): what the database says about the
// moves a product push carries (stock_ops, the orders they name, the server's allocations for them), and about
// the products an order's ledger moves. The decisions themselves are pure (stock-merge.ts planProductPush,
// order-stock.ts planOrderStock); everything read here is guarded again when the write happens
// (store.ts writeAtomic -> orderat.sync_apply refuses a write whose inputs moved), so a read that went stale
// costs a retry, never a wrong stock count.

import type { SqlClient } from "../agent/postgres-store.ts";
import { planOrderStock, productsInPlay, productsNeedingBaseline, type OrderStockPlan } from "./order-stock.ts";
import { ledgerOf, unitsByProduct } from "./stock-ledger.ts";
import { freshMoves, listedKeys, orderIdsOfFreshMoves, pairKey, type Json, type OrderFact, type StockFacts } from "./stock-merge.ts";
import { findOrderStock, findRecordsByIds, findStockOps } from "./store.ts";

/** What a push of `incoming` onto the stored live product `productId` is judged against: which of its moves
 * stock_ops holds, the live orders the moves the stored list lacks name, and the server's allocations for those
 * orders and this product. */
export async function gatherProductFacts(sql: SqlClient, shopId: string, productId: string, stored: Json, incoming: Json): Promise<StockFacts> {
  const knownOps = await findStockOps(sql, shopId, listedKeys(stored, incoming));

  const orders = new Map<string, OrderFact>();
  const applied = new Map<string, number>();
  const orderIds = freshMoves(stored, incoming).length > 0 ? orderIdsOfFreshMoves(stored, incoming) : [];
  if (orderIds.length > 0) {
    for (const record of await findRecordsByIds(sql, shopId, "order", orderIds)) {
      if (record.deleted) continue; // A deleted order is not on the server for this purpose.
      orders.set(record.id, { seq: record.seq, ledgerBacked: ledgerOf(record.data) !== undefined, units: unitsByProduct(record.data.items) });
    }
    for (const row of await findOrderStock(sql, shopId, orderIds)) {
      if (row.productId === productId) applied.set(pairKey(row.orderId, productId), row.units);
    }
  }
  return { knownOps, orders, applied };
}

/** The stock effects and allocation rows that make the products agree with the ledger of the order record about
 * to be stored (`result`, whose ledger is `ledger`); `stored` is the order as stored now. */
export async function planStockForOrder(
  sql: SqlClient,
  shopId: string,
  orderId: string,
  result: Json,
  stored: Json | undefined,
  ledger: Record<string, number>,
  now: string,
): Promise<OrderStockPlan> {
  const rows = new Map((await findOrderStock(sql, shopId, [orderId])).map((r) => [r.productId, r.units]));
  const needed = productsNeedingBaseline(productsInPlay(result, stored, ledger, rows), stored, rows);
  const products = new Map<string, Json | null>(needed.map((id) => [id, null]));
  for (const record of await findRecordsByIds(sql, shopId, "product", needed)) {
    if (!record.deleted) products.set(record.id, record.data);
  }
  return planOrderStock({ orderId, ledger, result, stored, rows, products, now });
}
