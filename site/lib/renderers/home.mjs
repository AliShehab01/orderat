import { renderPage, storeBadges } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { FEATURES } from "../../data/features.mjs";
import { BUSINESS_TYPES } from "../../data/business-types.mjs";
import { STEPS } from "../../data/steps.mjs";
import { FAQS } from "../../data/faq.mjs";
import { SCREENSHOTS } from "../../data/screenshots.mjs";
import { BRAND, PRICING } from "../../config.mjs";
import { esc, escAttr } from "../html.mjs";
import { path } from "../urls.mjs";
import { featureCardGrid, businessCardGrid, stepsList, faqTeaser, ctaSection, sectionHeading } from "../components.mjs";
import { softwareApplicationLd } from "../seo.mjs";

const COPY = {
  ar: {
    metaTitle: "اوردرات | نظّم طلبات واتساب وإنستغرام لمشروعك",
    metaDescription:
      "اوردرات تطبيق لأصحاب الأعمال الصغيرة: طلبات واتساب وإنستغرام في مكان واحد، عملاء، أرباح، فاتورة ضريبية اختيارية، مخزون اختياري، وأدوات ذكاء اصطناعي. قريباً على App Store و Google Play.",
    h1: "طلبات واضحة. يوم أهدأ.",
    heroLead:
      "اوردرات يجمع طلبات واتساب وإنستغرام في مكان واحد بموعدها وحالتها، ويحسب لك ربحك الحقيقي — لكل مشروع منزلي، متجر، خدمة، مطعم، أو عربة طعام.",
    problemLead:
      "طلب في محادثة، تعديل في رسالة صوتية، ودفعة نصف مسدّدة تنسى تتابعها. مع كل طلب جديد تكبر الفوضى، ويصعب عليك تعرف وش المفروض تسوي اليوم بالضبط.",
    problemPoints: [
      "تفاصيل الطلب متوزعة بين رسائل قديمة يصعب الرجوع لها",
      "ما تعرف بالضبط كم طلب قدرت تجهّز ولا كم باقي",
      "تحسب ربحك من راسك بدون تسجيل حقيقي للمصاريف",
      "عميل يسأل عن سعر أو توفر، والرد يتأخر وسط الضغط",
    ],
    finalCtaLead: "جرّب متجراً تجريبياً الآن لتشوف تجربة عميلك، واوردرات قريباً على App Store و Google Play.",
  },
  en: {
    metaTitle: "Orderat | Organize WhatsApp & Instagram orders for your business",
    metaDescription:
      "Orderat is an app for small businesses: WhatsApp and Instagram orders in one place, customers, profit, optional tax invoices, optional stock, and AI tools. Launching soon on the App Store and Google Play.",
    h1: "Orders clear. Day calm.",
    heroLead:
      "Orderat brings your WhatsApp and Instagram orders into one place with their date and status, and works out your real profit — for home businesses, shops, services, restaurants, and food trucks alike.",
    problemLead:
      "An order in one chat, a change in a voice note, and a partial payment you forget to follow up on. With every new order the chaos grows, and it gets hard to know exactly what today needs from you.",
    problemPoints: [
      "Order details scattered across old messages you have to scroll back through",
      "No clear sense of how many orders you can still take today",
      "Profit estimated in your head, without real expense tracking",
      "A customer asks about price or availability, and the reply gets delayed under pressure",
    ],
    finalCtaLead: "Try a demo shop right now to see your customer's experience. Orderat is launching soon on the App Store and Google Play.",
  },
};

export function renderHome(lang) {
  const t = UI[lang];
  const c = COPY[lang];

  const body = `
<section class="hero">
  <div class="wrap hero__inner">
    <h1>${esc(c.h1)}</h1>
    <p class="hero__lead">${esc(c.heroLead)}</p>
    <div class="hero__actions">
      ${storeBadges(lang)}
      <a class="btn btn--ghost" href="${escAttr(BRAND.demoShopUrl)}">${esc(t.tryDemo)}</a>
    </div>
  </div>
</section>

<section class="screenshots">
  <div class="wrap screenshots__strip">
    ${SCREENSHOTS.map(
      (s) => `
    <figure class="screenshots__item">
      <img src="/assets/img/screenshots/${s.file}.webp" alt="${escAttr(s[lang])}" width="270" height="600" loading="lazy">
      <figcaption>${esc(s[lang])}</figcaption>
    </figure>`
    ).join("")}
  </div>
</section>

<section class="section problem">
  <div class="wrap">
    ${sectionHeading(null, t.problemTitle, c.problemLead)}
    <ul class="problem__list">
      ${c.problemPoints.map((p) => `<li>${esc(p)}</li>`).join("")}
    </ul>
  </div>
</section>

<section class="section" id="features">
  <div class="wrap">
    ${sectionHeading(null, t.featuresTitle)}
    ${featureCardGrid(lang, FEATURES)}
  </div>
</section>

<section class="section section--tinted">
  <div class="wrap">
    ${sectionHeading(null, t.stepsTitle)}
    ${stepsList(lang, STEPS)}
  </div>
</section>

<section class="section" id="business-types">
  <div class="wrap">
    ${sectionHeading(null, t.businessTypesTitle)}
    ${businessCardGrid(lang, BUSINESS_TYPES)}
  </div>
</section>

<section class="section section--tinted pricing-teaser">
  <div class="wrap">
    ${sectionHeading(null, t.pricing)}
    <div class="pricing-teaser__card">
      <p class="pricing-teaser__trial">${lang === "ar" ? `تجربة مجانية ${PRICING.trialDays} يوماً` : `${PRICING.trialDays}-day free trial`}</p>
      <p class="pricing-teaser__price">
        <strong>$${esc(PRICING.monthly.amountUSD)}</strong> ${lang === "ar" ? "شهرياً" : "/ month"}
        <span class="pricing-teaser__or">${lang === "ar" ? "أو" : "or"}</span>
        <strong>$${esc(PRICING.yearly.amountUSD)}</strong> ${lang === "ar" ? "سنوياً" : "/ year"}
      </p>
      <p class="pricing-teaser__note">${esc(PRICING.note[lang])}</p>
      <a class="link-more" href="${escAttr(path(lang, "pricing"))}">${lang === "ar" ? "تفاصيل الأسعار" : "See pricing details"} ←</a>
    </div>
  </div>
</section>

${faqTeaser(lang, FAQS)}

${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "",
    title: c.metaTitle,
    description: c.metaDescription,
    bodyHtml: body,
    jsonLd: [softwareApplicationLd(lang)],
    ogImage: `/assets/img/og/home-${lang}.jpg`,
    bodyClass: "page-home",
  });
}
