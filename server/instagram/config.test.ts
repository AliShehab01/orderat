import { describe, expect, it } from "vitest";
import { instagramAllowUnsigned } from "./config";

describe("instagramAllowUnsigned", () => {
  it("is true only when INSTAGRAM_ALLOW_UNSIGNED=1", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name];
    expect(instagramAllowUnsigned(env({ INSTAGRAM_ALLOW_UNSIGNED: "1" }))).toBe(true);
    expect(instagramAllowUnsigned(env({ INSTAGRAM_ALLOW_UNSIGNED: "0" }))).toBe(false);
    expect(instagramAllowUnsigned(env({}))).toBe(false);
  });

  it("never falls back to WHATSAPP_ALLOW_UNSIGNED", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name];
    expect(instagramAllowUnsigned(env({ WHATSAPP_ALLOW_UNSIGNED: "1" }))).toBe(false);
    expect(instagramAllowUnsigned(env({ WHATSAPP_ALLOW_UNSIGNED: "1", INSTAGRAM_ALLOW_UNSIGNED: "0" }))).toBe(false);
  });
});
