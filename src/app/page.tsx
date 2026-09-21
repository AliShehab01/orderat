"use client";

import { useEffect, useMemo, useState } from "react";
import type { Draft, DraftItem, Locale, Order, Product } from "@/lib/types";
import { parseOrderText } from "@/lib/parser";
import { buildDayPlan, dateKey, demoOrders, demoProducts, findChangeCandidate, keyOf, type ChangeCandidate } from "@/lib/plan";

type Tab = "today" | "inbox" | "orders" | "plan" | "products";

const T = {
  en: {
    tagline: "Send your orders. Get your plan.", today: "Today", inbox: "New order", orders: "Orders", plan: "Plan", products: "Products",
    paste: "Paste the customer message here…", extract: "Extract order", examples: "Try an example", ex1: "Sara, 20 cups", ex2: "Um Khalid, voice note", ex3: "Sara changes to 35", ex4: "Mona, Arabizi",
    draft: "Draft order", check: "Check the highlighted fields before confirming.", customer: "Customer", items: "Items", qty: "Qty", collection: "Collection time", notes: "Notes", confirm: "Confirm", discard: "Discard", added: "Order added to the order book.", changed: "Order updated.",
    change: "Looks like a change to an existing order", confirmChange: "Confirm change", newOrder: "This is a new order", free: "Other", addItem: "Add item",
    due: "Collections today", units: "Units", next: "Next collection", nothing: "No collections today.", noTime: "Orders without a time",
    all: "All", upcoming: "Upcoming", done: "Done", confirmed: "Confirmed", prepped: "Prepped", collected: "Collected", markPrepped: "Prepped", markCollected: "Collected", noTimeShort: "no time",
    toPrepare: "To prepare", ordered: "Ordered", prepare: "Prepare", batches: "batches of", packaging: "Packaging", byTime: "By collection time", over: "Over your daily capacity of", empty: "Nothing due on this day.", capacity: "Daily capacity",
    batch: "batch", pack: "packaging", reset: "Reset demo data", demoNote: "Demo: data stays in this browser. Screenshots and voice notes need a Gemini key.", screenshot: "Screenshot", voice: "Voice note", soon: "needs Gemini key",
  },
  ar: {
    tagline: "أرسل طلباتك، استلم خطتك.", today: "اليوم", inbox: "طلب جديد", orders: "الطلبات", plan: "الخطة", products: "المنتجات",
    paste: "الصق رسالة العميل هنا…", extract: "استخراج الطلب", examples: "جرّب مثالاً", ex1: "سارة، 20 كب", ex2: "أم خالد، رسالة صوتية", ex3: "سارة تغيّر إلى 35", ex4: "منى، عربيزي",
    draft: "مسودة الطلب", check: "راجع الحقول المظللة قبل التأكيد.", customer: "العميل", items: "المنتجات", qty: "الكمية", collection: "وقت الاستلام", notes: "ملاحظات", confirm: "تأكيد", discard: "تجاهل", added: "تمت إضافة الطلب إلى دفتر الطلبات.", changed: "تم تحديث الطلب.",
    change: "يبدو أنه تغيير على طلب موجود", confirmChange: "تأكيد التغيير", newOrder: "هذا طلب جديد", free: "أخرى", addItem: "إضافة منتج",
    due: "استلامات اليوم", units: "القطع", next: "الاستلام التالي", nothing: "لا يوجد استلام اليوم.", noTime: "طلبات بدون وقت",
    all: "الكل", upcoming: "القادمة", done: "المنتهية", confirmed: "مؤكد", prepped: "جاهز", collected: "مستلَم", markPrepped: "تم التحضير", markCollected: "تم الاستلام", noTimeShort: "بدون وقت",
    toPrepare: "للتحضير", ordered: "مطلوب", prepare: "حضّر", batches: "دفعات من", packaging: "التغليف", byTime: "حسب وقت الاستلام", over: "تجاوزت طاقتك اليومية", empty: "لا يوجد استلام في هذا اليوم.", capacity: "الطاقة اليومية",
    batch: "دفعة", pack: "تغليف", reset: "إعادة البيانات التجريبية", demoNote: "نسخة تجريبية: البيانات محفوظة في هذا المتصفح. لقطات الشاشة والرسائل الصوتية تحتاج مفتاح Gemini.", screenshot: "لقطة شاشة", voice: "رسالة صوتية", soon: "يحتاج مفتاح Gemini",
  },
} as const;

