// The public shop document (docs/marketing-tools.md's "Public shop document") — validation of the
// shape a seller's app sends when publishing, and the (pure) transform that turns it into the shape
// actually stored and served, with photo references resolved from `photoId` to a real URL. Same
// "deliberately strict and type-only" philosophy as server/ask/validate.ts: this never decides
// whether a slug is taken or a photo exists — server/shop/handler.ts does, with the database in
// hand — it only bounds size/shape so a malformed body can't reach that far.

const MAX_ITEMS = 60;
const MAX_NAME_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_BIO_CHARS = 300;
const MAX_AREA_CHARS = 100;
const MAX_PICKUP_HOURS_CHARS = 100;
const MAX_INSTAGRAM_CHARS = 60;
const MAX_LEAD_TIME_DAYS = 60;
const MAX_ITEM_ID_CHARS = 64;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
/** A photoId/logoId is always a SHA-256 hex digest (server/shop/photos.ts). */
const PHOTO_ID_RE = /^[0-9a-f]{64}$/;

export type ShopLang = "ar" | "en";
export type Delivery = "pickup" | "delivery" | "pickup_and_delivery";

export interface Bilingual {
  ar: string;
  en: string;
}

/** The shape a publish request's `shop.items[]` entries take: photos are referenced by `photoId`
 * (docs/marketing-tools.md: "items and the logo refer to photos by photoId"), resolved to a real URL
 * only once stored — see resolveShopDoc below. */
export interface ShopItemRequest {
  id: string;
  name: Bilingual;
  description?: string;
  priceMinor: number;
  photoId?: string;
  available: boolean;
}

export interface ShopDocRequest {
  name: Bilingual;
  bio?: string;
  lang: ShopLang;
  currency: string;
  /** Already normalized to digits-only by validateShopDoc (see normalizeWhatsapp) — callers never
   * need to normalize it again. */
  whatsapp: string;
  instagram?: string;
  area?: string;
  pickupHours?: string;
  leadTimeDays: number;
  delivery: Delivery;
  acceptsWebOrders: boolean;
  accent: string;
  logoId?: string;
  items: ShopItemRequest[];
}

export interface ShopItemPublic {
  id: string;
  name: Bilingual;
  description?: string;
  priceMinor: number;
  photoUrl?: string;
  available: boolean;
}

/** The exact shape docs/marketing-tools.md's "Public shop document" shows — what's stored in
 * `orderat.shops.doc` and served verbatim (plus a computed `url`) by the public GET. */
export interface ShopDocPublic {
  slug: string;
  name: Bilingual;
  bio?: string;
  lang: ShopLang;
  currency: string;
  whatsapp: string;
  instagram?: string;
  area?: string;
  pickupHours?: string;
  leadTimeDays: number;
  delivery: Delivery;
  acceptsWebOrders: boolean;
  accent: string;
  logoUrl?: string;
  items: ShopItemPublic[];
}

/**
 * Strips whitespace/dashes and a leading "+" or "00" international-call prefix, then drops anything
 * left that isn't a digit — so "+973 3333-4444" and "00973 3333 4444" and "97333334444" all normalize
 * to the same "97333334444", matching docs/marketing-tools.md's public document example. A bare "+"
 * is stripped by the final digit-only pass on its own, but a leading "00" is digits too and would
 * otherwise be indistinguishable from a number that genuinely starts with two zeros — hence the
 * explicit prefix step before that pass.
 */
export function normalizeWhatsapp(raw: string): string {
  const cleaned = raw.replace(/[\s-]/g, "");
  const withoutPrefix = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned.startsWith("00") ? cleaned.slice(2) : cleaned;
  return withoutPrefix.replace(/\D/g, "");
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || isNonEmptyString(value, maxLength);
}

function isBilingual(value: unknown, maxLength: number): value is Bilingual {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return isNonEmptyString(o.ar, maxLength) && isNonEmptyString(o.en, maxLength);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPhotoIdFormat(value: unknown): value is string {
  return typeof value === "string" && PHOTO_ID_RE.test(value);
}

function validateItem(raw: unknown): ShopItemRequest | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.id, MAX_ITEM_ID_CHARS)) return undefined;
  if (!isBilingual(o.name, MAX_NAME_CHARS)) return undefined;
  if (!isOptionalString(o.description, MAX_DESCRIPTION_CHARS)) return undefined;
  if (!isNonNegativeInteger(o.priceMinor)) return undefined;
  if (o.photoId !== undefined && !isPhotoIdFormat(o.photoId)) return undefined;
  if (typeof o.available !== "boolean") return undefined;
  return {
    id: o.id, name: o.name, description: o.description as string | undefined, priceMinor: o.priceMinor,
    photoId: o.photoId as string | undefined, available: o.available,
  };
}

