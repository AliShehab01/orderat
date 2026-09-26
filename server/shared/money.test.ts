import { describe, expect, it } from "vitest";
import { decimalsForCurrency, formatMoney } from "./money";

describe("decimalsForCurrency", () => {
  it("gives 3 decimals for BHD, KWD and OMR", () => {
    expect(decimalsForCurrency("BHD")).toBe(3);
    expect(decimalsForCurrency("KWD")).toBe(3);
    expect(decimalsForCurrency("OMR")).toBe(3);
  });

  it("gives 2 decimals for every other currency", () => {
    expect(decimalsForCurrency("SAR")).toBe(2);
    expect(decimalsForCurrency("AED")).toBe(2);
    expect(decimalsForCurrency("USD")).toBe(2);
  });
});

describe("formatMoney", () => {
  it("formats a 3-decimal currency with Latin digits and a trailing code", () => {
    expect(formatMoney(4500, "BHD")).toBe("4.500 BHD");
    expect(formatMoney(1, "BHD")).toBe("0.001 BHD");
  });

  it("formats a 2-decimal currency", () => {
    expect(formatMoney(4500, "SAR")).toBe("45.00 SAR");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "BHD")).toBe("0.000 BHD");
  });

  it("never uses grouping separators", () => {
    expect(formatMoney(1234500, "BHD")).toBe("1234.500 BHD");
  });
});
