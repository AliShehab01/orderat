import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import { sha256Hex } from "../shared/crypto";
import { createShopHandler, type ShopHandlerDeps, type UploadPhoto } from "./handler";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

const SHOP_BASE_URL = "https://alishehab01.github.io/orderat/s/?";
const PHOTO_BASE_URL = "https://fake.supabase.co/storage/v1/object/public/orderat-shop/";

function makeHandler(overrides: Partial<ShopHandlerDeps> = {}) {
  const uploads: { shopId: string; photoId: string }[] = [];
  const defaultUpload: UploadPhoto = async ({ shopId, photoId }) => {
    uploads.push({ shopId, photoId });
    return true;
  };
  const handler = createShopHandler({
    sql,
    shopBaseUrl: SHOP_BASE_URL,
    publicPhotoBaseUrl: PHOTO_BASE_URL,
    uploadPhoto: overrides.uploadPhoto ?? defaultUpload,
    ipSalt: "test-salt",
    now: () => new Date("2026-09-26T12:00:00Z"),
    log: () => {},
    ...overrides,
  });
  return { handler, uploads };
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/orderat-shop", { method: "POST", body: JSON.stringify(body), ...init });
}

function getReq(query: string, init: RequestInit = {}): Request {
  return new Request(`https://x.supabase.co/functions/v1/orderat-shop${query}`, init);
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function jpegPhoto(bytes: Uint8Array = JPEG_BYTES) {
  return { photoId: await sha256Hex(bytes), mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") };
}

function shopDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: { ar: "سويت ستوديو", en: "Sweet Studio" },
    lang: "ar",
    currency: "BHD",
    whatsapp: "+973 3333-4444",
    leadTimeDays: 1,
    delivery: "pickup_and_delivery",
    acceptsWebOrders: true,
    accent: "#7C4DFF",
    items: [{ id: "p1", name: { ar: "كب تشيز كيك", en: "Cheesecake cups" }, priceMinor: 4500, available: true }],
    ...overrides,
  };
}

function publishBody(overrides: Record<string, unknown> = {}) {
  return { action: "publish", installId: "install-1", slug: "sweetstudio", shop: shopDoc(), photos: [], ...overrides };
}

async function publish(handler: (req: Request) => Promise<Response>, overrides: Record<string, unknown> = {}) {
  const res = await handler(req(publishBody(overrides)));
  return { res, json: await res.json() as Record<string, unknown> };
}

