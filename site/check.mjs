#!/usr/bin/env node
// Verifies the built site in site/dist/. Run `node site/build.mjs` first (or `npm run site:check`,
// which does both). Zero npm dependencies, like build.mjs.
//
// Checks:
//   - every page has <title>, meta description, canonical link, and hreflang alternates
//   - every page has exactly one <h1>, a lang+dir on <html>, and every <img> has an alt attribute
//   - every JSON-LD block (<script type="application/ld+json">) parses as JSON
//   - every internal link/asset reference (href="/...", src="/...", or an absolute SITE_URL link)
//     resolves to a real file in dist/
//   - sitemap.xml lists every page that was built, with no stale entries
//   - robots.txt references the sitemap, and site.webmanifest is valid JSON with icons
//   - dist/app/ (the web app) and 404.html exist
//   - _headers sends HSTS (a year or more), and its CSP script-src allows every inline <script> by hash

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const SITE_ORIGIN = SITE_URL.replace(/\/+$/, "");

let errors = [];
let pagesChecked = 0;
const titlesSeen = new Map(); // title -> [urls], to catch accidental duplicates
const descriptionsSeen = new Map();

function fail(where, message) {
  errors.push(`${where}: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Converts an on-disk dist file to the directory-style URL path the site actually serves it at,
// matching lib/urls.js's path(): dist/index.html -> "/", dist/blog/index.html -> "/blog/".
function toUrlPath(distFile) {
  const rel = path.relative(DIST, distFile).replace(/\\/g, "/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel;
}

function existsAsDistTarget(urlPath) {
  // urlPath is root-relative, e.g. "/features/stock/" or "/assets/img/og/home-ar.jpg".
  const clean = urlPath.split("#")[0].split("?")[0];
  if (clean.endsWith("/")) {
    return fs.existsSync(path.join(DIST, clean, "index.html"));
  }
  return fs.existsSync(path.join(DIST, clean));
}

function checkPage(file) {
  const html = fs.readFileSync(file, "utf8");
  const url = toUrlPath(file);
  pagesChecked++;

  const htmlTagMatch = html.match(/<html\s+lang="([^"]*)"\s+dir="([^"]*)"/);
  if (!htmlTagMatch) fail(url, "missing <html lang=\"...\" dir=\"...\"> attributes");
  else if (!["ar", "en"].includes(htmlTagMatch[1])) fail(url, `unexpected lang="${htmlTagMatch[1]}"`);

  const title = html.match(/<title>([^<]*)<\/title>/);
  if (!title || !title[1].trim()) fail(url, "missing or empty <title>");
  else {
    if (!titlesSeen.has(title[1])) titlesSeen.set(title[1], []);
    titlesSeen.get(title[1]).push(url);
  }

  const description = html.match(/<meta name="description" content="([^"]*)"/);
  if (!description || !description[1].trim()) fail(url, "missing or empty meta description");
  else {
    if (!descriptionsSeen.has(description[1])) descriptionsSeen.set(description[1], []);
    descriptionsSeen.get(description[1]).push(url);
  }

  const canonical = html.match(/<link rel="canonical" href="([^"]*)">/);
  if (!canonical) fail(url, "missing canonical link");
  else if (!canonical[1].startsWith(SITE_ORIGIN)) fail(url, `canonical does not start with SITE_URL: ${canonical[1]}`);

  const hreflangs = [...html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)];
  const langsFound = hreflangs.map((m) => m[1]);
  if (!langsFound.includes("x-default")) fail(url, "missing hreflang x-default");
  if (!langsFound.includes("ar")) fail(url, "missing hreflang ar");
  const isArabicOnlyBlogPost = /^\/blog\/[^/]+\/$/.test(url);
  if (!isArabicOnlyBlogPost && !langsFound.includes("en")) fail(url, "missing hreflang en (expected an English mirror)");

  const h1s = html.match(/<h1[ >]/g) || [];
  if (h1s.length !== 1) fail(url, `expected exactly one <h1>, found ${h1s.length}`);

  // og:image / twitter:image / apple-touch-icon / manifest / stylesheet / script / img src.
  const assetRefs = [
    ...[...html.matchAll(/<meta property="og:image" content="([^"]*)">/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest|stylesheet)" href="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<script src="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]),
  ];
  for (const ref of assetRefs) {
    if (/^https?:\/\/fonts\./.test(ref)) continue; // Google Fonts, external by design.
    const rootRelative = ref.startsWith(SITE_ORIGIN) ? ref.slice(SITE_ORIGIN.length) : ref;
    if (!rootRelative.startsWith("/")) continue; // some other external URL — not ours to check.
    if (!existsAsDistTarget(rootRelative)) fail(url, `broken asset reference: ${ref}`);
  }

  // Every <img> needs an alt attribute (can be empty for decorative images, but must be present).
  const imgTags = html.match(/<img\s[^>]*>/g) || [];
  for (const tag of imgTags) {
    if (!/\salt="/.test(tag)) fail(url, `<img> missing alt attribute: ${tag.slice(0, 80)}`);
  }

  // Internal navigational links: href="/..." (skip mailto:, http(s):, #anchors handled by the / check).
  const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (href.startsWith("mailto:") || href.startsWith("#")) continue;
    const rootRelative = href.startsWith(SITE_ORIGIN) ? href.slice(SITE_ORIGIN.length) || "/" : href;
    if (!rootRelative.startsWith("/")) continue; // external (instagram/tiktok/demo shop/fonts/...) — not ours to check.
    if (!existsAsDistTarget(rootRelative)) fail(url, `broken internal link: ${href}`);
  }

  // JSON-LD blocks must parse.
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (ldBlocks.length === 0) fail(url, "no JSON-LD blocks found (expected at least Organization + WebSite)");
  for (const [, json] of ldBlocks) {
    try {
      JSON.parse(json);
    } catch (e) {
      fail(url, `JSON-LD does not parse: ${e.message}`);
    }
  }
}

function checkSitemap(allPageUrls) {
  const file = path.join(DIST, "sitemap.xml");
  if (!fs.existsSync(file)) return fail("sitemap.xml", "file missing");
  const xml = fs.readFileSync(file, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

  for (const pageUrl of allPageUrls) {
    const abs = SITE_ORIGIN + pageUrl;
    if (!locs.includes(abs)) fail("sitemap.xml", `missing entry for ${abs}`);
  }
  for (const loc of locs) {
    const rel = loc.startsWith(SITE_ORIGIN) ? loc.slice(SITE_ORIGIN.length) : loc;
    if (!allPageUrls.includes(rel)) fail("sitemap.xml", `stale entry, no longer a built page: ${loc}`);
  }

  // Every <loc> must be well-formed XML text (matchAll already required a clean <loc>...</loc>,
  // so just sanity-check the count and that the file declares the sitemap namespace).
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    fail("sitemap.xml", "missing sitemap namespace declaration");
  }
}

function checkUniqueness() {
  for (const [title, urls] of titlesSeen) {
    if (urls.length > 1) fail("uniqueness", `title "${title}" reused on ${urls.length} pages: ${urls.join(", ")}`);
  }
  for (const [desc, urls] of descriptionsSeen) {
    if (urls.length > 1) fail("uniqueness", `meta description reused on ${urls.length} pages: ${urls.join(", ")}`);
  }
}

function checkRobots() {
  const file = path.join(DIST, "robots.txt");
  if (!fs.existsSync(file)) return fail("robots.txt", "file missing");
  const txt = fs.readFileSync(file, "utf8");
  if (!/^Sitemap: /m.test(txt)) fail("robots.txt", "missing Sitemap: line");
  if (!txt.includes(SITE_ORIGIN)) fail("robots.txt", "Sitemap line does not reference SITE_URL");
}

function checkManifest() {
  const file = path.join(DIST, "site.webmanifest");
  if (!fs.existsSync(file)) return fail("site.webmanifest", "file missing");
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!manifest.name) fail("site.webmanifest", "missing name");
    if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) fail("site.webmanifest", "missing icons");
    for (const icon of manifest.icons || []) {
      if (!existsAsDistTarget(icon.src)) fail("site.webmanifest", `icon file missing: ${icon.src}`);
    }
  } catch (e) {
    fail("site.webmanifest", `does not parse as JSON: ${e.message}`);
  }
}

function checkHeaders() {
  const file = path.join(DIST, "_headers");
  if (!fs.existsSync(file)) return fail("_headers", "file missing");
  const txt = fs.readFileSync(file, "utf8");
  const hsts = txt.match(/^\s+Strict-Transport-Security: max-age=(\d+)/m);
  if (!hsts || Number(hsts[1]) < 31536000) fail("_headers", "missing Strict-Transport-Security with a max-age of at least a year");
  const csp = txt.match(/^\s+Content-Security-Policy: (.+)$/m);
  if (!csp) return fail("_headers", "missing Content-Security-Policy");
  const scriptSrc = (csp[1].split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) || "").split(/\s+/);
  // Same rule as build.mjs's inlineScriptHashes(): every inline, executable <script> in any HTML file.
  for (const htmlFile of walk(DIST).filter((f) => f.endsWith(".html"))) {
    for (const m of fs.readFileSync(htmlFile, "utf8").matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1] || "";
      if (/\bsrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs) || !m[2]) continue;
      const hash = `'sha256-${crypto.createHash("sha256").update(m[2], "utf8").digest("base64")}'`;
      if (!scriptSrc.includes(hash)) fail(toUrlPath(htmlFile), `inline <script> is not in the CSP script-src (${hash})`);
    }
  }
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error("site/dist does not exist. Run `node site/build.mjs` first.");
    process.exit(1);
  }

  // dist/s/ is the public shop page copied from public/orderat/s and dist/app/ is the web app (both
  // from build.mjs): app pages, not marketing pages, so the SEO checks don't apply to them.
  const appDirs = [path.join(DIST, "s") + path.sep, path.join(DIST, "app") + path.sep];
  if (!fs.existsSync(path.join(DIST, "app", "index.html"))) fail("app/", "the web app was not copied to dist/app/");
  // Without a 404.html Cloudflare Pages answers every unknown path with the home page.
  if (!fs.existsSync(path.join(DIST, "404.html"))) fail("404.html", "file missing");
  const pageFiles = walk(DIST).filter((f) => f.endsWith("index.html") && !appDirs.some((dir) => f.startsWith(dir)));
  const allPageUrls = pageFiles.map(toUrlPath);
  for (const file of pageFiles) checkPage(file);

  checkUniqueness();
  checkSitemap(allPageUrls);
  checkRobots();
  checkManifest();
  checkHeaders();

  if (errors.length) {
    console.error(`FAILED — ${errors.length} problem(s) across ${pagesChecked} page(s):\n`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  console.log(`OK — ${pagesChecked} pages checked, sitemap/robots/manifest/_headers valid, 0 problems.`);
}

main();
