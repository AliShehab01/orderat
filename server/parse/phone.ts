// Strips phone numbers from customer message text before it's ever sent to Gemini
// (docs/sme-phase-2-cloud.md's AI order entry: "Phone numbers are stripped before sending"). A
// phone-shaped run is a sequence of digits and the separators phone numbers are actually written
// with (space, dash, dot, parentheses), optionally starting with "+", whose digits alone number
// between 7 and 15 — the same upper bound as server/shop/validate.ts's own customer.phone shape check
// (`/^\+?\d{8,15}$/`), with the lower bound relaxed to 7 since a local number can appear without its
// country code and this only needs to be "phone-shaped enough to redact", not a strict validator.
// Deliberately a heuristic, not a perfect phone-number grammar: it can, in principle, also redact an
// unrelated 7+ digit run (a long price, an ISO date with no separators) — an acceptable trade for
// never letting an actual phone number through, which is the one thing docs/sme-phase-2-cloud.md
// actually asks for.

const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{5,}\d/g;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

export function stripPhoneNumbers(text: string): string {
  return text.replace(PHONE_CANDIDATE_RE, (match) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS ? "" : match;
  });
}
