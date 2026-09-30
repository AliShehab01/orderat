import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createMarketingTestSql } from "../marketing-pglite-test-support.ts";
import type { ShopDocPublic } from "./doc";
import {
  bumpPublishCounter,
  createShop,
  findShopBySlug,
  findShopByToken,
  findShopByTokenHash,
  getShopPhotoMap,
  getShopStats,
  incrementShopView,
  recordShopPhoto,
  setShopPublished,
  updateShopDoc,
} from "./store";
import { newEditToken } from "../shared/crypto";

let sql: SqlClient;

beforeEach(async () => {
  sql = await createMarketingTestSql();
});

const DOC: ShopDocPublic = {
  slug: "sweetstudio", name: { ar: "ع", en: "Sweet Studio" }, lang: "ar", currency: "BHD", whatsapp: "97333334444",
  leadTimeDays: 1, delivery: "pickup", acceptsWebOrders: true, accent: "#7C4DFF", items: [],
};
const SHOP_ID = "11111111-1111-1111-1111-111111111111";

async function seed() {
  await createShop(sql, { id: SHOP_ID, slug: "sweetstudio", tokenHash: "hash-1", installId: "install-1", doc: DOC, day: "2026-09-26" });
}

describe("createShop / findShopBySlug / findShopByTokenHash", () => {
  it("creates a shop findable by slug and by token hash", async () => {
    await seed();
    const bySlug = await findShopBySlug(sql, "sweetstudio");
    expect(bySlug?.id).toBe(SHOP_ID);
    expect(bySlug?.published).toBe(true);
    expect(bySlug?.blocked).toBe(false);
    expect(bySlug?.publishCountToday).toBe(1);

    const byToken = await findShopByTokenHash(sql, "hash-1");
    expect(byToken?.id).toBe(SHOP_ID);
  });

  it("returns undefined for an unknown slug or token", async () => {
    expect(await findShopBySlug(sql, "no-such-slug")).toBeUndefined();
    expect(await findShopByTokenHash(sql, "no-such-hash")).toBeUndefined();
  });

  it("never returns another shop's row for the wrong token", async () => {
    await seed();
    await createShop(sql, { id: "22222222-2222-2222-2222-222222222222", slug: "other-shop", tokenHash: "hash-2", installId: "install-2", doc: { ...DOC, slug: "other-shop" }, day: "2026-09-26" });
    expect((await findShopByTokenHash(sql, "hash-2"))?.id).toBe("22222222-2222-2222-2222-222222222222");
  });
});

describe("findShopByToken", () => {
  it("finds the shop for the raw token that created it", async () => {
    const { token, tokenHash } = await newEditToken();
    await createShop(sql, { id: SHOP_ID, slug: "sweetstudio", tokenHash, installId: "install-1", doc: DOC, day: "2026-09-26" });
    const shop = await findShopByToken(sql, token);
    expect(shop?.id).toBe(SHOP_ID);
  });

  it("returns undefined for a token that doesn't match any shop", async () => {
    const { tokenHash } = await newEditToken();
    await createShop(sql, { id: SHOP_ID, slug: "sweetstudio", tokenHash, installId: "install-1", doc: DOC, day: "2026-09-26" });
    const { token: otherToken } = await newEditToken();
    expect(await findShopByToken(sql, otherToken)).toBeUndefined();
  });

  it("never confuses one shop's token with another's", async () => {
    const a = await newEditToken();
    const b = await newEditToken();
    await createShop(sql, { id: "11111111-1111-1111-1111-111111111111", slug: "shop-a", tokenHash: a.tokenHash, installId: "install-a", doc: { ...DOC, slug: "shop-a" }, day: "2026-09-26" });
    await createShop(sql, { id: "22222222-2222-2222-2222-222222222222", slug: "shop-b", tokenHash: b.tokenHash, installId: "install-b", doc: { ...DOC, slug: "shop-b" }, day: "2026-09-26" });
    expect((await findShopByToken(sql, a.token))?.slug).toBe("shop-a");
    expect((await findShopByToken(sql, b.token))?.slug).toBe("shop-b");
  });
});

describe("bumpPublishCounter", () => {
  it("increments the counter on the same day", async () => {
    await seed(); // starts at 1
    expect(await bumpPublishCounter(sql, SHOP_ID, "2026-09-26")).toBe(2);
    expect(await bumpPublishCounter(sql, SHOP_ID, "2026-09-26")).toBe(3);
  });

  it("resets the counter to 1 on a new day", async () => {
    await seed();
    await bumpPublishCounter(sql, SHOP_ID, "2026-09-26");
    expect(await bumpPublishCounter(sql, SHOP_ID, "2026-09-27")).toBe(1);
  });

  it("never touches slug or doc", async () => {
    await seed();
    await bumpPublishCounter(sql, SHOP_ID, "2026-09-26");
    const row = await findShopBySlug(sql, "sweetstudio");
    expect(row?.doc).toEqual(DOC);
  });
});

