#!/usr/bin/env node
// One-off tool: renders the Open Graph images (1200x630) for the home page and each feature
// page, from a single branded HTML template, using puppeteer-core + a system Chrome install.
// This is NOT part of `site:build` on purpose (see the site build report): `site:build` has zero
// npm dependencies so it never needs `npm install`, while OG images are pre-generated PNGs
// committed under site/src/assets/img/og/ and just copied at build time.
//
// Usage:
//   node site/tools/generate-og-images.mjs
//
// Requires:
//   - A Chrome/Chromium executable. Set CHROME_PATH, or it falls back to the common Windows
//     install path (C:/Program Files/Google/Chrome/Application/chrome.exe).
//   - puppeteer-core, resolved normally (if you `npm install puppeteer-core` in this project or a
//     parent node_modules), or from an external checkout via PUPPETEER_NODE_MODULES=<path to a
//     folder containing a node_modules/puppeteer-core install>.
//   - Network access, to load the IBM Plex Sans Arabic font from Google Fonts for correct
//     Arabic shaping. Re-run any time to regenerate.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.dirname(__dirname);
const OUT_DIR = path.join(SITE_DIR, "src", "assets", "img", "og");
const ICON_PATH = path.join(SITE_DIR, "src", "assets", "img", "icons", "icon-512.png");

const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    const external = process.env.PUPPETEER_NODE_MODULES;
    if (!external) {
      throw new Error(
        "puppeteer-core not found. Either `npm install puppeteer-core` in this project, or set " +
          "PUPPETEER_NODE_MODULES to a directory whose node_modules/puppeteer-core you want to reuse."
      );
    }
    const req = createRequire(path.join(external, "noop.js"));
    return req("puppeteer-core");
  }
}

const { FEATURES } = await import("../data/features.mjs");
const { BRAND } = await import("../config.mjs");

const iconDataUri = `data:image/png;base64,${fs.readFileSync(ICON_PATH).toString("base64")}`;

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function templateHtml({ lang, title, subtitle }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const font = lang === "ar" ? "'IBM Plex Sans Arabic', sans-serif" : "'IBM Plex Sans', sans-serif";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@500;700&family=IBM+Plex+Sans:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: linear-gradient(135deg, #4a5fdc, #2f3fb0);
    font-family: ${font};
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 64px; color: #fff; direction: ${dir};
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand img { width: 56px; height: 56px; border-radius: 14px; }
  .brand span { font-size: 28px; font-weight: 700; }
  h1 { font-size: 60px; font-weight: 700; line-height: 1.25; max-width: 980px; }
  .subtitle { font-size: 26px; font-weight: 500; opacity: 0.92; max-width: 900px; }
</style>
</head>
<body>
  <div class="brand"><img src="${iconDataUri}" alt=""><span>${escapeHtml(BRAND.nameAr)} / ${escapeHtml(BRAND.nameEn)}</span></div>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
</body>
</html>`;
}

function buildTargets() {
  const targets = [];
  targets.push({
    name: "home-ar",
    lang: "ar",
    title: "طلبات واضحة. يوم أهدأ.",
    subtitle: "اوردرات يجمع طلبات واتساب وإنستغرام في مكان واحد، ويحسب لك ربحك الحقيقي.",
  });
  targets.push({
    name: "home-en",
    lang: "en",
    title: "Orders clear. Day calm.",
    subtitle: "Orderat brings your WhatsApp and Instagram orders into one place, and works out your real profit.",
  });
  for (const f of FEATURES) {
    targets.push({ name: `feature-${f.slug}-ar`, lang: "ar", title: f.ar.h1, subtitle: f.ar.cardBody });
    targets.push({ name: `feature-${f.slug}-en`, lang: "en", title: f.en.h1, subtitle: f.en.cardBody });
  }
  return targets;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const puppeteer = await loadPuppeteer();
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}. Set CHROME_PATH to your Chrome/Chromium executable.`);
  }

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });

  const targets = buildTargets();
  for (const t of targets) {
    const html = templateHtml(t);
    const tmpFile = path.join(OUT_DIR, `_tmp-${t.name}.html`);
    fs.writeFileSync(tmpFile, html, "utf8");
    await page.goto(`file://${tmpFile.replace(/\\/g, "/")}`, { waitUntil: "networkidle0", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 200)); // let web font swap settle
    // JPEG (no transparency needed) keeps these small — PNG ran ~190KB each, JPEG ~40-60KB.
    await page.screenshot({ path: path.join(OUT_DIR, `${t.name}.jpg`), type: "jpeg", quality: 87 });
    fs.unlinkSync(tmpFile);
    console.log(`  generated ${t.name}.jpg`);
  }

  await browser.close();
  console.log(`Done. ${targets.length} OG images written to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
