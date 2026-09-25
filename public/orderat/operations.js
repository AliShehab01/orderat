/* Ready-stock automation, sales analysis and brand guidance. */
let salesRange = "30";

function ensureCommerceState() {
  const samplePrices = { cheese: 1.5, brownie: 4.5, velvet: 1.75 };
  const sampleStock = { cheese: 42, brownie: 18, velvet: 30 };
  let changed = false;
  state.products.forEach((item) => {
    if (!Number.isFinite(Number(item.price))) { item.price = samplePrices[item.id] || 1; changed = true; }
  });
  if (!Array.isArray(state.inventory)) { state.inventory = []; changed = true; }
  state.inventory = state.inventory.filter((entry) => state.products.some((item) => item.id === entry.productId));
  state.products.forEach((item) => {
    if (!state.inventory.some((entry) => entry.productId === item.id)) {
      state.inventory.push({ productId: item.id, onHand: sampleStock[item.id] || 0, reorderAt: item.batch || 6, updatedAt: new Date().toISOString() });
      changed = true;
    }
  });
  if (changed) OA.save(state);
}

function stockEntry(productId) {
  ensureCommerceState();
  return state.inventory.find((entry) => entry.productId === productId);
}

function reservedUnits(productId) {
  const today = OA.localDate();
  return state.orders
    .filter((order) => order.status !== "cancelled" && order.status !== "collected" && order.date >= today)
    .flatMap((order) => order.items)
    .filter((item) => item.productId === productId)
    .reduce((total, item) => total + Number(item.quantity || 0), 0);
}

function sellableUnits(productId) {
  const stock = stockEntry(productId);
  return Math.max(0, Number(stock?.onHand || 0) - reservedUnits(productId));
}

function money(value) {
  return new Intl.NumberFormat(state.lang === "en" ? "en-BH" : "ar-BH-u-nu-latn", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value) + ` ${tr("BHD", "د.ب")}`;
}