describe("createShopHandler / slug_check", () => {
  it("reports an acceptable, free slug as available", async () => {
    const { handler } = makeHandler();
    const res = await handler(req({ action: "slug_check", slug: "sweetstudio" }));
    expect(await res.json()).toEqual({ available: true });
  });

  it("reports a reserved slug as unavailable", async () => {
    const { handler } = makeHandler();
    const res = await handler(req({ action: "slug_check", slug: "admin" }));
    expect(await res.json()).toEqual({ available: false });
  });

  it("reports a malformed slug as unavailable (not a 400)", async () => {
    const { handler } = makeHandler();
    const res = await handler(req({ action: "slug_check", slug: "N O!" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it("reports an already-taken slug as unavailable", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    const res = await handler(req({ action: "slug_check", slug: "sweetstudio" }));
    expect(await res.json()).toEqual({ available: false });
  });
});

describe("createShopHandler / publish", () => {
  it("creates a shop on first publish and returns a token exactly once", async () => {
    const { handler } = makeHandler();
    const { res, json } = await publish(handler);
    expect(res.status).toBe(200);
    expect(json.slug).toBe("sweetstudio");
    expect(json.url).toBe("https://alishehab01.github.io/orderat/s/?sweetstudio");
    expect(typeof json.token).toBe("string");
    expect((json.token as string).length).toBeGreaterThan(20);
  });

  it("normalizes the shop's whatsapp number to digits only", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    const res = await handler(getReq("?slug=sweetstudio"));
    expect((await res.json() as { whatsapp: string }).whatsapp).toBe("97333334444");
  });

  it("rejects a malformed slug with invalid_body", async () => {
    const { handler } = makeHandler();
    const { res } = await publish(handler, { slug: "Not Valid!" });
    expect(res.status).toBe(400);
  });

  it("rejects a reserved slug with invalid_body", async () => {
    const { handler } = makeHandler();
    const { res } = await publish(handler, { slug: "shop" });
    expect(res.status).toBe(400);
  });

  it("rejects a slug already taken by another shop with slug_taken", async () => {
    const { handler } = makeHandler();
    await publish(handler, { slug: "sweetstudio", installId: "install-1" });
    const { res, json } = await publish(handler, { slug: "sweetstudio", installId: "install-2" });
    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "slug_taken" });
  });

  it("rejects a publish with no matching token as bad_token", async () => {
    const { handler } = makeHandler();
    const { res, json } = await publish(handler, { token: "made-up-token" });
    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "bad_token" });
  });

  it("lets the original publisher update the shop using the returned token", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;
    const updated = await publish(handler, { token, shop: shopDoc({ name: { ar: "اسم جديد", en: "New Name" } }) });
    expect(updated.res.status).toBe(200);
    expect(updated.json.token).toBeUndefined(); // never returned again after the first publish
    const publicRes = await handler(getReq("?slug=sweetstudio"));
    expect((await publicRes.json() as { name: { en: string } }).name.en).toBe("New Name");
  });

  it("lets a republish change the slug when the new one is free", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;
    const moved = await publish(handler, { token, slug: "newslug" });
    expect(moved.res.status).toBe(200);
    expect(moved.json.slug).toBe("newslug");
    expect((await handler(getReq("?slug=sweetstudio"))).status).toBe(404);
    expect((await handler(getReq("?slug=newslug"))).status).toBe(200);
  });

  it("rejects a doc that fails server/shop/doc.ts's own validation", async () => {
    const { handler } = makeHandler();
    const { res } = await publish(handler, { shop: shopDoc({ accent: "not-a-color" }) });
    expect(res.status).toBe(400);
  });

  it("uploads a new photo, records it, and returns its URL in photoUrls", async () => {
    const { handler, uploads } = makeHandler();
    const photo = await jpegPhoto();
    const { res, json } = await publish(handler, {
      shop: shopDoc({ items: [{ id: "p1", name: { ar: "ع", en: "Item" }, priceMinor: 100, available: true, photoId: photo.photoId }] }),
      photos: [photo],
    });
    expect(res.status).toBe(200);
    expect(uploads).toHaveLength(1);
    const photoUrls = json.photoUrls as Record<string, string>;
    expect(photoUrls[photo.photoId]).toBe(`${PHOTO_BASE_URL}${uploads[0].shopId}/${photo.photoId}.jpg`);
  });

  it("resolves the item's photoUrl from the uploaded photo", async () => {
    const { handler } = makeHandler();
    const photo = await jpegPhoto();
    const { json } = await publish(handler, {
      shop: shopDoc({ items: [{ id: "p1", name: { ar: "ع", en: "Item" }, priceMinor: 100, available: true, photoId: photo.photoId }] }),
      photos: [photo],
    });
    const publicRes = await handler(getReq(`?slug=${json.slug}`));
    const body = await publicRes.json() as { items: { photoUrl?: string }[] };
    expect(body.items[0].photoUrl).toContain(photo.photoId);
  });

  it("drops a photo reference that was neither uploaded nor sent", async () => {
    const { handler } = makeHandler();
    const fakeId = "a".repeat(64);
    const { json } = await publish(handler, {
      shop: shopDoc({ items: [{ id: "p1", name: { ar: "ع", en: "Item" }, priceMinor: 100, available: true, photoId: fakeId }] }),
      photos: [],
    });
    const publicRes = await handler(getReq(`?slug=${json.slug}`));
    const body = await publicRes.json() as { items: { photoUrl?: string }[] };
    expect(body.items[0].photoUrl).toBeUndefined();
  });

  it("never re-uploads a photo the server already has (dedupe by photoId)", async () => {
    const { handler, uploads } = makeHandler();
    const photo = await jpegPhoto();
    const first = await publish(handler, { photos: [photo] });
    const token = first.json.token as string;
    await publish(handler, { token, photos: [photo] }); // sends the identical photo again
    expect(uploads).toHaveLength(1); // only ever uploaded once
  });

  it("rejects a photo whose hash doesn't match its claimed photoId", async () => {
    const { handler } = makeHandler();
    const photo = await jpegPhoto();
    const { res } = await publish(handler, { photos: [{ ...photo, photoId: "b".repeat(64) }] });
    expect(res.status).toBe(400);
  });

  it("returns 413 too_large for an oversized photo", async () => {
    const { handler } = makeHandler();
    const big = new Uint8Array(401 * 1024);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const photo = await jpegPhoto(big);
    const { res } = await publish(handler, { photos: [photo] });
    expect(res.status).toBe(413);
  });

  it("returns 502 ai_unavailable when the storage upload fails", async () => {
    const { handler } = makeHandler({ uploadPhoto: async () => false });
    const photo = await jpegPhoto();
    const { res, json } = await publish(handler, { photos: [photo] });
    expect(res.status).toBe(502);
    expect(json).toEqual({ error: "ai_unavailable" });
  });

  it("enforces 30 publishes per shop per day with rate_limited", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;
    for (let i = 0; i < 29; i++) expect((await publish(handler, { token })).res.status).toBe(200);
    const blocked = await publish(handler, { token });
    expect(blocked.res.status).toBe(429);
    expect(blocked.json).toEqual({ error: "rate_limited" });
  });

  it("never logs the token or the shop document", async () => {
    const logs: Record<string, unknown>[] = [];
    const { handler } = makeHandler({ log: (e) => logs.push(e) });
    await publish(handler, { shop: shopDoc({ whatsapp: "SECRET-CUSTOM-WHATSAPP-000" }) });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("SECRET-CUSTOM-WHATSAPP-000");
  });
});

