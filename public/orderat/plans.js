/* Orderat v1 subscription plans. */
state.subscriptionPlan ||= "basic";
state.proEligibility ||= { whatsappBusiness: false, metaAccount: false, metaVerification: false, instagramProfessional: false };
labels.plans = ["Plans", "الباقات"];

function orderatBrandPatch() {
  document.title = `${tr("Orderat", "اوردرات")} · ${tr(...(labels[view] || labels.today))}`;
  document.querySelectorAll(".brand span").forEach((node) => {
    const small = node.querySelector("small")?.outerHTML || "";
    node.innerHTML = `${tr("Orderat", "اوردرات")}${small}`;
  });
  document.querySelectorAll("footer").forEach((node) => {
    const suffix = node.querySelector("span")?.outerHTML || "";
    node.innerHTML = `${tr("Orderat · Browser MVP", "اوردرات · نسخة المتصفح")}${suffix}`;
  });
  const welcomeTitle = modalEl?.querySelector(".welcome h1");
  if (welcomeTitle) welcomeTitle.textContent = "مرحبًا في اوردرات";
}

function planNavPatch() {
  const nav = document.querySelector(".sidebar nav");
  if (!nav || nav.querySelector('[data-nav="plans"]')) return;
  const button = document.createElement("button");
  button.className = `nav-item ${view === "plans" ? "active" : ""}`;
  button.dataset.nav = "plans";
  if (view === "plans") button.setAttribute("aria-current", "page");
  button.innerHTML = `${icon("plans")}<span>${tr("Plans", "الباقات")}</span><span class="pro-nav-badge">${tr("NEW", "جديد")}</span>`;
  nav.appendChild(button);
  button.onclick = () => navigate("plans");
}

function requirementRow(id, en, ar, noteEn, noteAr, required = true) {
  const checked = Boolean(state.proEligibility[id]);
  return `<label class="requirement-row ${checked ? "checked" : ""}">
    <input type="checkbox" data-pro-check="${id}" ${checked ? "checked" : ""}>
    <span class="requirement-check">${checked ? icon("check") : ""}</span>
    <span><strong>${tr(en, ar)}</strong><small>${tr(noteEn, noteAr)}</small></span>
    ${required ? `<em>${tr("Required", "مطلوب")}</em>` : `<em>${tr("May be required", "قد يُطلب")}</em>`}
  </label>`;
}

