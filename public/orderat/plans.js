/* Orderat subscription: one plan (Basic). 14 days free, then $9.99 a month or $79.99 a year,
   billed by the App Store or Google Play in the phone apps. The web MVP takes no payment. */
state.subscriptionPlan = "basic";
delete state.proEligibility;
labels.plans = ["Plans", "الباقات"];
let billingPeriod = "yearly";

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

function pricingPage() {
  const yearly = billingPeriod === "yearly";
  return `${heading(
    tr("One plan, everything included", "باقة وحدة، كل شي فيها"),
    tr("Try it free for 14 days. Cancel anytime.", "جرّبها مجانًا 14 يوم. تقدر تلغي بأي وقت."),
    "",
    tr("ORDERAT", "اوردرات")
  )}
  <section class="pricing-grid single">
    <article class="price-card basic selected">
      <div class="price-top"><span class="plan-icon">${icon("check")}</span><span class="plan-state live">${tr("14 DAYS FREE", "14 يوم مجانًا")}</span></div>
      <h2>${tr("Basic", "بيسك")}</h2>
      <p>${tr("For home sellers who take orders on WhatsApp and Instagram, personal or business.", "للأسر المنتجة اللي تستقبل طلباتها على واتساب وإنستغرام، شخصي أو تجاري.")}</p>
      <div class="chip-row billing-toggle" role="group" aria-label="${tr("Billing period", "مدة الاشتراك")}">
        <button class="status-chip ${yearly ? "" : "active"}" data-billing="monthly" aria-pressed="${!yearly}">${tr("Monthly", "شهري")}</button>
        <button class="status-chip ${yearly ? "active" : ""}" data-billing="yearly" aria-pressed="${yearly}">${tr("Yearly · save 33%", "سنوي · وفّر 33%")}</button>
      </div>
      <div class="price"><strong>${yearly ? "$79.99" : "$9.99"}</strong><span><b>USD</b><small>${yearly ? tr("per year, about $6.67 a month", "في السنة، تقريبًا 6.67$ بالشهر") : tr("per month", "شهريًا")}</small></span></div>
      <ul>
        <li>${icon("check")}${tr("Paste a customer message, review the order, save", "الصق رسالة العميل، راجع الطلب، واحفظه")}</li>
        <li>${icon("check")}${tr("One-tap WhatsApp messages: confirm, ready, reminder", "رسائل واتساب بلمسة: تأكيد، جاهز، تذكير")}</li>
        <li>${icon("check")}${tr("Payments and who still owes you", "المدفوعات ومن باقي عليه فلوس")}</li>
        <li>${icon("check")}${tr("Customers and receipts", "العملاء والإيصالات")}</li>
        <li>${icon("check")}${tr("Occasions calendar and daily capacity", "تقويم المناسبات والطاقة اليومية")}</li>
        <li>${icon("check")}${tr("Expenses, revenue and profit charts", "المصاريف والإيرادات ورسوم الأرباح")}</li>
        <li>${icon("check")}${tr("Marketing helper for posts and captions", "مساعد تسويق للبوستات والكابشن")}</li>
      </ul>
      <button class="primary full" id="choose-basic" disabled>${tr("Coming soon on the App Store and Google Play", "قريبًا على App Store و Google Play")}</button>
      <small class="price-note">${tr("Subscribe inside the iPhone or Android app. The browser pilot is free and takes no payment.", "الاشتراك يكون من داخل تطبيق الآيفون أو الأندرويد. نسخة المتصفح التجريبية مجانية وما تاخذ أي مبلغ.")}</small>
    </article>
  </section>
  <section class="trust-strip">
    <div>${icon("check")}<span><strong>${tr("Your data stays on your phone", "بياناتك تبقى في جهازك")}</strong><small>${tr("With a backup you control", "مع نسخة احتياطية بيدك")}</small></span></div>
    <div>${icon("clock")}<span><strong>${tr("Cancel anytime", "إلغاء بأي وقت")}</strong><small>${tr("From your App Store or Google Play account", "من حسابك في App Store أو Google Play")}</small></span></div>
    <div>${icon("check")}<span><strong>${tr("No account access", "بدون دخول لحساباتك")}</strong><small>${tr("Orderat never logs in to your WhatsApp or Instagram", "اوردرات ما تدخل واتساب ولا إنستغرام حقك")}</small></span></div>
  </section>`;
}

function bindPricing() {
  document.querySelectorAll("[data-billing]").forEach((button) => button.addEventListener("click", () => {
    billingPeriod = button.dataset.billing;
    render();
  }));
}

const orderatBaseRender = render;
render = function orderatRender() {
  const requested = view;
  if (requested === "plans") {
    view = "today";
    orderatBaseRender();
    view = "plans";
    document.querySelector("#main-content").innerHTML = pricingPage();
    document.querySelectorAll(".nav-item").forEach((item) => {
      const isAccount = item.dataset.nav === "account";
      item.classList.toggle("active", isAccount);
      if (isAccount) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    const crumb = document.querySelector(".topbar-crumb .crumb");
    if (crumb) crumb.textContent = `/ ${tr(...labels.plans)}`;
    bindPricing();
  } else {
    orderatBaseRender();
  }
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
