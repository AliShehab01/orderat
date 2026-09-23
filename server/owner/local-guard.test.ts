import { describe, expect, it } from "vitest";
import { isLocalRequest, resolveOwnerKey } from "./local-guard";

function req(remoteAddress: string, headers: Record<string, string> = {}) {
  return { socket: { remoteAddress }, headers };
}

describe("isLocalRequest", () => {
  it("is true for loopback requests with no Cloudflare headers", () => {
    expect(isLocalRequest(req("127.0.0.1"))).toBe(true);
    expect(isLocalRequest(req("::1"))).toBe(true);
    expect(isLocalRequest(req("::ffff:127.0.0.1"))).toBe(true);
  });

  it("is false for a non-loopback address", () => {
    expect(isLocalRequest(req("203.0.113.5"))).toBe(false);
  });

  it("is false for loopback traffic carrying Cloudflare tunnel headers", () => {
    expect(isLocalRequest(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.5" }))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", { "cf-ray": "abc123" }))).toBe(false);
  });
});

describe("resolveOwnerKey", () => {
  it("keeps a configured key and reports it was not generated", () => {
    expect(resolveOwnerKey("my-key")).toEqual({ key: "my-key", generated: false });
  });

  it("generates a key when none is configured", () => {
    expect(resolveOwnerKey(undefined, () => "generated-key")).toEqual({ key: "generated-key", generated: true });
  });
});
