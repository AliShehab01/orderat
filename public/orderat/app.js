'use strict';
// Orderat web: the phone app's five tabs (Today, Orders, New order, Money, Shop) in the browser, at
// https://orderatweb.com/app/. Two modes share these screens:
// - the demo ("Try the demo"): a sample shop stored in this browser's localStorage; AI, sign-in, sync,
//   publishing and payments are simulated, and each screen that fakes one says so;
// - the live shop, after signing in (live.js): the seller's cloud shop, synced with the phones, with
//   the real AI features. `Live.on` tells them apart; live.js holds the sign-in screens and the wiring.
// Labels live in i18n.js, the demo shops in demo.js, the live rules in live-core.js.

const STORE_KEY = 'orderat.web.v1';
const CAMPAIGNS_KEY = 'orderat.web.campaigns';
// The same occasion feed the apps get from orderat-campaigns, read straight from the public repo.
const CAMPAIGNS_URL = 'https://raw.githubusercontent.com/AliShehab01/orderat/main/content/campaigns.json';
const SITE_URL = 'https://orderatweb.com';
const SHOP_PAGE = 'https://orderatweb.com/s/?';
const TRIAL_DAYS = 7;
const PRICE = { monthly: 9.99, yearly: 79.99 };
const CURRENCIES = { BHD: [3, 'BH'], SAR: [2, 'SA'], AED: [2, 'AE'], OMR: [3, 'OM'], KWD: [3, 'KW'], QAR: [2, 'QA'] };
const VAT_RATES = { BH: 10, SA: 15, AE: 5, OM: 5, KW: 0, QA: 0 };
const STATUSES = ['new', 'confirmed', 'ready', 'collected', 'cancelled'];
const NEXT = { new: 'confirmed', confirmed: 'ready', ready: 'collected' };
const NEXT_LABEL = { new: 'orders.confirm', confirmed: 'orders.markReady', ready: 'orders.markCollected' };
const STATUS_TONE = { new: 'neutral', confirmed: 'brand', ready: 'warn', collected: 'ok', cancelled: 'bad' };
const PAY_TONE = { unpaid: 'bad', deposit: 'warn', paid: 'ok' };
const METHODS = ['benefit', 'cash', 'transfer', 'card'];
const EXPENSE_CATS = ['ingredients', 'packaging', 'delivery', 'ads', 'equipment', 'tools', 'rent', 'other'];
const AREAS = ['manama', 'muharraq', 'riffa', 'hamadTown', 'isaTown', 'sitra', 'budaiya', 'adliya', 'saar', 'janabiya', 'other'];
const OCCASION_KINDS = ['ramadan', 'eidAlFitr', 'eidAlAdha', 'bahrainNationalDay', 'gergaoon', 'custom'];
const BUSINESS_TYPES = ['home', 'shop', 'services', 'food', 'foodTruck', 'other'];
const TYPE_ICONS = { home: 'home', shop: 'shop', services: 'scissors', food: 'cup', foodTruck: 'truck', other: 'dots' };
const WA_TEMPLATES = ['confirmOrder', 'orderReady', 'pickupReminder', 'paymentReminder', 'thankYou'];
const RANGES = { week: 7, month: 30, threeMonths: 90, year: 365, all: 0 };
const TABS = ['today', 'orders', 'new', 'money', 'shop'];
const TAKEN_SLUGS = ['sweetstudio', 'demo', 'orderat', 'shop', 'test'];
const STUDIO_STYLES = [
  { id: 'white', ar: 'أبيض نظيف', en: 'Clean white', bg: '#F5F5F5' },
  { id: 'marble', ar: 'رخام', en: 'Marble', bg: '#E8E4DF' },
  { id: 'pastel', ar: 'باستيل ناعم', en: 'Soft pastel', bg: '#F8BBD0' },
  { id: 'wood', ar: 'خشب دافئ', en: 'Warm wood', bg: '#A1887F' },
  { id: 'flowers', ar: 'ورد', en: 'Flowers', bg: '#F48FB1' },
  { id: 'dark', ar: 'فخم داكن', en: 'Dark luxury', bg: '#212121' },
];
const SHAPES = { square: [540, 540], portrait: [540, 675], story: [540, 960] };

const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2m0 15v2M4.6 4.6 6 6m12 12 1.4 1.4M2.5 12h2m15 0h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  orders: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  new: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  money: '<path d="M4 20h16"/><rect x="5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="5" width="3.5" height="12" rx="1"/><rect x="15.5" y="8" width="3.5" height="9" rx="1"/>',
  shop: '<path d="M4 10v10h16V10"/><path d="M3 4h18l-1.2 4.2a3 3 0 0 1-5.6.4 3 3 0 0 1-4.4 0 3 3 0 0 1-5.6-.4L3 4Z"/><path d="M10 20v-5h4v5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  send: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  whatsapp: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M9 9.2c.3 2.4 2.4 4.6 5 5l1.2-1.3-1.8-.9-.8.8c-.9-.4-1.6-1.1-2-2l.8-.8-.9-1.8L9 9.2Z"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".8" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  manual: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  truck: '<path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4m8-4v4M3.5 10h17"/>',
  sparkle: '<path d="M11 3.5 12.6 8l4.4 1.6-4.4 1.6L11 15.7l-1.6-4.5L5 9.6 9.4 8 11 3.5Z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
  megaphone: '<path d="M3.5 10.5v3a1 1 0 0 0 1 1h2l6 4.5v-14l-6 4.5h-2a1 1 0 0 0-1 1Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  box: '<path d="m3.5 7.5 8.5-4 8.5 4-8.5 4-8.5-4Zm0 0v9l8.5 4 8.5-4v-9M12 11.5v9"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2c2 .7 3.5 2.6 3.5 5.8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 10.5 3.8 3.8 0 0 1 18 18H7Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  print: '<path d="M7 9V3.5h10V9M7 17H4v-7.5h16V17h-3"/><rect x="7" y="14" width="10" height="7"/>',
  download: '<path d="M12 3.5v12m-4.5-4.5 4.5 4.5 4.5-4.5M5 20.5h14"/>',
  upload: '<path d="M12 15.5v-12M7.5 8 12 3.5 16.5 8M5 20.5h14"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4m0 3v.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  home: '<path d="M3.5 11 12 4l8.5 7v9h-17v-9Z"/><path d="M9.5 20v-5.5h5V20"/>',
  scissors: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M20 4 8.2 15.8M14.5 14.5 20 20M8.2 8.2 12 12"/>',
  cup: '<path d="M4 8.5h13v4.5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V8.5Z"/><path d="M17 10.5h1.2a2.8 2.8 0 0 1 0 5.6H17M8 3v3M12 3v3"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};
const FLIPPED = new Set(['chev', 'back', 'send']);
function icon(name, cls = '') {
  const c = ['ic', FLIPPED.has(name) ? 'flip' : '', cls].filter(Boolean).join(' ');
  return `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ---------- State ----------

let S = loadState();
let D = null; // the New order draft
let E = null; // the order-items editor's working copy
let lastPath = '';
let ordersFilter = 'all', ordersQuery = '', moneyRange = 'week';
let CAMPAIGNS = readCachedCampaigns(), campaignsFetched = false;
const ST = { photo: null, style: 'white', shape: 'square', result: null, busy: false, left: 3, campaign: null };
const SLUG = { value: '', status: 'idle' };
let slugTimer = 0;
const CAP = { template: 'newItem', pid: '', occ: '', ai: '', busy: false };
const ASK = { msgs: [], busy: false };

function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { s = null; }
  if (!s || s.v !== 1) s = { v: 1, lang: 'ar', addressAs: 'male', theme: 'system', onboarded: false };
  const lang = new URLSearchParams(location.search).get('lang');
  if (lang === 'ar' || lang === 'en') s.lang = lang;
  return s;
}
function save() {
  // The live shop (also while it opens or after it closed): device prefs here, the shop to the cloud,
  // never cloud data into the demo's store.
  if (Live.on || S.live) { Live.save(); return; }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* private mode: the demo still works for this visit */ }
}
function seed(type) {
  S = Object.assign({ v: 1, lang: S.lang, addressAs: S.addressAs, theme: S.theme, onboarded: true }, makeDemoData(type));
  D = null;
  save();
}

// ---------- Helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
// A new record's id: the phones' UUIDs in the live shop, short ids in the demo.
const nid = () => (Live.on ? Live.newId() : uid());
// Staff permissions in the live shop (orders, prepare, status, money, products, owner); all true in the demo.
const can = k => Live.can(k);
const pad = n => String(n).padStart(2, '0');
const round = v => Math.round(v * 1000) / 1000;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const digits = s => String(s || '').replace(/\D/g, '');
const hash = s => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const locale = () => (S.lang === 'en' ? 'en-US' : 'ar-BH-u-nu-latn');
const currency = () => CURRENCIES[S.shop.currency] || CURRENCIES.BHD;
const country = () => currency()[1];
const vatRate = () => (Live.on && typeof S.vat.rateBps === 'number' ? S.vat.rateBps / 100 : VAT_RATES[country()] || 0);
const vatOn = () => S.vat.enabled && vatRate() > 0;
// Wrapped in a left-to-right isolate so Arabic text shows "248.500 BHD", as the apps do, not "BHD 248.500".
const money = v => `\u2066${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: currency()[0], maximumFractionDigits: currency()[0] })} ${S.shop.currency}\u2069`;
const usd = v => `$${v.toFixed(2)}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = k => new Date(`${k}T00:00`);
const inputDateTime = d => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = d => d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDate = d => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = d => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const fmtTime = d => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
const inRange = (iso, a, b) => { const d = new Date(iso); return d >= a && d < b; };

const pick = (ar, en) => (S.lang === 'en' ? en || ar : ar || en);
const text = v => (v && typeof v === 'object' ? v[S.lang] || v.en || '' : v || '');
const pName = p => pick(p.nameAr, p.nameEn);
const shopName = () => pick(S.shop.nameAr, S.shop.nameEn);
const cName = c => (c ? pick(c.name, c.nameEn) : '');
const firstName = c => cName(c).split(' ')[0];
const initial = s => (String(s || '').trim()[0] || 'O').toUpperCase();
const productOf = id => S.products.find(p => p.id === id);
const orderById = id => S.orders.find(o => o.id === id);
const customerOf = o => S.customers.find(c => c.id === o.customerId);
const live = () => S.orders.filter(o => o.status !== 'cancelled');
const byDue = (a, b) => a.dueAt.localeCompare(b.dueAt);
const qtyOf = o => sum(o.items, it => it.qty);
const costOf = o => sum(o.items, it => it.qty * (it.cost || 0));
const itemsLine = o => o.items.map(it => `${it.qty}× ${pick(it.nameAr, it.nameEn)}`).join(S.lang === 'en' ? ', ' : '، ');
// A delivery order's address: the phones' block, road and building (read-only), then the free text.
const addressText = o => [o.addressLine, o.address].map(v => String(v || '').trim()).filter(Boolean).join(', ');
const invoiceNo = o => (Live.on ? Live.invoiceNo(o) : `INV-${new Date(o.dueAt).getFullYear()}-${String(o.no || 0).padStart(4, '0')}`);
// The VAT an order shows: its own snapshot in the live shop (like the phones), the shop setting in the demo.
const orderVatRate = o => (Live.on ? Live.vatOf(o) : vatOn() ? vatRate() : 0);

function totals(o) {
  if (Live.on) return Live.totals(o);
  const gross = sum(o.items, it => it.qty * it.price) + (o.deliveryFee || 0);
  let subtotal = gross, vat = 0, total = gross;
  if (vatOn()) {
    const r = vatRate() / 100;
    if (S.vat.pricesInclude) { vat = gross - gross / (1 + r); subtotal = gross - vat; }
    else { vat = gross * r; total = gross + vat; }
  }
  const paid = sum(o.payments || [], p => p.amount);
  return { subtotal: round(subtotal), vat: round(vat), total: round(total), paid: round(paid), due: Math.max(0, round(total - paid)) };
}
function payStatus(o) {
  const { paid, due } = totals(o);
  return due <= 0 ? 'paid' : paid > 0 ? 'deposit' : 'unpaid';
}
function topItems(orders) {
  const map = new Map();
  orders.forEach(o => o.items.forEach(it => {
    const k = it.pid || it.nameAr;
    const row = map.get(k) || { pid: it.pid, name: pick(it.nameAr, it.nameEn), qty: 0 };
    row.qty += it.qty;
    map.set(k, row);
  }));
  return [...map.values()].sort((a, b) => b.qty - a.qty);
}
function debtors() {
  const map = new Map();
  live().forEach(o => { const due = totals(o).due; if (due > 0) map.set(o.customerId, (map.get(o.customerId) || 0) + due); });
  return [...map].map(([id, amount]) => ({ c: S.customers.find(c => c.id === id), amount: round(amount) })).filter(d => d.c).sort((a, b) => b.amount - a.amount);
}
function periodStats(a, b) {
  const os = live().filter(o => inRange(o.dueAt, a, b));
  const revenue = sum(os, o => totals(o).total), vat = sum(os, o => totals(o).vat), cogs = sum(os, costOf);
  const expenses = sum(S.expenses.filter(x => inRange(x.date, a, b)), x => x.amount);
  return { os, revenue, vat, cogs, expenses, profit: revenue - vat - cogs - expenses, count: os.length, avg: os.length ? revenue / os.length : 0 };
}

const badge = (tone, label) => `<span class="badge ${esc(tone || '')}">${esc(label)}</span>`;
const statusBadge = s => badge(STATUS_TONE[s], t('order.status.' + s));
const payBadge = s => badge(PAY_TONE[s], t('payment.status.' + s));
const sourceTag = s => `<span class="src src-${esc(s)}" title="${esc(t('source.' + s))}">${icon(s)}</span>`;
const empty = msg => `<p class="empty">${esc(msg)}</p>`;
const kpi = (v, label, tone = '', delta = null) => `<div class="kpi${tone ? ' ' + tone : ''}"><b class="kpi-v">${esc(v)}</b><span class="kpi-l">${esc(label)}</span>${delta === null ? '' : `<span class="delta ${delta >= 0 ? 'up' : 'down'}" dir="ltr">${delta >= 0 ? '+' : ''}${delta}%</span>`}</div>`;
const addBtn = (act, label) => `<button class="icon-btn" data-act="${act}" aria-label="${esc(label)}">${icon('plus')}</button>`;
const navRow = (href, ic, label, meta = '') => `<a class="row" href="#/${href}"><span class="row-ic">${icon(ic)}</span><span class="row-main"><b>${esc(label)}</b></span>${meta ? `<span class="muted small">${esc(meta)}</span>` : ''}${icon('chev', 'chev')}</a>`;
const toggle = (name, label, on, live = '') => `<label class="switch-row"><span>${esc(label)}</span><input type="checkbox" role="switch" name="${name}"${on ? ' checked' : ''}${live ? ` data-live="${live}"` : ''}><i class="switch" aria-hidden="true"></i></label>`;
function seg(name, options, value, label, live = '') {
  return `<div class="seg">${options.map(o => `<label><input type="radio" name="${name}" value="${esc(o)}"${o === value ? ' checked' : ''}${live ? ` data-live="${live}"` : ''}><span>${esc(label(o))}</span></label>`).join('')}</div>`;
}
// A field with its error message under it (New order).
const errField = (label, control, error) => `<label class="field"><span>${esc(label)}</span>${control}${error ? `<span class="field-error" role="alert">${esc(error)}</span>` : ''}</label>`;
// New order's errors next to their fields, the first one scrolled to and focused.
function showDraftErrors(errors) {
  D.errors = errors;
  render();
  const first = errors.name ? $('form[data-form="new-order"] input[name="name"]') : $('#d-items');
  if (!first) return;
  first.scrollIntoView({ block: 'center' });
  const focusable = first.matches('input') ? first : first.querySelector('input[data-f="name"]:placeholder-shown, button[data-act="item-pick"]');
  focusable?.focus({ preventScroll: true });
}
// Marks a dialog field invalid, with its message under it, and focuses it.
function fieldError(form, name, msg) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) { toast(msg); return; }
  el.setAttribute('aria-invalid', 'true');
  const box = el.closest('.field') || el.parentElement;
  box.querySelector('.field-error')?.remove();
  const p = document.createElement('span');
  p.className = 'field-error';
  p.setAttribute('role', 'alert');
  p.textContent = msg;
  box.append(p);
  el.focus();
}
const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;
const options = (list, value, label) => list.map(o => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(label(o))}</option>`).join('');

// Created fresh each time, inside the open dialog when there is one: a modal dialog sits in the top
// layer, above anything z-index can reach.
// With an action ({ label, fn }, say Undo) it stays 5 s and its button runs fn once.
function toast(msg, action) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const el = document.createElement('div');
  el.className = action ? 'toast has-action' : 'toast';
  el.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); el.remove(); action.fn(); });
    el.append(b);
  }
  (modalEl().open ? modalEl() : document.body).append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, action ? 5000 : 2600);
}
const undoToast = (msg, fn) => toast(msg, { label: t('common.undo'), fn });
const modalEl = () => $('#modal');
// Something was typed in the open dialog: a stray tap outside (or Esc) asks before throwing it away.
let modalDirty = false;
function openModal(title, body, cls = '') {
  const m = modalEl();
  if (!m.open) modalDirty = false;
  m.className = cls;
  m.innerHTML = `<div class="sheet"><header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="${esc(t('common.close'))}">${icon('x')}</button></header><div class="sheet-body">${body}</div></div>`;
  if (!m.open) m.showModal();
}
function closeModal() {
  const m = modalEl();
  if (m.open) m.close();
}
function copyText(s) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = s;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); toast(t('marketing.copied')); } catch { /* nothing else to try */ }
    ta.remove();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(s).then(() => toast(t('marketing.copied')), fallback);
  else fallback();
}
// The site's own terms and privacy pages, in the app's language.
const legalUrl = page => `${SITE_URL}${S.lang === 'en' ? '/en' : ''}/${page}/`;
const waLink = (phone, msg) => `https://wa.me/${digits(phone)}?text=${encodeURIComponent(msg)}`;

// ---------- Rendering ----------

const route = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/').filter(Boolean);
function go(path) {
  const h = '#/' + path;
  if (location.hash === h) render(); else location.hash = h;
}
const VIEWS = { today: viewToday, orders: viewOrders, new: viewNew, money: viewMoney, shop: viewShop };