function inventoryPage() {
  ensureCommerceState();
  const rows = state.products.map((item) => {
    const stock = stockEntry(item.id);
    const reserved = reservedUnits(item.id);
    const sellable = Math.max(0, stock.onHand - reserved);
    const shortage = Math.max(0, reserved - stock.onHand);
    const low = sellable <= stock.reorderAt;
    return { item, stock, reserved, sellable, shortage, low };
  });
  const readyTotal = rows.reduce((sum, row) => sum + row.stock.onHand, 0);
  const reservedTotal = rows.reduce((sum, row) => sum + row.reserved, 0);
  const sellableTotal = rows.reduce((sum, row) => sum + row.sellable, 0);
  const attention = rows.filter((row) => row.low || row.shortage).length;
  return heading(
    tr("Ready to sell", "جاهز للبيع"),
    tr("Finished items, open-order reservations and what you can still sell — in one view.", "القطع الجاهزة وحجوزات الطلبات وما يمكنك بيعه الآن، في شاشة واحدة."),
    `<button class="primary" id="record-stock">${icon("plus")}${tr("Update ready stock", "تحديث المخزون الجاهز")}</button>`,
    tr("LIVE AVAILABILITY", "التوفر الحالي")
  ) + sampleBanner() + `<section class="stats inventory-stats">
    <article class="stat"><div><span>${tr("Finished now", "جاهز الآن")}</span>${icon("inventory")}</div><strong>${readyTotal}<small>${tr("units", "قطعة")}</small></strong><p>${tr("Physical finished stock", "مخزون فعلي مكتمل")}</p></article>
    <article class="stat"><div><span>${tr("Reserved automatically", "محجوز تلقائيًا")}</span>${icon("orders")}</div><strong>${reservedTotal}<small>${tr("units", "قطعة")}</small></strong><p>${tr("From open confirmed orders", "من الطلبات المؤكدة المفتوحة")}</p></article>
    <article class="stat"><div><span>${tr("Available to sell", "متاح للبيع")}</span>${icon("check")}</div><strong>${sellableTotal}<small>${tr("units", "قطعة")}</small></strong><p>${attention ? tr(`${attention} products need attention`, `${attention} منتجات تحتاج متابعة`) : tr("Stock is comfortably covered", "المخزون مغطى بشكل جيد")}</p></article>
  </section>
  <section class="automation-note">${icon("inventory")}<div><strong>${tr("Orders reserve stock for you", "الطلبات تحجز المخزون تلقائيًا")}</strong><p>${tr("Orderat subtracts open confirmed quantities from finished stock, so you can quote what is truly available without checking every order.", "تطرح اوردرات كميات الطلبات المؤكدة المفتوحة من المخزون المكتمل، لتعرف المتاح الحقيقي دون مراجعة كل طلب.")}</p></div></section>
  <section class="panel inventory-panel">
    <div class="panel-title"><div><h2>${tr("Ready-stock board", "لوحة المخزون الجاهز")}</h2><p>${tr("Update finished quantities after each production run.", "حدّث الكميات المكتملة بعد كل دفعة إنتاج.")}</p></div><span class="pill">${state.products.length} ${tr("products", "منتجات")}</span></div>
    ${rows.length ? rows.map(({ item, stock, reserved, sellable, shortage, low }) => `<article class="stock-row ${shortage ? "short" : low ? "low" : ""}">
      <div class="stock-product"><span class="product-mark">${icon("box")}</span><div><h3>${esc(pname(item))}</h3><p>${money(Number(item.price || 0))} · ${tr("Reorder at", "حد التنبيه")} ${stock.reorderAt}</p></div></div>
      <div class="stock-number"><span>${tr("Finished", "مكتمل")}</span><strong>${stock.onHand}</strong></div>
      <div class="stock-number"><span>${tr("Reserved", "محجوز")}</span><strong>${reserved}</strong></div>
      <div class="stock-number available"><span>${tr("Sellable", "متاح")}</span><strong>${sellable}</strong></div>
      <div class="stock-action">${shortage ? `<span class="stock-flag danger">${tr(`Make ${shortage} more`, `حضّر ${shortage} إضافية`)}</span>` : low ? `<span class="stock-flag">${tr("Low stock", "مخزون منخفض")}</span>` : `<span class="stock-flag healthy">${tr("Covered", "مغطى")}</span>`}<button class="secondary" data-edit-stock="${item.id}">${tr("Edit stock", "تعديل المخزون")}</button></div>
    </article>`).join("") : empty(tr("No products to stock", "لا توجد منتجات للمخزون"), tr("Add a product first, then record how many finished items are ready.", "أضف منتجًا أولًا، ثم سجل عدد القطع المكتملة الجاهزة."), `<button class="primary" data-nav="products">${tr("Add a product", "إضافة منتج")}</button>`)}
  </section>`;
}

function analyticsOrders() {
  const active = state.orders.filter((order) => order.status !== "cancelled");
  if (salesRange === "all") return active;
  const from = OA.dateOffset(OA.localDate(), -(Number(salesRange) - 1));
  return active.filter((order) => order.date >= from);
}

