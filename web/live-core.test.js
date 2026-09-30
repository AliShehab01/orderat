// public/orderat/live-core.js: the pure rules of the signed-in web app (the paid gate, staff access,
// invoice numbers, VAT and stock like the phones, the Ask Orderat snapshot, order numbers, history
// labels, item ids, the AI order-entry draft).
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

process.env.TZ = 'Asia/Bahrain';

const load = createRequire(import.meta.url);
const core = load('../public/orderat/live-core.js');

const NOW = new Date('2026-09-29T08:00:00.000Z'); // 11:00 in Bahrain
const DAY = 864e5;
const iso = ms => new Date(ms).toISOString();

describe('subscription gate', () => {
  const at = offsetDays => iso(NOW.getTime() + offsetDays * DAY);

  it('allows a shop without a subscription record', () => {
    expect(core.subscriptionAllowed(null, NOW)).toBe(true);
    expect(core.subscriptionAllowed(undefined, NOW)).toBe(true);
  });

  it('allows until seven days after expiresAt, whatever the status', () => {
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: at(10) }, NOW)).toBe(true);
    expect(core.subscriptionAllowed({ status: 'expired', expiresAt: at(-6.9) }, NOW)).toBe(true);
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: at(-7.1) }, NOW)).toBe(false);
    expect(core.subscriptionAllowed({ status: 'none', expiresAt: at(-30) }, NOW)).toBe(false);
  });

  it('normalizes a typed phone to the international form where it can tell', () => {
    expect(core.normalizePhone('3300 1001', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('٣٣٠٠١٠٠١', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('۳۳۰۰۱۰۰۱', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('00973 3300-1001', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('+973 (3300) 1001', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('97333001001', 'BHD')).toBe('+97333001001');
    expect(core.normalizePhone('0501234567', 'SAR')).toBe('+966501234567');
    expect(core.normalizePhone('12345', 'BHD')).toBe('12345');
    expect(core.normalizePhone('  ', 'BHD')).toBe('');
    expect(core.normalizePhone(null, 'BHD')).toBe('');
  });

  it('maps the shop currency to its calling code', () => {
    expect(core.callingCode('SAR')).toBe('966');
    expect(core.callingCode('AED')).toBe('971');
    expect(core.callingCode('KWD')).toBe('965');
    expect(core.callingCode('QAR')).toBe('974');
    expect(core.callingCode('OMR')).toBe('968');
    expect(core.callingCode('BHD')).toBe('973');
    expect(core.callingCode('XXX')).toBe('973');
    expect(core.callingCode(undefined)).toBe('973');
    expect(core.callingCode('sar')).toBe('966');
    expect(core.callingCode('constructor')).toBe('973');
  });

  it('knows how many digits a local mobile number has', () => {
    expect(core.localDigits('SAR')).toBe(9);
    expect(core.localDigits('AED')).toBe(9);
    expect(core.localDigits('BHD')).toBe(8);
    expect(core.localDigits('KWD')).toBe(8);
    expect(core.localDigits(undefined)).toBe(8);
  });

  it('without expiresAt, allows active or trial reported less than 35 days ago', () => {
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: null, updatedAt: at(-34) }, NOW)).toBe(true);
    expect(core.subscriptionAllowed({ status: 'trial', updatedAt: at(-1) }, NOW)).toBe(true);
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: null, updatedAt: at(-36) }, NOW)).toBe(false);
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: null }, NOW)).toBe(false);
    expect(core.subscriptionAllowed({ status: 'none', expiresAt: null, updatedAt: at(-1) }, NOW)).toBe(false);
    expect(core.subscriptionAllowed({ status: 'expired', expiresAt: null, updatedAt: at(-1) }, NOW)).toBe(false);
  });

  it('treats an unreadable expiresAt as missing', () => {
    expect(core.subscriptionAllowed({ status: 'active', expiresAt: 'soon', updatedAt: at(-1) }, NOW)).toBe(true);
    expect(core.subscriptionAllowed({ status: 'none', expiresAt: 'soon', updatedAt: at(-1) }, NOW)).toBe(false);
  });

  it('counts only a current subscription, or staff, for the AI full quota (no grace days)', () => {
    expect(core.aiDemo(null, 'owner', NOW)).toBe(true);
    expect(core.aiDemo({ status: 'active', expiresAt: at(3) }, 'owner', NOW)).toBe(false);
    expect(core.aiDemo({ status: 'active', expiresAt: at(-1) }, 'owner', NOW)).toBe(true);
    expect(core.aiDemo({ status: 'trial', expiresAt: null, updatedAt: at(-2) }, 'owner', NOW)).toBe(false);
    expect(core.aiDemo(null, 'staff', NOW)).toBe(false);
  });
});

