// HTTP handler for orderat-shop (docs/marketing-tools.md's "C. Shop link"). Plain Request -> Response,
// like server/ask/handler.ts, so it runs the same under Deno, Node or a test;
// supabase/functions/orderat-shop/index.ts only wires in env + the two dependencies this file can't
// own itself: `uploadPhoto` (writes to Supabase Storage with the service role key — a documented
// exception, see that file's header) and `publicPhotoBaseUrl` (built from SUPABASE_URL).
//
// CORS is applied inside this factory (withPublicCors), same choice as server/campaigns/handler.ts
// and for the same reason: this feature's own handler.test.ts covers the OPTIONS preflight + header
// behavior directly, not only server/shared/cors.test.ts's generic coverage.
//
// Every request opportunistically purges orders older than 30 days first (server/shop/orders.ts's
// purgeOldOrders) — cheap and idempotent, so this needs no separate cron function.

import type { SqlClient } from "../agent/postgres-store.ts";
import { todayInRiyadh } from "../campaigns/content.ts";
import { newEditToken, sha256HexOfString } from "../shared/crypto.ts";
import { withPublicCors } from "../shared/cors.ts";
import { referencedPhotoIds, resolveShopDoc, validateShopDoc } from "./doc.ts";
import {
  ackOrders,
  buildWhatsappText,
  countOrdersByIpSince,
  countOrdersByShopSince,
  generateOrderRef,
  insertOrder,
  isPickupDateAllowed,
  listInboxOrders,
  purgeOldOrders,
  resolveOrderDoc,
} from "./orders.ts";
import { validatePhotoUpload } from "./photos.ts";
import { isAcceptableSlug } from "./slug.ts";
import {
  bumpPublishCounter,
  createShop,
  findShopBySlug,
  findShopByToken,
  getShopPhotoMap,
  getShopStats,
  incrementShopView,
  recordShopPhoto,
  setShopPublished,
  updateShopDoc,
  type ShopRow,
} from "./store.ts";
import { validateShopBody, type OrderBody, type PublishBody } from "./validate.ts";

/** docs/marketing-tools.md: "429 rate_limited above 5 orders per hour from one IP ... or 100 orders
 * per day for one shop." */
const MAX_ORDERS_PER_IP_PER_HOUR = 5;
const MAX_ORDERS_PER_SHOP_PER_DAY = 100;
/** docs/marketing-tools.md: "30 publishes per shop per day." */
const MAX_PUBLISHES_PER_SHOP_PER_DAY = 30;

export type UploadPhoto = (args: { shopId: string; photoId: string; bytes: Uint8Array; mimeType: string }) => Promise<boolean>;

export interface ShopHandlerDeps {
  sql: SqlClient;
  /** Base for the public shop link, e.g. "https://orderatweb.com/s/?" — the response's
   * `url` is this plus the slug, with nothing else appended or encoded (a slug is already
   * URL-safe by construction — server/shop/slug.ts's format). */
  shopBaseUrl: string;
  /** Base for a photo's public URL, e.g.
   * "https://<ref>.supabase.co/storage/v1/object/public/orderat-shop/" — this plus a stored `path`
   * (`<shopId>/<photoId>.jpg`) is the full URL. */
  publicPhotoBaseUrl: string;
  /** Writes one photo's bytes to the public Storage bucket; returns false on any failure (network,
   * non-2xx, ...) — server/shop/handler.ts maps that to 502 `ai_unavailable`, reusing the spec's one
   * "an upstream service failed" code rather than inventing a new one for Storage specifically. */
  uploadPhoto: UploadPhoto;
  /** Salt for hashing a client IP before it's ever written to a row — never the raw IP. */
  ipSalt: string;
  now?: () => Date;
  /** Structured, content-free log line per request — never a token, doc, customer name/phone, or
   * whatsappText. */
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);
const badTokenResponse = () => jsonResponse({ error: "bad_token" }, 401);
const notFoundResponse = () => jsonResponse({ error: "not_found" }, 404);
const slugTakenResponse = () => jsonResponse({ error: "slug_taken" }, 409);
const tooLargeResponse = () => jsonResponse({ error: "too_large" }, 413);
const rateLimitedResponse = () => jsonResponse({ error: "rate_limited" }, 429);
const uploadFailedResponse = () => jsonResponse({ error: "ai_unavailable" }, 502);

/** `x-forwarded-for`'s first entry (Supabase sets this) — the original client, before any proxy —
 * hashed with the server's salt before ever touching a row. Falls back to a fixed bucket when the
 * header is absent (local testing, or a direct call) so rate limiting still applies, just coarsely. */