function pricingPage() {
  const current = state.subscriptionPlan || "basic";
  return `${heading(
    tr("A plan that fits how you sell", "باقة تناسب طريقة بيعك"),
    tr("Start with any account. Connect your business channels when Pro opens.", "ابدأ بأي حساب، واربط قنوات نشاطك عند إطلاق برو."),
    "",
    tr("ORDERAT V1", "اوردرات V1")
  )}
  <section class="pricing-intro">
    <span class="launch-chip">${tr("Basic launches first", "بيسك تُطلق أولًا")}</span>
    <h2>${tr("One order book. Two ways to receive orders.", "دفتر طلبات واحد. طريقتان لاستقبال الطلبات.")}</h2>
    <p>${tr("Basic is ready for the pilot. Pro turns on after Meta approves the Orderat app.", "بيسك جاهزة للتجربة. تُفعّل برو بعد موافقة Meta على تطبيق اوردرات.")}</p>
  </section>
  <section class="pricing-grid">
    <article class="price-card basic ${current === "basic" ? "selected" : ""}">
      <div class="price-top"><span class="plan-icon">${icon("check")}</span><span class="plan-state live">${tr("READY FOR PILOT", "جاهزة للتجربة")}</span></div>
      <h2>${tr("Basic", "بيسك")}</h2>
      <p>${tr("Works with any WhatsApp or Instagram account — personal or business.", "تعمل مع أي حساب واتساب أو إنستغرام، شخصي أو تجاري.")}</p>
      <div class="price"><strong>9</strong><span><b>${tr("BHD", "د.ب")}</b><small>${tr("per month", "شهريًا")}</small></span></div>
      <ul>
        <li>${icon("check")}${tr("No account connection or setup", "دون ربط الحسابات أو إعداد تقني")}</li>
        <li>${icon("check")}${tr("Paste text or forward screenshots and voice notes", "نسخ النص أو رفع الصور والرسائل الصوتية")}</li>
        <li>${icon("check")}${tr("Review every extracted order before saving", "مراجعة كل طلب مستخرج قبل الحفظ")}</li>
        <li>${icon("check")}${tr("Order book, changes and day plan", "دفتر الطلبات والتعديلات وخطة اليوم")}</li>
        <li>${icon("check")}${tr("Orderat never accesses your accounts or replies", "اوردرات لا تدخل حساباتك ولا ترد على العملاء")}</li>
      </ul>
      <button class="primary full" id="choose-basic">${current === "basic" ? tr("Current plan", "باقتك الحالية") : tr("Choose Basic", "اختر بيسك")}</button>
      <small class="price-note">${tr("No payment is collected yet.", "لا يتم تحصيل أي مبلغ حاليًا.")}</small>
    </article>
    <article class="price-card pro ${current === "pro-waitlist" ? "selected" : ""}">
      <div class="price-top"><span class="plan-icon pro-icon">${icon("plans")}</span><span class="plan-state review">${tr("META REVIEW PENDING", "بانتظار مراجعة META")}</span></div>
      <h2>${tr("Pro", "برو")}</h2>
      <p>${tr("Connect business channels so new messages arrive automatically.", "اربط قنوات النشاط لتصل الرسائل الجديدة تلقائيًا.")}</p>
      <div class="price"><strong>15</strong><span><b>${tr("BHD", "د.ب")}</b><small>${tr("per month", "شهريًا")}</small></span></div>
      <ul>
        <li>${icon("check")}${tr("Everything in Basic", "كل مزايا بيسك")}</li>
        <li>${icon("check")}${tr("Auto-connect WhatsApp Business and Instagram", "ربط تلقائي لواتساب بزنس وإنستغرام")}</li>
        <li>${icon("check")}${tr("New customer messages become reviewable drafts", "تحويل الرسائل الجديدة إلى مسودات للمراجعة")}</li>
        <li>${icon("check")}${tr("Agent drafts replies; owner approves with one tap", "الوكيل يكتب الرد والمالك يوافق بنقرة")}</li>
        <li>${icon("check")}${tr("Optional auto-send, switched off by default", "إرسال تلقائي اختياري ومغلق افتراضيًا")}</li>
      </ul>
      <button class="secondary full" id="open-pro-checklist">${tr("Check Pro readiness", "تحقق من جاهزية برو")}</button>
      <small class="price-note">${tr("Launches after Meta approval. Message costs will be checked before final pricing.", "تُطلق بعد موافقة Meta. ستُراجع تكاليف الرسائل قبل تثبيت السعر.")}</small>
    </article>
  </section>
  <section class="trust-strip">
    <div>${icon("check")}<span><strong>${tr("Basic stays private", "بيسك تحافظ على الخصوصية")}</strong><small>${tr("No WhatsApp or Instagram account access", "دون وصول إلى حساب واتساب أو إنستغرام")}</small></span></div>
    <div>${icon("clock")}<span><strong>${tr("Pro has a readiness gate", "برو لديها بوابة جاهزية")}</strong><small>${tr("Owners see requirements before subscribing", "يشاهد المالك المتطلبات قبل الاشتراك")}</small></span></div>
    <div>${icon("check")}<span><strong>${tr("Owner approval first", "موافقة المالك أولًا")}</strong><small>${tr("Draft replies are the default", "مسودات الرد هي الوضع الافتراضي")}</small></span></div>
  </section>`;
}

