import { describe, expect, it } from "vitest";
import { sha256Hex } from "../shared/crypto";
import { isPhotoIdFormat, MAX_SHOP_PHOTO_BYTES, validatePhotoUpload } from "./photos";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function jpegUpload(overrides: Record<string, unknown> = {}) {
  const photoId = await sha256Hex(JPEG_BYTES);
  return { photoId, mimeType: "image/jpeg", data: Buffer.from(JPEG_BYTES).toString("base64"), ...overrides };
}

describe("isPhotoIdFormat", () => {
  it("accepts a 64-hex-char string", () => {
    expect(isPhotoIdFormat("a".repeat(64))).toBe(true);
  });

  it("rejects a wrong-length or non-hex string", () => {
    expect(isPhotoIdFormat("a".repeat(63))).toBe(false);
    expect(isPhotoIdFormat("g".repeat(64))).toBe(false);
    expect(isPhotoIdFormat(123)).toBe(false);
  });
});

describe("validatePhotoUpload", () => {
  it("accepts a valid JPEG whose photoId matches its own hash", async () => {
    const result = await validatePhotoUpload(await jpegUpload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.photo.mimeType).toBe("image/jpeg");
      expect(result.photo.bytes).toEqual(JPEG_BYTES);
    }
  });

  it("rejects a photoId that doesn't match the sha256 of the bytes", async () => {
    const result = await validatePhotoUpload(await jpegUpload({ photoId: "b".repeat(64) }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a declared mimeType that doesn't match the bytes' magic number", async () => {
    const result = await validatePhotoUpload(await jpegUpload({ mimeType: "image/png" }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unsupported mimeType", async () => {
    const result = await validatePhotoUpload(await jpegUpload({ mimeType: "image/gif" }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a malformed photoId shape", async () => {
    const result = await validatePhotoUpload(await jpegUpload({ photoId: "not-a-hash" }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects invalid base64 data", async () => {
    const result = await validatePhotoUpload(await jpegUpload({ data: "not base64 at all!!" }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a photo over 400 KB with too_large", async () => {
    const big = new Uint8Array(MAX_SHOP_PHOTO_BYTES + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const photoId = await sha256Hex(big);
    const result = await validatePhotoUpload({ photoId, mimeType: "image/jpeg", data: Buffer.from(big).toString("base64") });
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("accepts a photo of exactly 400 KB", async () => {
    const exact = new Uint8Array(MAX_SHOP_PHOTO_BYTES);
    exact[0] = 0xff; exact[1] = 0xd8; exact[2] = 0xff;
    const photoId = await sha256Hex(exact);
    const result = await validatePhotoUpload({ photoId, mimeType: "image/jpeg", data: Buffer.from(exact).toString("base64") });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object input", async () => {
    expect(await validatePhotoUpload("nope")).toEqual({ ok: false, error: "invalid_body" });
    expect(await validatePhotoUpload(null)).toEqual({ ok: false, error: "invalid_body" });
  });
});