function analyticsPage() {
  ensureCommerceState();
  const orders = analyticsOrders();
  const units = orders.reduce((sum, order) => sum + OA.count(order), 0);
  const revenue = orders.reduce((sum, order) => sum + order.items.reduce((line, item) => line + Number(item.quantity || 0) * Number(product(item.productId)?.price || 0), 0), 0);
  const average = orders.length ? revenue / orders.length : 0;
  const collected = orders.filter((order) => order.status === "collected").length;
  const byProduct = state.products.map((item) => {
    const quantity = orders.flatMap((order) => order.items).filter((line) => line.productId === item.id).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    return { item, quantity, value: quantity * Number(item.price || 0) };
  }).sort((a, b) => b.quantity - a.quantity);
  const maxQuantity = Math.max(1, ...byProduct.map((row) => row.quantity));
  const sourceLabels = {
    "whatsapp-auto": ["WhatsApp · Automatic", "واتساب · تلقائي"],
    "instagram-auto": ["Instagram · Automatic", "إنستغرام · تلقائي"],
    "whatsapp-manual": ["WhatsApp · Manual", "واتساب · يدوي"],
    "instagram-manual": ["Instagram · Manual", "إنستغرام · يدوي"],
    "other-manual": ["Other · Manual", "مصدر آخر · يدوي"]
  };
  const bySource = Object.keys(sourceLabels).map((source) => ({ source, count: orders.filter((order) => `${order.channel || "other"}-${order.intake || "manual"}` === source).length })).filter((row) => row.count);
  const top = byProduct[0];
  const insight = !orders.length ? "" : top?.quantity ? tr(`${pname(top.item)} leads with ${top.quantity} units. Keep its ready stock visible and easy to reorder.`, `${pname(top.item)} يتصدر بـ ${top.quantity} قطعة. حافظ على مخزونه الجاهز واضحًا وسهل التحديث.`) : tr("Add product quantities to reveal your bestseller.", "أضف كميات المنتجات لمعرفة الأكثر مبيعًا.");
  return heading(
    tr("Sales, made useful", "مبيعات تساعدك على القرار"),
    tr("See demand, estimated booked value and the products customers choose most.", "شاهد الطلب والقيمة التقديرية للحجوزات والمنتجات الأكثر اختيارًا."),
    `<select id="sales-range" class="range-select" aria-label="${tr("Analysis period", "فترة التحليل")}"><option value="7" ${salesRange === "7" ? "selected" : ""}>${tr("Last 7 days", "آخر 7 أيام")}</option><option value="30" ${salesRange === "30" ? "selected" : ""}>${tr("Last 30 days", "آخر 30 يومًا")}</option><option value="all" ${salesRange === "all" ? "selected" : ""}>${tr("All orders", "كل الطلبات")}</option></select>`,
    tr("SALES VIEW", "نظرة المبيعات")
  ) + sampleBanner() + (orders.length ? `<section class="stats analytics-stats">
    <article class="stat"><div><span>${tr("Booked sales", "مبيعات محجوزة")}</span>${icon("analytics")}</div><strong class="money-value">${money(revenue)}</strong><p>${tr("Using current product prices", "بحسب أسعار المنتجات الحالية")}</p></article>
    <article class="stat"><div><span>${tr("Average order", "متوسط الطلب")}</span>${icon("orders")}</div><strong class="money-value">${money(average)}</strong><p>${orders.length} ${tr("orders in this period", "طلبات في هذه الفترة")}</p></article>
    <article class="stat"><div><span>${tr("Units booked", "القطع المحجوزة")}</span>${icon("box")}</div><strong>${units}<small>${tr("units", "قطعة")}</small></strong><p>${collected} ${tr("orders collected", "طلبات مستلمة")}</p></article>
  </section>
  <section class="insight-card">${icon("analytics")}<div><span>${tr("WHAT THE DATA SAYS", "ماذا تقول البيانات")}</span><strong>${esc(insight)}</strong></div></section>
  <div class="analytics-grid">
    <section class="panel chart-panel"><div class="panel-title"><div><h2>${tr("Best-selling products", "المنتجات الأكثر مبيعًا")}</h2><p>${tr("Confirmed, prepared, packed and collected orders", "الطلبات المؤكدة والمحضرة والمغلفة والمستلمة")}</p></div></div><div class="bar-list">${byProduct.map((row) => `<div class="bar-row"><div class="bar-label"><span>${esc(pname(row.item))}</span><strong>${row.quantity} ${tr("units", "قطعة")}</strong></div><div class="bar-track"><i style="width:${Math.round(row.quantity / maxQuantity * 100)}%"></i></div><small>${money(row.value)}</small></div>`).join("")}</div></section>
    <section class="panel breakdown-panel"><div class="panel-title"><div><h2>${tr("Channel and intake", "القناة وطريقة الإدخال")}</h2><p>${tr("Automatic connections and owner-entered orders", "الربط التلقائي والطلبات التي أدخلها المالك")}</p></div></div><div class="breakdown-list">${bySource.map((row) => `<div><span>${tr(...sourceLabels[row.source])}</span><strong>${row.count}</strong></div>`).join("") || `<p class="muted">${tr("No source data yet.", "لا توجد بيانات مصدر بعد.")}</p>`}</div><div class="panel-title compact"><div><h2>${tr("Order progress", "تقدم الطلبات")}</h2></div></div><div class="breakdown-list">${Object.keys(statuses).filter((status) => status !== "cancelled").map((status) => `<div><span>${statusText(status)}</span><strong>${orders.filter((order) => order.status === status).length}</strong></div>`).join("")}</div></section>
  </div>
  <p class="data-note">${tr("Booked sales are estimates based on current prices. Connect payment data later for net revenue and refunds.", "المبيعات المحجوزة تقديرية بحسب الأسعار الحالية. اربط بيانات الدفع لاحقًا لصافي الإيراد والمبالغ المستردة.")}</p>` : `<section class="panel">${empty(tr("No sales to read yet", "لا توجد مبيعات لتحليلها بعد"), tr("Confirm the first order and Orderat will start showing demand and booked value here.", "أكّد أول طلب وستبدأ اوردرات بعرض الطلب والقيمة المحجوزة هنا."), captureButton())}</section>`);
}

