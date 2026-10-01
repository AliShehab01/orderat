import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { BLOG_POSTS, getBlogPost, readingMinutes } from "../../data/blog-posts.mjs";
import { BLOG_EN_GLOSS } from "../../data/blog-en-gloss.mjs";
import { getFeature } from "../../data/features.mjs";
import { esc, escAttr } from "../html.mjs";
import { path } from "../urls.mjs";
import { formatDate } from "../date.mjs";
import { breadcrumbsHtml, ctaSection, sectionHeading, featureCardGrid } from "../components.mjs";
import { breadcrumbLd, articleLd } from "../seo.mjs";

const COPY = {
  ar: {
    metaTitle: "مدونة اوردرات: نصائح لأصحاب الأعمال الصغيرة | اوردرات",
    metaDescription: "مقالات عملية لأصحاب المشاريع الصغيرة: تسعير، تصوير، تسويق، تنظيم طلبات واتساب، وإدارة الأموال.",
    h1: "مدونة اوردرات",
    lead: "نصائح عملية لأصحاب المشاريع الصغيرة في البحرين والخليج العربي، من تنظيم الطلبات إلى التسعير والتسويق.",
    arabicBadge: null,
  },
  en: {
    metaTitle: "Orderat Blog: tips for small business owners | Orderat",
    metaDescription: "Practical articles for small business owners: pricing, photography, marketing, WhatsApp orders, and money management.",
    h1: "Orderat Blog",
    lead: "Practical tips for small business owners in Bahrain and the Arabian Gulf — from organizing orders to pricing and marketing.",
    arabicNote: "This blog is written in Arabic first. English articles are coming soon — for now, each link opens the Arabic version.",
    arabicBadge: "AR",
  },
};

export function renderBlogIndex(lang) {
  const t = UI[lang];
  const c = COPY[lang];

  const cards = BLOG_POSTS.map((post) => {
    const title = lang === "ar" ? post.ar.title : BLOG_EN_GLOSS[post.slug].title;
    const excerpt = lang === "ar" ? post.ar.excerpt : BLOG_EN_GLOSS[post.slug].excerpt;
    // English index links straight to the (Arabic-only) article at /blog/<slug>/.
    const href = path("ar", `blog/${post.slug}`);
    return `
    <a class="blog-card" href="${escAttr(href)}"${lang === "en" ? ' hreflang="ar"' : ""}>
      <p class="blog-card__meta">${esc(formatDate(post.dateISO, lang))} · ${esc(t.minRead(readingMinutes(post)))}${
      c.arabicBadge ? ` · <span class="blog-card__badge">${esc(c.arabicBadge)}</span>` : ""
    }</p>
      <h2>${esc(title)}</h2>
      <p>${esc(excerpt)}</p>
    </a>`;
  }).join("");

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.blog, slug: "blog" }])}
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
${lang === "en" ? `<p class="notice">${esc(c.arabicNote)}</p>` : ""}
<div class="blog-grid">${cards}</div>
${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "blog",
    title: c.metaTitle,
    description: c.metaDescription,
    bodyHtml: body,
    jsonLd: [breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.blog, slug: "blog" }])],
  });
}

export function renderBlogPost(slug) {
  const post = getBlogPost(slug);
  if (!post) throw new Error(`Unknown blog post slug: ${slug}`);
  const lang = "ar"; // blog posts are Arabic-only for now
  const t = UI[lang];
  const a = post.ar;
  const fullSlug = `blog/${slug}`;
  const minutes = readingMinutes(post);
  const related = post.relatedFeatureSlug ? getFeature(post.relatedFeatureSlug) : null;

  const articleHtml = a.sections
    .map((s) => {
      const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
      return s.heading ? `<section><h2>${esc(s.heading)}</h2>${paras}</section>` : `<section>${paras}</section>`;
    })
    .join("");

  const body = `
${breadcrumbsHtml(lang, [
    { name: t.breadcrumbHome, slug: "" },
    { name: t.blog, slug: "blog" },
    { name: a.title, slug: fullSlug },
  ])}
<article class="blog-post">
  <header class="blog-post__header">
    <h1>${esc(a.title)}</h1>
    <p class="blog-post__meta">${esc(t.publishedOn)}: ${esc(formatDate(post.dateISO, lang))} · ${esc(t.minRead(minutes))}</p>
  </header>
  <div class="blog-post__body">
    ${articleHtml}
  </div>
  <p class="blog-post__back"><a href="${escAttr(path(lang, "blog"))}">${lang === "ar" ? "→" : "←"} ${esc(t.backToBlog)}</a></p>
</article>

${
  related
    ? `<section class="section related-features">
  <div class="wrap">
    ${sectionHeading(null, t.relatedFeatures)}
    ${featureCardGrid(lang, [related])}
  </div>
</section>`
    : ""
}

${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: fullSlug,
    title: `${a.title} | ${t.blog}`,
    description: a.metaDescription,
    bodyHtml: body,
    noEnglish: true,
    langSwitchSlug: "blog",
    jsonLd: [
      articleLd({ lang, slug: fullSlug, title: a.title, description: a.metaDescription, datePublished: post.dateISO }),
      breadcrumbLd(lang, [
        { name: t.breadcrumbHome, slug: "" },
        { name: t.blog, slug: "blog" },
        { name: a.title, slug: fullSlug },
      ]),
    ],
  });
}
