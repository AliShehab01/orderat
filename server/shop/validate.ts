// Request body validation for orderat-shop (docs/marketing-tools.md's "C. Shop link" > "Endpoints").
// Same philosophy as server/ask/validate.ts: deliberately strict and type-only — this never decides
// whether a slug is taken, a token matches, or a photo/price is real; server/shop/handler.ts does
// that, with the database and the stored shop doc in hand. `shop` (the publish document) and each
// `photos[]` entry are only shape-checked here as "an object" / "an array of objects" — their own
// deeper rules live in server/shop/doc.ts and server/shop/photos.ts, called from the handler once it
// knows which action this is.

import { isValidDateString } from "../campaigns/content.ts";
import { isAcceptableSlug } from "./slug.ts";

/** docs/marketing-tools.md: "Body at most 6 MB" (publish, the largest legitimate body here — a few
 * photos' worth of base64). Every other action is tiny by comparison and bounded by its own
 * per-field limits below, not by this cap. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const MAX_SLUG_CHARS = 64; // Generous upper bound for slug_check; the real format check is slug.ts's.
const MAX_TOKEN_CHARS = 200;
const MAX_INSTALL_ID_CHARS = 200;
const MAX_NAME_CHARS = 60;
const MAX_NOTES_CHARS = 300;
const MAX_ADDRESS_CHARS = 200;
const MAX_ID_CHARS = 64;
const MAX_ORDER_ITEMS = 30;
const MAX_ACK_IDS = 100;

export type Fulfillment = "pickup" | "delivery";

export interface SlugCheckBody {
  action: "slug_check";
  slug: string;
}

export interface PublishBody {
  action: "publish";
  installId: string;
  token?: string;
  slug: string;
  /** Deeper shape rules: server/shop/doc.ts's validateShopDoc. */
  shop: Record<string, unknown>;
  /** Deeper shape rules, per entry: server/shop/photos.ts's validatePhotoUpload. */
  photos: Record<string, unknown>[];
}

export interface UnpublishBody { action: "unpublish"; token: string; }
export interface StatsBody { action: "stats"; token: string; }
export interface InboxBody { action: "inbox"; token: string; }

export interface AckBody {
  action: "ack";
  token: string;
  orderIds: string[];
}

export interface OrderItemRequest {
  id: string;
  qty: number;
}

export interface OrderBody {
  action: "order";
  slug: string;
  customer: { name: string; phone: string };
  items: OrderItemRequest[];
  pickupDate: string;
  pickupTime?: string;
  fulfillment?: Fulfillment;
  address?: string;
  notes?: string;
  /** The payment method type the customer picked; server/shop/payment-methods.ts keeps it only when it
   * is one of the shop's configured types. Anything that is not a short string is simply dropped. */
  paymentMethod?: string;
}

export type ShopRequestBody = SlugCheckBody | PublishBody | UnpublishBody | StatsBody | OrderBody | InboxBody | AckBody;

export type ShopValidationResult = { ok: true; body: ShopRequestBody } | { ok: false; error: "invalid_body" | "too_large" };

function invalid(): ShopValidationResult {
  return { ok: false, error: "invalid_body" };
}