function proChecklist() {
  const eligible = state.proEligibility.whatsappBusiness && state.proEligibility.metaAccount && state.proEligibility.instagramProfessional;
  modal(
    tr("Is your business ready for Pro?", "هل نشاطك جاهز لبرو؟"),
    `<div class="pro-progress"><span>${tr("PRO READINESS", "جاهزية برو")}</span><strong id="pro-score">${Object.values(state.proEligibility).filter(Boolean).length}/4</strong></div>
    <p class="settings-description">${tr("Complete this check before joining Pro. Orderat will not take a payment until the required accounts are ready and Meta has approved our app.", "أكمل هذا الفحص قبل الانضمام لبرو. لن تقبل اوردرات الدفع حتى تصبح الحسابات المطلوبة جاهزة وتحصل اوردرات على موافقة Meta.")}</p>
    <div class="requirements">
      ${requirementRow("whatsappBusiness", "WhatsApp Business number", "رقم واتساب بزنس", "A personal WhatsApp number cannot use the Pro connection.", "لا يمكن ربط رقم واتساب شخصي بخدمة برو.")}
      ${requirementRow("metaAccount", "Free Meta business account", "حساب أعمال مجاني من Meta", "The WhatsApp Business number connects through this account.", "يُربط رقم واتساب بزنس من خلال هذا الحساب.")}
      ${requirementRow("metaVerification", "Meta business verification", "توثيق النشاط لدى Meta", "Meta may request verification during connection.", "قد تطلب Meta توثيق النشاط أثناء الربط.", false)}
      ${requirementRow("instagramProfessional", "Professional Instagram account", "حساب إنستغرام احترافي", "Business or Creator — personal accounts are not supported.", "حساب Business أو Creator؛ الحساب الشخصي غير مدعوم.")}
    </div>
    ${notice(tr("Pro opens once Meta approves the WhatsApp and Instagram connection. No payment is taken yet.", "تُفتح باقة برو بعد موافقة Meta على ربط واتساب وإنستغرام. لا يتم تحصيل أي مبلغ حاليًا."), "warn")}
    <div class="modal-foot"><button class="secondary" id="save-readiness">${tr("Save checklist", "حفظ القائمة")}</button><button class="primary" id="join-pro" ${eligible ? "" : "disabled"}>${tr("Join Pro waitlist", "انضم لقائمة انتظار برو")}</button></div>`,
    tr("No surprises before subscription.", "كل المتطلبات واضحة قبل الاشتراك.")
  );
  function refresh() {
    const score = Object.values(state.proEligibility).filter(Boolean).length;
    const ok = state.proEligibility.whatsappBusiness && state.proEligibility.metaAccount && state.proEligibility.instagramProfessional;
    document.getElementById("pro-score").textContent = `${score}/4`;
    document.getElementById("join-pro").disabled = !ok;
    modalEl.querySelectorAll("[data-pro-check]").forEach((input) => {
      const row = input.closest(".requirement-row");
      row.classList.toggle("checked", input.checked);
      row.querySelector(".requirement-check").innerHTML = input.checked ? icon("check") : "";
    });
  }
  modalEl.querySelectorAll("[data-pro-check]").forEach((input) => input.onchange = () => {
    state.proEligibility[input.dataset.proCheck] = input.checked;
    refresh();
  });
  document.getElementById("save-readiness").onclick = () => {
    persist(); closeModal(); render(); toast(tr("Pro checklist saved on this device.", "تم حفظ قائمة برو على هذا الجهاز."));
  };
  document.getElementById("join-pro").onclick = () => {
    state.subscriptionPlan = "pro-waitlist"; persist(); closeModal(); render();
    toast(tr("Added to the Pro waitlist. No payment was taken.", "تمت إضافتك لقائمة انتظار برو. لم يتم تحصيل أي مبلغ."));
  };
}

function bindPricing() {
  document.getElementById("choose-basic")?.addEventListener("click", () => {
    state.subscriptionPlan = "basic"; persist(); render(); toast(tr("Basic plan selected.", "تم اختيار باقة بيسك."));
  });
  document.getElementById("open-pro-checklist")?.addEventListener("click", proChecklist);
}

const orderatBaseRender = render;
render = function orderatRender() {
  const requested = view;
  if (requested === "plans") {
    view = "today";
    orderatBaseRender();
    view = "plans";
    document.querySelector("#main-content").innerHTML = pricingPage();
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    bindPricing();
  } else {
    orderatBaseRender();
  }
  planNavPatch();
  orderatBrandPatch();
};

const orderatBaseSettings = settingsPage;
settingsPage = function orderatSettings() {
  return orderatBaseSettings().replace(
    tr("Live AI, account sign-in, cloud sync and paid subscriptions are not connected.", "الذكاء الاصطناعي المباشر وتسجيل الحسابات والمزامنة والاشتراكات المدفوعة غير متصلة."),
    tr("Live AI, account sign-in, cloud sync, Meta connections and subscription checkout are not connected.", "الذكاء الاصطناعي المباشر وتسجيل الحسابات والمزامنة وربط Meta والدفع للاشتراكات غير متصلة.")
  );
};

const orderatBaseWelcome = welcome;
welcome = function orderatWelcome() { orderatBaseWelcome(); orderatBrandPatch(); };

render();
if (modalEl.open) orderatBrandPatch();
