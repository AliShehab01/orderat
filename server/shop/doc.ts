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
const MAX_IBAN_NAME_CHARS = 70;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
/** A photoId/logoId is always a SHA-256 hex digest (server/shop/photos.ts). */
const PHOTO_ID_RE = /^[0-9a-f]{64}$/;
/** ISO 13616 shape: 2-letter country code + 2 check digits + 11-30 alphanumeric BBAN characters
 * (15-34 total). Checked against an already-normalized (normalizeIban) string. */
const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

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
  /** The seller tracks this product's stock and it is at 0 or below (the phones send it; never the
   * quantity itself). Optional in a publish body, stored as a boolean (default false). */
  soldOut?: boolean;
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
  /** Already normalized (uppercase, no spaces/dashes) and checksum-validated by validateShopDoc (see
   * normalizeIban/isValidIban) — callers never need to normalize or re-validate it. The legacy
   * single-IBAN field: server/shop/payment-methods.ts turns it into a bank_transfer method when a
   * publish sends no `paymentMethods`. (The legacy `ibanName` is still accepted, then dropped: a bank
   * transfer has no account-holder name.) */
  iban?: string;
  items: ShopItemRequest[];
}

export interface ShopItemPublic {
  id: string;
  name: Bilingual;
  description?: string;
  priceMinor: number;
  photoUrl?: string;
  available: boolean;
  /** Shown with a "Sold out" badge and cannot be ordered. Missing on documents stored before
   * 1 Oct 2026, which the public GET serves as false; resolveShopDoc always sets it. */
  soldOut?: boolean;
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
  /** The bank_transfer method's IBAN, kept for shop pages cached before paymentMethods existed. */
  iban?: string;
  /** Only ever present on documents stored before 30 Sep 2026; never served (handler strips it). */
  ibanName?: string;
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

/** Strips spaces and dashes and uppercases, so "bh67 bmag 0000 1299 1234 56" and
 * "BH67BMAG00001299123456" normalize to the same value before validation and storage. */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * ISO 13616: the country-code/check-digit/BBAN shape (`IBAN_RE`, 15-34 characters) plus the mod-97
 * checksum — move the first 4 characters to the end, replace each letter with its position after 9
 * (A=10 .. Z=35), and reduce the result mod 97 one digit (or one two-digit letter value) at a time so
 * the running remainder never needs more than a few digits (no BigInt). A valid IBAN's checksum
 * reduces to exactly 1. Expects an already normalized (normalizeIban) string.
 */
export function isValidIban(iban: string): boolean {
  if (!IBAN_RE.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 65 + 10;
    remainder = value >= 10 ? (remainder * 100 + value) % 97 : (remainder * 10 + value) % 97;
  }
  return remainder === 1;
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
  if (o.soldOut !== undefined && typeof o.soldOut !== "boolean") return undefined;
  return {
    id: o.id, name: o.name, description: o.description as string | undefined, priceMinor: o.priceMinor,
    photoId: o.photoId as string | undefined, available: o.available, soldOut: o.soldOut === true,
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

  // Both `iban` and `ibanName` are independent, optional fields (docs/marketing-tools.md's "Public
  // shop document"). `iban` is normalized first (see normalizeIban) so "bh67 bmag ..." and
  // "BH67BMAG..." both validate and are stored the same way; an invalid or empty-string IBAN fails
  // the whole document, same as every other malformed field here.
  let iban: string | undefined;
  if (o.iban !== undefined) {
    if (typeof o.iban !== "string") return undefined;
    iban = normalizeIban(o.iban);
    if (!isValidIban(iban)) return undefined;
  }
  if (!isOptionalString(o.ibanName, MAX_IBAN_NAME_CHARS)) return undefined;

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
    logoId: o.logoId as string | undefined, iban, items,
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
    iban: doc.iban,
    items: doc.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      priceMinor: item.priceMinor,
      photoUrl: item.photoId ? photoUrls.get(item.photoId) : undefined,
      available: item.available,
      soldOut: item.soldOut === true,
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