describe("createShopHandler / public GET", () => {
  it("returns 404 not_found for a slug that doesn't exist", async () => {
    const { handler } = makeHandler();
    const res = await handler(getReq("?slug=no-such-shop"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 for an unpublished shop", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    await handler(req({ action: "unpublish", token: first.json.token }));
    const res = await handler(getReq("?slug=sweetstudio"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a blocked shop", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    await sql.query("update orderat.shops set blocked = true where slug = $1", ["sweetstudio"]);
    const res = await handler(getReq("?slug=sweetstudio"));
    expect(res.status).toBe(404);
  });

  it("never exposes token_hash or install_id", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    const res = await handler(getReq("?slug=sweetstudio"));
    const text = await res.text();
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain("install_id");
    expect(text).not.toContain("install-1");
  });

  it("includes the computed url and a 60s cache header", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    const res = await handler(getReq("?slug=sweetstudio"));
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await res.json() as { url: string }).url).toBe("https://alishehab01.github.io/orderat/s/?sweetstudio");
  });

  it("counts a view on every successful public read", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    await handler(getReq("?slug=sweetstudio"));
    await handler(getReq("?slug=sweetstudio"));
    const statsRes = await handler(req({ action: "stats", token: (await publish(handler, { slug: "second-shop" })).json.token }));
    void statsRes; // stats is for the second shop; views are checked directly below instead.
    const row = await sql.query<{ count: number }>("select count from orderat.shop_views_daily where shop_id = (select id from orderat.shops where slug = 'sweetstudio')");
    expect(row[0]?.count).toBe(2);
  });
});

