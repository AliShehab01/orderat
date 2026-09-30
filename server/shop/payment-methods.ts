// Shop link payment methods (the payment-methods contract shared by iOS, Android, the server, the shop
// page and the web app): a published shop carries `paymentMethods`, at most 8 entries of
// { type, value?, name? }. This file validates and normalizes them for orderat-shop's publish, derives
// them from the legacy `iban` field older phones still send, and checks a web order's chosen
// `paymentMethod` against them.
//
// Founder ruling (30 Sep 2026): a bank transfer has no account-holder name. `name` on a bank_transfer
// entry and the legacy `ibanName` are accepted without error and dropped, never stored or shown.

import { isValidIban, normalizeIban } from "./doc.ts";

export interface PaymentMethod {
  type: string;
  value?: string;
  name?: string;
}

export type PaymentMethodsResult = { ok: true; methods: PaymentMethod[] } | { ok: false; field: string };

export const MAX_PAYMENT_METHODS = 8;
const MAX_PAYMENT_LINKS = 3;
/** Limits for a type this server does not know yet (from a newer app): kept, within these bounds. */
const MAX_GENERIC_VALUE_CHARS = 300;
const MAX_GENERIC_NAME_CHARS = 70;
const UNKNOWN_TYPE_RE = /^[a-z_]{2,30}$/;

/** Wallets and transfers addressed by a phone number (E.164). */
const PHONE_TYPES = new Set(["benefitpay", "stcpay", "urpay", "aani", "wamd", "fawran", "mobile_transfer"]);
export const KNOWN_TYPES = new Set(["bank_transfer", ...PHONE_TYPES, "paypal", "payment_link", "cash"]);

