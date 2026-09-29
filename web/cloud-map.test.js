// public/orderat/cloud-map.js: canonical cloud records (docs/sme-phase-2-cloud.md "Record formats", as the
// iPhone and Android apps write them) ⇄ the web app's model (public/orderat/demo.js makeDemoData).
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const load = createRequire(import.meta.url);
const map = load('../public/orderat/cloud-map.js');

const NOW = new Date('2026-09-29T08:00:00.000Z');
const LATER = new Date('2026-09-29T09:30:00.000Z');
const BHD = { decimals: 3, now: NOW, deviceCode: 'A7' };
const SAR = { decimals: 2, now: NOW, deviceCode: 'A7' };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const anId = () => expect.stringMatching(UUID_V4);

const SHOP_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PRODUCT_ID = 'c3a8e2f4-1b5d-4e6f-a7b8-9c0d1e2f3a4b';
const OTHER_PRODUCT_ID = 'd4b9f3a5-2c6e-4f70-b8c9-0d1e2f3a4b5c';
const CUSTOMER_ID = '5d0e7a61-8b2c-4f3d-9a1e-6c7b8d9e0f12';
const ORDER_ID = '0b6c1f9e-2d3a-4c5b-8e7f-1a2b3c4d5e6f';
const EXPENSE_ID = '7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b';
const OCCASION_ID = '2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c';
const ITEM_1 = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const ITEM_2 = 'f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c';
const PAY_1 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CH_1 = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const CH_2 = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f';
const CH_3 = 'd3e4f5a6-b7c8-4d9e-8f0a-2b3c4d5e6f7a';

// Deep-freezes a fixture: the mapper must never write to a raw record (strict mode makes that throw).
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

// cloud → web → cloud, with the fixture as the last raw record.
const roundTrip = (entity, id, raw, ctx) => map[`${entity}ToCloud`](map[`${entity}ToWeb`](id, raw, ctx), raw, ctx);

afterEach(() => vi.unstubAllGlobals());

describe('money, ids and entity order', () => {
  it('knows each currency\'s decimals and falls back to BHD like the phones', () => {
    expect(['BHD', 'KWD', 'OMR', 'SAR', 'AED', 'QAR'].map(map.decimalsFor)).toEqual([3, 3, 3, 2, 2, 2]);
    expect(map.decimalsFor('USD')).toBe(3);
    expect(map.decimalsFor(undefined)).toBe(3);
  });

  it('converts BHD 12.345 ⇄ 12345 and SAR 9.99 ⇄ 999', () => {
    expect(map.toMinor(12.345, 3)).toBe(12345);
    expect(map.fromMinor(12345, 3)).toBe(12.345);
    expect(map.toMinor(9.99, 2)).toBe(999);
    expect(map.fromMinor(999, 2)).toBe(9.99);
  });

  it('rounds to a whole minor unit the way the typed amount reads, never to -0', () => {
    expect(map.toMinor(1.005, 2)).toBe(101);
    expect(map.toMinor(0.1 + 0.2, 2)).toBe(30);
    expect(map.toMinor(4.35, 3)).toBe(4350);
    expect(map.toMinor('6.5', 3)).toBe(6500);
    expect(map.toMinor('', 3)).toBe(0);
    expect(Object.is(map.toMinor(-0.0001, 3), 0)).toBe(true);
  });

  it('makes lowercase v4 UUIDs, also without crypto.randomUUID (plain http pages)', () => {
    const ids = new Set(Array.from({ length: 50 }, map.newId));
    expect(ids.size).toBe(50);
    ids.forEach(id => expect(id).toMatch(UUID_V4));
    vi.stubGlobal('crypto', { getRandomValues: a => a.fill(171) });
    expect(map.newId()).toMatch(UUID_V4);
    vi.stubGlobal('crypto', undefined);
    expect(map.newId()).toMatch(UUID_V4);
  });

  it('lists the entities in push order', () => {
    expect(map.ENTITY_ORDER).toEqual(['shop', 'customer', 'product', 'occasion', 'order', 'expense', 'setting']);
  });
});

