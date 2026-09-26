import { describe, expect, it } from "vitest";
import { constantTimeEqualHex, newEditToken, sha256Hex, sha256HexOfString } from "./crypto";

describe("sha256Hex / sha256HexOfString", () => {
  it("matches a known SHA-256 vector for an empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256HexOfString("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches a known SHA-256 vector for \"abc\"", async () => {
    expect(await sha256HexOfString("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("is deterministic and lowercase hex", async () => {
    const a = await sha256HexOfString("orderat");
    const b = await sha256HexOfString("orderat");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes different inputs to different digests", async () => {
    expect(await sha256HexOfString("orderat")).not.toBe(await sha256HexOfString("Orderat"));
  });
});

describe("newEditToken", () => {
  it("returns a base64url token (no +, /, or = padding) and its sha256 hex hash", async () => {
    const { token, tokenHash } = await newEditToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenHash).toBe(await sha256HexOfString(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats a token across calls", async () => {
    const tokens = await Promise.all(Array.from({ length: 20 }, () => newEditToken()));
    expect(new Set(tokens.map((t) => t.token)).size).toBe(20);
  });

  it("decodes back to 32 raw bytes", async () => {
    const { token } = await newEditToken();
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    expect(Buffer.from(withPadding, "base64").length).toBe(32);
  });
});

describe("constantTimeEqualHex", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqualHex("abcd1234", "abcd1234")).toBe(true);
  });

  it("returns false for a single differing character", () => {
    expect(constantTimeEqualHex("abcd1234", "abcd1235")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqualHex("abcd", "abcd12")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqualHex("", "")).toBe(true);
  });
});
