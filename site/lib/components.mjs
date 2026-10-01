import { BRAND } from "../config.mjs";
import { UI } from "../data/strings.mjs";
import { HIGHLIGHTS, HIGHLIGHT_BUSINESS_TYPES } from "../data/highlights.mjs";
import { esc, escAttr, html } from "./html.mjs";
import { path } from "./urls.mjs";
import { icon } from "./icons.mjs";
import { storeBadges } from "./layout.mjs";

/**
 * The gently moving strip of facts under the home hero, in pure CSS (style.css "Trust strip"): two
 * copies of the list slide by one copy's width and loop, the copy aria-hidden. Hover pauses it, and so
 * does the visually hidden checkbox (labelled by the round toggle at the strip's end) for keyboard and
 * touch users; prefers-reduced-motion shows the one list, still and wrapped.
 */
export function trustStrip(lang) {
  const copy = lang === "ar" ? { title: "اوردرات باختصار", pause: "إيقاف حركة الشريط" } : { title: "Orderat at a glance", pause: "Pause the moving strip" };
  const chips = [
    ...HIGHLIGHTS.map((h) => `<li class="trust__chip">${icon(h.icon)}${esc(h[lang])}</li>`),
    ...HIGHLIGHT_BUSINESS_TYPES.map((b) => `<li class="trust__chip trust__chip--type">${icon(b.icon)}${esc(b[lang])}</li>`),
  ].join("");
  return `
<section class="trust">
  <h2 class="sr-only">${esc(copy.title)}</h2>
  <input class="trust__pause sr-only" type="checkbox" id="trust-pause">
  <div class="marquee">
    <ul class="marquee__group">${chips}</ul>
    <ul class="marquee__group" aria-hidden="true">${chips}</ul>
  </div>
  <label class="trust__toggle" for="trust-pause">${icon("pause", "icon--pause")}${icon("play", "icon--play")}<span class="sr-only">${esc(copy.pause)}</span></label>
</section>`;
}

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
    <a class="link-more" href="${escAttr(path(lang, "faq"))}">${esc(t.faqTeaserCta)} ${lang === "ar" ? "←" : "→"}</a>
  </div>
</section>`;
}

/** Numbered step cards (data/steps.mjs), each with a time chip; the number is part of the heading. */
export function stepsList(lang, steps) {
  const timeLabel = lang === "ar" ? "المدة: " : "Time: ";
  return `<ol class="steps" role="list">${steps
    .map(
      (s, i) => `
    <li class="step">
      <h3 class="step__title"><span class="step__num">${i + 1}</span> <span>${esc(s[lang].title)}</span></h3>
      <p>${esc(s[lang].body)}</p>
      ${s.showStoreBadges ? storeBadges(lang, { compact: true }) : ""}
      <p class="step__time">${icon("clock")}<span class="sr-only">${timeLabel}</span>${esc(s.time[lang])}</p>
    </li>`
    )
    .join("")}</ol>`;
}

/** A row of short facts: a big value over a small label each (data/steps.mjs START_STATS). */
export function statsRow(lang, stats) {
  return `<ul class="stats" role="list">${stats
    .map((s) => `<li class="stats__item"><strong class="stats__value">${esc(s.value[lang])}</strong> <span class="stats__label">${esc(s.label[lang])}</span></li>`)
    .join("")}</ul>`;
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
