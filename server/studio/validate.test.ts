import { describe, expect, it } from "vitest";
import { validateStudioBody } from "./validate";

function validCaption(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    task: "caption",
    installId: "install-1",
    platform: "ios",
    appVersion: "1.1.0",
    demo: false,
    lang: "ar",
    channel: "instagram",
    campaignId: "teachers-day-2026",
    shopName: "Sweet Studio",
    currency: "BHD",
    items: [{ name: "Cheesecake cups", priceMinor: 4500 }],
    note: "توصيل مجاني في الرفاع",
    link: "https://alishehab01.github.io/orderat/s/?sweetstudio",
    ...overrides,
  });
}

function validPhoto(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    task: "photo",
    installId: "install-1",
    platform: "android",
    appVersion: "1.1.0",
    demo: false,
    styleId: "marble",
    aspect: "1:1",
    image: { mimeType: "image/jpeg", data: "AQID" },
    ...overrides,
  });
}

describe("validateStudioBody / caption", () => {
  it("accepts a valid caption body", () => {
    const result = validateStudioBody(validCaption());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.task).toBe("caption");
      expect(result.body).toMatchObject({ shopName: "Sweet Studio", currency: "BHD" });
    }
  });

  it("defaults demo to false when omitted", () => {
    const body = JSON.parse(validCaption());
    delete body.demo;
    const result = validateStudioBody(JSON.stringify(body));
    expect(result.ok && result.body.demo).toBe(false);
  });

  it("allows campaignId, note and link to be omitted", () => {
    const body = JSON.parse(validCaption());
    delete body.campaignId;
    delete body.note;
    delete body.link;
    expect(validateStudioBody(JSON.stringify(body)).ok).toBe(true);
  });

  it.each(["ar", "en"])("accepts lang=%s", (lang) => {
    expect(validateStudioBody(validCaption({ lang })).ok).toBe(true);
  });

  it("rejects an unknown lang", () => {
    expect(validateStudioBody(validCaption({ lang: "fr" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it.each(["instagram", "whatsapp_status", "tiktok"])("accepts channel=%s", (channel) => {
    expect(validateStudioBody(validCaption({ channel })).ok).toBe(true);
  });

  it("rejects an unknown channel", () => {
    expect(validateStudioBody(validCaption({ channel: "facebook" })).ok).toBe(false);
  });

  it("rejects an empty items array", () => {
    expect(validateStudioBody(validCaption({ items: [] })).ok).toBe(false);
  });

  it("rejects more than 5 items", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ name: `Item ${i}`, priceMinor: 100 }));
    expect(validateStudioBody(validCaption({ items })).ok).toBe(false);
  });

  it("accepts exactly 5 items", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}`, priceMinor: 100 }));
    expect(validateStudioBody(validCaption({ items })).ok).toBe(true);
  });

  it("rejects a negative priceMinor", () => {
    expect(validateStudioBody(validCaption({ items: [{ name: "x", priceMinor: -1 }] })).ok).toBe(false);
  });

  it("rejects a non-integer priceMinor", () => {
    expect(validateStudioBody(validCaption({ items: [{ name: "x", priceMinor: 4.5 }] })).ok).toBe(false);
  });

  it("accepts priceMinor of 0", () => {
    expect(validateStudioBody(validCaption({ items: [{ name: "x", priceMinor: 0 }] })).ok).toBe(true);
  });

  it("rejects a note over 200 characters", () => {
    expect(validateStudioBody(validCaption({ note: "a".repeat(201) })).ok).toBe(false);
  });

  it("accepts a note of exactly 200 characters", () => {
    expect(validateStudioBody(validCaption({ note: "a".repeat(200) })).ok).toBe(true);
  });

  it("rejects a link that isn't http(s)", () => {
    expect(validateStudioBody(validCaption({ link: "ftp://example.com" })).ok).toBe(false);
    expect(validateStudioBody(validCaption({ link: "not a url" })).ok).toBe(false);
  });

  it("rejects a lowercase currency code", () => {
    expect(validateStudioBody(validCaption({ currency: "bhd" })).ok).toBe(false);
  });

  it("rejects a currency code that isn't 3 letters", () => {
    expect(validateStudioBody(validCaption({ currency: "BAHD" })).ok).toBe(false);
  });

  it("rejects a shopName over 60 characters", () => {
    expect(validateStudioBody(validCaption({ shopName: "a".repeat(61) })).ok).toBe(false);
  });

  it("rejects an unknown platform", () => {
    expect(validateStudioBody(validCaption({ platform: "windows" })).ok).toBe(false);
  });

  it("rejects a missing installId", () => {
    const body = JSON.parse(validCaption());
    delete body.installId;
    expect(validateStudioBody(JSON.stringify(body)).ok).toBe(false);
  });
});

describe("validateStudioBody / photo", () => {
  it("accepts a valid photo body", () => {
    const result = validateStudioBody(validPhoto());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toMatchObject({ task: "photo", styleId: "marble", aspect: "1:1" });
  });

  it.each(["1:1", "4:5", "9:16"])("accepts aspect=%s", (aspect) => {
    expect(validateStudioBody(validPhoto({ aspect })).ok).toBe(true);
  });

  it("rejects an unknown aspect", () => {
    expect(validateStudioBody(validPhoto({ aspect: "16:9" })).ok).toBe(false);
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts declared mimeType=%s", (mimeType) => {
    expect(validateStudioBody(validPhoto({ image: { mimeType, data: "AQID" } })).ok).toBe(true);
  });

  it("rejects an unsupported mimeType", () => {
    expect(validateStudioBody(validPhoto({ image: { mimeType: "image/gif", data: "AQID" } })).ok).toBe(false);
  });

  it("rejects an empty data string", () => {
    expect(validateStudioBody(validPhoto({ image: { mimeType: "image/jpeg", data: "" } })).ok).toBe(false);
  });

  it("rejects a missing image field", () => {
    const body = JSON.parse(validPhoto());
    delete body.image;
    expect(validateStudioBody(JSON.stringify(body)).ok).toBe(false);
  });

  it("rejects an empty styleId", () => {
    expect(validateStudioBody(validPhoto({ styleId: "" })).ok).toBe(false);
  });
});

describe("validateStudioBody / shared", () => {
  it("rejects a body that isn't JSON", () => {
    expect(validateStudioBody("not json")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a JSON array", () => {
    expect(validateStudioBody("[]")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unknown task", () => {
    const body = JSON.parse(validCaption());
    body.task = "something-else";
    expect(validateStudioBody(JSON.stringify(body))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a missing task", () => {
    const body = JSON.parse(validCaption());
    delete body.task;
    expect(validateStudioBody(JSON.stringify(body))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("returns too_large for a body over the size cap, before even parsing JSON", () => {
    const huge = `{"task":"caption","padding":"${"a".repeat(5 * 1024 * 1024)}"}`;
    expect(validateStudioBody(huge)).toEqual({ ok: false, error: "too_large" });
  });
});
