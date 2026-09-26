import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64, sniffImageMimeType } from "./image";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
]);

describe("sniffImageMimeType", () => {
  it("recognizes JPEG by its magic number", () => {
    expect(sniffImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
  });

  it("recognizes PNG by its magic number", () => {
    expect(sniffImageMimeType(PNG_BYTES)).toBe("image/png");
  });

  it("recognizes WebP by its RIFF/WEBP markers", () => {
    expect(sniffImageMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("returns undefined for unrecognized bytes", () => {
    expect(sniffImageMimeType(new Uint8Array([1, 2, 3, 4, 5]))).toBeUndefined();
  });

  it("returns undefined for a too-short input", () => {
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
  });

  it("returns undefined for a RIFF file that isn't WEBP (e.g. WAV)", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageMimeType(wav)).toBeUndefined();
  });

  it("does not trust a JPEG-like prefix embedded later in the buffer", () => {
    expect(sniffImageMimeType(new Uint8Array([0, 0xff, 0xd8, 0xff]))).toBeUndefined();
  });
});

describe("decodeBase64 / encodeBase64", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const decoded = decodeBase64(encodeBase64(original));
    expect(decoded).toEqual(original);
  });

  it("decodes a known base64 string", () => {
    expect(decodeBase64("aGVsbG8=")).toEqual(new TextEncoder().encode("hello"));
  });

  it("rejects a string with invalid base64 characters", () => {
    expect(decodeBase64("not!!valid$$base64")).toBeUndefined();
  });

  it("rejects a string with the wrong length (not a multiple of 4)", () => {
    expect(decodeBase64("abcde")).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(decodeBase64("")).toBeUndefined();
  });

  it("ignores surrounding whitespace/newlines", () => {
    expect(decodeBase64("  aGVsbG8=  \n")).toEqual(new TextEncoder().encode("hello"));
  });
});