function render() {
  const root = document.documentElement;
  root.lang = S.lang;
  root.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  if (S.theme === 'system') delete root.dataset.theme; else root.dataset.theme = S.theme;
  const brand = S.lang === 'en' ? 'Orderat' : 'اوردرات';
  const gate = Live.gate();
  if (gate) {
    $('#app').innerHTML = gate.html;
    document.title = `${gate.title} · ${brand}`;
    lastPath = '';
    gate.after?.();
    return;
  }
  if (!S.onboarded) {
    $('#app').innerHTML = viewOnboarding();
    document.title = `${brand} · ${t('web.demo')}`;
    return;
  }
  const r = route();
  const tab = VIEWS[r[0]] && tabShown(r[0]) ? r[0] : 'today';
  const v = VIEWS[tab](r.slice(1));
  $('#app').innerHTML = shell(tab, v);
  document.body.classList.toggle('route-new', tab === 'new');
  document.title = `${v.title} · ${brand}`;
  const path = r.join('/');
  if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
  Live.afterRender();
}
// Staff without `orders` get no New order tab, without `money` no Money tab (RootView on the phones).
const tabShown = id => (id === 'new' ? can('orders') : id === 'money' ? can('money') : true);

function shell(tab, v) {
  const nav = cls => TABS.filter(tabShown).map(id => `<a class="${cls}${id === tab ? ' on' : ''}${id === 'new' ? ' is-new' : ''}" href="#/${id}"${id === tab ? ' aria-current="page"' : ''}>${icon(id)}<span>${esc(t('tab.' + id))}</span></a>`).join('');
  const langBtn = cls => `<button class="${cls}" data-act="lang" lang="${S.lang === 'ar' ? 'en' : 'ar'}">${icon('globe')} <span>${esc(t('web.switchLang'))}</span></button>`;
  return `<div class="app">
  <aside class="side">
    <a class="brand" href="#/today"><img src="favicon.svg" width="36" height="36" alt=""><span><b>${S.lang === 'en' ? 'Orderat' : 'اوردرات'}</b><small>${esc(t(Live.on ? 'live.brand' : 'web.demo'))}</small></span></a>
    <a class="side-shop" href="#/shop"><span class="avatar">${esc(initial(shopName()))}</span><span class="row-main"><b>${esc(shopName())}</b><small>${esc(t('businessType.' + S.shop.businessType))}</small></span></a>
    <nav class="side-nav" aria-label="Orderat">${nav('side-link')}</nav>
    <div class="side-foot">
      ${langBtn('pill')}
      <a class="pill" href="${SITE_URL}${S.lang === 'en' ? '/en/' : '/'}" target="_blank" rel="noopener">${icon('external')} <span>${esc(t('web.about'))}</span></a>
      ${Live.on ? '' : `<a class="pill" href="#/start">${icon('users')} <span>${esc(t('live.logIn'))}</span></a>`}
      <p class="muted small">${esc(t(Live.on ? 'live.note' : 'web.demoNote'))}</p>
    </div>
  </aside>
  <main class="main">
    <header class="top">
      ${v.back ? `<a class="icon-btn" href="#/${v.back}" aria-label="${esc(t('common.back'))}">${icon('back')}</a>` : ''}
      <div class="top-title"><h1>${esc(v.title)}</h1>${v.sub ? `<p>${esc(v.sub)}</p>` : ''}</div>
      <div class="top-actions">${v.actions || ''}${v.back ? '' : langBtn('icon-btn mobile-only lang-btn')}</div>
    </header>
    <div class="content">${v.body}</div>
  </main>
  <nav class="tabbar" aria-label="Orderat">${nav('tab')}</nav>
</div>`;
}

function viewOnboarding() {
  return `<div class="onb"><div class="onb-card">
    <div class="onb-head"><img src="favicon.svg" width="56" height="56" alt=""><button class="pill" data-act="lang">${icon('globe')} ${esc(t('web.switchLang'))}</button></div>
    <p class="kicker">${esc(t('web.demo'))}</p>
    <h1>${esc(t('onboarding.businessType.title'))}</h1>
    <p class="muted">${esc(t('onboarding.businessType.subtitle'))}</p>
    <div class="types">${BUSINESS_TYPES.map(bt => `<button class="type" data-act="pick-type" data-type="${bt}"><span class="type-ic">${icon(TYPE_ICONS[bt])}</span><span class="row-main"><b>${esc(t('businessType.' + bt))}</b><small>${esc(t('businessType.' + bt + '.examples'))}</small></span></button>`).join('')}</div>
    <p class="note">${esc(t('onboarding.sample'))}</p>
    <button class="btn ghost block" data-act="live-back-start">${icon('back')} ${esc(t('common.back'))}</button>
  </div></div>`;
}

// ---------- Today ----------

function viewToday() {
  loadCampaigns();
  const now = new Date(), today = startOfDay(now), tomorrow = addDays(today, 1);
  const todays = live().filter(o => inRange(o.dueAt, today, tomorrow));
  const toPrepare = sum(todays.filter(o => o.status === 'new' || o.status === 'confirmed'), qtyOf);
  const unpaid = sum(live(), o => totals(o).due);
  const upcoming = S.orders.filter(o => !['collected', 'cancelled'].includes(o.status) && new Date(o.dueAt) >= today).sort(byDue).slice(0, 6);
  const low = S.stockEnabled ? S.products.filter(p => p.track && p.qty <= p.low) : [];
  const occ = S.occasions.filter(x => x.end >= dayKey(now)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  const camp = todayCampaign();
  const cards = [
    S.askEnabled && can('money') ? `<button class="card ask-card" data-act="ask"><span class="ask-ic">${icon('sparkle')}</span><span class="row-main"><b>${esc(t('ask.cardTitle'))}</b><small>${esc(t('ask.cardSubtitle'))}</small></span>${icon('chev', 'chev')}</button>` : '',
    camp ? campaignCard(camp) : '',
    webOrdersCard(),
    S.isDemo ? `<div class="card demo-banner"><p>${esc(t('today.demoHint', TRIAL_DAYS))}</p><button class="btn primary small" data-act="paywall">${esc(t('today.demoCta'))}</button></div>` : '',
    `<div class="kpis ${can('money') ? 'three' : 'two'}">${kpi(todays.length, t('today.orders'))}${kpi(toPrepare, t('today.toPrepare'))}${can('money') ? kpi(money(unpaid), t('today.unpaid'), unpaid > 0 ? 'bad' : '') : ''}</div>`,
    S.shop.dailyCapacity ? capacityCard(sum(todays, qtyOf), S.shop.dailyCapacity) : '',
    low.length ? `<section class="card"><h3 class="card-title warn-text">${icon('alert')} ${esc(t('today.lowStock'))}</h3>${low.map(p => `<a class="row" href="#/shop/menu"><span class="row-main"><b>${esc(pName(p))}</b></span>${badge(p.qty <= 0 ? 'bad' : 'warn', t('stock.qtyBadge', p.qty))}</a>`).join('')}</section>` : '',
    `<section class="card"><h3 class="card-title">${esc(t('today.nextPickups'))}</h3>${upcoming.length ? `<div class="list">${upcoming.map(o => orderRow(o, true)).join('')}</div>` : empty(t('today.allCaughtUp'))}</section>`,
    occ.length ? `<section class="card"><h3 class="card-title">${esc(t('today.occasions'))}</h3>${occ.map(x => occasionRow(x)).join('')}</section>` : '',
  ];
  return { title: t('tab.today'), sub: fmtDay(now), body: `<div class="stack">${cards.join('')}</div>` };
}

function capacityCard(booked, cap) {
  const pct = Math.min(100, Math.round((booked / cap) * 100));
  return `<section class="card"><div class="split"><h3 class="card-title">${esc(t('today.capacity'))}</h3><b dir="ltr">${booked} / ${cap}</b></div><div class="meter"><span class="${pct >= 90 ? 'full' : ''}" style="width:${pct}%"></span></div><p class="muted small">${esc(t('today.capacityOf', booked, cap))}</p></section>`;
}

function orderRow(o, withDay = false) {
  const d = new Date(o.dueAt);
  const when = withDay ? `${fmtShort(d)} · ${fmtTime(d)}` : fmtTime(d);
  return `<a class="row order-row" href="#/orders/${esc(o.id)}"><span class="row-main"><b>${esc(cName(customerOf(o)))}</b><small>${sourceTag(o.source)}<span>${esc(when)}${o.fulfillment === 'delivery' ? ' · ' + esc(t('orders.delivery')) : ''}</span></small></span><span class="row-end"><b class="amt">${esc(money(totals(o).total))}</b>${statusBadge(o.status)}</span>${icon('chev', 'chev')}</a>`;
}

function occasionRow(x, withDelete = false) {
  const range = x.start === x.end ? fmtShort(parseDay(x.start)) : `${fmtShort(parseDay(x.start))} – ${fmtShort(parseDay(x.end))}`;
  const meta = [range, x.cap ? t('occasion.capacity', x.cap) : '', x.blocked ? t('occasion.blocked') : ''].filter(Boolean).join(' · ');
  return `<div class="row"><span class="row-ic">${icon('calendar')}</span><span class="row-main"><b>${esc(pick(x.nameAr, x.nameEn))}</b><small>${esc(meta)}</small></span>${withDelete ? `<button class="icon-btn" data-act="delete-occasion" data-id="${esc(x.id)}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button>` : ''}</div>`;
}

function webOrdersCard() {
  if (!S.webOrders?.length) return '';
  const rows = S.webOrders.map(w => {
    const d = new Date(w.dueAt);
    const items = w.items.map(it => { const p = productOf(it.pid); return p ? `${it.qty}× ${pName(p)}` : ''; }).filter(Boolean).join(S.lang === 'en' ? ', ' : '، ');
    return `<div class="row web-order"><span class="row-main"><b>${esc(pick(w.name, w.nameEn))}</b><small>${esc(items)} · ${esc(fmtShort(d))} ${esc(fmtTime(d))}</small></span><span class="row-actions"><button class="btn primary small" data-act="web-add" data-id="${esc(w.id)}">${esc(t('today.webOrderAdd'))}</button><button class="btn ghost small" data-act="web-dismiss" data-id="${esc(w.id)}">${esc(t('today.webOrderDismiss'))}</button></span></div>`;
  }).join('');
  return `<section class="card"><h3 class="card-title">${icon('link')} ${esc(t('today.webOrders'))}</h3>${rows}</section>`;
}

// ---------- Campaigns feed ----------

function readCachedCampaigns() {
  try { return JSON.parse(localStorage.getItem(CAMPAIGNS_KEY))?.campaigns || null; } catch { return null; }
}
function loadCampaigns() {
  if (campaignsFetched) return;
  campaignsFetched = true;
  fetch(CAMPAIGNS_URL)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(d => {
      CAMPAIGNS = Array.isArray(d.campaigns) ? d.campaigns : [];
      try { localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify({ campaigns: CAMPAIGNS })); } catch { /* the cache is optional */ }
    })
    .catch(() => { if (!CAMPAIGNS) CAMPAIGNS = []; })
    .finally(() => {
      const r = route();
      if (S.onboarded && (r[0] === 'today' || r[2] === 'campaigns') && !modalEl().open) render();
    });
}
const countryCampaigns = () => (CAMPAIGNS || []).filter(c => c.countries?.includes(country()) && c.endDate >= dayKey(new Date())).sort((a, b) => a.startDate.localeCompare(b.startDate));
function todayCampaign() {
  const k = dayKey(new Date());
  return countryCampaigns().find(c => c.promoteFrom <= k && !S.hiddenCampaigns.includes(c.id));
}
function countdown(c) {
  const k = dayKey(new Date());
  if (c.startDate <= k) return c.startDate === c.endDate ? t('campaign.today') : t('campaign.ongoing');
  return t('campaign.daysUntil', Math.round((parseDay(c.startDate) - startOfDay(new Date())) / 864e5));
}
function campaignCard(c) {
  return `<div class="card camp-card" style="--camp:${esc(c.accent || '#4a5fdc')}"><a class="row" href="#/shop/marketing/campaigns/${esc(c.id)}"><span class="camp-emoji">${esc(c.emoji || '')}</span><span class="row-main"><b>${esc(text(c.name))}</b><small>${esc(countdown(c))} · ${esc(text(c.headline))}</small></span>${icon('chev', 'chev')}</a><button class="link-btn small" data-act="hide-campaign" data-id="${esc(c.id)}">${esc(t('campaign.hideFromToday'))}</button></div>`;
}

// ---------- Orders ----------

function viewOrders(rest) {
  if (rest[0]) return viewOrder(rest[0]);
  const chips = ['all', ...STATUSES].map(s => `<button class="chip${ordersFilter === s ? ' on' : ''}" data-act="orders-filter" data-v="${esc(s)}">${esc(s === 'all' ? t('orders.filterAll') : t('order.status.' + s))}</button>`).join('');
  return {
    title: t('tab.orders'),
    actions: can('orders') ? `<a class="icon-btn" href="#/new" aria-label="${esc(t('tab.new'))}">${icon('plus')}</a>` : '',
    body: `<label class="search">${icon('search')}<input type="search" data-live="orders-q" value="${esc(ordersQuery)}" placeholder="${esc(t('common.search'))}" aria-label="${esc(t('common.search'))}"></label><div class="chips">${chips}</div><div id="orders-list">${ordersListHtml()}</div>`,
  };
}
function ordersListHtml() {
  const q = ordersQuery.trim().toLowerCase();
  const matches = o => {
    const c = customerOf(o);
    return [c?.name, c?.nameEn, c?.phone, ...o.items.flatMap(it => [it.nameAr, it.nameEn])].some(v => String(v || '').toLowerCase().includes(q));
  };
  const list = S.orders.filter(o => (ordersFilter === 'all' || o.status === ordersFilter) && (!q || matches(o))).sort((a, b) => byDue(b, a));
  if (!list.length) return empty(t(S.orders.length ? 'orders.noMatch' : 'orders.empty'));
  const groups = [];
  list.forEach(o => {
    const k = dayKey(new Date(o.dueAt)), g = groups[groups.length - 1];
    if (g && g.k === k) g.list.push(o); else groups.push({ k, list: [o] });
  });
  return groups.map(g => `<h3 class="group-title">${esc(fmtDay(parseDay(g.k)))}</h3><div class="card list">${g.list.map(o => orderRow(o)).join('')}</div>`).join('');
}

// The demo's entries and the phones' (read from the cloud: a payment-status change has no amount).
function historyLabel(ch) {
  const h = OrderatLiveCore.historyLabel(ch);
  if (h.status) return `${t('history.status')}: ${t('order.status.' + h.status)}`;
  if (h.key === 'history.payment') return `${t('history.payment')}: ${money(h.amount)}`;
  if (h.payment) return t(h.key, t('payment.status.' + h.payment));
  return t(h.key);
}
function waMessage(kind, o) {
  const c = customerOf(o), d = new Date(o.dueAt), name = firstName(c), shop = shopName();
  if (kind === 'confirmOrder') return t('whatsapp.message.confirmOrder', name, shop, itemsLine(o), `${fmtDay(d)} ${fmtTime(d)}`);
  if (kind === 'orderReady') return t('whatsapp.message.orderReady', name, shop, itemsLine(o));
  if (kind === 'pickupReminder') return t('whatsapp.message.pickupReminder', name, shop, fmtTime(d));
  if (kind === 'paymentReminder') return t('whatsapp.message.paymentReminder', name, shop, money(totals(o).due));
  return t('whatsapp.message.thankYou', name, shop);
}

