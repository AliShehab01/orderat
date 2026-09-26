import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, validateParseBody } from "./validate.ts";

function baseBody(overrides: Record<string, unknown> = {}) {
  return { installId: "install-1", platform: "ios", appVersion: "1.0.0", text: "2 cakes for tomorrow", products: [], ...overrides };
}

describe("validateParseBody", () => {
  it("accepts a minimal text-only body", () => {
    const result = validateParseBody(JSON.stringify(baseBody()));
    expect(result).toEqual({
      ok: true,
      body: { installId: "install-1", platform: "ios", appVersion: "1.0.0", demo: false, lang: undefined, addressAs: undefined, text: "2 cakes for tomorrow", image: undefined, products: [] },
    });
  });

  it("accepts an image-only body (no text)", () => {
    const result = validateParseBody(JSON.stringify(baseBody({ text: undefined, image: { mimeType: "image/png", data: "abc" } })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.image).toEqual({ mimeType: "image/png", data: "abc" });
  });

  it("rejects a body with neither text nor image", () => {
    expect(validateParseBody(JSON.stringify(baseBody({ text: undefined })))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts lang and addressAs when given", () => {
    const result = validateParseBody(JSON.stringify(baseBody({ lang: "ar", addressAs: "female" })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toMatchObject({ lang: "ar", addressAs: "female" });
  });

  it("rejects an invalid lang or addressAs", () => {
    expect(validateParseBody(JSON.stringify(baseBody({ lang: "fr" })))).toEqual({ ok: false, error: "invalid_body" });
    expect(validateParseBody(JSON.stringify(baseBody({ addressAs: "other" })))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unsupported image mimeType (webp isn't a screenshot format)", () => {
    expect(validateParseBody(JSON.stringify(baseBody({ image: { mimeType: "image/webp", data: "abc" } })))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts a full product list shape, defaulting aliases to an empty array", () => {
    const products = [{ id: "p1", name: "Cake", nameAr: "كيكة", aliases: ["كيك"] }, { id: "p2", name: "Cookie" }];
    const result = validateParseBody(JSON.stringify(baseBody({ products })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.products).toEqual([{ id: "p1", name: "Cake", nameAr: "كيكة", aliases: ["كيك"] }, { id: "p2", name: "Cookie", nameAr: undefined, aliases: [] }]);
  });

  it("rejects a product missing an id or name", () => {
    expect(validateParseBody(JSON.stringify(baseBody({ products: [{ name: "Cake" }] })))).toEqual({ ok: false, error: "invalid_body" });
    expect(validateParseBody(JSON.stringify(baseBody({ products: [{ id: "p1" }] })))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects platform values outside ios/android", () => {
    expect(validateParseBody(JSON.stringify(baseBody({ platform: "web" })))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("defaults demo to false and accepts demo: true", () => {
    const withoutDemo = validateParseBody(JSON.stringify(baseBody()));
    expect(withoutDemo.ok && withoutDemo.body.demo).toBe(false);
    const withDemo = validateParseBody(JSON.stringify(baseBody({ demo: true })));
    expect(withDemo.ok && withDemo.body.demo).toBe(true);
  });

  it("rejects malformed JSON and non-object bodies", () => {
    expect(validateParseBody("{not json")).toEqual({ ok: false, error: "invalid_body" });
    expect(validateParseBody("[1,2,3]")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a body over the size cap with too_large", () => {
    const body = JSON.stringify(baseBody({ text: "a".repeat(MAX_BODY_BYTES) }));
    expect(validateParseBody(body)).toEqual({ ok: false, error: "too_large" });
  });
});
