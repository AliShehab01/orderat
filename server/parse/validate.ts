// Request body validation for orderat-parse (docs/sme-phase-2-cloud.md's "AI order entry"). Same
// philosophy as server/studio/validate.ts: deliberately strict and type-only — this never calls
// Gemini or matches a product itself; server/parse/handler.ts does that, via
// server/ai/gemini.ts's createGeminiExtractor.

/** Generous for the largest legitimate body (a screenshot: up to 2 MB decoded, so up to ~2.7 MB
 * base64-encoded) plus a shop's product list — same reasoning and same figure as
 * server/studio/validate.ts's own MAX_BODY_BYTES for its "photo" task. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_INSTALL_ID_CHARS = 200;
const MAX_APP_VERSION_CHARS = 32;
/** A pasted WhatsApp message is normally a few hundred characters; generous headroom for a long one. */
const MAX_TEXT_CHARS = 4000;
const MAX_PRODUCTS = 500;
const MAX_PRODUCT_ID_CHARS = 64;
const MAX_PRODUCT_NAME_CHARS = 200;
const MAX_ALIASES_PER_PRODUCT = 20;
const MAX_ALIAS_CHARS = 100;

export type ParsePlatform = "ios" | "android";
export type ParseLang = "ar" | "en";
export type AddressAs = "male" | "female";

export interface ParseProduct {
  id: string;
  name: string;
  nameAr?: string;
  aliases: string[];
}

export interface ParseImage {
  /** docs/sme-phase-2-cloud.md: "one screenshot image (JPEG/PNG, at most 2 MB)" — no WebP, unlike the
   * marketing tools' photo inputs, since a phone screenshot is always one of these two. */
  mimeType: "image/jpeg" | "image/png";
  data: string;
}

export interface ParseRequestBody {
  installId: string;
  platform: ParsePlatform;
  appVersion: string;
  demo: boolean;
  /** Accepted per docs/sme-phase-2-cloud.md's input list ("lang/addressAs") but not itself fed to
   * server/ai/gemini.ts's extractor, which detects the message's language on its own — see
   * server/parse/handler.ts's header for why these two are validated-and-logged rather than acted on. */
  lang?: ParseLang;
  addressAs?: AddressAs;
  text?: string;
  image?: ParseImage;
  products: ParseProduct[];
}

export type ParseValidationResult = { ok: true; body: ParseRequestBody } | { ok: false; error: "invalid_body" | "too_large" };

function invalid(): ParseValidationResult {
  return { ok: false, error: "invalid_body" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

function parseProducts(value: unknown): ParseProduct[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PRODUCTS) return undefined;
  const products: ParseProduct[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) return undefined;
    if (!isNonEmptyString(raw.id, MAX_PRODUCT_ID_CHARS)) return undefined;
    if (!isNonEmptyString(raw.name, MAX_PRODUCT_NAME_CHARS)) return undefined;
    if (raw.nameAr !== undefined && !isNonEmptyString(raw.nameAr, MAX_PRODUCT_NAME_CHARS)) return undefined;
    let aliases: string[] = [];
    if (raw.aliases !== undefined) {
      if (!Array.isArray(raw.aliases) || raw.aliases.length > MAX_ALIASES_PER_PRODUCT) return undefined;
      if (!raw.aliases.every((a) => isNonEmptyString(a, MAX_ALIAS_CHARS))) return undefined;
      aliases = raw.aliases;
    }
    products.push({ id: raw.id, name: raw.name, nameAr: raw.nameAr as string | undefined, aliases });
  }
  return products;
}

function parseImage(value: unknown): ParseImage | undefined | null {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return null;
  const { mimeType, data } = value;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") return null;
  if (typeof data !== "string" || data.length === 0) return null;
  return { mimeType, data };
}

/** Validates a raw request body (the request's text, not yet parsed) against
 * docs/sme-phase-2-cloud.md's AI-order-entry shape: at least one of `text`/`image`, the shop's
 * product list, and the common install/platform fields every AI feature in this codebase validates
 * (server/ask/validate.ts, server/studio/validate.ts). */
export function validateParseBody(raw: string): ParseValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { ok: false, error: "too_large" };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  if (!isNonEmptyString(json.installId, MAX_INSTALL_ID_CHARS)) return invalid();
  if (json.platform !== "ios" && json.platform !== "android") return invalid();
  if (!isNonEmptyString(json.appVersion, MAX_APP_VERSION_CHARS)) return invalid();
  if (json.demo !== undefined && typeof json.demo !== "boolean") return invalid();
  if (json.lang !== undefined && json.lang !== "ar" && json.lang !== "en") return invalid();
  if (json.addressAs !== undefined && json.addressAs !== "male" && json.addressAs !== "female") return invalid();
  if (json.text !== undefined && !isNonEmptyString(json.text, MAX_TEXT_CHARS)) return invalid();

  const image = parseImage(json.image);
  if (image === null) return invalid();

  if (json.text === undefined && image === undefined) return invalid(); // At least one of text/image.

  const products = parseProducts(json.products ?? []);
  if (!products) return invalid();

  return {
    ok: true,
    body: {
      installId: json.installId,
      platform: json.platform,
      appVersion: json.appVersion,
      demo: json.demo === true,
      lang: json.lang as ParseLang | undefined,
      addressAs: json.addressAs as AddressAs | undefined,
      text: json.text as string | undefined,
      image,
      products,
    },
  };
}

export { MAX_BODY_BYTES };
