// Small JSON helpers shared by the sync rules (record-access.ts, stock-merge.ts, stock-ledger.ts).

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

/** A plain JSON object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality of JSON values, lenient only where clients legitimately differ in spelling: a missing
 * key equals null, and two ISO date strings are equal when they name the same instant. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (typeof a === "string" && typeof b === "string") {
    if (a === b) return true;
    if (ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) {
      const ta = Date.parse(a), tb = Date.parse(b);
      return Number.isFinite(ta) && ta === tb;
    }
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameJson(a[k], b[k])) return false;
    return true;
  }
  return a === b;
}