const EXAMPLES = [
  "سارة: هلا حبيبتي، بغيت اطلب 20 cup cheesecake و10 brownies box، for السبت الصبح، ممكن استلمها الساعة 10؟",
  "هلا أختي، أنا أم خالد. ودي أطلب 30 كب كيك فانيلا و12 تشيز كيك كب، للسبت الساعة 6 العصر، عادي؟",
  "سارة: ياليت تخليها 35 كب مو 20 اذا ممكن 🙏",
  "salam ukhti, momkin atlub 2 brownie box w 3 cheesecake cups for Friday 5pm? ismi Mona 🙏",
];

const KEY = "orderat-demo-v1";
interface Saved { locale: Locale; products: Product[]; orders: Order[]; capacity: number }

const fmtTime = (iso: string, l: Locale) => new Intl.DateTimeFormat(l === "ar" ? "ar-BH-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const fmtDay = (iso: string, l: Locale) => new Intl.DateTimeFormat(l === "ar" ? "ar-BH-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const toInput = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function Home() {
  const [state, setState] = useState<Saved | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) { setState(JSON.parse(raw)); return; } } catch {}
    setState({ locale: "ar", products: demoProducts(), orders: demoOrders(), capacity: 80 });
  }, []);
  useEffect(() => { if (state) { localStorage.setItem(KEY, JSON.stringify(state)); document.documentElement.lang = state.locale; document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr"; } }, [state]);
  if (!state) return null;
  const l = state.locale; const t = T[l];
  const patch = (p: Partial<Saved>) => setState((s) => ({ ...s!, ...p }));
  const pname = (id?: string) => { const p = state.products.find((x) => x.id === id); return p ? (l === "ar" ? p.nameAr : p.name) : undefined; };

  const tabs: [Tab, string][] = [["today", t.today], ["inbox", t.inbox], ["orders", t.orders], ["plan", t.plan], ["products", t.products]];
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24">
      <header className="flex items-center justify-between bg-teal-700 px-4 py-3 text-white">
        <div><div className="text-2xl font-bold leading-tight">اوردرات</div><div className="text-xs text-teal-100">{t.tagline}</div></div>
        <button onClick={() => patch({ locale: l === "ar" ? "en" : "ar" })} className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold ring-1 ring-white/40">{l === "ar" ? "English" : "العربية"}</button>
      </header>
      <main className="p-4">
        {tab === "today" && <Today s={state} t={t} pname={pname} go={setTab} />}
        {tab === "inbox" && <Inbox s={state} t={t} patch={patch} pname={pname} />}
        {tab === "orders" && <Orders s={state} t={t} patch={patch} pname={pname} />}
        {tab === "plan" && <Plan s={state} t={t} patch={patch} />}
        {tab === "products" && <Products s={state} t={t} patch={patch} />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`py-3 text-xs ${tab === k ? "font-bold text-teal-700" : "text-slate-500"}`}>{label}</button>)}
      </div></nav>
    </div>
  );
}

