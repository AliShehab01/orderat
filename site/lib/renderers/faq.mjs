import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { FAQS } from "../../data/faq.mjs";
import { esc } from "../html.mjs";
import { breadcrumbsHtml, ctaSection, faqAccordion } from "../components.mjs";
import { breadcrumbLd, faqPageLd } from "../seo.mjs";

const COPY = {
  ar: {
    metaTitle: "الأسئلة الشائعة عن اوردرات | اوردرات",
    metaDescription: "إجابات عن أكثر الأسئلة تكراراً حول اوردرات: السعر، البيانات، الضريبة، المخزون، الموظفين، والمزامنة.",
    h1: "الأسئلة الشائعة",
    lead: "كل ما تحتاج تعرفه عن اوردرات قبل ما تبدأ.",
  },
  en: {
    metaTitle: "Orderat FAQ | Frequently asked questions",
    metaDescription: "Answers to the most common questions about Orderat: pricing, data, VAT, stock, staff, and sync.",
    h1: "Frequently asked questions",
    lead: "Everything you need to know about Orderat before you start.",
  },
};

export function renderFaqPage(lang) {
  const t = UI[lang];
  const c = COPY[lang];

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.faq, slug: "faq" }])}
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
${faqAccordion(lang, FAQS)}
${ctaSection(lang)}
`;

  return renderPage({
    lang,
    slug: "faq",
    title: c.metaTitle,
    description: c.metaDescription,
    bodyHtml: body,
    jsonLd: [faqPageLd(FAQS, lang), breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.faq, slug: "faq" }])],
  });
}