function stockEditor(productId) {
  const item = product(productId || state.products[0]?.id);
  if (!item) { navigate("products"); return; }
  const stock = stockEntry(item.id);
  modal(tr("Update ready stock", "تحديث المخزون الجاهز"), `<form id="stock-form">
    <p class="settings-description">${esc(pname(item))}</p>
    <div class="two-col spaced"><div class="field"><label for="stock-on-hand">${tr("Finished units now", "القطع المكتملة الآن")}</label><input id="stock-on-hand" type="number" min="0" step="1" value="${stock.onHand}" required><p class="field-help">${tr("Count only finished items that can be handed to a customer.", "احسب فقط القطع المكتملة التي يمكن تسليمها للعميل.")}</p></div><div class="field"><label for="stock-reorder">${tr("Low-stock alert", "تنبيه المخزون المنخفض")}</label><input id="stock-reorder" type="number" min="0" step="1" value="${stock.reorderAt}" required></div></div>
    <div class="field"><label for="stock-price">${tr("Selling price per unit (BHD)", "سعر بيع القطعة (د.ب)")}</label><input id="stock-price" type="number" min="0" step="0.001" value="${Number(item.price || 0).toFixed(3)}" required><p class="field-help">${tr("Used for the sales estimate on the analytics page.", "يُستخدم لتقدير المبيعات في صفحة التحليلات.")}</p></div>
    ${notice(tr(`${reservedUnits(item.id)} units are reserved by open orders.`, `${reservedUnits(item.id)} قطعة محجوزة للطلبات المفتوحة.`))}
    <div class="modal-foot"><button class="secondary" type="button" id="stock-cancel">${tr("Cancel", "إلغاء")}</button><button class="primary" type="submit">${tr("Save stock", "حفظ المخزون")}</button></div>
  </form>`, tr("Keep availability honest and current.", "حافظ على توفر دقيق ومحدث."));
  document.getElementById("stock-cancel").onclick = closeModal;
  document.getElementById("stock-form").onsubmit = (event) => {
    event.preventDefault();
    if (transact(() => {
      stock.onHand = Number(document.getElementById("stock-on-hand").value);
      stock.reorderAt = Number(document.getElementById("stock-reorder").value);
      stock.updatedAt = new Date().toISOString();
      item.price = Number(document.getElementById("stock-price").value);
    })) { closeModal(); render(); toast(tr("Ready stock updated.", "تم تحديث المخزون الجاهز.")); }
  };
}