type Tx = (typeof T)["en"] | (typeof T)["ar"];
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>;
const Btn = ({ children, onClick, kind = "primary", disabled }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "soft"; disabled?: boolean }) => (
  <button onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${kind === "primary" ? "bg-teal-700 text-white" : kind === "soft" ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100"}`}>{children}</button>
);
const Badge = ({ s, t }: { s: string; t: Tx }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s === "collected" ? "bg-slate-100 text-slate-500" : s === "prepped" ? "bg-amber-100 text-amber-800" : "bg-teal-50 text-teal-700"}`}>{t[s as "confirmed" | "prepped" | "collected"]}</span>;

function Today({ s, t, pname, go }: { s: Saved; t: Tx; pname: (id?: string) => string | undefined; go: (tab: Tab) => void }) {
  const today = dateKey(new Date());
  const due = s.orders.filter((o) => o.collectionAt && keyOf(o.collectionAt) === today && o.status !== "collected").sort((a, b) => a.collectionAt!.localeCompare(b.collectionAt!));
  const units = due.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);
  const noTime = s.orders.filter((o) => !o.collectionAt && o.status !== "collected");
  return <div className="grid gap-3">
    <div className="grid grid-cols-2 gap-3">
      <Card><div className="text-xs text-slate-500">{t.due}</div><div className="text-3xl font-bold text-teal-700">{due.length}</div></Card>
      <Card><div className="text-xs text-slate-500">{t.units}</div><div className="text-3xl font-bold text-teal-700">{units}</div></Card>
    </div>
    <Card><div className="text-xs text-slate-500">{t.next}</div>{due[0] ? <div className="font-semibold">{fmtTime(due[0].collectionAt!, s.locale)} · {due[0].customerName}</div> : <div className="text-slate-400">{t.nothing}</div>}</Card>
    {noTime.length > 0 && <Card className="ring-amber-300 bg-amber-50"><div className="text-xs font-semibold text-amber-800">{t.noTime}</div>{noTime.map((o) => <div key={o.id} className="text-sm">{o.customerName} · {o.items.map((i) => `${pname(i.productId) ?? i.rawText} × ${i.quantity}`).join("، ")}</div>)}</Card>}
    {due.map((o) => <Card key={o.id}><div className="flex items-center justify-between"><div className="font-semibold">{fmtTime(o.collectionAt!, s.locale)} · {o.customerName}</div><Badge s={o.status} t={t} /></div><div className="text-sm text-slate-600">{o.items.map((i) => `${pname(i.productId) ?? i.rawText} × ${i.quantity}`).join("، ")}</div></Card>)}
    <div className="flex gap-2"><Btn onClick={() => go("inbox")}>{t.inbox}</Btn><Btn kind="soft" onClick={() => go("plan")}>{t.plan}</Btn></div>
    <p className="text-xs text-slate-400">{t.demoNote}</p>
  </div>;
}

function Inbox({ s, t, patch, pname }: { s: Saved; t: Tx; patch: (p: Partial<Saved>) => void; pname: (id?: string) => string | undefined }) {
  const [text, setText] = useState(""); const [draft, setDraft] = useState<Draft | null>(null); const [cand, setCand] = useState<ChangeCandidate | null>(null); const [msg, setMsg] = useState("");
  const run = (txt: string) => {
    const d = parseOrderText(txt, s.products); setMsg("");
    const c = findChangeCandidate(d, s.orders, s.products);
    setDraft(d); setCand(c);
  };
  const confirmDraft = (d: Draft) => {
    const order: Order = { id: crypto.randomUUID(), customerName: d.customerName ?? "?", items: d.items.filter((i) => i.quantity).map((i) => ({ productId: i.productId, rawText: i.rawText, quantity: i.quantity! })), collectionAt: d.collectionAt, notes: d.notes, status: "confirmed", changes: [], createdAt: new Date().toISOString() };
    patch({ orders: [order, ...s.orders] }); setDraft(null); setCand(null); setText(""); setMsg(t.added);
  };
  const confirmChange = (c: ChangeCandidate) => {
    const note = c.diffs.map((d) => `${d.label}: ${d.oldValue} → ${d.newValue}`).join("; ");
    patch({ orders: s.orders.map((o) => o.id === c.order.id ? { ...o, items: c.items, collectionAt: c.collectionAt, changes: [...o.changes, note] } : o) });
    setDraft(null); setCand(null); setText(""); setMsg(t.changed);
  };
  return <div className="grid gap-3">
    <Card>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t.paste} className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
      <div className="mt-2 flex flex-wrap gap-2"><Btn onClick={() => text.trim() && run(text)} disabled={!text.trim()}>{t.extract}</Btn><Btn kind="ghost" disabled>{t.screenshot} · {t.soon}</Btn><Btn kind="ghost" disabled>{t.voice} · {t.soon}</Btn></div>
      <div className="mt-3 text-xs text-slate-500">{t.examples}</div>
      <div className="mt-1 flex flex-wrap gap-2">{[t.ex1, t.ex2, t.ex3, t.ex4].map((lbl, i) => <button key={i} onClick={() => { setText(EXAMPLES[i]); run(EXAMPLES[i]); }} className="rounded-full bg-slate-100 px-3 py-1 text-xs">{lbl}</button>)}</div>
    </Card>
    {msg && <div className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{msg}</div>}
    {cand && draft && <Card className="ring-amber-300">
      <div className="font-semibold">{t.change}</div><div className="text-sm text-slate-500">{cand.order.customerName}{cand.order.collectionAt && ` · ${fmtDay(cand.order.collectionAt, s.locale)} ${fmtTime(cand.order.collectionAt, s.locale)}`}</div>
      <div className="mt-2 grid gap-1 text-sm">{cand.diffs.map((d, i) => <div key={i} className="flex justify-between rounded-lg bg-amber-50 px-3 py-2"><span>{d.label === "time" ? t.collection : (pname(s.products.find((p) => p.name === d.label)?.id) ?? d.label)}</span><span className="font-semibold"><s className="text-slate-400">{d.label === "time" ? fmtTime(d.oldValue, s.locale) : d.oldValue}</s> → {d.label === "time" ? fmtTime(d.newValue, s.locale) : d.newValue}</span></div>)}</div>
      <div className="mt-3 flex gap-2"><Btn onClick={() => confirmChange(cand)}>{t.confirmChange}</Btn><Btn kind="soft" onClick={() => setCand(null)}>{t.newOrder}</Btn><Btn kind="ghost" onClick={() => { setDraft(null); setCand(null); }}>{t.discard}</Btn></div>
    </Card>}
    {draft && !cand && <DraftCard d={draft} s={s} t={t} onChange={setDraft} onConfirm={() => confirmDraft(draft)} onDiscard={() => setDraft(null)} />}
  </div>;
}

function DraftCard({ d, s, t, onChange, onConfirm, onDiscard }: { d: Draft; s: Saved; t: Tx; onChange: (d: Draft) => void; onConfirm: () => void; onDiscard: () => void }) {
  const warn = (c: string) => (c === "low" ? "ring-2 ring-amber-400 bg-amber-50" : "border border-slate-200");
  const setItem = (i: number, p: Partial<DraftItem>) => onChange({ ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...p, confidence: "high" } : it)) });
  const ok = !!d.customerName && d.items.some((i) => (i.quantity ?? 0) > 0);
  return <Card>
    <div className="font-semibold">{t.draft}</div><div className="text-xs text-slate-500">{t.check}</div>
    <label className="mt-3 block text-xs text-slate-500">{t.customer}</label>
    <input value={d.customerName ?? ""} onChange={(e) => onChange({ ...d, customerName: e.target.value, customerConfidence: "high" })} className={`w-full rounded-xl p-2 text-sm ${warn(d.customerConfidence)}`} />
    <label className="mt-3 block text-xs text-slate-500">{t.items}</label>
    <div className="grid gap-2">{d.items.map((it, i) => <div key={i} className="flex gap-2">
      <select value={it.productId ?? ""} onChange={(e) => setItem(i, { productId: e.target.value || undefined })} className={`flex-1 rounded-xl p-2 text-sm ${warn(it.productId ? "high" : "low")}`}><option value="">{t.free}: {it.rawText}</option>{s.products.map((p) => <option key={p.id} value={p.id}>{s.locale === "ar" ? p.nameAr : p.name}</option>)}</select>
      <input type="number" min={0} value={it.quantity ?? ""} onChange={(e) => setItem(i, { quantity: e.target.value ? Number(e.target.value) : undefined })} placeholder={t.qty} className={`w-20 rounded-xl p-2 text-sm ${warn(it.confidence)}`} />
      <button onClick={() => onChange({ ...d, items: d.items.filter((_, k) => k !== i) })} className="text-slate-400">✕</button>
    </div>)}</div>
    <button onClick={() => onChange({ ...d, items: [...d.items, { rawText: "", confidence: "low" }] })} className="mt-2 text-sm text-teal-700">+ {t.addItem}</button>
    <label className="mt-3 block text-xs text-slate-500">{t.collection}</label>
    <input type="datetime-local" value={toInput(d.collectionAt)} onChange={(e) => onChange({ ...d, collectionAt: e.target.value ? new Date(e.target.value).toISOString() : undefined, collectionConfidence: "high" })} className={`w-full rounded-xl p-2 text-sm ${warn(d.collectionConfidence)}`} />
    <label className="mt-3 block text-xs text-slate-500">{t.notes}</label>
    <input value={d.notes ?? ""} onChange={(e) => onChange({ ...d, notes: e.target.value })} className="w-full rounded-xl border border-slate-200 p-2 text-sm" />
    <div className="mt-4 flex gap-2"><Btn onClick={onConfirm} disabled={!ok}>{t.confirm}</Btn><Btn kind="ghost" onClick={onDiscard}>{t.discard}</Btn></div>
  </Card>;
}

function Orders({ s, t, patch, pname }: { s: Saved; t: Tx; patch: (p: Partial<Saved>) => void; pname: (id?: string) => string | undefined }) {
  const [f, setF] = useState<"all" | "today" | "upcoming" | "done">("all");
  const today = dateKey(new Date());
  const list = s.orders.filter((o) => f === "all" ? true : f === "done" ? o.status === "collected" : o.status !== "collected" && (f === "today" ? o.collectionAt && keyOf(o.collectionAt) === today : !o.collectionAt || keyOf(o.collectionAt) >= today))
    .sort((a, b) => (a.collectionAt ?? "9").localeCompare(b.collectionAt ?? "9"));
  const set = (id: string, status: Order["status"]) => patch({ orders: s.orders.map((o) => (o.id === id ? { ...o, status } : o)) });
  return <div className="grid gap-3">
    <div className="flex gap-2">{(["all", "today", "upcoming", "done"] as const).map((k) => <button key={k} onClick={() => setF(k)} className={`rounded-full px-3 py-1 text-xs ${f === k ? "bg-teal-700 text-white" : "bg-slate-100"}`}>{t[k]}</button>)}</div>
    {list.map((o) => <Card key={o.id}>
      <div className="flex items-center justify-between"><div className="font-semibold">{o.customerName}</div><Badge s={o.status} t={t} /></div>
      <div className="text-sm text-slate-600">{o.items.map((i) => `${pname(i.productId) ?? i.rawText} × ${i.quantity}`).join("، ")}</div>
      <div className="text-xs text-slate-500">{o.collectionAt ? `${fmtDay(o.collectionAt, s.locale)} · ${fmtTime(o.collectionAt, s.locale)}` : <span className="text-amber-700">{t.noTimeShort}</span>}{o.notes && ` · ${o.notes}`}</div>
      {o.changes.length > 0 && <div className="mt-1 text-xs text-amber-700">{o.changes.map((c, i) => <div key={i}>↺ {c}</div>)}</div>}
      {o.status !== "collected" && <div className="mt-2 flex gap-2">{o.status === "confirmed" && <Btn kind="soft" onClick={() => set(o.id, "prepped")}>{t.markPrepped}</Btn>}<Btn kind="ghost" onClick={() => set(o.id, "collected")}>{t.markCollected}</Btn></div>}
    </Card>)}
  </div>;
}

function Plan({ s, t, patch }: { s: Saved; t: Tx; patch: (p: Partial<Saved>) => void }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const [key, setKey] = useState(dateKey(days[0]));
  const plan = buildDayPlan(s.orders, s.products, key, s.capacity, s.locale);
  return <div className="grid gap-3">
    <div className="flex gap-2 overflow-x-auto pb-1">{days.map((d) => { const k = dateKey(d); return <button key={k} onClick={() => setKey(k)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${key === k ? "bg-teal-700 text-white" : "bg-slate-100"}`}>{fmtDay(d.toISOString(), s.locale)}</button>; })}</div>
    <Card className={plan.overCapacity ? "ring-rose-300 bg-rose-50" : ""}><div className="flex items-center justify-between"><div><div className="text-xs text-slate-500">{t.units}</div><div className="text-3xl font-bold text-teal-700">{plan.unitsTotal}</div></div><label className="text-xs text-slate-500">{t.capacity}<input type="number" value={s.capacity} onChange={(e) => patch({ capacity: Number(e.target.value) })} className="ms-2 w-16 rounded-lg border border-slate-200 p-1 text-sm" /></label></div>{plan.overCapacity && <div className="mt-1 text-sm text-rose-700">{t.over} {s.capacity}</div>}</Card>
    {plan.totals.length === 0 && <div className="text-slate-400">{t.empty}</div>}
    {plan.totals.length > 0 && <Card><div className="mb-2 font-semibold">{t.toPrepare}</div><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500"><th className="text-start">{t.items}</th><th>{t.ordered}</th><th>{t.prepare}</th></tr></thead><tbody>{plan.totals.map((r) => <tr key={r.productId} className="border-t border-slate-100"><td className="py-1.5">{s.locale === "ar" ? r.nameAr : r.name}</td><td className="text-center">{r.ordered}</td><td className="text-center font-semibold">{r.toPrepare}{r.batches && <span className="block text-[10px] font-normal text-slate-400">{r.batches} {t.batches} {r.batchSize}</span>}</td></tr>)}</tbody></table></Card>}
    {plan.packaging.length > 0 && <Card><div className="mb-1 font-semibold">{t.packaging}</div><div className="flex flex-wrap gap-2">{plan.packaging.map((p) => <span key={p.name} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{p.name} × {p.qty}</span>)}</div></Card>}
    {plan.slots.length > 0 && <Card><div className="mb-2 font-semibold">{t.byTime}</div>{plan.slots.map((sl) => <div key={sl.time} className="border-t border-slate-100 py-2"><div className="text-sm font-bold text-teal-700">{fmtTime(sl.time, s.locale)}</div>{sl.orders.map((o) => <div key={o.id} className="text-sm"><span className="font-medium">{o.customerName}</span> · {o.lines.map((ln) => `${ln.name} × ${ln.quantity}`).join("، ")}{o.notes && <span className="text-amber-700"> · {o.notes}</span>}</div>)}</div>)}</Card>}
    {plan.noTime.length > 0 && <Card className="ring-amber-300 bg-amber-50"><div className="text-xs font-semibold text-amber-800">{t.noTime}</div>{plan.noTime.map((o) => <div key={o.id} className="text-sm">{o.customerName}</div>)}</Card>}
  </div>;
}

