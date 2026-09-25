/* Order provenance, appearance controls and compact mobile navigation. */
function ensureOrderSources() {
  const samples = {
    "sample-sara": { intake: "auto", channel: "whatsapp", sourceRef: "+973 3900 1122" },
    "sample-noor": { intake: "auto", channel: "instagram", sourceRef: "@noor.bakes" },
    "sample-hessa": { intake: "manual", channel: "whatsapp", sourceRef: "+973 3661 2040" },
    "sample-ali": { intake: "manual", channel: "other", sourceRef: "Phone order" }
  };
  let changed = false;
  [...state.orders, ...state.drafts].forEach((order) => {
    const sample = samples[order.id];
    if (!order.intake) { order.intake = sample?.intake || "manual"; changed = true; }
    if (!order.channel) {
      order.channel = sample?.channel || (order.source === "image" ? "instagram" : order.source === "manual" ? "other" : "whatsapp");
      changed = true;
    }
    if (order.sourceRef == null) { order.sourceRef = sample?.sourceRef || ""; changed = true; }
  });
  if (changed) OA.save(state);
}

const channelNames = {
  whatsapp: ["WhatsApp", "واتساب"],
  instagram: ["Instagram", "إنستغرام"],
  other: ["Other source", "مصدر آخر"]
};
const intakeNames = { auto: ["Automatic", "تلقائي"], manual: ["Manual", "يدوي"] };
const channelName = (channel) => tr(...(channelNames[channel] || channelNames.other));
const intakeName = (intake) => tr(...(intakeNames[intake] || intakeNames.manual));

