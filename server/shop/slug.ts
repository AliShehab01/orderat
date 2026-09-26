// Shop slug rules (docs/marketing-tools.md's "C. Shop link" > "Publish rules"). A slug becomes part
// of the shop's public URL (https://.../s/?<slug>), so its format is checked strictly: lowercase
// letters/digits with interior hyphens only, 3-30 characters — and it can never be one of a fixed
// reserved list that would collide with the site's own paths or read as an official/ambiguous name.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** The exact list from docs/marketing-tools.md, plus "demo" and "test": the shop page's own
 * built-in offline sample shop is reached with `?demo`, so a real seller must never be able to claim
 * or shadow that slug (or the equally-generic "test"). */
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "help", "orderat", "s", "shop", "shops", "store", "support", "www",
  "demo", "test",
]);

export function isValidSlugFormat(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/** True when `slug` is well-formed and not reserved. Never checks the database — a slug already
 * taken by another shop is a separate, DB-dependent check (server/shop/handler.ts, against
 * orderat.shops), kept out of this pure function on purpose. */
export function isAcceptableSlug(slug: unknown): slug is string {
  return isValidSlugFormat(slug) && !isReservedSlug(slug);
}
