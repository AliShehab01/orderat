// Validation for one photo in a publish request's `photos` array (docs/marketing-tools.md's
// "C. Shop link" > "Publish rules"): magic-number-sniffed against the declared mimeType, size-capped
// at 400 KB, and its claimed `photoId` verified to actually be the SHA-256 hex of the bytes — so a
// shop's photo store is genuinely content-addressed (server/shop/handler.ts trusts photoId as a
// dedupe key precisely because this has already been checked).

import { decodeBase64, sniffImageMimeType, type ImageMimeType } from "../shared/image.ts";
import { sha256Hex } from "../shared/crypto.ts";

/** docs/marketing-tools.md: "each photo at most 400 KB". */
export const MAX_SHOP_PHOTO_BYTES = 400 * 1024;

const PHOTO_ID_RE = /^[0-9a-f]{64}$/;

export function isPhotoIdFormat(value: unknown): value is string {
  return typeof value === "string" && PHOTO_ID_RE.test(value);
}

export interface PhotoUploadRequest {
  photoId: string;
  mimeType: string;
  data: string;
}

export interface ValidatedPhoto {
  photoId: string;
  mimeType: ImageMimeType;
  bytes: Uint8Array;
}

export type PhotoValidationResult =
  | { ok: true; photo: ValidatedPhoto }
  | { ok: false; error: "invalid_body" | "too_large" };

/**
 * Validates one `photos[]` entry end to end: shape, base64, size, magic number vs. declared
 * mimeType, and the photoId == sha256(bytes) invariant. `too_large` only for a genuinely oversized
 * photo; every other problem (bad shape, wrong mimeType, a hash that doesn't match) is `invalid_body`
 * — docs/marketing-tools.md's error table has no separate code for "the hash didn't match".
 */
export async function validatePhotoUpload(raw: unknown): Promise<PhotoValidationResult> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const { photoId, mimeType, data } = raw as Record<string, unknown>;

  if (!isPhotoIdFormat(photoId)) return { ok: false, error: "invalid_body" };
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") return { ok: false, error: "invalid_body" };
  if (typeof data !== "string" || data.length === 0) return { ok: false, error: "invalid_body" };

  const bytes = decodeBase64(data);
  if (!bytes) return { ok: false, error: "invalid_body" };
  if (bytes.length > MAX_SHOP_PHOTO_BYTES) return { ok: false, error: "too_large" };

  const sniffed = sniffImageMimeType(bytes);
  if (!sniffed || sniffed !== mimeType) return { ok: false, error: "invalid_body" };

  const hash = await sha256Hex(bytes);
  if (hash !== photoId) return { ok: false, error: "invalid_body" };

  return { ok: true, photo: { photoId, mimeType: sniffed, bytes } };
}
