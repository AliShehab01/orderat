import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, validateAuthBody, type SigninBody } from "./validate.ts";

describe("validateAuthBody", () => {
  it("accepts a minimal signin body", () => {
    const result = validateAuthBody(JSON.stringify({ action: "signin", provider: "apple", idToken: "abc.def.ghi" }));
    expect(result).toEqual({ ok: true, body: { action: "signin", provider: "apple", idToken: "abc.def.ghi", nonce: undefined, deviceName: undefined } });
  });

  it("accepts a signin body with nonce and deviceName", () => {
    const result = validateAuthBody(JSON.stringify({ action: "signin", provider: "google", idToken: "abc.def.ghi", nonce: "n-1", deviceName: "Pixel 9" }));
    expect(result).toEqual({ ok: true, body: { action: "signin", provider: "google", idToken: "abc.def.ghi", nonce: "n-1", deviceName: "Pixel 9" } });
  });

  it.each(["web", "app"] as const)("accepts a signin body from client %s", (client) => {
    const result = validateAuthBody(JSON.stringify({ action: "signin", provider: "apple", idToken: "abc.def.ghi", client }));
    expect(result).toEqual({ ok: true, body: { action: "signin", provider: "apple", idToken: "abc.def.ghi", client } });
  });

  it("leaves client undefined, never defaulted, when the body has none (the phones today)", () => {
    const result = validateAuthBody(JSON.stringify({ action: "signin", provider: "apple", idToken: "abc.def.ghi" }));
    expect(result.ok).toBe(true);
    expect(result.ok && (result.body as SigninBody).client).toBeUndefined();
  });

  // One row per case: it.each would spread a bare array case into arguments, hiding the array value.
  it.each([["x"], ["WEB"], [""], [null], [1], [true], [["web"]]])("rejects the signin client %j", (client) => {
    const result = validateAuthBody(JSON.stringify({ action: "signin", provider: "apple", idToken: "abc.def.ghi", client }));
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an unknown provider", () => {
    expect(validateAuthBody(JSON.stringify({ action: "signin", provider: "facebook", idToken: "x" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a missing or empty idToken", () => {
    expect(validateAuthBody(JSON.stringify({ action: "signin", provider: "apple" }))).toEqual({ ok: false, error: "invalid_body" });
    expect(validateAuthBody(JSON.stringify({ action: "signin", provider: "apple", idToken: "" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an oversized idToken", () => {
    const body = JSON.stringify({ action: "signin", provider: "apple", idToken: "a".repeat(8001) });
    expect(validateAuthBody(body)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts the bodiless actions", () => {
    expect(validateAuthBody(JSON.stringify({ action: "signout" }))).toEqual({ ok: true, body: { action: "signout" } });
    expect(validateAuthBody(JSON.stringify({ action: "me" }))).toEqual({ ok: true, body: { action: "me" } });
    expect(validateAuthBody(JSON.stringify({ action: "delete_account" }))).toEqual({ ok: true, body: { action: "delete_account" } });
  });

  it("rejects an unknown action", () => {
    expect(validateAuthBody(JSON.stringify({ action: "nope" }))).toEqual({ ok: false, error: "invalid_body" });
  });

  // Phone-to-web login: the website calls pair_start and pair_poll, the signed-in phone pair_approve.
  describe("pairing", () => {
    const PAIR_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const POLL_TOKEN = "q9Yx2Lh0cN3bV7mK1pZ8tR4wS6uE5aD0fG2hJ3kL4mN";

    it("accepts pair_start, which carries no fields of its own", () => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_start" }))).toEqual({ ok: true, body: { action: "pair_start" } });
    });

    it.each(["123456", "000000", "999999"])("accepts pair_approve with the 6-digit code %s", (code) => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_approve", code }))).toEqual({ ok: true, body: { action: "pair_approve", code } });
    });

    it.each([["12345"], ["1234567"], ["12a456"], [" 123456"], [""], [123456], [null]])("rejects the pair_approve code %j", (code) => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_approve", code }))).toEqual({ ok: false, error: "invalid_body" });
    });

    it("rejects pair_approve without a code", () => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_approve" }))).toEqual({ ok: false, error: "invalid_body" });
    });

    it("accepts pair_poll with a uuid pairId and a poll token", () => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_poll", pairId: PAIR_ID, pollToken: POLL_TOKEN }))).toEqual({
        ok: true,
        body: { action: "pair_poll", pairId: PAIR_ID, pollToken: POLL_TOKEN },
      });
    });

    it.each([["not-a-uuid"], [""], [42], [null]])("rejects the pair_poll pairId %j", (pairId) => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_poll", pairId, pollToken: POLL_TOKEN }))).toEqual({ ok: false, error: "invalid_body" });
    });

    it.each([[""], ["a".repeat(129)], [42], [null]])("rejects the pair_poll pollToken %j", (pollToken) => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_poll", pairId: PAIR_ID, pollToken }))).toEqual({ ok: false, error: "invalid_body" });
    });

    it("rejects pair_poll missing its pairId or pollToken", () => {
      expect(validateAuthBody(JSON.stringify({ action: "pair_poll", pollToken: POLL_TOKEN }))).toEqual({ ok: false, error: "invalid_body" });
      expect(validateAuthBody(JSON.stringify({ action: "pair_poll", pairId: PAIR_ID }))).toEqual({ ok: false, error: "invalid_body" });
    });
  });

  it("rejects malformed JSON", () => {
    expect(validateAuthBody("{not json")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a non-object JSON body", () => {
    expect(validateAuthBody("[1,2,3]")).toEqual({ ok: false, error: "invalid_body" });
    expect(validateAuthBody("null")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a body over the size cap with too_large, not invalid_body", () => {
    const body = JSON.stringify({ action: "signin", provider: "apple", idToken: "a".repeat(MAX_BODY_BYTES) });
    expect(validateAuthBody(body)).toEqual({ ok: false, error: "too_large" });
  });
});
