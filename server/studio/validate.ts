// Request body validation for orderat-studio (docs/marketing-tools.md, tasks "caption" and "photo").
// Same philosophy as server/ask/validate.ts: deliberately strict and type-only, bounding size/shape
// so a malformed or hostile body never reaches Gemini or the rate limiter — it never re-derives
// business data. `campaignId` and `styleId` are only shape-checked here (non-empty strings); looking
// them up in the loaded content and deciding what "unknown" means is server/studio/handler.ts's job,
// per docs/marketing-tools.md ("campaignId optional (unknown ids are ignored)").

/** Generous enough for the largest legitimate body (a photo request: a base64-encoded image up to
 * 2 MB decoded, so up to ~2.7 MB encoded, plus JSON overhead) — a caption request is tiny by
 * comparison and is bounded instead by its own per-field limits below, not by this cap. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const MAX_INSTALL_ID_CHARS = 200;
const MAX_APP_VERSION_CHARS = 32;
const MAX_SHOP_NAME_CHARS = 60;
const MAX_ITEM_NAME_CHARS = 80;
const MAX_NOTE_CHARS = 200;
const MAX_LINK_CHARS = 300;
const MAX_CAMPAIGN_ID_CHARS = 100;
const MAX_STYLE_ID_CHARS = 100;
const MIN_ITEMS = 1;
const MAX_ITEMS = 5;

export type Platform = "ios" | "android";
export type StudioLang = "ar" | "en";
export type Channel = "instagram" | "whatsapp_status" | "tiktok";
export type Aspect = "1:1" | "4:5" | "9:16";

export interface CaptionItem {
  name: string;
  priceMinor: number;
}

export interface CaptionRequestBody {
  task: "caption";
  installId: string;
  platform: Platform;
  appVersion: string;
  demo: boolean;
  lang: StudioLang;
  channel: Channel;
  /** Shape-checked only; server/studio/handler.ts looks it up and ignores an unknown id. */
  campaignId?: string;
  shopName: string;
  currency: string;
  items: CaptionItem[];
  note?: string;
  link?: string;
}

export interface PhotoRequestBody {
  task: "photo";
  installId: string;
  platform: Platform;
  appVersion: string;
  demo: boolean;
  /** Shape-checked only; server/studio/handler.ts looks it up and 400s on an unknown id. */
  styleId: string;
  aspect: Aspect;
  image: { mimeType: string; data: string };
}

export type StudioRequestBody = CaptionRequestBody | PhotoRequestBody;

export type StudioValidationResult =
  | { ok: true; body: StudioRequestBody }
  | { ok: false; error: "invalid_body" | "too_large" };

function invalid(): StudioValidationResult {
  return { ok: false, error: "invalid_body" };
}

function tooLarge(): StudioValidationResult {
  return { ok: false, error: "too_large" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function commonFieldsOk(json: Record<string, unknown>): boolean {
  if (!isNonEmptyString(json.installId, MAX_INSTALL_ID_CHARS)) return false;
  if (json.platform !== "ios" && json.platform !== "android") return false;
  if (!isNonEmptyString(json.appVersion, MAX_APP_VERSION_CHARS)) return false;
  if (json.demo !== undefined && typeof json.demo !== "boolean") return false;
  return true;
}

function parseCaptionItems(value: unknown): CaptionItem[] | undefined {
  if (!Array.isArray(value) || value.length < MIN_ITEMS || value.length > MAX_ITEMS) return undefined;
  const items: CaptionItem[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) return undefined;
    if (!isNonEmptyString(raw.name, MAX_ITEM_NAME_CHARS)) return undefined;
    if (!isNonNegativeInteger(raw.priceMinor)) return undefined;
    items.push({ name: raw.name, priceMinor: raw.priceMinor });
  }
  return items;
}

function validateCaptionBody(json: Record<string, unknown>): StudioValidationResult {
  if (!commonFieldsOk(json)) return invalid();
  if (json.lang !== "ar" && json.lang !== "en") return invalid();
  if (json.channel !== "instagram" && json.channel !== "whatsapp_status" && json.channel !== "tiktok") return invalid();
  if (json.campaignId !== undefined && !isNonEmptyString(json.campaignId, MAX_CAMPAIGN_ID_CHARS)) return invalid();
  if (!isNonEmptyString(json.shopName, MAX_SHOP_NAME_CHARS)) return invalid();
  if (!(typeof json.currency === "string" && /^[A-Z]{3}$/.test(json.currency))) return invalid();
  const items = parseCaptionItems(json.items);
  if (!items) return invalid();
  if (json.note !== undefined && !isNonEmptyString(json.note, MAX_NOTE_CHARS)) return invalid();
  if (json.link !== undefined && !(isNonEmptyString(json.link, MAX_LINK_CHARS) && /^https?:\/\//.test(json.link))) return invalid();

  return {
    ok: true,
    body: {
      task: "caption",
      installId: json.installId as string,
      platform: json.platform as Platform,
      appVersion: json.appVersion as string,
      demo: json.demo === true,
      lang: json.lang,
      channel: json.channel,
      campaignId: json.campaignId as string | undefined,
      shopName: json.shopName,
      currency: json.currency,
      items,
      note: json.note as string | undefined,
      link: json.link as string | undefined,
    },
  };
}

function validatePhotoBody(json: Record<string, unknown>): StudioValidationResult {
  if (!commonFieldsOk(json)) return invalid();
  if (!isNonEmptyString(json.styleId, MAX_STYLE_ID_CHARS)) return invalid();
  if (json.aspect !== "1:1" && json.aspect !== "4:5" && json.aspect !== "9:16") return invalid();
  if (!isPlainObject(json.image)) return invalid();
  const { mimeType, data } = json.image;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") return invalid();
  if (typeof data !== "string" || data.length === 0) return invalid();

  return {
    ok: true,
    body: {
      task: "photo",
      installId: json.installId as string,
      platform: json.platform as Platform,
      appVersion: json.appVersion as string,
      demo: json.demo === true,
      styleId: json.styleId,
      aspect: json.aspect,
      image: { mimeType, data },
    },
  };
}

/** Validates a raw request body (the request's text, not yet parsed) against
 * docs/marketing-tools.md's two task shapes. Returns the parsed, narrowed, discriminated-by-`task`
 * body on success so callers never need to re-check what this already checked. */
export function validateStudioBody(raw: string): StudioValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isPlainObject(json)) return invalid();

  if (json.task === "caption") return validateCaptionBody(json);
  if (json.task === "photo") return validatePhotoBody(json);
  return invalid();
}

export { MAX_BODY_BYTES };