describe('access', () => {
  it('gives an owner, or a shop before the first answer, everything', () => {
    for (const m of [null, { role: 'owner', permissions: { orders: false, prepare: false, money: false, products: false } }]) {
      expect(core.access(m)).toEqual({ owner: true, staff: false, orders: true, prepare: true, status: true, money: true, products: true });
    }
  });

  it('gives staff only their permissions; prepare alone changes status', () => {
    expect(core.access({ role: 'staff', permissions: { orders: false, prepare: true, money: false, products: false } }))
      .toEqual({ owner: false, staff: true, orders: false, prepare: true, status: true, money: false, products: false });
    expect(core.access({ role: 'staff', permissions: { orders: true, money: true } }))
      .toEqual({ owner: false, staff: true, orders: true, prepare: false, status: true, money: true, products: false });
    expect(core.access({ role: 'staff' }).status).toBe(false);
  });
});

describe('invoice numbers', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
  };

  it('formats like the phones', () => {
    expect(core.formatInvoice(123, 'A7')).toBe('INV-A7-000123');
    expect(core.formatInvoice(5, '')).toBe('INV-000005');
  });

  it('hands out a per-browser, per-shop sequence', () => {
    const store = memory();
    expect(core.nextInvoice(store, 'shop-1', 'A7')).toEqual({ invoiceNumber: 1, invoiceIdentifier: 'INV-A7-000001' });
    expect(core.nextInvoice(store, 'shop-1', 'A7')).toEqual({ invoiceNumber: 2, invoiceIdentifier: 'INV-A7-000002' });
    expect(core.nextInvoice(store, 'shop-2', 'A7').invoiceNumber).toBe(1);
    expect(store.m.get('orderat.web.invoice.shop-1')).toBe('3');
  });

  it('recovers from a damaged counter and a storage that throws', () => {
    const store = memory();
    store.setItem('orderat.web.invoice.s', 'x');
    expect(core.nextInvoice(store, 's', 'B2').invoiceNumber).toBe(1);
    const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
    expect(core.nextInvoice(broken, 's', 'B2').invoiceIdentifier).toMatch(/^INV-B2-\d{6}$/);
  });

  it('shows the stored identifier, else the number, else nothing', () => {
    expect(core.invoiceLabel({ invoiceIdentifier: 'INV-A7-000017', invoiceNumber: 17 })).toBe('INV-A7-000017');
    expect(core.invoiceLabel({ invoiceNumber: 'INV-B2-000004' })).toBe('INV-B2-000004');
    expect(core.invoiceLabel({ invoiceNumber: 9 })).toBe('INV-000009');
    expect(core.invoiceLabel({ invoiceNumber: null })).toBe('');
  });
});