describe("updateShopDoc / setShopPublished", () => {
  it("updates the slug and doc and marks the shop published", async () => {
    await seed();
    await setShopPublished(sql, SHOP_ID, false);
    const newDoc = { ...DOC, slug: "newslug", name: { ar: "جديد", en: "New Name" } };
    await updateShopDoc(sql, SHOP_ID, "newslug", newDoc);
    const row = await findShopBySlug(sql, "newslug");
    expect(row?.published).toBe(true);
    expect(row?.doc.name.en).toBe("New Name");
  });

  it("setShopPublished(false) is reflected on the next read", async () => {
    await seed();
    await setShopPublished(sql, SHOP_ID, false);
    expect((await findShopBySlug(sql, "sweetstudio"))?.published).toBe(false);
  });
});

describe("photo map", () => {
  it("returns an empty map for a shop with no photos", async () => {
    await seed();
    expect((await getShopPhotoMap(sql, SHOP_ID)).size).toBe(0);
  });

  it("records a photo and returns it in the map", async () => {
    await seed();
    await recordShopPhoto(sql, SHOP_ID, "a".repeat(64), `${SHOP_ID}/${"a".repeat(64)}.jpg`);
    const map = await getShopPhotoMap(sql, SHOP_ID);
    expect(map.get("a".repeat(64))).toBe(`${SHOP_ID}/${"a".repeat(64)}.jpg`);
  });

  it("recording the same photo twice is a no-op, not an error", async () => {
    await seed();
    await recordShopPhoto(sql, SHOP_ID, "a".repeat(64), "path-1");
    await recordShopPhoto(sql, SHOP_ID, "a".repeat(64), "path-2");
    const map = await getShopPhotoMap(sql, SHOP_ID);
    expect(map.get("a".repeat(64))).toBe("path-1");
  });
});

describe("incrementShopView / getShopStats", () => {
  it("counts views within the last 7 days", async () => {
    await seed();
    await incrementShopView(sql, SHOP_ID, "2026-09-26");
    await incrementShopView(sql, SHOP_ID, "2026-09-26");
    await incrementShopView(sql, SHOP_ID, "2026-09-20"); // outside the 7-day window
    const stats = await getShopStats(sql, SHOP_ID, new Date("2026-09-20T00:00:00Z"));
    expect(stats.views7d).toBeGreaterThanOrEqual(2);
  });

  it("reports 0 for a shop with no activity", async () => {
    await seed();
    const stats = await getShopStats(sql, SHOP_ID, new Date());
    expect(stats).toEqual({ views7d: 0, orders7d: 0, pending: 0 });
  });
});

// db/migrations/0008_shop_payment_methods.sql: a shop published before payment methods existed gets its
// IBAN as one bank_transfer method (no account-holder name); re-running the migration changes nothing.
describe("migration 0008 payment_methods backfill", () => {
  it("backfills bank_transfer from the doc's iban, only for shops with no methods", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(new URL("../../db/migrations/0008_shop_payment_methods.sql", import.meta.url), "utf8");
    const withIban = { ...DOC, iban: "BH67BMAG00001299123456", ibanName: "Old holder" };
    await createShop(sql, { id: SHOP_ID, slug: "sweetstudio", tokenHash: "h1", installId: "i1", doc: withIban, day: "2026-09-26" });
    await createShop(sql, { id: "22222222-2222-2222-2222-222222222222", slug: "noiban", tokenHash: "h2", installId: "i2", doc: { ...DOC, slug: "noiban" }, day: "2026-09-26" });
    await createShop(sql, { id: "33333333-3333-3333-3333-333333333333", slug: "already", tokenHash: "h3", installId: "i3", doc: { ...withIban, slug: "already" }, paymentMethods: [{ type: "cash" }], day: "2026-09-26" });

    for (let run = 0; run < 2; run++) {
      for (const statement of migration.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(statement);
    }

    expect((await findShopBySlug(sql, "sweetstudio"))?.paymentMethods).toEqual([{ type: "bank_transfer", value: "BH67BMAG00001299123456" }]);
    expect((await findShopBySlug(sql, "noiban"))?.paymentMethods).toEqual([]);
    expect((await findShopBySlug(sql, "already"))?.paymentMethods).toEqual([{ type: "cash" }]);
  });
});