function viewOrder(id) {
  const o = orderById(id);
  if (!o) return { title: t('tab.orders'), back: 'orders', body: empty(t('orders.notFound')) };
  const c = customerOf(o), T = totals(o), d = new Date(o.dueAt);
  const open = o.status !== 'collected' && o.status !== 'cancelled';
  const line = (label, value, cls = '') => `<div class="line${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const lines = [
    o.items.map(it => line(`${it.qty}× ${pick(it.nameAr, it.nameEn)}`, money(it.qty * it.price))).join(''),
    o.deliveryFee ? line(t('orders.deliveryFee'), money(o.deliveryFee), 'muted') : '',
    orderVatRate(o) ? line(t('orders.subtotal'), money(T.subtotal), 'muted') + line(t('orders.vatPercent', orderVatRate(o) + '%'), money(T.vat), 'muted') : '',
    line(t('orders.total'), money(T.total), 'total'),
    `<div class="line pay"><span>${esc(t('orders.paid'))} ${esc(money(T.paid))}</span>${o.status === 'cancelled' ? '' : payBadge(payStatus(o))}</div>`,
    (o.payments || []).map(p => `<div class="line small pay-row"><span>${esc(money(p.amount))} · ${esc(t('payment.method.' + p.method))}${p.at ? ` · ${esc(fmtShort(new Date(p.at)))}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</span>${can('orders') ? `<button class="icon-btn" data-act="delete-payment" data-id="${esc(o.id)}" data-pay="${esc(p.id || '')}" data-at="${esc(p.at || '')}" aria-label="${esc(t('pay.delete'))}" title="${esc(t('pay.delete'))}">${icon('trash')}</button>` : ''}</div>`).join(''),
    T.due > 0 && o.status !== 'cancelled' && can('orders') ? `<div class="line"><span class="muted">${esc(t('orders.remaining'))} ${esc(money(T.due))}</span></div><div class="btn-row"><button class="btn ghost" data-act="pay" data-id="${esc(o.id)}">${esc(t('recordPayment'))}</button><button class="btn primary" data-act="pay-full" data-id="${esc(o.id)}">${esc(t('pay.paidInFull'))}</button></div>` : '',
  ].join('');
  const wa = c?.phone
    ? `<div class="chips wrap">${WA_TEMPLATES.map(k => `<a class="chip" href="${esc(waLink(c.phone, waMessage(k, o)))}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(t('whatsapp.template.' + k))}</a>`).join('')}</div>`
    : `<p class="muted small">${esc(t('orders.noPhone'))}</p>`;
  const history = o.changes.slice().reverse().map(ch => { const at = new Date(ch.at); return line(historyLabel(ch), `${fmtShort(at)} ${fmtTime(at)}`, 'small'); }).join('');
  const body = `<div class="stack">
    <section class="card od-head">
      <div class="split"><h2>${esc(fmtDay(d))} · ${esc(fmtTime(d))}</h2>${statusBadge(o.status)}</div>
      <p class="od-meta">${sourceTag(o.source)}<b>${esc(cName(c))}</b>${c?.phone ? `<span dir="ltr">${esc(c.phone)}</span>` : ''}</p>
      <p class="od-meta muted">${icon(o.fulfillment === 'delivery' ? 'truck' : 'bag')}<span>${esc(t('fulfillment.' + o.fulfillment))}${o.area ? ' · ' + esc(t('area.' + o.area)) : ''} · ${esc(t('orders.via', t('source.' + o.source)))}</span></p>
      ${o.fulfillment === 'delivery' && addressText(o) ? `<div class="od-address"><p><span class="muted small">${esc(t('order.address'))}</span><br>${esc(addressText(o))}</p><div class="chips wrap"><button class="chip small" data-act="copy" data-text="${esc(addressText(o))}">${icon('copy')} ${esc(t('order.copyAddress'))}</button><a class="chip small" href="${esc('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([addressText(o), o.area ? t('area.' + o.area) : ''].filter(Boolean).join(', ')))}" target="_blank" rel="noopener">${icon('external')} ${esc(t('order.openMaps'))}</a></div></div>` : ''}
      ${o.notes ? `<p class="od-notes">${esc(o.notes)}</p>` : ''}
    </section>
    <section class="card lines">${lines}</section>
    ${open && can('status') ? `<div class="btn-col">${NEXT[o.status] ? `<button class="btn primary block big" data-act="advance" data-id="${esc(o.id)}">${esc(t(NEXT_LABEL[o.status]))}</button>` : ''}<button class="btn danger-soft block" data-act="cancel-order" data-id="${esc(o.id)}">${esc(t('orders.cancel'))}</button></div>` : ''}
    ${o.status === 'cancelled' && can('status') ? `<button class="btn ghost block" data-act="reopen-order" data-id="${esc(o.id)}">${esc(t('orders.reopen'))}</button>` : ''}
    <section class="card"><h3 class="card-title">${icon('whatsapp')} ${esc(t('orders.sendWhatsApp'))}</h3>${wa}</section>
    <a class="card row" href="#/shop/receipts/${esc(o.id)}"><span class="row-ic">${icon('receipt')}</span><span class="row-main"><b>${esc(t('shop.receipt'))}</b><small><bdi dir="ltr">${esc(invoiceNo(o))}</bdi></small></span>${icon('chev', 'chev')}</a>
    <section class="card"><h3 class="card-title">${esc(t('changeHistory'))}</h3>${history}</section>
    ${canDeleteOrder(o) ? `<button class="btn danger-soft block" data-act="delete-order" data-id="${esc(o.id)}">${icon('trash')} ${esc(t('orders.delete'))}</button>` : ''}
  </div>`;
  const actions = o.status === 'cancelled' || !can('orders') ? '' : `<button class="icon-btn" data-act="edit-items" data-id="${esc(o.id)}" aria-label="${esc(t('orders.editItems'))}">${icon('edit')}</button>`;
  return { title: t('tab.orders'), back: 'orders', actions, body };
}

// Only a mistaken order: still New (or cancelled), nothing paid on it.
const canDeleteOrder = o => can('orders') && (o.status === 'new' || o.status === 'cancelled') && !(o.payments || []).length;
// Stock follows the website's promise: auto-deduct on confirm, put back on cancel.
function applyStock(o, sign) {
  o.items.forEach(it => { const p = productOf(it.pid); if (p && p.track) p.qty = round(p.qty + sign * it.qty); });
}
function setStatus(o, status) {
  if (Live.on) Live.stockForStatus(o, status); // with the phones' stock moves
  else if (S.stockEnabled && status === 'confirmed' && !o.stockApplied) { applyStock(o, -1); o.stockApplied = true; }
  if ((status === 'cancelled' || status === 'new') && o.stockApplied) { applyStock(o, 1); o.stockApplied = false; }
  o.status = status;
  o.changes.push({ kind: 'status', value: status, at: new Date().toISOString() });
  save();
}

function openPayment(o, full) {
  const dec = currency()[0], due = totals(o).due.toFixed(dec);
  openModal(t('recordPayment'), `<form data-form="payment" data-id="${esc(o.id)}" class="stack">
    ${field(t('payment.amount'), `<input name="amount" type="number" inputmode="decimal" step="any" min="0.001" value="${full ? due : ''}" placeholder="${due}" required>`)}
    <div class="field"><span>${esc(t('payment.method'))}</span>${seg('method', METHODS, 'benefit', k => t('payment.method.' + k))}</div>
    ${field(t('payment.note'), '<input name="note">')}
    <button class="btn primary block">${esc(t('common.save'))}</button></form>`);
}

// ---------- Items editor (New order and Edit items) ----------

const itemList = p => (p === 'd' ? D.items : E.items);
const rerenderItems = p => (p === 'd' ? render() : renderEditItems());
const qtyNum = v => Math.max(0, parseInt(v, 10) || 0);
const itemsTotal = items => sum(items, it => qtyNum(it.qty) * (parseFloat(it.price) || 0));
const lineName = it => (it.pid === 'custom' ? it.name : pName(productOf(it.pid) || { nameAr: it.name, nameEn: it.name }));
// Adds a picked product: one more on the line that already has it (merged here only, never when an
// order is cleaned or saved: a phone order may hold two lines of one product at different prices).
function addProduct(list, pid) {
  if (pid === 'custom') { list.push({ pid: 'custom', name: '', qty: 1, price: 0 }); return null; }
  const p = productOf(pid);
  if (!p) return null;
  const line = list.find(it => it.pid === pid);
  if (line) line.qty = qtyNum(line.qty) + 1;
  else list.push({ pid, name: '', qty: 1, price: p.price });
  return line || list[list.length - 1];
}
// Takes a line out, with an Undo that puts it back where it was (while the same editor is still open).
function removeLine(p, i) {
  const list = itemList(p), it = list[i];
  if (!it) return;
  list.splice(i, 1);
  rerenderItems(p);
  undoToast(t('neworder.itemRemoved'), () => {
    if (list !== (p === 'd' ? D && D.items : E && E.items)) return;
    list.splice(Math.min(i, list.length), 0, it);
    if (p === 'e' && !modalEl().open) return;
    rerenderItems(p);
  });
}
// The product picker: active products with their price, an "x2" badge for those already in the order.
function pickerHtml(p) {
  const list = itemList(p), inOrder = pid => sum(list.filter(it => it.pid === pid), it => qtyNum(it.qty));
  const rows = S.products.filter(x => x.active).map(x => `<button type="button" class="row" data-act="item-add" data-p="${p}" data-pid="${esc(x.id)}"><span class="row-main"><b>${esc(pName(x))}</b><small>${esc(money(x.price))}</small></span>${inOrder(x.id) ? badge('brand', `x${inOrder(x.id)}`) : ''}${icon('plus', 'chev')}</button>`).join('');
  return `<div class="card list picker">${rows}<button type="button" class="row" data-act="item-add" data-p="${p}" data-pid="custom"><span class="row-main"><b>${esc(t('neworder.customItem'))}</b></span>${icon('plus', 'chev')}</button></div>`;
}
function openItemPicker(p) {
  if (p === 'e') { E.picking = true; renderEditItems(); return; }
  openModal(t('neworder.pickItem'), pickerHtml(p));
}
function itemsEditor(items, p) {
  const products = S.products.filter(x => x.active);
  const attrs = i => `data-p="${p}" data-i="${i}"`;
  const hint = p === 'd' ? ' enterkeyhint="next"' : '';
  return `<div class="items-ed">${items.map((it, i) => {
    const q = qtyNum(it.qty);
    const gone = it.pid !== 'custom' && !products.some(x => x.id === it.pid);
    const missing = gone ? `<option value="${esc(it.pid)}" selected>${esc(lineName(it))} ${esc(t('items.inactive'))}</option>` : '';
    const minus = q <= 1
      ? `<button type="button" data-act="item-qty" ${attrs(i)} data-d="-1" aria-label="${esc(t('neworder.removeItem'))}">${icon('trash')}</button>`
      : `<button type="button" data-act="item-qty" ${attrs(i)} data-d="-1" aria-label="−">${icon('minus')}</button>`;
    return `<div class="item-row">
    <select data-live="item" ${attrs(i)} data-f="pid" aria-label="${esc(t('neworder.menuItem'))}">${missing}${products.map(x => `<option value="${esc(x.id)}"${x.id === it.pid ? ' selected' : ''}>${esc(pName(x))}</option>`).join('')}<option value="custom"${it.pid === 'custom' ? ' selected' : ''}>${esc(t('neworder.customItem'))}</option></select>
    ${it.pid === 'custom' ? `<input data-live="item" ${attrs(i)} data-f="name" value="${esc(it.name)}" placeholder="${esc(t('neworder.itemName'))}" aria-label="${esc(t('neworder.itemName'))}"${hint}>` : ''}
    <div class="item-controls">
      <div class="stepper">${minus}<input class="qty" type="number" inputmode="numeric" min="1" max="99" step="1" data-live="item" ${attrs(i)} data-f="qty" value="${q}" aria-label="${esc(t('neworder.quantity'))}"${hint}><button type="button" data-act="item-qty" ${attrs(i)} data-d="1" aria-label="+">${icon('plus')}</button></div>
      <input class="price" type="number" inputmode="decimal" step="any" min="0" data-live="item" ${attrs(i)} data-f="price" value="${esc(it.price)}" aria-label="${esc(t('neworder.price'))}"${hint}>
      <button type="button" class="icon-btn" data-act="item-del" ${attrs(i)} aria-label="${esc(t('neworder.removeItem'))}" title="${esc(t('neworder.removeItem'))}">${icon('trash')}</button>
    </div>
  </div>`;
  }).join('')}</div>`;
}
// Lines keep their item id (and cost while on the same product), so a cloud edit changes those lines only.
const cleanItems = items => OrderatLiveCore.cleanItems(items, S.products);
function openEditItems(o) {
  E = { id: o.id, items: o.items.map(it => ({ id: it.id, origPid: it.pid || null, cost: it.cost, pid: it.pid || 'custom', name: pick(it.nameAr, it.nameEn), qty: it.qty, price: it.price })) };
  renderEditItems();
}
function renderEditItems() {
  const sb = $('#modal .sheet-body'), y = sb && modalEl().open ? sb.scrollTop : 0;
  if (E.picking) {
    openModal(t('neworder.pickItem'), `${pickerHtml('e')}<button type="button" class="btn ghost block" data-act="item-pick-back">${icon('back')} ${esc(t('common.back'))}</button>`, 'wide');
    return;
  }
  openModal(t('orders.editItems'), `<form data-form="edit-items" class="stack">${itemsEditor(E.items, 'e')}
    <button type="button" class="btn ghost small" data-act="item-pick" data-p="e">${icon('plus')} ${esc(t('neworder.addItem'))}</button>
    <div class="line total"><span>${esc(t('orders.total'))}</span><b id="e-total">${esc(money(itemsTotal(E.items)))}</b></div>
    <button class="btn primary block">${esc(t('common.save'))}</button></form>`, 'wide');
  const nb = $('#modal .sheet-body');
  if (nb && y) nb.scrollTop = y;
}
function updateTotal(p) {
  const el = $(p === 'd' ? '#d-total' : '#e-total');
  if (el) el.textContent = money(p === 'd' ? draftTotal() : itemsTotal(E.items));
  const save = p === 'd' && $('#d-save');
  if (save) save.disabled = draftEmpty();
}

// ---------- New order ----------

function newDraft() {
  const due = addDays(startOfDay(new Date()), 1);
  due.setHours(17);
  return { text: '', name: '', phone: '', source: 'whatsapp', items: [], due: inputDateTime(due), fulfillment: 'pickup', area: '', address: '', fee: '1', deposit: '', method: 'benefit', notes: '', note: '', reading: false };
}
const draftEmpty = () => !D.items.some(it => qtyNum(it.qty) > 0);
const draftTotal = () => totals({ items: D.items.map(it => ({ qty: qtyNum(it.qty), price: parseFloat(it.price) || 0 })), deliveryFee: D.fulfillment === 'delivery' ? parseFloat(D.fee) || 0 : 0 }).total;

function examples() {
  const ps = S.products.filter(p => p.active);
  if (ps.length < 4) return [];
  const alias = (p, en) => (p.aliases || []).find(a => /^[a-z]/i.test(a) === en) || (en ? p.nameEn : p.nameAr);
  const [a, b, c] = [ps[2], ps[3], ps[0]];
  return S.lang === 'en'
    ? [
      { label: 'Sara', text: `Hi, this is Sara Abdulla 🌸 Can I get 2 ${alias(a, true)} and 1 ${alias(b, true)} for tomorrow at 5? I'll pick up` },
      { label: 'Noora', text: `Hello! 3 ${alias(c, true)} please, delivery to Riffa on Thursday at 7pm. Noora Ahmed 33001002` },
    ]
    : [
      { label: 'سارة', text: `السلام عليكم، معك سارة عبدالله 🌸 أبي 2 ${alias(a, false)} و${alias(b, false)} وحدة، بكرة الساعة 5 استلام` },
      { label: 'نورة', text: `مرحبا، أبغى 3 ${alias(c, false)} توصيل للرفاع يوم الخميس الساعة 7 المغرب. نورة أحمد 33001002` },
    ];
}

function viewNew() {
  if (!D) D = newDraft();
  const ex = Live.on ? [] : examples(); // the samples would spend the shop's real AI quota
  const body = `<div class="stack">
  <section class="card">
    <h3 class="card-title">${icon('whatsapp')} ${esc(t('neworder.pasteTitle'))}</h3>
    <textarea name="text" rows="4" data-live="draft" placeholder="${esc(t('neworder.pasteHint'))}" aria-label="${esc(t('neworder.pasteTitle'))}">${esc(D.text)}</textarea>
    <div class="btn-row">
      <button class="btn primary" data-act="parse"${D.reading || !D.text.trim() ? ' disabled' : ''}>${icon('sparkle')} ${esc(D.reading ? t('neworder.reading') : t('neworder.parse'))}</button>
      <label class="btn ghost">${icon('image')} ${esc(t('neworder.fromScreenshot'))}<input type="file" accept="image/*" data-live="shot" hidden></label>
    </div>
    ${ex.length ? `<div class="examples"><span class="muted small">${esc(t('neworder.tryExample'))}</span>${ex.map((e, i) => `<button class="chip small" data-act="example" data-i="${i}">${icon('whatsapp')} ${esc(e.label)}</button>`).join('')}</div>` : ''}
    ${D.note ? `<p class="ai-note">${icon('sparkle')} ${esc(D.note)}</p>` : ''}
  </section>
  <form data-form="new-order" class="stack" novalidate>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('neworder.customerTitle'))}</h3>
      <div class="grid2">
        ${errField(t('neworder.customerName'), `<input name="name" data-live="draft" enterkeyhint="next" value="${esc(D.name)}" list="customer-names" autocomplete="off"${D.errors?.name ? ' aria-invalid="true"' : ''}>`, D.errors?.name)}
        ${field(t('neworder.customerPhone'), `<input name="phone" data-live="draft" enterkeyhint="next" value="${esc(D.phone)}" dir="ltr" inputmode="tel" autocomplete="off">`)}
      </div>
      <datalist id="customer-names">${S.customers.map(c => `<option value="${esc(cName(c))}">`).join('')}</datalist>
      <div class="field"><span>${esc(t('neworder.source'))}</span>${seg('source', ['whatsapp', 'instagram', 'manual'], D.source, k => t('source.' + k), 'draft')}</div>
    </section>
    <section class="card stack-sm" id="d-items"><h3 class="card-title">${esc(t('neworder.itemsTitle'))}</h3>${D.errors?.items ? `<p class="field-error" role="alert">${esc(D.errors.items)}</p>` : ''}
      ${D.items.length
        ? `${itemsEditor(D.items, 'd')}<button type="button" class="btn ghost small" data-act="item-pick" data-p="d">${icon('plus')} ${esc(t('neworder.addItem'))}</button>`
        : `<div class="items-empty"><p class="muted small">${esc(t('neworder.needItem'))}</p><button type="button" class="btn primary" data-act="item-pick" data-p="d">${icon('plus')} ${esc(t('neworder.addFirstItem'))}</button></div>`}
    </section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('neworder.scheduleTitle'))}</h3>
      ${field(t('neworder.dueAt'), `<input type="datetime-local" name="due" enterkeyhint="next" data-live="draft" value="${esc(D.due)}">`)}
      <div class="field"><span>${esc(t('neworder.fulfillment'))}</span>${seg('fulfillment', ['pickup', 'delivery'], D.fulfillment, k => t('fulfillment.' + k), 'draft')}</div>
      ${D.fulfillment === 'delivery' ? `<div class="grid2">${field(t('shop.area'), `<select name="area" data-live="draft"><option value="">${esc(t('shop.areaNone'))}</option>${options(AREAS, D.area, a => t('area.' + a))}</select>`)}${field(t('orders.deliveryFee'), `<input name="fee" type="number" enterkeyhint="next" step="any" min="0" inputmode="decimal" data-live="draft" value="${esc(D.fee)}">`)}</div>${field(t('order.address'), `<textarea name="address" rows="2" maxlength="200" data-live="draft" autocomplete="street-address">${esc(D.address || '')}</textarea>`)}` : ''}
    </section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('neworder.paymentTitle'))}</h3>
      <div class="grid2">
        ${field(t('neworder.depositOptional'), `<input name="deposit" type="number" enterkeyhint="next" step="any" min="0" inputmode="decimal" data-live="draft" value="${esc(D.deposit)}">`)}
        ${field(t('payment.method'), `<select name="method" data-live="draft">${options(METHODS, D.method, m => t('payment.method.' + m))}</select>`)}
      </div>
    </section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('neworder.notesTitle'))}</h3><textarea name="notes" rows="2" data-live="draft" aria-label="${esc(t('neworder.notesTitle'))}">${esc(D.notes)}</textarea></section>
    <div class="save-bar"><span>${esc(t('orders.total'))} <b id="d-total">${esc(money(draftTotal()))}</b></span><button class="btn primary big" id="d-save"${draftEmpty() ? ' disabled' : ''}>${esc(t('neworder.save'))}</button></div>
  </form></div>`;
  const actions = `<button class="btn ghost small" data-act="clear-draft">${esc(t('neworder.clear'))}</button>`;
  return { title: t('tab.new'), back: 'today', actions, body };
}

