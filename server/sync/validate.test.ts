import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, MAX_CHANGES_PER_REQUEST, MAX_RECORD_DATA_BYTES, validateSyncBody } from "./validate.ts";

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

describe("validateSyncBody / create_shop", () => {
  it("accepts a valid create_shop body", () => {
    expect(validateSyncBody(JSON.stringify({ action: "create_shop", shopId: SHOP_ID, name: "Sara's Cakes" }))).toEqual({
      ok: true,
      body: { action: "create_shop", shopId: SHOP_ID, name: "Sara's Cakes" },
    });
  });

  it("rejects a non-uuid shopId", () => {
    expect(validateSyncBody(JSON.stringify({ action: "create_shop", shopId: "not-a-uuid", name: "x" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a missing or empty name", () => {
    expect(validateSyncBody(JSON.stringify({ action: "create_shop", shopId: SHOP_ID }))).toEqual({ ok: false, error: "invalid_body" });
    expect(validateSyncBody(JSON.stringify({ action: "create_shop", shopId: SHOP_ID, name: "" }))).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("validateSyncBody / sync", () => {
  it("accepts a sync body with an empty changes array (pull-only)", () => {
    const result = validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [] }));
    expect(result).toEqual({ ok: true, body: { action: "sync", shopId: SHOP_ID, cursor: 0, changes: [] } });
  });

  it("accepts a well-formed change and fills in defaults for deleted/baseSeq", () => {
    const result = validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 5, changes: [{ entity: "order", id: "o1", data: { status: "pending" } }] }));
    expect(result).toEqual({ ok: true, body: { action: "sync", shopId: SHOP_ID, cursor: 5, changes: [{ entity: "order", id: "o1", data: { status: "pending" }, deleted: false, baseSeq: 0 }] } });
  });

  it("accepts an explicit deleted/baseSeq", () => {
    const result = validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 5, changes: [{ entity: "order", id: "o1", data: {}, deleted: true, baseSeq: 42 }] }));
    expect(result.ok).toBe(true);
    if (result.ok && result.body.action === "sync") expect(result.body.changes[0]).toEqual({ entity: "order", id: "o1", data: {}, deleted: true, baseSeq: 42 });
  });

  it("rejects a negative cursor", () => {
    expect(validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: -1, changes: [] }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unknown entity", () => {
    const body = JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [{ entity: "not_an_entity", id: "x", data: {} }] });
    expect(validateSyncBody(body)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a change with a non-object data field", () => {
    const body = JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [{ entity: "order", id: "x", data: "nope" }] });
    expect(validateSyncBody(body)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a record over 32 KB with too_large", () => {
    const body = JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [{ entity: "order", id: "x", data: { note: "a".repeat(MAX_RECORD_DATA_BYTES) } }] });
    expect(validateSyncBody(body)).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects more than the defensive per-request change cap", () => {
    const changes = Array.from({ length: MAX_CHANGES_PER_REQUEST + 1 }, (_, i) => ({ entity: "order", id: `o${i}`, data: {} }));
    expect(validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a body over the 2 MB cap with too_large", () => {
    const body = JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [{ entity: "order", id: "x", data: { note: "a".repeat(MAX_BODY_BYTES) } }] });
    expect(validateSyncBody(body)).toEqual({ ok: false, error: "too_large" });
  });
});

describe("validateSyncBody / invites", () => {
  it("accepts invite_create with just a shopId", () => {
    expect(validateSyncBody(JSON.stringify({ action: "invite_create", shopId: SHOP_ID }))).toEqual({ ok: true, body: { action: "invite_create", shopId: SHOP_ID } });
  });

  it("accepts a 6-digit invite_join code", () => {
    expect(validateSyncBody(JSON.stringify({ action: "invite_join", code: "123456" }))).toEqual({ ok: true, body: { action: "invite_join", code: "123456" } });
  });

  it("rejects a code that isn't exactly 6 digits", () => {
    for (const code of ["12345", "1234567", "12345a", ""]) {
      expect(validateSyncBody(JSON.stringify({ action: "invite_join", code }))).toEqual({ ok: false, error: "invalid_body" });
    }
  });
});

