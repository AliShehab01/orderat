// Standalone owner page for the hosted Orderat function. Supabase Edge Functions on *.supabase.co
// rewrite text/html responses to text/plain without a custom domain (see README.md "Hosting"), so
// this page — not the HTML server/owner/page.ts serves locally — is the owner UI for the hosted
// deployment. It talks to the JSON-only Edge Function with `Authorization: Bearer <OWNER_KEY>`
// (server/owner/auth.ts's withOwnerBearerAuth); server/owner/cors.ts only allows this page's own
// origin to read the response. The owner key is asked for once and kept only in this browser
// (sessionStorage by default, localStorage when "Remember on this device" is ticked) — never sent
// anywhere but this one API. All order data is untrusted, customer-typed text, so every render below
// uses textContent, never innerHTML.
"use strict";

const API_BASE = "https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-owner";
const KEY_STORAGE_NAME = "orderat_owner_key";
const LANG_STORAGE_NAME = "orderat_owner_lang";
const REFRESH_MS = 5000;

const STRINGS = {
  title: { ar: "اوردرات · لوحة المالك", en: "Orderat · Owner dashboard" },
  subtitle: { ar: "راجع طلبات واتساب وإنستغرام وأكّدها من أي جهاز.", en: "Review WhatsApp and Instagram orders and confirm them from any device." },
  langToggle: { ar: "English", en: "العربية" },
  signOut: { ar: "تسجيل الخروج", en: "Sign out" },
  signinTitle: { ar: "تسجيل الدخول", en: "Sign in" },
  signinBody: { ar: "أدخل مفتاح المالك (OWNER_KEY) مرة واحدة. يبقى محفوظاً في هذا المتصفح فقط.", en: "Enter the owner key (OWNER_KEY) once. It stays only in this browser." },
  keyLabel: { ar: "مفتاح المالك", en: "Owner key" },
  remember: { ar: "تذكرني على هذا الجهاز", en: "Remember on this device" },
  signinSubmit: { ar: "دخول", en: "Sign in" },
  openTitle: { ar: "الطلبات المفتوحة", en: "Open orders" },
  openHint: { ar: "بانتظار تأكيدك", en: "Waiting for your confirmation" },
  todayTitle: { ar: "طلبات اليوم", en: "Today's orders" },
  todayHint: { ar: "حسب وقت الاستلام", en: "By collection time" },
  emptyOpen: { ar: "لا توجد طلبات مفتوحة الآن.", en: "No open orders right now." },
  emptyToday: { ar: "لا توجد طلبات لاستلام اليوم.", en: "No orders for collection today." },
  confirm: { ar: "تأكيد الطلب", en: "Confirm order" },
  pending: { ar: "بانتظار تأكيدك", en: "Pending" },
  confirmed: { ar: "مؤكد", en: "Confirmed" },
  noCollection: { ar: "بدون وقت استلام بعد", en: "No collection time yet" },
  collectionLabel: { ar: "الاستلام: ", en: "Collection: " },
  notesLabel: { ar: "ملاحظات: ", en: "Notes: " },
  sourceLabel: { ar: "رسالة العميل: ", en: "Customer message: " },
  changesLabel: { ar: "تعديلات من العميل: ", en: "Changes from customer: " },
  instagramPrefix: { ar: "إنستغرام · ", en: "Instagram · " },
  whatsappPrefix: { ar: "واتساب · +", en: "WhatsApp · +" },
  wrongKey: { ar: "المفتاح غير صحيح.", en: "Incorrect key." },
  sessionExpired: { ar: "انتهت الجلسة أو المفتاح غير صحيح. سجّل الدخول مرة أخرى.", en: "Your session ended or the key is wrong. Sign in again." },
  connectionError: { ar: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت.", en: "Couldn't reach the server. Check your connection." },
  loadError: { ar: "تعذر تحميل الطلبات.", en: "Couldn't load orders." },
  confirmFailed: { ar: "تعذر تأكيد الطلب.", en: "Couldn't confirm the order." },
  confirmedSent: { ar: "تم تأكيد الطلب وأُرسلت رسالة التأكيد للعميل.", en: "Order confirmed and a confirmation message was sent to the customer." },
  confirmedNoSend: { ar: "تم تأكيد الطلب، لكن تعذر إرسال رسالة للعميل. ", en: "Order confirmed, but the message to the customer couldn't be sent. " },
  tryLater: { ar: "حاول مرة أخرى لاحقاً.", en: "Try again later." },
};

// Plain-language reasons for common WhatsApp send errors — mirrors server/owner/page.ts's SEND_ERRORS.
const SEND_ERRORS = {
  131030: { ar: "رقم العميل ليس في قائمة الأرقام المسموح بها لرقم الاختبار في Meta.", en: "The customer's number isn't on the test number's allowed list in Meta." },
  131047: { ar: "مرّ أكثر من 24 ساعة على آخر رسالة من العميل، لذلك لا يسمح واتساب بإرسال رسالة حرة الآن.", en: "More than 24 hours have passed since the customer's last message, so WhatsApp won't allow a free-form message now." },
  190: { ar: "انتهت صلاحية مفتاح واتساب. أنشئ مفتاحاً جديداً من صفحة Meta وضعه في الإعدادات.", en: "The WhatsApp access token expired. Create a new one in Meta and update the settings." },
};

// --- storage (best-effort: private browsing / blocked storage must never crash the page) ---
function safeGet(storage, name) { try { return storage.getItem(name); } catch { return null; } }
function safeSet(storage, name, value) { try { storage.setItem(name, value); } catch { /* ignore */ } }
function safeRemove(storage, name) { try { storage.removeItem(name); } catch { /* ignore */ } }

function loadStoredKey() {
  return safeGet(sessionStorage, KEY_STORAGE_NAME) || safeGet(localStorage, KEY_STORAGE_NAME) || null;
}
function persistKey(key, remember) {
  if (remember) { safeSet(localStorage, KEY_STORAGE_NAME, key); safeRemove(sessionStorage, KEY_STORAGE_NAME); }
  else { safeSet(sessionStorage, KEY_STORAGE_NAME, key); safeRemove(localStorage, KEY_STORAGE_NAME); }
}
function clearStoredKey() {
  safeRemove(sessionStorage, KEY_STORAGE_NAME);
  safeRemove(localStorage, KEY_STORAGE_NAME);
}

// --- language ---
let lang = safeGet(localStorage, LANG_STORAGE_NAME) === "en" ? "en" : "ar";
function t(key) { return STRINGS[key][lang]; }

function applyStaticText() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
}

