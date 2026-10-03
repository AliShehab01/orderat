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
//   totals like Order.totalMinor (VAT added only when prices exclude it). The shop's VAT settings are
//   snapshotted onto a NEW order only (applyVat); every edit of an existing order recomputes vatMinor
//   from the order's own rate and mode (reapplyVat), like the Android edit form.
// - stock: moves { id, delta, reason, orderId, note, at } newest first, the last 50 kept
//   (Store.applyStockForStatusChange / applyStockDifference / adjustStock). Physical stock never changes
//   only because tracking was switched on or off: each order keeps what it took out of every product in
//   its own ledger `stockDeducted` { productId: units }, and gives back exactly that (see "Stock" below).
// - new order deposit: checkDeposit, the "Partial payment" amount against the order's final total.
// - payments: add-only on the wire, so deleting one (the trash button, or the Undo of a payment just
//   recorded) takes its id into the order's grow-only `removedPaymentIds` too (removePayment).
// - buildAskSnapshot: AskSnapshotBuilder's JSON, same keys, first names and short refs only.
// - AI order entry: an orderat-parse draft into the New order form, its pickup or delivery and address
//   included (Bahrain's area to the area list, the rest as the one free-text address).
// - default delivery fee: the shop's `setting/deliveryDefaults` { feeMinor }, filled into an order that
//   turns into a delivery while its fee is still empty and untouched.
// - out for delivery: a ready delivery order with outForDeliveryAt set (the status stays ready on the
//   wire), the step between Ready and Delivered.
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
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
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
  // One phone number in the international form WhatsApp takes (+97333001001) where it can tell:
  // Arabic-Indic and Persian digits become ASCII, spaces and punctuation go, a leading 00 becomes +,
  // a single leading 0 is dropped, and a local mobile number gets the shop country's calling code.
  // Anything else comes back as its digits (with its + when it had one); nothing typed comes back ''.
  function normalizePhone(raw, currency) {
    const s = String(raw == null ? '' : raw).trim()
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
    let d = s.replace(/\D/g, '');
    if (!d) return '';
    if (s.startsWith('+')) return '+' + d;
    if (d.startsWith('00')) return '+' + d.slice(2);
    const cc = callingCode(currency), local = localDigits(currency);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === local) return '+' + cc + d;
    if (d.length === cc.length + local && d.startsWith(cc)) return '+' + d;
    return d;
  }
  function defaultRateBps(currency) {
    const k = String(currency || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(DEFAULT_RATE_BPS, k) ? DEFAULT_RATE_BPS[k] : 0;
  }
  const rateOf = (vat, currency) => (vat && typeof vat.rateBps === 'number' && vat.rateBps >= 0 ? vat.rateBps : defaultRateBps(currency));
  const itemsAndDeliveryMinor = (o, d) => sum(o.items, it => num(it.qty, 1) * toMinor(it.price, d)) + toMinor(o.deliveryFee || 0, d);

  // Whether the order carries its own VAT snapshot (rate and mode). An order created without VAT has none.
  const hasVatSnapshot = o => typeof o.vatRateBps === 'number' && typeof o.vatIncluded === 'boolean';

  // A NEW order takes the shop's VAT as it is now: rate, whether prices include it, the amount, and (once)
  // an invoice number. Shop VAT off: the order stays without VAT. An order that already carries a snapshot
  // keeps it (recomputed from its own rate), so calling this on an edit can never reprice it with the
  // shop's current settings; edits call reapplyVat.
  function applyVat(order, vat, currency, issueInvoice) {
    if (hasVatSnapshot(order)) return reapplyVat(order, currency);
    if (!vat || !vat.enabled) return order;
    const d = decimalsFor(currency), amount = itemsAndDeliveryMinor(order, d);
    const rate = rateOf(vat, currency), included = vat.pricesInclude !== false;
    Object.assign(order, { vatRateBps: rate, vatIncluded: included, vatMinor: vatMinor(amount, rate, included) });
    if (order.invoiceNumber == null && !order.invoiceIdentifier) Object.assign(order, issueInvoice());
    return order;
  }

  // An EXISTING order after any edit (notes, date, items, quantities, delivery fee, pickup or delivery):
  // vatMinor again from the order's OWN vatRateBps and vatIncluded and its items and delivery now, like the
  // Android edit form. The shop's settings never come into it, and neither does the invoice number: an
  // order created without VAT stays without VAT and takes no invoice number from an edit.
  function reapplyVat(order, currency) {
    if (!hasVatSnapshot(order)) return order;
    order.vatMinor = vatMinor(itemsAndDeliveryMinor(order, decimalsFor(currency)), order.vatRateBps, order.vatIncluded);
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

  // New order, "Partial payment (deposit)": the typed amount checked against the order's final total (items,
  // delivery and VAT, in minor units), the way the phones do: Android refuses an empty, zero, unreadable or
  // over-total deposit, iOS a deposit above the total. A deposit equal to the total is allowed.
  // The amount is read as a plain number (a pasted "1e400" or "NaN" is not one) and rounded to the
  // currency's decimals like every amount that goes to the cloud.
  // → { ok: true, amount, minor }  amount in major units
  //   { ok: false, error: 'amount' }                 not a finite number above 0 (or rounds to 0)
  //   { ok: false, error: 'over', totalMinor }       more than the order's final total
  function checkDeposit(text, totalMinor, currency) {
    const d = decimalsFor(currency);
    const typed = typeof text === 'number' ? text : Number(String(text == null ? '' : text).trim());
    const minor = isFinite(typed) && typed > 0 ? toMinor(typed, d) : 0;
    if (!(minor > 0)) return { ok: false, error: 'amount' };
    if (minor > totalMinor) return { ok: false, error: 'over', totalMinor };
    return { ok: true, amount: minor / Math.pow(10, d), minor };
  }

  // ---------- Stock ----------
  //
  // Physical stock must never rise or fall only because tracking was switched on or off. Statuses and
  // today's tracking switches do not say what an order took out of the shelves; the order does, in its
  // own ledger `stockDeducted` { productId: whole units > 0 }, written in the same change as the stock
  // moves. { } means "takes nothing now"; a missing ledger is a legacy order (below). The rules:
  // - into confirmed, ready or collected: take the order's units of every product that tracks stock, only
  //   while the shop's stock tracking is on; those units are the ledger. A product that is not tracked
  //   (or the shop not tracking) takes nothing and is not in the ledger.
  // - out of them (cancelled, or back to new): give back exactly the ledger, whatever the tracking
  //   switches say now (the goods physically come back), then the ledger is { }.
  // - items edited while it holds stock: a product in the ledger moves by the difference (even with
  //   tracking off) and its entry follows; a new line takes its units when the shop and the product
  //   track; an older line that never took stock stays out of it.
  // - a legacy order's ledger is derived the first time it is needed (leaving, or an item edit while in
  //   one) from the stock moves that carry its id, and written in the same change. Known limit: a product
  //   keeps only its last 50 moves, so a very old order on a busy product may derive { } and give back
  //   nothing. That under-counts instead of inventing stock.

  const ORDER_MOVES = ['orderConfirmed', 'orderEdited', 'orderCancelled'];
  const isDeducted = status => DEDUCTED.indexOf(status) >= 0;

  function adjust(p, delta, reason, orderId, at, newId) {
    p.qty = num(p.qty, 0) + delta;
    const moves = Array.isArray(p.stockMoves) ? p.stockMoves : [];
    p.stockMoves = [{ id: newId(), delta, reason, orderId: orderId || null, note: null, at }].concat(moves).slice(0, MAX_STOCK_MOVES);
  }
  const productOf = (products, pid) => (pid ? (products || []).find(p => p.id === pid) : undefined);
  function tracked(products, pid) {
    const p = productOf(products, pid);
    return p && p.track ? p : undefined;
  }
  // Whole units per product over a list of order lines (a line with no product, or a custom one, counts
  // for none).
  function unitsByProduct(items) {
    const m = new Map();
    (items || []).forEach(it => {
      if (!it || !it.pid || it.pid === 'custom') return;
      m.set(it.pid, (m.get(it.pid) || 0) + Math.max(0, Math.round(num(it.qty, 1))));
    });
    return m;
  }
  // The order's own ledger as a clean { productId: whole units > 0 }, or undefined when it has none (a
  // legacy order, or a value that is not an object).
  function ledgerOf(order) {
    const raw = order && order.stockDeducted;
    if (!isObj(raw)) return undefined;
    const out = {};
    Object.keys(raw).forEach(pid => {
      const n = raw[pid];
      if (pid && pid !== '__proto__' && Number.isInteger(n) && n > 0) out[pid] = n;
    });
    return out;
  }
  // A legacy order's ledger from the products' stock moves that carry its id: per product the net units
  // taken out (orderConfirmed, orderEdited and orderCancelled moves summed with their sign, negated), only
  // where positive. No moves found: { }.
  function ledgerFromMoves(products, orderId) {
    const out = {};
    if (!orderId) return out;
    (products || []).forEach(p => {
      if (!p || !p.id || p.id === '__proto__') return;
      let moved = 0;
      (Array.isArray(p.stockMoves) ? p.stockMoves : []).forEach(m => {
        if (m && m.orderId === orderId && ORDER_MOVES.indexOf(m.reason) >= 0 && typeof m.delta === 'number' && isFinite(m.delta)) moved += Math.round(m.delta);
      });
      if (moved < 0) out[p.id] = -moved;
    });
    return out;
  }
  // The demo's legacy orders had a `stockApplied` flag and no moves: such an order took its units of the
  // products that track stock now, which is what the demo used to put back.
  function ledgerFromFlag(products, order) {
    const out = {};
    if (!order || order.stockApplied !== true) return out;
    unitsByProduct(order.items).forEach((qty, pid) => { if (qty > 0 && tracked(products, pid)) out[pid] = qty; });
    return out;
  }
  // The order's ledger: its own, else (a legacy order) derived by options.legacy(products, order), the
  // stock moves by default.
  function ledgerFor(products, order, options) {
    const own = ledgerOf(order);
    if (own) return own;
    const derive = options && typeof options.legacy === 'function' ? options.legacy : (ps, o) => ledgerFromMoves(ps, o.id);
    return ledgerOf({ stockDeducted: derive(products, order) }) || {};
  }

  // An order moves from status `from` to `to`: takes its stock (into confirmed or later) or gives back
  // exactly what it took (out of it), with an orderConfirmed or orderCancelled move per product, and
  // writes the ledger onto the order. options: { shopTracking: the shop's stock switch, legacy(products,
  // order): a legacy order's ledger }. Returns the products whose stock moved.
  function stockForStatus(products, order, from, to, at, newId, options) {
    const was = isDeducted(from), will = isDeducted(to);
    if (was === will) return [];
    const opts = options || {}, changed = [];
    if (will) {
      const taken = {};
      if (opts.shopTracking) {
        unitsByProduct(order.items).forEach((qty, pid) => {
          const p = tracked(products, pid);
          if (!p || !(qty > 0)) return;
          adjust(p, -qty, 'orderConfirmed', order.id, at, newId);
          taken[pid] = qty;
          changed.push(p);
        });
      }
      order.stockDeducted = taken;
      return changed;
    }
    const ledger = ledgerFor(products, order, opts);
    Object.keys(ledger).forEach(pid => {
      const p = productOf(products, pid); // a product that no longer exists is skipped
      if (!p) return;
      adjust(p, ledger[pid], 'orderCancelled', order.id, at, newId);
      changed.push(p);
    });
    order.stockDeducted = {};
    return changed;
  }

  // The items of an order are replaced (call it before `order.items = newItems`). Only an order that holds
  // stock (confirmed, ready, collected) moves any: per product `change = new units - old units`.
  // - in the ledger: stock moves by -change (an orderEdited move), even with tracking off, and the entry
  //   becomes old + change, gone at 0. A reduction never gives back more than the ledger holds.
  // - not in the ledger, a new line (no units before), shop and product tracking: takes its units.
  // - not in the ledger, a line that was there before: nothing (it never took stock).
  // A legacy order's ledger is derived first and written either way. Returns the products whose stock moved.
  function stockForEdit(products, order, newItems, at, newId, options) {
    if (!isDeducted(order.status)) return [];
    const opts = options || {};
    const before = unitsByProduct(order.items), after = unitsByProduct(newItems);
    const ledger = Object.assign({}, ledgerFor(products, order, opts)), changed = [];
    new Set([...before.keys(), ...after.keys()]).forEach(pid => {
      const was = before.get(pid) || 0, change = (after.get(pid) || 0) - was, p = productOf(products, pid);
      if (!change) return;
      let delta; // units the order takes more (positive) or gives back (negative)
      if (ledger[pid] > 0) delta = Math.max(change, -ledger[pid]);
      else if (was === 0 && opts.shopTracking && p && p.track) delta = change;
      else return;
      if (p) {
        adjust(p, -delta, 'orderEdited', order.id, at, newId);
        changed.push(p);
      }
      const left = (ledger[pid] || 0) + delta;
      if (left > 0) ledger[pid] = left; else delete ledger[pid];
    });
    order.stockDeducted = ledger;
    return changed;
  }

  // Who may move stock for an order: the products permission, or staff who handle orders (orders or
  // prepare) — the server accepts their product pushes that only add order stock moves
  // (server/sync/record-access.ts isOrderStockUpdate).
  const canMoveOrderStock = can => !!(can('products') || can('orders') || can('prepare'));

  // ---------- Payments ----------
  //
  // A payment is identified by its id, and payments are add-only on the wire: a pushed order that leaves a
  // payment out never removes it (a stale copy would only bring it back). A deliberate deletion, the trash
  // button on the order or the Undo of a payment just recorded, therefore takes the payment out of
  // `payments` and puts its id into the order's `removedPaymentIds`. cloud-map.js writes that list and keeps
  // the union with the record's, the server and the phones keep the union of every copy's. It only grows: no
  // id is ever taken out of it and none is written twice (compared without letter case, like the server).
  // A payment without an id (a demo saved before payments had ids) has nothing to remember and is simply
  // taken out, as it always was; so is one whose id the server would refuse (over 64 characters), because
  // one such id would make it ignore the whole list.

  const PAYMENT_ID_MAX = 64;
  const validPaymentId = v => typeof v === 'string' && v !== '' && v.length <= PAYMENT_ID_MAX;

  // The order's removedPaymentIds as a clean list: valid ids, each once, in the order they came.
  function removedPaymentIds(order) {
    const seen = new Set(), out = [];
    (Array.isArray(order && order.removedPaymentIds) ? order.removedPaymentIds : []).forEach(id => {
      if (!validPaymentId(id) || seen.has(id.toLowerCase())) return;
      seen.add(id.toLowerCase());
      out.push(id);
    });
    return out;
  }

  // Takes one payment out of the order and remembers its id. `ref` says which: { id } is the payment with
  // that id (and no other, even when its time matches); without an id, { at, amount? } is the first payment
  // made at that time, with that amount when one is given (a payment from before ids). Returns whether a
  // payment was removed.
  function removePayment(order, ref) {
    const list = order && Array.isArray(order.payments) ? order.payments : [];
    const r = ref || {};
    const i = list.findIndex(p => isObj(p) && (r.id ? p.id === r.id : !!r.at && p.at === r.at && (r.amount === undefined || p.amount === r.amount)));
    if (i < 0) return false;
    const gone = list[i];
    order.payments = list.filter((_, k) => k !== i);
    if (validPaymentId(gone.id)) {
      const ids = removedPaymentIds(order);
      if (!ids.some(id => id.toLowerCase() === gone.id.toLowerCase())) ids.push(gone.id);
      order.removedPaymentIds = ids;
    }
    return true;
  }

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

  // ---------- Out for delivery ----------

  // A delivery order between Ready and Delivered: still "ready" on the wire (older apps know no other
  // status), with outForDeliveryAt set. An outForDelivery history entry's value is when it went out
  // (another app may write true); null, '' or false is back to Ready.
  const wentOut = v => v === true || (typeof v === 'string' && v !== '' && v !== 'false' && v !== 'null');
  const isOutForDelivery = o => !!o && o.status === 'ready' && wentOut(o.outForDeliveryAt);
  // The order's next step on its page: confirmed, ready, then for a delivery order 'out' (out for
  // delivery) before collected (delivered); a pickup order goes from ready to collected. `out: false`
  // skips the out step (staff whose order pushes the server keeps to the status only).
  function nextStep(o, options) {
    const out = !options || options.out !== false;
    if (o.status === 'new') return 'confirmed';
    if (o.status === 'confirmed') return 'ready';
    if (o.status === 'ready') return out && o.fulfillment === 'delivery' && !isOutForDelivery(o) ? 'out' : 'collected';
    return null;
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
    if (ch.kind === 'outForDelivery') return { key: wentOut(ch.value) ? 'history.outForDelivery' : 'history.backToReady' };
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
  // The draft of an orderat-parse answer. The delivery keys (fulfillment 'pickup' | 'delivery' | null,
  // address { area, block, road, building, flat, city, text }, deliveryNote) are read from the draft,
  // else from the answer itself; an older server sends none of them.
  const DELIVERY_KEYS = ['fulfillment', 'address', 'deliveryNote'];
  function answerDraft(answer) {
    const a = isObj(answer) ? answer : {};
    const d = Object.assign({}, isObj(a.draft) ? a.draft : {});
    DELIVERY_KEYS.forEach(k => { if (d[k] == null && a[k] != null) d[k] = a[k]; });
    return d;
  }
  // `place` says how the shop writes an address: { bahrain, areaCode(name) → the form's area code or '',
  // labels: { block, road, building, flat }, sep }. Without it the draft's address is left out.
  function draftFields(draft, products, place) {
    const d = draft || {}, out = {};
    out.items = (d.items || []).map(it => {
      const p = (products || []).find(x => x.id === it.productId), qty = it.quantity > 0 ? it.quantity : 1;
      return p ? { pid: p.id, name: '', qty, price: p.price } : { pid: 'custom', name: String(it.rawText || ''), qty, price: 0 };
    });
    if (d.customerName) out.name = d.customerName;
    if (isFinite(time(d.collectionAt))) out.due = localInput(time(d.collectionAt));
    if (d.notes) out.notes = d.notes;
    if (d.fulfillment === 'pickup' || d.fulfillment === 'delivery') out.fulfillment = d.fulfillment;
    if (place) {
      const a = deliveryAddress(d.address, d.deliveryNote, place);
      if (a.area) out.area = a.area;
      if (a.address) out.address = a.address;
      // An address with no pickup or delivery said is a delivery: on pickup the form would hide it.
      if (!out.fulfillment && (a.area || a.address)) out.fulfillment = 'delivery';
    }
    return out;
  }

  // The order form's delivery address from the parts the AI (or the demo reader) found. A Bahrain shop
  // picks its area from a list, so a known area (or city) goes there and everything else into the one
  // free-text address: the other places, then "Block 935, Road 3510, Building 12, Flat 4" (a bare number
  // gets its label), then the address as written, then the delivery note, one per line. Any other shop
  // has the single address field, so it all goes into the text.
  const ADDRESS_PARTS = ['block', 'road', 'building', 'flat'];
  const LEADING_DIGIT = /^[0-9٠-٩۰-۹]/;
  const piece = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : '');
  const sameName = (a, b) => a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
  function deliveryAddress(address, note, place) {
    const p = place || {}, labels = isObj(p.labels) ? p.labels : {}, sep = p.sep || ', ';
    const a = isObj(address) ? address : { text: address };
    const code = name => (name && p.bahrain && typeof p.areaCode === 'function' ? piece(p.areaCode(name)) : '');
    const areaName = piece(a.area), city = piece(a.city);
    const areaCode = code(areaName), cityCode = areaCode ? '' : code(city);
    const parts = [];
    if (areaName && !areaCode) parts.push(areaName);
    if (city && !cityCode && !(areaName && sameName(city, areaName))) parts.push(city);
    ADDRESS_PARTS.forEach(k => {
      const v = piece(a[k]);
      if (v) parts.push(LEADING_DIGIT.test(v) && piece(labels[k]) ? `${piece(labels[k])} ${v}` : v);
    });
    const line = parts.join(sep), text = piece(a.text), extra = piece(note);
    const lines = [line, text === line ? '' : text, extra].filter(Boolean);
    return { area: areaCode || cityCode, address: lines.join('\n').slice(0, 500) };
  }

  // ---------- Default delivery fee ----------

  // The shop's `setting/deliveryDefaults` value { feeMinor } → the fee in minor units; 0 when there is
  // none, or it is not a whole number of minor units >= 0.
  function deliveryFeeMinor(value) {
    const n = isObj(value) ? value.feeMinor : undefined;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
  }
  // An order form's delivery fee when its pickup or delivery changes (the switch, the AI, a shop-link
  // order): { fee as typed, touched (the seller typed in it), auto (it holds the default) } → the new
  // { fee, auto }. Turning into a delivery with the fee still empty or 0 and untouched puts the shop's
  // default in (still editable); back to pickup takes an auto-filled fee out. A typed fee never changes.
  function feeForFulfillment(state, fulfillment, defaultFee) {
    const s = state || {}, fee = s.fee == null ? '' : String(s.fee);
    if (fulfillment === 'delivery') {
      if (!s.touched && !(parseFloat(fee) > 0) && defaultFee > 0) return { fee: String(defaultFee), auto: true };
      return { fee, auto: !!s.auto && !s.touched };
    }
    return s.auto && !s.touched ? { fee: '', auto: false } : { fee, auto: false };
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
    subscriptionAllowed, subscriptionActive, aiDemo, callingCode, localDigits, normalizePhone, access, formatInvoice, nextInvoice, invoiceLabel,
    vatMinor, defaultRateBps, applyVat, reapplyVat, orderMinor, checkDeposit, stockForStatus, stockForEdit, ledgerOf, ledgerFromMoves, ledgerFromFlag,
    removePayment, removedPaymentIds, orderNumbers, historyLabel,
    cleanItems, parseProducts, answerDraft, draftFields, deliveryAddress, buildAskSnapshot, canMoveOrderStock, flushBeforeLeaving,
    createPermissionEditor, deliveryFeeMinor, feeForFulfillment, isOutForDelivery, nextStep,
  };
});