describe('VAT', () => {
  it('rounds half-up in minor units like VATMath', () => {
    expect(core.vatMinor(11000, 1000, true)).toBe(1000);
    expect(core.vatMinor(10000, 1000, false)).toBe(1000);
    expect(core.vatMinor(15, 1000, false)).toBe(2); // 1.5 → 2
    expect(core.vatMinor(0, 1000, true)).toBe(0);
    expect(core.vatMinor(1000, 0, true)).toBe(0);
  });

  it('knows the currency default rate', () => {
    expect(core.defaultRateBps('BHD')).toBe(1000);
    expect(core.defaultRateBps('SAR')).toBe(1500);
    expect(core.defaultRateBps('KWD')).toBe(0);
  });

  it('snapshots the shop VAT on an order and numbers it once', () => {
    const order = { items: [{ qty: 2, price: 5 }], deliveryFee: 1 };
    let calls = 0;
    const issue = () => { calls++; return { invoiceNumber: 7, invoiceIdentifier: 'INV-A7-000007' }; };
    core.applyVat(order, { enabled: true, rateBps: 1000, pricesInclude: false }, 'BHD', issue);
    expect(order).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 1100, invoiceNumber: 7, invoiceIdentifier: 'INV-A7-000007' });
    order.items[0].qty = 3;
    core.applyVat(order, { enabled: true, rateBps: 1000, pricesInclude: false }, 'BHD', issue);
    expect(order.vatMinor).toBe(1600);
    expect(calls).toBe(1);
  });

  it('uses the currency default when the shop has no rate, and keeps a past snapshot when VAT is off', () => {
    const order = { items: [{ qty: 1, price: 11.5 }], deliveryFee: 0 };
    core.applyVat(order, { enabled: true, rateBps: null, pricesInclude: true }, 'SAR', () => ({}));
    expect(order.vatRateBps).toBe(1500);
    expect(order.vatMinor).toBe(150);
    order.items[0].price = 23;
    core.applyVat(order, { enabled: false, rateBps: 1500, pricesInclude: true }, 'SAR', () => { throw new Error('no'); });
    expect(order).toMatchObject({ vatRateBps: 1500, vatIncluded: true, vatMinor: 300 });
    const plain = { items: [{ qty: 1, price: 2 }], deliveryFee: 0 };
    core.applyVat(plain, { enabled: false }, 'BHD', () => { throw new Error('no'); });
    expect(plain.vatRateBps).toBeUndefined();
  });

  it('totals an order from its own snapshot, like Order.totalMinor', () => {
    expect(core.orderMinor({ items: [{ qty: 2, price: 5, cost: 1 }], deliveryFee: 1, vatIncluded: false, vatMinor: 1100, payments: [{ amount: 3 }] }, 3))
      .toEqual({ itemsAndDelivery: 11000, vat: 1100, total: 12100, paid: 3000, cost: 2000, due: 9100 });
    expect(core.orderMinor({ items: [{ qty: 1, price: 11 }], deliveryFee: 0, vatIncluded: true, vatMinor: 1000, payments: [] }, 3))
      .toMatchObject({ vat: 1000, total: 11000 });
    expect(core.orderMinor({ items: [{ qty: 1, price: 1.25 }], deliveryFee: 0, payments: [] }, 2)).toMatchObject({ vat: 0, total: 125 });
  });
});

describe('stock', () => {
  const ids = () => { let n = 0; return () => `m${++n}`; };
  const products = () => [
    { id: 'p1', track: true, qty: 5, stockMoves: [] },
    { id: 'p2', track: false, qty: 0 },
    { id: 'p3', track: true, qty: 1, stockMoves: Array.from({ length: 50 }, (_, i) => ({ id: `old${i}` })) },
  ];
  const items = [{ pid: 'p1', qty: 2 }, { pid: 'p2', qty: 1 }, { pid: 'p3', qty: 1 }, { pid: null, qty: 4 }];
  const at = NOW.toISOString();

  it('deducts on crossing into confirmed or later, with an orderConfirmed move first', () => {
    const ps = products();
    const changed = core.stockForStatus(ps, { id: 'o1', items }, 'new', 'confirmed', at, ids());
    expect(changed.map(p => p.id)).toEqual(['p1', 'p3']);
    expect(ps[0].qty).toBe(3);
    expect(ps[0].stockMoves[0]).toEqual({ id: 'm1', delta: -2, reason: 'orderConfirmed', orderId: 'o1', note: null, at });
    expect(ps[1].qty).toBe(0);
    expect(ps[2].qty).toBe(0);
    expect(ps[2].stockMoves).toHaveLength(50);
    expect(ps[2].stockMoves[0].reason).toBe('orderConfirmed');
    expect(ps[2].stockMoves[49].id).toBe('old48');
  });

  it('restores on cancel from a deducted status, and does nothing between two deducted or two open statuses', () => {
    const ps = products();
    core.stockForStatus(ps, { id: 'o1', items }, 'ready', 'cancelled', at, ids());
    expect(ps[0].qty).toBe(7);
    expect(ps[0].stockMoves[0]).toMatchObject({ delta: 2, reason: 'orderCancelled' });
    expect(core.stockForStatus(products(), { id: 'o1', items }, 'confirmed', 'ready', at, ids())).toEqual([]);
    expect(core.stockForStatus(products(), { id: 'o1', items }, 'new', 'cancelled', at, ids())).toEqual([]);
  });

  it('moves the difference when a deducted order is edited', () => {
    const ps = products();
    const changed = core.stockForEdit(ps, [{ pid: 'p1', qty: 2 }, { pid: 'p3', qty: 1 }], [{ pid: 'p1', qty: 3 }, { pid: 'p2', qty: 5 }], 'o9', at, ids());
    expect(changed.map(p => p.id).sort()).toEqual(['p1', 'p3']);
    expect(ps[0]).toMatchObject({ qty: 4 });
    expect(ps[0].stockMoves[0]).toMatchObject({ delta: -1, reason: 'orderEdited', orderId: 'o9' });
    expect(ps[2]).toMatchObject({ qty: 2 });
  });
});