// A small on-device reader standing in for the apps' AI order entry (orderat-parse): matches menu
// items and their aliases, quantities, the day and time, a known customer or phone, and pickup or
// delivery. The screen labels its result as a demo.
const NUM_WORDS = { 'واحد': 1, 'واحده': 1, 'وحده': 1, 'حبه': 1, 'اثنين': 2, 'ثنين': 2, 'ثنتين': 2, 'اثنتين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'a': 1, 'an': 1 };
const WEEKDAYS = [['الاحد', 'sunday'], ['الاثنين', 'monday'], ['الثلاثا', 'tuesday'], ['الاربعا', 'wednesday'], ['الخميس', 'thursday'], ['الجمعه', 'friday'], ['السبت', 'saturday']];
const AREA_WORDS = { manama: ['منامه', 'manama'], muharraq: ['محرق', 'muharraq'], riffa: ['رفاع', 'riffa'], hamadTown: ['مدينه حمد', 'hamad town'], isaTown: ['مدينه عيسي', 'isa town'], sitra: ['ستره', 'sitra'], budaiya: ['بديع', 'budaiya'], adliya: ['عدليه', 'adliya'], janabiya: ['جنبيه', 'janabiya'] };
const norm = s => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const cleanWord = w => (w || '').replace(/[،,.!?؟]/g, '');

function qtyNear(s, i, len) {
  const before = s.slice(Math.max(0, i - 14), i), after = s.slice(i + len, i + len + 16);
  let m = before.match(/(\d{1,3})\s*(?:x|×|\*)?\s*$/);
  if (m) return Math.min(99, +m[1]);
  m = after.match(/^\s*(?:x|×|\*)\s*(\d{1,3})/) || after.match(/^\s*(\d{1,2})(?![\d:.]|\s*(?:am|pm)\b)/);
  if (m) return Math.min(99, +m[1]);
  const wb = before.match(/(\S+)\s*$/), wa = after.match(/^\s*(\S+)/);
  if (wb && NUM_WORDS[cleanWord(wb[1])]) return NUM_WORDS[cleanWord(wb[1])];
  if (wa && !['a', 'an'].includes(cleanWord(wa[1])) && NUM_WORDS[cleanWord(wa[1])]) return NUM_WORDS[cleanWord(wa[1])];
  return 1;
}

function parseMessage(raw) {
  const s = norm(raw);
  const found = [];
  S.products.filter(p => p.active).forEach(p => {
    const names = [...new Set([p.nameAr, p.nameEn, ...(p.aliases || [])].map(norm).filter(n => n.length >= 3))];
    names.forEach(n => { for (let i = s.indexOf(n); i >= 0; i = s.indexOf(n, i + 1)) found.push({ p, i, len: n.length }); });
  });
  // Longest names first, so "تشيز كيك" wins over the "كيك" inside it; one match per product.
  found.sort((a, b) => b.len - a.len || a.i - b.i);
  const spans = [], used = new Set(), items = [];
  found.forEach(f => {
    if (used.has(f.p.id) || spans.some(([a, b]) => f.i < b && f.i + f.len > a)) return;
    spans.push([f.i, f.i + f.len]);
    used.add(f.p.id);
    items.push({ pos: f.i, pid: f.p.id, name: '', qty: qtyNear(s, f.i, f.len), price: f.p.price });
  });
  items.sort((a, b) => a.pos - b.pos);

  const cc = OrderatLiveCore.callingCode(S.shop.currency);
  const ph = norm(raw).match(new RegExp(String.raw`(?:\+?${cc}[\s-]?)?(\d{${OrderatLiveCore.localDigits(S.shop.currency)}})(?!\d)`));
  let customer = ph ? S.customers.find(c => digits(c.phone).endsWith(ph[1])) : null;
  if (!customer) customer = S.customers.find(c => [c.name, c.nameEn].some(n => n && s.includes(norm(n))));
  let name = customer ? cName(customer) : '';
  if (!name) {
    const m = raw.match(/(?:معك|معاك|اسمي|this is|my name is|i am|i'm)\s+([^\s،,.!?\d]+(?:\s+[^\s،,.!?\d]+)?)/i);
    if (m) name = m[1];
  }

  const now = new Date();
  let day = null;
  if (/بعد بكره|بعد باكر|day after tomorrow/.test(s)) day = 2;
  else if (/بكره|باكر|tomorrow/.test(s)) day = 1;
  else if (/اليوم|الليله|today|tonight/.test(s)) day = 0;
  else {
    const w = WEEKDAYS.findIndex(names => names.some(n => s.includes(n)));
    if (w >= 0) day = ((w - now.getDay() + 7) % 7) || 7;
  }
  const tm = s.match(/(?:الساعه|ساعه|at|@)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(am|pm|ص|م|صباحا|الصبح|الظهر|العصر|المغرب|مساء|بالليل|الليل)(?=$|[\s،,.!?؟]))?/)
    || s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?=$|[\s،,.!?؟])/);
  let due = '';
  if (day !== null || tm) {
    let h = 17, mi = 0;
    if (tm) {
      h = +tm[1]; mi = +(tm[2] || 0);
      const mark = tm[3] || '', pm = /pm|م|مساء|العصر|المغرب|الليل|الظهر/.test(mark), am = /am|ص|صباح|الصبح/.test(mark);
      if (pm && h < 12) h += 12;
      else if (am && h === 12) h = 0;
      else if (!pm && !am && h >= 1 && h <= 7) h += 12; // "at 5" almost always means the evening
    }
    let base = startOfDay(now);
    if (day !== null) base = addDays(base, day);
    else if (h * 60 + mi <= now.getHours() * 60 + now.getMinutes()) base = addDays(base, 1);
    base.setHours(Math.min(h, 23), Math.min(mi, 59));
    due = inputDateTime(base);
  }
  const fulfillment = /توصيل|deliver/.test(s) ? 'delivery' : /استلام|pick ?up|collect/.test(s) ? 'pickup' : '';
  const area = Object.keys(AREA_WORDS).find(k => AREA_WORDS[k].some(w => s.includes(w))) || '';
  return { items: items.map(({ pos, ...it }) => it), name, phone: customer?.phone || (ph ? '+' + cc + ph[1] : ''), due, fulfillment, area };
}

function readDraft(source, note) {
  D.reading = true;
  D.note = '';
  render();
  setTimeout(() => {
    const r = parseMessage(source);
    if (r.items.length) D.items = r.items;
    ['name', 'phone', 'due', 'fulfillment', 'area'].forEach(k => { if (r[k]) D[k] = r[k]; });
    D.note = r.items.length ? note : t('neworder.noMatch');
    D.reading = false;
    if (route()[0] === 'new') render();
  }, 800);
}

// ---------- Money ----------

function revenueBuckets(start, today) {
  const os = live();
  const total = (a, b) => sum(os.filter(o => inRange(o.dueAt, a, b)), o => totals(o).total);
  const out = [];
  if (moneyRange === 'week' || moneyRange === 'month') {
    for (let d = start; d <= today; d = addDays(d, 1)) out.push({ label: String(d.getDate()), value: total(d, addDays(d, 1)) });
  } else if (moneyRange === 'threeMonths') {
    for (let d = start; d <= today; d = addDays(d, 7)) out.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, value: total(d, addDays(d, 7)) });
  } else {
    for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= today; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      out.push({ label: m.toLocaleDateString(locale(), { month: 'short' }), value: total(m < start ? start : m, new Date(m.getFullYear(), m.getMonth() + 1, 1)) });
    }
  }
  return out;
}
function barChart(buckets) {
  const max = Math.max(...buckets.map(b => b.value), 1);
  const exp = 10 ** Math.floor(Math.log10(max)), f = max / exp;
  const mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10, top = mult * exp, steps = mult === 2 ? 4 : 5;
  // Drawn narrower on phones so the axis labels stay readable once the SVG scales to fit.
  const W = window.innerWidth < 600 ? 360 : 640, H = 230, L = 46, B = 26, T = 10, n = buckets.length;
  const slot = (W - L) / n, bw = Math.max(3, Math.min(26, slot * 0.56)), every = Math.ceil(n / (W < 600 ? 7 : 10));
  const y = v => H - B - (v / top) * (H - B - T);
  const grid = Array.from({ length: steps + 1 }, (_, i) => (top * i) / steps).map(v => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}</text>`).join('');
  const bars = buckets.map((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    return `<rect x="${x.toFixed(1)}" y="${y(b.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - B - y(b.value)).toFixed(1)}" rx="${(bw / 3).toFixed(1)}"><title>${esc(b.label)}: ${esc(money(b.value))}</title></rect>${i % every === 0 ? `<text class="x" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>` : ''}`;
  }).join('');
  return `<div class="chart" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('money.revenueChart'))}"><g class="grid">${grid}</g><g class="bars">${bars}</g></svg></div>`;
}

function viewMoney() {
  const today = startOfDay(new Date()), end = addDays(today, 1), n = RANGES[moneyRange];
  const first = S.orders.reduce((m, o) => (o.dueAt < m ? o.dueAt : m), new Date().toISOString());
  const start = n ? addDays(today, -(n - 1)) : startOfDay(new Date(first));
  const cur = periodStats(start, end);
  const prev = n ? periodStats(addDays(start, -n), start) : null;
  const delta = prev && prev.revenue > 0 ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100) : null;
  const chips = Object.keys(RANGES).map(k => `<button class="chip${moneyRange === k ? ' on' : ''}" data-act="money-range" data-v="${k}">${esc(t('money.range.' + k))}</button>`).join('');
  const top = topItems(cur.os).slice(0, 5);
  const counts = new Map();
  cur.os.forEach(o => counts.set(o.customerId, (counts.get(o.customerId) || 0) + 1));
  const repeat = [...counts].filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const owes = debtors().slice(0, 6);
  const expenses = S.expenses.filter(x => inRange(x.date, start, end)).sort((a, b) => b.date.localeCompare(a.date));
  const body = `<div class="stack">
    <div class="chips">${chips}</div>
    <div class="kpis four">${kpi(money(cur.revenue), t('money.revenue'), '', delta)}${kpi(money(cur.profit), t('money.profit'), cur.profit < 0 ? 'bad' : 'ok')}${kpi(cur.count, t('tab.orders'))}${kpi(money(cur.avg), t('money.avgOrder'))}</div>
    ${vatOn() ? `<div class="card split"><span>${esc(t('money.vatCollected'))}</span><b>${esc(money(cur.vat))}</b></div>` : ''}
    <section class="card"><h3 class="card-title">${esc(t('money.revenueChart'))}</h3>${cur.count ? barChart(revenueBuckets(start, today)) : empty(t('money.noSales'))}</section>
    <div class="grid2">
      <section class="card"><h3 class="card-title">${esc(t('money.topProducts'))}</h3>${top.length ? top.map(x => `<div class="line"><span>${esc(x.name)}</span><b dir="ltr">×${x.qty}</b></div>`).join('') : empty(t('money.noSales'))}</section>
      <section class="card"><h3 class="card-title">${esc(t('money.repeatCustomers'))}</h3>${repeat.length ? repeat.map(([id, k]) => `<div class="line"><span>${esc(cName(S.customers.find(c => c.id === id)))}</span><span class="muted">${esc(t('shop.orderCount', k))}</span></div>`).join('') : empty(t('money.noRepeat'))}</section>
    </div>
    <section class="card"><h3 class="card-title">${esc(t('money.whoOwesMe'))}</h3>${owes.length ? owes.map(d => `<div class="line"><span>${esc(cName(d.c))} · <b>${esc(money(d.amount))}</b></span>${d.c.phone ? `<a class="chip small" href="${esc(waLink(d.c.phone, t('whatsapp.message.paymentReminder', firstName(d.c), shopName(), money(d.amount))))}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(t('money.remind'))}</a>` : ''}</div>`).join('') : empty(t('money.nobodyOwes'))}</section>
    <section class="card"><div class="split"><h3 class="card-title">${esc(t('money.expenses'))} · ${esc(money(cur.expenses))}</h3><button class="btn ghost small" data-act="add-expense">${icon('plus')} ${esc(t('money.addExpense'))}</button></div>
      ${expenses.length ? `<div class="list">${expenses.map(x => `<button class="row" data-act="edit-expense" data-id="${esc(x.id)}"${can('money') ? '' : ' disabled'}><span class="row-main"><b>${esc(t('expense.category.' + x.category))}</b><small>${esc([text(x.note), fmtShort(new Date(x.date))].filter(Boolean).join(' · '))}</small></span><span>${esc(money(x.amount))}</span>${icon('chev', 'chev')}</button>`).join('')}</div>` : empty(t('money.noExpenses'))}
    </section>
  </div>`;
  const actions = S.askEnabled ? `<button class="icon-btn accent" data-act="ask" aria-label="${esc(t('ask.title'))}">${icon('sparkle')}</button>` : '';
  return { title: t('tab.money'), actions, body };
}

function openExpense(x) {
  openModal(x ? t('common.edit') : t('money.addExpense'), `<form data-form="expense" data-id="${x ? esc(x.id) : ''}" class="stack">
    ${field(t('payment.amount'), `<input name="amount" type="number" step="any" min="0.001" inputmode="decimal" value="${x ? esc(x.amount) : ''}" required>`)}
    ${field(t('expense.category'), `<select name="category">${options(EXPENSE_CATS, x ? x.category : 'ingredients', c => t('expense.category.' + c))}</select>`)}
    ${field(t('expense.date'), `<input name="date" type="date" value="${dayKey(x ? new Date(x.date) : new Date())}" required>`)}
    ${field(t('payment.note'), `<input name="note" value="${x ? esc(text(x.note)) : ''}">`)}
    <div class="btn-row">${x ? `<button type="button" class="btn danger-soft" data-act="delete-expense" data-id="${esc(x.id)}">${esc(t('expense.delete'))}</button>` : ''}<button class="btn primary grow">${esc(t('common.save'))}</button></div></form>`);
}

// ---------- Shop hub ----------

function viewShop(rest) {
  const sub = rest[0];
  if (sub === 'menu') return viewMenu();
  if (sub === 'customers') return viewCustomers();
  if (sub === 'occasions') return viewOccasions();
  if (sub === 'marketing') return viewMarketing(rest.slice(1));
  if (sub === 'receipts') return rest[1] ? viewReceipt(rest[1]) : viewReceipts();
  if (sub === 'settings') return rest[1] === 'team' ? viewTeam() : viewSettings();
  const body = `<div class="stack">
    <button class="card shop-card" data-act="edit-shop"><span class="avatar lg">${esc(initial(shopName()))}</span><span class="row-main"><b>${esc(shopName())}</b><small><bdi dir="ltr">${esc(S.shop.phone)}</bdi></small><small>${esc(t('businessType.' + S.shop.businessType))}</small></span>${icon('edit')}</button>
    <div class="kpis two">${kpi(S.products.length, t('shop.menuItems'))}${kpi(S.customers.length, t('shop.customersTitle'))}</div>
    <nav class="card list">${navRow('shop/menu', 'box', t('shop.menu'))}${navRow('shop/customers', 'users', t('shop.customersTitle'))}${navRow('shop/occasions', 'calendar', t('shop.occasions'))}${navRow('shop/marketing', 'megaphone', t('shop.marketing'))}${navRow('shop/receipts', 'receipt', t('shop.receipts'))}</nav>
    <nav class="card list">${navRow('shop/settings', 'gear', t('shop.settings'))}</nav>
  </div>`;
  return { title: t('tab.shop'), body };
}

function openShop() {
  const s = S.shop;
  openModal(t('shop.editTitle'), `<form data-form="shop" class="stack">
    <div class="grid2">${field(t('shop.nameAr'), `<input name="nameAr" value="${esc(s.nameAr)}" dir="rtl" required>`)}${field(t('shop.nameEn'), `<input name="nameEn" value="${esc(s.nameEn)}" dir="ltr">`)}</div>
    ${field(t('shop.phone'), `<input name="phone" value="${esc(s.phone)}" dir="ltr" inputmode="tel">`)}
    <div class="grid2">${field(t('shop.pickupHours'), `<input name="pickupHours" value="${esc(s.pickupHours)}">`)}${field(t('shop.dailyCapacity'), `<input name="dailyCapacity" type="number" min="0" step="1" value="${esc(s.dailyCapacity ?? '')}">`)}</div>
    <button class="btn primary block">${esc(t('common.save'))}</button></form>`);
}

function viewMenu() {
  const rows = S.products.map(p => {
    const stock = S.stockEnabled && p.track ? badge(p.qty <= 0 ? 'bad' : p.qty <= p.low ? 'warn' : 'neutral', t('stock.qtyBadge', p.qty)) : '';
    const thumb = Live.on && p.photoId ? `<img class="thumb" data-photo="${esc(p.photoId)}" alt="">` : '';
    return `<button class="row${p.active ? '' : ' dim'}" data-act="edit-product" data-id="${esc(p.id)}"${can('products') ? '' : ' disabled'}>${thumb}<span class="row-main"><b>${esc(pName(p))}</b><small>${esc(money(p.price))}${p.cap ? ' · ' + esc(t('shop.capacityPerDay', p.cap)) : ''}</small></span>${stock}${icon('chev', 'chev')}</button>`;
  }).join('');
  return { title: t('shop.menu'), back: 'shop', actions: can('products') ? addBtn('add-product', t('shop.addItem')) : '', body: rows ? `<div class="card list">${rows}</div>` : empty(t('shop.noItems')) };
}
function openProduct(p) {
  const x = p || { nameAr: '', nameEn: '', price: '', cost: '', cap: '', active: true, track: false, qty: 0, low: 3 };
  openModal(p ? t('shop.editItem') : t('shop.addItem'), `<form data-form="product" data-id="${p ? esc(p.id) : ''}" class="stack">
    <div class="grid2">${field(t('shop.nameAr'), `<input name="nameAr" value="${esc(x.nameAr)}" dir="rtl">`)}${field(t('shop.nameEn'), `<input name="nameEn" value="${esc(x.nameEn)}" dir="ltr">`)}</div>
    <div class="grid3">${field(t('shop.price'), `<input name="price" type="number" step="any" min="0" inputmode="decimal" value="${esc(x.price)}" required>`)}${field(t('shop.cost'), `<input name="cost" type="number" step="any" min="0" inputmode="decimal" value="${esc(x.cost)}">`)}${field(t('shop.dailyCapacity'), `<input name="cap" type="number" step="1" min="0" value="${esc(x.cap ?? '')}">`)}</div>
    ${Live.on && p ? `<div class="photo-row">${p.photoId ? `<img class="thumb lg" data-photo="${esc(p.photoId)}" alt="">` : ''}<label class="btn ghost small">${icon('upload')} ${esc(t('photo.upload'))}<input type="file" accept="image/*" data-live="live-photo" data-id="${esc(p.id)}" hidden></label></div>` : ''}
    ${toggle('active', t('shop.active'), x.active)}
    ${S.stockEnabled ? `${toggle('track', t('stock.trackForProduct'), x.track)}<div class="grid2">${field(t('stock.quantity'), `<input name="qty" type="number" step="1" value="${esc(x.qty)}"><input name="qty0" type="hidden" value="${esc(x.qty)}">`)}${field(t('stock.lowStockAt'), `<input name="low" type="number" step="1" min="0" value="${esc(x.low)}">`)}</div>` : ''}
    <div class="btn-row">${p ? `<button type="button" class="btn danger-soft" data-act="delete-product" data-id="${esc(p.id)}">${esc(t('common.delete'))}</button>` : ''}<button class="btn primary grow">${esc(t('common.save'))}</button></div>
  </form>`);
}