function Products({ s, t, patch }: { s: Saved; t: Tx; patch: (p: Partial<Saved>) => void }) {
  const [name, setName] = useState(""); const [nameAr, setNameAr] = useState(""); const [batch, setBatch] = useState("");
  const add = () => { if (!name.trim()) return; patch({ products: [...s.products, { id: crypto.randomUUID(), name: name.trim(), nameAr: nameAr.trim() || name.trim(), aliases: [], batchSize: batch ? Number(batch) : undefined, packaging: [{ name: "Box", qtyPerUnit: 1 }] }] }); setName(""); setNameAr(""); setBatch(""); };
  return <div className="grid gap-3">
    {s.products.map((p) => <Card key={p.id}><div className="flex items-center justify-between"><div><div className="font-semibold">{s.locale === "ar" ? p.nameAr : p.name}</div><div className="text-xs text-slate-500">{s.locale === "ar" ? p.name : p.nameAr}</div></div><div className="text-end text-xs text-slate-500">{p.batchSize && <div>{t.batch} {p.batchSize}</div>}<div>{p.packaging.map((k) => k.name).join(", ")}</div></div></div></Card>)}
    <Card><div className="grid gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (English)" className="rounded-xl border border-slate-200 p-2 text-sm" /><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="الاسم (عربي)" className="rounded-xl border border-slate-200 p-2 text-sm" /><input value={batch} onChange={(e) => setBatch(e.target.value)} type="number" placeholder={t.batch} className="rounded-xl border border-slate-200 p-2 text-sm" /><Btn onClick={add}>{t.addItem}</Btn></div></Card>
    <Btn kind="ghost" onClick={() => { localStorage.removeItem(KEY); patch({ products: demoProducts(), orders: demoOrders() }); }}>{t.reset}</Btn>
  </div>;
}