const E164_RE = /^\+\d{8,15}$/;
const PAYPAL_RE = /^[A-Za-z0-9]{1,20}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to ASCII. */
function asciiDigits(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** "+973 3333-4444", "00973 33334444" or "+٩٧٣٣٣٣٣٤٤٤٤" → "+97333334444"; undefined when it is not
 * `+` and 8-15 digits. */
export function normalizePhone(raw: string): string | undefined {
  let s = asciiDigits(raw).replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return E164_RE.test(s) ? s : undefined;
}

/** A paypal.me username, with a pasted "https://paypal.me/" (or www., or http) prefix stripped. */
export function normalizePaypal(raw: string): string | undefined {
  const s = raw.trim().replace(/^(?:https?:\/\/)?(?:www\.)?paypal\.me\//i, "").replace(/\/+$/, "");
  return PAYPAL_RE.test(s) ? s : undefined;
}

/** An https:// link of at most 300 characters, no spaces, whose host has a dot. */
export function isPaymentLink(raw: string): boolean {
  if (raw.length > MAX_GENERIC_VALUE_CHARS || /\s/.test(raw) || !raw.startsWith("https://")) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function text(value: unknown, max: number): string | undefined | null {
  // undefined: absent; null: present but not a 1..max-character string.
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

function validateEntry(raw: unknown, at: string): { ok: true; method: PaymentMethod } | { ok: false; field: string } {
  if (!isPlainObject(raw)) return { ok: false, field: at };
  const type = raw.type;
  if (typeof type !== "string" || !UNKNOWN_TYPE_RE.test(type)) return { ok: false, field: `${at}.type` };
  const value = raw.value;

  if (type === "bank_transfer") {
    if (typeof value !== "string") return { ok: false, field: `${at}.value` };
    const iban = normalizeIban(asciiDigits(value));
    if (!isValidIban(iban)) return { ok: false, field: `${at}.value` };
    return { ok: true, method: { type, value: iban } }; // any `name` is dropped (no account holder)
  }
  if (PHONE_TYPES.has(type)) {
    const phone = typeof value === "string" ? normalizePhone(value) : undefined;
    if (!phone) return { ok: false, field: `${at}.value` };
    if (type !== "mobile_transfer") return { ok: true, method: { type, value: phone } };
    const name = text(raw.name, 40);
    if (name === null) return { ok: false, field: `${at}.name` };
    return { ok: true, method: name ? { type, value: phone, name } : { type, value: phone } };
  }
  if (type === "paypal") {
    const user = typeof value === "string" ? normalizePaypal(value) : undefined;
    return user ? { ok: true, method: { type, value: user } } : { ok: false, field: `${at}.value` };
  }
  if (type === "payment_link") {
    if (typeof value !== "string" || !isPaymentLink(value.trim())) return { ok: false, field: `${at}.value` };
    const name = text(raw.name, 40);
    if (!name) return { ok: false, field: `${at}.name` };
    return { ok: true, method: { type, value: value.trim(), name } };
  }
  if (type === "cash") return { ok: true, method: { type } };

  // A type from a newer app: kept within the generic limits, shown nowhere it is not understood.
  const v = text(value, MAX_GENERIC_VALUE_CHARS);
  if (v === null) return { ok: false, field: `${at}.value` };
  const n = text(raw.name, MAX_GENERIC_NAME_CHARS);
  if (n === null) return { ok: false, field: `${at}.name` };
  const method: PaymentMethod = { type };
  if (v) method.value = v;
  if (n) method.name = n;
  return { ok: true, method };
}

/**
 * Validates a publish request's `paymentMethods` (the whole list or nothing: the first bad entry names
 * its field, e.g. "paymentMethods[2].value"). At most 8 entries, one per type except payment_link (up
 * to 3). When `paymentMethods` is absent, the legacy `iban` (already validated by validateShopDoc)
 * becomes one bank_transfer entry.
 */
export function validatePaymentMethods(raw: unknown, legacyIban: string | undefined): PaymentMethodsResult {
  if (raw === undefined || raw === null) {
    return { ok: true, methods: legacyIban ? [{ type: "bank_transfer", value: legacyIban }] : [] };
  }
  if (!Array.isArray(raw) || raw.length > MAX_PAYMENT_METHODS) return { ok: false, field: "paymentMethods" };
  const methods: PaymentMethod[] = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const at = `paymentMethods[${i}]`;
    const result = validateEntry(raw[i], at);
    if (!result.ok) return result;
    const n = (counts.get(result.method.type) ?? 0) + 1;
    counts.set(result.method.type, n);
    if (n > (result.method.type === "payment_link" ? MAX_PAYMENT_LINKS : 1)) return { ok: false, field: `${at}.type` };
    methods.push(result.method);
  }
  return { ok: true, methods };
}

/** The legacy `iban` older shop pages read: the bank_transfer entry's IBAN, if there is one. */
export function legacyIbanOf(methods: readonly PaymentMethod[]): string | undefined {
  return methods.find((m) => m.type === "bank_transfer")?.value;
}

/** A web order's chosen method: kept only when it is one of the shop's configured types, else dropped. */
export function chosenPaymentMethod(raw: unknown, methods: readonly PaymentMethod[]): string | undefined {
  return typeof raw === "string" && methods.some((m) => m.type === raw) ? raw : undefined;
}

/** How a method is named in the WhatsApp order summary and the phones' inbox note. */
export const PAYMENT_METHOD_LABELS: Record<string, { en: string; ar: string }> = {
  bank_transfer: { en: "Bank transfer (IBAN)", ar: "تحويل بنكي (آيبان)" },
  benefitpay: { en: "BenefitPay", ar: "بنفت باي" },
  stcpay: { en: "STC Pay", ar: "STC Pay" },
  urpay: { en: "urpay", ar: "urpay" },
  aani: { en: "Aani", ar: "آني" },
  wamd: { en: "WAMD", ar: "ومض" },
  fawran: { en: "Fawran", ar: "فوران" },
  mobile_transfer: { en: "Transfer to mobile number", ar: "تحويل لرقم الجوال" },
  paypal: { en: "PayPal", ar: "PayPal" },
  payment_link: { en: "Payment link", ar: "رابط دفع" },
  cash: { en: "Cash on delivery or pickup", ar: "كاش عند التوصيل أو الاستلام" },
};