function viewCustomers() {
  const counts = new Map();
  S.orders.forEach(o => counts.set(o.customerId, (counts.get(o.customerId) || 0) + 1));
  const rows = S.customers.slice().sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)).map(c => `<button class="row" data-act="edit-customer" data-id="${esc(c.id)}"${can('orders') ? '' : ' disabled'}><span class="avatar sm">${esc(initial(cName(c)))}</span><span class="row-main"><b>${esc(cName(c))}</b><small><span dir="ltr">${esc(c.phone)}</span>${c.area ? ' · ' + esc(t('area.' + c.area)) : ''}</small></span><span class="muted small">${esc(t('shop.orderCount', counts.get(c.id) || 0))}</span>${icon('chev', 'chev')}</button>`).join('');
  return { title: t('shop.customersTitle'), back: 'shop', actions: can('orders') ? addBtn('add-customer', t('shop.addCustomer')) : '', body: rows ? `<div class="card list">${rows}</div>` : empty(t('shop.noCustomers')) };
}
function openCustomer(c) {
  const x = c || { name: '', phone: '', area: '', notes: '' };
  openModal(c ? t('shop.editCustomer') : t('shop.addCustomer'), `<form data-form="customer" data-id="${c ? esc(c.id) : ''}" class="stack">
    ${field(t('neworder.customerName'), `<input name="name" value="${esc(cName(x) || x.name)}" required>`)}
    ${field(t('neworder.customerPhone'), `<input name="phone" value="${esc(x.phone)}" dir="ltr" inputmode="tel">`)}
    ${field(t('shop.area'), `<select name="area"><option value="">${esc(t('shop.areaNone'))}</option>${options(AREAS, x.area, a => t('area.' + a))}</select>`)}
    ${field(t('shop.notes'), `<textarea name="notes" rows="2">${esc(x.notes)}</textarea>`)}
    <div class="btn-row">${c && can('orders') && !S.orders.some(o => o.customerId === c.id) ? `<button type="button" class="btn danger-soft" data-act="delete-customer" data-id="${esc(c.id)}">${esc(t('customers.delete'))}</button>` : ''}<button class="btn primary grow">${esc(t('common.save'))}</button></div></form>`);
}

function viewOccasions() {
  const rows = S.occasions.slice().sort((a, b) => a.start.localeCompare(b.start)).map(x => occasionRow(x, true)).join('');
  return { title: t('shop.occasions'), back: 'shop', actions: addBtn('add-occasion', t('occasion.add')), body: rows ? `<div class="card list">${rows}</div>` : empty(t('shop.noOccasions')) };
}
function openOccasion() {
  const k = dayKey(new Date());
  openModal(t('occasion.add'), `<form data-form="occasion" class="stack">
    ${field(t('occasion.kind'), `<select name="kind">${options(OCCASION_KINDS, 'custom', o => t('occasion.kind.' + o))}</select>`)}
    <div class="grid2">${field(t('shop.nameAr'), '<input name="nameAr" dir="rtl">')}${field(t('shop.nameEn'), '<input name="nameEn" dir="ltr">')}</div>
    <div class="grid2">${field(t('occasion.startDate'), `<input name="start" type="date" value="${k}" required>`)}${field(t('occasion.endDate'), `<input name="end" type="date" value="${k}" required>`)}</div>
    ${field(t('shop.dailyCapacity'), '<input name="cap" type="number" min="0" step="1">')}
    ${toggle('blocked', t('occasion.blocked'), false)}
    <button class="btn primary block">${esc(t('common.save'))}</button></form>`);
}

// ---------- Marketing: captions, campaigns, photo studio, shop link ----------

function captionText() {
  if (CAP.ai) return CAP.ai;
  const p = productOf(CAP.pid) || S.products.find(x => x.active);
  const shop = shopName();
  if (CAP.template === 'general') return t('marketing.message.general', shop);
  if (CAP.template === 'occasionPromo') {
    const o = S.occasions.find(x => x.id === CAP.occ) || S.occasions[0];
    return t('marketing.message.occasionPromo', o ? pick(o.nameAr, o.nameEn) : t('occasion.kind.custom'), shop);
  }
  if (!p) return t('marketing.noContent');
  return CAP.template === 'newItem' ? t('marketing.message.newItem', pName(p), shop) : t('marketing.message.priceAndOrder', pName(p), money(p.price), shop);
}
function aiCaption(p) {
  const shop = shopName(), tag = '#' + (S.shop.nameEn || 'Orderat').replace(/[^a-z0-9]/gi, '');
  if (!p) return t('marketing.message.general', shop);
  return S.lang === 'en'
    ? `✨ ${pName(p)} from ${shop}\n\nMade to order, just for you 💛\nPrice: ${money(p.price)}\n\n📩 Message us on WhatsApp to order today.\n${tag} #Bahrain`
    : `✨ ${pName(p)} من ${shop}\n\nمجهّز بعناية، خصيصاً لك 💛\nالسعر: ${money(p.price)}\n\n📩 راسلونا على الواتساب واطلبوا اليوم.\n${tag} #البحرين`;
}

function viewMarketing(rest) {
  if (rest[0] === 'campaigns') return rest[1] ? viewCampaign(rest[1]) : viewCampaigns();
  if (rest[0] === 'studio') return viewStudio();
  if (rest[0] === 'link') return viewShopLink();
  const ps = S.products.filter(p => p.active);
  if (!productOf(CAP.pid)) CAP.pid = ps[0]?.id || '';
  if (!S.occasions.some(o => o.id === CAP.occ)) CAP.occ = S.occasions[0]?.id || '';
  const picker = CAP.template === 'general' ? ''
    : CAP.template === 'occasionPromo'
      ? field(t('shop.occasions'), `<select name="occ" data-live="caption">${S.occasions.map(o => `<option value="${esc(o.id)}"${o.id === CAP.occ ? ' selected' : ''}>${esc(pick(o.nameAr, o.nameEn))}</option>`).join('')}</select>`)
      : field(t('neworder.menuItem'), `<select name="pid" data-live="caption">${ps.map(p => `<option value="${esc(p.id)}"${p.id === CAP.pid ? ' selected' : ''}>${esc(pName(p))}</option>`).join('')}</select>`);
  const body = `<div class="stack">
    <nav class="card list">${navRow('shop/marketing/campaigns', 'flag', t('marketing.campaigns'))}${navRow('shop/marketing/studio', 'camera', t('marketing.photoStudio'))}${navRow('shop/marketing/link', 'link', t('marketing.shopLink'), S.shopLink.published ? t('shoplink.published') : '')}</nav>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('marketing.captions'))}</h3>
      <div class="field"><span>${esc(t('marketing.template'))}</span>${seg('template', ['newItem', 'priceAndOrder', 'occasionPromo', 'general'], CAP.template, k => t('marketing.template.' + k), 'caption')}</div>
      ${picker}
      <div class="field"><span>${esc(t('marketing.preview'))}</span><p class="caption-box" id="cap-preview">${esc(captionText())}</p></div>
      ${CAP.ai && !Live.on ? `<p class="ai-note">${icon('sparkle')} ${esc(t('marketing.demoAI'))}</p>` : ''}
      <div class="btn-row"><button class="btn ghost small" data-act="copy-caption">${icon('copy')} ${esc(t('marketing.copy'))}</button><a class="btn ghost small" id="cap-share" href="https://wa.me/?text=${encodeURIComponent(captionText())}" target="_blank" rel="noopener">${icon('share')} ${esc(t('marketing.share'))}</a><button class="btn primary small" data-act="caption-ai"${CAP.busy ? ' disabled' : ''}>${esc(CAP.busy ? t('marketing.writingWithAI') : t('marketing.writeWithAI'))}</button></div>
    </section>
  </div>`;
  return { title: t('shop.marketing'), back: 'shop', body };
}

function viewCampaigns() {
  loadCampaigns();
  const list = countryCampaigns();
  const rows = list.map(c => `<a class="card camp-card" style="--camp:${esc(c.accent || '#4a5fdc')}" href="#/shop/marketing/campaigns/${esc(c.id)}"><span class="row"><span class="camp-emoji">${esc(c.emoji || '')}</span><span class="row-main"><b>${esc(text(c.name))}</b><small>${esc(countdown(c))} · ${esc(fmtShort(parseDay(c.startDate)))}</small><small>${esc(text(c.headline))}</small></span>${icon('chev', 'chev')}</span></a>`).join('');
  const body = CAMPAIGNS === null ? empty(t('campaigns.loading')) : rows ? `<div class="stack">${rows}</div>` : empty(t('campaigns.empty'));
  return { title: t('campaigns.title'), back: 'shop/marketing', body };
}
function viewCampaign(id) {
  loadCampaigns();
  const c = (CAMPAIGNS || []).find(x => x.id === id);
  if (!c) return { title: t('campaigns.title'), back: 'shop/marketing/campaigns', body: empty(t(CAMPAIGNS === null ? 'campaigns.loading' : 'campaigns.empty')) };
  const p = S.products.find(x => x.active);
  const link = S.shopLink.published ? SHOP_PAGE + S.shopLink.slug : '';
  const fill = s => s.split('{item}').join(p ? pName(p) : '').split('{shop}').join(shopName()).split('{price}').join(p ? money(p.price) : '').split('{link}').join(link).trim();
  const captions = (c.captions?.[S.lang] || []).map(fill);
  const tags = c.hashtags?.[S.lang] || [];
  const added = S.occasions.some(o => o.campaignId === c.id);
  const range = c.startDate === c.endDate ? fmtDate(parseDay(c.startDate)) : `${fmtShort(parseDay(c.startDate))} – ${fmtDate(parseDay(c.endDate))}`;
  const body = `<div class="stack">
    <section class="card camp-hero" style="--camp:${esc(c.accent || '#4a5fdc')}"><span class="camp-emoji big">${esc(c.emoji || '')}</span><h2>${esc(text(c.name))}</h2><p>${esc(text(c.headline))}</p><p class="muted small">${esc(range)} · ${esc(countdown(c))}</p>
      <div class="btn-row"><button class="btn primary small" data-act="campaign-photo" data-id="${esc(c.id)}">${icon('camera')} ${esc(t('campaign.makePhoto'))}</button><button class="btn ghost small" data-act="campaign-occasion" data-id="${esc(c.id)}"${added ? ' disabled' : ''}>${icon(added ? 'check' : 'calendar')} ${esc(t(added ? 'campaign.addedToOccasions' : 'campaign.addToOccasions'))}</button></div></section>
    <section class="card"><h3 class="card-title">${esc(t('campaign.tips'))}</h3><ul class="bullets">${(c.tips?.[S.lang] || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card"><h3 class="card-title">${esc(t('campaign.productIdeas'))}</h3><div class="chips wrap">${(c.productIdeas?.[S.lang] || []).map(x => `<span class="chip static">${esc(x)}</span>`).join('')}</div></section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('campaign.captions'))}</h3>${captions.map(x => `<div class="caption"><p class="caption-box">${esc(x)}</p><button class="btn ghost small" data-act="copy" data-text="${esc(x)}">${icon('copy')} ${esc(t('marketing.copy'))}</button></div>`).join('')}</section>
    ${tags.length ? `<section class="card"><div class="split"><h3 class="card-title">${esc(t('campaign.hashtags'))}</h3><button class="btn ghost small" data-act="copy" data-text="${esc(tags.join(' '))}">${icon('copy')} ${esc(t('marketing.copy'))}</button></div><div class="chips wrap">${tags.map(x => `<span class="chip static" dir="auto">${esc(x)}</span>`).join('')}</div></section>` : ''}
  </div>`;
  return { title: t('campaigns.title'), back: 'shop/marketing/campaigns', body };
}

function studioStyles() {
  const c = ST.campaign && (CAMPAIGNS || []).find(x => x.id === ST.campaign);
  return c ? [{ id: 'campaign', ar: c.name.ar, en: c.name.en, bg: c.accent || '#4a5fdc', emoji: c.emoji, campaign: c }, ...STUDIO_STYLES] : STUDIO_STYLES;
}
function viewStudio() {
  const styles = studioStyles();
  if (!styles.some(s => s.id === ST.style)) ST.style = styles[0].id;
  const result = ST.result ? `<section class="card stack-sm"><div class="before-after"><figure><img src="${esc(ST.photo)}" alt=""><figcaption>${esc(t('studio.before'))}</figcaption></figure><figure><img src="${esc(ST.result)}" alt=""><figcaption>${esc(t('studio.after'))}</figcaption></figure></div>
      <div class="btn-row"><a class="btn primary small" href="${esc(ST.result)}" download="orderat-studio.jpg">${icon('download')} ${esc(t('studio.download'))}</a><button class="btn ghost small" data-act="studio-use">${icon('check')} ${esc(t('studio.useAsProductPhoto'))}</button><button class="btn ghost small" data-act="studio-again">${esc(t('studio.startOver'))}</button></div></section>` : '';
  const body = `<div class="stack">
    <section class="card stack-sm"><h3 class="card-title">1 · ${esc(t('studio.pickPhotoTitle'))}</h3>
      <div class="studio-photo">${ST.photo ? `<img src="${esc(ST.photo)}" alt="">` : icon('image')}</div>
      <div class="btn-row"><label class="btn ghost small">${icon('upload')} ${esc(t('studio.pickPhoto'))}<input type="file" accept="image/*" data-live="studio-photo" hidden></label><button class="btn ghost small" data-act="studio-sample">${esc(t('studio.samplePhoto'))}</button></div></section>
    <section class="card stack-sm"><h3 class="card-title">2 · ${esc(t('studio.pickStyleTitle'))}</h3><div class="styles">${styles.map(s => `<button class="style${ST.style === s.id ? ' on' : ''}" data-act="studio-style" data-id="${esc(s.id)}" aria-pressed="${ST.style === s.id}"><span class="swatch" style="background:${esc(s.bg)}">${esc(s.emoji || '')}</span><small>${esc(pick(s.ar, s.en))}</small></button>`).join('')}</div></section>
    <section class="card stack-sm"><h3 class="card-title">3 · ${esc(t('studio.pickAspectTitle'))}</h3>${seg('shape', Object.keys(SHAPES), ST.shape, k => t('studio.shape.' + k), 'studio-shape')}</section>
    <div class="btn-row"><button class="btn primary big grow" data-act="studio-generate"${!ST.photo || ST.busy || ST.left <= 0 ? ' disabled' : ''}>${icon('sparkle')} ${esc(ST.busy ? t('studio.generating') : t('studio.generate'))}</button>${typeof ST.left === 'number' ? `<span class="muted small">${esc(t('studio.remainingToday', ST.left))}</span>` : ''}</div>
    ${result}
    ${Live.on ? '' : `<p class="note">${esc(t('studio.demoNote'))}</p>`}
  </div>`;
  return { title: t('studio.title'), back: 'shop/marketing', body };
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
// Stand-in for the apps' AI photo studio: paints the chosen style's backdrop and places the photo on
// it with a soft shadow, so the before/after flow can be tried without the orderat-studio function.
function paintBackdrop(g, s, w, h) {
  const rnd = (() => { let x = 42; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  g.fillStyle = s.bg;
  g.fillRect(0, 0, w, h);
  if (s.id === 'white') {
    const r = g.createRadialGradient(w / 2, h * 0.45, 20, w / 2, h * 0.45, Math.max(w, h) * 0.7);
    r.addColorStop(0, '#ffffff'); r.addColorStop(1, '#e9e9e9');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  } else if (s.id === 'marble') {
    g.strokeStyle = 'rgba(110,100,92,.22)';
    for (let i = 0; i < 16; i++) {
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath(); g.moveTo(rnd() * w, 0);
      g.bezierCurveTo(rnd() * w, h * 0.3, rnd() * w, h * 0.7, rnd() * w, h);
      g.stroke();
    }
  } else if (s.id === 'pastel') {
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#FDE7EF'); lg.addColorStop(1, '#F6B8CD');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 60, 0, Math.PI * 2); g.fill(); }
  } else if (s.id === 'wood') {
    g.strokeStyle = 'rgba(70,45,30,.18)';
    for (let yy = 6; yy < h; yy += 9 + rnd() * 10) {
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath(); g.moveTo(0, yy);
      g.bezierCurveTo(w * 0.3, yy + rnd() * 8 - 4, w * 0.7, yy + rnd() * 8 - 4, w, yy);
      g.stroke();
    }
  } else if (s.id === 'flowers') {
    g.fillStyle = '#FDE4EC'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) {
      const cx = rnd() < 0.5 ? rnd() * w * 0.2 + (rnd() < 0.5 ? 0 : w * 0.8) : rnd() * w, cy = rnd() < 0.5 ? rnd() * h * 0.18 + (rnd() < 0.5 ? 0 : h * 0.82) : rnd() * h, r = 8 + rnd() * 14;
      g.fillStyle = ['#F48FB1', '#F8BBD0', '#ffffff', '#EC407A'][i % 4];
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(cx + Math.cos((k * 2 * Math.PI) / 5) * r, cy + Math.sin((k * 2 * Math.PI) / 5) * r, r * 0.75, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#FFD54F'; g.beginPath(); g.arc(cx, cy, r * 0.45, 0, Math.PI * 2); g.fill();
    }
  } else if (s.id === 'dark') {
    const r = g.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.42, Math.max(w, h) * 0.75);
    r.addColorStop(0, '#3b3b3b'); r.addColorStop(1, '#0e0e0e');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#C9A227'; g.lineWidth = 2; g.strokeRect(18, 18, w - 36, h - 36);
  } else if (s.id === 'campaign') {
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = -h; i < w; i += 28) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.lineTo(i + h + 12, h); g.lineTo(i + 12, 0); g.fill(); }
    g.font = '54px serif'; g.textAlign = 'center';
    [[50, 64], [w - 50, 64], [50, h - 30], [w - 50, h - 30]].forEach(([x, y]) => g.fillText(s.emoji || '', x, y));
  }
}
function composeStudio(img) {
  const [w, h] = SHAPES[ST.shape], cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.width = w; cv.height = h;
  const s = studioStyles().find(x => x.id === ST.style) || STUDIO_STYLES[0];
  paintBackdrop(g, s, w, h);
  const scale = Math.min((w * 0.72) / img.width, (h * 0.6) / img.height);
  const iw = img.width * scale, ih = img.height * scale, x = (w - iw) / 2, y = (h - ih) / 2 - (s.id === 'campaign' ? 14 : 0);
  g.save(); g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 38; g.shadowOffsetY = 18; roundRect(g, x, y, iw, ih, 18); g.fillStyle = '#fff'; g.fill(); g.restore();
  g.save(); roundRect(g, x, y, iw, ih, 18); g.clip(); g.drawImage(img, x, y, iw, ih); g.restore();
  if (s.campaign) {
    g.fillStyle = '#fff'; g.font = `700 30px ${S.lang === 'en' ? '"IBM Plex Sans"' : '"IBM Plex Sans Arabic"'}, sans-serif`; g.textAlign = 'center';
    g.fillText(text(s.campaign.name), w / 2, Math.min(h - 70, y + ih + 64));
  }
  return cv.toDataURL('image/jpeg', 0.9);
}
function samplePhoto() {
  const cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.width = 480; cv.height = 480;
  const bg = g.createLinearGradient(0, 0, 480, 480);
  bg.addColorStop(0, '#b9b2a6'); bg.addColorStop(1, '#827b70');
  g.fillStyle = bg; g.fillRect(0, 0, 480, 480);
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, 310, 480, 170);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(250, 350, 130, 18, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ead9c3'; g.fillRect(140, 196, 200, 150);
  g.fillStyle = '#f5e9d8'; g.fillRect(128, 166, 224, 44);
  g.fillStyle = '#c0392b'; g.fillRect(228, 166, 24, 180); g.fillRect(128, 180, 224, 14);
  g.beginPath(); g.ellipse(212, 152, 34, 17, -0.5, 0, Math.PI * 2); g.ellipse(268, 152, 34, 17, 0.5, 0, Math.PI * 2); g.fill();
  return cv.toDataURL('image/jpeg', 0.86);
}
function generateStudio() {
  if (!ST.photo || ST.busy) return;
  ST.busy = true;
  render();
  setTimeout(() => {
    const img = new Image();
    img.onload = () => { ST.result = composeStudio(img); ST.busy = false; ST.left = Math.max(0, ST.left - 1); if (route()[2] === 'studio') render(); };
    img.onerror = () => { ST.busy = false; render(); };
    img.src = ST.photo;
  }, 1600);
}