// --- DOM helpers ---
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// --- time formatting (Latin digits everywhere, Bahrain time zone) ---
function locale() { return lang === "en" ? "en-GB" : "ar-BH-u-nu-latn"; }
function bahrainDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bahrain", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function formatCollection(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(locale(), { timeZone: "Asia/Bahrain", weekday: "short", day: "numeric", month: "short" });
  const timePart = d.toLocaleTimeString(locale(), { timeZone: "Asia/Bahrain", hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}
function isToday(order) {
  return Boolean(order.collectionAt) && bahrainDateKey(new Date(order.collectionAt)) === bahrainDateKey(new Date());
}

// --- API ---
function apiUrl(path) { return API_BASE + path; }

async function apiFetch(path, options) {
  const res = await fetch(apiUrl(path), {
    ...options,
    credentials: "omit",
    headers: { ...(options && options.headers), authorization: `Bearer ${currentKey}` },
  });
  return res;
}

/** @returns {Promise<{ok: true, orders: unknown[]} | {ok: false, reason: "unauthorized" | "error" | "network"}>} */
async function fetchOrders() {
  let res;
  try {
    res = await apiFetch("/api/orders", {});
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (!res.ok) return { ok: false, reason: "error" };
  return { ok: true, orders: await res.json() };
}

// --- state ---
let currentKey = loadStoredKey();
let latestOrders = [];
let refreshTimer;

// --- elements ---
const signinCard = document.getElementById("signin-card");
const appEl = document.getElementById("app");
const signinForm = document.getElementById("signin-form");
const keyInput = document.getElementById("owner-key");
const rememberInput = document.getElementById("remember");
const signinSubmit = document.getElementById("signin-submit");
const signinError = document.getElementById("signin-error");
const signOutBtn = document.getElementById("sign-out");
const langToggleBtn = document.getElementById("lang-toggle");
const openList = document.getElementById("open-list");
const todayList = document.getElementById("today-list");
const toast = document.getElementById("toast");

function showToast(text) {
  toast.textContent = text;
  toast.style.display = "block";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.style.display = "none"; }, 5000);
}