function hashClientIp(req: Request, ipSalt: string): Promise<string> {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  return sha256HexOfString(`${ipSalt}:${ip}`);
}

export function createShopHandler(deps: ShopHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());
  const shopUrl = (slug: string) => `${deps.shopBaseUrl}${slug}`;
  const photoUrl = (path: string) => `${deps.publicPhotoBaseUrl}${path}`;

  async function handlePublicGet(url: URL): Promise<Response> {
    const slug = url.searchParams.get("slug") ?? "";
    const shop = await findShopBySlug(deps.sql, slug);
    if (!shop || !shop.published || shop.blocked) {
      log({ event: "shop_get", status: 404 });
      return notFoundResponse();
    }
    await incrementShopView(deps.sql, shop.id, todayInRiyadh(now()));
    log({ event: "shop_get", status: 200 });
    // Spread only `doc` (the public shape) plus the computed url — never the raw row, which also
    // carries token_hash/install_id/blocked/publish_count_*.
    return jsonResponse({ ...shop.doc, url: shopUrl(shop.slug) }, 200, { "Cache-Control": "public, max-age=60" });
  }

  async function handleSlugCheck(slug: string): Promise<Response> {
    const available = isAcceptableSlug(slug) && !(await findShopBySlug(deps.sql, slug));
    log({ event: "shop_slug_check", status: 200, available });
    return jsonResponse({ available }, 200);
  }

  async function resolvePhotoUrls(shopId: string): Promise<Map<string, string>> {
    const map = await getShopPhotoMap(deps.sql, shopId);
    return new Map([...map].map(([photoId, path]) => [photoId, photoUrl(path)]));
  }

  async function handlePublish(body: PublishBody): Promise<Response> {
    const doc = validateShopDoc(body.shop);
    if (!doc) {
      log({ event: "shop_publish", status: 400, reason: "bad_doc" });
      return invalidBodyResponse();
    }

    // Validate every photo before touching the database or Storage — sequential, so the first bad
    // photo wins deterministically and no upload is attempted for a request that's going to fail
    // anyway.
    const validatedPhotos = [];
    for (const raw of body.photos) {
      const result = await validatePhotoUpload(raw);
      if (!result.ok) {
        log({ event: "shop_publish", status: result.error === "too_large" ? 413 : 400, reason: "bad_photo" });
        return result.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
      }
      validatedPhotos.push(result.photo);
    }

    let existing: ShopRow | undefined;
    if (body.token) {
      existing = await findShopByToken(deps.sql, body.token);
      if (!existing) {
        log({ event: "shop_publish", status: 401 });
        return badTokenResponse();
      }
    }

    const slugOwner = await findShopBySlug(deps.sql, body.slug);
    if (slugOwner && slugOwner.id !== existing?.id) {
      log({ event: "shop_publish", status: 409 });
      return slugTakenResponse();
    }

    const day = todayInRiyadh(now());
    let shopId: string;
    let newToken: string | undefined;

    if (existing) {
      shopId = existing.id;
      const count = await bumpPublishCounter(deps.sql, shopId, day);
      if (count > MAX_PUBLISHES_PER_SHOP_PER_DAY) {
        log({ event: "shop_publish", status: 429, reason: "rate_limited" });
        return rateLimitedResponse();
      }
    } else {
      shopId = crypto.randomUUID();
      const created = await newEditToken();
      newToken = created.token;
      // A shop row must exist before any shop_photos row can reference it (foreign key), so it's
      // created here first — with every photo reference dropped, since none can possibly be known yet
      // for a brand-new id — and corrected below to the real resolved doc once uploads are done.
      const placeholderDoc = resolveShopDoc(doc, body.slug, new Map());
      await createShop(deps.sql, { id: shopId, slug: body.slug, tokenHash: created.tokenHash, installId: body.installId, doc: placeholderDoc, day });
    }

    const knownPhotos = await getShopPhotoMap(deps.sql, shopId);
    for (const photo of validatedPhotos) {
      if (knownPhotos.has(photo.photoId)) continue; // docs/marketing-tools.md: never re-uploaded.
      const path = `${shopId}/${photo.photoId}.jpg`;
      const uploaded = await deps.uploadPhoto({ shopId, photoId: photo.photoId, bytes: photo.bytes, mimeType: photo.mimeType });
      if (!uploaded) {
        log({ event: "shop_publish", status: 502, reason: "upload_failed" });
        return uploadFailedResponse();
      }
      await recordShopPhoto(deps.sql, shopId, photo.photoId, path);
    }

    const photoUrls = await resolvePhotoUrls(shopId);
    const resolvedDoc = resolveShopDoc(doc, body.slug, photoUrls);
    await updateShopDoc(deps.sql, shopId, body.slug, resolvedDoc);

    log({ event: "shop_publish", status: 200, firstPublish: !existing, photoCount: referencedPhotoIds(doc).length });
    return jsonResponse({
      slug: body.slug,
      url: shopUrl(body.slug),
      ...(newToken ? { token: newToken } : {}),
      photoUrls: Object.fromEntries(photoUrls),
    }, 200);
  }

  async function withAuthedShop(token: string, run: (shop: ShopRow) => Promise<Response>): Promise<Response> {
    const shop = await findShopByToken(deps.sql, token);
    if (!shop) return badTokenResponse();
    return run(shop);
  }

  async function handleOrder(body: OrderBody, req: Request): Promise<Response> {
    const shop = await findShopBySlug(deps.sql, body.slug);
    if (!shop || !shop.published || shop.blocked || !shop.doc.acceptsWebOrders) {
      log({ event: "shop_order", status: 404 });
      return notFoundResponse();
    }

    const resolved = resolveOrderDoc(shop.doc, body);
    if (!resolved.ok) {
      log({ event: "shop_order", status: 400, reason: "bad_items" });
      return invalidBodyResponse();
    }
    if (!isPickupDateAllowed(body.pickupDate, todayInRiyadh(now()), shop.doc.leadTimeDays)) {
      log({ event: "shop_order", status: 400, reason: "bad_pickup_date" });
      return invalidBodyResponse();
    }

    const ipHash = await hashClientIp(req, deps.ipSalt);
    const [ipCount, shopCount] = await Promise.all([
      countOrdersByIpSince(deps.sql, ipHash, new Date(now().getTime() - 60 * 60 * 1000)),
      countOrdersByShopSince(deps.sql, shop.id, new Date(now().getTime() - 24 * 60 * 60 * 1000)),
    ]);
    if (ipCount >= MAX_ORDERS_PER_IP_PER_HOUR || shopCount >= MAX_ORDERS_PER_SHOP_PER_DAY) {
      log({ event: "shop_order", status: 429 });
      return rateLimitedResponse();
    }

    const ref = generateOrderRef();
    await insertOrder(deps.sql, { id: crypto.randomUUID(), shopId: shop.id, ref, doc: resolved.doc, ipHash });
    const whatsappText = buildWhatsappText(ref, resolved.doc, shop.doc.lang);

    log({ event: "shop_order", status: 200 });
    return jsonResponse({ orderRef: ref, whatsappText }, 200);
  }

  const handler = async (req: Request): Promise<Response> => {
    await purgeOldOrders(deps.sql, now());

    if (req.method === "GET") return handlePublicGet(new URL(req.url));
    if (req.method !== "POST") return invalidBodyResponse();

    const raw = await req.text();
    const validated = validateShopBody(raw);
    if (!validated.ok) {
      log({ event: "shop", status: validated.error === "too_large" ? 413 : 400 });
      return validated.error === "too_large" ? tooLargeResponse() : invalidBodyResponse();
    }
    const body = validated.body;

    switch (body.action) {
      case "slug_check": return handleSlugCheck(body.slug);
      case "publish": return handlePublish(body);
      case "unpublish": return withAuthedShop(body.token, async (shop) => {
        await setShopPublished(deps.sql, shop.id, false);
        log({ event: "shop_unpublish", status: 200 });
        return jsonResponse({ ok: true }, 200);
      });
      case "stats": return withAuthedShop(body.token, async (shop) => {
        const stats = await getShopStats(deps.sql, shop.id, new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000));
        log({ event: "shop_stats", status: 200 });
        return jsonResponse(stats, 200);
      });
      case "inbox": return withAuthedShop(body.token, async (shop) => {
        const orders = await listInboxOrders(deps.sql, shop.id);
        log({ event: "shop_inbox", status: 200, count: orders.length });
        return jsonResponse({ orders }, 200);
      });
      case "ack": return withAuthedShop(body.token, async (shop) => {
        const deleted = await ackOrders(deps.sql, shop.id, body.orderIds);
        log({ event: "shop_ack", status: 200, deleted });
        return jsonResponse({ deleted }, 200);
      });
      case "order": return handleOrder(body, req);
      default: return invalidBodyResponse();
    }
  };

  return withPublicCors(handler);
}
