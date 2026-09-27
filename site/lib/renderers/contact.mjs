import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { BRAND } from "../../config.mjs";
import { esc, escAttr } from "../html.mjs";
import { icon } from "../icons.mjs";
import { breadcrumbsHtml } from "../components.mjs";
import { breadcrumbLd } from "../seo.mjs";

const COPY = {
  ar: {
    metaTitle: "تواصل معنا | اوردرات",
    metaDescription: "عندك سؤال أو ملاحظة عن اوردرات؟ راسلنا على البريد الإلكتروني أو تابعنا على إنستغرام وتيك توك.",
    h1: "تواصل معنا",
    emailCta: "راسلنا على البريد الإلكتروني",
    social: "تابعنا",
    interestTitle: "تبي تكون أول من يجرّب اوردرات؟",
    interestBody: "راسلنا وقل لنا نوع نشاطك، ونعلمك أول ما يصير اوردرات متاحاً على App Store و Google Play.",
  },
  en: {
    metaTitle: "Contact us | Orderat",
    metaDescription: "Have a question or feedback about Orderat? Email us or follow us on Instagram and TikTok.",
    h1: "Contact us",
    emailCta: "Email us",
    social: "Follow us",
    interestTitle: "Want to be first to try Orderat?",
    interestBody: "Email us with your business type, and we'll let you know as soon as Orderat is available on the App Store and Google Play.",
  },
};

export function renderContactPage(lang) {
  const t = UI[lang];
  const c = COPY[lang];

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.contact, slug: "contact" }])}
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(t.contactIntro)}</p>

<div class="contact-card">
  <a class="btn btn--primary" href="mailto:${escAttr(BRAND.email)}">${esc(c.emailCta)}</a>
  <p class="contact-card__email">${esc(BRAND.email)}</p>
</div>

<section class="section">
  <h2>${esc(c.social)}</h2>
  <ul class="contact-social">
    <li><a href="${escAttr(BRAND.instagramUrl)}">${esc(t.instagramLabel)} — @${esc(BRAND.instagramHandle)}</a></li>
    <li><a href="${escAttr(BRAND.tiktokUrl)}">${esc(t.tiktokLabel)} — @${esc(BRAND.tiktokHandle)}</a></li>
  </ul>
</section>

<section class="section cta-band" style="border-radius:1.5rem">
  <div class="cta-band__inner">
    <h2>${esc(c.interestTitle)}</h2>
    <p>${esc(c.interestBody)}</p>
    <a class="btn btn--ghost-light" href="mailto:${escAttr(BRAND.email)}?subject=${escAttr(lang === "ar" ? "أبشر أول ما يطلق اوردرات" : "Notify me when Orderat launches")}">${esc(c.emailCta)}</a>
  </div>
</section>
`;

  return renderPage({
    lang,
    slug: "contact",
    title: c.metaTitle,
    description: c.metaDescription,
    bodyHtml: body,
    jsonLd: [breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: t.contact, slug: "contact" }])],
  });
}