/**
 * Validates a publish request's `shop` field against every rule in docs/marketing-tools.md's
 * "Public shop document" section (bilingual name, size limits, known enums, #RRGGBB accent, a
 * SHA-256-hex-shaped photoId/logoId) and, as its one normalization step, replaces `whatsapp` with
 * its digits-only form. Returns undefined for anything that doesn't fit — callers turn that into the
 * spec's 400 `invalid_body`.
 */
export function validateShopDoc(raw: unknown): ShopDocRequest | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;

  if (!isBilingual(o.name, MAX_NAME_CHARS)) return undefined;
  if (!isOptionalString(o.bio, MAX_BIO_CHARS)) return undefined;
  if (o.lang !== "ar" && o.lang !== "en") return undefined;
  if (!(typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency))) return undefined;
  if (typeof o.whatsapp !== "string") return undefined;
  const whatsapp = normalizeWhatsapp(o.whatsapp);
  if (!/^\d{8,15}$/.test(whatsapp)) return undefined;
  if (!isOptionalString(o.instagram, MAX_INSTAGRAM_CHARS)) return undefined;
  if (!isOptionalString(o.area, MAX_AREA_CHARS)) return undefined;
  if (!isOptionalString(o.pickupHours, MAX_PICKUP_HOURS_CHARS)) return undefined;
  if (!(isNonNegativeInteger(o.leadTimeDays) && o.leadTimeDays <= MAX_LEAD_TIME_DAYS)) return undefined;
  if (o.delivery !== "pickup" && o.delivery !== "delivery" && o.delivery !== "pickup_and_delivery") return undefined;
  if (typeof o.acceptsWebOrders !== "boolean") return undefined;
  if (!(typeof o.accent === "string" && HEX_COLOR_RE.test(o.accent))) return undefined;
  if (o.logoId !== undefined && !isPhotoIdFormat(o.logoId)) return undefined;
  if (!Array.isArray(o.items) || o.items.length > MAX_ITEMS) return undefined;

  const items: ShopItemRequest[] = [];
  for (const rawItem of o.items) {
    const item = validateItem(rawItem);
    if (!item) return undefined;
    items.push(item);
  }

  return {
    name: o.name, bio: o.bio as string | undefined, lang: o.lang, currency: o.currency, whatsapp,
    instagram: o.instagram as string | undefined, area: o.area as string | undefined,
    pickupHours: o.pickupHours as string | undefined, leadTimeDays: o.leadTimeDays,
    delivery: o.delivery, acceptsWebOrders: o.acceptsWebOrders, accent: o.accent,
    logoId: o.logoId as string | undefined, items,
  };
}

/**
 * Turns a validated request doc into the stored/public shape: every `photoId`/`logoId` becomes a
 * `photoUrl`/`logoUrl` looked up in `photoUrls` (the photos this publish call just uploaded, plus
 * every photo server/shop/handler.ts already knew about for this shop), or is dropped entirely when
 * neither uploaded nor already known — docs/marketing-tools.md: "A referenced photo that is neither
 * uploaded nor sent is dropped from the item."
 */
export function resolveShopDoc(doc: ShopDocRequest, slug: string, photoUrls: ReadonlyMap<string, string>): ShopDocPublic {
  return {
    slug,
    name: doc.name,
    bio: doc.bio,
    lang: doc.lang,
    currency: doc.currency,
    whatsapp: doc.whatsapp,
    instagram: doc.instagram,
    area: doc.area,
    pickupHours: doc.pickupHours,
    leadTimeDays: doc.leadTimeDays,
    delivery: doc.delivery,
    acceptsWebOrders: doc.acceptsWebOrders,
    accent: doc.accent,
    logoUrl: doc.logoId ? photoUrls.get(doc.logoId) : undefined,
    items: doc.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      priceMinor: item.priceMinor,
      photoUrl: item.photoId ? photoUrls.get(item.photoId) : undefined,
      available: item.available,
    })),
  };
}

/** Every photoId referenced anywhere in a validated doc (logo + items) — server/shop/handler.ts uses
 * this to know which photos it must resolve a URL for (from this call's uploads or from
 * orderat.shop_photos) before calling resolveShopDoc. */
export function referencedPhotoIds(doc: ShopDocRequest): string[] {
  const ids = doc.items.map((item) => item.photoId).filter((id): id is string => !!id);
  return doc.logoId ? [doc.logoId, ...ids] : ids;
}