function slugStatusText() {
  return { idle: t('shoplink.slugHint'), checking: t('shoplink.checkingSlug'), available: t('shoplink.slugAvailable'), taken: t('shoplink.slugTaken'), invalid: t('shoplink.slugInvalid') }[SLUG.status];
}
function paintSlug() {
  const el = $('#slug-status');
  if (el) { el.textContent = slugStatusText(); el.className = `small slug-status ${esc(SLUG.status)}`; }
}
const validSlug = v => /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(v);
function viewShopLink() {
  if (Live.on) return Live.viewShopLink();
  const L = S.shopLink;
  if (!SLUG.value && L.slug) SLUG.value = L.slug;
  const url = SHOP_PAGE + L.slug, h = hash(L.slug);
  const published = L.published ? `<section class="card stack-sm">
      <div>${badge('ok', t('shoplink.published'))}</div>
      <p class="link-url"><bdi dir="ltr">${esc(url)}</bdi></p>
      <div class="btn-row"><button class="btn ghost small" data-act="copy" data-text="${esc(url)}">${icon('copy')} ${esc(t('marketing.copy'))}</button><a class="btn primary small" href="/s/?demo" target="_blank" rel="noopener">${icon('external')} ${esc(t('shoplink.open'))}</a></div>
      <p class="muted small">${icon('instagram')} ${esc(t('shoplink.instagramTip'))}</p>
    </section>
    <div class="kpis three">${kpi(40 + (h % 120), t('shoplink.views7d'))}${kpi(3 + (h % 6), t('shoplink.orders7d'))}${kpi(S.webOrders.length, t('shoplink.pending'))}</div>` : '';
  const form = `<form data-form="shoplink" class="card stack-sm">
    <label class="field"><span>${esc(t('shoplink.slug'))}</span><span class="slug" dir="ltr"><span class="muted">/s/?</span><input name="slug" dir="ltr" data-live="slug" value="${esc(SLUG.value)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sweetstudio"></span></label>
    <p class="small slug-status ${esc(SLUG.status)}" id="slug-status">${esc(slugStatusText())}</p>
    ${field(t('shoplink.bio'), `<textarea name="bio" rows="2" data-live="link-field">${esc(L.bio)}</textarea>`)}
    <div class="split"><span>${esc(t('shoplink.leadTimeDays', L.leadDays))}</span><span class="stepper"><button type="button" data-act="lead" data-d="-1" aria-label="−">${icon('minus')}</button><b>${L.leadDays}</b><button type="button" data-act="lead" data-d="1" aria-label="+">${icon('plus')}</button></span></div>
    ${field(t('shoplink.delivery'), `<select name="delivery" data-live="link-field">${options(['both', 'pickup', 'delivery'], L.delivery, k => (k === 'both' ? t('shoplink.delivery.both') : t('fulfillment.' + k)))}</select>`)}
    ${toggle('acceptsWebOrders', t('shoplink.acceptsWebOrders'), L.acceptsWebOrders, 'link-field')}
    <h4 class="card-title">${esc(t('shoplink.products'))}</h4>
    ${toggle('showAll', t('shoplink.showAllProducts'), L.showAll, 'link-field')}
    <div class="btn-row"><button class="btn primary grow">${esc(t(L.published ? 'shoplink.update' : 'shoplink.publish'))}</button>${L.published ? `<button type="button" class="btn danger-soft" data-act="unpublish">${esc(t('shoplink.unpublish'))}</button>` : ''}</div>
  </form>`;
  return { title: t('shoplink.title'), back: 'shop/marketing', body: `<div class="stack">${published}${form}<p class="note">${esc(t('shoplink.demoNote'))}</p></div>` };
}

// ---------- Receipts ----------

