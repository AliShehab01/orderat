import { renderPage, storeBadges } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { FAQS } from "../../data/faq.mjs";
import { BRAND, PRICING } from "../../config.mjs";
import { esc, escAttr } from "../html.mjs";
import { icon } from "../icons.mjs";
import { breadcrumbsHtml, ctaSection, faqAccordion } from "../components.mjs";
import { breadcrumbLd, softwareApplicationLd } from "../seo.mjs";

const PRICING_FAQ_QS = ["كم سعر اوردرات؟", "أقدر ألغي الاشتراك في أي وقت؟", "هل \"اسأل اوردرات\" و ميزات الذكاء الاصطناعي الأخرى مجانية؟"];

const INCLUDED = {
  ar: [
    "طلبات واتساب وإنستغرام غير محدودة",
    "شاشة اليوم، العملاء، والربح والمصاريف",
    "فاتورة ضريبية اختيارية مع رمز ZATCA",
    "تتبّع مخزون اختياري",
    "تسجيل طلب بالذكاء الاصطناعي واسأل اوردرات",
    "رابط متجر عام لعملائك",
    "موظفين ومزامنة سحابية بين الأجهزة",
    "استوديو الصور وحملات المناسبات",
  ],
  en: [
    "Unlimited WhatsApp and Instagram orders",
    "The Today screen, customers, and profit and expenses",
    "Optional tax invoices with a ZATCA QR code",
    "Optional stock tracking",
    "AI order entry and Ask Orderat",
    "A public shop link for your customers",
    "Staff and cloud sync across devices",
    "The photo studio and occasion campaigns",
  ],
};

const COPY = {
  ar: {
    metaTitle: "أسعار اوردرات: تجربة مجانية 7 أيام | اوردرات",
    metaDescription: "جرّب اوردرات مجاناً 7 أيام، ثم 9.99 دولار شهرياً أو 79.99 دولار سنوياً. كل المزايا في اشتراك واحد، وتقدر تلغي في أي وقت.",
    h1: "سعر واحد بسيط، لكل مزايا اوردرات",
    lead: `${PRICING.trialAr} تجربة مجانية كاملة المزايا، وبعدها اشتراك واحد يفتح لك كل شي. لا باقات متعددة ولا مزايا مقفولة خلف اشتراك أعلى.`,
    monthlyLabel: "شهري",
    yearlyLabel: "سنوي",
    yearlySave: "وفّر تقريباً 33% مع الاشتراك السنوي",
    includedTitle: "كل هذا داخل اشتراكك",
    trialBadge: `تجربة مجانية ${PRICING.trialAr}`,
    faqTitle: "أسئلة عن السعر",
  },
  en: {
    metaTitle: "Orderat pricing: a 7-day free trial | Orderat",
    metaDescription: "Try Orderat free for 7 days, then $9.99 a month or $79.99 a year. Every feature in one subscription, cancel anytime.",
    h1: "One simple price for every Orderat feature",
    lead: `A ${PRICING.trialDays}-day free trial with every feature unlocked, then a single subscription opens everything. No tiers, no features locked behind a higher plan.`,
    monthlyLabel: "Monthly",
    yearlyLabel: "Yearly",
    yearlySave: "Save about 33% with the yearly plan",
    includedTitle: "Everything included",
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
  <h2>${esc(c.includedTitle)}</h2>
  <ul class="highlight-list highlight-list--check">
    ${INCLUDED[lang].map((i) => `<li>${icon("check")}${esc(i)}</li>`).join("")}
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