describe('shop', () => {
  const shopRecord = () => frozen({
    nameAr: 'حلويات أم أحمد', nameEn: 'Umm Ahmed Sweets', phone: '+97336005005', currencyCode: 'BHD',
    pickupHours: '4:00 PM - 8:00 PM', dailyCapacity: 35, businessType: 'home',
    vat: { enabled: true, trn: '220012345600003', rateBps: 1000, pricesIncludeVat: true },
    stock: { enabled: true, defaultLowStockThreshold: 5 },
    createdAt: '2026-01-10T08:30:00.000Z', futureField: 1,
  });

  it('reads the record into shop, vat and stockEnabled', () => {
    expect(map.shopToWeb(SHOP_ID, shopRecord())).toEqual({
      shop: { nameAr: 'حلويات أم أحمد', nameEn: 'Umm Ahmed Sweets', phone: '+97336005005', currency: 'BHD', pickupHours: '4:00 PM - 8:00 PM', dailyCapacity: 35, businessType: 'home' },
      vat: { enabled: true, trn: '220012345600003', pricesInclude: true },
      stockEnabled: true,
    });
  });

  it('round-trips unchanged', () => {
    expect(roundTrip('shop', SHOP_ID, shopRecord(), BHD)).toStrictEqual(shopRecord());
  });

  it('round-trips an Android record with nulls, and one missing optional keys, exactly', () => {
    const android = frozen({ nameAr: 'عربة زاد', nameEn: null, phone: '+97336005009', currencyCode: 'SAR', pickupHours: null, dailyCapacity: null, businessType: 'food_truck', vat: { enabled: false, trn: null, rateBps: 0, pricesIncludeVat: true }, stock: { enabled: false, defaultLowStockThreshold: null }, createdAt: '2026-03-01T06:00:00.000Z' });
    expect(roundTrip('shop', SHOP_ID, android, SAR)).toStrictEqual(android);
    const sparse = frozen({ nameAr: 'عربة زاد', phone: '+97336005009', createdAt: '2026-03-01T06:00:00.000Z' });
    expect(map.shopToWeb(SHOP_ID, sparse)).toEqual({
      shop: { nameAr: 'عربة زاد', nameEn: '', phone: '+97336005009', currency: 'BHD', pickupHours: '', dailyCapacity: null, businessType: 'home' },
      vat: { enabled: false, trn: '', pricesInclude: true },
      stockEnabled: false,
    });
    expect(roundTrip('shop', SHOP_ID, sparse, BHD)).toStrictEqual(sparse);
  });

  it('writes web edits and keeps vat.rateBps, stock.defaultLowStockThreshold, createdAt and unknown fields', () => {
    const raw = shopRecord();
    const web = map.shopToWeb(SHOP_ID, raw);
    web.shop.nameEn = 'Umm Ahmed Bakery';
    web.shop.pickupHours = '';
    web.vat.pricesInclude = false;
    web.stockEnabled = false;
    expect(map.shopToCloud(web, raw, BHD)).toStrictEqual({
      ...raw, nameEn: 'Umm Ahmed Bakery', pickupHours: null,
      vat: { enabled: true, trn: '220012345600003', rateBps: 1000, pricesIncludeVat: false },
      stock: { enabled: false, defaultLowStockThreshold: 5 },
    });
  });

  it('maps food_truck ⇄ foodTruck and keeps a business type it does not know', () => {
    expect(map.shopToWeb(SHOP_ID, { businessType: 'food_truck' }).shop.businessType).toBe('foodTruck');
    const web = map.shopToWeb(SHOP_ID, shopRecord());
    web.shop.businessType = 'foodTruck';
    expect(map.shopToCloud(web, shopRecord(), BHD).businessType).toBe('food_truck');

    const salon = frozen({ ...shopRecord(), businessType: 'salon' });
    const shown = map.shopToWeb(SHOP_ID, salon);
    expect(shown.shop.businessType).toBe('other');
    shown.shop.phone = '+97336005099';
    expect(map.shopToCloud(shown, salon, BHD)).toStrictEqual({ ...salon, phone: '+97336005099' });
  });

  it('treats a daily capacity cleared in the form (0) as no limit', () => {
    const raw = frozen({ ...shopRecord(), dailyCapacity: null });
    const web = map.shopToWeb(SHOP_ID, raw);
    web.shop.dailyCapacity = 0; // the shop form writes +'' || 0
    expect(map.shopToCloud(web, raw, BHD)).toStrictEqual(raw);
    const set = map.shopToWeb(SHOP_ID, shopRecord());
    set.shop.dailyCapacity = 0;
    expect(map.shopToCloud(set, shopRecord(), BHD).dailyCapacity).toBeNull();
  });

  it('builds a new shop record with createdAt = now', () => {
    const web = {
      shop: { nameAr: 'عربة زاد', nameEn: '', phone: '+97336005009', currency: 'SAR', pickupHours: '', dailyCapacity: 0, businessType: 'foodTruck' },
      vat: { enabled: true, trn: '300012345600003', pricesInclude: false }, stockEnabled: true,
    };
    expect(map.shopToCloud(web, undefined, SAR)).toStrictEqual({
      nameAr: 'عربة زاد', nameEn: null, phone: '+97336005009', currencyCode: 'SAR', pickupHours: null, dailyCapacity: null, businessType: 'food_truck',
      vat: { enabled: true, trn: '300012345600003', pricesIncludeVat: false }, stock: { enabled: true },
      createdAt: NOW.toISOString(),
    });
  });
});

