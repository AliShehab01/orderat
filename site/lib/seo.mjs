import { SITE_URL, BRAND, PRICING } from "../config.mjs";
import { escAttr } from "./html.mjs";
import { absUrl, path } from "./urls.mjs";

/**
 * Build the <head> meta block: title, description, canonical, hreflang alternates,
 * Open Graph, Twitter Card, and language/dir-aware basics.
 *
 * @param {object} p
 * @param {"ar"|"en"} p.lang
 * @param {string} p.slug          slug used with lib/urls.js path()/absUrl()
 * @param {string} p.title         full <title> text (already includes brand suffix if wanted)
 * @param {string} p.description   meta description, ideally 120-160 chars
 * @param {string} [p.ogImage]     absolute or root-relative URL to a 1200x630 image
 * @param {boolean} [p.noEnglish]  true when there is no English counterpart (e.g. Arabic-only blog post)
 */
export function headTags({ lang, slug, title, description, ogImage, noEnglish }) {
  const canonical = absUrl(lang, slug);
  const ogImg = ogImage
    ? ogImage.startsWith("http")
      ? ogImage
      : `${SITE_URL.replace(/\/+$/, "")}${ogImage}`
    : `${SITE_URL.replace(/\/+$/, "")}/assets/img/og/home-${lang}.png`;

  const alternates = [
    `<link rel="alternate" hreflang="ar" href="${escAttr(absUrl("ar", slug))}">`,
    !noEnglish ? `<link rel="alternate" hreflang="en" href="${escAttr(absUrl("en", slug))}">` : "",
    `<link rel="alternate" hreflang="x-default" href="${escAttr(absUrl("ar", slug))}">`,
  ]
    .filter(Boolean)
    .join("\n");

  return `
<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="${escAttr(canonical)}">
${alternates}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escAttr(BRAND.nameAr)} / ${escAttr(BRAND.nameEn)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:image" content="${escAttr(ogImg)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${lang === "ar" ? "ar_BH" : "en_US"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
<meta name="twitter:image" content="${escAttr(ogImg)}">`.trim();
}

/** A <script type="application/ld+json"> block from a plain object. */
export function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.nameEn,
    alternateName: BRAND.nameAr,
    url: SITE_URL,
    logo: `${SITE_URL.replace(/\/+$/, "")}/assets/img/icons/icon-512.png`,
    email: BRAND.email,
    sameAs: [BRAND.instagramUrl, BRAND.tiktokUrl],
  };
}

export function websiteLd(lang) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: `${BRAND.nameAr} | ${BRAND.nameEn}`,
    url: absUrl(lang, ""),
    inLanguage: lang === "ar" ? "ar" : "en",
  };
}

export function softwareApplicationLd(lang) {
  const name = lang === "ar" ? BRAND.nameAr : BRAND.nameEn;
  const description =
    lang === "ar"
      ? "تطبيق لتنظيم طلبات واتساب وإنستغرام للأعمال الصغيرة: طلبات، عملاء، أرباح، فاتورة ضريبية اختيارية، مخزون اختياري وذكاء اصطناعي."
      : "An app for small businesses to organize WhatsApp and Instagram orders: orders, customers, profit, optional tax invoices, optional stock and AI tools.";
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    description,
    url: absUrl(lang, ""),
    applicationCategory: "BusinessApplication",
    operatingSystem: "iOS, Android",
    offers: [
      {
        "@type": "Offer",
        name: lang === "ar" ? "اشتراك شهري" : "Monthly subscription",
        price: PRICING.monthly.amountUSD,
        priceCurrency: "USD",
        category: "subscription",
      },
      {
        "@type": "Offer",
        name: lang === "ar" ? "اشتراك سنوي" : "Yearly subscription",
        price: PRICING.yearly.amountUSD,
        priceCurrency: "USD",
        category: "subscription",
      },
    ],
  };
}

export function faqPageLd(faqs, lang) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f[lang].q,
      acceptedAnswer: { "@type": "Answer", text: f[lang].a },
    })),
  };
}

export function breadcrumbLd(lang, crumbs) {
  // crumbs: [{ name, slug }] in order, slug "" for home.
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(lang, c.slug),
    })),
  };
}

export function articleLd({ lang, slug, title, description, datePublished, ogImage }) {
  const img = ogImage
    ? ogImage.startsWith("http")
      ? ogImage
      : `${SITE_URL.replace(/\/+$/, "")}${ogImage}`
    : `${SITE_URL.replace(/\/+$/, "")}/assets/img/og/home-${lang}.png`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    image: [img],
    datePublished,
    dateModified: datePublished,
    inLanguage: lang,
    author: { "@type": "Organization", name: BRAND.nameEn },
    publisher: {
      "@type": "Organization",
      name: BRAND.nameEn,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL.replace(/\/+$/, "")}/assets/img/icons/icon-512.png`,
      },
    },
    mainEntityOfPage: absUrl(lang, slug),
  };
}
