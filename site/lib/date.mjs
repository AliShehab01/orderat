const MONTHS = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** Format an ISO date ("2026-08-03") as a human date in the given language, with Latin digits. */
export function formatDate(iso, lang) {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[lang][m - 1];
  return lang === "ar" ? `${d} ${month} ${y}` : `${month} ${d}, ${y}`;
}
