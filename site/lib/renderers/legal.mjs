import { renderPage } from "../layout.mjs";
import { UI } from "../../data/strings.mjs";
import { PRIVACY, TERMS } from "../../data/legal.mjs";
import { esc, escAttr } from "../html.mjs";
import { breadcrumbsHtml } from "../components.mjs";
import { breadcrumbLd } from "../seo.mjs";

/** A paragraph is either a plain string, or an array of segments (string | {link, text}). */
function renderInline(part) {
  if (typeof part === "string") return esc(part);
  if (part.link) return `<a href="${escAttr(part.link)}">${esc(part.text)}</a>`;
  return esc(part.text ?? "");
}

function renderParagraph(p) {
  if (typeof p === "string") return `<p>${esc(p)}</p>`;
  return `<p>${p.map(renderInline).join("")}</p>`;
}

function renderLegalDoc(lang, doc, slug) {
  const t = UI[lang];
  const d = doc[lang];

  const sectionsHtml = d.sections
    .map((s) => {
      const paras = (s.paragraphs || []).map(renderParagraph).join("");
      const list = s.list ? `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>` : "";
      return `<section class="legal-section"><h2>${esc(s.heading)}</h2>${paras}${list}</section>`;
    })
    .join("");

  const label = slug === "privacy" ? t.privacy : t.terms;

  const body = `
${breadcrumbsHtml(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: label, slug }])}
<article class="legal-doc">
  <h1>${esc(d.title)}</h1>
  <p class="legal-doc__updated">${lang === "ar" ? "آخر تحديث" : "Last updated"}: ${esc(doc.lastUpdated[lang])}</p>
  <p class="lead">${esc(d.intro)}</p>
  ${sectionsHtml}
  <p class="legal-doc__contact">${d.contact.map(renderInline).join("")}</p>
</article>
`;

  return renderPage({
    lang,
    slug,
    title: d.metaTitle,
    description: d.metaDescription,
    bodyHtml: body,
    jsonLd: [breadcrumbLd(lang, [{ name: t.breadcrumbHome, slug: "" }, { name: label, slug }])],
  });
}

export function renderPrivacyPage(lang) {
  return renderLegalDoc(lang, PRIVACY, "privacy");
}

export function renderTermsPage(lang) {
  return renderLegalDoc(lang, TERMS, "terms");
}
