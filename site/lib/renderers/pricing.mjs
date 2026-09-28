import { renderPage, storeBadges } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { FAQS } from "../../data/faq.mjs";
import { BRAND, PRICING } from "../../config.mjs";
import { esc, escAttr } from "../html.mjs";
import { icon } from "../icons.mjs";
import { breadcrumbsHtml, ctaSection, faqAccordion } from "../components.mjs";
import { breadcrumbLd, softwareApplicationLd } from "../seo.mjs";

const PRICING_FAQ_QS = ["كم سعر اوردرات؟", "أقدر ألغي الاشتراك في أي وقت؟", "هل \"اسأل اوردرات\" و ميزات الذكاء الاصطناعي الأخرى مجانية؟"];

const FREE = {
  ar: [
    "طلبات واتساب وإنستغرام غير محدودة",
    "شاشة اليوم، العملاء، والربح والمصاريف",
    "فاتورة ضريبية اختيارية مع رمز ZATCA",
    "تتبّع مخزون اختياري",
    "تسجيل طلب بالذكاء الاصطناعي من رسالة العميل",
    "3 أسئلة يومياً لـ \"اسأل اوردرات\"",
  ],
  en: [
    "Unlimited WhatsApp and Instagram orders",
    "The Today screen, customers, and profit and expenses",
    "Optional tax invoices with a ZATCA QR code",
    "Optional stock tracking",
    "AI order entry from your customer's message",
    "3 Ask Orderat questions a day",
  ],
};

const PAID = {
  ar: [
    "اسأل اوردرات بأسئلة أكثر بكثير",
    "رابط متجر عام لعملائك",
    "موظفين ومزامنة سحابية بين الأجهزة",
    "استوديو الصور",
    "حملات المناسبات",
  ],
  en: [
    "Far more Ask Orderat questions",
    "A public shop link for your customers",
    "Staff and cloud sync across devices",
    "The photo studio",
    "Occasion campaigns",
  ],
};

const COPY = {
  ar: {
    metaTitle: "أسعار اوردرات: متجرك مجاني، والاشتراك يضيف أكثر | اوردرات",
    metaDescription: "متجرك في اوردرات مجاني: الطلبات والعملاء والفلوس والفواتير. والاشتراك (7 أيام مجاناً، ثم 9.99 دولار شهرياً أو 79.99 دولار سنوياً) يضيف رابط المتجر والمزامنة والموظفين ومزايا الذكاء الاصطناعي.",
    h1: "متجرك مجاني، والاشتراك يضيف لك أكثر",
    lead: `الطلبات والعملاء والمصاريف والتقارير والفواتير مجانية بدون اشتراك. والاشتراك، مع ${PRICING.trialAr} تجربة مجانية، يضيف رابط متجرك والمزامنة والموظفين والمزيد من الذكاء الاصطناعي. تقدر تلغي في أي وقت.`,
    monthlyLabel: "شهري",
    yearlyLabel: "سنوي",
    yearlySave: "وفّر تقريباً 33% مع الاشتراك السنوي",
    freeTitle: "مجاني لمتجرك",
    includedTitle: "الاشتراك يضيف لك",
    trialBadge: `تجربة مجانية ${PRICING.trialAr}`,
    faqTitle: "أسئلة عن السعر",
  },
  en: {
    metaTitle: "Orderat pricing: your shop is free | Orderat",
    metaDescription: "Your Orderat shop is free: orders, customers, money and receipts. The subscription (7 days free, then $9.99 a month or $79.99 a year) adds your shop link, cloud sync, staff and more AI.",
    h1: "Your shop is free. The subscription adds more.",
    lead: `Orders, customers, expenses, reports and receipts are free, with no subscription. The subscription, with a ${PRICING.trialDays}-day free trial, adds your shop link, cloud sync, staff and more AI. Cancel anytime.`,
    monthlyLabel: "Monthly",
    yearlyLabel: "Yearly",
    yearlySave: "Save about 33% with the yearly plan",
    freeTitle: "Free for your shop",
    includedTitle: "The subscription adds",
    trialBadge: `${PRICING.trialDays}-day free trial`,
    faqTitle: "Pricing questions",
  },
};

export function renderPricing(lang) {
  const t = UI[lang];
  const c = COPY[lang];
  const pricingFaqs = FAQS.filter((f) => PRICING_FAQ_QS.includes(f.ar.q));

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.pricing, slug: "pricing" }])}
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>

<div class="pricing-cards">
  <div class="pricing-card">
    <p class="pricing-card__badge">${esc(c.trialBadge)}</p>
    <p class="pricing-card__label">${esc(c.monthlyLabel)}</p>
    <p class="pricing-card__price">$${esc(PRICING.monthly.amountUSD)}<span>/${lang === "ar" ? "شهر" : "mo"}</span></p>
  </div>
  <div class="pricing-card pricing-card--highlight">
    <p class="pricing-card__badge">${esc(c.trialBadge)}</p>
    <p class="pricing-card__label">${esc(c.yearlyLabel)}</p>
    <p class="pricing-card__price">$${esc(PRICING.yearly.amountUSD)}<span>/${lang === "ar" ? "سنة" : "yr"}</span></p>
    <p class="pricing-card__save">${esc(c.yearlySave)}</p>
  </div>
</div>
<p class="pricing-note">${esc(PRICING.note[lang])}</p>

<section class="section">
  <h2>${esc(c.freeTitle)}</h2>
  <ul class="highlight-list highlight-list--check">
    ${FREE[lang].map((i) => `<li>${icon("check")}${esc(i)}</li>`).join("")}
  </ul>
</section>

<section class="section">
  <h2>${esc(c.includedTitle)}</h2>
  <ul class="highlight-list highlight-list--check">
    ${PAID[lang].map((i) => `<li>${icon("check")}${esc(i)}</li>`).join("")}
  </ul>
</section>

<div class="pricing-cta">
  ${storeBadges(lang)}
  <a class="btn btn--ghost" href="${escAttr(BRAND.demoShopUrl)}">${esc(t.tryDemo)}</a>
</div>

<section class="section">
  <h2>${esc(c.faqTitle)}</h2>
  ${faqAccordion(lang, pricingFaqs)}
</section>

${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "pricing",
    title: c.metaTitle,
    description: c.metaDescription,
    bodyHtml: body,
    jsonLd: [softwareApplicationLd(lang), breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.pricing, slug: "pricing" }])],
  });
}
