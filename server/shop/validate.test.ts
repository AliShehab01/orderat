import { describe, expect, it } from "vitest";
import { validateShopBody } from "./validate";

describe("validateShopBody / slug_check", () => {
  it("accepts any non-empty slug string (format is checked later, not here)", () => {
    const result = validateShopBody(JSON.stringify({ action: "slug_check", slug: "Not Even Valid!" }));
    expect(result).toEqual({ ok: true, body: { action: "slug_check", slug: "Not Even Valid!" } });
  });

  it("rejects a missing slug", () => {
    expect(validateShopBody(JSON.stringify({ action: "slug_check" }))).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("validateShopBody / publish", () => {
  function validPublish(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      action: "publish", installId: "install-1", slug: "sweetstudio", shop: { name: "x" }, photos: [],
      ...overrides,
    });
  }

  it("accepts a valid first-publish body (no token)", () => {
    const result = validateShopBody(validPublish());
    expect(result.ok).toBe(true);
  });

  it("accepts a token for a later publish", () => {
    const result = validateShopBody(validPublish({ token: "some-token" }));
    expect(result.ok && result.body.action === "publish" && result.body.token).toBe("some-token");
  });

  it("rejects a malformed slug", () => {
    expect(validateShopBody(validPublish({ slug: "Not Valid!" })).ok).toBe(false);
  });

  it("rejects a reserved slug", () => {
    expect(validateShopBody(validPublish({ slug: "admin" })).ok).toBe(false);
    expect(validateShopBody(validPublish({ slug: "demo" })).ok).toBe(false);
  });

  it("rejects a missing installId", () => {
    const body = JSON.parse(validPublish());
    delete body.installId;
    expect(validateShopBody(JSON.stringify(body)).ok).toBe(false);
  });

  it("rejects a non-object shop field", () => {
    expect(validateShopBody(validPublish({ shop: "not an object" })).ok).toBe(false);
  });

  it("rejects a photos field that isn't an array of objects", () => {
    expect(validateShopBody(validPublish({ photos: "not an array" })).ok).toBe(false);
    expect(validateShopBody(validPublish({ photos: ["not an object"] })).ok).toBe(false);
  });

  it("accepts photos as an array of objects (deeper validation happens elsewhere)", () => {
    const result = validateShopBody(validPublish({ photos: [{ photoId: "x", mimeType: "image/jpeg", data: "AQID" }] }));
    expect(result.ok).toBe(true);
  });
});

describe("validateShopBody / unpublish, stats, inbox", () => {
  it.each(["unpublish", "stats", "inbox"])("accepts a valid %s body", (action) => {
    const result = validateShopBody(JSON.stringify({ action, token: "tok" }));
    expect(result).toEqual({ ok: true, body: { action, token: "tok" } });
  });

  it.each(["unpublish", "stats", "inbox"])("rejects a %s body missing the token", (action) => {
    expect(validateShopBody(JSON.stringify({ action }))).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("validateShopBody / ack", () => {
  it("accepts a valid ack body", () => {
    const result = validateShopBody(JSON.stringify({ action: "ack", token: "tok", orderIds: ["a", "b"] }));
    expect(result).toEqual({ ok: true, body: { action: "ack", token: "tok", orderIds: ["a", "b"] } });
  });

  it("rejects an empty orderIds array", () => {
    expect(validateShopBody(JSON.stringify({ action: "ack", token: "tok", orderIds: [] })).ok).toBe(false);
  });

  it("rejects more than 100 orderIds", () => {
    const orderIds = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(validateShopBody(JSON.stringify({ action: "ack", token: "tok", orderIds })).ok).toBe(false);
  });
});

describe("validateShopBody / order", () => {
  function validOrder(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      action: "order", slug: "sweetstudio",
      customer: { name: "Sara", phone: "97333334444" },
      items: [{ id: "p1", qty: 2 }],
      pickupDate: "2026-09-28",
      ...overrides,
    });
  }

  it("accepts a minimal valid order", () => {
    expect(validateShopBody(validOrder()).ok).toBe(true);
  });

  it("accepts a phone number with a leading +", () => {
    const result = validateShopBody(validOrder({ customer: { name: "Sara", phone: "+97333334444" } }));
    expect(result.ok).toBe(true);
  });

  it("rejects a phone number that's too short", () => {
    expect(validateShopBody(validOrder({ customer: { name: "Sara", phone: "123" } })).ok).toBe(false);
  });

  it("rejects a phone number that's too long", () => {
    expect(validateShopBody(validOrder({ customer: { name: "Sara", phone: "1".repeat(16) } })).ok).toBe(false);
  });

  it("rejects an empty items array", () => {
    expect(validateShopBody(validOrder({ items: [] })).ok).toBe(false);
  });

  it("rejects more than 30 order lines", () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, qty: 1 }));
    expect(validateShopBody(validOrder({ items })).ok).toBe(false);
  });

  it("rejects qty 0", () => {
    expect(validateShopBody(validOrder({ items: [{ id: "p1", qty: 0 }] })).ok).toBe(false);
  });

  it("rejects qty over 99", () => {
    expect(validateShopBody(validOrder({ items: [{ id: "p1", qty: 100 }] })).ok).toBe(false);
  });

  it("accepts qty 1 and qty 99", () => {
    expect(validateShopBody(validOrder({ items: [{ id: "p1", qty: 1 }] })).ok).toBe(true);
    expect(validateShopBody(validOrder({ items: [{ id: "p1", qty: 99 }] })).ok).toBe(true);
  });

  it("rejects a malformed pickupDate", () => {
    expect(validateShopBody(validOrder({ pickupDate: "28-09-2026" })).ok).toBe(false);
  });

  it("rejects an impossible calendar pickupDate", () => {
    expect(validateShopBody(validOrder({ pickupDate: "2026-02-30" })).ok).toBe(false);
  });

  it("accepts a valid pickupTime", () => {
    expect(validateShopBody(validOrder({ pickupTime: "17:30" })).ok).toBe(true);
  });

  it("rejects a malformed pickupTime", () => {
    expect(validateShopBody(validOrder({ pickupTime: "5:30 PM" })).ok).toBe(false);
  });

  it("accepts an address when fulfillment is delivery", () => {
    const result = validateShopBody(validOrder({ fulfillment: "delivery", address: "Building 12, Road 34" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an address when fulfillment is pickup", () => {
    expect(validateShopBody(validOrder({ fulfillment: "pickup", address: "Building 12" })).ok).toBe(false);
  });

  it("rejects an address when fulfillment is omitted", () => {
    expect(validateShopBody(validOrder({ address: "Building 12" })).ok).toBe(false);
  });

  it("rejects an unknown fulfillment value", () => {
    expect(validateShopBody(validOrder({ fulfillment: "drone" })).ok).toBe(false);
  });

  it("rejects notes over 300 characters", () => {
    expect(validateShopBody(validOrder({ notes: "a".repeat(301) })).ok).toBe(false);
  });

  it("accepts notes of exactly 300 characters", () => {
    expect(validateShopBody(validOrder({ notes: "a".repeat(300) })).ok).toBe(true);
  });
});

describe("validateShopBody / shared", () => {
  it("rejects a body that isn't JSON", () => {
    expect(validateShopBody("not json")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unknown action", () => {
    expect(validateShopBody(JSON.stringify({ action: "delete_everything" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a missing action", () => {
    expect(validateShopBody(JSON.stringify({ slug: "x" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("returns too_large for a body over the 6 MB cap, before parsing JSON", () => {
    const huge = `{"action":"publish","padding":"${"a".repeat(7 * 1024 * 1024)}"}`;
    expect(validateShopBody(huge)).toEqual({ ok: false, error: "too_large" });
  });
});
