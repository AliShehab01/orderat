// Database access for a published shop (docs/marketing-tools.md's "C. Shop link"), backed by
// db/migrations/0003_marketing.sql's orderat.shops / shop_photos / shop_views_daily. Every query is
// parameterized; server/shop/handler.ts is the only caller, and always after
// server/shop/{slug,doc,photos}.ts have already validated whatever it's about to write. Order rows
// (orderat.shop_orders) are server/shop/orders.ts's own concern, kept separate from this file.

import type { SqlClient } from "../agent/postgres-store.ts";
import { constantTimeEqualHex, sha256HexOfString } from "../shared/crypto.ts";
import type { ShopDocPublic } from "./doc.ts";
import type { PaymentMethod } from "./payment-methods.ts";

export interface ShopRow {
  id: string;
  slug: string;
  tokenHash: string;
  installId: string;
  doc: ShopDocPublic;
  /** db/migrations/0008_shop_payment_methods.sql's payment_methods (server/shop/payment-methods.ts). */
  paymentMethods: PaymentMethod[];
  published: boolean;
  blocked: boolean;
  publishCountToday: number;
  publishCountDay: string | null;
}

function toShopRow(row: Record<string, unknown>): ShopRow {
  return {
    id: row.id as string,
    slug: row.slug as string,
    tokenHash: row.token_hash as string,
    installId: row.install_id as string,
    doc: row.doc as ShopDocPublic,
    paymentMethods: Array.isArray(row.payment_methods) ? (row.payment_methods as PaymentMethod[]) : [],
    published: row.published as boolean,
    blocked: row.blocked as boolean,
    publishCountToday: row.publish_count_today as number,
    publishCountDay: row.publish_count_day == null ? null : String(row.publish_count_day),
  };
}

const SHOP_COLUMNS = "id, slug, token_hash, install_id, doc, payment_methods, published, blocked, publish_count_today, publish_count_day";

export async function findShopBySlug(sql: SqlClient, slug: string): Promise<ShopRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(`select ${SHOP_COLUMNS} from orderat.shops where slug = $1`, [slug]);
  return rows[0] ? toShopRow(rows[0]) : undefined;
}

export async function findShopByTokenHash(sql: SqlClient, tokenHash: string): Promise<ShopRow | undefined> {
  const rows = await sql.query<Record<string, unknown>>(`select ${SHOP_COLUMNS} from orderat.shops where token_hash = $1`, [tokenHash]);
  return rows[0] ? toShopRow(rows[0]) : undefined;
}

/**
 * Finds the shop for a raw edit token: hashes it, looks the hash up (necessarily an equality lookup —
 * there is no other way to find "which shop does this token belong to"), then re-checks the found
 * row's own tokenHash against the computed hash with a constant-time comparison before trusting it
 * — docs/marketing-tools.md: "compare with a constant-time comparison." Belt and suspenders: the
 * lookup above already matched on equality, so this can only ever agree with it, but it's the one
 * place that guarantees a plain, potentially-short-circuiting `===` never decides authentication,
 * even if a future change to the query above ever fetched by something broader than an exact hash
 * match. Every caller that authenticates a shop by token goes through this, never
 * findShopByTokenHash directly.
 */
export async function findShopByToken(sql: SqlClient, token: string): Promise<ShopRow | undefined> {
  const tokenHash = await sha256HexOfString(token);
  const shop = await findShopByTokenHash(sql, tokenHash);
  if (!shop || !constantTimeEqualHex(shop.tokenHash, tokenHash)) return undefined;
  return shop;
}

export interface CreateShopInput {
  id: string;
  slug: string;
  tokenHash: string;
  installId: string;
  doc: ShopDocPublic;
  paymentMethods?: PaymentMethod[];
  day: string;
}

/** Creates a brand-new shop (first publish, no token yet) with its publish counter already at 1 for
 * `day` — the very first publish can never itself be rate-limited (there is no row to check a count
 * against beforehand). */
export async function createShop(sql: SqlClient, input: CreateShopInput): Promise<void> {
  await sql.query(
    `insert into orderat.shops (id, slug, token_hash, install_id, doc, payment_methods, published, blocked, publish_count_today, publish_count_day)
     values ($1, $2, $3, $4, $5, $7, true, false, 1, $6)`,
    [input.id, input.slug, input.tokenHash, input.installId, JSON.stringify(input.doc), input.day, JSON.stringify(input.paymentMethods ?? [])],
  );
}

