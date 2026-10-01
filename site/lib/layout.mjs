import { BRAND, STORE_LINKS } from "../config.mjs";
import { UI, NAV_LINKS, FOOTER_LEGAL_LINKS } from "../data/strings.mjs";
import { esc, escAttr, html } from "./html.mjs";
import { path } from "./urls.mjs";
import { headTags, jsonLd, organizationLd, websiteLd } from "./seo.mjs";

const YEAR = 2026;

function storeBadges(lang, { compact = false } = {}) {
  const t = UI[lang];
  const iosHref = STORE_LINKS.ios;
  const androidHref = STORE_LINKS.android;
  const iosLabel = iosHref ? t.getOnIOS : t.comingSoonIOS;
  const androidLabel = androidHref ? t.getOnAndroid : t.comingSoonAndroid;
  return html(
    `<div class="store-badges${compact ? " store-badges--compact" : ""}">`,
    iosHref
      ? `<a class="store-badge" href="${escAttr(iosHref)}">${esc(iosLabel)}</a>`
      : `<span class="store-badge store-badge--soon" aria-disabled="true">${esc(iosLabel)}</span>`,
    androidHref
      ? `<a class="store-badge" href="${escAttr(androidHref)}">${esc(androidLabel)}</a>`
      : `<span class="store-badge store-badge--soon" aria-disabled="true">${esc(androidLabel)}</span>`,
    `</div>`
  );
}

function header(lang, activeSlug, langSwitchSlug) {
  const t = UI[lang];
  const otherLang = lang === "ar" ? "en" : "ar";
  const brandHref = path(lang, "");
  const navHtml = NAV_LINKS.map((link) => {
    const href = path(lang, link.slug);
    const isActive = activeSlug === link.slug || (link.slug && activeSlug.startsWith(link.slug + "/"));
    return `<a href="${escAttr(href)}"${isActive ? ' aria-current="page"' : ""}>${esc(t[link.labelKey])}</a>`;
  }).join("");

  return `
<a class="skip-link" href="#main">${esc(t.skipToContent)}</a>
<header class="site-header">
  <div class="wrap site-header__inner">
    <a class="brand" href="${escAttr(brandHref)}">
      <img src="/assets/img/icons/icon-192.png" width="32" height="32" alt="" loading="eager">
      <span class="brand__ar">${esc(BRAND.nameAr)}</span>
    </a>
    <a class="login-link" href="${escAttr(lang === "en" ? "/app/?lang=en" : "/app/")}">${esc(t.logIn)}</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" id="nav-toggle">
      <span></span><span></span><span></span>
      <span class="sr-only">${lang === "ar" ? "القائمة" : "Menu"}</span>
    </button>
    <nav class="site-nav" id="site-nav" aria-label="${lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}">
      ${navHtml}
      <a class="lang-switch" href="${escAttr(path(otherLang, langSwitchSlug))}" hreflang="${otherLang}" lang="${otherLang}">${esc(t.langSwitch)}</a>
    </nav>
  </div>
</header>`;
}

function footer(lang) {
  const t = UI[lang];
  return `
<footer class="site-footer">
  <div class="wrap site-footer__inner">
    <div class="site-footer__brand">
      <span class="brand__ar">${esc(BRAND.nameAr)}</span>
      <span class="site-footer__tagline">${esc(t.footerMadeIn)}</span>
      ${storeBadges(lang, { compact: true })}
    </div>
    <div class="site-footer__cols">
      <div class="site-footer__col">
        <h3>${esc(t.features)}</h3>
        <a href="${escAttr(path(lang, "features"))}">${esc(t.allFeatures)}</a>
      </div>
      <div class="site-footer__col">
        <h3>${esc(t.businessTypes)}</h3>
        <a href="${escAttr(path(lang, "business"))}">${esc(t.allBusinessTypes)}</a>
      </div>
      <div class="site-footer__col">
        <h3>${lang === "ar" ? "الشركة" : "Company"}</h3>
        ${FOOTER_LEGAL_LINKS.map((l) => `<a href="${escAttr(path(lang, l.slug))}">${esc(t[l.labelKey])}</a>`).join("")}
      </div>
      <div class="site-footer__col">
        <h3>${lang === "ar" ? "تابعنا" : "Follow"}</h3>
        <a href="${escAttr(BRAND.instagramUrl)}">${esc(t.instagramLabel)}</a>
        <a href="${escAttr(BRAND.tiktokUrl)}">${esc(t.tiktokLabel)}</a>
        <a href="mailto:${escAttr(BRAND.email)}">${esc(t.emailLabel)}</a>
      </div>
    </div>
    <p class="site-footer__legal">${esc(t.footerRights(YEAR))}</p>
  </div>
</footer>
<script src="/assets/js/main.js" defer></script>`;
}

/**
 * Render a full HTML page.
 *
 * @param {object} p
 * @param {"ar"|"en"} p.lang
 * @param {string} p.slug           section slug (for nav "active" + canonical + hreflang)
 * @param {string} p.title
 * @param {string} p.description
 * @param {string} p.bodyHtml       full <main> inner content (already includes the h1)
 * @param {object[]} [p.jsonLd]     extra JSON-LD objects beyond Organization/WebSite
 * @param {string} [p.ogImage]
 * @param {boolean} [p.noEnglish]
 * @param {string} [p.bodyClass]
 * @param {string} [p.langSwitchSlug]  slug to use for the language switch link, when it should
 *                                      differ from `slug` (e.g. an Arabic-only blog post links to
 *                                      the English blog index instead of a nonexistent translation).
 */
export function renderPage({ lang, slug, title, description, bodyHtml, jsonLd: extraLd = [], ogImage, noEnglish, bodyClass, langSwitchSlug }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const ld = [organizationLd(), websiteLd(lang), ...extraLd].map(jsonLd).join("\n");

  // The first <script> forwards the old Cloudflare address and the www form to https://orderatweb.com,
  // keeping the path, query and hash. build.mjs hashes it into the CSP, so it can change freely.
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<script>if(location.hostname==='orderat-app.pages.dev'||location.hostname==='www.orderatweb.com')location.replace('https://orderatweb.com'+location.pathname+location.search+location.hash)</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${escAttr(BRAND.themeColor)}">
${headTags({ lang, slug, title, description, ogImage, noEnglish })}
<link rel="icon" type="image/png" href="/assets/img/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/img/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/css/style.css">
${ld}
</head>
<body class="${escAttr(bodyClass || "")}">
${header(lang, slug, langSwitchSlug ?? slug)}
<main id="main">
${slug === "" ? bodyHtml : `<div class="wrap page">
${bodyHtml}
</div>`}
</main>
${footer(lang)}
</body>
</html>
`;
}

export { storeBadges };