describe("validateSyncBody / members", () => {
  it("accepts members_list, members_update and members_remove", () => {
    expect(validateSyncBody(JSON.stringify({ action: "members_list", shopId: SHOP_ID }))).toEqual({ ok: true, body: { action: "members_list", shopId: SHOP_ID } });
    const permissions = { orders: true, prepare: false, money: false, products: true };
    expect(validateSyncBody(JSON.stringify({ action: "members_update", shopId: SHOP_ID, userId: USER_ID, permissions }))).toEqual({
      ok: true,
      body: { action: "members_update", shopId: SHOP_ID, userId: USER_ID, permissions },
    });
    expect(validateSyncBody(JSON.stringify({ action: "members_remove", shopId: SHOP_ID, userId: USER_ID }))).toEqual({ ok: true, body: { action: "members_remove", shopId: SHOP_ID, userId: USER_ID } });
  });

  it("rejects members_update with an incomplete permissions object", () => {
    const body = JSON.stringify({ action: "members_update", shopId: SHOP_ID, userId: USER_ID, permissions: { orders: true } });
    expect(validateSyncBody(body)).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("validateSyncBody / record ids", () => {
  const change = (id: unknown) => JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes: [{ entity: "order", id, data: {} }] });

  it("accepts UUIDs and setting keys", () => {
    for (const id of ["0f8c2a1e-3b4d-4c5e-8f90-123456789abc", "whatsappTemplates", "subscription", "a_b-C9", "x".repeat(128)]) {
      expect(validateSyncBody(change(id)).ok).toBe(true);
    }
  });

  it("rejects ids with path, dot, space or other characters, empty ids and ids over 128 characters", () => {
    for (const id of ["", "..", "a/b", "a.b", "a b", "ö", "x".repeat(129), 12]) {
      expect(validateSyncBody(change(id))).toEqual({ ok: false, error: "invalid_body" });
    }
  });
});

// Tester feedback 1 Oct 2026: the new shop setting and the new order key pass validation as they are
// (who may write them is server/sync/record-access.ts's concern).
describe("validateSyncBody / new record keys", () => {
  const sync = (changes: unknown[]) => validateSyncBody(JSON.stringify({ action: "sync", shopId: SHOP_ID, cursor: 0, changes }));

  it("accepts the deliveryDefaults setting, {feeMinor: int >= 0}", () => {
    for (const feeMinor of [0, 500, 1250]) {
      const result = sync([{ entity: "setting", id: "deliveryDefaults", data: { value: { feeMinor } } }]);
      expect(result).toEqual({ ok: true, body: expect.objectContaining({ changes: [expect.objectContaining({ entity: "setting", id: "deliveryDefaults", data: { value: { feeMinor } } })] }) });
    }
  });

  it("accepts an order's outForDeliveryAt as an ISO date or null, kept as sent", () => {
    for (const outForDeliveryAt of ["2026-10-01T10:00:00.000Z", null]) {
      const data = { status: "ready", fulfillmentType: "delivery", outForDeliveryAt };
      const result = sync([{ entity: "order", id: "0f8c2a1e-3b4d-4c5e-8f90-123456789abc", data }]);
      expect(result.ok).toBe(true);
      if (result.ok && result.body.action === "sync") expect(result.body.changes[0]!.data).toEqual(data);
    }
  });
});

describe("validateSyncBody / photos", () => {
  it("accepts photo_upload and photo_url", () => {
    expect(validateSyncBody(JSON.stringify({ action: "photo_upload", shopId: SHOP_ID, mimeType: "image/jpeg", data: "abc" }))).toEqual({
      ok: true,
      body: { action: "photo_upload", shopId: SHOP_ID, mimeType: "image/jpeg", data: "abc" },
    });
    expect(validateSyncBody(JSON.stringify({ action: "photo_url", shopId: SHOP_ID, photoId: "a".repeat(64) }))).toEqual({
      ok: true,
      body: { action: "photo_url", shopId: SHOP_ID, photoId: "a".repeat(64) },
    });
  });

  it("rejects a photo_url photoId that is not 64 lowercase hex characters", () => {
    for (const photoId of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `../${"a".repeat(61)}`, `${"a".repeat(60)}.jpg`, `x/${"a".repeat(62)}`, ""]) {
      expect(validateSyncBody(JSON.stringify({ action: "photo_url", shopId: SHOP_ID, photoId }))).toEqual({ ok: false, error: "invalid_body" });
    }
  });

  it("rejects an unsupported photo_upload mimeType", () => {
    expect(validateSyncBody(JSON.stringify({ action: "photo_upload", shopId: SHOP_ID, mimeType: "image/gif", data: "abc" }))).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("validateSyncBody / shops_list", () => {
  it("accepts shops_list with no other fields", () => {
    expect(validateSyncBody(JSON.stringify({ action: "shops_list" }))).toEqual({ ok: true, body: { action: "shops_list" } });
  });

  it("ignores extra fields on shops_list (the body carries nothing but the action)", () => {
    expect(validateSyncBody(JSON.stringify({ action: "shops_list", shopId: SHOP_ID }))).toEqual({ ok: true, body: { action: "shops_list" } });
  });
});

describe("validateSyncBody / general", () => {
  it("rejects an unknown action", () => {
    expect(validateSyncBody(JSON.stringify({ action: "nope" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects malformed JSON and non-object bodies", () => {
    expect(validateSyncBody("{not json")).toEqual({ ok: false, error: "invalid_body" });
    expect(validateSyncBody("[1,2,3]")).toEqual({ ok: false, error: "invalid_body" });
  });
});