function brandGuide() {
  const colours = [
    ["Harbor", "#15171C", tr("Sidebar and dark panels", "الشريط الجانبي واللوحات الداكنة")],
    ["Accent", "#4156D3", tr("Links, primary buttons, active states", "الروابط والأزرار الأساسية والحالات النشطة")],
    ["Success", "#1F7A46", tr("Collected orders, healthy stock", "الطلبات المستلمة والمخزون الجيد")],
    ["Warning", "#A86A17", tr("Capacity and low-stock warnings", "تنبيهات الطاقة والمخزون المنخفض")],
    ["Danger", "#C0362C", tr("Destructive actions, cancelled orders", "الإجراءات الحساسة والطلبات الملغاة")],
    ["Canvas", "#FAFAFB", tr("App background", "خلفية التطبيق")],
    ["Paper", "#FFFFFF", tr("Cards, panels and forms", "البطاقات واللوحات والنماذج")],
    ["Slate", "#68707C", tr("Secondary text", "النص الثانوي")]
  ];
  modal(tr("Orderat brand guide", "دليل هوية اوردرات"), `<div class="brand-guide">
    <section><span class="guide-kicker">${tr("PROMISE", "الوعد")}</span><h3>${tr("Orders clear. Day calm.", "طلبات واضحة. يوم أهدأ.")}</h3><p>${tr("Orderat sounds like a reliable operations partner: clear, calm and accountable.", "تتحدث اوردرات كشريك تشغيل موثوق: واضحة وهادئة ومسؤولة.")}</p></section>
    <section><span class="guide-kicker">${tr("PALETTE", "لوحة الألوان")}</span><div class="palette-grid">${colours.map(([name, hex, use]) => `<div class="swatch"><i style="background:${hex}"></i><div><strong>${name}</strong><code>${hex}</code><small>${use}</small></div></div>`).join("")}</div></section>
    <section><span class="guide-kicker">${tr("TYPE", "الخط")}</span><div class="type-sample"><strong>IBM Plex Sans Arabic</strong><p>${tr("Regular 400 for reading. Bold 700 for decisions, totals and headings.", "وزن 400 للقراءة. وزن 700 للقرارات والإجماليات والعناوين.")}</p><b>اوردرات ترتب يومك — Orderat keeps the day clear.</b></div></section>
    <section><span class="guide-kicker">${tr("VOICE", "نبرة الصوت")}</span><div class="voice-grid"><div><strong>${tr("Clear", "واضحة")}</strong><p>${tr("Say what happened and what to do next.", "قل ما حدث وما الخطوة التالية.")}</p></div><div><strong>${tr("Calm", "هادئة")}</strong><p>${tr("Warn without blame or alarm.", "نبّه دون لوم أو تهويل.")}</p></div><div><strong>${tr("Accountable", "مسؤولة")}</strong><p>${tr("Show what is automatic and what needs approval.", "وضّح ما هو تلقائي وما يحتاج موافقة.")}</p></div></div></section>
    <section><span class="guide-kicker">${tr("REAL LABELS", "تسميات حقيقية")}</span><div class="label-examples"><button class="primary">${tr("Confirm order", "تأكيد الطلب")}</button><button class="secondary">${tr("Update ready stock", "تحديث المخزون الجاهز")}</button><button class="secondary">${tr("Create today's plan", "إنشاء خطة اليوم")}</button></div><p>${tr("Use specific verbs. Avoid vague labels such as Submit, Continue or Do it.", "استخدم أفعالًا محددة. تجنب كلمات عامة مثل إرسال أو متابعة أو نفّذ.")}</p></section>
    <section><span class="guide-kicker">${tr("EMPTY STATES", "الحالات الفارغة")}</span><div class="empty-examples"><blockquote><strong>${tr("Nothing ready to sell yet", "لا توجد قطع جاهزة للبيع بعد")}</strong><span>${tr("Record today's finished items to see what customers can order now.", "سجّل القطع المكتملة اليوم لتعرف ما يمكن للعملاء طلبه الآن.")}</span></blockquote><blockquote><strong>${tr("No sales to read yet", "لا توجد مبيعات لتحليلها بعد")}</strong><span>${tr("Confirm the first order and your sales view will start here.", "أكّد أول طلب وستبدأ نظرة المبيعات هنا.")}</span></blockquote></div></section>
  </div>`, tr("A practical system for every Orderat screen.", "نظام عملي لكل شاشة في اوردرات."));
}

ensureCommerceState();

const operationsBaseSettings = settingsPage;
settingsPage = function operationsSettings() {
  return operationsBaseSettings() + `<section class="panel settings-panel spaced brand-entry"><div class="settings-section"><span class="guide-kicker">${tr("BRAND SYSTEM", "نظام الهوية")}</span><h2>${tr("One clear voice across Orderat", "صوت واحد واضح في اوردرات")}</h2><p>${tr("See the approved palette, type system, button language and empty-state examples used across this app.", "شاهد لوحة الألوان والخط ولغة الأزرار وأمثلة الحالات الفارغة المستخدمة في التطبيق.")}</p><button class="secondary" id="open-brand-guide">${tr("Open brand guide", "فتح دليل الهوية")}</button></div></section>`;
};

const operationsBaseBind = bindPage;
bindPage = function operationsBind() {
  ensureCommerceState();
  operationsBaseBind();
  document.getElementById("sales-range")?.addEventListener("change", (event) => { salesRange = event.target.value; render(); });
  document.querySelectorAll("[data-edit-stock]").forEach((button) => button.onclick = () => stockEditor(button.dataset.editStock));
  document.getElementById("record-stock")?.addEventListener("click", () => stockEditor());
  document.getElementById("open-brand-guide")?.addEventListener("click", brandGuide);
};
