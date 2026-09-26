// Lists the Gregorian dates of the Hijri occasions used in gen-campaigns.mjs, from the Umm al-Qura
// calendar that Node's ICU ships (islamic-umalqura). Usage: node scripts/content/hijri-dates.mjs
const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
const want = [
  [8, 14, "haq_al_laila (14 Shaban eve)"],
  [9, 1, "ramadan start"],
  [9, 14, "gergaoun (14 Ramadan eve)"],
  [10, 1, "eid al-fitr"],
  [12, 9, "arafah"],
  [12, 10, "eid al-adha"],
  [1, 1, "islamic new year"],
  [3, 12, "mawlid"],
];
const start = Date.UTC(2026, 8, 1), end = Date.UTC(2028, 11, 31);
const monthLen = {};
for (let t = start; t <= end; t += 86400000) {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const y = Number(parts.year?.replace(/\D/g, "")), m = Number(parts.month), d = Number(parts.day);
  const key = `${y}-${m}`; monthLen[key] = Math.max(monthLen[key] ?? 0, d);
  for (const [wm, wd, label] of want) if (m === wm && d === wd) console.log(new Date(t).toISOString().slice(0, 10), `${y}/${m}/${d}`, label);
}
console.log("Ramadan lengths:", Object.entries(monthLen).filter(([k]) => k.endsWith("-9")).map(([k, v]) => `${k}:${v}`).join(" "));
console.log("DhulHijja lengths:", Object.entries(monthLen).filter(([k]) => k.endsWith("-12")).map(([k, v]) => `${k}:${v}`).join(" "));
