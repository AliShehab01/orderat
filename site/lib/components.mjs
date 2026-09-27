import { BRAND } from "../config.mjs";
import { UI } from "../data/strings.mjs";
import { esc, escAttr, html } from "./html.mjs";
import { path } from "./urls.mjs";
import { icon } from "./icons.mjs";
import { storeBadges } from "./layout.mjs";

/** Visual breadcrumb trail. crumbs: [{ name, slug }], first entry is Home. */
export function breadcrumbsHtml(lang, crumbs) {
  const items = crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      const label = i === 0 ? UI[lang].breadcrumbHome : c.name;
      return isLast
        ? `<span aria-current="page">${esc(c.name)}</span>`
        : `<a href="${escAttr(path(lang, c.slug))}">${esc(label)}</a>`;
    })
    .join('<span class="crumb-sep" aria-hidden="true">/</span>');
  return `<nav class="breadcrumbs" aria-label="${lang === "ar" ? "مسار التنقل" : "Breadcrumb"}">${items}</nav>`;
}

export function ctaSection(lang) {
  const t = UI[lang];
  return `
<section class="cta-band">
  <div class="wrap cta-band__inner">
    <h2>${esc(t.ctaSectionTitle)}</h2>
    <p>${esc(t.ctaSectionBody)}</p>
    <div class="cta-band__actions">
      ${storeBadges(lang)}
      <a class="btn btn--ghost-light" href="${escAttr(BRAND.demoShopUrl)}">${esc(t.tryDemo)}</a>
    </div>
  </div>
</section>`;
}

export function faqAccordion(lang, faqs) {
  return `<div class="faq-list">${faqs
    .map(
      (f, i) => `
    <details class="faq-item"${i === 0 ? " open" : ""}>
      <summary>${esc(f[lang].q)}</summary>
      <div class="faq-item__a">${wrapParagraphs(f[lang].a)}</div>
    </details>`
    )
    .join("")}</div>`;
}

function wrapParagraphs(text) {
  return String(text)
    .split("\n\n")
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

export function faqTeaser(lang, faqs) {
  const t = UI[lang];
  return `
<section class="section faq-teaser">
  <div class="wrap">
    <h2>${esc(t.faqTeaserTitle)}</h2>
    ${faqAccordion(lang, faqs.slice(0, 4))}
    <a class="link-more" href="${escAttr(path(lang, "faq"))}">${esc(t.faqTeaserCta)} ←</a>
  </div>
</section>`;
}

export function stepsList(lang, steps) {
  return `<ol class="steps">${steps
    .map(
      (s, i) => `
    <li class="steps__item">
      <span class="steps__num">${i + 1}</span>
      <h3>${esc(s[lang].title)}</h3>
      <p>${esc(s[lang].body)}</p>
    </li>`
    )
    .join("")}</ol>`;
}

/** Card grid linking to feature pages. `items` are entries from data/features.mjs. */
export function featureCardGrid(lang, items) {
  return `<div class="card-grid">${items
    .map(
      (f) => `
    <a class="feature-card" href="${escAttr(path(lang, `features/${f.slug}`))}">
      ${icon(f.icon, "feature-card__icon")}
      <h3>${esc(f[lang].cardTitle)}</h3>
      <p>${esc(f[lang].cardBody)}</p>
    </a>`
    )
    .join("")}</div>`;
}

/** Card grid linking to business-type pages. */
export function businessCardGrid(lang, items) {
  return `<div class="card-grid card-grid--business">${items
    .map(
      (b) => `
    <a class="feature-card" href="${escAttr(path(lang, `business/${b.slug}`))}">
      ${icon(b.icon, "feature-card__icon")}
      <h3>${esc(b[lang].name)}</h3>
      <p>${esc(b[lang].blurb)}</p>
    </a>`
    )
    .join("")}</div>`;
}

export function sectionHeading(kicker, title, lead) {
  return `
  <div class="section-heading">
    ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}
    <h2>${esc(title)}</h2>
    ${lead ? `<p class="section-lead">${esc(lead)}</p>` : ""}
  </div>`;
}
