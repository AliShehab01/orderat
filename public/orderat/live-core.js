// Orderat web: the pure rules of the signed-in (live) web app, kept apart from the screens in live.js
// so they can be unit-tested (web/live-core.test.js). Each one follows the phones:
// - subscriptionAllowed: the paid gate on the shop's `setting/subscription` value
//   { status, expiresAt, platform, updatedAt } (missing → allowed; expiresAt + 7 days; no expiresAt →
//   active/trial reported within 35 days). aiDemo: the AI calls' `demo` flag (no current subscription,
//   and not staff, like FeatureAccess.isEntitled).
// - access: staff permissions (Store.canSeeMoney / canEditProducts / canManageOrders /
//   canChangeOrderStatus); an owner, or a shop before the first sync answer, may do everything.
// - invoice numbers: a per-browser, per-shop counter in localStorage 'orderat.web.invoice.<shopId>',
//   shown as INV-<deviceCode>-000123 (InvoiceNumberFormat), stamped once like assignInvoiceNumberIfNeeded.
// - VAT: the order's own snapshot (vatRateBps, vatIncluded, vatMinor) like Store.applyVATSnapshot, and
//   totals like Order.totalMinor (VAT added only when prices exclude it).
// - stock: moves { id, delta, reason, orderId, note, at } newest first, the last 50 kept
//   (Store.applyStockForStatusChange / applyStockDifference / adjustStock).
// - buildAskSnapshot: AskSnapshotBuilder's JSON, same keys, first names and short refs only.
// Web objects use major units (6.5 = 6.500 BHD); anything sent to the server is in minor units.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cloud-map.js'));
  else root.OrderatLiveCore = factory(root.OrderatCloudMap);
})(typeof self !== 'undefined' ? self : this, function (map) {
  'use strict';

  const DAY = 864e5;
  const GRACE_DAYS = 7;
  const REPORT_MAX_AGE_DAYS = 35;
  const INVOICE_KEY = 'orderat.web.invoice.';
  const MAX_STOCK_MOVES = 50;
  const DEDUCTED = ['confirmed', 'ready', 'collected'];
  const STATUSES = ['new', 'confirmed', 'ready', 'collected', 'cancelled'];
  const PAYMENT_STATUSES = ['unpaid', 'deposit', 'paid'];
  const DEFAULT_RATE_BPS = { BHD: 1000, SAR: 1500, AED: 500, OMR: 500, KWD: 0, QAR: 0 };
  const EXPENSE_CATEGORIES = ['ingredients', 'packaging', 'delivery', 'ads', 'equipment', 'tools', 'rent', 'other'];
  // The phones' raw values where the web spells them differently.
  const CLOUD_STATUS = { new: 'newOrder' };
  const CLOUD_BUSINESS = { foodTruck: 'food_truck' };

  const num = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);
  const time = v => {
    const t = v instanceof Date ? v.getTime() : typeof v === 'string' && v ? Date.parse(v) : NaN;
    return isFinite(t) ? t : NaN;
  };
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const decimalsFor = code => (map && map.decimalsFor ? map.decimalsFor(code) : 3);
  const toMinor = (v, d) => (map && map.toMinor ? map.toMinor(v, d) : Math.round(Number(v || 0) * Math.pow(10, d)));
  const sum = (list, f) => (Array.isArray(list) ? list : []).reduce((s, x) => s + f(x), 0);

  // ---------- Subscription ----------

  function subscriptionAllowed(sub, now) {
    if (!sub || typeof sub !== 'object') return true;
    const at = time(now || new Date());
    const expires = time(sub.expiresAt);
    if (isFinite(expires)) return expires + GRACE_DAYS * DAY > at;
    return reportedCurrent(sub, at);
  }
  function reportedCurrent(sub, at) {
    const updated = time(sub.updatedAt);
    return (sub.status === 'active' || sub.status === 'trial') && isFinite(updated) && at - updated < REPORT_MAX_AGE_DAYS * DAY;
  }
  // A current subscription, no grace days: what unlocks the AI features' full daily quota.
  function subscriptionActive(sub, now) {
    if (!sub || typeof sub !== 'object') return false;
    const at = time(now || new Date());
    const expires = time(sub.expiresAt);
    return isFinite(expires) ? expires > at : reportedCurrent(sub, at);
  }
  function aiDemo(sub, role, now) {
    return role !== 'staff' && !subscriptionActive(sub, now);
  }

  // ---------- Staff access ----------

  function access(membership) {
    const staff = !!membership && membership.role === 'staff';
    const p = (staff && membership.permissions) || {};
    const has = k => !staff || p[k] === true;
    return { owner: !staff, staff, orders: has('orders'), prepare: has('prepare'), status: has('orders') || has('prepare'), money: has('money'), products: has('products') };
  }

  // ---------- Invoice numbers ----------

  function formatInvoice(n, deviceCode) {
    return deviceCode ? `INV-${deviceCode}-${pad(n, 6)}` : `INV-${pad(n, 6)}`;
  }
  let visitCounters = {};
  function nextInvoice(store, shopId, deviceCode) {
    const key = INVOICE_KEY + shopId;
    let n = NaN;
    try { n = parseInt(store.getItem(key), 10); } catch (e) { n = visitCounters[key]; }
    if (!(n >= 1)) n = visitCounters[key] >= 1 ? visitCounters[key] : 1;
    visitCounters[key] = n + 1;
    try { store.setItem(key, String(n + 1)); } catch (e) { /* kept for this visit */ }
    return { invoiceNumber: n, invoiceIdentifier: formatInvoice(n, deviceCode) };
  }
  // What an order prints: the identifier stamped when it was issued, else an older Android string, else
  // the number without a device code.
  function invoiceLabel(o) {
    if (typeof o.invoiceIdentifier === 'string' && o.invoiceIdentifier) return o.invoiceIdentifier;
    if (typeof o.invoiceNumber === 'string' && o.invoiceNumber) return o.invoiceNumber;
    if (typeof o.invoiceNumber === 'number' && isFinite(o.invoiceNumber)) return formatInvoice(o.invoiceNumber, '');
    return '';
  }

  // ---------- VAT ----------

  const halfUp = (a, b) => Math.floor((2 * a + b) / (2 * b));
  function vatMinor(amountMinor, rateBps, included) {
    if (!(rateBps > 0) || !(amountMinor > 0)) return 0;
    if (included) return amountMinor - halfUp(amountMinor * 10000, 10000 + rateBps);
    return halfUp(amountMinor * rateBps, 10000);
  }
  // The shop country's phone numbering, from its currency (default Bahrain): the WhatsApp calling code
  // and how many digits a local mobile number has (Saudi and UAE mobiles have 9, the rest 8).
  const PHONE_PLAN = {
    BHD: ['973', 8], SAR: ['966', 9], AED: ['971', 9], KWD: ['965', 8], QAR: ['974', 8], OMR: ['968', 8],
  };
  const phonePlan = currency => {
    const k = String(currency || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(PHONE_PLAN, k) ? PHONE_PLAN[k] : PHONE_PLAN.BHD;
  };
  const callingCode = currency => phonePlan(currency)[0];
  const localDigits = currency => phonePlan(currency)[1];
  function defaultRateBps(currency) {
    const k = String(currency || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(DEFAULT_RATE_BPS, k) ? DEFAULT_RATE_BPS[k] : 0;
  }
  const rateOf = (vat, currency) => (vat && typeof vat.rateBps === 'number' && vat.rateBps >= 0 ? vat.rateBps : defaultRateBps(currency));
  const itemsAndDeliveryMinor = (o, d) => sum(o.items, it => num(it.qty, 1) * toMinor(it.price, d)) + toMinor(o.deliveryFee || 0, d);

  // Called on create and on every edit of an order's items or delivery fee, never on a settings change.
  function applyVat(order, vat, currency, issueInvoice) {
    const d = decimalsFor(currency), amount = itemsAndDeliveryMinor(order, d);
    if (!vat || !vat.enabled) {
      if (typeof order.vatRateBps === 'number' && typeof order.vatIncluded === 'boolean') order.vatMinor = vatMinor(amount, order.vatRateBps, order.vatIncluded);
      return order;
    }
    const rate = rateOf(vat, currency), included = vat.pricesInclude !== false;
    Object.assign(order, { vatRateBps: rate, vatIncluded: included, vatMinor: vatMinor(amount, rate, included) });
    if (order.invoiceNumber == null && !order.invoiceIdentifier) Object.assign(order, issueInvoice());
    return order;
  }

  function orderMinor(o, d) {
    const base = itemsAndDeliveryMinor(o, d);
    const vat = typeof o.vatIncluded === 'boolean' ? num(o.vatMinor, 0) : 0;
    const total = o.vatIncluded === false ? base + vat : base;
    const paid = sum(o.payments, p => toMinor(p.amount, d));
    const cost = sum(o.items, it => num(it.qty, 1) * toMinor(it.cost || 0, d));
    return { itemsAndDelivery: base, vat, total, paid, cost, due: total - paid };
  }

  // ---------- Stock ----------

  function adjust(p, delta, reason, orderId, at, newId) {
    p.qty = num(p.qty, 0) + delta;
    const moves = Array.isArray(p.stockMoves) ? p.stockMoves : [];
    p.stockMoves = [{ id: newId(), delta, reason, orderId: orderId || null, note: null, at }].concat(moves).slice(0, MAX_STOCK_MOVES);
  }
  function tracked(products, pid) {
    return pid ? (products || []).find(p => p.id === pid && p.track) : undefined;
  }
  // Deducts (into confirmed or later) or restores (out of it) the tracked products of an order.
  function stockForStatus(products, order, from, to, at, newId) {
    const was = DEDUCTED.indexOf(from) >= 0, will = DEDUCTED.indexOf(to) >= 0;
    if (was === will) return [];
    const sign = will ? -1 : 1, reason = will ? 'orderConfirmed' : 'orderCancelled', changed = [];
    (order.items || []).forEach(it => {
      const p = tracked(products, it.pid), delta = sign * num(it.qty, 1);
      if (!p || !delta) return;
      adjust(p, delta, reason, order.id, at, newId);
      if (changed.indexOf(p) < 0) changed.push(p);
    });
    return changed;
  }
  // An order whose stock is already deducted was edited: move the difference per tracked product.
  function stockForEdit(products, oldItems, newItems, orderId, at, newId) {
    const count = items => {
      const m = new Map();
      (items || []).forEach(it => { if (it.pid) m.set(it.pid, (m.get(it.pid) || 0) + num(it.qty, 1)); });
      return m;
    };
    const before = count(oldItems), after = count(newItems), changed = [];
    new Set([...before.keys(), ...after.keys()]).forEach(pid => {
      const p = tracked(products, pid), delta = (after.get(pid) || 0) - (before.get(pid) || 0);
      if (!p || !delta) return;
      adjust(p, -delta, 'orderEdited', orderId, at, newId);
      changed.push(p);
    });
    return changed;
  }

  // Who may move stock for an order: the products permission, or staff who handle orders (orders or
  // prepare) — the server accepts their product pushes that only add order stock moves
  // (server/sync/record-access.ts isOrderStockUpdate).
  const canMoveOrderStock = can => !!(can('products') || can('orders') || can('prepare'));

  // ---------- Leaving a shop, member permissions ----------

  // Before leaving a shop (switching, signing out): sends the last edits while the session is still
  // valid, then answers whether to go on — yes when nothing is left unsent or the seller agrees to drop
  // it; no when the seller keeps them, or when the shop was left meanwhile (a 401 signed out).
  async function flushBeforeLeaving({ flush, stillHere, pending, confirm }) {
    await flush();
    if (!stillHere()) return false;
    return pending() === 0 || !!confirm();
  }

  // Member permission toggles, serialized per member: each toggle changes a local copy at once, and one
  // request at a time sends the copy as it is when that request starts, so a quick second toggle can
  // never send a permission the first one just revoked. A failed request puts the failed key back to the
  // last value the server accepted. send(userId, permissions) returns a promise.
  function createPermissionEditor(send) {
    const members = new Map();
    function toggle(userId, current, key, value) {
      let m = members.get(userId);
      if (!m) { m = { want: Object.assign({}, current), acked: Object.assign({}, current), chain: Promise.resolve(), busy: 0 }; members.set(userId, m); }
      m.want = Object.assign({}, m.want, { [key]: value });
      m.busy++;
      const run = () => {
        const body = Object.assign({}, m.want);
        return Promise.resolve().then(() => send(userId, body)).then(
          () => { m.acked = body; return true; },
          () => { if (m.want[key] === value) m.want = Object.assign({}, m.want, { [key]: m.acked[key] }); return false; });
      };
      const result = m.chain.then(run);
      m.chain = result.then(() => {}, () => {});
      return result.then(ok => {
        const permissions = Object.assign({}, m.want);
        if (--m.busy === 0) members.delete(userId);
        return { ok, permissions };
      });
    }
    return { toggle, current: userId => (members.has(userId) ? Object.assign({}, members.get(userId).want) : undefined) };
  }

  // ---------- Order numbers, history, items ----------

  // Display numbers (1, 2, 3...) in creation order; never written to the cloud.
  function orderNumbers(orders) {
    const list = (orders || []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
    const out = new Map();
    list.forEach((o, i) => out.set(o.id, i + 1));
    return out;
  }

  // The i18n key (and its argument) for one history entry, in the demo's shape or read from the cloud.
  function historyLabel(ch) {
    if (ch.kind === 'created') return { key: 'history.created' };
    if (ch.kind === 'items') return { key: 'history.itemsEdited' };
    if (ch.kind === 'status' && STATUSES.indexOf(ch.value) >= 0) return { key: 'history.status', status: ch.value };
    if (ch.kind === 'payment') {
      if (typeof ch.value === 'number') return { key: 'history.payment', amount: ch.value };
      const next = ch._c && ch._c.newValue;
      return PAYMENT_STATUSES.indexOf(next) >= 0 ? { key: 'history.paymentStatus', payment: next } : { key: 'history.paymentChanged' };
    }
    return { key: 'history.other' };
  }

  // The items editor's lines → order items. A line that came from the order keeps its id (so the cloud
  // edits that line instead of replacing it) and its cost while it stays on the same product.
  function cleanItems(items, products) {
    const find = id => (products || []).find(p => p.id === id);
    return (items || []).filter(it => it.qty > 0 && (it.pid !== 'custom' || String(it.name || '').trim())).map(it => {
      const p = find(it.pid), price = parseFloat(it.price) || 0, kept = it.id && it.cost != null;
      const out = p
        ? { pid: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: it.qty, price, cost: kept && it.origPid === p.id ? it.cost : p.cost }
        : { pid: null, nameAr: String(it.name || '').trim(), nameEn: String(it.name || '').trim(), qty: it.qty, price, cost: kept && !it.origPid ? it.cost : 0 };
      return it.id ? Object.assign({ id: it.id }, out) : out;
    });
  }

  // ---------- AI order entry (orderat-parse) ----------

  const cut = (s, n) => String(s || '').trim().slice(0, n);
  function parseProducts(products) {
    return (products || []).filter(p => p.active !== false).slice(0, 500).map(p => {
      const name = cut(p.nameEn, 200) || cut(p.nameAr, 200);
      const out = { id: p.id, name };
      if (cut(p.nameAr, 200)) out.nameAr = cut(p.nameAr, 200);
      out.aliases = (p.aliases || []).map(a => cut(a, 100)).filter(Boolean).slice(0, 20);
      return out;
    }).filter(p => p.name && typeof p.id === 'string' && p.id.length <= 64);
  }
  const localInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function draftFields(draft, products) {
    const d = draft || {}, out = {};
    out.items = (d.items || []).map(it => {
      const p = (products || []).find(x => x.id === it.productId), qty = it.quantity > 0 ? it.quantity : 1;
      return p ? { pid: p.id, name: '', qty, price: p.price } : { pid: 'custom', name: String(it.rawText || ''), qty, price: 0 };
    });
    if (d.customerName) out.name = d.customerName;
    if (isFinite(time(d.collectionAt))) out.due = localInput(time(d.collectionAt));
    if (d.notes) out.notes = d.notes;
    return out;
  }

  // ---------- Ask Orderat snapshot (AskSnapshot.swift) ----------

  const startOfDay = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
  const itemName = it => String(it.nameAr || it.nameEn || '');
  const isTerminal = s => s === 'collected' || s === 'cancelled';
  const pickName = (x, lang) => (lang === 'en' ? x.nameEn || x.nameAr : x.nameAr || x.nameEn) || '';

  function buildAskSnapshot(state, options) {
    const opts = options || {}, lang = opts.lang === 'en' ? 'en' : 'ar';
    const shop = state.shop || {}, d = decimalsFor(shop.currency);
    const orders = state.orders || [], customers = state.customers || [], expenses = state.expenses || [];
    const now = time(opts.now || new Date());
    const today = startOfDay(now), tomorrow = addDays(today, 1);
    const monthStart = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1).getTime();
    const nextMonth = new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 1).getTime();
    const lastMonth = new Date(new Date(today).getFullYear(), new Date(today).getMonth() - 1, 1).getTime();
    const days90 = addDays(today, -89), week = addDays(today, -6);
    const m = o => orderMinor(o, d);
    const due = o => time(o.dueAt);
    const billable = (a, b) => orders.filter(o => due(o) >= a && due(o) < b && o.status !== 'cancelled');
    const byId = new Map(customers.map(c => [c.id, c]));

    const custRefs = new Map(), orderRefs = new Map();
    const refFor = (refs, prefix, id) => {
      if (!refs.has(id)) refs.set(id, prefix + (refs.size + 1));
      return refs.get(id);
    };

    function period(a, b) {
      const os = billable(a, b);
      const revenue = sum(os, o => m(o).total), cost = sum(os, o => m(o).cost);
      const exp = sum(expenses.filter(x => time(x.date) >= a && time(x.date) < b), x => toMinor(x.amount, d));
      return { revenueMinor: revenue, expensesMinor: exp, profitMinor: revenue - cost - exp, orders: os.length, items: sum(os, o => sum(o.items, it => num(it.qty, 1))) };
    }
    const periods = {
      today: period(today, tomorrow), thisWeek: period(week, tomorrow), thisMonth: period(monthStart, nextMonth),
      lastMonth: period(lastMonth, monthStart), last90Days: period(days90, tomorrow),
    };

    // Grouped totals in first-seen order, sorted descending by `by` (a stable sort keeps ties in order).
    function group(list, keyOf, add) {
      const totals = new Map();
      list.forEach(x => {
        const k = keyOf(x);
        totals.set(k, add(totals.get(k), x));
      });
      return totals;
    }
    const recent = billable(days90, tomorrow);
    const productTotals = new Map();
    recent.forEach(o => (o.items || []).forEach(it => {
      const k = itemName(it), t = productTotals.get(k) || { qty: 0, revenueMinor: 0 };
      t.qty += num(it.qty, 1);
      t.revenueMinor += num(it.qty, 1) * toMinor(it.price, d);
      productTotals.set(k, t);
    }));
    const topProducts = [...productTotals].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([name, t]) => ({ name, qty: t.qty, revenueMinor: t.revenueMinor }));

    const customerTotals = group(recent, o => o.customerId, (t, o) => ({ orders: (t ? t.orders : 0) + 1, revenueMinor: (t ? t.revenueMinor : 0) + m(o).total }));
    const topCustomers = [...customerTotals].sort((a, b) => b[1].revenueMinor - a[1].revenueMinor).slice(0, 10)
      .filter(([id]) => byId.has(id))
      .map(([id, t]) => ({ ref: refFor(custRefs, 'c', id), firstName: firstName(byId.get(id).name), orders: t.orders, revenueMinor: t.revenueMinor }));

    const unpaid = orders.filter(o => o.status !== 'cancelled' && m(o).due > 0).sort((a, b) => due(a) - due(b)).slice(0, 50)
      .filter(o => byId.has(o.customerId))
      .map(o => ({ ref: refFor(custRefs, 'c', o.customerId), firstName: firstName(byId.get(o.customerId).name), orderRef: refFor(orderRefs, 'o', o.id), amountMinor: m(o).due, dueDate: dayKey(due(o)) }));

    const horizon = addDays(today, 7);
    const upcoming = orders.filter(o => due(o) >= today && due(o) < horizon && !isTerminal(o.status)).sort((a, b) => due(a) - due(b)).slice(0, 50).map(o => ({
      orderRef: refFor(orderRefs, 'o', o.id), date: dayKey(due(o)), time: hhmm(due(o)),
      firstName: byId.has(o.customerId) ? firstName(byId.get(o.customerId).name) : '',
      items: (o.items || []).map(it => `${num(it.qty, 1)} x ${itemName(it)}`).join(', '),
      totalMinor: m(o).total, status: CLOUD_STATUS[o.status] || o.status,
    }));

    const tomorrowOpen = orders.filter(o => due(o) >= tomorrow && due(o) < addDays(tomorrow, 1) && !isTerminal(o.status));
    const prepTotals = new Map();
    tomorrowOpen.forEach(o => (o.items || []).forEach(it => prepTotals.set(itemName(it), (prepTotals.get(itemName(it)) || 0) + num(it.qty, 1))));
    const prepTomorrow = [...prepTotals].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, qty]) => ({ name, qty }));

    const expenseTotals = new Map();
    expenses.filter(x => time(x.date) >= monthStart && time(x.date) < nextMonth).forEach(x => expenseTotals.set(x.category, (expenseTotals.get(x.category) || 0) + toMinor(x.amount, d)));
    const expensesThisMonth = EXPENSE_CATEGORIES.filter(c => expenseTotals.has(c)).map(c => ({ category: c, amountMinor: expenseTotals.get(c) }));

    const todayKey = dayKey(today), tomorrowKey = dayKey(tomorrow);
    const occasions = (state.occasions || []).filter(x => String(x.end) >= todayKey).sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map(x => ({ name: pickName(x, lang), daysUntil: Math.round((time(`${x.start}T00:00`) - today) / DAY) }));

    const override = (state.occasions || []).find(x => String(x.start) <= tomorrowKey && tomorrowKey <= String(x.end) && typeof x.cap === 'number');
    const daily = override ? override.cap : shop.dailyCapacity;
    const capacity = daily > 0 ? { daily, tomorrowUsed: sum(tomorrowOpen, o => sum(o.items, it => num(it.qty, 1))) } : null;

    const flip = refs => { const out = {}; refs.forEach((ref, id) => { out[ref] = id; }); return out; };
    return {
      snapshot: {
        today: todayKey, shopName: pickName(shop, lang), currency: shop.currency || 'BHD', businessType: CLOUD_BUSINESS[shop.businessType] || shop.businessType || 'home',
        periods, topProducts, topCustomers, unpaid, upcoming, prepTomorrow, expensesThisMonth, occasions, capacity,
      },
      refs: { customers: flip(custRefs), orders: flip(orderRefs) },
    };
  }

  return {
    subscriptionAllowed, subscriptionActive, aiDemo, callingCode, localDigits, access, formatInvoice, nextInvoice, invoiceLabel,
    vatMinor, defaultRateBps, applyVat, orderMinor, stockForStatus, stockForEdit, orderNumbers, historyLabel,
    cleanItems, parseProducts, draftFields, buildAskSnapshot, canMoveOrderStock, flushBeforeLeaving, createPermissionEditor,
  };
});
