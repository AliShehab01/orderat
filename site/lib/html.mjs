// Minimal, dependency-free HTML helpers shared by every renderer.

/** Escape text for use inside HTML content (not inside attributes with quotes stripped). */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Escape text for use inside a double-quoted HTML attribute. */
export function escAttr(value) {
  return esc(value).replaceAll('"', "&quot;");
}

/** Join an array of HTML strings, dropping falsy entries. */
export function html(...parts) {
  return parts.filter(Boolean).join("");
}

/** A safe wrapper marking a string as pre-escaped HTML, so helpers below don't double-escape it. */
export class Raw {
  constructor(value) {
    this.value = value;
  }
}
export function raw(value) {
  return new Raw(value);
}

/** Render a value that may be plain text (escaped) or Raw HTML (kept as is). */
export function text(value) {
  return value instanceof Raw ? value.value : esc(value);
}

/** Build a tag's attribute string from an object, skipping null/undefined/false values. */
export function attrs(obj = {}) {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join("");
}

/** slugify a string into a URL-safe, lowercase, hyphenated id (for anchors). */
export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