function tooLarge(): ShopValidationResult {
  return { ok: false, error: "too_large" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

function validateSlugCheck(json: Record<string, unknown>): ShopValidationResult {
  if (!isNonEmptyString(json.slug, MAX_SLUG_CHARS)) return invalid();
  return { ok: true, body: { action: "slug_check", slug: json.slug } };
}

function validatePublish(json: Record<string, unknown>): ShopValidationResult {
  if (!isNonEmptyString(json.installId, MAX_INSTALL_ID_CHARS)) return invalid();
  if (json.token !== undefined && !isNonEmptyString(json.token, MAX_TOKEN_CHARS)) return invalid();
  if (!isAcceptableSlug(json.slug)) return invalid();
  if (!isPlainObject(json.shop)) return invalid();
  if (!Array.isArray(json.photos) || !json.photos.every(isPlainObject)) return invalid();

  return {
    ok: true,
    body: {
      action: "publish",
      installId: json.installId,
      token: json.token as string | undefined,
      slug: json.slug,
      shop: json.shop,
      photos: json.photos as Record<string, unknown>[],
    },
  };
}

function validateTokenOnly<A extends "unpublish" | "stats" | "inbox">(action: A, json: Record<string, unknown>): ShopValidationResult {
  if (!isNonEmptyString(json.token, MAX_TOKEN_CHARS)) return invalid();
  return { ok: true, body: { action, token: json.token } };
}

function validateAck(json: Record<string, unknown>): ShopValidationResult {
  if (!isNonEmptyString(json.token, MAX_TOKEN_CHARS)) return invalid();
  if (!Array.isArray(json.orderIds) || json.orderIds.length === 0 || json.orderIds.length > MAX_ACK_IDS) return invalid();
  if (!json.orderIds.every((id) => isNonEmptyString(id, MAX_ID_CHARS))) return invalid();
  return { ok: true, body: { action: "ack", token: json.token, orderIds: json.orderIds as string[] } };
}

function isOrderItem(value: unknown): value is OrderItemRequest {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id, MAX_ID_CHARS)) return false;
  return typeof value.qty === "number" && Number.isInteger(value.qty) && value.qty >= 1 && value.qty <= 99;
}

function validateOrder(json: Record<string, unknown>): ShopValidationResult {
  if (!isNonEmptyString(json.slug, MAX_SLUG_CHARS)) return invalid();

  const customer = json.customer;
  if (!isPlainObject(customer)) return invalid();
  if (!isNonEmptyString(customer.name, MAX_NAME_CHARS)) return invalid();
  if (!(typeof customer.phone === "string" && /^\+?\d{8,15}$/.test(customer.phone))) return invalid();

  if (!Array.isArray(json.items) || json.items.length === 0 || json.items.length > MAX_ORDER_ITEMS) return invalid();
  if (!json.items.every(isOrderItem)) return invalid();

  if (!isValidDateString(json.pickupDate)) return invalid();
  if (json.pickupTime !== undefined && !(typeof json.pickupTime === "string" && /^\d{2}:\d{2}$/.test(json.pickupTime))) return invalid();
  if (json.fulfillment !== undefined && json.fulfillment !== "pickup" && json.fulfillment !== "delivery") return invalid();
  if (json.address !== undefined) {
    // docs/marketing-tools.md: "address ... only when fulfillment is delivery".
    if (!isNonEmptyString(json.address, MAX_ADDRESS_CHARS) || json.fulfillment !== "delivery") return invalid();
  }
  if (json.notes !== undefined && !isNonEmptyString(json.notes, MAX_NOTES_CHARS)) return invalid();

  return {
    ok: true,
    body: {
      action: "order",
      slug: json.slug,
      customer: { name: customer.name, phone: customer.phone },
      items: json.items as OrderItemRequest[],
      pickupDate: json.pickupDate,
      pickupTime: json.pickupTime as string | undefined,
      fulfillment: json.fulfillment as Fulfillment | undefined,
      address: json.address as string | undefined,
      notes: json.notes as string | undefined,
      ...(typeof json.paymentMethod === "string" && json.paymentMethod.length <= 30 ? { paymentMethod: json.paymentMethod } : {}),
    },
  };
}

/** Validates a raw request body (the request's text, not yet parsed) and dispatches by `action` to
 * docs/marketing-tools.md's per-action shape. `GET ?slug=` (the public read) has no body at all and
 * is validated separately, directly in server/shop/handler.ts from the URL. */
export function validateShopBody(raw: string): ShopValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  switch (json.action) {
    case "slug_check": return validateSlugCheck(json);
    case "publish": return validatePublish(json);
    case "unpublish": return validateTokenOnly("unpublish", json);
    case "stats": return validateTokenOnly("stats", json);
    case "inbox": return validateTokenOnly("inbox", json);
    case "ack": return validateAck(json);
    case "order": return validateOrder(json);
    default: return invalid();
  }
}

export { MAX_BODY_BYTES };