describe("createShopHandler / unpublish, stats, inbox, ack", () => {
  it("unpublish requires a valid token and hides the shop afterward", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const bad = await handler(req({ action: "unpublish", token: "wrong" }));
    expect(bad.status).toBe(401);
    const ok = await handler(req({ action: "unpublish", token: first.json.token }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect((await handler(getReq("?slug=sweetstudio"))).status).toBe(404);
  });

  it("stats requires a valid token and reports views/orders/pending", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;
    await handler(getReq("?slug=sweetstudio"));
    const res = await handler(req({ action: "stats", token }));
    expect(res.status).toBe(200);
    const stats = await res.json() as { views7d: number; orders7d: number; pending: number };
    expect(stats.views7d).toBe(1);
    expect(stats.orders7d).toBe(0);
    expect(stats.pending).toBe(0);
  });

  it("stats with a bad token is bad_token", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    const res = await handler(req({ action: "stats", token: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("inbox lists an order placed through the page, and ack removes it", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;

    const orderRes = await handler(req({
      action: "order", slug: "sweetstudio", customer: { name: "Sara", phone: "97300001111" },
      items: [{ id: "p1", qty: 2 }], pickupDate: "2026-09-28",
    }));
    expect(orderRes.status).toBe(200);
    const { orderRef, whatsappText } = await orderRes.json() as { orderRef: string; whatsappText: string };
    expect(orderRef).toMatch(/^W\d{4}$/);
    expect(whatsappText).toContain("Sara");

    const inboxRes = await handler(req({ action: "inbox", token }));
    const inbox = await inboxRes.json() as { orders: { id: string; ref: string }[] };
    expect(inbox.orders).toHaveLength(1);
    expect(inbox.orders[0].ref).toBe(orderRef);

    const ackRes = await handler(req({ action: "ack", token, orderIds: [inbox.orders[0].id] }));
    expect(await ackRes.json()).toEqual({ deleted: 1 });
    const afterAck = await handler(req({ action: "inbox", token }));
    expect((await afterAck.json() as { orders: unknown[] }).orders).toEqual([]);
  });

  it("inbox/ack with a bad token is bad_token", async () => {
    const { handler } = makeHandler();
    await publish(handler);
    expect((await handler(req({ action: "inbox", token: "wrong" }))).status).toBe(401);
    expect((await handler(req({ action: "ack", token: "wrong", orderIds: ["x"] }))).status).toBe(401);
  });
});

describe("createShopHandler / order validation", () => {
  async function publishedShop(handler: (req: Request) => Promise<Response>, shopOverrides: Record<string, unknown> = {}) {
    return publish(handler, { shop: shopDoc(shopOverrides) });
  }

  function orderBody(overrides: Record<string, unknown> = {}) {
    return {
      action: "order", slug: "sweetstudio", customer: { name: "Sara", phone: "97300001111" },
      items: [{ id: "p1", qty: 1 }], pickupDate: "2026-09-28",
      ...overrides,
    };
  }

  function orderReq(overrides: Record<string, unknown> = {}) {
    return req(orderBody(overrides));
  }

  function orderReqFromIp(ip: string, overrides: Record<string, unknown> = {}): Request {
    return new Request("https://x.supabase.co/functions/v1/orderat-shop", {
      method: "POST",
      body: JSON.stringify(orderBody(overrides)),
      headers: { "x-forwarded-for": ip },
    });
  }

  it("uses the server's own price, ignoring anything the page might send", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler);
    const res = await handler(orderReq({ items: [{ id: "p1", qty: 2 }] }));
    const { whatsappText } = await res.json() as { whatsappText: string };
    expect(whatsappText).toContain("9.000 BHD"); // 2 x 4.500, the server's stored price
  });

  it("rejects an unknown item id with invalid_body", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler);
    const res = await handler(orderReq({ items: [{ id: "no-such-item", qty: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects an unavailable item id with invalid_body", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler, { items: [{ id: "p1", name: { ar: "ع", en: "Item" }, priceMinor: 100, available: false }] });
    const res = await handler(orderReq());
    expect(res.status).toBe(400);
  });

  it("rejects a pickupDate earlier than today + leadTimeDays", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler, { leadTimeDays: 3 });
    const res = await handler(orderReq({ pickupDate: "2026-09-27" })); // only +1 day, needs +3
    expect(res.status).toBe(400);
  });

  it("accepts a pickupDate exactly at leadTimeDays", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler, { leadTimeDays: 3 });
    const res = await handler(orderReq({ pickupDate: "2026-09-29" }));
    expect(res.status).toBe(200);
  });

  it("rejects a pickupDate more than 60 days out", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler);
    const res = await handler(orderReq({ pickupDate: "2026-12-26" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 not_found for a shop that doesn't accept web orders", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler, { acceptsWebOrders: false });
    const res = await handler(orderReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 not_found for an unknown shop slug", async () => {
    const { handler } = makeHandler();
    const res = await handler(orderReq({ slug: "no-such-shop" }));
    expect(res.status).toBe(404);
  });

  it("rate-limits above 5 orders per hour from the same IP hash", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler);
    for (let i = 0; i < 5; i++) {
      const res = await handler(orderReqFromIp("1.2.3.4"));
      expect(res.status).toBe(200);
    }
    const blockedRes = await handler(orderReqFromIp("1.2.3.4"));
    expect(blockedRes.status).toBe(429);
    expect(await blockedRes.json()).toEqual({ error: "rate_limited" });
  });

  it("keeps different IPs independent for the per-IP rate limit", async () => {
    const { handler } = makeHandler();
    await publishedShop(handler);
    for (let i = 0; i < 5; i++) expect((await handler(orderReqFromIp("1.1.1.1"))).status).toBe(200);
    expect((await handler(orderReqFromIp("2.2.2.2"))).status).toBe(200); // a different IP is still fresh
  });
});

