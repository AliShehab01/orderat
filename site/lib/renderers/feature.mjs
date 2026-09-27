import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { FEATURES, getFeature } from "../../data/features.mjs";
import { BRAND } from "../../config.mjs";
import { esc, escAttr } from "../html.mjs";
import { path } from "../urls.mjs";
import { icon } from "../icons.mjs";
import { breadcrumbsHtml, ctaSection, sectionHeading, featureCardGrid } from "../components.mjs";
import { breadcrumbLd } from "../seo.mjs";

export function renderFeaturesIndex(lang) {
  const t = UI[lang];
  const title =
    lang === "ar" ? "كل مزايا اوردرات لتنظيم مشروعك" : "All Orderat features for organizing your business";
  const description =
    lang === "ar"
      ? "طلبات واتساب وإنستغرام، فاتورة ضريبية اختيارية، مخزون اختياري، تسجيل طلب بالذكاء الاصطناعي، رابط متجر، ربح ومصاريف، موظفين ومزامنة، واستوديو صور وحملات."
      : "WhatsApp and Instagram orders, optional VAT invoices, optional stock, AI order entry, a shop link, profit and expenses, staff and sync, and a photo studio with occasion campaigns.";

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.features, slug: "features" }])}
<h1>${esc(title)}</h1>
<p class="lead">${esc(description)}</p>
${featureCardGrid(lang, FEATURES)}
${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "features",
    title: `${title} | ${BRAND.nameAr} / ${BRAND.nameEn}`,
    description,
    bodyHtml: body,
    jsonLd: [breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.features, slug: "features" }])],
  });
}

export function renderFeaturePage(lang, slug) {
  const feature = getFeature(slug);
  if (!feature) throw new Error(`Unknown feature slug: ${slug}`);
  const t = UI[lang];
  const f = feature[lang];
  const fullSlug = `features/${slug}`;

  const related = feature.relatedSlugs.map((s) => getFeature(s)).filter(Boolean);

  const body = `
${breadcrumbsHtml(lang, [
    { name: t.breadcrumbHome, slug: "" },
    { name: t.features, slug: "features" },
    { name: f.cardTitle, slug: fullSlug },
  ])}
<article class="feature-page">
  <header class="feature-page__header">
    ${icon(feature.icon, "feature-page__icon")}
    <h1>${esc(f.h1)}</h1>
    <p class="lead">${esc(f.lead)}</p>
  </header>

  <ul class="highlight-list">
    ${f.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}
  </ul>

  ${feature.showDemoLink ? `<p class="feature-page__demo-cta"><a class="btn btn--primary" href="${escAttr(BRAND.demoShopUrl)}">${esc(t.tryDemo)}</a></p>` : ""}

  ${f.sections
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
  related.length
    ? `<section class="section related-features">
  <div class="wrap">
    ${sectionHeading(null, t.relatedFeatures)}
    ${featureCardGrid(lang, related)}
  </div>
</section>`
    : ""
}

${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: fullSlug,
    title: f.metaTitle,
    description: f.metaDescription,
    bodyHtml: body,
    jsonLd: [
      breadcrumbLd(lang, [
        { name: t.breadcrumbHome, slug: "" },
        { name: t.features, slug: "features" },
        { name: f.cardTitle, slug: fullSlug },
      ]),
    ],
    ogImage: `/assets/img/og/feature-${slug}-${lang}.jpg`,
  });
}