function showApp() {
  signinCard.hidden = true;
  appEl.hidden = false;
  signOutBtn.hidden = false;
}
function showSignin() {
  signinCard.hidden = false;
  appEl.hidden = true;
  signOutBtn.hidden = true;
  clearInterval(refreshTimer);
}

function orderCard(order) {
  const card = el("article", "card order-card");
  const top = el("div", "row");
  const who = el("div");
  const contactPrefix = order.channel === "instagram" ? t("instagramPrefix") : t("whatsappPrefix");
  who.append(el("div", "name", order.customerName), el("div", "contact", contactPrefix + order.customerId));
  top.append(who, el("span", `badge ${order.status}`, order.status === "pending" ? t("pending") : t("confirmed")));
  card.append(top);

  const items = el("ul", "items");
  for (const item of order.items) items.append(el("li", "", `${item.name} × ${item.quantity}`));
  card.append(items);

  card.append(el("p", order.collectionAt ? "meta" : "meta warn", order.collectionAt ? t("collectionLabel") + formatCollection(order.collectionAt) : t("noCollection")));
  if (order.notes) card.append(el("p", "meta", t("notesLabel") + order.notes));
  if (order.sourceText) card.append(el("p", "meta", t("sourceLabel") + order.sourceText));
  if (order.changes && order.changes.length) card.append(el("p", "meta", t("changesLabel") + order.changes.length));

  if (order.status === "pending") {
    const btn = el("button", "confirm", t("confirm"));
    btn.type = "button";
    btn.onclick = () => confirmOrder(order.id, btn);
    card.append(btn);
  }
  return card;
}

function renderList(container, orders, emptyKey) {
  container.replaceChildren();
  if (!orders.length) {
    container.append(el("div", "empty", t(emptyKey)));
    return;
  }
  for (const order of orders) container.append(orderCard(order));
}

function renderAll() {
  renderList(openList, latestOrders.filter((o) => o.status === "pending"), "emptyOpen");
  const today = latestOrders.filter(isToday).slice().sort((a, b) => (a.collectionAt || "").localeCompare(b.collectionAt || ""));
  renderList(todayList, today, "emptyToday");
}

async function load() {
  const result = await fetchOrders();
  if (!result.ok) {
    if (result.reason === "unauthorized") { signOut(true); return; }
    showToast(result.reason === "network" ? t("connectionError") : t("loadError"));
    return;
  }
  latestOrders = result.orders;
  renderAll();
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(load, REFRESH_MS);
}

async function confirmOrder(id, btn) {
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/orders/${encodeURIComponent(id)}/confirm`, { method: "POST" });
    if (res.status === 401) { signOut(true); return; }
    const body = await res.json();
    if (!res.ok) {
      showToast(body.error || t("confirmFailed"));
    } else if (body.messageSent) {
      showToast(t("confirmedSent"));
    } else {
      const reason = body.errorCode != null && SEND_ERRORS[body.errorCode] ? SEND_ERRORS[body.errorCode][lang] : t("tryLater");
      showToast(t("confirmedNoSend") + reason);
    }
  } catch {
    showToast(t("connectionError"));
  } finally {
    await load();
  }
}

function signOut(expired) {
  clearStoredKey();
  currentKey = null;
  latestOrders = [];
  keyInput.value = "";
  rememberInput.checked = false;
  signinError.textContent = expired ? t("sessionExpired") : "";
  showSignin();
}

signinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key) return;
  signinSubmit.disabled = true;
  signinError.textContent = "";
  currentKey = key;
  const result = await fetchOrders();
  if (!result.ok) {
    currentKey = null;
    signinError.textContent = result.reason === "unauthorized" ? t("wrongKey") : t("connectionError");
    signinSubmit.disabled = false;
    return;
  }
  persistKey(key, rememberInput.checked);
  latestOrders = result.orders;
  signinSubmit.disabled = false;
  showApp();
  renderAll();
  startAutoRefresh();
});

signOutBtn.addEventListener("click", () => signOut(false));

langToggleBtn.addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  safeSet(localStorage, LANG_STORAGE_NAME, lang);
  applyStaticText();
  signinError.textContent = "";
  if (!appEl.hidden) renderAll();
});

applyStaticText();
if (currentKey) {
  showApp();
  load().then(startAutoRefresh);
} else {
  showSignin();
}