describe('product', () => {
  const productRecord = () => frozen({
    nameAr: 'كيك إسفنجي بالفانيليا', nameEn: 'Vanilla Sponge Cake', aliases: ['كيك فانيليا', 'vanilla cake'],
    priceMinor: 6500, costMinor: 2500, dailyCapacity: 6, active: true, photoId: '3f5a9c2e7b1d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a',
    trackStock: true, stockQuantity: 14, lowStockThreshold: 4,
    stockMoves: [
      { id: 'aa11bb22-cc33-4d44-8e55-ff6677889900', delta: -2, reason: 'orderConfirmed', orderId: ORDER_ID, note: null, at: '2026-09-28T10:05:00.000Z' },
      { id: 'bb22cc33-dd44-4e55-9f66-00778899aabb', delta: 20, reason: 'received', orderId: null, note: 'Weekly batch', at: '2026-09-27T06:00:00.000Z' },
    ],
    createdAt: '2026-02-01T09:00:00.000Z', futureField: 1,
  });

  it('reads money in major units and the stock fields by their web names', () => {
    expect(map.productToWeb(PRODUCT_ID, productRecord(), BHD)).toEqual({
      id: PRODUCT_ID, nameAr: 'كيك إسفنجي بالفانيليا', nameEn: 'Vanilla Sponge Cake', aliases: ['كيك فانيليا', 'vanilla cake'],
      price: 6.5, cost: 2.5, cap: 6, active: true, track: true, qty: 14, low: 4,
      photoId: '3f5a9c2e7b1d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a',
    });
  });

  it('round-trips unchanged, also an Android record without aliases or photoId', () => {
    expect(roundTrip('product', PRODUCT_ID, productRecord(), BHD)).toStrictEqual(productRecord());
    const android = frozen({ nameAr: 'كرك حليب', nameEn: null, priceMinor: 300, costMinor: 100, dailyCapacity: null, active: true, trackStock: false, stockQuantity: null, lowStockThreshold: null, stockMoves: [], createdAt: '2026-03-01T06:00:00.000Z' });
    expect(roundTrip('product', PRODUCT_ID, android, BHD)).toStrictEqual(android);
  });

  it('writes a form edit and keeps stockMoves, photoId, createdAt and unknown fields', () => {
    const raw = productRecord();
    const web = map.productToWeb(PRODUCT_ID, raw, BHD);
    Object.assign(web, { price: 7.25, cap: null, qty: 10 }); // what FORMS.product assigns
    web.aliases.push('sponge'); // the web gets its own copy of the list
    expect(map.productToCloud(web, raw, BHD)).toStrictEqual({ ...raw, priceMinor: 7250, dailyCapacity: null, stockQuantity: 10, aliases: ['كيك فانيليا', 'vanilla cake', 'sponge'] });
  });

  it('keeps photoId unless the web changes it', () => {
    const raw = productRecord();
    const web = map.productToWeb(PRODUCT_ID, raw, BHD);
    delete web.photoId;
    expect(map.productToCloud(web, raw, BHD).photoId).toBe(raw.photoId);
    web.photoId = 'new-sha256';
    expect(map.productToCloud(web, raw, BHD).photoId).toBe('new-sha256');
  });

  it('builds a new product in the shop currency (SAR 9.99 → 999) with no stock moves', () => {
    const web = { id: PRODUCT_ID, nameAr: 'كرك', nameEn: 'Karak', aliases: [], price: 9.99, cost: 0.5, cap: null, active: true, track: false, qty: 0, low: 3 };
    expect(map.productToCloud(web, undefined, SAR)).toStrictEqual({
      nameAr: 'كرك', nameEn: 'Karak', aliases: [], priceMinor: 999, costMinor: 50, dailyCapacity: null, active: true,
      trackStock: false, stockQuantity: 0, lowStockThreshold: 3, photoId: null, stockMoves: [], createdAt: NOW.toISOString(),
    });
  });
});

describe('customer', () => {
  const customerRecord = () => frozen({ name: 'فاطمة العلي', phone: '+97333001001', area: 'muharraq', notes: 'Prefers evening delivery', createdAt: '2026-04-02T12:00:00.000Z', futureField: 1 });

  it('reads the record, with the web-only English name empty for a phone customer', () => {
    expect(map.customerToWeb(CUSTOMER_ID, customerRecord())).toEqual({ id: CUSTOMER_ID, name: 'فاطمة العلي', nameEn: '', phone: '+97333001001', area: 'muharraq', notes: 'Prefers evening delivery' });
  });

  it('round-trips unchanged, also with null or missing area and notes', () => {
    expect(roundTrip('customer', CUSTOMER_ID, customerRecord(), BHD)).toStrictEqual(customerRecord());
    const nulls = frozen({ name: 'نورة أحمد', phone: '+97333001002', area: null, notes: null, createdAt: '2026-04-02T12:00:00.000Z' });
    expect(roundTrip('customer', CUSTOMER_ID, nulls, BHD)).toStrictEqual(nulls);
    const sparse = frozen({ name: 'نورة أحمد', phone: '+97333001002', createdAt: '2026-04-02T12:00:00.000Z' });
    expect(roundTrip('customer', CUSTOMER_ID, sparse, BHD)).toStrictEqual(sparse);
  });

  it('writes edits, keeps the web-only nameEn in the record, and keeps unknown fields', () => {
    const raw = customerRecord();
    const web = map.customerToWeb(CUSTOMER_ID, raw);
    Object.assign(web, { nameEn: 'Fatima Al-Ali', area: 'riffa', notes: '' });
    const out = map.customerToCloud(web, raw, BHD);
    expect(out).toStrictEqual({ ...raw, nameEn: 'Fatima Al-Ali', area: 'riffa', notes: null });
    expect(map.customerToWeb(CUSTOMER_ID, out).nameEn).toBe('Fatima Al-Ali');
    const renamed = map.customerToWeb(CUSTOMER_ID, out);
    Object.assign(renamed, { name: 'فاطمة', nameEn: '' }); // FORMS.customer clears nameEn on a rename
    expect(map.customerToCloud(renamed, out, BHD)).not.toHaveProperty('nameEn');
  });

  it('shows an area it does not know as other and keeps it', () => {
    const raw = frozen({ ...customerRecord(), area: 'zallaq' });
    const web = map.customerToWeb(CUSTOMER_ID, raw);
    expect(web.area).toBe('other');
    web.phone = '+97333001111';
    expect(map.customerToCloud(web, raw, BHD)).toStrictEqual({ ...raw, phone: '+97333001111' });
  });

  it('builds a new customer with createdAt = now', () => {
    expect(map.customerToCloud({ id: CUSTOMER_ID, name: 'ريم سعيد', nameEn: '', phone: '+97333001099', area: '', notes: '' }, undefined, BHD))
      .toStrictEqual({ name: 'ريم سعيد', phone: '+97333001099', area: null, notes: null, createdAt: NOW.toISOString() });
  });
});

