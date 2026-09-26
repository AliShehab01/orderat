// Image byte sniffing + base64 (de)coding shared by orderat-studio (the AI photo task's product
// photo) and orderat-shop (a shop's published photos): both accept only JPEG/PNG/WebP, and both
// trust the declared mimeType only after confirming it against the bytes' own magic number — a
// caller could otherwise send arbitrary bytes labelled "image/jpeg" straight into a Gemini call or a
// public storage bucket. Per-feature size caps (2 MB for a studio photo, 400 KB for a shop photo)
// stay in each feature's own validate.ts — this file only knows about bytes, not policy.

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

/**
 * Sniffs JPEG/PNG/WebP from the bytes themselves, never from a caller-supplied mimeType. WebP is a
 * RIFF container, so it needs both the "RIFF" magic at byte 0 and the "WEBP" tag at byte 8 (not just
 * one fixed prefix, unlike the other two). Anything else — including a truncated or corrupt file, or
 * a format we don't support (GIF, HEIC, ...) — returns undefined.
 */
export function sniffImageMimeType(bytes: Uint8Array): ImageMimeType | undefined {
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) return "image/webp";
  return undefined;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes a base64 string to bytes, or undefined for anything that isn't valid, correctly-padded
 * base64 — callers treat that the same as any other malformed body (400 `invalid_body`), never a
 * thrown exception. `Buffer.from(..., "base64")` (Node) is lenient about invalid characters, so the
 * shape is checked explicitly first rather than trusting it to throw.
 */
export function decodeBase64(data: string): Uint8Array | undefined {
  const cleaned = data.replace(/\s+/g, "");
  if (!cleaned || cleaned.length % 4 !== 0 || !BASE64_RE.test(cleaned)) return undefined;
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(cleaned, "base64"));
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/** The inverse of decodeBase64 — used to hand a Gemini-returned image, or a photo already on
 * Storage, back to the app as JSON. Chunked (like server/ai/gemini.ts's own toBase64) so a large
 * image never blows `String.fromCharCode`'s argument-count limit via the spread form. */
export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
