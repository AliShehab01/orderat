// Money formatting shared by orderat-studio (AI captions embed a real price, so the server formats
// it and hands Gemini a fixed string — the model only talks, per docs/ask-orderat.md's principle,
// never doing arithmetic or digit-formatting of its own) and orderat-shop (the WhatsApp order summary
// built server-side in server/shop/orders.ts). Same decimals rule as docs/ask-orderat.md and
// server/ask/prompt.ts's moneyRule: BHD/KWD/OMR are 3-decimal currencies (1000 fils/baisa to the
// unit), every other currency is 2-decimal. Not imported from server/ask/prompt.ts itself — that
// file only builds an instruction string for Gemini and never formats a real number — but the rule
// it encodes is kept in sync with this one by hand; change one, change the other.

export const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "OMR"]);

export function decimalsForCurrency(currency: string): 2 | 3 {
  return THREE_DECIMAL_CURRENCIES.has(currency) ? 3 : 2;
}

/**
 * Formats an integer minor-unit amount (fils/halalas/...) as "12.500 BHD" — Latin digits, a plain
 * number, the currency code after a space, never words. `minorUnits` is trusted to already be a
 * non-negative integer (every caller validates that first); this only formats.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  const decimals = decimalsForCurrency(currency);
  const amount = minorUnits / 10 ** decimals;
  return `${amount.toFixed(decimals)} ${currency}`;
}
