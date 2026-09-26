import { describe, expect, it } from "vitest";
import { normalizeWhatsapp, referencedPhotoIds, resolveShopDoc, validateShopDoc, type ShopDocRequest } from "./doc";

const PHOTO_ID_A = "a".repeat(64);
const PHOTO_ID_B = "b".repeat(64);

function validDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: { ar: "سويت ستوديو", en: "Sweet Studio" },
    bio: "حلويات بيتية طازجة",
    lang: "ar",
    currency: "BHD",
    whatsapp: "97333334444",
    instagram: "sweetstudio.bh",
    area: "الرفاع",
    pickupHours: "4:00 PM - 8:00 PM",
    leadTimeDays: 1,
    delivery: "pickup_and_delivery",
    acceptsWebOrders: true,
    accent: "#7C4DFF",
    items: [
      { id: "p1", name: { ar: "كب تشيز كيك", en: "Cheesecake cups" }, description: "علبة 6 حبات", priceMinor: 4500, available: true },
    ],
    ...overrides,
  };
}

describe("normalizeWhatsapp", () => {
  it("passes through a plain digits-only number", () => {
    expect(normalizeWhatsapp("97333334444")).toBe("97333334444");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeWhatsapp("973 3333-4444")).toBe("97333334444");
  });

  it("strips a leading +", () => {
    expect(normalizeWhatsapp("+97333334444")).toBe("97333334444");
  });

  it("strips a leading 00", () => {
    expect(normalizeWhatsapp("0097333334444")).toBe("97333334444");
  });

  it("strips a leading + together with spaces/dashes", () => {
    expect(normalizeWhatsapp("+973 3333-4444")).toBe("97333334444");
  });

  it("does not mistake an interior 00 for the international prefix", () => {
    expect(normalizeWhatsapp("97300334444")).toBe("97300334444");
  });
});

describe("validateShopDoc", () => {
  it("accepts a valid document and normalizes whatsapp", () => {
    const result = validateShopDoc(validDoc({ whatsapp: "+973 3333-4444" }));
    expect(result?.whatsapp).toBe("97333334444");
  });

  it("rejects a document missing a bilingual name", () => {
    expect(validateShopDoc(validDoc({ name: { ar: "فقط" } }))).toBeUndefined();
  });

  it("rejects a name longer than 60 characters", () => {
    expect(validateShopDoc(validDoc({ name: { ar: "ع", en: "a".repeat(61) } }))).toBeUndefined();
  });

  it("rejects a bio longer than 300 characters", () => {
    expect(validateShopDoc(validDoc({ bio: "a".repeat(301) }))).toBeUndefined();
  });

  it("accepts a missing (optional) bio", () => {
    const doc = validDoc();
    delete (doc as Record<string, unknown>).bio;
    expect(validateShopDoc(doc)).toBeTruthy();
  });

  it("rejects an unknown lang", () => {
    expect(validateShopDoc(validDoc({ lang: "fr" }))).toBeUndefined();
  });

  it("rejects a lowercase currency", () => {
    expect(validateShopDoc(validDoc({ currency: "bhd" }))).toBeUndefined();
  });

  it("rejects a whatsapp number that's too short after normalization", () => {
    expect(validateShopDoc(validDoc({ whatsapp: "12345" }))).toBeUndefined();
  });

  it("rejects a whatsapp number that's too long after normalization", () => {
    expect(validateShopDoc(validDoc({ whatsapp: "1".repeat(16) }))).toBeUndefined();
  });

  it("rejects an unknown delivery value", () => {
    expect(validateShopDoc(validDoc({ delivery: "drone" }))).toBeUndefined();
  });

  it("rejects a non-hex accent", () => {
    expect(validateShopDoc(validDoc({ accent: "purple" }))).toBeUndefined();
  });

  it("rejects leadTimeDays over 60", () => {
    expect(validateShopDoc(validDoc({ leadTimeDays: 61 }))).toBeUndefined();
  });

  it("rejects a negative leadTimeDays", () => {
    expect(validateShopDoc(validDoc({ leadTimeDays: -1 }))).toBeUndefined();
  });

  it("accepts leadTimeDays of 0", () => {
    expect(validateShopDoc(validDoc({ leadTimeDays: 0 }))).toBeTruthy();
  });

  it("rejects more than 60 items", () => {
    const items = Array.from({ length: 61 }, (_, i) => ({ id: `p${i}`, name: { ar: "ع", en: "N" }, priceMinor: 100, available: true }));
    expect(validateShopDoc(validDoc({ items }))).toBeUndefined();
  });

  it("accepts exactly 60 items", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: { ar: "ع", en: "N" }, priceMinor: 100, available: true }));
    expect(validateShopDoc(validDoc({ items }))).toBeTruthy();
  });

  it("rejects an item description longer than 200 characters", () => {
    const items = [{ id: "p1", name: { ar: "ع", en: "N" }, description: "a".repeat(201), priceMinor: 100, available: true }];
    expect(validateShopDoc(validDoc({ items }))).toBeUndefined();
  });

  it("rejects a negative priceMinor on an item", () => {
    const items = [{ id: "p1", name: { ar: "ع", en: "N" }, priceMinor: -1, available: true }];
    expect(validateShopDoc(validDoc({ items }))).toBeUndefined();
  });

  it("rejects an item missing the available flag", () => {
    const items = [{ id: "p1", name: { ar: "ع", en: "N" }, priceMinor: 100 }];
    expect(validateShopDoc(validDoc({ items }))).toBeUndefined();
  });

  it("accepts a valid photoId and logoId (64 hex chars)", () => {
    const items = [{ id: "p1", name: { ar: "ع", en: "N" }, priceMinor: 100, available: true, photoId: PHOTO_ID_A }];
    const result = validateShopDoc(validDoc({ items, logoId: PHOTO_ID_B }));
    expect(result?.items[0].photoId).toBe(PHOTO_ID_A);
    expect(result?.logoId).toBe(PHOTO_ID_B);
  });

  it("rejects a malformed photoId (not 64 hex chars)", () => {
    const items = [{ id: "p1", name: { ar: "ع", en: "N" }, priceMinor: 100, available: true, photoId: "not-a-hash" }];
    expect(validateShopDoc(validDoc({ items }))).toBeUndefined();
  });

  it("rejects a body that isn't an object", () => {
    expect(validateShopDoc("nope")).toBeUndefined();
    expect(validateShopDoc(null)).toBeUndefined();
  });
});

