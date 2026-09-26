// Order processing for the public shop page's checkout (docs/marketing-tools.md's "C. Shop link" >
// "Order rules"), backed by db/migrations/0003_marketing.sql's orderat.shop_orders. Prices and
// availability are always resolved from the shop's own stored document — "Prices come from the
// server's copy of the shop, never from the page" — never from anything the page/app sends.

import type { SqlClient } from "../agent/postgres-store.ts";
import { formatMoney } from "../shared/money.ts";
import type { ShopDocPublic } from "./doc.ts";
import type { Fulfillment, OrderBody } from "./validate.ts";

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  priceMinor: number;
}

export interface OrderDoc {
  customer: { name: string; phone: string };
  items: OrderLine[];
  totalMinor: number;
  currency: string;
  pickupDate: string;
  pickupTime?: string;
  fulfillment?: Fulfillment;
  address?: string;
  notes?: string;
}

export type ResolveOrderResult = { ok: true; doc: OrderDoc } | { ok: false; error: "invalid_body" };

/**
 * Resolves each requested `{id, qty}` line against the shop's own stored items — an id that doesn't
 * exist on the shop, or exists but is `available: false`, fails the whole order (400 `invalid_body`,
 * per docs/marketing-tools.md: "Unknown or unavailable item ids → 400"). Quantity bounds (1-99, at
 * most 30 lines) are already checked by server/shop/validate.ts. The display name is the shop's own
 * `lang` (this becomes the WhatsApp message the seller reads, so it follows her shop's language, not
 * anything the customer picked).
 */
export function resolveOrderDoc(shopDoc: ShopDocPublic, body: OrderBody): ResolveOrderResult {
  const byId = new Map(shopDoc.items.map((item) => [item.id, item]));
  const lines: OrderLine[] = [];
  let totalMinor = 0;
  for (const { id, qty } of body.items) {
    const item = byId.get(id);
    if (!item || !item.available) return { ok: false, error: "invalid_body" };
    lines.push({ id, name: shopDoc.lang === "ar" ? item.name.ar : item.name.en, qty, priceMinor: item.priceMinor });
    totalMinor += item.priceMinor * qty;
  }
  return {
    ok: true,
    doc: {
      customer: body.customer,
      items: lines,
      totalMinor,
      currency: shopDoc.currency,
      pickupDate: body.pickupDate,
      pickupTime: body.pickupTime,
      fulfillment: body.fulfillment,
      address: body.address,
      notes: body.notes,
    },
  };
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** docs/marketing-tools.md: "pickupDate today (Asia/Riyadh) + leadTimeDays or later, and within 60
 * days." `today` is already resolved to Asia/Riyadh by the caller (server/campaigns/content.ts's
 * todayInRiyadh, reused here too). */
export function isPickupDateAllowed(pickupDate: string, today: string, leadTimeDays: number): boolean {
  const earliest = addDaysToDateString(today, leadTimeDays);
  const latest = addDaysToDateString(today, 60);
  return pickupDate >= earliest && pickupDate <= latest;
}

/** "Like W4821" (docs/marketing-tools.md) — a friendly display label, not a uniqueness guarantee;
 * the order's real primary key is its uuid `id`. Collisions across different shops (or even the same
 * shop, rarely) are harmless. */
export function generateOrderRef(): string {
  const n = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  return `W${n}`;
}

const AR_LABELS = { title: "طلب جديد", name: "الاسم", phone: "الهاتف", total: "الإجمالي", pickup: "الاستلام", address: "العنوان", notes: "ملاحظات" };
const EN_LABELS = { title: "New order", name: "Name", phone: "Phone", total: "Total", pickup: "Pickup", address: "Address", notes: "Notes" };

/**
 * The order summary sent to the seller's own WhatsApp right after the customer checks out
 * (docs/marketing-tools.md: "so the seller sees it even before opening the app"), in the shop's own
 * `lang`. Plain labelled lines rather than a conversational message — a receipt, not a chat reply —
 * so this doesn't need the Gulf-Arabic-dialect treatment server/ask/prompt.ts and
 * server/studio/caption-prompt.ts give AI-written text.
 */