describe('order numbers and history', () => {
  it('numbers orders by createdAt, then id', () => {
    const nos = core.orderNumbers([
      { id: 'b', createdAt: '2026-09-02T00:00:00.000Z' },
      { id: 'a', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-09-02T00:00:00.000Z' },
      { id: 'd', createdAt: '' },
    ]);
    expect([nos.get('a'), nos.get('b'), nos.get('c'), nos.get('d')]).toEqual([2, 3, 4, 1]);
  });

  it('labels the phones\' history kinds and keeps the demo shapes', () => {
    expect(core.historyLabel({ kind: 'created' })).toEqual({ key: 'history.created' });
    expect(core.historyLabel({ kind: 'items' })).toEqual({ key: 'history.itemsEdited' });
    expect(core.historyLabel({ kind: 'status', value: 'ready' })).toEqual({ key: 'history.status', status: 'ready' });
    expect(core.historyLabel({ kind: 'payment', value: 2.5 })).toEqual({ key: 'history.payment', amount: 2.5 });
    expect(core.historyLabel({ kind: 'payment', _c: { field: 'paymentStatus', newValue: 'paid' } })).toEqual({ key: 'history.paymentStatus', payment: 'paid' });
    expect(core.historyLabel({ kind: 'payment', _c: { newValue: 'weird' } })).toEqual({ key: 'history.paymentChanged' });
    expect(core.historyLabel({ kind: 'other' })).toEqual({ key: 'history.other' });
    expect(core.historyLabel({ kind: 'status', value: 'other' })).toEqual({ key: 'history.other' });
  });
});

describe('items editor', () => {
  const products = [{ id: 'p1', nameAr: 'كيك', nameEn: 'Cake', price: 6, cost: 2 }];
  it('keeps item ids, the line cost while the product is unchanged, and drops empty lines', () => {
    const out = core.cleanItems([
      { id: 'i1', pid: 'p1', origPid: 'p1', name: '', qty: 2, price: '6.5', cost: 1.5 },
      { id: 'i2', pid: 'p1', origPid: null, name: 'x', qty: 1, price: 6, cost: 0 },
      { pid: 'custom', name: ' Box ', qty: 1, price: '2' },
      { pid: 'custom', name: '  ', qty: 1, price: 1 },
      { pid: 'p1', name: '', qty: 0, price: 1 },
    ], products);
    expect(out).toEqual([
      { id: 'i1', pid: 'p1', nameAr: 'كيك', nameEn: 'Cake', qty: 2, price: 6.5, cost: 1.5 },
      { id: 'i2', pid: 'p1', nameAr: 'كيك', nameEn: 'Cake', qty: 1, price: 6, cost: 2 },
      { pid: null, nameAr: 'Box', nameEn: 'Box', qty: 1, price: 2, cost: 0 },
    ]);
    expect(Object.keys(out[2])).not.toContain('id');
  });
});

describe('AI order entry', () => {
  const products = [
    { id: 'p1', nameAr: 'كيك', nameEn: 'Cake', aliases: ['cake', ''], price: 6, active: true },
    { id: 'p2', nameAr: 'كوكيز', nameEn: '', aliases: [], price: 3, active: true },
    { id: 'p3', nameAr: 'قديم', nameEn: 'Old', aliases: [], price: 1, active: false },
  ];

  it('sends the active products in the server shape', () => {
    expect(core.parseProducts(products)).toEqual([
      { id: 'p1', name: 'Cake', nameAr: 'كيك', aliases: ['cake'] },
      { id: 'p2', name: 'كوكيز', nameAr: 'كوكيز', aliases: [] },
    ]);
  });

  it('turns a draft into the new-order form fields', () => {
    const d = core.draftFields({
      customerName: 'Sara', items: [{ productId: 'p1', rawText: '2 cakes', quantity: 2 }, { rawText: 'balloons' }, { productId: 'zz', rawText: 'x', quantity: 1 }],
      collectionAt: '2026-09-30T14:00:00.000Z', notes: 'no nuts',
    }, products);
    expect(d).toEqual({
      name: 'Sara', due: '2026-09-30T17:00', notes: 'no nuts',
      items: [{ pid: 'p1', name: '', qty: 2, price: 6 }, { pid: 'custom', name: 'balloons', qty: 1, price: 0 }, { pid: 'custom', name: 'x', qty: 1, price: 0 }],
    });
    expect(core.draftFields({ items: [] }, products)).toEqual({ items: [] });
  });
});

describe('Ask Orderat snapshot', () => {
  const at = (days, h = 12) => { const d = new Date(2026, 8, 29 + days, h, 0); return d.toISOString(); };
  const state = () => ({
    shop: { nameAr: 'حلويات', nameEn: 'Sweets', currency: 'BHD', businessType: 'foodTruck', dailyCapacity: 20 },
    customers: [
      { id: 'c-a', name: 'Sara Ali', phone: '+97333', notes: 'secret' },
      { id: 'c-b', name: 'Noora', phone: '+97344' },
    ],
    products: [],
    orders: [
      { id: 'o1', customerId: 'c-a', status: 'collected', dueAt: at(-1), items: [{ nameAr: 'كيك', qty: 2, price: 5, cost: 2 }], deliveryFee: 0, payments: [{ amount: 10 }] },
      { id: 'o2', customerId: 'c-b', status: 'confirmed', dueAt: at(1, 17), items: [{ nameAr: 'كيك', qty: 1, price: 5, cost: 2 }, { nameAr: 'كوكيز', qty: 3, price: 1, cost: 0.5 }], deliveryFee: 1, payments: [], vatIncluded: false, vatMinor: 900 },
      { id: 'o3', customerId: 'c-a', status: 'cancelled', dueAt: at(0), items: [{ nameAr: 'كيك', qty: 9, price: 5 }], deliveryFee: 0, payments: [] },
    ],
    expenses: [{ id: 'e1', amount: 1.5, category: 'packaging', date: at(0) }, { id: 'e2', amount: 4, category: 'ingredients', date: at(-40) }],
    occasions: [{ id: 'x', nameAr: 'العيد', nameEn: 'Eid', start: '2026-10-02', end: '2026-10-03', cap: 30 }, { id: 'y', nameAr: 'قديم', start: '2026-09-01', end: '2026-09-02' }],
  });

  it('builds the phones\' snapshot with the same keys and refs', () => {
    const { snapshot, refs } = core.buildAskSnapshot(state(), { now: NOW, lang: 'en' });
    expect(Object.keys(snapshot)).toEqual(['today', 'shopName', 'currency', 'businessType', 'periods', 'topProducts', 'topCustomers', 'unpaid', 'upcoming', 'prepTomorrow', 'expensesThisMonth', 'occasions', 'capacity']);
    expect(snapshot.today).toBe('2026-09-29');
    expect(snapshot.shopName).toBe('Sweets');
    expect(snapshot.businessType).toBe('food_truck');
    expect(snapshot.periods.thisWeek).toEqual({ revenueMinor: 10000, expensesMinor: 1500, profitMinor: 10000 - 4000 - 1500, orders: 1, items: 2 });
    expect(snapshot.periods.thisMonth.orders).toBe(2);
    // Top lists run up to the start of tomorrow, so tomorrow's order o2 is not in them.
    expect(snapshot.topProducts).toEqual([{ name: 'كيك', qty: 2, revenueMinor: 10000 }]);
    expect(snapshot.topCustomers).toEqual([{ ref: 'c1', firstName: 'Sara', orders: 1, revenueMinor: 10000 }]);
    expect(snapshot.unpaid).toEqual([{ ref: 'c2', firstName: 'Noora', orderRef: 'o1', amountMinor: 9900, dueDate: '2026-09-30' }]);
    expect(snapshot.upcoming).toEqual([{ orderRef: 'o1', date: '2026-09-30', time: '17:00', firstName: 'Noora', items: '1 x كيك, 3 x كوكيز', totalMinor: 9900, status: 'confirmed' }]);
    expect(snapshot.prepTomorrow).toEqual([{ name: 'كوكيز', qty: 3 }, { name: 'كيك', qty: 1 }]);
    expect(snapshot.expensesThisMonth).toEqual([{ category: 'packaging', amountMinor: 1500 }]);
    expect(snapshot.occasions).toEqual([{ name: 'Eid', daysUntil: 3 }]);
    expect(snapshot.capacity).toEqual({ daily: 20, tomorrowUsed: 4 });
    expect(refs).toEqual({ customers: { c1: 'c-a', c2: 'c-b' }, orders: { o1: 'o2' } });
    expect(JSON.stringify(snapshot)).not.toMatch(/\+973|secret/);
  });

  it('uses an occasion capacity override and leaves capacity out without one', () => {
    const s = state();
    s.occasions[0].start = '2026-09-30';
    expect(core.buildAskSnapshot(s, { now: NOW, lang: 'ar' }).snapshot.capacity).toEqual({ daily: 30, tomorrowUsed: 4 });
    s.occasions = [];
    s.shop.dailyCapacity = null;
    const r = core.buildAskSnapshot(s, { now: NOW, lang: 'ar' });
    expect(r.snapshot.capacity).toBeNull();
    expect(r.snapshot.shopName).toBe('حلويات');
  });

  it('maps the web status "new" to the phones\' newOrder', () => {
    const s = state();
    s.orders[1].status = 'new';
    expect(core.buildAskSnapshot(s, { now: NOW, lang: 'en' }).snapshot.upcoming[0].status).toBe('newOrder');
  });
});

describe('leaving a shop', () => {
  const guard = (over = {}) => core.flushBeforeLeaving(Object.assign({ flush: async () => true, stillHere: () => true, pending: () => 0, confirm: () => false }, over));

  it('sends the last edits first, and goes on when nothing is left unsent', async () => {
    const order = [];
    await expect(guard({ flush: async () => { order.push('flush'); }, pending: () => { order.push('pending'); return 0; } })).resolves.toBe(true);
    expect(order).toEqual(['flush', 'pending']);
  });

  it('asks before dropping unsent changes, and stays when the seller says no', async () => {
    const confirm = vi.fn(() => false);
    await expect(guard({ pending: () => 2, confirm })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(guard({ pending: () => 2, confirm: () => true })).resolves.toBe(true);
  });

  it('does not go on when the shop was left meanwhile (signed out while sending)', async () => {
    await expect(guard({ stillHere: () => false, confirm: () => true })).resolves.toBe(false);
  });
});

describe('member permission editor', () => {
  function deferredSend() {
    const calls = [];
    const send = vi.fn((userId, body) => new Promise((resolve, reject) => calls.push({ userId, body, resolve, reject })));
    return { send, calls };
  }
  const start = { orders: true, prepare: false, money: true, products: false };

  it('two quick toggles never send back a permission the first one revoked', async () => {
    const { send, calls } = deferredSend();
    const ed = core.createPermissionEditor(send);
    const first = ed.toggle('u1', start, 'orders', false);
    const second = ed.toggle('u1', start, 'money', false); // before the first answer
    expect(ed.current('u1')).toEqual({ orders: false, prepare: false, money: false, products: false });
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(1); // one request at a time per member
    expect(calls[0].body).toMatchObject({ orders: false });
    calls[0].resolve();
    await first;
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ orders: false, prepare: false, money: false, products: false });
    calls[1].resolve();
    await expect(second).resolves.toEqual({ ok: true, permissions: { orders: false, prepare: false, money: false, products: false } });
    expect(ed.current('u1')).toBeUndefined(); // idle again: the next toggle starts from the member's row
  });

  it('a failed request puts only its own key back, and the next request does not carry it', async () => {
    const { send, calls } = deferredSend();
    const ed = core.createPermissionEditor(send);
    const first = ed.toggle('u1', start, 'orders', false);
    const second = ed.toggle('u1', start, 'products', true);
    await Promise.resolve(); await Promise.resolve();
    calls[0].reject(new Error('offline'));
    await expect(first).resolves.toMatchObject({ ok: false });
    await Promise.resolve(); await Promise.resolve();
    expect(calls[1].body).toEqual({ orders: true, prepare: false, money: true, products: true });
    calls[1].resolve();
    await expect(second).resolves.toEqual({ ok: true, permissions: { orders: true, prepare: false, money: true, products: true } });
  });

  it('keeps members apart', async () => {
    const { send, calls } = deferredSend();
    const ed = core.createPermissionEditor(send);
    ed.toggle('u1', start, 'orders', false);
    ed.toggle('u2', start, 'money', false);
    await Promise.resolve(); await Promise.resolve();
    expect(calls.map(c => [c.userId, c.body.orders, c.body.money])).toEqual([['u1', false, true], ['u2', true, false]]);
  });
});

describe('who may move stock for an order', () => {
  const can = granted => k => granted.includes(k);
  it('products, or staff who handle orders (orders or prepare)', () => {
    expect(core.canMoveOrderStock(can(['products']))).toBe(true);
    expect(core.canMoveOrderStock(can(['orders']))).toBe(true);
    expect(core.canMoveOrderStock(can(['prepare']))).toBe(true);
    expect(core.canMoveOrderStock(can(['money']))).toBe(false);
    expect(core.canMoveOrderStock(can([]))).toBe(false);
  });
});
