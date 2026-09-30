import { describe, expect, it } from "vitest";
import { chosenPaymentMethod, isPaymentLink, legacyIbanOf, normalizePaypal, normalizePhone, validatePaymentMethods } from "./payment-methods.ts";

const IBAN = "BH67BMAG00001299123456";

describe("normalizePhone", () => {
  it("keeps + and 8-15 digits, converting Arabic-Indic digits and dropping spaces, dashes and a 00 prefix", () => {
    expect(normalizePhone("+973 3333-4444")).toBe("+97333334444");
    expect(normalizePhone("00966 50 123 4567")).toBe("+966501234567");
    expect(normalizePhone("+٩٧٣٣٣٣٣٤٤٤٤")).toBe("+97333334444");
    expect(normalizePhone("+۹۷۱۵۰۱۲۳۴۵۶۷")).toBe("+971501234567");
  });

  it("rejects numbers without + or outside 8-15 digits", () => {
    for (const bad of ["33334444", "+1234567", "+1234567890123456", "+973abc4444", ""]) expect(normalizePhone(bad)).toBeUndefined();
  });
});

describe("normalizePaypal / isPaymentLink", () => {
  it("strips a pasted paypal.me link", () => {
    expect(normalizePaypal("https://paypal.me/SweetStudio")).toBe("SweetStudio");
    expect(normalizePaypal("paypal.me/abc123/")).toBe("abc123");
    expect(normalizePaypal("sweet.studio")).toBeUndefined();
    expect(normalizePaypal("a".repeat(21))).toBeUndefined();
  });

  it("accepts only https links with a dotted host, no spaces, at most 300 characters", () => {
    expect(isPaymentLink("https://pay.myfatoorah.com/abc")).toBe(true);
    for (const bad of ["http://pay.example.com/x", "https://localhost/x", "https://pay.example.com/a b", `https://x.com/${"a".repeat(290)}`, "javascript:alert(1)", "https://user:pw@x.com/"]) {
      expect(isPaymentLink(bad)).toBe(false);
    }
  });
});

describe("validatePaymentMethods", () => {
  it("normalizes each known type and drops fields a type does not take", () => {
    const result = validatePaymentMethods([
      { type: "bank_transfer", value: "bh67 bmag 0000 1299 1234 56", name: "Ignored holder" },
      { type: "benefitpay", value: "+973 3333 4444", name: "ignored" },
      { type: "mobile_transfer", value: "+968 9123 4567", name: "Bank Muscat" },
      { type: "paypal", value: "https://paypal.me/Sweet" },
      { type: "payment_link", value: "https://pay.example.com/x", name: "Card" },
      { type: "cash", value: "ignored" },
    ], undefined);
    expect(result).toEqual({
      ok: true,
      methods: [
        { type: "bank_transfer", value: IBAN },
        { type: "benefitpay", value: "+97333334444" },
        { type: "mobile_transfer", value: "+96891234567", name: "Bank Muscat" },
        { type: "paypal", value: "Sweet" },
        { type: "payment_link", value: "https://pay.example.com/x", name: "Card" },
        { type: "cash" },
      ],
    });
  });

  it("names the first bad entry's field", () => {
    expect(validatePaymentMethods([{ type: "cash" }, { type: "bank_transfer", value: "BH00BAD" }], undefined)).toEqual({ ok: false, field: "paymentMethods[1].value" });
    expect(validatePaymentMethods([{ type: "stcpay", value: "0501234567" }], undefined)).toEqual({ ok: false, field: "paymentMethods[0].value" });
    expect(validatePaymentMethods([{ type: "payment_link", value: "https://pay.example.com/x" }], undefined)).toEqual({ ok: false, field: "paymentMethods[0].name" });
    expect(validatePaymentMethods([{ type: "mobile_transfer", value: "+96891234567", name: "x".repeat(41) }], undefined)).toEqual({ ok: false, field: "paymentMethods[0].name" });
    expect(validatePaymentMethods([{ type: "Bad-Type" }], undefined)).toEqual({ ok: false, field: "paymentMethods[0].type" });
    expect(validatePaymentMethods(["cash"], undefined)).toEqual({ ok: false, field: "paymentMethods[0]" });
    expect(validatePaymentMethods("cash", undefined)).toEqual({ ok: false, field: "paymentMethods" });
  });

  it("allows one entry per type, payment_link up to three, and at most eight entries", () => {
    expect(validatePaymentMethods([{ type: "cash" }, { type: "cash" }], undefined)).toEqual({ ok: false, field: "paymentMethods[1].type" });
    const link = (i: number) => ({ type: "payment_link", value: `https://pay.example.com/${i}`, name: `L${i}` });
    expect(validatePaymentMethods([link(1), link(2), link(3)], undefined).ok).toBe(true);
    expect(validatePaymentMethods([link(1), link(2), link(3), link(4)], undefined)).toEqual({ ok: false, field: "paymentMethods[3].type" });
    const nine = ["cash", "paypal", "benefitpay", "stcpay", "urpay", "aani", "wamd", "fawran", "mobile_transfer"].map((type) => ({ type, value: type === "paypal" ? "abc" : "+97333334444" }));
    expect(validatePaymentMethods(nine, undefined)).toEqual({ ok: false, field: "paymentMethods" });
  });

  it("keeps a newer app's unknown type within the generic limits", () => {
    expect(validatePaymentMethods([{ type: "future_wallet", value: "abc", name: "Future" }], undefined)).toEqual({ ok: true, methods: [{ type: "future_wallet", value: "abc", name: "Future" }] });
    expect(validatePaymentMethods([{ type: "future_wallet", value: "x".repeat(301) }], undefined)).toEqual({ ok: false, field: "paymentMethods[0].value" });
  });

  it("without paymentMethods, turns the legacy iban into one bank_transfer entry", () => {
    expect(validatePaymentMethods(undefined, IBAN)).toEqual({ ok: true, methods: [{ type: "bank_transfer", value: IBAN }] });
    expect(validatePaymentMethods(undefined, undefined)).toEqual({ ok: true, methods: [] });
    expect(validatePaymentMethods([], IBAN)).toEqual({ ok: true, methods: [] }); // paymentMethods wins when present
  });
});

describe("legacyIbanOf / chosenPaymentMethod", () => {
  const methods = [{ type: "benefitpay", value: "+97333334444" }, { type: "bank_transfer", value: IBAN }];
  it("reads the bank_transfer IBAN", () => {
    expect(legacyIbanOf(methods)).toBe(IBAN);
    expect(legacyIbanOf([{ type: "cash" }])).toBeUndefined();
  });
  it("keeps a web order's method only when the shop offers it", () => {
    expect(chosenPaymentMethod("benefitpay", methods)).toBe("benefitpay");
    expect(chosenPaymentMethod("cash", methods)).toBeUndefined();
    expect(chosenPaymentMethod(42, methods)).toBeUndefined();
  });
});