export function buildWhatsappText(ref: string, doc: OrderDoc, lang: "ar" | "en"): string {
  const labels = lang === "ar" ? AR_LABELS : EN_LABELS;
  const lines = [
    `${labels.title} #${ref}`,
    `${labels.name}: ${doc.customer.name}`,
    `${labels.phone}: ${doc.customer.phone}`,
    ...doc.items.map((line) => `${line.qty}x ${line.name} — ${formatMoney(line.priceMinor * line.qty, doc.currency)}`),
    `${labels.total}: ${formatMoney(doc.totalMinor, doc.currency)}`,
    `${labels.pickup}: ${doc.pickupDate}${doc.pickupTime ? ` ${doc.pickupTime}` : ""}`,
  ];
  if (doc.address) lines.push(`${labels.address}: ${doc.address}`);
  if (doc.notes) lines.push(`${labels.notes}: ${doc.notes}`);
  return lines.join("\n");
}

export async function countOrdersByIpSince(sql: SqlClient, ipHash: string, since: Date): Promise<number> {
  const rows = await sql.query<{ total: number }>(
    `select count(*)::int as total from orderat.shop_orders where ip_hash = $1 and created_at > $2`,
    [ipHash, since.toISOString()],
  );
  return rows[0]?.total ?? 0;
}

export async function countOrdersByShopSince(sql: SqlClient, shopId: string, since: Date): Promise<number> {
  const rows = await sql.query<{ total: number }>(
    `select count(*)::int as total from orderat.shop_orders where shop_id = $1 and created_at > $2`,
    [shopId, since.toISOString()],
  );
  return rows[0]?.total ?? 0;
}

export interface InsertOrderInput {
  id: string;
  shopId: string;
  ref: string;
  doc: OrderDoc;
  ipHash: string;
}

export async function insertOrder(sql: SqlClient, input: InsertOrderInput): Promise<void> {
  await sql.query(
    `insert into orderat.shop_orders (id, shop_id, ref, doc, ip_hash) values ($1, $2, $3, $4, $5)`,
    [input.id, input.shopId, input.ref, JSON.stringify(input.doc), input.ipHash],
  );
}

export interface InboxOrder {
  id: string;
  ref: string;
  createdAt: string;
  customer: OrderDoc["customer"];
  items: OrderLine[];
  totalMinor: number;
  pickupDate: string;
  pickupTime?: string;
  fulfillment?: Fulfillment;
  address?: string;
  notes?: string;
}

/** `inbox` (docs/marketing-tools.md): every order still waiting for this shop's app to `ack` it,
 * newest first. */
export async function listInboxOrders(sql: SqlClient, shopId: string): Promise<InboxOrder[]> {
  const rows = await sql.query<{ id: string; ref: string; created_at: string | Date; doc: OrderDoc }>(
    `select id, ref, created_at, doc from orderat.shop_orders where shop_id = $1 order by created_at desc`,
    [shopId],
  );
  return rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    customer: row.doc.customer,
    items: row.doc.items,
    totalMinor: row.doc.totalMinor,
    pickupDate: row.doc.pickupDate,
    pickupTime: row.doc.pickupTime,
    fulfillment: row.doc.fulfillment,
    address: row.doc.address,
    notes: row.doc.notes,
  }));
}

/** `ack` (docs/marketing-tools.md): deletes the given order ids for this shop and returns how many
 * were actually deleted (an id already gone, or belonging to another shop, is silently not counted —
 * never an error, since the app may retry an ack after a partial failure). */
export async function ackOrders(sql: SqlClient, shopId: string, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const rows = await sql.query<{ id: string }>(
    `delete from orderat.shop_orders where shop_id = $1 and id = any($2::uuid[]) returning id`,
    [shopId, orderIds],
  );
  return rows.length;
}

/** Deletes every order older than 30 days, for every shop (docs/marketing-tools.md: "purged after 30
 * days either way") — called opportunistically at the top of every orderat-shop request
 * (server/shop/handler.ts) rather than needing a separate cron function, since it's a cheap,
 * idempotent no-op on every call that finds nothing to delete. Returns the number purged, mainly for
 * tests. */
export async function purgeOldOrders(sql: SqlClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await sql.query<{ id: string }>(`delete from orderat.shop_orders where created_at < $1 returning id`, [cutoff]);
  return rows.length;
}
