import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { BUSINESS_TYPES, getBusinessType } from "../../data/business-types.mjs";
import { getFeature } from "../../data/features.mjs";
import { BRAND } from "../../config.mjs";
import { esc } from "../html.mjs";
import { icon } from "../icons.mjs";
import { breadcrumbsHtml, ctaSection, sectionHeading, businessCardGrid, featureCardGrid } from "../components.mjs";
import { breadcrumbLd } from "../seo.mjs";

export function renderBusinessIndex(lang) {
  const t = UI[lang];
  const title = lang === "ar" ? "اوردرات لكل نوع نشاط تجاري" : "Orderat for every kind of business";
  const description =
    lang === "ar"
      ? "مشروع منزلي، متجر أو محل، خدمات، مطعم أو كافيه، أو عربة طعام — شوف كيف يناسب اوردرات نشاطك بالضبط."
      : "Home business, shop, services, restaurant or café, or food truck — see how Orderat fits your business specifically.";

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.businessTypes, slug: "business" }])}
<h1>${esc(title)}</h1>
<p class="lead">${esc(description)}</p>
${businessCardGrid(lang, BUSINESS_TYPES)}
${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "business",
    title: `${title} | ${BRAND.nameAr} / ${BRAND.nameEn}`,
    description,
    bodyHtml: body,
    jsonLd: [breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.businessTypes, slug: "business" }])],
  });
}

export function renderBusinessPage(lang, slug) {
  const bt = getBusinessType(slug);
  if (!bt) throw new Error(`Unknown business type slug: ${slug}`);
  const t = UI[lang];
  const b = bt[lang];
  const fullSlug = `business/${slug}`;
  const relatedFeatures = bt.relatedFeatureSlugs.map((s) => getFeature(s)).filter(Boolean);

  const body = `
${breadcrumbsHtml(lang, [
    { name: t.breadcrumbHome, slug: "" },
    { name: t.businessTypes, slug: "business" },
    { name: b.name, slug: fullSlug },
  ])}
<article class="feature-page">
  <header class="feature-page__header">
    ${icon(bt.icon, "feature-page__icon")}
    <h1>${esc(b.h1)}</h1>
    <p class="lead">${esc(b.lead)}</p>
  </header>

  <p class="business-page__examples"><strong>${esc(b.examplesLabel)}:</strong> ${b.examples.map(esc).join("، ")}</p>

  <section class="feature-page__section">
    <h2>${lang === "ar" ? "المشاكل اللي تواجهها" : "The problems you run into"}</h2>
    <ul class="highlight-list">
      ${b.painPoints.map((p) => `<li>${esc(p)}</li>`).join("")}
    </ul>
  </section>

  ${b.howItHelps
    .map(
      (s) => `
  <section class="feature-page__section">
    <h2>${esc(s.heading)}</h2>
    <p>${esc(s.body)}</p>
  </section>`
    )
    .join("")}
</article>

${
  relatedFeatures.length
    ? `<section class="section related-features">
  <div class="wrap">
    ${sectionHeading(null, t.relatedFeatures)}
    ${featureCardGrid(lang, relatedFeatures)}
  </div>
</section>`
    : ""
}

${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: fullSlug,
    title: b.metaTitle,
    description: b.metaDescription,
    bodyHtml: body,
    jsonLd: [
      breadcrumbLd(lang, [
        { name: t.breadcrumbHome, slug: "" },
        { name: t.businessTypes, slug: "business" },
        { name: b.name, slug: fullSlug },
      ]),
    ],
  });
}
