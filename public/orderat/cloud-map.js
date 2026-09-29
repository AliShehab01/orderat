// Orderat web: the one translator between the phones' canonical cloud records (docs/sme-phase-2-cloud.md
// "Record formats", written by the iPhone's CloudRecordMapping.swift and Android's sync/mapping/*.dart)
// and this web app's in-memory model (demo.js makeDemoData).
//
// xToWeb(id, data, ctx) reads a record. xToCloud(webObj, rawData, ctx) writes one back, starting from a
// copy of rawData (the last cloud data for that id, undefined for a new record) and overwriting only the
// fields the web owns, so:
// - unknown keys, and the known ones the web does not own (address.block, stockMoves, ...),
//   survive a web edit;
// - a field the web did not change keeps its exact raw form (null or missing, another app's date format,
//   an enum code this build does not know), so toCloud(toWeb(raw), raw) deep-equals raw for any record
//   and cloud-sync.js pushes only what the web really changed;
// - a field missing from the web object (undefined) is left as it is.
// For an existing record, callers must pass xToCloud a web object that came from this same rawData
// (read with xToWeb, then edited), and always the live object, not a copy (see the side effect below).
// The web object is the authority for items, payments and plain fields, so one read from an older raw
// record would drop what a phone added since (only order history is merged): rebuild web objects from
// raw after every pull or restore.
// ctx = { decimals, now: Date, deviceCode }. Money is integer minor units in the cloud and major units on
// the web; cloud dates are ISO 8601 UTC with milliseconds.
//
// One deliberate side effect: an order item or payment without an id gets newId() written onto the web
// object, and a web history entry keeps its converted cloud entry on `_c`, so writing the same web order
// twice (say the first push failed) gives the same ids instead of new ones every time.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderatCloudMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENTITY_ORDER = Object.freeze(['shop', 'customer', 'product', 'occasion', 'order', 'expense', 'setting']);

  // ---------- Helpers ----------

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const obj = v => (isObj(v) ? v : {});
  const objects = v => (Array.isArray(v) ? v.filter(isObj) : []);
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pad = n => String(n).padStart(2, '0');
  const idOf = x => (typeof x.id === 'string' && x.id ? x.id : undefined);
  // A new record's result is built from scratch; an existing one's from a deep copy of the raw record.
  const start = raw => (isObj(raw) ? clone(raw) : {});

  // JSON with sorted keys, so two values compare equal whatever their key order.
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stable(x))).join(',')}]`;
    if (isObj(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return v === undefined ? 'undefined' : JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);

  // ---------- Money, ids, dates ----------

  const DECIMALS = { BHD: 3, KWD: 3, OMR: 3, SAR: 2, AED: 2, QAR: 2 };

  // Minor-unit digits of a currency; an unknown code counts as the phones' default currency, BHD.
  function decimalsFor(code) {
    const key = String(code || '').toUpperCase();
    return own(DECIMALS, key) ? DECIMALS[key] : 3;
  }
  const unit = decimals => Math.pow(10, typeof decimals === 'number' && isFinite(decimals) ? decimals : 3);

  // Major units → whole minor units. toFixed first, so binary noise (1.005 × 100 = 100.4999…) rounds
  // the way the typed amount reads; halves round away from zero.
  function toMinor(amount, decimals) {
    const n = Number(amount);
    if (!isFinite(n)) return 0;
    const minor = Math.round(Number((Math.abs(n) * unit(decimals)).toFixed(6)));
    return n < 0 ? -minor || 0 : minor;
  }
  function fromMinor(minor, decimals) {
    const n = Number(minor);
    return isFinite(n) ? Math.round(n) / unit(decimals) || 0 : 0;
  }

  // A lowercase v4 UUID. crypto.randomUUID exists only on secure pages (https, localhost), so fall back
  // to getRandomValues, then Math.random.
  function newId() {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // A Date or a date string as canonical ISO (UTC, milliseconds); undefined when it is not a date.
  function iso(v) {
    if (!(v instanceof Date) && (typeof v !== 'string' || !v)) return undefined;
    const t = new Date(v).getTime();
    return isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  const nowIso = ctx => iso(ctx && ctx.now) || new Date().toISOString();
  const decimalsOf = ctx => (ctx && typeof ctx.decimals === 'number' ? ctx.decimals : 3);

  // An occasion day, 'YYYY-MM-DD' on the web: the local calendar day of the cloud instant. The iOS form
  // keeps the picker's time of day and Android writes local midnight; both read back as the day picked.
  function dayOf(v) {
    const s = iso(v);
    if (!s) return typeof v === 'string' ? v : '';
    const d = new Date(s);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---------- Field codecs ----------
  // read: cloud value → web value (anything missing or malformed reads as the web default).
  // write: web value → canonical cloud value (undefined leaves the key out).

  const text = { read: v => (typeof v === 'string' ? v : ''), write: v => (v == null ? '' : String(v)) };
  const optText = { read: text.read, write: v => (v == null || v === '' ? null : String(v)) };
  const nullableText = { read: v => (typeof v === 'string' && v !== '' ? v : null), write: optText.write };
  const webOnlyText = { read: text.read, write: v => (v == null || v === '' ? undefined : String(v)) };
  const textList = { read: v => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []), write: v => textList.read(v) };
  const flag = def => ({ read: v => (typeof v === 'boolean' ? v : def), write: v => (v == null ? def : Boolean(v)) });
  const nullableFlag = { read: v => (typeof v === 'boolean' ? v : null), write: v => (v == null ? null : Boolean(v)) };
  const int = def => ({
    read: v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : def),
    write: v => (v == null || v === '' || !isFinite(Number(v)) ? def : Math.round(Number(v))),
  });
  const nullableInt = int(null);
  const QTY = int(1);
  // The shop's daily capacity: the shop form writes 0 for "no limit", which the cloud spells null.
  const capacity = { read: v => (typeof v === 'number' && v > 0 ? Math.round(v) : null), write: v => (Number(v) > 0 ? Math.round(Number(v)) : null) };
  // Passed through as it is: invoiceNumber is an int from the iPhone, a formatted string from Android.
  const anyValue = { read: v => (v === undefined ? null : clone(v)), write: v => (v === undefined ? null : clone(v)) };
  const money = decimals => ({ read: v => fromMinor(typeof v === 'number' ? v : 0, decimals), write: v => toMinor(v, decimals) });
  const date = fallback => ({ read: v => iso(v) || (typeof v === 'string' ? v : ''), write: v => iso(v) || fallback });
  const anyDate = date(null);
  // An occasion's first day is written at local 00:00:00.000 and its last at local 23:59:59.999, so the
  // phones' instant check (iOS Occasion.covers: startDate <= date <= endDate) covers both days whole.
  const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dayAt = (h, min, sec, ms) => ({
    read: dayOf,
    write: v => {
      const k = DAY_KEY.exec(typeof v === 'string' && DAY_KEY.test(v) ? v : dayOf(v));
      return k ? new Date(+k[1], k[2] - 1, +k[3], h, min, sec, ms).toISOString() : null;
    },
  });
  const firstDay = dayAt(0, 0, 0, 0);
  const lastDay = dayAt(23, 59, 59, 999);
  const CURRENCY = { read: v => (typeof v === 'string' && v ? v : 'BHD'), write: v => (v == null || v === '' ? 'BHD' : String(v)) };
  // Web-only, kept in the cloud record (the phones keep unknown keys): where an order came from.
  const SOURCE = { read: v => (typeof v === 'string' && v ? v : 'manual'), write: webOnlyText.write };

  // An enum code. `renames` maps the cloud codes the web spells differently. A code this build does not
  // know reads as `other`, and since the web value then still reads the same, it is written back unchanged.
  function codes(known, def, other, renames) {
    const toWeb = renames || {}, toCloud = {};
    Object.keys(toWeb).forEach(k => { toCloud[toWeb[k]] = k; });
    const cloudOf = v => (own(toCloud, v) ? toCloud[v] : v);
    return {
      read: v => (typeof v !== 'string' || v === '' ? def : known.indexOf(v) < 0 ? other : own(toWeb, v) ? toWeb[v] : v),
      write: v => (v == null || v === '' ? (def === '' ? null : cloudOf(def)) : cloudOf(String(v))),
    };
  }
  const STATUS = codes(['newOrder', 'confirmed', 'ready', 'collected', 'cancelled'], 'new', 'other', { newOrder: 'new' });
  const BUSINESS = codes(['home', 'shop', 'services', 'food', 'food_truck', 'other'], 'home', 'other', { food_truck: 'foodTruck' });
  const FULFILLMENT = codes(['pickup', 'delivery'], 'pickup', 'pickup');
  const AREA = codes(['manama', 'muharraq', 'riffa', 'hamadTown', 'isaTown', 'sitra', 'budaiya', 'adliya', 'saar', 'janabiya', 'other'], '', 'other');
  const METHOD = codes(['benefit', 'cash', 'transfer', 'card'], 'cash', 'cash');
  const CATEGORY = codes(['ingredients', 'packaging', 'delivery', 'ads', 'equipment', 'tools', 'rent', 'other'], 'other', 'other');
  const KIND = codes(['ramadan', 'eidAlFitr', 'eidAlAdha', 'bahrainNationalDay', 'gergaoon', 'custom'], 'custom', 'custom');

  // Writes one web-owned field into `out`, the copy of `raw` being built. On an existing record the raw
  // value stays, in its exact raw form, when the web value is missing or still reads the same.
  function put(out, raw, key, value, codec, isNew) {
    const next = codec.write(value);
    if (!isNew) {
      const was = codec.read(raw[key]);
      if (value === undefined || same(value, was) || same(codec.read(next), was)) return false;
    }
    if (next === undefined) delete out[key];
    else out[key] = next;
    return true;
  }
  // Field tables: [web key, cloud key, codec].
  function readFields(fields, data, into) {
    fields.forEach(([w, c, codec]) => { into[w] = codec.read(data[c]); });
    return into;
  }
  function putFields(fields, web, out, raw, isNew) {
    return fields.reduce((changed, [w, c, codec]) => put(out, raw, c, web[w], codec, isNew) || changed, false);
  }
  // An array field: set unless it still matches the raw array (a missing raw array counts as empty).
  function putList(out, raw, key, next, isNew) {
    if (!isNew && same(next, Array.isArray(raw[key]) ? raw[key] : [])) return false;
    out[key] = next;
    return true;
  }
  function byId(list) {
    const index = Object.create(null);
    objects(list).forEach(x => { if (idOf(x) && !(x.id in index)) index[x.id] = x; });
    return index;
  }

  // ---------- shop ⇄ { shop, vat, stockEnabled } ----------

  const SHOP_FIELDS = [
    ['nameAr', 'nameAr', text], ['nameEn', 'nameEn', optText], ['phone', 'phone', text], ['currency', 'currencyCode', CURRENCY],
    ['pickupHours', 'pickupHours', optText], ['dailyCapacity', 'dailyCapacity', capacity], ['businessType', 'businessType', BUSINESS],
  ];
  // The VAT rate in basis points (1000 = 10%), null when the shop never set one; a web object without
  // it (undefined) leaves the key out of a new record.
  const RATE_BPS = { read: nullableInt.read, write: v => (v === undefined ? undefined : nullableInt.write(v)) };
  const VAT_FIELDS = [['enabled', 'enabled', flag(false)], ['trn', 'trn', text], ['pricesInclude', 'pricesIncludeVat', flag(true)], ['rateBps', 'rateBps', RATE_BPS]];
  const STOCK_ON = flag(false);

  function shopToWeb(id, data) {
    const d = obj(data);
    return { shop: readFields(SHOP_FIELDS, d, {}), vat: readFields(VAT_FIELDS, obj(d.vat), {}), stockEnabled: STOCK_ON.read(obj(d.stock).enabled) };
  }
  // Keeps stock.defaultLowStockThreshold and createdAt (now for a new shop).
  function shopToCloud(web, raw, ctx) {
    const w = obj(web), r = obj(raw), isNew = !isObj(raw), out = start(raw);
    putFields(SHOP_FIELDS, obj(w.shop), out, r, isNew);
    const vat = isObj(out.vat) ? out.vat : {};
    if (putFields(VAT_FIELDS, obj(w.vat), vat, obj(r.vat), isNew)) out.vat = vat;
    const stock = isObj(out.stock) ? out.stock : {};
    if (put(stock, obj(r.stock), 'enabled', w.stockEnabled, STOCK_ON, isNew)) out.stock = stock;
    if (isNew) out.createdAt = nowIso(ctx);
    return out;
  }

  // ---------- product ----------

  const productFields = decimals => [
    ['nameAr', 'nameAr', text], ['nameEn', 'nameEn', optText], ['aliases', 'aliases', textList],
    ['price', 'priceMinor', money(decimals)], ['cost', 'costMinor', money(decimals)], ['cap', 'dailyCapacity', nullableInt],
    ['active', 'active', flag(true)], ['track', 'trackStock', flag(false)], ['qty', 'stockQuantity', int(0)],
    ['low', 'lowStockThreshold', int(3)], ['photoId', 'photoId', nullableText],
  ];
  function productToWeb(id, data, ctx) {
    return readFields(productFields(decimalsOf(ctx)), obj(data), { id });
  }
  // Keeps stockMoves (the phones' stock history) and createdAt.
  function productToCloud(p, raw, ctx) {
    const isNew = !isObj(raw), out = start(raw);
    putFields(productFields(decimalsOf(ctx)), obj(p), out, obj(raw), isNew);
    if (isNew) Object.assign(out, { stockMoves: [], createdAt: nowIso(ctx) });
    return out;
  }

  // ---------- customer (nameEn is web-only) ----------

  const CUSTOMER_FIELDS = [['name', 'name', text], ['nameEn', 'nameEn', webOnlyText], ['phone', 'phone', text], ['area', 'area', AREA], ['notes', 'notes', optText]];
  function customerToWeb(id, data) {
    return readFields(CUSTOMER_FIELDS, obj(data), { id });
  }
  function customerToCloud(c, raw, ctx) {
    const isNew = !isObj(raw), out = start(raw);
    putFields(CUSTOMER_FIELDS, obj(c), out, obj(raw), isNew);
    if (isNew) out.createdAt = nowIso(ctx);
    return out;
  }

  // ---------- order ----------

  const STOCK_TAKEN = ['confirmed', 'ready', 'collected']; // web statuses whose stock is already deducted
  const HISTORY_KINDS = { order: 'created', status: 'status', items: 'items', paymentStatus: 'payment' };
  // The order's plain fields; the address area, items, payments and history are mapped below.
  const orderFields = (m, now) => [
    ['customerId', 'customerId', text], ['status', 'status', STATUS], ['fulfillment', 'fulfillmentType', FULFILLMENT],
    ['dueAt', 'dueAt', date(now)], ['deliveryFee', 'deliveryFeeMinor', m], ['notes', 'notes', optText], ['source', 'source', SOURCE],
    ['vatRateBps', 'vatRateBps', nullableInt], ['vatIncluded', 'vatIncluded', nullableFlag], ['vatMinor', 'vatMinor', nullableInt],
    ['invoiceNumber', 'invoiceNumber', anyValue], ['invoiceIdentifier', 'invoiceIdentifier', nullableText],
  ];

  // History for display in the web's shape, the cloud entry itself kept on `_c`.
  function historyToWeb(c) {
    const entry = { kind: own(HISTORY_KINDS, c.field) ? HISTORY_KINDS[c.field] : 'other' };
    if (entry.kind === 'status') entry.value = STATUS.read(c.newValue);
    entry.at = anyDate.read(c.at);
    entry._c = clone(c);
    return entry;
  }

  function orderToWeb(id, data, ctx) {
    const d = obj(data), m = money(decimalsOf(ctx)), web = readFields(orderFields(m, null), d, { id });
    web.area = AREA.read(obj(d.address).area);
    web.items = objects(d.items).map(it => {
      const name = text.read(it.nameSnapshot);
      return { id: idOf(it), pid: nullableText.read(it.productId), nameAr: name, nameEn: name, qty: QTY.read(it.quantity), price: m.read(it.unitPriceMinor), cost: m.read(it.unitCostMinor) };
    });
    web.payments = objects(d.payments).map(p => ({ id: idOf(p), amount: m.read(p.amountMinor), method: METHOD.read(p.method), note: optText.read(p.note), at: anyDate.read(p.paidAt) }));
    web.changes = objects(d.changes).map(historyToWeb);
    web.stockApplied = STOCK_TAKEN.indexOf(web.status) >= 0;
    web.createdAt = anyDate.read(d.createdAt);
    return web;
  }

  // Items keep their raw copy (and its unknown keys) by id.
  function itemsToCloud(items, rawItems, m) {
    const known = byId(rawItems);
    return objects(items).map(it => {
      if (!idOf(it)) it.id = newId(); // on the web item too, so the next write reuses it
      const r = known[it.id], isNew = !r, base = r || {}, out = isNew ? { id: it.id } : clone(r);
      put(out, base, 'productId', it.pid, nullableText, isNew);
      // nameSnapshot is history: an existing line keeps it, even when its product was renamed since,
      // unless the web moved the line to another product (or to none) or renamed a custom line (one with
      // no product before or after).
      const rawPid = nullableText.read(base.productId);
      const pid = it.pid === undefined ? rawPid : nullableText.read(it.pid);
      const name = String(it.nameAr || it.nameEn || '');
      const named = it.nameAr !== undefined || it.nameEn !== undefined;
      const moved = pid !== rawPid;
      const renamed = pid === null && rawPid === null && name !== text.read(base.nameSnapshot);
      if (isNew || (named && (moved || renamed))) out.nameSnapshot = name;
      put(out, base, 'quantity', it.qty, QTY, isNew);
      put(out, base, 'unitPriceMinor', it.price, m, isNew);
      put(out, base, 'unitCostMinor', it.cost, m, isNew);
      return out;
    });
  }

  function paymentsToCloud(payments, rawPayments, m, now) {
    const known = byId(rawPayments), paidAt = date(now);
    return objects(payments).map(p => {
      if (!idOf(p)) p.id = newId();
      const r = known[p.id], isNew = !r, base = r || {}, out = isNew ? { id: p.id } : clone(r);
      put(out, base, 'amountMinor', p.amount, m, isNew);
      put(out, base, 'method', p.method, METHOD, isNew);
      put(out, base, 'note', p.note, optText, isNew);
      put(out, base, 'paidAt', p.at, paidAt, isNew);
      return out;
    });
  }

  // A new web history entry in cloud form; payments are not history in the cloud (the payments array
  // carries them). `status` is the order's status before this entry, in cloud form.
  function historyEntry(ch, status, now) {
    const at = iso(ch.at) || now;
    if (ch.kind === 'created') return { id: newId(), field: 'order', newValue: 'created', at };
    if (ch.kind === 'items') return { id: newId(), field: 'items', newValue: 'edited', at };
    if (ch.kind !== 'status') return undefined;
    const entry = { id: newId(), field: 'status' };
    if (status !== undefined) entry.oldValue = status;
    entry.newValue = STATUS.write(ch.value);
    entry.at = at;
    return entry;
  }

  // The raw history as it is (with any entries another phone added since the web read the order), then
  // the web entries the cloud does not have yet: an unsent `_c`, or a new entry converted to cloud form.
  function historyToCloud(changes, raw, now) {
    const out = Array.isArray(raw.changes) ? clone(raw.changes) : [];
    const seen = Object.create(null);
    objects(raw.changes).forEach(c => { if (typeof c.id === 'string') seen[c.id] = true; });
    let status = typeof raw.status === 'string' ? raw.status : undefined;
    objects(changes).forEach(ch => {
      let entry = isObj(ch._c) ? ch._c : undefined;
      if (entry) {
        if (typeof entry.id !== 'string' || seen[entry.id]) return; // already in the raw history
      } else {
        entry = historyEntry(ch, status, now);
        if (!entry) return;
        ch._c = entry; // on the web entry too, so the next write reuses it
      }
      seen[entry.id] = true;
      if (entry.field === 'status' && typeof entry.newValue === 'string') status = entry.newValue;
      out.push(clone(entry));
    });
    return out;
  }

  // Like the phones' Order.totalMinor: items plus delivery, plus the VAT when it was added on top of prices.
  function paymentStatusOf(d) {
    const n = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);
    let total = objects(d.items).reduce((s, it) => s + n(it.quantity, 1) * n(it.unitPriceMinor, 0), n(d.deliveryFeeMinor, 0));
    if (d.vatIncluded === false) total += n(d.vatMinor, 0);
    const paid = objects(d.payments).reduce((s, p) => s + n(p.amountMinor, 0), 0);
    return paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'deposit';
  }

  // When the web changed anything, paymentStatus is recomputed (a change is logged when it moves) and
  // updatedAt is set to now. Never written: `no`, `stockApplied`, the items' nameAr/nameEn.
  function orderToCloud(o, raw, ctx) {
    const w = obj(o), r = obj(raw), isNew = !isObj(raw), out = start(raw);
    const m = money(decimalsOf(ctx)), now = nowIso(ctx);
    let changed = putFields(orderFields(m, now), w, out, r, isNew);
    const address = isObj(out.address) ? out.address : {}; // block, road, building and notes stay as they are
    if (put(address, obj(r.address), 'area', w.area, AREA, isNew)) {
      out.address = address;
      changed = true;
    }
    if (isNew || w.items !== undefined) changed = putList(out, r, 'items', itemsToCloud(w.items, r.items, m), isNew) || changed;
    if (isNew || w.payments !== undefined) changed = putList(out, r, 'payments', paymentsToCloud(w.payments, r.payments, m, now), isNew) || changed;
    if (isNew || w.changes !== undefined) changed = putList(out, r, 'changes', historyToCloud(w.changes, r, now), isNew) || changed;
    if (!isNew && !changed) return out; // nothing the web owns changed: still the raw record

    const paymentStatus = paymentStatusOf(out);
    if (isNew || paymentStatus !== r.paymentStatus) {
      const entry = { id: newId(), field: 'paymentStatus' };
      if (typeof r.paymentStatus === 'string') entry.oldValue = r.paymentStatus;
      entry.newValue = paymentStatus;
      entry.at = now;
      out.changes = (Array.isArray(out.changes) ? out.changes : []).concat(entry);
    }
    out.paymentStatus = paymentStatus;
    if (isNew) out.createdAt = iso(w.createdAt) || now;
    out.updatedAt = now;
    return out;
  }

  // ---------- expense ----------

  // A demo expense note can be { en, ar }; the cloud holds one string.
  const expenseNote = { read: text.read, write: v => optText.write(isObj(v) ? v.ar || v.en : v) };
  const expenseFields = (decimals, now) => [['amount', 'amountMinor', money(decimals)], ['category', 'category', CATEGORY], ['note', 'note', expenseNote], ['date', 'date', date(now)]];
  function expenseToWeb(id, data, ctx) {
    return readFields(expenseFields(decimalsOf(ctx), null), obj(data), { id });
  }
  // Keeps recurring, receiptPhotoId and createdAt.
  function expenseToCloud(e, raw, ctx) {
    const isNew = !isObj(raw), out = start(raw), now = nowIso(ctx);
    putFields(expenseFields(decimalsOf(ctx), now), obj(e), out, obj(raw), isNew);
    if (isNew) Object.assign(out, { recurring: false, createdAt: now });
    return out;
  }

  // ---------- occasion (start/end are day keys on the web) ----------

  const OCCASION_FIELDS = [
    ['kind', 'kind', KIND], ['nameAr', 'nameAr', text], ['nameEn', 'nameEn', optText], ['start', 'startDate', firstDay], ['end', 'endDate', lastDay],
    ['cap', 'dailyCapacityOverride', nullableInt], ['blocked', 'blocked', flag(false)], ['notes', 'notes', optText],
  ];
  function occasionToWeb(id, data) {
    return readFields(OCCASION_FIELDS, obj(data), { id });
  }
  // Keeps preOrderOpensAt.
  function occasionToCloud(x, raw) {
    const isNew = !isObj(raw), out = start(raw);
    putFields(OCCASION_FIELDS, obj(x), out, obj(raw), isNew);
    return out;
  }

  // ---------- setting (id = key, e.g. whatsappTemplates; data = { value }) ----------

  function settingToWeb(id, data) {
    return clone(obj(data).value);
  }
  function settingToCloud(value, raw) {
    const out = start(raw);
    if (value !== undefined && !(isObj(raw) && same(value, raw.value))) out.value = clone(value);
    return out;
  }

  return {
    ENTITY_ORDER, decimalsFor, toMinor, fromMinor, newId,
    shopToWeb, shopToCloud, customerToWeb, customerToCloud, productToWeb, productToCloud,
    occasionToWeb, occasionToCloud, orderToWeb, orderToCloud, expenseToWeb, expenseToCloud,
    settingToWeb, settingToCloud,
  };
});