describe("resolveShopDoc / referencedPhotoIds", () => {
  const doc: ShopDocRequest = {
    name: { ar: "ع", en: "Shop" }, lang: "ar", currency: "BHD", whatsapp: "97333334444",
    leadTimeDays: 1, delivery: "pickup", acceptsWebOrders: true, accent: "#7C4DFF",
    logoId: PHOTO_ID_A,
    items: [
      { id: "p1", name: { ar: "ع", en: "Item 1" }, priceMinor: 100, available: true, photoId: PHOTO_ID_B },
      { id: "p2", name: { ar: "ع", en: "Item 2" }, priceMinor: 200, available: false },
    ],
  };

  it("lists every referenced photoId including the logo", () => {
    expect(referencedPhotoIds(doc).sort()).toEqual([PHOTO_ID_A, PHOTO_ID_B].sort());
  });

  it("resolves photoId/logoId to URLs from the given map", () => {
    const urls = new Map([[PHOTO_ID_A, "https://x/a.jpg"], [PHOTO_ID_B, "https://x/b.jpg"]]);
    const resolved = resolveShopDoc(doc, "sweetstudio", urls);
    expect(resolved.slug).toBe("sweetstudio");
    expect(resolved.logoUrl).toBe("https://x/a.jpg");
    expect(resolved.items[0].photoUrl).toBe("https://x/b.jpg");
    expect(resolved.items[1].photoUrl).toBeUndefined();
  });

  it("drops a photo reference that isn't in the map (neither uploaded nor known)", () => {
    const resolved = resolveShopDoc(doc, "sweetstudio", new Map());
    expect(resolved.logoUrl).toBeUndefined();
    expect(resolved.items[0].photoUrl).toBeUndefined();
  });

  it("never includes a photoId/logoId field in the resolved doc", () => {
    const urls = new Map([[PHOTO_ID_A, "https://x/a.jpg"]]);
    const resolved = resolveShopDoc(doc, "sweetstudio", urls) as unknown as Record<string, unknown>;
    expect(resolved).not.toHaveProperty("logoId");
    expect((resolved.items as Record<string, unknown>[])[0]).not.toHaveProperty("photoId");
  });
});
