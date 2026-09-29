#!/usr/bin/env node
// Builds the Orderat marketing site to static HTML in site/dist/.
// Zero npm dependencies on purpose — only Node built-ins — so `npm run site:build` never needs
// `npm install` to run. See the site build report for how to preview the output locally.
//
// Usage: node site/build.mjs   (or: npm run site:build)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_URL, BRAND } from "./config.mjs";
import { absUrl, outFile } from "./lib/urls.mjs";
import { renderHome } from "./lib/renderers/home.mjs";
import { renderFeaturesIndex, renderFeaturePage } from "./lib/renderers/feature.mjs";
import { renderBusinessIndex, renderBusinessPage } from "./lib/renderers/business.mjs";
import { renderPricing } from "./lib/renderers/pricing.mjs";
import { renderFaqPage } from "./lib/renderers/faq.mjs";
import { renderPrivacyPage, renderTermsPage } from "./lib/renderers/legal.mjs";
import { renderContactPage } from "./lib/renderers/contact.mjs";
import { renderBlogIndex, renderBlogPost } from "./lib/renderers/blog.mjs";
import { FEATURES } from "./data/features.mjs";
import { BUSINESS_TYPES } from "./data/business-types.mjs";
import { BLOG_POSTS } from "./data/blog-posts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const SRC_ASSETS = path.join(__dirname, "src", "assets");
// The public shop page (orderat-shop's links point at SITE_URL/s/?<slug>) and the data-deletion page
// the Meta app and store listings link to live in public/orderat/ and ship with the site as they are.
const PUBLIC_ORDERAT = path.join(__dirname, "..", "public", "orderat");
const PUBLIC_PAGES = ["data-deletion.html", "legal.css", "favicon.svg"];
// The web app (the demo and, after signing in, the seller's cloud shop) is served from /app/.
const WEB_APP_FILES = [
  "index.html", "app.js", "app.css", "i18n.js", "demo.js", "config.js", "cloud-map.js", "cloud-api.js", "cloud-sync.js",
  "cloud-auth.js", "live-core.js", "live.js", "sw.js", "manifest.webmanifest", "favicon.svg", "icon-192.png", "icon-512.png",
  "apple-touch-icon.png",
];
const LANGS = ["ar", "en"];
const BUILD_DATE = new Date().toISOString().slice(0, 10);

function buildPageList() {
  const pages = [];
  for (const lang of LANGS) {
    pages.push({ lang, slug: "", html: renderHome(lang) });
    pages.push({ lang, slug: "features", html: renderFeaturesIndex(lang) });
    for (const f of FEATURES) pages.push({ lang, slug: `features/${f.slug}`, html: renderFeaturePage(lang, f.slug) });
    pages.push({ lang, slug: "business", html: renderBusinessIndex(lang) });
    for (const b of BUSINESS_TYPES) pages.push({ lang, slug: `business/${b.slug}`, html: renderBusinessPage(lang, b.slug) });
    pages.push({ lang, slug: "pricing", html: renderPricing(lang) });
    pages.push({ lang, slug: "faq", html: renderFaqPage(lang) });
    pages.push({ lang, slug: "privacy", html: renderPrivacyPage(lang) });
    pages.push({ lang, slug: "terms", html: renderTermsPage(lang) });
    pages.push({ lang, slug: "contact", html: renderContactPage(lang) });
    pages.push({ lang, slug: "blog", html: renderBlogIndex(lang) });
  }
  // Blog posts are Arabic-only for now (see the build report for the English-translation plan).
  for (const post of BLOG_POSTS) {
    pages.push({ lang: "ar", slug: `blog/${post.slug}`, html: renderBlogPost(post.slug), noEnglish: true });
  }
  return pages;
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writePage(page) {
  const file = path.join(DIST, outFile(page.lang, page.slug));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page.html, "utf8");
  return file;
}

