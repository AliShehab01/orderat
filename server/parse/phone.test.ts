import { describe, expect, it } from "vitest";
import { stripPhoneNumbers } from "./phone.ts";

describe("stripPhoneNumbers", () => {
  it("strips a Bahrain-style 8-digit mobile number with a space", () => {
    expect(stripPhoneNumbers("call me on 3312 3456 please")).toBe("call me on  please");
  });

  it("strips a number with a country code and dashes", () => {
    expect(stripPhoneNumbers("whatsapp me +973-3312-3456 thanks")).toBe("whatsapp me  thanks");
  });

  it("strips a number written with parentheses (the leading paren itself isn't part of the digit run, so it survives)", () => {
    expect(stripPhoneNumbers("(973) 3312 3456")).toBe("(");
  });

  it("strips more than one phone number in the same message", () => {
    expect(stripPhoneNumbers("call 33123456 or 36654321")).toBe("call  or ");
  });

  it("leaves short digit runs (quantities, prices) untouched", () => {
    expect(stripPhoneNumbers("2 cakes at 15.500 each")).toBe("2 cakes at 15.500 each");
  });

  it("leaves text with no digits at all untouched", () => {
    expect(stripPhoneNumbers("عايزة كيكة فانيلا بكرة")).toBe("عايزة كيكة فانيلا بكرة");
  });

  it("leaves an isolated short date-like token untouched", () => {
    expect(stripPhoneNumbers("pickup on 25/12 at noon")).toBe("pickup on 25/12 at noon");
  });

  it("never removes more than 15 digits' worth as one phone number (leaves an implausibly long run alone)", () => {
    const longRun = "1".repeat(20);
    expect(stripPhoneNumbers(`ref ${longRun} end`)).toBe(`ref ${longRun} end`);
  });

  it("handles an empty string", () => {
    expect(stripPhoneNumbers("")).toBe("");
  });
});
