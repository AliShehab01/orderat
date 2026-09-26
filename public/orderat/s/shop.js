// Public shop page (docs/marketing-tools.md, part C). Loads a seller's shop from the orderat-shop
// Edge Function, lets a customer build a cart and send the order, then hands the summary to
// WhatsApp. Every piece of shop text is rendered with textContent, never as HTML.
(function () {
  "use strict";

  var API = "https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-shop";
  // Public anon key (the same one the iPhone and Android apps ship with); safe to expose.
  var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNram1iZGJ2bGJ4Zm9mamdxaXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMzkwNjYsImV4cCI6MjEwNDgxNTA2Nn0.b126zMNS0U373kp0vI7ezzj2joHpuu87Cf8FFzIENIQ";
  var HOME_URL = "../";
  var REPORT_EMAIL = "alishehab.tech@gmail.com";
  var SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  var PHOTO_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//;
  var DECIMALS = { BHD: 3, KWD: 3, OMR: 3, JOD: 3, SAR: 2, AED: 2, QAR: 2, USD: 2 };
  var CURRENCY_AR = { BHD: "د.ب", KWD: "د.ك", OMR: "ر.ع", SAR: "ر.س", AED: "د.إ", QAR: "ر.ق", USD: "$" };
  var MAX_QTY = 99;
  var MAX_LINES = 30;

  var T = {
    ar: {
      title: "اطلب أونلاين",
      loading: "جاري تحميل المتجر",
      notFoundTitle: "ما لقينا هالمتجر",
      notFoundBody: "تأكد من الرابط، أو اطلب من المتجر الرابط الصحيح.",
      noSlugTitle: "روابط متاجر اوردرات",
      noSlugBody: "افتح رابط المتجر اللي وصلك من البائع.",
      errorTitle: "ما قدرنا نفتح المتجر",
      errorBody: "تأكد من الاتصال بالإنترنت وحاول مرة ثانية.",
      retry: "حاول مرة ثانية",
      menu: "القائمة",
      emptyMenu: "ما في منتجات معروضة الحين.",
      add: "أضف",
      remove: "إنقاص",
      increase: "زيادة",
      unavailable: "غير متوفر",
      pickup: "استلام",
      delivery: "توصيل",
      pickupAndDelivery: "استلام أو توصيل",
      leadSame: "طلبات نفس اليوم",
      lead1: "اطلب قبلها بيوم",
      lead2: "اطلب قبلها بيومين",
      leadFew: "اطلب قبلها بـ {n} أيام",
      leadMany: "اطلب قبلها بـ {n} يوم",
      reviewOrder: "مراجعة الطلب",
      yourOrder: "طلبك",
      total: "المجموع",
      name: "الاسم",
      nameOptional: "الاسم (اختياري)",
      phone: "رقم الهاتف",
      phoneHint: "المتجر بيتواصل معك على هالرقم",
      how: "طريقة الاستلام",
      address: "عنوان التوصيل",
      date: "التاريخ",
      time: "الوقت (اختياري)",
      hoursHint: "أوقات الاستلام:",
      notes: "ملاحظات (اختياري)",
      notesPh: "مثلاً: بدون مكسرات، أو كتابة على الكيكة",
      send: "إرسال الطلب",
      sending: "جاري الإرسال",
      orderOnWa: "اطلب عبر واتساب",
      waNote: "بيفتح واتساب ورسالة الطلب جاهزة، بس اضغط إرسال.",
      doneTitle: "تم إرسال طلبك",
      doneRef: "رقم الطلب",
      doneBody: "بيأكد لك المتجر الطلب على واتساب.",
      sendWa: "أرسل الطلب على واتساب",
      backToMenu: "رجوع للقائمة",
      close: "إغلاق",
      errInvalid: "تأكد من البيانات وحاول مرة ثانية.",
      errRate: "طلبات كثيرة الحين. حاول بعد شوي أو اطلب عبر واتساب.",
      errNetwork: "ما قدرنا نرسل الطلب. تأكد من الإنترنت أو اطلب عبر واتساب.",
      errClosed: "المتجر ما يستقبل طلبات من الموقع الحين. اطلب عبر واتساب.",
      errRequired: "هذا الحقل مطلوب",
      errPhone: "اكتب رقم صحيح (8 أرقام على الأقل)",
      errDate: "اختر تاريخ من {d} وبعد",
      errMaxLines: "وصلت الحد الأعلى للأصناف في الطلب",
      powered: "صُنع بواسطة اوردرات",
      poweredCta: "سوّي رابط متجرك",
      report: "إبلاغ عن هذا المتجر",
      share: "مشاركة",
      copied: "تم نسخ الرابط",
      other: "English",
      otherLang: "en",
      demoBanner: "متجر تجريبي للعرض فقط",
      waHello: "مرحبا {shop}، أبغى أطلب:",
      waTotal: "المجموع",
      waName: "الاسم",
      waDate: "الموعد",
      waDelivery: "توصيل إلى",
      waPickup: "استلام",
      waNotes: "ملاحظات",
    },
    en: {
      title: "Order online",
      loading: "Loading the shop",
      notFoundTitle: "We couldn't find this shop",
      notFoundBody: "Check the link, or ask the shop for the right one.",
      noSlugTitle: "Orderat shop links",
      noSlugBody: "Open the shop link the seller sent you.",
      errorTitle: "We couldn't open the shop",
      errorBody: "Check your internet connection and try again.",
      retry: "Try again",
      menu: "Menu",
      emptyMenu: "No products are listed right now.",
      add: "Add",
      remove: "Decrease",
      increase: "Increase",
      unavailable: "Unavailable",
      pickup: "Pickup",
      delivery: "Delivery",
      pickupAndDelivery: "Pickup or delivery",
      leadSame: "Same-day orders",
      lead1: "Order 1 day ahead",
      lead2: "Order 2 days ahead",
      leadFew: "Order {n} days ahead",
      leadMany: "Order {n} days ahead",
      reviewOrder: "Review order",
      yourOrder: "Your order",
      total: "Total",
      name: "Name",
      nameOptional: "Name (optional)",
      phone: "Phone number",
      phoneHint: "The shop will contact you on this number",
      how: "How to receive it",
      address: "Delivery address",
      date: "Date",
      time: "Time (optional)",
      hoursHint: "Pickup hours:",
      notes: "Notes (optional)",
      notesPh: "For example: no nuts, or writing on the cake",
      send: "Send order",
      sending: "Sending",
      orderOnWa: "Order on WhatsApp",
      waNote: "WhatsApp opens with your order ready; just press send.",
      doneTitle: "Your order was sent",
      doneRef: "Order number",
      doneBody: "The shop will confirm your order on WhatsApp.",
      sendWa: "Send the order on WhatsApp",
      backToMenu: "Back to the menu",
      close: "Close",
      errInvalid: "Check your details and try again.",
      errRate: "Too many orders right now. Try again soon or order on WhatsApp.",
      errNetwork: "We couldn't send the order. Check your internet or order on WhatsApp.",
      errClosed: "This shop isn't taking website orders right now. Order on WhatsApp.",
      errRequired: "This field is required",
      errPhone: "Enter a valid number (at least 8 digits)",
      errDate: "Pick a date from {d} onwards",
      errMaxLines: "You reached the maximum number of items for one order",
      powered: "Made with Orderat",
      poweredCta: "Make your shop link",
      report: "Report this shop",
      share: "Share",
      copied: "Link copied",
      other: "العربية",
      otherLang: "ar",
      demoBanner: "Sample shop for preview only",
      waHello: "Hi {shop}, I'd like to order:",
      waTotal: "Total",
      waName: "Name",
      waDate: "When",
      waDelivery: "Deliver to",
      waPickup: "Pickup",
      waNotes: "Notes",
    },
  };

  var ICONS = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    insta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  var app = document.getElementById("app");
  var sheet = document.getElementById("sheet");
  var toastEl = document.getElementById("toast");

  var state = {
    slug: readSlug(),
    shop: null,
    lang: "ar",
    cart: {},
    demo: false,
  };

  // ---------- helpers ----------

  function readSlug() {
    var q = location.search.replace(/^\?/, "");
    if (!q) return "";
    var first = q.split("&")[0];
    if (first.indexOf("=") === -1) return decodeURIComponent(first).toLowerCase();
    var params = new URLSearchParams(q);
    return (params.get("s") || params.get("slug") || "").toLowerCase();
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function t(key, vars) {
    var s = (T[state.lang] && T[state.lang][key]) || T.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "icon") el.insertAdjacentHTML("afterbegin", ICONS[v]); // static, trusted markup only
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function localized(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value[state.lang] || value.ar || value.en || "";
  }

  function decimalsFor(currency) {
    return Object.prototype.hasOwnProperty.call(DECIMALS, currency) ? DECIMALS[currency] : 2;
  }

  function money(minor) {
    var cur = state.shop.currency || "BHD";
    var d = decimalsFor(cur);
    var amount = (minor / Math.pow(10, d)).toFixed(d);
    return state.lang === "ar" ? amount + " " + (CURRENCY_AR[cur] || cur) : amount + " " + cur;
  }

  function todayRiyadh() {
    // en-CA formats as YYYY-MM-DD. The shop's lead time counts from today in Gulf time.
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  function inkFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#15171c" : "#ffffff";
  }

  function applyLang(lang) {
    state.lang = lang === "en" ? "en" : "ar";
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
  }

  function itemById(id) {
    var items = (state.shop && state.shop.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function cartLines() {
    return Object.keys(state.cart)
      .map(function (id) { return { item: itemById(id), qty: state.cart[id] }; })
      .filter(function (l) { return l.item && l.item.available !== false && l.qty > 0; });
  }

  function cartTotal() {
    return cartLines().reduce(function (sum, l) { return sum + l.item.priceMinor * l.qty; }, 0);
  }

  function cartCount() {
    return cartLines().reduce(function (sum, l) { return sum + l.qty; }, 0);
  }

  function saveCart() {
    storageSet("orderat-cart:" + state.slug, JSON.stringify(state.cart));
  }

  function loadCart() {
    var raw = storageGet("orderat-cart:" + state.slug);
    state.cart = {};
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      Object.keys(parsed).forEach(function (id) {
        var item = itemById(id);
        var qty = Number(parsed[id]);
        if (item && item.available !== false && qty > 0 && qty <= MAX_QTY) state.cart[id] = Math.floor(qty);
      });
    } catch (e) { /* ignore a broken saved cart */ }
  }

  function setQty(id, qty) {
    if (qty > 0 && !state.cart[id] && Object.keys(state.cart).length >= MAX_LINES) {
      toast(t("errMaxLines"));
      return;
    }
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(qty, MAX_QTY);
    saveCart();
    renderShop();
  }

  function shopUrl() {
    return (state.shop && state.shop.url) || location.href;
  }

  function whatsappLink(text) {
    var number = String(state.shop.whatsapp || "").replace(/\D/g, "");
    return "https://wa.me/" + number + "?text=" + encodeURIComponent(text);
  }

  function buildWhatsappText(form) {
    var lines = [t("waHello", { shop: localized(state.shop.name) })];
    cartLines().forEach(function (l) {
      lines.push("• " + l.qty + " × " + localized(l.item.name) + " (" + money(l.item.priceMinor * l.qty) + ")");
    });
    lines.push(t("waTotal") + ": " + money(cartTotal()));
    if (form) {
      if (form.name) lines.push(t("waName") + ": " + form.name);
      if (form.date) lines.push(t("waDate") + ": " + form.date + (form.time ? " " + form.time : ""));
      if (form.fulfillment === "delivery") lines.push(t("waDelivery") + ": " + (form.address || ""));
      else if (form.fulfillment === "pickup") lines.push(t("waPickup"));
      if (form.notes) lines.push(t("waNotes") + ": " + form.notes);
    }
    return lines.join("\n");
  }

  // ---------- data ----------

  function demoShop() {
    return {
      slug: "demo",
      url: location.origin + location.pathname + "?demo",
      name: { ar: "سويت ستوديو", en: "Sweet Studio" },
      bio: state.lang === "ar" ? "حلويات بيتية طازجة كل يوم 🍰" : "Fresh homemade desserts every day 🍰",
      lang: "ar",
      currency: "BHD",
      whatsapp: "97300000000",
      instagram: "orderat.demo",
      area: state.lang === "ar" ? "الرفاع" : "Riffa",
      pickupHours: "4:00 PM - 8:00 PM",
      leadTimeDays: 1,
      delivery: "pickup_and_delivery",
      acceptsWebOrders: true,
      accent: "#B5476B",
      logoUrl: null,
      items: [
        { id: "p1", name: { ar: "كب تشيز كيك", en: "Cheesecake cups" }, description: state.lang === "ar" ? "علبة 6 حبات، نكهات مشكلة" : "Box of 6, mixed flavors", priceMinor: 4500, photoUrl: null, available: true },
        { id: "p2", name: { ar: "كيكة شوكولاتة", en: "Chocolate cake" }, description: state.lang === "ar" ? "تكفي 8 أشخاص" : "Serves 8", priceMinor: 12000, photoUrl: null, available: true },
        { id: "p3", name: { ar: "بوكس براونيز", en: "Brownies box" }, description: state.lang === "ar" ? "12 قطعة" : "12 pieces", priceMinor: 6000, photoUrl: null, available: true },
        { id: "p4", name: { ar: "لقيمات", en: "Luqaimat" }, description: state.lang === "ar" ? "مع دبس التمر" : "With date syrup", priceMinor: 3000, photoUrl: null, available: true },
        { id: "p5", name: { ar: "كوكيز", en: "Cookies" }, description: state.lang === "ar" ? "10 حبات" : "10 pieces", priceMinor: 3500, photoUrl: null, available: false },
        { id: "p6", name: { ar: "صينية كنافة", en: "Kunafa tray" }, description: state.lang === "ar" ? "وسط، بالقشطة" : "Medium, with cream", priceMinor: 9500, photoUrl: null, available: true },
      ],
    };
  }

  function sanitizeShop(raw) {
    var shop = raw || {};
    shop.accent = /^#[0-9a-fA-F]{6}$/.test(shop.accent || "") ? shop.accent : "#15171c";
    shop.logoUrl = PHOTO_RE.test(shop.logoUrl || "") ? shop.logoUrl : null;
    shop.instagram = /^[A-Za-z0-9._]{1,30}$/.test(shop.instagram || "") ? shop.instagram : null;
    shop.whatsapp = String(shop.whatsapp || "").replace(/\D/g, "");
    shop.leadTimeDays = Math.max(0, Math.min(60, Number(shop.leadTimeDays) || 0));
    shop.delivery = ["pickup", "delivery", "pickup_and_delivery"].indexOf(shop.delivery) >= 0 ? shop.delivery : "pickup";
    shop.items = (Array.isArray(shop.items) ? shop.items : []).filter(function (i) {
      return i && typeof i.id === "string" && Number.isInteger(i.priceMinor) && i.priceMinor >= 0;
    }).map(function (i) {
      i.photoUrl = PHOTO_RE.test(i.photoUrl || "") || /^data:image\//.test(i.photoUrl || "") ? i.photoUrl : null;
      return i;
    });
    return shop;
  }

  function api(method, body, query) {
    var url = API + (query ? "?" + query : "");
    return fetch(url, {
      method: method,
      headers: Object.assign({ apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }

  function load() {
    var saved = storageGet("orderat-lang");
    if (!state.slug) {
      applyLang(saved || ((navigator.language || "").slice(0, 2) === "en" ? "en" : "ar"));
      return renderState("noSlug");
    }
    if (state.slug === "demo") {
      state.demo = true;
      applyLang(saved || "ar");
      state.shop = sanitizeShop(demoShop());
      loadCart();
      return renderShop();
    }
    applyLang(saved || "ar");
    if (!SLUG_RE.test(state.slug)) return renderState("notFound");
    renderLoading();
    api("GET", null, "slug=" + encodeURIComponent(state.slug)).then(function (res) {
      if (res.status === 404) return renderState("notFound");
      if (!res.ok || !res.data) return renderState("error");
      state.shop = sanitizeShop(res.data);
      if (!saved && (state.shop.lang === "en" || state.shop.lang === "ar")) applyLang(state.shop.lang);
      loadCart();
      renderShop();
    }).catch(function () { renderState("error"); });
  }

  // ---------- views ----------

  function renderLoading() {
    app.replaceChildren(
      h("div", { class: "topbar" }, [h("span", { class: "sr-only", text: t("loading") })]),
      h("div", { class: "hero" }, [
        h("div", { class: "logo skeleton" }),
        h("div", null, [h("div", { class: "skeleton", style: "height:22px;width:60%" }), h("div", { class: "skeleton", style: "height:14px;width:80%;margin-top:10px" })]),
      ]),
      h("div", { class: "grid" }, [0, 1, 2, 3].map(function () { return h("div", { class: "skeleton", style: "aspect-ratio:3/4" }); }))
    );
  }

  function renderState(kind) {
    document.title = t("title") + " | Orderat";
    var titles = { notFound: "notFoundTitle", noSlug: "noSlugTitle", error: "errorTitle" };
    var bodies = { notFound: "notFoundBody", noSlug: "noSlugBody", error: "errorBody" };
    var actions = [];
    if (kind === "error") actions.push(h("button", { class: "btn primary", type: "button", onclick: load, text: t("retry") }));
    actions.push(h("a", { class: "btn", href: HOME_URL, text: t("powered") + " · " + t("poweredCta") }));
    app.replaceChildren(
      h("div", { class: "topbar" }, [h("span"), langButton()]),
      h("section", { class: "state" }, [h("h1", { text: t(titles[kind]) }), h("p", { text: t(bodies[kind]) }), h("div", { style: "display:grid;gap:10px;margin-top:8px" }, actions)])
    );
  }

  function langButton() {
    return h("button", {
      class: "icon-btn", type: "button", lang: t("otherLang"),
      onclick: function () {
        var next = state.lang === "ar" ? "en" : "ar";
        storageSet("orderat-lang", next);
        applyLang(next);
        if (state.demo) {
          state.shop = sanitizeShop(demoShop());
          loadCart();
        }
        if (state.shop) renderShop(); else load();
      },
      text: t("other"),
    });
  }

  function shareButton() {
    return h("button", {
      class: "icon-btn", type: "button", "aria-label": t("share"), icon: "share",
      onclick: function () {
        var url = shopUrl();
        var title = localized(state.shop.name);
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () { /* dismissed */ });
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () { toast(t("copied")); });
        }
      },
    });
  }

  function leadText(days) {
    if (days <= 0) return t("leadSame");
    if (days === 1) return t("lead1");
    if (days === 2) return t("lead2");
    return t(days <= 10 ? "leadFew" : "leadMany", { n: days });
  }

  function renderShop() {
    var shop = state.shop;
    var name = localized(shop.name);
    document.title = name + " | " + t("title");
    document.documentElement.style.setProperty("--accent", shop.accent);
    document.documentElement.style.setProperty("--accent-ink", inkFor(shop.accent));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", shop.accent);

    var chips = [];
    if (shop.area) chips.push(h("li", { class: "chip", icon: "pin" }, [shop.area]));
    if (shop.pickupHours) chips.push(h("li", { class: "chip", icon: "clock" }, [h("span", { class: "num", text: shop.pickupHours })]));
    chips.push(h("li", { class: "chip", icon: shop.delivery === "pickup" ? "bag" : "truck" }, [t(shop.delivery === "pickup" ? "pickup" : shop.delivery === "delivery" ? "delivery" : "pickupAndDelivery")]));
    chips.push(h("li", { class: "chip", icon: "calendar" }, [leadText(shop.leadTimeDays)]));
    if (shop.instagram) {
      chips.push(h("li", { class: "chip", icon: "insta" }, [h("a", { href: "https://instagram.com/" + shop.instagram, target: "_blank", rel: "noopener", class: "num", text: "@" + shop.instagram })]));
    }

    var logo = h("div", { class: "logo", "aria-hidden": "true" }, [
      shop.logoUrl ? h("img", { src: shop.logoUrl, alt: "" }) : (name.trim().charAt(0) || "O"),
    ]);

    var visible = shop.items;
    var grid = visible.length
      ? h("div", { class: "grid" }, visible.map(productCard))
      : h("p", { class: "note", text: t("emptyMenu") });

    var children = [
      h("div", { class: "topbar" }, [shareButton(), langButton()]),
      state.demo ? h("p", { class: "chip", style: "margin:0 0 8px", text: t("demoBanner") }) : null,
      h("header", { class: "hero" }, [
        logo,
        h("div", null, [h("h1", { text: name }), shop.bio ? h("p", { class: "bio", text: shop.bio }) : null]),
      ]),
      h("ul", { class: "chips" }, chips),
      h("h2", { class: "section-title", text: t("menu") }),
      grid,
      footer(),
    ];
    app.replaceChildren.apply(app, children.filter(Boolean));

    var count = cartCount();
    if (count > 0 && canOrder()) {
      app.appendChild(h("div", { class: "cartbar" }, [
        h("button", { type: "button", onclick: openCheckout }, [
          h("span", { style: "display:inline-flex;align-items:center;gap:10px" }, [h("span", { class: "count num", text: String(count) }), t("reviewOrder")]),
          h("span", { class: "num", text: money(cartTotal()) }),
        ]),
      ]));
    }
  }

  function canOrder() {
    return state.shop.acceptsWebOrders || !!state.shop.whatsapp;
  }

  function productCard(item) {
    var available = item.available !== false;
    var qty = state.cart[item.id] || 0;
    var name = localized(item.name);
    var photo = h("div", { class: "photo" }, [
      item.photoUrl ? h("img", { src: item.photoUrl, alt: name, loading: "lazy" }) : h("div", { class: "ph", "aria-hidden": "true", text: name.trim().charAt(0) }),
      available ? null : h("span", { class: "badge", text: t("unavailable") }),
    ]);
    var control;
    if (!available || !canOrder()) {
      control = null;
    } else if (qty === 0) {
      control = h("button", { class: "add", type: "button", onclick: function () { setQty(item.id, 1); }, text: t("add"), "aria-label": t("add") + " " + name });
    } else {
      control = h("div", { class: "stepper" }, [
        h("button", { type: "button", "aria-label": t("remove") + " " + name, onclick: function () { setQty(item.id, qty - 1); }, text: "−" }),
        h("output", { class: "num", "aria-live": "polite", text: String(qty) }),
        h("button", { type: "button", "aria-label": t("increase") + " " + name, onclick: function () { setQty(item.id, qty + 1); }, text: "+" }),
      ]);
    }
    return h("article", { class: "card" + (available ? "" : " off") }, [
      photo,
      h("div", { class: "card-body" }, [
        h("h3", { text: name }),
        item.description ? h("p", { class: "desc", text: item.description }) : null,
        h("div", { class: "card-foot" }, [h("span", { class: "price num", text: money(item.priceMinor) }), control]),
      ]),
    ]);
  }

  function footer() {
    var subject = encodeURIComponent("Report shop: " + (state.slug || ""));
    return h("footer", { class: "footer" }, [
      h("a", { class: "powered", href: HOME_URL, target: "_blank", rel: "noopener" }, [
        h("img", { src: "../favicon.svg", alt: "" }),
        h("span", null, [h("b", { text: t("powered") }), " · " + t("poweredCta")]),
      ]),
      state.demo ? null : h("a", { class: "report", href: "mailto:" + REPORT_EMAIL + "?subject=" + subject, text: t("report") }),
    ]);
  }

  // ---------- checkout ----------

  function openCheckout() {
    renderCheckout({});
    if (typeof sheet.showModal === "function") sheet.showModal(); else sheet.setAttribute("open", "");
  }

  function closeSheet() {
    if (typeof sheet.close === "function") sheet.close(); else sheet.removeAttribute("open");
    renderShop();
  }

  sheet.addEventListener("click", function (e) {
    if (e.target === sheet) closeSheet(); // backdrop click
  });
  sheet.addEventListener("close", function () { renderShop(); });

  function field(id, label, input, hint, error) {
    return h("div", { class: "field" }, [
      h("label", { for: id, text: label }),
      input,
      hint ? h("span", { class: "hint", text: hint }) : null,
      error ? h("span", { class: "error", id: id + "-err", text: error }) : null,
    ]);
  }

  function renderCheckout(values, errors, formError) {
    errors = errors || {};
    var shop = state.shop;
    var webOrders = !!shop.acceptsWebOrders;
    var minDate = addDays(todayRiyadh(), shop.leadTimeDays);
    var maxDate = addDays(todayRiyadh(), 60);
    var modes = shop.delivery === "pickup_and_delivery" ? ["pickup", "delivery"] : [shop.delivery];
    var mode = values.fulfillment && modes.indexOf(values.fulfillment) >= 0 ? values.fulfillment : modes[0];

    var lines = h("ul", { class: "lines" }, cartLines().map(function (l) {
      var name = localized(l.item.name);
      return h("li", { class: "line" }, [
        h("div", null, [h("div", { class: "name", text: name }), h("div", { class: "sub num", text: money(l.item.priceMinor) })]),
        h("div", { class: "stepper" }, [
          h("button", { type: "button", "aria-label": t("remove") + " " + name, onclick: function () { changeLine(l.item.id, l.qty - 1); }, text: "−" }),
          h("output", { class: "num", text: String(l.qty) }),
          h("button", { type: "button", "aria-label": t("increase") + " " + name, onclick: function () { changeLine(l.item.id, l.qty + 1); }, text: "+" }),
        ]),
      ]);
    }));

    function input(id, attrs) {
      var el = h(attrs.tag || "input", Object.assign({ id: id, name: id }, attrs, { tag: null }));
      if (values[id] !== undefined && values[id] !== null) el.value = values[id];
      if (errors[id]) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", id + "-err"); }
      return el;
    }

    var seg = modes.length > 1 ? h("fieldset", { class: "field" }, [
      h("legend", { text: t("how") }),
      h("div", { class: "seg" }, modes.map(function (m) {
        return h("label", null, [
          h("input", { type: "radio", name: "fulfillment", value: m, checked: m === mode, onchange: function () { renderCheckout(Object.assign(readForm(), { fulfillment: m })); } }),
          h("span", { text: t(m) }),
        ]);
      })),
    ]) : null;

    var form = h("form", { class: "sheet-body", novalidate: true, onsubmit: function (e) { e.preventDefault(); submit(); } }, [
      lines,
      h("div", { class: "total" }, [h("span", { text: t("total") }), h("span", { class: "num", text: money(cartTotal()) })]),
      field("name", webOrders ? t("name") : t("nameOptional"), input("name", { type: "text", autocomplete: "name", maxlength: "60", required: webOrders }), null, errors.name),
      webOrders ? field("phone", t("phone"), input("phone", { type: "tel", inputmode: "tel", autocomplete: "tel", maxlength: "20", dir: "ltr", required: true }), t("phoneHint"), errors.phone) : null,
      seg,
      mode === "delivery" ? field("address", t("address"), input("address", { tag: "textarea", maxlength: "200", autocomplete: "street-address", required: true }), null, errors.address) : null,
      h("div", { class: "row" }, [
        field("date", t("date"), input("date", { type: "date", min: minDate, max: maxDate, required: webOrders }), null, errors.date),
        field("time", t("time"), input("time", { type: "time" }), null, null),
      ]),
      // <bdi> keeps a Latin "4:00 PM - 8:00 PM" in order inside the Arabic sentence.
      shop.pickupHours && mode === "pickup" ? h("p", { class: "note" }, [t("hoursHint") + " ", h("bdi", { text: shop.pickupHours })]) : null,
      field("notes", t("notes"), input("notes", { tag: "textarea", maxlength: "300", placeholder: t("notesPh") }), null, null),
      formError ? h("p", { class: "error", role: "alert", text: formError }) : null,
      webOrders
        ? h("button", { class: "btn primary", type: "submit", id: "submit", text: t("send") })
        : h("button", { class: "btn wa", type: "submit", id: "submit", icon: "whatsapp" }, [t("orderOnWa")]),
      webOrders && formError && shop.whatsapp
        ? h("a", { class: "btn wa", href: whatsappLink(buildWhatsappText(values)), target: "_blank", rel: "noopener", icon: "whatsapp" }, [t("orderOnWa")])
        : null,
      webOrders ? null : h("p", { class: "note", text: t("waNote") }),
    ]);

    sheet.replaceChildren(
      h("div", { class: "sheet-head" }, [
        h("h2", { id: "sheet-title", text: t("yourOrder") }),
        h("button", { class: "icon-btn", type: "button", "aria-label": t("close"), icon: "close", onclick: closeSheet }),
      ]),
      form
    );
    // Keep the chosen fulfillment mode when re-rendering.
    sheet.dataset.mode = mode;
  }

  function readForm() {
    function val(id) { var el = sheet.querySelector("#" + id); return el ? el.value.trim() : ""; }
    var checked = sheet.querySelector('input[name="fulfillment"]:checked');
    return {
      name: val("name"),
      phone: val("phone"),
      address: val("address"),
      date: val("date"),
      time: val("time"),
      notes: val("notes"),
      fulfillment: checked ? checked.value : sheet.dataset.mode,
    };
  }

  function changeLine(id, qty) {
    var values = readForm();
    if (qty <= 0) delete state.cart[id]; else state.cart[id] = Math.min(qty, MAX_QTY);
    saveCart();
    if (cartCount() === 0) return closeSheet();
    renderCheckout(values);
  }

  function validate(values) {
    var shop = state.shop;
    var errors = {};
    var webOrders = !!shop.acceptsWebOrders;
    var minDate = addDays(todayRiyadh(), shop.leadTimeDays);
    if (webOrders && !values.name) errors.name = t("errRequired");
    if (webOrders) {
      var phone = values.phone.replace(/[\s()-]/g, "");
      if (!/^\+?\d{8,15}$/.test(phone)) errors.phone = t("errPhone");
      values.phone = phone;
    }
    if (values.fulfillment === "delivery" && !values.address) errors.address = t("errRequired");
    if (webOrders && !values.date) errors.date = t("errRequired");
    else if (values.date && values.date < minDate) errors.date = t("errDate", { d: minDate });
    return errors;
  }

  function submit() {
    var values = readForm();
    var errors = validate(values);
    if (Object.keys(errors).length) {
      renderCheckout(values, errors);
      var first = sheet.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    var shop = state.shop;
    if (!shop.acceptsWebOrders) {
      window.open(whatsappLink(buildWhatsappText(values)), "_blank", "noopener");
      return;
    }
    var button = sheet.querySelector("#submit");
    button.disabled = true;
    button.textContent = t("sending");

    var body = {
      action: "order",
      slug: state.slug,
      customer: { name: values.name, phone: values.phone },
      items: cartLines().map(function (l) { return { id: l.item.id, qty: l.qty }; }),
      pickupDate: values.date,
      pickupTime: values.time || undefined,
      fulfillment: values.fulfillment,
      address: values.fulfillment === "delivery" ? values.address : undefined,
      notes: values.notes || undefined,
    };

    var request = state.demo
      ? new Promise(function (resolve) {
        setTimeout(function () { resolve({ ok: true, status: 200, data: { orderRef: "W" + String(1000 + Math.floor(Math.random() * 9000)), whatsappText: buildWhatsappText(values) } }); }, 700);
      })
      : api("POST", body);

    request.then(function (res) {
      if (res.ok && res.data && res.data.orderRef) return showDone(res.data, values);
      var code = res.data && res.data.error;
      var message = res.status === 429 ? t("errRate") : res.status === 404 ? t("errClosed") : code === "invalid_body" || res.status === 400 ? t("errInvalid") : t("errNetwork");
      renderCheckout(values, {}, message);
    }).catch(function () {
      renderCheckout(values, {}, t("errNetwork"));
    });
  }

  function showDone(data, values) {
    var text = data.whatsappText || buildWhatsappText(values);
    state.cart = {};
    saveCart();
    sheet.replaceChildren(
      h("div", { class: "sheet-head" }, [
        h("h2", { id: "sheet-title", text: t("yourOrder") }),
        h("button", { class: "icon-btn", type: "button", "aria-label": t("close"), icon: "close", onclick: closeSheet }),
      ]),
      h("div", { class: "sheet-body" }, [
        h("div", { class: "done" }, [
          h("div", { class: "tick", icon: "check" }),
          h("h3", { text: t("doneTitle") }),
          h("div", { class: "note", text: t("doneRef") }),
          h("div", { class: "ref num", text: data.orderRef }),
          h("p", { class: "note", text: t("doneBody") }),
        ]),
        state.shop.whatsapp ? h("a", { class: "btn wa", href: whatsappLink(text), target: "_blank", rel: "noopener", icon: "whatsapp" }, [t("sendWa")]) : null,
        h("button", { class: "btn", type: "button", onclick: closeSheet, text: t("backToMenu") }),
      ])
    );
  }

  load();
})();