function buildSitemap(pages) {
  const urls = pages
    .map((p) => {
      const loc = absUrl(p.lang, p.slug);
      const alternates = [
        `    <xhtml:link rel="alternate" hreflang="ar" href="${absUrl("ar", p.slug)}"/>`,
        !p.noEnglish ? `    <xhtml:link rel="alternate" hreflang="en" href="${absUrl("en", p.slug)}"/>` : "",
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${absUrl("ar", p.slug)}"/>`,
      ]
        .filter(Boolean)
        .join("\n");
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n${alternates}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

function buildRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL.replace(/\/+$/, "")}/sitemap.xml\n`;
}

function buildManifest() {
  const manifest = {
    name: `${BRAND.nameAr} | ${BRAND.nameEn}`,
    short_name: BRAND.nameEn,
    description: BRAND.tagline.ar,
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ar",
    dir: "rtl",
    background_color: "#f4f6ff",
    theme_color: BRAND.themeColor,
    icons: [
      { src: "/assets/img/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/assets/img/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

// Cloudflare Pages serves 404.html for unknown paths; without one it treats the site as a single-page app
// and answers every unknown path (/app/typos too) with the home page.
function buildNotFound() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${BRAND.themeColor}">
<title>الصفحة غير موجودة | Page not found · ${BRAND.nameEn}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{color-scheme:light dark;--bg:#f4f6ff;--fg:#1b1f3b;--muted:#5b6180;--accent:${BRAND.themeColor}}
@media (prefers-color-scheme:dark){:root{--bg:#10132a;--fg:#eef0ff;--muted:#a3a8c7;--accent:#8e9cff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,"Segoe UI",Tahoma,sans-serif;padding:16px}
main{max-width:28rem;text-align:center}h1{font-size:1.5rem;margin:.2em 0}p{color:var(--muted)}a{color:var(--accent);font-weight:600}
</style>
</head>
<body>
<main>
<h1>الصفحة غير موجودة</h1>
<p>الرابط غير صحيح أو الصفحة انتقلت.</p>
<p><a href="/">الصفحة الرئيسية</a> · <a href="/app/">افتح التطبيق</a></p>
<p lang="en" dir="ltr">Page not found. <a href="/en/">Home</a> · <a href="/app/?lang=en">Open the app</a></p>
</main>
</body>
</html>
`;
}

function main() {
  console.log("Building Orderat marketing site...");
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  const pages = buildPageList();
  for (const page of pages) writePage(page);
  console.log(`  wrote ${pages.length} pages`);

  const assetsDest = path.join(DIST, "assets");
  if (fs.existsSync(SRC_ASSETS)) {
    copyDir(SRC_ASSETS, assetsDest);
    console.log(`  copied static assets from ${path.relative(__dirname, SRC_ASSETS)}`);
  }

  copyDir(path.join(PUBLIC_ORDERAT, "s"), path.join(DIST, "s"));
  for (const file of PUBLIC_PAGES) fs.copyFileSync(path.join(PUBLIC_ORDERAT, file), path.join(DIST, file));
  console.log("  copied the shop page (s/) and the data-deletion page from public/orderat");

  const appDest = path.join(DIST, "app");
  fs.mkdirSync(appDest, { recursive: true });
  for (const file of WEB_APP_FILES) fs.copyFileSync(path.join(PUBLIC_ORDERAT, file), path.join(appDest, file));
  copyDir(path.join(PUBLIC_ORDERAT, "vendor"), path.join(appDest, "vendor"));
  console.log("  copied the web app to app/");

  fs.writeFileSync(path.join(DIST, "sitemap.xml"), buildSitemap(pages), "utf8");
  fs.writeFileSync(path.join(DIST, "robots.txt"), buildRobots(), "utf8");
  fs.writeFileSync(path.join(DIST, "site.webmanifest"), buildManifest(), "utf8");
  fs.writeFileSync(path.join(DIST, "404.html"), buildNotFound(), "utf8");
  console.log("  wrote sitemap.xml, robots.txt, site.webmanifest, 404.html");

  console.log(`Done. Output: ${path.relative(process.cwd(), DIST) || DIST}`);
}

main();
