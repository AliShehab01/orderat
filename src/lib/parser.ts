import type { Confidence, Draft, DraftItem, Product } from "./types";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const normalizeDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

export function normalizeText(s: string): string {
  return normalizeDigits(s)
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[،,;؛!?.…:؟]/g, " ")
    .replace(/(^|\s)و(\d)/g, "$1و $2")
    .replace(/(\d)(am|pm|ص|م)(?=\s|$)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
export const normalizeName = (s: string) =>
  normalizeText(s).replace(/[^\p{L}\p{N} ]/gu, "").trim();

const NUM_WORDS: Record<string, number> = {
  one: 1, wahda: 1, wahed: 1, واحد: 1, واحده: 1, وحده: 1, two: 2, ثنين: 2, اثنين: 2,
  three: 3, ثلاث: 3, ثلاثه: 3, four: 4, اربع: 4, اربعه: 4, five: 5, خمس: 5, خمسه: 5,
  six: 6, ست: 6, سته: 6, ten: 10, عشر: 10, عشره: 10, dozen: 12,
};
const UNIT_SKIP = new Set(["و", "w", "and", "of", "من", "cup", "cups", "box", "boxes", "كب", "كوب", "بوكس", "علبه", "علب", "pcs", "pieces", "piece", "حبه", "حبات", "قطعه", "قطع", "x", "×", "عدد", "صندوق", "صناديق"]);
const CONNECT = new Set(["و", "w", "and", "of", "من", "x", "×", "عدد"]);
const OLD_LEAD = new Set(["مو", "بدل", "not", "instead", "مش"]);
const NAME_STOP = new Set(["ودي", "ابغى", "ابي", "بغيت", "اريد", "ممكن", "abi", "abgha", "want", "momkin", "هلا", "حبيبتي", "اختي"]);
const AM = new Set(["am", "ص", "صباحا", "الصبح", "صبح", "morning", "صباح"]);
const PM = new Set(["pm", "م", "مساء", "العصر", "عصر", "الظهر", "ظهر", "المغرب", "مغرب", "الليل", "ليل", "evening", "night", "afternoon", "noon", "tonight"]);
const TIME_LEAD = new Set(["الساعه", "ساعه", "at", "by", "@", "around", "حوالي"]);
const WD_EN: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const WD_AR: [RegExp, number][] = [[/احد$/, 0], [/اثنين$/, 1], [/ثلاثاء$/, 2], [/اربعاء$/, 3], [/خميس$/, 4], [/جمعه$/, 5], [/سبت$/, 6]];

export function nextWeekday(from: Date, wd: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + ((wd - from.getDay() + 7) % 7));
  return d;
}
const numAt = (t?: string) => (t === undefined ? undefined : /^\d+$/.test(t) ? Number(t) : NUM_WORDS[t]);

export function extractCustomerName(original: string): string | undefined {
  const head = original.match(/^\s*([^\n:]{2,30}?)\s*:/);
  if (head) return head[1].trim();
  const m = original.match(/(?:اسمي|انا|أنا|ismi|esmi|ana|i am|i'm|im|my name is|this is)\s+((?:أم|ام|أبو|ابو|um|umm|abu)\s+)?([^\s,،.!?🙏]+)/iu);
  if (m && !NAME_STOP.has(normalizeText(m[2]))) return ((m[1] ?? "") + m[2]).trim();
  return undefined;
}

function extractCollection(tokens: string[], consumed: Set<number>, now: Date) {
  let dayOffset: number | undefined, weekday: number | undefined, hour: number | undefined, minute = 0;
  let dateConf: Confidence = "low", timeConf: Confidence = "low", mer: "am" | "pm" | undefined;
  tokens.forEach((t, i) => {
    if (t === "اليوم" || t === "today" || t === "tonight") { dayOffset = 0; dateConf = "high"; consumed.add(i); }
    else if (/^(بكرا|بكره|باكر|غدا|tomorrow|tmrw|tmr)$/.test(t)) { dayOffset = tokens[i - 1] === "بعد" ? 2 : 1; dateConf = "high"; consumed.add(i); }
    else if (t in WD_EN) { weekday = WD_EN[t]; dateConf = "high"; consumed.add(i); }
    else for (const [re, d] of WD_AR) if (re.test(t) && t.length <= 8) { weekday = d; dateConf = "high"; consumed.add(i); break; }
  });
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!m || Number(m[1]) > 24) continue;
    const lead = i > 0 && TIME_LEAD.has(tokens[i - 1]);
    const next = tokens[i + 1];
    const nm = next && (AM.has(next) ? "am" : PM.has(next) ? "pm" : undefined);
    if (!lead && !nm) continue;
    hour = Number(m[1]); minute = m[2] ? Number(m[2]) : 0; timeConf = "high"; consumed.add(i);
    if (lead) consumed.add(i - 1);
    if (nm) { mer = nm; consumed.add(i + 1); }
    break;
  }
  if (hour === undefined) {
    const p = tokens.find((t) => AM.has(t) || PM.has(t));
    if (p) hour = AM.has(p) ? 10 : /ظهر|noon/.test(p) ? 12 : /عصر|afternoon/.test(p) ? 17 : /مغرب/.test(p) ? 18 : 20;
  } else {
    mer ??= tokens.some((t) => AM.has(t)) ? "am" : tokens.some((t) => PM.has(t)) ? "pm" : undefined;
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    if (!mer && hour >= 1 && hour <= 7) { hour += 12; timeConf = "low"; }
  }
  if (dayOffset === undefined && weekday === undefined && hour === undefined) return undefined;
  let date = weekday !== undefined ? nextWeekday(now, weekday) : new Date(now);
  if (weekday === undefined && dayOffset !== undefined) date.setDate(date.getDate() + dayOffset);
  if (weekday === undefined && dayOffset === undefined && hour !== undefined && hour < now.getHours()) date.setDate(date.getDate() + 1);
  date = new Date(date); date.setHours(hour ?? 10, hour === undefined ? 0 : minute, 0, 0);
  const confidence: Confidence = [dateConf, timeConf].every((value) => value === "high")
    ? "high"
    : "low";
  return { iso: date.toISOString(), confidence };
}