describe('order', () => {
  // As the iPhone writes it (CloudRecordMapping.orderPatch): every key, explicit nulls, invoiceIdentifier.
  // Total 2 × 6.500 + 3.000 + 1.000 delivery = 17.000 BHD, 5.000 paid: a deposit.
  const orderRecord = () => frozen({
    customerId: CUSTOMER_ID, status: 'newOrder', fulfillmentType: 'delivery', dueAt: '2026-09-30T14:00:00.000Z',
    address: { area: 'riffa', block: '935', road: '3510', building: '12', notes: 'Blue gate' },
    deliveryFeeMinor: 1000, paymentStatus: 'deposit',
    items: [
      { id: ITEM_1, productId: PRODUCT_ID, nameSnapshot: 'كيك إسفنجي بالفانيليا', quantity: 2, unitPriceMinor: 6500, unitCostMinor: 2500 },
      { id: ITEM_2, productId: null, nameSnapshot: 'Custom gift box', quantity: 1, unitPriceMinor: 3000, unitCostMinor: 0 },
    ],
    payments: [{ id: PAY_1, amountMinor: 5000, method: 'benefit', note: 'Deposit', paidAt: '2026-09-28T10:00:00.000Z' }],
    changes: [
      { id: CH_1, field: 'order', oldValue: null, newValue: 'created', note: null, at: '2026-09-28T09:59:00.000Z' },
      { id: CH_2, field: 'paymentStatus', oldValue: 'unpaid', newValue: 'deposit', note: null, at: '2026-09-28T10:00:00.000Z' },
    ],
    notes: 'Write "Happy birthday" on top', vatRateBps: 1000, vatIncluded: true, vatMinor: 1545,
    invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017',
    createdAt: '2026-09-28T09:59:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z', futureField: 1,
  });

  // As the Android app writes it (order_mapper.dart): invoiceNumber is the formatted string, no invoiceIdentifier.
  const androidRecord = () => frozen({
    customerId: CUSTOMER_ID, status: 'confirmed', fulfillmentType: 'pickup', dueAt: '2026-10-01T09:30:00.000Z',
    address: { area: null, block: null, road: null, building: null, notes: null }, deliveryFeeMinor: 0, paymentStatus: 'unpaid',
    items: [{ id: ITEM_1, productId: PRODUCT_ID, nameSnapshot: 'Karak Tea', quantity: 3, unitPriceMinor: 300, unitCostMinor: 100 }],
    payments: [], changes: [{ id: CH_1, field: 'order', oldValue: null, newValue: 'created', note: null, at: '2026-09-30T18:00:00.000Z' }],
    notes: null, vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: 'INV-B2-000004',
    createdAt: '2026-09-30T18:00:00.000Z', updatedAt: '2026-09-30T18:00:00.000Z',
  });

  // What FORMS['new-order'] in app.js pushes: no ids on items/payments, the web's own history shape.
  const newWebOrder = () => ({
    id: ORDER_ID, no: 41, customerId: CUSTOMER_ID, dueAt: '2026-10-02T15:00:00.000Z',
    items: [
      { pid: PRODUCT_ID, nameAr: 'كيك إسفنجي بالفانيليا', nameEn: 'Vanilla Sponge Cake', qty: 1, price: 6.5, cost: 2.5 },
      { pid: null, nameAr: 'Candles', nameEn: 'Candles', qty: 2, price: 0.25, cost: 0.1 },
    ],
    fulfillment: 'delivery', area: 'muharraq', deliveryFee: 1, source: 'whatsapp',
    payments: [{ amount: 2, method: 'benefit', note: '', at: '2026-09-29T07:59:00.000Z' }], notes: '',
    changes: [{ kind: 'created', at: '2026-09-29T07:59:00.000Z' }, { kind: 'payment', value: 2, at: '2026-09-29T07:59:00.000Z' }],
    status: 'new', stockApplied: false,
  });

  it('reads the record into the web order (status new, names from nameSnapshot, history in the web shape)', () => {
    const raw = orderRecord();
    expect(map.orderToWeb(ORDER_ID, raw, BHD)).toEqual({
      id: ORDER_ID, customerId: CUSTOMER_ID, dueAt: '2026-09-30T14:00:00.000Z',
      items: [
        { id: ITEM_1, pid: PRODUCT_ID, nameAr: 'كيك إسفنجي بالفانيليا', nameEn: 'كيك إسفنجي بالفانيليا', qty: 2, price: 6.5, cost: 2.5 },
        { id: ITEM_2, pid: null, nameAr: 'Custom gift box', nameEn: 'Custom gift box', qty: 1, price: 3, cost: 0 },
      ],
      fulfillment: 'delivery', area: 'riffa', deliveryFee: 1, source: 'manual',
      payments: [{ id: PAY_1, amount: 5, method: 'benefit', note: 'Deposit', at: '2026-09-28T10:00:00.000Z' }],
      notes: 'Write "Happy birthday" on top',
      changes: [
        { kind: 'created', at: '2026-09-28T09:59:00.000Z', _c: raw.changes[0] },
        { kind: 'payment', at: '2026-09-28T10:00:00.000Z', _c: raw.changes[1] },
      ],
      status: 'new', stockApplied: false, createdAt: '2026-09-28T09:59:00.000Z',
      vatRateBps: 1000, vatIncluded: true, vatMinor: 1545, invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017',
    });
  });

  it('maps every history field for display and marks stock as applied once confirmed', () => {
    const changes = [
      { id: 'h1', field: 'order', newValue: 'created', at: '2026-09-28T09:00:00.000Z' },
      { id: 'h2', field: 'status', oldValue: 'newOrder', newValue: 'confirmed', at: '2026-09-28T09:01:00.000Z' },
      { id: 'h3', field: 'items', oldValue: null, newValue: 'edited', note: null, at: '2026-09-28T09:02:00.000Z' },
      { id: 'h4', field: 'paymentStatus', oldValue: 'unpaid', newValue: 'paid', at: '2026-09-28T09:03:00.000Z' },
      { id: 'h5', field: 'dueAt', oldValue: 'a', newValue: 'b', at: '2026-09-28T09:04:00.000Z' },
      { id: 'h6', field: 'status', oldValue: 'confirmed', newValue: 'newOrder', at: '2026-09-28T09:05:00.000Z' },
    ];
    const web = map.orderToWeb(ORDER_ID, frozen({ ...orderRecord(), status: 'ready', changes }), BHD);
    expect(web.changes.map(c => [c.kind, c.value])).toEqual([['created', undefined], ['status', 'confirmed'], ['items', undefined], ['payment', undefined], ['other', undefined], ['status', 'new']]);
    expect(web.changes.map(c => c._c)).toEqual(changes);
    expect(web.status).toBe('ready');
    expect(web.stockApplied).toBe(true);
    expect(['confirmed', 'collected', 'cancelled', 'newOrder'].map(status => map.orderToWeb(ORDER_ID, { status }, BHD).stockApplied)).toEqual([true, true, false, false]);
  });

  it('round-trips iPhone and Android records unchanged', () => {
    expect(roundTrip('order', ORDER_ID, orderRecord(), BHD)).toStrictEqual(orderRecord());
    expect(roundTrip('order', ORDER_ID, androidRecord(), BHD)).toStrictEqual(androidRecord());
  });

  it('never rewrites a record the web did not change: no paymentStatus recompute, no updatedAt, dates as written', () => {
    const inconsistent = frozen({ ...orderRecord(), paymentStatus: 'paid' }); // only 5.000 of 17.000 is paid
    expect(roundTrip('order', ORDER_ID, inconsistent, { ...BHD, now: LATER })).toStrictEqual(inconsistent);
    const seconds = frozen({ ...androidRecord(), dueAt: '2026-10-01T09:30:00Z', createdAt: '2026-09-30T18:00:00Z' });
    expect(map.orderToWeb(ORDER_ID, seconds, BHD).dueAt).toBe('2026-10-01T09:30:00.000Z');
    expect(roundTrip('order', ORDER_ID, seconds, BHD)).toStrictEqual(seconds);
  });

  it('records a web payment: new payment id, paymentStatus recomputed and logged, the rest kept', () => {
    const raw = orderRecord();
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.payments.push({ amount: 12, method: 'cash', note: '', at: '2026-09-29T07:45:00.000Z' }); // FORMS.payment
    web.changes.push({ kind: 'payment', value: 12, at: '2026-09-29T07:45:00.000Z' });
    const out = map.orderToCloud(web, raw, BHD);
    expect(out.payments).toStrictEqual([raw.payments[0], { id: anId(), amountMinor: 12000, method: 'cash', note: null, paidAt: '2026-09-29T07:45:00.000Z' }]);
    expect(web.payments[1].id).toBe(out.payments[1].id);
    expect(out.paymentStatus).toBe('paid');
    expect(out.changes).toStrictEqual([...raw.changes, { id: anId(), field: 'paymentStatus', oldValue: 'deposit', newValue: 'paid', at: NOW.toISOString() }]);
    expect(out.updatedAt).toBe(NOW.toISOString());
    const rest = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['payments', 'paymentStatus', 'changes', 'updatedAt'].includes(k)));
    expect(rest(out)).toStrictEqual(rest(raw)); // address.block, futureField, VAT snapshot, invoice: all kept
  });

  it('writes a status change in cloud form with the previous status, and never writes stockApplied', () => {
    const raw = orderRecord();
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.status = 'confirmed';
    web.stockApplied = true;
    web.changes.push({ kind: 'status', value: 'confirmed', at: '2026-09-29T07:50:00.000Z' });
    const out = map.orderToCloud(web, raw, BHD);
    expect(out.status).toBe('confirmed');
    expect(out.changes).toStrictEqual([...raw.changes, { id: anId(), field: 'status', oldValue: 'newOrder', newValue: 'confirmed', at: '2026-09-29T07:50:00.000Z' }]);
    expect(out.paymentStatus).toBe('deposit');
    expect(out.updatedAt).toBe(NOW.toISOString());
    expect(out).not.toHaveProperty('stockApplied');

    const confirmed = frozen(out);
    const back = map.orderToWeb(ORDER_ID, confirmed, BHD);
    back.status = 'new';
    back.changes.push({ kind: 'status', value: 'new', at: '2026-09-29T07:52:00.000Z' });
    const reopened = map.orderToCloud(back, confirmed, { ...BHD, now: LATER });
    expect(reopened.status).toBe('newOrder');
    expect(reopened.changes.at(-1)).toStrictEqual({ id: anId(), field: 'status', oldValue: 'confirmed', newValue: 'newOrder', at: '2026-09-29T07:52:00.000Z' });
  });

  it("shows an unknown status as 'other' and keeps it on write", () => {
    const raw = frozen({ ...orderRecord(), status: 'archived' });
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    expect(web.status).toBe('other');
    web.notes = 'Moved to Friday';
    const out = map.orderToCloud(web, raw, BHD);
    expect(out.status).toBe('archived');
    expect(out.notes).toBe('Moved to Friday');
    expect(out.updatedAt).toBe(NOW.toISOString());
  });

  it('keeps the rest of the address and unknown fields when the area changes', () => {
    const raw = orderRecord();
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.area = 'muharraq';
    const out = map.orderToCloud(web, raw, BHD);
    expect(out.address).toStrictEqual({ area: 'muharraq', block: '935', road: '3510', building: '12', notes: 'Blue gate' });
    expect(out.futureField).toBe(1);
    expect(out.updatedAt).toBe(NOW.toISOString());
    expect(raw.address.area).toBe('riffa');
  });

  it('gives edited items new ids and snapshots, keeps an existing item\'s snapshot, and logs the edit', () => {
    const raw = orderRecord();
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.items[0].qty = 3;
    web.items.splice(1, 1, { pid: null, nameAr: 'Balloon', nameEn: 'Balloon', qty: 2, price: 0.5, cost: 0.2 });
    web.changes.push({ kind: 'items', at: '2026-09-29T07:55:00.000Z' });
    const out = map.orderToCloud(web, raw, BHD);
    expect(out.items).toStrictEqual([
      { ...raw.items[0], quantity: 3 },
      { id: anId(), productId: null, nameSnapshot: 'Balloon', quantity: 2, unitPriceMinor: 500, unitCostMinor: 200 },
    ]);
    expect(web.items[1].id).toBe(out.items[1].id);
    // 21.500 due, 5.000 paid: still a deposit, so no paymentStatus entry.
    expect(out.changes).toStrictEqual([...raw.changes, { id: anId(), field: 'items', newValue: 'edited', at: '2026-09-29T07:55:00.000Z' }]);
  });

  it('re-snapshots an existing item only when its product or its name changes', () => {
    const [cake, box] = orderRecord().items;
    const raw = frozen({ ...orderRecord(), items: [{ ...cake, nameSnapshot: 'Vanilla Sponge Cake' }, box] }); // ordered in English
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    Object.assign(web.items[0], { nameAr: 'كيك إسفنجي بالفانيليا', nameEn: 'Vanilla Sponge Cake' }); // same product, names re-read
    Object.assign(web.items[1], { nameAr: 'Gift box (large)', nameEn: 'Gift box (large)' }); // custom line renamed
    expect(map.orderToCloud(web, raw, BHD).items.map(it => it.nameSnapshot)).toEqual(['Vanilla Sponge Cake', 'Gift box (large)']);
    Object.assign(web.items[0], { pid: OTHER_PRODUCT_ID, nameAr: 'تشيز كيك بالتوت', nameEn: 'Berry Cheesecake' });
    expect(map.orderToCloud(web, raw, BHD).items[0]).toStrictEqual({ ...raw.items[0], productId: OTHER_PRODUCT_ID, nameSnapshot: 'تشيز كيك بالتوت' });
  });

  it('counts VAT added on top of prices in the total, like the phones', () => {
    const raw = frozen({ ...orderRecord(), vatIncluded: false, vatMinor: 1700 }); // 17.000 + 1.700 VAT
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.payments.push({ amount: 12, method: 'cash', note: '', at: '2026-09-29T07:45:00.000Z' });
    expect(map.orderToCloud(web, raw, BHD).paymentStatus).toBe('deposit');
    web.payments.push({ amount: 1.7, method: 'cash', note: '', at: '2026-09-29T07:46:00.000Z' });
    expect(map.orderToCloud(web, raw, BHD).paymentStatus).toBe('paid');
  });

  it('builds a new web order: ids, createdAt, updatedAt, paymentStatus, nameSnapshot, cloud codes only', () => {
    const web = newWebOrder();
    const out = map.orderToCloud(web, undefined, BHD);
    expect(out).toStrictEqual({
      customerId: CUSTOMER_ID, status: 'newOrder', fulfillmentType: 'delivery', dueAt: '2026-10-02T15:00:00.000Z',
      address: { area: 'muharraq' }, deliveryFeeMinor: 1000,
      items: [
        { id: anId(), productId: PRODUCT_ID, nameSnapshot: 'كيك إسفنجي بالفانيليا', quantity: 1, unitPriceMinor: 6500, unitCostMinor: 2500 },
        { id: anId(), productId: null, nameSnapshot: 'Candles', quantity: 2, unitPriceMinor: 250, unitCostMinor: 100 },
      ],
      payments: [{ id: anId(), amountMinor: 2000, method: 'benefit', note: null, paidAt: '2026-09-29T07:59:00.000Z' }],
      changes: [
        { id: anId(), field: 'order', newValue: 'created', at: '2026-09-29T07:59:00.000Z' },
        { id: anId(), field: 'paymentStatus', newValue: 'deposit', at: NOW.toISOString() },
      ],
      notes: null, source: 'whatsapp',
      vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: null, invoiceIdentifier: null,
      paymentStatus: 'deposit', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
    const ids = [...out.items, ...out.payments, ...out.changes].map(x => x.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('writes the same record again until the web changes something (generated ids stay on the web order)', () => {
    const web = newWebOrder();
    const first = map.orderToCloud(web, undefined, BHD);
    expect(map.orderToCloud(web, first, { ...BHD, now: LATER })).toStrictEqual(first);
    expect(roundTrip('order', ORDER_ID, frozen(first), { ...BHD, now: LATER })).toStrictEqual(first);
  });

  it('keeps history from an unsent write and chains its status into the next one', () => {
    const raw = orderRecord();
    const web = map.orderToWeb(ORDER_ID, raw, BHD);
    web.status = 'confirmed';
    web.changes.push({ kind: 'status', value: 'confirmed', at: '2026-09-29T07:50:00.000Z' });
    const unsent = map.orderToCloud(web, raw, BHD); // say the push failed: raw is still the old record
    web.status = 'ready';
    web.changes.push({ kind: 'status', value: 'ready', at: '2026-09-29T07:58:00.000Z' });
    const out = map.orderToCloud(web, raw, { ...BHD, now: LATER });
    expect(out.changes).toStrictEqual([...raw.changes, unsent.changes[2], { id: anId(), field: 'status', oldValue: 'confirmed', newValue: 'ready', at: '2026-09-29T07:58:00.000Z' }]);
  });

  it('keeps history another phone added after the web read the order', () => {
    const older = orderRecord();
    const web = map.orderToWeb(ORDER_ID, older, BHD);
    const newer = frozen({ ...older, changes: [...older.changes, { id: CH_3, field: 'dueAt', oldValue: '2026-09-30T13:00:00.000Z', newValue: '2026-09-30T14:00:00.000Z', note: null, at: '2026-09-29T07:00:00.000Z' }] });
    web.notes = 'Ring twice';
    expect(map.orderToCloud(web, newer, BHD).changes).toStrictEqual(newer.changes);
  });
});

describe('expense', () => {
  const expenseRecord = () => frozen({ amountMinor: 18500, category: 'ingredients', note: 'Flour, sugar & dairy run', receiptPhotoId: '9c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a3f5a9c2e7b1d4f6a', recurring: true, date: '2026-09-09T07:00:00.000Z', createdAt: '2026-09-09T07:05:00.000Z', futureField: 1 });

  it('reads and round-trips the record', () => {
    expect(map.expenseToWeb(EXPENSE_ID, expenseRecord(), BHD)).toEqual({ id: EXPENSE_ID, amount: 18.5, category: 'ingredients', note: 'Flour, sugar & dairy run', date: '2026-09-09T07:00:00.000Z' });
    expect(roundTrip('expense', EXPENSE_ID, expenseRecord(), BHD)).toStrictEqual(expenseRecord());
    const android = frozen({ amountMinor: 999, category: 'ads', note: null, recurring: false, date: '2026-09-10T08:00:00.000Z', createdAt: '2026-09-10T08:00:00.000Z' });
    expect(roundTrip('expense', EXPENSE_ID, android, SAR)).toStrictEqual(android);
  });

  it('writes edits (a {en, ar} note becomes one string) and keeps recurring, receiptPhotoId and unknown fields', () => {
    const raw = expenseRecord();
    const web = map.expenseToWeb(EXPENSE_ID, raw, BHD);
    Object.assign(web, { amount: 20.25, note: { en: 'Flour', ar: 'طحين' } });
    expect(map.expenseToCloud(web, raw, BHD)).toStrictEqual({ ...raw, amountMinor: 20250, note: 'طحين' });
  });

  it('shows a category it does not know as other and keeps it', () => {
    const raw = frozen({ ...expenseRecord(), category: 'utilities' });
    const web = map.expenseToWeb(EXPENSE_ID, raw, BHD);
    expect(web.category).toBe('other');
    web.amount = 19;
    expect(map.expenseToCloud(web, raw, BHD)).toStrictEqual({ ...raw, amountMinor: 19000 });
  });

  it('builds a new expense (SAR 9.99 → 999) as FORMS.expense makes it', () => {
    const web = { id: EXPENSE_ID, amount: 9.99, category: 'packaging', note: '', date: '2026-09-28T09:00:00.000Z' };
    expect(map.expenseToCloud(web, undefined, SAR)).toStrictEqual({ amountMinor: 999, category: 'packaging', note: null, date: '2026-09-28T09:00:00.000Z', recurring: false, createdAt: NOW.toISOString() });
  });
});

describe('occasion', () => {
  // The phones store an occasion's days as local-time instants (iOS: Calendar.current midnight).
  const local = (y, m, d, h = 0) => new Date(y, m - 1, d, h).toISOString();
  const occasionRecord = () => frozen({
    kind: 'bahrainNationalDay', nameAr: 'اليوم الوطني البحريني', nameEn: 'Bahrain National Day',
    startDate: local(2026, 12, 16), endDate: local(2026, 12, 17, 14), preOrderOpensAt: '2026-12-01T05:00:00.000Z',
    dailyCapacityOverride: 60, blocked: false, notes: null, futureField: 1,
  });

  it('reads the phones\' local days and the web\'s UTC-midnight days as the same day keys', () => {
    expect(map.occasionToWeb(OCCASION_ID, occasionRecord())).toEqual({ id: OCCASION_ID, kind: 'bahrainNationalDay', nameAr: 'اليوم الوطني البحريني', nameEn: 'Bahrain National Day', start: '2026-12-16', end: '2026-12-17', cap: 60, blocked: false, notes: '' });
    const web = map.occasionToWeb(OCCASION_ID, { startDate: '2027-03-10T00:00:00.000Z', endDate: '2027-03-12T00:00:00.000Z' });
    expect([web.start, web.end]).toEqual(['2027-03-10', '2027-03-12']);
  });

  it('round-trips unchanged', () => {
    expect(roundTrip('occasion', OCCASION_ID, occasionRecord(), BHD)).toStrictEqual(occasionRecord());
  });

  it('writes an edited day at 00:00 UTC and keeps the other day, preOrderOpensAt and unknown fields', () => {
    const raw = occasionRecord();
    const web = map.occasionToWeb(OCCASION_ID, raw);
    Object.assign(web, { end: '2026-12-18', cap: null, blocked: true, notes: 'Closed on the 18th' });
    expect(map.occasionToCloud(web, raw, BHD)).toStrictEqual({ ...raw, endDate: '2026-12-18T00:00:00.000Z', dailyCapacityOverride: null, blocked: true, notes: 'Closed on the 18th' });
  });

  it('builds a new occasion as FORMS.occasion makes it', () => {
    const web = { id: OCCASION_ID, kind: 'custom', nameAr: 'تخفيضات الشتاء', nameEn: 'Winter sale', start: '2026-11-01', end: '2026-11-03', cap: null, blocked: false };
    expect(map.occasionToCloud(web, undefined, BHD)).toStrictEqual({ kind: 'custom', nameAr: 'تخفيضات الشتاء', nameEn: 'Winter sale', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-03T00:00:00.000Z', dailyCapacityOverride: null, blocked: false, notes: null });
  });
});

describe('setting', () => {
  const templatesRecord = () => frozen({ value: { confirmOrder: 'مرحبا {name}، تم تأكيد طلبك', orderReady: 'Your order is ready' }, futureField: 1 });

  it('reads data.value as the web\'s own copy and round-trips unchanged', () => {
    const raw = templatesRecord();
    const web = map.settingToWeb('whatsappTemplates', raw);
    expect(web).toEqual(raw.value);
    expect(map.settingToCloud(web, raw, BHD)).toStrictEqual(raw);
    const android = frozen({ value: '{"confirmOrder":"Hi"}' });
    expect(roundTrip('setting', 'whatsappTemplates', android, BHD)).toStrictEqual(android);
  });

  it('writes a changed value and keeps the other keys', () => {
    const raw = templatesRecord();
    const web = map.settingToWeb('whatsappTemplates', raw);
    web.orderReady = 'طلبك جاهز';
    expect(map.settingToCloud(web, raw, BHD)).toStrictEqual({ value: { confirmOrder: 'مرحبا {name}، تم تأكيد طلبك', orderReady: 'طلبك جاهز' }, futureField: 1 });
    expect(map.settingToCloud({ thankYou: 'Thanks!' }, undefined, BHD)).toStrictEqual({ value: { thankYou: 'Thanks!' } });
  });
});
