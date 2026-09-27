import { SITE_URL } from "../config.mjs";

/**
 * Build a site-relative path for a given language and slug.
 * slug "" (or omitted) means the section index. No trailing slash is added beyond the one
 * directory-style slash, matching the on-disk "<path>/index.html" layout.
 *
 * path("ar", "")                 -> "/"
 * path("en", "")                 -> "/en/"
 * path("ar", "pricing")          -> "/pricing/"
 * path("en", "pricing")          -> "/en/pricing/"
 * path("ar", "blog/some-post")   -> "/blog/some-post/"
 */
export function path(lang, slug = "") {
  const clean = String(slug).replace(/^\/+|\/+$/g, "");
  const base = lang === "en" ? "/en" : "";
  if (!clean) return `${base}/` || "/";
  return `${base}/${clean}/`;
}

/** Absolute URL (with SITE_URL) for a given language and slug. */
export function absUrl(lang, slug = "") {
  return SITE_URL.replace(/\/+$/, "") + path(lang, slug);
}

/** The on-disk output file for a given language and slug, relative to the dist directory. */
export function outFile(lang, slug = "") {
  return path(lang, slug).replace(/^\//, "") + "index.html";
}