describe("createShopHandler / CORS", () => {
  it("answers an allowed OPTIONS preflight without reaching the shop logic", async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request("https://x.supabase.co/functions/v1/orderat-shop", {
      method: "OPTIONS",
      headers: { origin: "https://alishehab01.github.io", "access-control-request-method": "POST" },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://alishehab01.github.io");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("reflects a local dev origin on a real response", async () => {
    const { handler } = makeHandler();
    const res = await handler(getReq("?slug=no-such-shop", { headers: { origin: "http://localhost:5173" } }));
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("never reflects a disallowed origin", async () => {
    const { handler } = makeHandler();
    const res = await handler(getReq("?slug=no-such-shop", { headers: { origin: "https://evil.example.com" } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("createShopHandler / shared", () => {
  it("purges orders older than 30 days on an ordinary request", async () => {
    const { handler } = makeHandler();
    const first = await publish(handler);
    const token = first.json.token as string;
    await handler(req({
      action: "order", slug: "sweetstudio", customer: { name: "Sara", phone: "97300001111" },
      items: [{ id: "p1", qty: 1 }], pickupDate: "2026-09-28",
    }));
    // Relative to the handler's fixed clock (2026-09-26T12:00Z), not the database's real now():
    // with now() the row's time of day decided whether it fell past the cutoff, so the test failed
    // whenever it ran after noon UTC.
    await sql.query("update orderat.shop_orders set created_at = timestamptz '2026-09-26T12:00:00Z' - interval '31 days'");

    await handler(req({ action: "stats", token })); // any request opportunistically purges first
    const inboxRes = await handler(req({ action: "inbox", token }));
    expect((await inboxRes.json() as { orders: unknown[] }).orders).toEqual([]);
  });

  it("returns 400 invalid_body for an unknown action", async () => {
    const { handler } = makeHandler();
    const res = await handler(req({ action: "delete_everything" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_body for a PUT request", async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request("https://x.supabase.co/functions/v1/orderat-shop", { method: "PUT" }));
    expect(res.status).toBe(400);
  });
});
