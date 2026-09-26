import { describe, expect, it } from "vitest";
import { isAcceptableSlug, isReservedSlug, isValidSlugFormat } from "./slug";

describe("isValidSlugFormat", () => {
  it("accepts a simple lowercase slug", () => {
    expect(isValidSlugFormat("sweetstudio")).toBe(true);
  });

  it("accepts digits and interior hyphens", () => {
    expect(isValidSlugFormat("sweet-studio-2")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidSlugFormat("SweetStudio")).toBe(false);
  });

  it("rejects a leading hyphen", () => {
    expect(isValidSlugFormat("-sweetstudio")).toBe(false);
  });

  it("rejects a trailing hyphen", () => {
    expect(isValidSlugFormat("sweetstudio-")).toBe(false);
  });

  it("rejects underscores and spaces", () => {
    expect(isValidSlugFormat("sweet_studio")).toBe(false);
    expect(isValidSlugFormat("sweet studio")).toBe(false);
  });

  it("rejects a 2-character slug (minimum is 3)", () => {
    expect(isValidSlugFormat("ab")).toBe(false);
  });

  it("accepts a 3-character slug", () => {
    expect(isValidSlugFormat("abc")).toBe(true);
  });

  it("accepts a 30-character slug", () => {
    expect(isValidSlugFormat("a".repeat(30))).toBe(true);
  });

  it("rejects a 31-character slug", () => {
    expect(isValidSlugFormat("a".repeat(31))).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isValidSlugFormat(123)).toBe(false);
    expect(isValidSlugFormat(null)).toBe(false);
    expect(isValidSlugFormat(undefined)).toBe(false);
  });
});

describe("isReservedSlug", () => {
  it.each(["admin", "api", "app", "help", "orderat", "s", "shop", "shops", "store", "support", "www", "demo", "test"])(
    "flags %s as reserved",
    (slug) => {
      expect(isReservedSlug(slug)).toBe(true);
    },
  );

  it("is case-insensitive", () => {
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("Demo")).toBe(true);
  });

  it("does not flag an ordinary slug", () => {
    expect(isReservedSlug("sweetstudio")).toBe(false);
  });
});

describe("isAcceptableSlug", () => {
  it("accepts a well-formed, non-reserved slug", () => {
    expect(isAcceptableSlug("sweetstudio")).toBe(true);
  });

  it("rejects a well-formed but reserved slug", () => {
    expect(isAcceptableSlug("shop")).toBe(false);
    expect(isAcceptableSlug("demo")).toBe(false);
    expect(isAcceptableSlug("test")).toBe(false);
  });

  it("rejects a malformed slug", () => {
    expect(isAcceptableSlug("Sweet Studio!")).toBe(false);
  });
});