// Orderat follows the device's light/dark setting until the seller picks one explicitly in Settings.
function isDarkTheme() {
  if (state.theme === "dark") return true;
  if (state.theme === "light") return false;
  return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function applyThemeAttribute() {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
}

function sourceCaption(order, includeReference = true) {
  const reference = order.sourceRef?.trim() || tr("Reference not recorded", "المرجع غير مسجل");
  return `${channelName(order.channel)} · ${intakeName(order.intake)}${includeReference ? ` · ${esc(reference)}` : ""}`;
}

ensureOrderSources();

rows = function sourcedRows(orders, showDate = false) {
  return orders.map((order) => `<button class="order-row" data-order="${esc(order.id)}">
    <div class="time-cell">${icon("clock")}<strong dir="auto">${timeLabel(order.time)}</strong>${showDate ? `<small class="muted">${dateLabel(order.date)}</small>` : ""}</div>
    <span class="customer-avatar">${esc(order.customer.slice(0, 1))}</span>
    <div class="order-info"><strong>${esc(order.customer)}</strong><span>${order.items.map((item) => `${item.quantity} × ${esc(pname(product(item.productId)) || item.raw || tr("Product missing", "منتج غير محدد"))}`).join(" · ")}</span><small class="source-line">${sourceCaption(order)}</small></div>
    <span class="status ${esc(order.status)}">${statusText(order.status)}</span>${icon("arrow")}
  </button>`).join("");
};

const sourceBaseReview = review;
review = function sourcedReview(draft) {
  draft.intake ||= "manual";
  draft.channel ||= draft.source === "image" ? "instagram" : draft.source === "manual" ? "other" : "whatsapp";
  draft.sourceRef ||= "";
  sourceBaseReview(draft);
  const form = document.getElementById("review-form");
  const anchor = document.getElementById("draft-time")?.closest(".field");
  if (!form || !anchor) return;
  anchor.insertAdjacentHTML("afterend", `<section class="source-fields">
    <div class="source-section-head"><div><h3>${tr("Order source", "مصدر الطلب")}</h3><p>${tr("Keep the channel and customer reference with the order, even when you enter it manually.", "احفظ القناة ومرجع العميل مع الطلب حتى عند إدخاله يدويًا.")}</p></div></div>
    <div class="two-col"><div class="field"><label for="draft-intake">${tr("How it reached Orderat", "كيف وصل إلى اوردرات")}</label><select id="draft-intake"><option value="manual" ${draft.intake === "manual" ? "selected" : ""}>${tr("Manual capture", "إدخال يدوي")}</option><option value="auto" ${draft.intake === "auto" ? "selected" : ""}>${tr("Automatic connection (Pro)", "ربط تلقائي (برو)")}</option></select></div><div class="field"><label for="draft-channel">${tr("Customer channel", "قناة العميل")}</label><select id="draft-channel"><option value="whatsapp" ${draft.channel === "whatsapp" ? "selected" : ""}>WhatsApp</option><option value="instagram" ${draft.channel === "instagram" ? "selected" : ""}>Instagram</option><option value="other" ${draft.channel === "other" ? "selected" : ""}>${tr("Other", "أخرى")}</option></select></div></div>
    <div class="field"><label id="source-ref-label" for="draft-source-ref"></label><input id="draft-source-ref" value="${esc(draft.sourceRef)}" maxlength="100" dir="ltr"><p id="source-ref-help" class="field-help"></p></div>
  </section>`);
  localizeValidity(modalEl);
  const channel = document.getElementById("draft-channel");
  const reference = document.getElementById("draft-source-ref");
  const refreshReference = () => {
    const isWhatsApp = channel.value === "whatsapp";
    const isInstagram = channel.value === "instagram";
    document.getElementById("source-ref-label").textContent = isWhatsApp ? tr("Customer WhatsApp number", "رقم واتساب العميل") : isInstagram ? tr("Instagram username", "اسم مستخدم إنستغرام") : tr("Source reference", "مرجع المصدر");
    reference.placeholder = isWhatsApp ? "+973 3XXX XXXX" : isInstagram ? "@username" : tr("Phone, shop or referral", "هاتف أو متجر أو إحالة");
    reference.required = isWhatsApp || isInstagram;
    document.getElementById("source-ref-help").textContent = document.getElementById("draft-intake").value === "auto" ? tr("Captured with the connected customer conversation.", "يُحفظ من محادثة العميل المتصلة.") : tr("Recorded by the owner during manual entry.", "يسجله المالك أثناء الإدخال اليدوي.");
  };
  channel.onchange = refreshReference;
  document.getElementById("draft-intake").onchange = refreshReference;
  refreshReference();
  const baseSubmit = form.onsubmit;
  form.onsubmit = (event) => {
    if (reference.required && !reference.value.trim()) {
      event.preventDefault();
      reference.focus();
      toast(channel.value === "whatsapp" ? tr("Add the customer WhatsApp number.", "أضف رقم واتساب العميل.") : tr("Add the Instagram username.", "أضف اسم مستخدم إنستغرام."));
      return false;
    }
    draft.intake = document.getElementById("draft-intake").value;
    draft.channel = channel.value;
    draft.sourceRef = reference.value.trim();
    return baseSubmit(event);
  };
};

const sourceBaseOrderDetails = orderDetails;
orderDetails = function sourcedOrderDetails(id) {
  sourceBaseOrderDetails(id);
  const order = state.orders.find((item) => item.id === id);
  const anchor = modalEl.querySelector(".modal-body .row-between");
  if (!order || !anchor) return;
  anchor.insertAdjacentHTML("afterend", `<div class="source-summary"><span>${tr("ORDER SOURCE", "مصدر الطلب")}</span><strong>${sourceCaption(order)}</strong><small>${order.intake === "auto" ? tr("Arrived through a Pro channel connection", "وصل عبر ربط قناة برو") : tr("Recorded manually by the owner", "سجله المالك يدويًا")}</small></div>`);
};

exportCsv = function sourcedExportCsv() {
  const csvRows = [["Customer", "Intake", "Channel", "Customer reference", "Collection date", "Collection time (Bahrain)", "Status", "Product", "Quantity", "Item note", "Order note"], ...state.orders.flatMap((order) => order.items.map((item) => [order.customer, order.intake, order.channel, order.sourceRef, order.date, order.time, order.status, pname(product(item.productId)), item.quantity, item.note, order.notes]))];
  const safe = (value) => { let text = String(value ?? ""); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
  const blob = new Blob(["\ufeff" + csvRows.map((row) => row.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "orderat-orders.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(tr("Order CSV downloaded with source details.", "تم تنزيل الطلبات مع تفاصيل المصدر."));
};

function mobileMoreMenu() {
  const destinations = [
    ["inventory", "inventory"], ["analytics", "analytics"], ["products", "products"], ["plans", "plans"], ["settings", "settings"]
  ];
  modal(tr("More tools", "المزيد من الأدوات"), `<div class="more-menu">${destinations.map(([destination, iconName]) => `<button data-more-nav="${destination}" class="more-menu-item ${view === destination ? "active" : ""}">${icon(iconName)}<span><strong>${tr(...labels[destination])}</strong><small>${({ inventory: tr("Finished stock and reservations", "المخزون الجاهز والحجوزات"), analytics: tr("Sales and demand", "المبيعات والطلب"), products: tr("Menu and batch setup", "المنتجات والدفعات"), plans: tr("Basic and Pro", "بيسك وبرو"), settings: tr("Workspace and brand", "المساحة والهوية") })[destination]}</small></span>${icon("arrow")}</button>`).join("")}</div>`, tr("Everything else, one tap away.", "كل الأدوات الأخرى على بُعد نقرة."));
  modalEl.querySelectorAll("[data-more-nav]").forEach((button) => button.onclick = () => { closeModal(); navigate(button.dataset.moreNav); });
}

const sourceBaseSettings = settingsPage;
settingsPage = function sourcedSettings() {
  return sourceBaseSettings() + `<section class="panel settings-panel spaced"><div class="settings-section"><h2>${tr("Appearance", "المظهر")}</h2><p>${tr("Follows your device by default. Choose a palette to override it on this device.", "تتبع إعداد جهازك افتراضيًا. اختر لوحة ألوان لتجاوزه على هذا الجهاز.")}</p><label for="theme-setting">${tr("Colour mode", "نمط الألوان")}</label><select id="theme-setting"><option value="light" ${!isDarkTheme() ? "selected" : ""}>${tr("Light", "فاتح")}</option><option value="dark" ${isDarkTheme() ? "selected" : ""}>${tr("Dark", "داكن")}</option></select></div></section>`;
};

function patchShell() {
  applyThemeAttribute();
  const dark = isDarkTheme();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0B0C0F" : "#15171C");
  const topActions = document.querySelector(".top-actions");
  if (topActions && !document.getElementById("theme-toggle")) {
    const themeButton = document.createElement("button");
    themeButton.id = "theme-toggle";
    themeButton.className = "icon-button theme-toggle";
    themeButton.setAttribute("aria-label", dark ? tr("Use light mode", "استخدم الوضع الفاتح") : tr("Use dark mode", "استخدم الوضع الداكن"));
    themeButton.innerHTML = `${icon("theme")}<span>${dark ? tr("Light", "فاتح") : tr("Dark", "داكن")}</span>`;
    topActions.insertBefore(themeButton, document.getElementById("language"));
    themeButton.onclick = () => { state.theme = dark ? "light" : "dark"; persist(); render(); };
  }
  const more = document.getElementById("nav-more");
  if (more) {
    more.classList.toggle("active", ["inventory", "analytics", "products", "plans", "settings"].includes(view));
    more.onclick = mobileMoreMenu;
  }
  const themeSetting = document.getElementById("theme-setting");
  if (themeSetting) themeSetting.onchange = () => { state.theme = themeSetting.value; persist(); render(); };
}

const sourceBaseRender = render;
render = function sourcedRender() {
  ensureOrderSources();
  applyThemeAttribute();
  sourceBaseRender();
  patchShell();
};

render();