function extractItems(tokens: string[], consumed: Set<number>, products: Product[]) {
  const index = products
    .flatMap((p) => [p.name, p.nameAr, ...p.aliases].map((a) => ({ p, alias: normalizeText(a).split(" ").filter(Boolean) })))
    .filter((x) => x.alias.length)
    .sort((a, b) => b.alias.length - a.alias.length);
  const found: { p: Product; start: number; end: number }[] = [];
  for (const { p, alias } of index)
    for (let i = 0; i + alias.length <= tokens.length; i++)
      if (alias.every((a, k) => tokens[i + k] === a && !consumed.has(i + k))) {
        found.push({ p, start: i, end: i + alias.length });
        for (let k = i; k < i + alias.length; k++) consumed.add(k);
      }
  found.sort((a, b) => a.start - b.start);
  const items: DraftItem[] = []; const seen = new Map<string, DraftItem>(); const oldQ: number[] = [];
  for (const f of found) {
    let qty: number | undefined, qi: number | undefined;
    for (let j = f.start - 1; j >= Math.max(0, f.start - 4); j--) {
      if (consumed.has(j)) break;
      const n = numAt(tokens[j]);
      if (n !== undefined) { if (!OLD_LEAD.has(tokens[j - 1] ?? "")) { qty = n; qi = j; } break; }
      if (!UNIT_SKIP.has(tokens[j])) break;
    }
    if (qty === undefined)
      for (let j = f.end; j < Math.min(tokens.length, f.end + 3); j++) {
        if (consumed.has(j)) break;
        const n = numAt(tokens[j]);
        if (n !== undefined) { if (CONNECT.has(tokens[j - 1]) || j === f.end) { qty = n; qi = j; } break; }
        if (!UNIT_SKIP.has(tokens[j])) break;
      }
    if (qi !== undefined) consumed.add(qi);
    const ex = seen.get(f.p.id);
    if (ex) { if (qty !== undefined) ex.quantity = (ex.quantity ?? 0) + qty; continue; }
    const it: DraftItem = { productId: f.p.id, rawText: tokens.slice(Math.min(qi ?? f.start, f.start), Math.max(f.end, (qi ?? 0) + 1)).join(" "), quantity: qty, confidence: qty === undefined ? "low" : "high" };
    seen.set(f.p.id, it); items.push(it);
  }
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const n = numAt(tokens[i]); if (n === undefined) continue;
    if (OLD_LEAD.has(tokens[i - 1] ?? "")) { oldQ.push(n); consumed.add(i); continue; }
    const nx = tokens[i + 1];
    if (nx && UNIT_SKIP.has(nx) && !CONNECT.has(nx)) { items.push({ rawText: `${tokens[i]} ${nx}`, quantity: n, confidence: "low" }); consumed.add(i); consumed.add(i + 1); }
  }
  return { items, oldQ };
}

const NOTE_RE = [/بدون \S+/g, /no nuts/g, /nut ?free/g, /less sugar/g, /سكر اقل/g, /sugar ?free/g, /اكتب\S* [^,]+/g, /write [^,]+/g, /توصيل/g, /delivery/g, /allerg\S*/g, /حساسيه/g, /gluten ?free/g, /vegan/g];

export function parseOrderText(text: string, products: Product[], now = new Date()): Draft {
  const original = normalizeDigits(text).trim();
  const tokens = normalizeText(original).split(" ").filter(Boolean);
  const consumed = new Set<number>();
  const customer = extractCustomerName(original);
  const col = extractCollection(tokens, consumed, now);
  const { items, oldQ } = extractItems(tokens, consumed, products);
  const norm = tokens.join(" ");
  const notes = Array.from(new Set(NOTE_RE.flatMap((re) => [...norm.matchAll(re)].map((m) => m[0].trim()))));
  return {
    customerName: customer, customerConfidence: customer ? "high" : "low",
    items, collectionAt: col?.iso, collectionConfidence: col?.confidence ?? "low",
    notes: notes.length ? notes.join("; ") : undefined, oldQuantities: oldQ,
  };
}