// Looks like a QR code but encodes nothing: the apps build the real ZATCA TLV code.
function pseudoQr(seedText) {
  const n = 29, finders = [[0, 0], [n - 7, 0], [0, n - 7]];
  let seedVal = hash(seedText);
  const rnd = () => ((seedVal = (seedVal * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const f = finders.find(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
      let on;
      if (f) { const dx = x - f[0], dy = y - f[1]; on = dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); }
      else on = !finders.some(([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7) && rnd() < 0.5;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" width="128" height="128" role="img" aria-label="QR"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function viewReceipts() {
  const rows = live().sort((a, b) => byDue(b, a)).map(o => `<a class="row" href="#/shop/receipts/${esc(o.id)}"><span class="row-main"><b><bdi dir="ltr">${esc(invoiceNo(o))}</bdi></b><small>${esc(cName(customerOf(o)))} · ${esc(fmtDate(new Date(o.dueAt)))}</small></span><b class="amt">${esc(money(totals(o).total))}</b>${icon('chev', 'chev')}</a>`).join('');
  const hint = vatOn() || Live.on ? '' : `<p class="note">${esc(t('receipt.vatOff'))} <a href="#/shop/settings">${esc(t('shop.settings'))}</a></p>`;
  return { title: t('shop.receipts'), back: 'shop', body: `<div class="stack">${hint}${rows ? `<div class="card list">${rows}</div>` : empty(t('shop.noOrders'))}</div>` };
}
function receiptText(o) {
  const T = totals(o), d = new Date(o.dueAt), rate = orderVatRate(o);
  return [shopName(), rate ? t('receipt.taxInvoiceTitle') : t('receipt.title'), rate && S.vat.trn ? t('receipt.trn', S.vat.trn) : '', t('receipt.invoiceNumber', invoiceNo(o)), `${fmtDate(d)} ${fmtTime(d)}`, '',
    ...o.items.map(it => `${it.qty}× ${pick(it.nameAr, it.nameEn)} — ${money(it.qty * it.price)}`),
    '', rate ? `${t('orders.vatPercent', rate + '%')}: ${money(T.vat)}` : '', `${t('orders.total')}: ${money(T.total)}`, `${t('orders.paid')}: ${money(T.paid)}`].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}
function viewReceipt(id) {
  const o = orderById(id);
  if (!o) return { title: t('shop.receipt'), back: 'shop/receipts', body: empty(t('orders.notFound')) };
  const T = totals(o), d = new Date(o.dueAt), rate = orderVatRate(o);
  const line = (a, b, cls = '') => `<div class="line${cls ? ' ' + cls : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
  const body = `<article class="receipt">
    <header class="rc-head"><img src="favicon.svg" width="44" height="44" alt=""><div><h2>${esc(shopName())}</h2><p><bdi dir="ltr">${esc(S.shop.phone)}</bdi></p></div></header>
    <h3 class="rc-title">${esc(rate ? t('receipt.taxInvoiceTitle') : t('receipt.title'))}</h3>
    <div class="rc-meta">${rate && S.vat.trn ? `<p>${esc(t('receipt.trn', S.vat.trn))}</p>` : ''}<p>${esc(t('receipt.invoiceNumber', invoiceNo(o)))}</p><p>${esc(fmtDate(d))} · ${esc(fmtTime(d))}</p><p>${esc(t('neworder.customerTitle'))}: ${esc(cName(customerOf(o)))}</p></div>
    <table class="rc-table"><thead><tr><th>${esc(t('receipt.item'))}</th><th>${esc(t('receipt.qty'))}</th><th>${esc(t('payment.amount'))}</th></tr></thead><tbody>${o.items.map(it => `<tr><td>${esc(pick(it.nameAr, it.nameEn))}</td><td>${it.qty}</td><td>${esc(money(it.qty * it.price))}</td></tr>`).join('')}${o.deliveryFee ? `<tr><td>${esc(t('orders.deliveryFee'))}</td><td></td><td>${esc(money(o.deliveryFee))}</td></tr>` : ''}</tbody></table>
    <div class="rc-totals">${rate ? line(t('orders.subtotal'), money(T.subtotal)) + line(t('orders.vatPercent', rate + '%'), money(T.vat)) : ''}${line(t('orders.total'), money(T.total), 'total')}${line(t('orders.paid'), money(T.paid))}${T.due > 0 ? line(t('orders.remaining'), money(T.due)) : ''}</div>
    ${rate && country() === 'SA' ? `<figure class="rc-qr">${pseudoQr(invoiceNo(o) + shopName())}<figcaption>${esc(t('receipt.qr'))}</figcaption></figure>` : ''}
    <p class="rc-thanks">${esc(t('receipt.thanks'))}</p>
  </article>
  <div class="btn-row no-print"><button class="btn ghost" data-act="print">${icon('print')} ${esc(t('receipt.print'))}</button><button class="btn primary" data-act="share-receipt" data-id="${esc(o.id)}">${icon('share')} ${esc(t('shop.shareReceipt'))}</button></div>`;
  return { title: t('shop.receipt'), back: 'shop/receipts', body };
}

// ---------- Settings and team ----------

function viewSettings() {
  if (Live.on) return viewLiveSettings();
  const C = S.cloud;
  const vat = vatRate()
    ? `${toggle('vat', t('settings.vatEnabled'), S.vat.enabled, 'vat-enabled')}${S.vat.enabled ? `<div class="grid2">${field(t('settings.vatTRN'), `<input data-live="vat-trn" value="${esc(S.vat.trn)}" dir="ltr" inputmode="numeric">`)}<div class="field"><span>${esc(t('settings.vatRate'))}</span><b class="static"><bdi dir="ltr">${vatRate()}%</bdi></b></div></div><div class="field"><span>${esc(t('settings.vatPricesInclude'))}</span>${seg('pricesInclude', ['yes', 'no'], S.vat.pricesInclude ? 'yes' : 'no', k => t(k === 'yes' ? 'settings.vatIncludedYes' : 'settings.vatIncludedNo'), 'vat-include')}</div>` : ''}`
    : `<p class="muted">${esc(t('settings.vatNoCountryVAT'))}</p>`;
  const cloud = C.signedIn
    ? `<div class="line"><span>${esc(t('cloud.signedInAs'))}</span><b dir="ltr">${esc(C.email)}</b></div>
       <div class="line"><span>${esc(t('cloud.lastSynced'))}: ${esc(C.lastSynced ? `${fmtShort(new Date(C.lastSynced))} ${fmtTime(new Date(C.lastSynced))}` : t('cloud.neverSynced'))}</span><button class="btn ghost small" data-act="sync-now">${esc(t('cloud.syncNow'))}</button></div>
       ${navRow('shop/settings/team', 'users', t('cloud.team'), String(C.team.length + 1))}
       <button class="link-btn danger" data-act="sign-out">${esc(t('cloud.signOut'))}</button>`
    : `<p class="muted">${esc(t('cloud.signInSubtitle'))}</p>
       <div class="btn-row"><button class="btn dark" data-act="sign-in" data-p="apple">${esc(t('cloud.signInApple'))}</button><button class="btn ghost" data-act="sign-in" data-p="google">${esc(t('cloud.signInGoogle'))}</button></div>
       <form data-form="join" class="join">${field(t('cloud.joinShop'), `<input name="code" inputmode="numeric" maxlength="6" placeholder="${esc(t('cloud.inviteCodePlaceholder'))}" dir="ltr">`)}<button class="btn ghost">${esc(t('cloud.join'))}</button></form>`;
  const body = `<div class="stack">
    <section class="card split"><span class="row-main"><b>${esc(t('settingsSubscription'))}</b><small>${esc(t('settings.statusDemo'))}</small></span><button class="btn primary small" data-act="paywall">${esc(t('paywallCta'))}</button></section>
    <section class="card stack-sm">
      <div class="field"><span>${esc(t('settings.language'))}</span>${seg('lang', ['ar', 'en'], S.lang, k => (k === 'ar' ? 'العربية' : 'English'), 'setting')}</div>
      ${S.lang === 'ar' ? `<div class="field"><span>${esc(t('settings.addressAs'))}</span>${seg('addressAs', ['male', 'female'], S.addressAs, k => t(k === 'male' ? 'settings.addressAsMale' : 'settings.addressAsFemale'), 'setting')}</div>` : ''}
      <div class="field"><span>${esc(t('settings.appearance'))}</span>${seg('theme', ['system', 'light', 'dark'], S.theme, k => t('settings.appearance' + k[0].toUpperCase() + k.slice(1)), 'setting')}</div>
    </section>
    <section class="card grid2">
      ${field(t('shop.currency'), `<select data-live="currency">${options(Object.keys(CURRENCIES), S.shop.currency, c => c)}</select>`)}
      ${field(t('settings.businessType'), `<select data-live="business-type">${options(BUSINESS_TYPES, S.shop.businessType, b => t('businessType.' + b))}</select>`)}
    </section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('settings.vat'))}</h3>${vat}</section>
    <section class="card stack-sm">${toggle('stock', t('settings.trackStock'), S.stockEnabled, 'stock-enabled')}<p class="muted small">${esc(t('settings.trackStockFooter'))}</p>${toggle('ask', t('settings.askOrderat'), S.askEnabled, 'ask-enabled')}</section>
    <a class="card row" href="#/start"><span class="row-ic">${icon('users')}</span><span class="row-main"><b>${esc(t('live.logIn'))}</b><small>${esc(t('live.logInHint'))}</small></span>${icon('chev', 'chev')}</a>
    <section class="card stack-sm"><h3 class="card-title">${icon('cloud')} ${esc(t('cloud.sectionTitle'))}</h3>${cloud}<p class="note">${esc(t('cloud.demoNote'))}</p></section>
    <section class="card list">
      <button class="row" data-act="export"><span class="row-ic">${icon('download')}</span><span class="row-main"><b>${esc(t('settingsBackupExport'))}</b></span></button>
      <label class="row"><span class="row-ic">${icon('upload')}</span><span class="row-main"><b>${esc(t('settingsBackupImport'))}</b></span><input type="file" accept="application/json,.json" data-live="import" hidden></label>
      <button class="row" data-act="restore-demo"><span class="row-ic">${icon('box')}</span><span class="row-main"><b>${esc(t('settings.restoreDemo'))}</b></span></button>
      <button class="row danger" data-act="delete-all"><span class="row-ic">${icon('trash')}</span><span class="row-main"><b>${esc(t('settingsDeleteAllData'))}</b></span></button>
    </section>
    <section class="card list">
      <a class="row" href="${SITE_URL}${S.lang === 'en' ? '/en/' : '/'}" target="_blank" rel="noopener"><span class="row-ic">${icon('external')}</span><span class="row-main"><b>${esc(t('web.about'))}</b></span></a>
      <a class="row" href="${legalUrl('terms')}" target="_blank" rel="noopener"><span class="row-ic">${icon('receipt')}</span><span class="row-main"><b>${esc(t('paywallTerms'))}</b></span></a>
      <a class="row" href="${legalUrl('privacy')}" target="_blank" rel="noopener"><span class="row-ic">${icon('receipt')}</span><span class="row-main"><b>${esc(t('paywallPrivacy'))}</b></span></a>
    </section>
  </div>`;
  return { title: t('shop.settings'), back: 'shop', body };
}

// The live shop's settings: the account and sync, device prefs, and the shop's own settings (the
// currency stays with the phones: changing it would reread every amount in another unit).
function viewLiveSettings() {
  const vat = vatRate()
    ? `${toggle('vat', t('settings.vatEnabled'), S.vat.enabled, 'vat-enabled')}${S.vat.enabled ? `<div class="grid2">${field(t('settings.vatTRN'), `<input data-live="vat-trn" value="${esc(S.vat.trn)}" dir="ltr" inputmode="numeric">`)}<div class="field"><span>${esc(t('settings.vatRate'))}</span><b class="static"><bdi dir="ltr">${vatRate()}%</bdi></b></div></div><div class="field"><span>${esc(t('settings.vatPricesInclude'))}</span>${seg('pricesInclude', ['yes', 'no'], S.vat.pricesInclude ? 'yes' : 'no', k => t(k === 'yes' ? 'settings.vatIncludedYes' : 'settings.vatIncludedNo'), 'vat-include')}</div>` : ''}`
    : `<p class="muted">${esc(t('settings.vatNoCountryVAT'))}</p>`;
  const body = `<div class="stack">
    ${Live.settingsTop()}
    <section class="card stack-sm">
      <div class="field"><span>${esc(t('settings.language'))}</span>${seg('lang', ['ar', 'en'], S.lang, k => (k === 'ar' ? 'العربية' : 'English'), 'setting')}</div>
      ${S.lang === 'ar' ? `<div class="field"><span>${esc(t('settings.addressAs'))}</span>${seg('addressAs', ['male', 'female'], S.addressAs, k => t(k === 'male' ? 'settings.addressAsMale' : 'settings.addressAsFemale'), 'setting')}</div>` : ''}
      <div class="field"><span>${esc(t('settings.appearance'))}</span>${seg('theme', ['system', 'light', 'dark'], S.theme, k => t('settings.appearance' + k[0].toUpperCase() + k.slice(1)), 'setting')}</div>
    </section>
    <section class="card grid2">
      <div class="field"><span>${esc(t('shop.currency'))}</span><b class="static">${esc(S.shop.currency)}</b><small class="muted">${esc(t('live.currencyInApp'))}</small></div>
      ${field(t('settings.businessType'), `<select data-live="business-type">${options(BUSINESS_TYPES, S.shop.businessType, b => t('businessType.' + b))}</select>`)}
    </section>
    <section class="card stack-sm"><h3 class="card-title">${esc(t('settings.vat'))}</h3>${vat}</section>
    <section class="card stack-sm">${toggle('stock', t('settings.trackStock'), S.stockEnabled, 'stock-enabled')}<p class="muted small">${esc(t('settings.trackStockFooter'))}</p>${can('money') ? toggle('ask', t('settings.askOrderat'), S.askEnabled, 'ask-enabled') : ''}</section>
    <section class="card list">
      <button class="row" data-act="export"><span class="row-ic">${icon('download')}</span><span class="row-main"><b>${esc(t('settingsBackupExport'))}</b></span></button>
    </section>
    <section class="card list">
      <a class="row" href="${SITE_URL}${S.lang === 'en' ? '/en/' : '/'}" target="_blank" rel="noopener"><span class="row-ic">${icon('external')}</span><span class="row-main"><b>${esc(t('web.about'))}</b></span></a>
      <a class="row" href="${legalUrl('terms')}" target="_blank" rel="noopener"><span class="row-ic">${icon('receipt')}</span><span class="row-main"><b>${esc(t('paywallTerms'))}</b></span></a>
      <a class="row" href="${legalUrl('privacy')}" target="_blank" rel="noopener"><span class="row-ic">${icon('receipt')}</span><span class="row-main"><b>${esc(t('paywallPrivacy'))}</b></span></a>
    </section>
  </div>`;
  return { title: t('shop.settings'), back: 'shop', body };
}

function viewTeam() {
  if (Live.on) return Live.viewTeam();
  const C = S.cloud;
  if (!C.signedIn) return { title: t('cloud.team'), back: 'shop/settings', body: empty(t('cloud.signInSubtitle')) };
  const inv = C.invite && new Date(C.invite.expires) > new Date() ? C.invite : null;
  const invite = `<section class="card stack-sm"><h3 class="card-title">${esc(t('cloud.team.invite'))}</h3>${inv
    ? `<p class="invite-code"><bdi dir="ltr">${esc(inv.code)}</bdi></p><p class="muted small">${esc(t('cloud.team.inviteExpires', `${fmtShort(new Date(inv.expires))} ${fmtTime(new Date(inv.expires))}`))}</p><a class="btn ghost small" href="https://wa.me/?text=${encodeURIComponent(t('cloud.team.shareMessage', inv.code))}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(t('common.share'))}</a>`
    : `<div><button class="btn primary small" data-act="invite">${icon('plus')} ${esc(t('cloud.team.invite'))}</button></div>`}<p class="muted small">${esc(t('cloud.team.inviteFooter'))}</p></section>`;
  const perms = ['orders', 'prepare', 'money', 'products'];
  const members = `<section class="card stack-sm"><h3 class="card-title">${esc(t('cloud.team.members'))}</h3>
    <div class="split"><span class="row-main"><b><bdi dir="ltr">${esc(C.email)}</bdi></b></span>${badge('brand', t('cloud.team.owner'))}</div>
    ${C.team.map(m => `<div class="member"><div class="split"><b>${esc(pick(m.name, m.nameEn))}</b><button class="link-btn danger small" data-act="remove-member" data-id="${esc(m.id)}">${esc(t('cloud.team.remove'))}</button></div><div class="perm-grid">${perms.map(k => `<label class="check"><input type="checkbox" data-live="perm" data-id="${esc(m.id)}" data-k="${k}"${m.perms[k] ? ' checked' : ''}><span>${esc(t('cloud.permission.' + k))}</span></label>`).join('')}</div></div>`).join('')}
  </section>`;
  return { title: t('cloud.team'), back: 'shop/settings', body: `<div class="stack">${invite}${members}<p class="note">${esc(t('cloud.demoNote'))}</p></div>` };
}

// ---------- Ask Orderat and the paywall ----------

// Stand-in for the orderat-ask function: answers the five suggested questions from this browser's data.
function intentOf(q) {
  const s = norm(q);
  if (/ربح|كسبت|دخل|profit|made|earn/.test(s)) return 'profit';
  if (/عليه|عليهم|owe|unpaid|دين|فلوس/.test(s)) return 'unpaid';
  if (/ينباع|يبيع|مبيع|sell|best|popular/.test(s)) return 'topSeller';
  if (/احضر|تحضير|prep|tomorrow|بكره/.test(s)) return 'prepTomorrow';
  if (/بوست|منشور|كابشن|caption|post/.test(s)) return 'caption';
  return 'generic';
}
function answer(kind) {
  const today = startOfDay(new Date());
  if (kind === 'profit') {
    const st = periodStats(new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1));
    return `<p>${esc(t('ask.answer.profit', money(st.revenue), st.count, money(st.vat + st.cogs + st.expenses), money(st.profit)))}</p>`;
  }
  if (kind === 'unpaid') {
    const list = debtors();
    if (!list.length) return `<p>${esc(t('ask.answer.noneUnpaid'))}</p>`;
    return `<p>${esc(t('ask.answer.unpaid', list.length, money(sum(list, d => d.amount))))}</p><ul>${list.slice(0, 5).map(d => `<li><b>${esc(cName(d.c))}</b> · ${esc(money(d.amount))}${d.c.phone ? ` · <a href="${esc(waLink(d.c.phone, t('whatsapp.message.paymentReminder', firstName(d.c), shopName(), money(d.amount))))}" target="_blank" rel="noopener">${esc(t('ask.action.sendReminders'))}</a>` : ''}</li>`).join('')}</ul>`;
  }
  if (kind === 'topSeller') {
    const top = topItems(live().filter(o => inRange(o.dueAt, addDays(today, -29), addDays(today, 1)))).slice(0, 3);
    return `<p>${esc(t('ask.answer.topSeller'))}</p><ol>${top.map(x => `<li>${esc(x.name)} · ×${x.qty}</li>`).join('')}</ol>`;
  }
  if (kind === 'prepTomorrow') {
    const tm = addDays(today, 1), os = live().filter(o => inRange(o.dueAt, tm, addDays(tm, 1)));
    if (!os.length) return `<p>${esc(t('ask.answer.prepNone'))}</p>`;
    return `<p>${esc(t('ask.answer.prep', fmtDay(tm)))}</p><ul>${topItems(os).map(x => `<li>×${x.qty} ${esc(x.name)}</li>`).join('')}</ul>`;
  }
  if (kind === 'caption') {
    const best = topItems(live())[0], cap = aiCaption((best && productOf(best.pid)) || S.products.find(p => p.active));
    return `<p>${esc(t('ask.answer.caption'))}</p><p class="caption-box">${esc(cap)}</p><button class="chip" data-act="copy" data-text="${esc(cap)}">${icon('copy')} ${esc(t('marketing.copy'))}</button>`;
  }
  return `<p>${esc(t('ask.answer.generic'))}</p>`;
}
function renderAsk() {
  const log = ASK.msgs.length
    ? ASK.msgs.map(m => `<div class="msg ${m.me ? 'me' : 'bot'}">${m.html}</div>`).join('')
    : `<div class="ask-empty">${icon('sparkle')}<h3>${esc(t('ask.emptyTitle'))}</h3><p class="muted">${esc(t('ask.emptySubtitle'))}</p></div>`;
  const suggestions = ['profit', 'unpaid', 'topSeller', 'prepTomorrow', 'caption'].map(k => `<button class="chip small" data-act="ask-suggest" data-q="${k}">${esc(t('ask.suggestion.' + k))}</button>`).join('');
  openModal(t('ask.title'), `<div class="ask"><div class="ask-log" id="ask-log">${log}${ASK.busy ? `<div class="msg bot typing">${esc(t('ask.thinking'))}</div>` : ''}</div>
    <div class="chips">${suggestions}</div>
    <form data-form="ask" class="ask-form"><input name="q" autocomplete="off" placeholder="${esc(t('ask.inputPlaceholder'))}" aria-label="${esc(t('ask.inputPlaceholder'))}"><button class="btn primary" aria-label="${esc(t('ask.send'))}"${ASK.busy ? ' disabled' : ''}>${icon('send')}</button></form></div>`, 'wide');
  const el = $('#ask-log');
  if (el) el.scrollTop = el.scrollHeight;
}
function askQuestion(kind, label) {
  if (Live.on) { Live.ask(label); return; } // orderat-ask with the shop's numbers
  if (ASK.busy) return;
  ASK.msgs.push({ me: true, html: esc(label) });
  ASK.busy = true;
  renderAsk();
  setTimeout(() => {
    ASK.msgs.push({ me: false, html: answer(kind) });
    ASK.busy = false;
    if (modalEl().open) { renderAsk(); $('.ask-form input')?.focus(); }
  }, 900);
}

const trialNotice = plan => t('paywallTrialNotice', TRIAL_DAYS, `${usd(PRICE[plan])} ${t(plan === 'yearly' ? 'paywall.perYear' : 'paywall.perMonth')}`);
function openPaywall() {
  if (Live.on) { Live.paywall(); return; }
  const saving = Math.round(100 - (PRICE.yearly / (PRICE.monthly * 12)) * 100);
  const features = ['whatsapp', 'ai', 'profit', 'vat', 'stock', 'link', 'studio', 'staff'];
  openModal(t('paywallTitle'), `<div class="paywall stack">
    <img src="favicon.svg" width="64" height="64" alt="">
    <ul class="checks">${features.map(f => `<li>${icon('check')}<span>${esc(t('feature.' + f))}</span></li>`).join('')}</ul>
    <div class="plans">
      <label class="plan"><input type="radio" name="plan" value="yearly" checked data-live="plan"><span class="row-main"><b>${esc(t('paywall.yearly'))}</b><small>${esc(usd(PRICE.yearly))} ${esc(t('paywall.perYear'))}</small></span>${badge('ok', t('paywallYearlySave', saving))}</label>
      <label class="plan"><input type="radio" name="plan" value="monthly" data-live="plan"><span class="row-main"><b>${esc(t('paywall.monthly'))}</b><small>${esc(usd(PRICE.monthly))} ${esc(t('paywall.perMonth'))}</small></span></label>
    </div>
    <p class="muted small center" id="pw-trial">${esc(trialNotice('yearly'))}</p>
    <button class="btn primary block big" data-act="paywall-cta">${esc(t('paywallCta'))}</button>
    <p class="note hidden" id="pw-note">${esc(t('paywall.appsOnly'))}</p>
    <p class="small center"><a href="${legalUrl('terms')}" target="_blank" rel="noopener">${esc(t('paywallTerms'))}</a> · <a href="${legalUrl('privacy')}" target="_blank" rel="noopener">${esc(t('paywallPrivacy'))}</a></p>
  </div>`);
}

// ---------- Events ----------

const ACTIONS = {
  lang() { S.lang = S.lang === 'ar' ? 'en' : 'ar'; save(); closeModal(); render(); },
  'pick-type'(el) { seed(el.dataset.type); lastPath = ''; go('today'); },
  'close-modal': closeModal,
  ask() { renderAsk(); $('.ask-form input')?.focus(); },
  'ask-suggest'(el) { askQuestion(el.dataset.q, t('ask.suggestion.' + el.dataset.q)); },
  paywall: openPaywall,
  'paywall-cta'() { $('#pw-note')?.classList.remove('hidden'); },
  'hide-campaign'(el) { S.hiddenCampaigns.push(el.dataset.id); save(); render(); },
  'web-add'(el) {
    const w = S.webOrders.find(x => x.id === el.dataset.id);
    if (!w) return;
    let c = S.customers.find(x => digits(x.phone) === digits(w.phone));
    if (!c) { c = { id: uid(), name: w.name, nameEn: w.nameEn, phone: w.phone, area: '', notes: '' }; S.customers.push(c); }
    const items = w.items.map(it => { const p = productOf(it.pid); return p && { pid: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: it.qty, price: p.price, cost: p.cost }; }).filter(Boolean);
    S.orders.push({ id: uid(), no: S.nextOrderNo++, customerId: c.id, dueAt: w.dueAt, items, fulfillment: 'pickup', area: '', deliveryFee: 0, source: 'link', payments: [], notes: '', changes: [{ kind: 'created', at: new Date().toISOString() }], status: 'new', stockApplied: false });
    S.webOrders = S.webOrders.filter(x => x !== w);
    save(); render(); toast(t('today.webOrderAdded'));
  },
  'web-dismiss'(el) { S.webOrders = S.webOrders.filter(x => x.id !== el.dataset.id); save(); render(); },
  'orders-filter'(el) { ordersFilter = el.dataset.v; render(); },
  advance(el) {
    const id = el.dataset.id, o = orderById(id);
    if (!o || !NEXT[o.status]) return;
    const prev = o.status, next = NEXT[o.status];
    setStatus(o, next);
    render();
    undoToast(t('orders.statusChanged', t('order.status.' + next)), () => {
      const now = orderById(id);
      if (now && now.status === next) { setStatus(now, prev); render(); }
    });
  },
  'cancel-order'(el) { const o = orderById(el.dataset.id); if (o && confirm(t('orders.cancelConfirm'))) { setStatus(o, 'cancelled'); render(); } },
  'reopen-order'(el) { const o = orderById(el.dataset.id); if (o && o.status === 'cancelled' && can('status')) { setStatus(o, 'new'); render(); toast(t('orders.statusChanged', t('order.status.new'))); } },
  'delete-order'(el) {
    const o = orderById(el.dataset.id);
    if (!o || !canDeleteOrder(o) || !confirm(t('orders.deleteConfirm'))) return;
    if (o.stockApplied) { if (Live.on) Live.stockForStatus(o, 'cancelled'); else applyStock(o, 1); o.stockApplied = false; }
    S.orders = S.orders.filter(x => x.id !== o.id);
    save();
    toast(t('common.saved'));
    go('orders');
  },
  'delete-customer'(el) {
    const id = el.dataset.id;
    if (!can('orders') || S.orders.some(o => o.customerId === id) || !confirm(t('customers.delete') + '?')) return;
    S.customers = S.customers.filter(c => c.id !== id);
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  pay(el) { const o = orderById(el.dataset.id); if (o) { openPayment(o, false); $('#modal input[name="amount"]')?.focus(); } },
  'pay-full'(el) { const o = orderById(el.dataset.id); if (o) openPayment(o, true); },
  'delete-payment'(el) {
    const o = orderById(el.dataset.id);
    if (!o || !can('orders') || !confirm(t('pay.delete') + '?')) return;
    const { pay, at } = el.dataset;
    const i = o.payments.findIndex(p => (pay ? p.id === pay : p.at === at));
    if (i < 0) return;
    o.payments = o.payments.filter((_, k) => k !== i);
    save(); render(); toast(t('common.saved'));
  },
  'edit-expense'(el) { const x = S.expenses.find(e => e.id === el.dataset.id); if (x && can('money')) openExpense(x); },
  'delete-expense'(el) {
    if (!can('money') || !confirm(t('expense.delete') + '?')) return;
    S.expenses = S.expenses.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  'edit-items'(el) { const o = orderById(el.dataset.id); if (o) openEditItems(o); },
  'item-qty'(el) {
    const p = el.dataset.p, i = +el.dataset.i, it = itemList(p)[i];
    if (!it) return;
    const q = Math.min(99, qtyNum(it.qty) + +el.dataset.d);
    if (q <= 0) { removeLine(p, i); return; }
    it.qty = q;
    rerenderItems(p);
  },
  'clear-draft'() {
    const typed = D && (D.text.trim() || D.name.trim() || D.phone.trim() || D.items.length || D.notes.trim());
    if (!typed || confirm(t('neworder.clearConfirm'))) { D = null; render(); }
  },
  'item-pick'(el) { openItemPicker(el.dataset.p); },
  'item-pick-back'() { if (E) { E.picking = false; renderEditItems(); } },
  'item-add'(el) {
    const p = el.dataset.p, pid = el.dataset.pid;
    if (p === 'd' && !D) return;
    if (p === 'e' && !E) return;
    const line = addProduct(itemList(p), pid);
    if (p === 'e') E.picking = false; else closeModal();
    rerenderItems(p);
    if (line && line.qty > 1) toast(t('neworder.itemAdded', lineName(line), line.qty));
    if (pid === 'custom') { const inputs = document.querySelectorAll(`[data-p="${p}"][data-f="name"]`); inputs[inputs.length - 1]?.focus(); }
  },
  'item-del'(el) { removeLine(el.dataset.p, +el.dataset.i); },
  parse() { if (D.text.trim()) { if (Live.on) Live.parseText(D.text); else readDraft(D.text, t('neworder.demoRead')); } },
  example(el) { const ex = examples()[+el.dataset.i]; if (ex) { D.text = ex.text; readDraft(ex.text, t('neworder.demoRead')); } },
  'money-range'(el) { moneyRange = el.dataset.v; render(); },
  'add-expense'() { openExpense(null); },
  'edit-shop': openShop,
  'add-product'() { openProduct(null); },
  'edit-product'(el) { openProduct(productOf(el.dataset.id)); },
  'delete-product'(el) { if (can('products') && confirm(t('common.delete') + '?')) { S.products = S.products.filter(p => p.id !== el.dataset.id); save(); closeModal(); render(); } },
  'add-customer'() { openCustomer(null); },
  'edit-customer'(el) { openCustomer(S.customers.find(c => c.id === el.dataset.id)); },
  'add-occasion': openOccasion,
  'delete-occasion'(el) { S.occasions = S.occasions.filter(o => o.id !== el.dataset.id); save(); render(); },
  copy(el) { copyText(el.dataset.text || ''); },
  'copy-caption'() { copyText(captionText()); },
  'caption-ai'() {
    CAP.busy = true;
    render();
    if (Live.on) { Live.caption(); return; }
    setTimeout(() => { CAP.ai = aiCaption(productOf(CAP.pid) || S.products.find(p => p.active)); CAP.busy = false; if (route()[1] === 'marketing') render(); }, 1100);
  },
  'campaign-photo'(el) { ST.campaign = el.dataset.id; ST.style = 'campaign'; ST.result = null; go('shop/marketing/studio'); },
  'campaign-occasion'(el) {
    const c = (CAMPAIGNS || []).find(x => x.id === el.dataset.id);
    if (!c) return;
    S.occasions.push({ id: nid(), kind: 'custom', nameAr: c.name.ar, nameEn: c.name.en, start: c.startDate, end: c.endDate, cap: null, blocked: false, campaignId: c.id });
    save(); render(); toast(t('campaign.addedToOccasions'));
  },
  'studio-sample'() { ST.photo = samplePhoto(); ST.result = null; render(); },
  'studio-style'(el) { ST.style = el.dataset.id; ST.result = null; render(); },
  'studio-generate'() { if (Live.on) Live.studioGenerate(); else generateStudio(); },
  'studio-use'() { if (Live.on) Live.studioUse(); else toast(t('studio.saved')); },
  'studio-again'() { ST.result = null; render(); },
  lead(el) { S.shopLink.leadDays = Math.max(0, Math.min(30, S.shopLink.leadDays + +el.dataset.d)); save(); render(); },
  unpublish() { if (confirm(t('shoplink.unpublishConfirm'))) { S.shopLink.published = false; save(); render(); } },
  print() { window.print(); },
  'share-receipt'(el) {
    const o = orderById(el.dataset.id);
    if (!o) return;
    const txt = receiptText(o);
    if (navigator.share) navigator.share({ title: invoiceNo(o), text: txt }).catch(() => {}); else copyText(txt);
  },
  export() {
    const blob = new Blob([JSON.stringify({ app: 'orderat-web', exportedAt: new Date().toISOString(), data: S }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orderat-backup-${dayKey(new Date())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'restore-demo'() { if (confirm(t('settings.restoreDemoConfirm'))) { seed(S.shop.businessType); go('today'); } },
  'delete-all'() {
    if (!confirm(t('settings.deleteAllConfirm'))) return;
    Object.assign(S, { isDemo: false, products: [], customers: [], orders: [], expenses: [], occasions: [], webOrders: [], nextOrderNo: 1 });
    D = null; save(); go('today');
  },
  'sign-in'(el) {
    Object.assign(S.cloud, { signedIn: true, email: el.dataset.p === 'apple' ? 'seller@privaterelay.appleid.com' : 'seller.demo@gmail.com', lastSynced: new Date().toISOString() });
    save(); render(); toast(`${t('cloud.signedInAs')}: ${S.cloud.email}`);
  },
  'sign-out'() { Object.assign(S.cloud, { signedIn: false, email: '', lastSynced: null, invite: null }); save(); render(); },
  'sync-now'() { S.cloud.lastSynced = new Date().toISOString(); save(); render(); toast(t('cloud.justNow')); },
  invite() { S.cloud.invite = { code: String(100000 + Math.floor(Math.random() * 900000)), expires: new Date(Date.now() + 48 * 3600e3).toISOString() }; save(); render(); },
  'remove-member'(el) { S.cloud.team = S.cloud.team.filter(m => m.id !== el.dataset.id); save(); render(); },
};

const LIVE = {
  'orders-q'(el) { ordersQuery = el.value; $('#orders-list').innerHTML = ordersListHtml(); },
  draft(el) {
    D[el.name] = el.value;
    if (D.errors && D.errors[el.name]) { delete D.errors[el.name]; el.removeAttribute('aria-invalid'); el.closest('.field')?.querySelector('.field-error')?.remove(); }
    if (el.name === 'text') { const b = $('[data-act="parse"]'); if (b) b.disabled = D.reading || !D.text.trim(); }
    if (el.name === 'fulfillment') render(); else updateTotal('d');
  },
  item(el) {
    const it = itemList(el.dataset.p)[+el.dataset.i];
    if (!it) return;
    if (el.dataset.f === 'pid') {
      it.pid = el.value;
      const p = productOf(el.value);
      it.price = p ? p.price : 0;
      rerenderItems(el.dataset.p);
      if (it.pid === 'custom') $(`[data-p="${el.dataset.p}"][data-i="${el.dataset.i}"][data-f="name"]`)?.focus();
      return;
    }
    it[el.dataset.f] = el.dataset.f === 'qty' ? qtyNum(el.value) : el.value;
    updateTotal(el.dataset.p);
  },
  shot(el) {
    const f = el.files?.[0];
    el.value = '';
    if (!f) return;
    if (Live.on) { Live.parseImage(f); return; }
    const ex = examples()[0];
    readDraft(ex ? ex.text : '', t('neworder.demoShot'));
  },
  setting(el) { S[el.name] = el.value; save(); render(); },
  currency(el) { S.shop.currency = el.value; save(); render(); },
  'business-type'(el) {
    if (Live.on) { S.shop.businessType = el.value; save(); render(); return; }
    if (confirm(t('settings.restoreDemoConfirm'))) { seed(el.value); go('today'); } else el.value = S.shop.businessType;
  },
  'vat-enabled'(el) {
    S.vat.enabled = el.checked;
    // The phones prefill the currency's rate the first time VAT is turned on.
    if (Live.on && el.checked && typeof S.vat.rateBps !== 'number') S.vat.rateBps = OrderatLiveCore.defaultRateBps(S.shop.currency);
    save(); render();
  },
  'vat-trn'(el) { S.vat.trn = el.value.trim(); save(); },
  'vat-include'(el) { S.vat.pricesInclude = el.value === 'yes'; save(); },
  'stock-enabled'(el) { S.stockEnabled = el.checked; save(); },
  'ask-enabled'(el) { S.askEnabled = el.checked; save(); },
  import(el) {
    const f = el.files?.[0];
    el.value = '';
    if (!f) return;
    f.text().then(txt => {
      const d = JSON.parse(txt).data;
      if (!d || !Array.isArray(d.orders) || !d.shop) throw new Error('not a backup');
      S = Object.assign(d, { v: 1, onboarded: true, lang: S.lang, theme: S.theme, addressAs: S.addressAs });
      D = null; save(); render(); toast(t('settings.imported'));
    }).catch(() => toast(t('settings.importError')));
  },
  caption(el) {
    CAP[el.name] = el.value;
    CAP.ai = '';
    if (el.name === 'template') { render(); return; }
    $('#cap-preview').textContent = captionText();
    $('#cap-share').href = `https://wa.me/?text=${encodeURIComponent(captionText())}`;
  },
  'studio-photo'(el) {
    const f = el.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { ST.photo = reader.result; ST.result = null; render(); };
    reader.readAsDataURL(f);
  },
  'studio-shape'(el) { ST.shape = el.value; ST.result = null; render(); },
  slug(el) {
    const v = el.value.trim().toLowerCase();
    SLUG.value = v;
    clearTimeout(slugTimer);
    SLUG.status = !v ? 'idle' : !validSlug(v) ? 'invalid' : 'checking';
    paintSlug();
    if (SLUG.status === 'checking') slugTimer = setTimeout(() => { SLUG.status = TAKEN_SLUGS.includes(v) && v !== S.shopLink.slug ? 'taken' : 'available'; paintSlug(); }, 600);
  },
  'link-field'(el) { S.shopLink[el.name] = el.type === 'checkbox' ? el.checked : el.value; save(); },
  perm(el) { const m = S.cloud.team.find(x => x.id === el.dataset.id); if (m) { m.perms[el.dataset.k] = el.checked; save(); } },
  plan(el) { $('#pw-trial').textContent = trialNotice(el.value); },
};

const FORMS = {
  'new-order'() {
    const items = cleanItems(D.items);
    const name = D.name.trim();
    const errors = {};
    if (D.items.some(it => it.pid === 'custom' && qtyNum(it.qty) > 0 && !String(it.name || '').trim())) errors.items = t('items.nameCustom');
    else if (!items.length) errors.items = t('neworder.needItem');
    if (!name) errors.name = t('err.name');
    if (Object.keys(errors).length) { showDraftErrors(errors); return; }
    D.errors = null;
    const localLen = OrderatLiveCore.localDigits(S.shop.currency);
    const tail = digits(D.phone).slice(-localLen);
    let c = S.customers.find(x => (tail.length === localLen && digits(x.phone).endsWith(tail)) || x.name === name || x.nameEn === name);
    if (!c) { c = { id: nid(), name, nameEn: '', phone: tail.length === localLen && !D.phone.trim().startsWith('+') ? '+' + OrderatLiveCore.callingCode(S.shop.currency) + tail : D.phone.trim(), area: D.area, notes: '' }; S.customers.push(c); }
    const now = new Date().toISOString(), delivery = D.fulfillment === 'delivery';
    const due = new Date(D.due);
    const order = {
      id: nid(), no: Live.on ? undefined : S.nextOrderNo++, customerId: c.id, dueAt: (isNaN(due) ? new Date() : due).toISOString(), items,
      fulfillment: D.fulfillment, area: delivery ? D.area || c.area || '' : '', address: delivery ? String(D.address || '').trim() : '', deliveryFee: delivery ? parseFloat(D.fee) || 0 : 0,
      source: D.source, payments: [], notes: D.notes.trim(), changes: [{ kind: 'created', at: now }], status: 'new', stockApplied: false,
    };
    const deposit = parseFloat(D.deposit);
    if (deposit > 0) {
      order.payments.push({ amount: round(deposit), method: D.method, note: '', at: now });
      order.changes.push({ kind: 'payment', value: round(deposit), at: now });
    }
    if (Live.on) {
      delete order.no; // display numbers come from creation order
      order.createdAt = now;
      Live.applyOrderVat(order); // the VAT snapshot and invoice number, like the phones
    }
    S.orders.push(order);
    save();
    D = null;
    toast(t('neworder.saved'));
    go('orders/' + order.id);
  },
  payment(f, fd) {
    const id = f.dataset.id, o = orderById(id), amount = parseFloat(fd.get('amount'));
    if (!o) return;
    if (!(amount > 0)) { fieldError(f, 'amount', t('err.amount')); return; }
    const due = totals(o).due;
    if (amount > due + 1e-9 && !confirm(t('pay.overpay', money(due)))) return;
    const at = new Date().toISOString(), value = round(amount);
    o.payments.push({ amount: value, method: fd.get('method') || 'cash', note: String(fd.get('note') || ''), at });
    o.changes.push({ kind: 'payment', value, at });
    save(); closeModal(); render();
    undoToast(t('common.saved'), () => {
      const now = orderById(id);
      if (!now) return;
      now.payments = now.payments.filter(p => !(p.at === at && p.amount === value));
      save(); render();
    });
  },
  'edit-items'() {
    const o = orderById(E.id);
    if (!o) return;
    if (E.items.some(it => it.pid === 'custom' && qtyNum(it.qty) > 0 && !String(it.name || '').trim())) { toast(t('items.nameCustom')); return; }
    const items = cleanItems(E.items);
    if (!items.length) { toast(t('neworder.needItem')); return; }
    if (Live.on) {
      Live.stockForEdit(o, items);
      o.items = items;
      Live.applyOrderVat(o);
    } else {
      if (o.stockApplied) applyStock(o, 1);
      o.items = items;
      if (o.stockApplied) applyStock(o, -1);
    }
    o.changes.push({ kind: 'items', at: new Date().toISOString() });
    save(); closeModal(); render();
  },
  expense(f, fd) {
    const amount = parseFloat(fd.get('amount'));
    if (!(amount > 0)) { fieldError(f, 'amount', t('err.amount')); return; }
    const data = { amount: round(amount), category: fd.get('category'), note: String(fd.get('note') || ''), date: new Date(`${fd.get('date')}T12:00`).toISOString() };
    const x = f.dataset.id && S.expenses.find(e => e.id === f.dataset.id);
    if (x) Object.assign(x, data); else S.expenses.push({ id: nid(), ...data });
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  shop(f, fd) {
    const get = k => String(fd.get(k) || '').trim();
    Object.assign(S.shop, { nameAr: get('nameAr') || S.shop.nameAr, nameEn: get('nameEn'), phone: get('phone'), pickupHours: get('pickupHours'), dailyCapacity: +get('dailyCapacity') || 0 });
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  product(f, fd) {
    const get = k => String(fd.get(k) || '').trim();
    if (!get('nameAr') && !get('nameEn')) { fieldError(f, 'nameAr', t('err.productName')); return; }
    const data = { nameAr: get('nameAr') || get('nameEn'), nameEn: get('nameEn') || get('nameAr'), price: +get('price') || 0, cost: +get('cost') || 0, cap: get('cap') ? +get('cap') : null, active: fd.has('active') };
    if (S.stockEnabled) Object.assign(data, { track: fd.has('track'), qty: +get('qty') || 0, low: +get('low') || 0 });
    const p = productOf(f.dataset.id);
    if (!can('products')) return;
    // A quantity left as it was when the form opened keeps the current one (another device may have moved
    // stock since); only a typed quantity becomes a correction.
    if (p && S.stockEnabled && fd.has('qty0') && get('qty') === get('qty0')) data.qty = p.qty;
    if (p && Live.on && S.stockEnabled && data.track) Live.stockCorrection(Object.assign(p, { track: true }), data.qty);
    if (p) Object.assign(p, data); else S.products.push({ id: nid(), aliases: [], track: false, qty: 0, low: 3, ...(Live.on ? { stockMoves: [], photoId: null } : {}), ...data });
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  customer(f, fd) {
    const get = k => String(fd.get(k) || '').trim();
    if (!get('name')) return;
    const c = S.customers.find(x => x.id === f.dataset.id);
    const data = { phone: get('phone'), area: get('area'), notes: get('notes') };
    if (c) {
      // Keep the other language's name when the shown one is unchanged.
      if (get('name') !== cName(c)) Object.assign(c, { name: get('name'), nameEn: '' });
      Object.assign(c, data);
    } else S.customers.push({ id: nid(), name: get('name'), nameEn: '', ...data });
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  occasion(f, fd) {
    const get = k => String(fd.get(k) || '').trim();
    const kind = get('kind') || 'custom', label = I18N['occasion.kind.' + kind] || ['', ''];
    const start = get('start'), end = get('end') < start ? start : get('end');
    S.occasions.push({ id: nid(), kind, nameAr: get('nameAr') || label[1], nameEn: get('nameEn') || label[0], start, end, cap: get('cap') ? +get('cap') : null, blocked: fd.has('blocked') });
    save(); closeModal(); render(); toast(t('common.saved'));
  },
  shoplink() {
    const v = SLUG.value;
    if (!validSlug(v)) { SLUG.status = 'invalid'; paintSlug(); return; }
    if (TAKEN_SLUGS.includes(v) && v !== S.shopLink.slug) { SLUG.status = 'taken'; paintSlug(); return; }
    Object.assign(S.shopLink, { slug: v, published: true });
    SLUG.status = 'idle';
    save(); render(); toast(t('shoplink.published'));
  },
  join() { toast(t('cloud.error.invalidCode')); },
  ask(f, fd) {
    const q = String(fd.get('q') || '').trim();
    if (q) askQuestion(intentOf(q), q);
  },
};

function onLive(e) {
  const el = e.target.closest?.('[data-live]');
  if (!el) return;
  const typed = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(el.type));
  if (typed === (e.type === 'input')) LIVE[el.dataset.live]?.(el, e);
}
Object.assign(ACTIONS, Live.actions);
Object.assign(LIVE, Live.liveHandlers);
Object.assign(FORMS, Live.forms);
document.addEventListener('input', onLive);
document.addEventListener('change', onLive);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) {
    if (el.tagName === 'BUTTON') e.preventDefault();
    ACTIONS[el.dataset.act]?.(el, e);
    return;
  }
  if (e.target === modalEl() && (!modalDirty || confirm(t('common.discard')))) closeModal();
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.closest?.('#modal') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(el.type)))) modalDirty = true;
  if (el.getAttribute?.('aria-invalid') === 'true' && el.closest?.('#modal')) { el.removeAttribute('aria-invalid'); el.closest('.field')?.querySelector('.field-error')?.remove(); }
});
modalEl().addEventListener('cancel', e => { if (modalDirty && !confirm(t('common.discard'))) e.preventDefault(); });
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  FORMS[f.dataset.form]?.(f, new FormData(f));
});
// Return in a New order field moves to the next field and never saves (implicit submission would
// report the Save button as the submitter, so this does not look at e.submitter).
document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key !== 'Enter' || e.isComposing || el.tagName !== 'INPUT') return;
  const f = el.closest("form[data-form='new-order']");
  if (!f) return;
  e.preventDefault();
  const fields = [...f.querySelectorAll('input, select, textarea')].filter(x => !x.disabled && !['hidden', 'radio', 'checkbox', 'file', 'submit', 'button'].includes(x.type) && x.offsetParent !== null);
  const next = fields[fields.indexOf(el) + 1];
  if (next) next.focus(); else el.blur();
});
window.addEventListener('hashchange', render);

Live.boot(); // the signed-in shop when there is a session, else the demo or the start screen
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
