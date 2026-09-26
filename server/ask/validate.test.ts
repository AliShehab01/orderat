import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, validateAskBody } from "./validate.ts";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    installId: "a1b2c3d4-0000-0000-0000-000000000000",
    platform: "ios",
    appVersion: "1.0.0",
    lang: "ar",
    demo: false,
    question: "كم ربحت هالشهر؟",
    history: [{ role: "user", text: "hi" }],
    snapshot: { today: "2026-09-26", currency: "BHD" },
    ...overrides,
  };
}

describe("validateAskBody", () => {
  it("accepts a well-formed body and narrows every field", () => {
    const result = validateAskBody(JSON.stringify(validBody()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.body).toEqual({
      installId: "a1b2c3d4-0000-0000-0000-000000000000",
      platform: "ios",
      appVersion: "1.0.0",
      lang: "ar",
      demo: false,
      question: "كم ربحت هالشهر؟",
      history: [{ role: "user", text: "hi" }],
      snapshot: { today: "2026-09-26", currency: "BHD" },
    });
  });

  it("defaults demo to false and history to [] when omitted", () => {
    const body = validBody();
    delete body.demo;
    delete body.history;
    const result = validateAskBody(JSON.stringify(body));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.demo).toBe(false);
    expect(result.body.history).toEqual([]);
  });

  it("accepts demo: true and android platform", () => {
    const result = validateAskBody(JSON.stringify(validBody({ demo: true, platform: "android" })));
    expect(result.ok).toBe(true);
  });

  it("rejects bodies that are not valid JSON", () => {
    expect(validateAskBody("not json")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a JSON array or scalar at the top level", () => {
    expect(validateAskBody("[]").ok).toBe(false);
    expect(validateAskBody("42").ok).toBe(false);
    expect(validateAskBody("null").ok).toBe(false);
  });

  it("rejects a body over the ~64 KB cap", () => {
    const big = validBody({ question: "hi" });
    (big.snapshot as Record<string, unknown>).padding = "x".repeat(MAX_BODY_BYTES);
    expect(validateAskBody(JSON.stringify(big))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts a body right at the cap and rejects one a single byte over it", () => {
    // Pad via snapshot (not `question`, which has its own separate 500-char cap) so this test
    // isolates the body-size check. "x" padding is one UTF-8 byte per character, so the math is exact
    // even though the default question text (Arabic) is multi-byte.
    const bodyOfSize = (totalBytes: number): string => {
      const body = validBody({ snapshot: { currency: "BHD", padding: "" } });
      const baseBytes = new TextEncoder().encode(JSON.stringify(body)).length;
      (body.snapshot as Record<string, unknown>).padding = "x".repeat(Math.max(0, totalBytes - baseBytes));
      return JSON.stringify(body);
    };

    const atCap = bodyOfSize(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(atCap).length).toBe(MAX_BODY_BYTES);
    expect(validateAskBody(atCap).ok).toBe(true);

    const overCap = bodyOfSize(MAX_BODY_BYTES + 1);
    expect(new TextEncoder().encode(overCap).length).toBe(MAX_BODY_BYTES + 1);
    expect(validateAskBody(overCap).ok).toBe(false);
  });

  for (const field of ["installId", "platform", "appVersion", "lang", "question", "snapshot"]) {
    it(`rejects a body missing required field "${field}"`, () => {
      const body = validBody();
      delete body[field];
      expect(validateAskBody(JSON.stringify(body)).ok).toBe(false);
    });
  }

  it("rejects an unknown platform", () => {
    expect(validateAskBody(JSON.stringify(validBody({ platform: "web" }))).ok).toBe(false);
  });

  it("rejects an unknown lang", () => {
    expect(validateAskBody(JSON.stringify(validBody({ lang: "fr" }))).ok).toBe(false);
  });

  it("rejects a non-boolean demo", () => {
    expect(validateAskBody(JSON.stringify(validBody({ demo: "true" }))).ok).toBe(false);
  });

  it("rejects a non-object snapshot", () => {
    expect(validateAskBody(JSON.stringify(validBody({ snapshot: "x" }))).ok).toBe(false);
    expect(validateAskBody(JSON.stringify(validBody({ snapshot: [] }))).ok).toBe(false);
    expect(validateAskBody(JSON.stringify(validBody({ snapshot: null }))).ok).toBe(false);
  });

  it("rejects an empty question", () => {
    expect(validateAskBody(JSON.stringify(validBody({ question: "" }))).ok).toBe(false);
  });

  it("rejects a question over 500 characters", () => {
    expect(validateAskBody(JSON.stringify(validBody({ question: "a".repeat(501) }))).ok).toBe(false);
  });

  it("accepts a question at exactly 500 characters", () => {
    expect(validateAskBody(JSON.stringify(validBody({ question: "a".repeat(500) }))).ok).toBe(true);
  });

  it("rejects history with more than 6 turns", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({ role: "user", text: `t${i}` }));
    expect(validateAskBody(JSON.stringify(validBody({ history }))).ok).toBe(false);
  });

  it("accepts history with exactly 6 turns", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `t${i}` }));
    expect(validateAskBody(JSON.stringify(validBody({ history }))).ok).toBe(true);
  });

  it("rejects a history turn with an unknown role", () => {
    expect(validateAskBody(JSON.stringify(validBody({ history: [{ role: "system", text: "hi" }] }))).ok).toBe(false);
  });

  it("rejects a history turn whose text is not a string", () => {
    expect(validateAskBody(JSON.stringify(validBody({ history: [{ role: "user", text: 5 }] }))).ok).toBe(false);
  });

  it("rejects a non-array history", () => {
    expect(validateAskBody(JSON.stringify(validBody({ history: "nope" }))).ok).toBe(false);
  });

  it("rejects an installId that is empty or absurdly long", () => {
    expect(validateAskBody(JSON.stringify(validBody({ installId: "" }))).ok).toBe(false);
    expect(validateAskBody(JSON.stringify(validBody({ installId: "a".repeat(201) }))).ok).toBe(false);
  });
});
