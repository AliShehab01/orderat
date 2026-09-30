import { describe, expect, it } from "vitest";
import { photoObjectPath } from "./storage-path.ts";

describe("photoObjectPath", () => {
  it("builds <bucket>/<shopId>/<photoId>.jpg for well-formed ids", () => {
    const shopId = "0f8c2a1e-3b4d-4c5e-8f90-123456789abc";
    const photoId = "a".repeat(64);
    expect(photoObjectPath("orderat-photos", shopId, photoId)).toBe(`orderat-photos/${shopId}/${photoId}.jpg`);
  });

  it("percent-encodes separators so an id can never add or climb a path segment", () => {
    const path = photoObjectPath("orderat-photos", "shop", "../other-bucket/x?y=1");
    expect(path).toBe("orderat-photos/shop/..%2Fother-bucket%2Fx%3Fy%3D1.jpg");
    expect(path.split("/")).toHaveLength(3);
  });
});