/**
 * Bumps (or, on a new day, resets) a shop's publish counter and returns the new count — a single
 * atomic UPDATE, deliberately touching only the counter columns and nothing else (slug/doc/published)
 * so a request that turns out to be over the limit never actually changes what's live. Callers check
 * the returned count against the 30/day limit (docs/marketing-tools.md) themselves and only then call
 * updateShopDoc below.
 */
export async function bumpPublishCounter(sql: SqlClient, shopId: string, day: string): Promise<number> {
  const rows = await sql.query<{ publish_count_today: number }>(
    `update orderat.shops
     set publish_count_today = case when publish_count_day = $2 then publish_count_today + 1 else 1 end,
         publish_count_day = $2
     where id = $1
     returning publish_count_today`,
    [shopId, day],
  );
  return rows[0]?.publish_count_today ?? 0;
}

/** Writes a re-publish's new slug/doc and marks the shop published again — called only after
 * bumpPublishCounter confirms this publish is within the daily limit. */
export async function updateShopDoc(sql: SqlClient, shopId: string, slug: string, doc: ShopDocPublic, paymentMethods: PaymentMethod[] = []): Promise<void> {
  await sql.query(
    `update orderat.shops set slug = $2, doc = $3, payment_methods = $4, published = true, updated_at = now() where id = $1`,
    [shopId, slug, JSON.stringify(doc), JSON.stringify(paymentMethods)],
  );
}

export async function setShopPublished(sql: SqlClient, shopId: string, published: boolean): Promise<void> {
  await sql.query(`update orderat.shops set published = $2, updated_at = now() where id = $1`, [shopId, published]);
}

/** Every photo this shop already has, keyed by photoId — server/shop/handler.ts merges this with the
 * photos just uploaded in the current call to resolve every reference in a publish's doc. Fetched as
 * one full map (a shop has at most 60 photos, matching the item cap) rather than filtered by an
 * `= any($1)` array parameter, which not every SqlClient backend handles the same way. */
export async function getShopPhotoMap(sql: SqlClient, shopId: string): Promise<Map<string, string>> {
  const rows = await sql.query<{ photo_id: string; path: string }>(`select photo_id, path from orderat.shop_photos where shop_id = $1`, [shopId]);
  return new Map(rows.map((r) => [r.photo_id, r.path]));
}

/** Records a newly-uploaded photo's storage path, keyed by its content hash — `on conflict ... do
 * nothing` because the same (shop_id, photo_id) can be sent again (docs/marketing-tools.md's dedupe:
 * "an unchanged photo is never uploaded twice"), which is a no-op here, not an error. */
export async function recordShopPhoto(sql: SqlClient, shopId: string, photoId: string, path: string): Promise<void> {
  await sql.query(
    `insert into orderat.shop_photos (shop_id, photo_id, path) values ($1, $2, $3) on conflict (shop_id, photo_id) do nothing`,
    [shopId, photoId, path],
  );
}

export async function incrementShopView(sql: SqlClient, shopId: string, day: string): Promise<void> {
  await sql.query(
    `insert into orderat.shop_views_daily (shop_id, day, count) values ($1, $2, 1)
     on conflict (shop_id, day) do update set count = orderat.shop_views_daily.count + 1`,
    [shopId, day],
  );
}

export interface ShopStats {
  views7d: number;
  orders7d: number;
  pending: number;
}

/** `stats` (docs/marketing-tools.md): the last 7 days of views (summed from shop_views_daily),
 * orders placed in the last 7 days, and every order still waiting for the seller's app to `ack` it
 * (i.e. every row currently in shop_orders for this shop — ack is what removes them). */
export async function getShopStats(sql: SqlClient, shopId: string, sevenDaysAgo: Date): Promise<ShopStats> {
  const day7 = sevenDaysAgo.toISOString().slice(0, 10);
  const [viewRows, orderRows, pendingRows] = await Promise.all([
    sql.query<{ total: number }>(`select coalesce(sum(count), 0)::int as total from orderat.shop_views_daily where shop_id = $1 and day >= $2`, [shopId, day7]),
    sql.query<{ total: number }>(`select count(*)::int as total from orderat.shop_orders where shop_id = $1 and created_at >= $2`, [shopId, sevenDaysAgo.toISOString()]),
    sql.query<{ total: number }>(`select count(*)::int as total from orderat.shop_orders where shop_id = $1`, [shopId]),
  ]);
  return { views7d: viewRows[0]?.total ?? 0, orders7d: orderRows[0]?.total ?? 0, pending: pendingRows[0]?.total ?? 0 };
}
