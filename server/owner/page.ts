// Owner page HTML. Customer text is untrusted, so the script builds the list with textContent only.

export const OWNER_PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>طلبات واتساب | اوردرات</title>
<style>
  :root { --harbor:#173142; --palm:#2F6D62; --citrus:#D8EF63; --coral:#C96B4B; --canvas:#F6F4EF; --paper:#fff; --slate:#66747B; --line:#D9E0DD; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--canvas); color:var(--harbor); font-family:"IBM Plex Sans Arabic","IBM Plex Sans",system-ui,sans-serif; line-height:1.6; }
  header { background:var(--harbor); color:#fff; padding:14px 16px; }
  header .inner, main { max-width:720px; margin:0 auto; }
  header h1 { margin:0; font-size:1.25rem; font-weight:700; }
  header p { margin:2px 0 0; color:#b9c7ce; font-size:.85rem; }
  main { padding:16px; display:grid; gap:12px; }
  .card { background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .name { font-weight:700; }
  .phone { color:var(--slate); font-size:.85rem; direction:ltr; unicode-bidi:embed; }
  .badge { font-size:.75rem; font-weight:700; border-radius:999px; padding:2px 10px; }
  .pending { background:var(--citrus); color:var(--harbor); }
  .confirmed { background:#E3EFEA; color:var(--palm); }
  ul { margin:8px 0; padding-inline-start:20px; }
  .meta { color:var(--slate); font-size:.9rem; margin:2px 0; }
  .warn { color:var(--coral); }
  button { font:inherit; font-weight:700; border:0; border-radius:10px; padding:9px 16px; background:var(--harbor); color:#fff; cursor:pointer; margin-top:8px; }
  button:disabled { opacity:.5; cursor:default; }
  .empty { text-align:center; color:var(--slate); padding:32px 16px; }
  #toast { position:fixed; inset-inline:16px; bottom:16px; max-width:680px; margin:0 auto; background:var(--harbor); color:#fff; padding:12px 16px; border-radius:12px; display:none; }
</style>
</head>
<body>
<header><div class="inner"><h1>اوردرات · طلبات واتساب</h1><p>طلبات جهّزها المساعد من رسائل العملاء. راجع كل طلب ثم أكّده.</p></div></header>
<main id="list"><div class="empty">جاري التحميل…</div></main>
<div id="toast" role="status" aria-live="polite"></div>
<script>
const list = document.getElementById("list");
const toast = document.getElementById("toast");
let busy = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Plain-language reasons for common WhatsApp send errors.
const SEND_ERRORS = {
  131030: "رقم العميل ليس في قائمة الأرقام المسموح بها لرقم الاختبار في Meta.",
  131047: "مرّ أكثر من 24 ساعة على آخر رسالة من العميل، لذلك لا يسمح واتساب بإرسال رسالة حرة الآن.",
  190: "انتهت صلاحية مفتاح واتساب. أنشئ مفتاحاً جديداً من صفحة Meta وضعه في الإعدادات.",
};

function showToast(text) {
  toast.textContent = text;
  toast.style.display = "block";
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => { toast.style.display = "none"; }, 5000);
}

function render(orders) {
  list.replaceChildren();
  if (!orders.length) {
    list.append(el("div", "empty", "لا توجد طلبات بعد. عندما يرسل عميل طلباً على واتساب، يظهر هنا."));
    return;
  }
  for (const o of orders) {
    const card = el("article", "card");
    const top = el("div", "row");
    const who = el("div");
    who.append(el("div", "name", o.customerName), el("div", "phone", "+" + o.customerPhone));
    top.append(who, el("span", "badge " + o.status, o.status === "pending" ? "بانتظار تأكيدك" : "مؤكد"));
    const items = el("ul");
    for (const i of o.items) items.append(el("li", "", i.name + " × " + i.quantity));
    card.append(top, items);
    card.append(el("p", "meta" + (o.collectionText ? "" : " warn"), o.collectionText ? "الاستلام: " + o.collectionText : "بدون وقت استلام بعد"));
    if (o.notes) card.append(el("p", "meta", "ملاحظات: " + o.notes));
    if (o.sourceText) card.append(el("p", "meta", "رسالة العميل: " + o.sourceText));
    if (o.changes.length) card.append(el("p", "meta", "تعديلات من العميل: " + o.changes.length));
    if (o.status === "pending") {
      const btn = el("button", "", "تأكيد الطلب");
      btn.onclick = () => confirmOrder(o.id, btn);
      card.append(btn);
    }
    list.append(card);
  }
}

async function load() {
  if (busy) return;
  try {
    const res = await fetch("/owner/api/orders", { cache: "no-store" });
    render(await res.json());
  } catch {
    list.replaceChildren(el("div", "empty", "تعذر الاتصال بالمساعد. تأكد أنه يعمل."));
  }
}

async function confirmOrder(id, btn) {
  busy = true;
  btn.disabled = true;
  try {
    const res = await fetch("/owner/api/orders/" + encodeURIComponent(id) + "/confirm", { method: "POST" });
    const body = await res.json();
    if (!res.ok) showToast(body.error || "تعذر تأكيد الطلب");
    else if (body.messageSent) showToast("تم تأكيد الطلب وأُرسلت رسالة التأكيد للعميل على واتساب.");
    else showToast("تم تأكيد الطلب، لكن تعذر إرسال رسالة واتساب. " + (SEND_ERRORS[body.errorCode] || "حاول مرة أخرى لاحقاً."));
  } finally {
    busy = false;
    load();
  }
}

load();
setInterval(load, 3000);
</script>
</body>
</html>`;
