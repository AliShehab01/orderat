// public/orderat/cloud-sync.js: the web app's sync engine. It keeps the shop's raw cloud records, builds
// the web state from them with the real cloud-map.js, and pushes what the web changed. The fake server
// below follows server/sync/push-pull.ts: every accepted change gets the next seq, a pull returns the
// rows after the cursor in seq order (a full page means `more`), a push based on an older seq is
// applied and reported in `conflicts`, a refused one comes back in `rejected` with the server's copy.
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Occasion days are local calendar days (cloud-map.js); the expected days below are Bahrain days.
process.env.TZ = 'Asia/Bahrain';

const load = createRequire(import.meta.url);
const map = load('../public/orderat/cloud-map.js');
const { createSync } = load('../public/orderat/cloud-sync.js');
const { CloudError } = load('../public/orderat/cloud-api.js');

const NOW = new Date('2026-09-29T08:00:00.000Z');
const SHOP_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const CAKE_ID = 'c3a8e2f4-1b5d-4e6f-a7b8-9c0d1e2f3a4b';
const COOKIE_ID = 'd4b9f3a5-2c6e-4f70-b8c9-0d1e2f3a4b5c';
const FATIMA_ID = '5d0e7a61-8b2c-4f3d-9a1e-6c7b8d9e0f12';
const NOORA_ID = '6e1f8b72-9c3d-4a4e-8b2f-7d8c9e0f1a23';
const ORDER_ID = '0b6c1f9e-2d3a-4c5b-8e7f-1a2b3c4d5e6f';
const EXPENSE_ID = '7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b';
const OCCASION_ID = '2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c';
const NEW_ID = 'a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d';
const ITEM_ID = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const PAY_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CH_ID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const OWNER = { role: 'owner', permissions: { orders: true, prepare: true, money: true, products: true } };

// Canonical records, as the phones write them (docs/sme-phase-2-cloud.md "Record formats").
const SHOP = () => ({
  nameAr: 'حلويات أم أحمد', nameEn: 'Umm Ahmed Sweets', phone: '+97336005005', currencyCode: 'BHD', pickupHours: '4:00 PM - 8:00 PM',
  dailyCapacity: 35, businessType: 'home', vat: { enabled: true, trn: '220012345600003', rateBps: 1000, pricesIncludeVat: true },
  stock: { enabled: true, defaultLowStockThreshold: 5 }, createdAt: '2026-01-10T08:30:00.000Z',
});
const CAKE = () => ({
  nameAr: 'كيك إسفنجي', nameEn: 'Sponge Cake', aliases: ['كيك'], priceMinor: 6500, costMinor: 2500, dailyCapacity: 6, active: true, photoId: null,
  trackStock: true, stockQuantity: 14, lowStockThreshold: 4, stockMoves: [], createdAt: '2026-02-01T09:00:00.000Z',
});
const COOKIES = () => ({
  nameAr: 'كوكيز', nameEn: 'Cookies', aliases: [], priceMinor: 3000, costMinor: 1200, dailyCapacity: null, active: true, photoId: null,
  trackStock: false, stockQuantity: 0, lowStockThreshold: 3, stockMoves: [], createdAt: '2026-02-01T09:05:00.000Z',
});
const FATIMA = () => ({ name: 'فاطمة العلي', phone: '+97333001001', area: 'muharraq', notes: null, createdAt: '2026-04-02T12:00:00.000Z' });
const NOORA = () => ({ name: 'نورة أحمد', phone: '+97333001002', area: 'riffa', notes: null, createdAt: '2026-04-03T12:00:00.000Z' });
// 2 × 6.500 BHD, 5.000 paid: a deposit.
const ORDER = () => ({
  customerId: FATIMA_ID, status: 'newOrder', fulfillmentType: 'pickup', dueAt: '2026-09-30T14:00:00.000Z',
  address: { area: null, block: null, road: null, building: null, notes: null }, deliveryFeeMinor: 0, paymentStatus: 'deposit',
  items: [{ id: ITEM_ID, productId: CAKE_ID, nameSnapshot: 'كيك إسفنجي', quantity: 2, unitPriceMinor: 6500, unitCostMinor: 2500 }],
  payments: [{ id: PAY_ID, amountMinor: 5000, method: 'benefit', note: 'Deposit', paidAt: '2026-09-28T10:00:00.000Z' }],
  changes: [{ id: CH_ID, field: 'order', oldValue: null, newValue: 'created', note: null, at: '2026-09-28T09:59:00.000Z' }],
  notes: null, vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017',
  createdAt: '2026-09-28T09:59:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z',
});
const EXPENSE = () => ({ amountMinor: 18500, category: 'ingredients', note: 'Flour', receiptPhotoId: null, recurring: false, date: '2026-09-09T07:00:00.000Z', createdAt: '2026-09-09T07:05:00.000Z' });
const OCCASION = () => ({
  kind: 'bahrainNationalDay', nameAr: 'اليوم الوطني', nameEn: 'National Day', startDate: '2026-12-15T21:00:00.000Z', endDate: '2026-12-17T20:59:59.999Z',
  dailyCapacityOverride: 60, blocked: false, notes: null,
});
const TEMPLATES = () => ({ value: { confirmOrder: 'مرحبا {name}', orderReady: 'Your order is ready' } });
const SUBSCRIPTION = () => ({ value: { status: 'active', expiresAt: '2026-10-29T00:00:00.000Z', platform: 'ios', updatedAt: '2026-09-29T07:00:00.000Z' } });

const clone = v => JSON.parse(JSON.stringify(v));
const uuidFor = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 0));
  expect(check()).toBe(true);
}

function fakeServer({ pageSize = 500 } = {}) {
  let seq = 0;
  const rows = new Map();
  const server = {
    calls: [], membership: OWNER, fail: null, gate: null, inFlight: 0, maxInFlight: 0,
    refuse: () => false,
    put(entity, id, data, deleted = false) {
      seq += 1;
      rows.set(`${entity}/${id}`, { entity, id, data: clone(data), deleted, seq, updatedAt: new Date(Date.UTC(2026, 8, 29, 8, 0, seq)).toISOString() });
      return seq;
    },
    row: (entity, id) => rows.get(`${entity}/${id}`),
    pushed: () => server.calls.flatMap(c => c.changes),
  };
  server.api = {
    sync: vi.fn(async body => {
      server.inFlight += 1;
      server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
      try {
        const req = clone(body);
        server.calls.push(req);
        if (server.fail) throw server.fail;
        const conflicts = [], rejected = [];
        for (const c of req.changes) {
          const existing = server.row(c.entity, c.id);
          if (server.refuse(c)) {
            const record = existing && { data: clone(existing.data), deleted: existing.deleted, seq: existing.seq, updatedAt: existing.updatedAt };
            rejected.push(record ? { entity: c.entity, id: c.id, reason: 'forbidden', record } : { entity: c.entity, id: c.id, reason: 'forbidden' });
            continue;
          }
          const previous = existing ? existing.seq : 0;
          server.put(c.entity, c.id, c.data, c.deleted === true);
          if (previous > (c.baseSeq || 0)) conflicts.push({ entity: c.entity, id: c.id, seq: previous });
        }
        const page = [...rows.values()].filter(r => r.seq > req.cursor).sort((a, b) => a.seq - b.seq).slice(0, pageSize);
        // record-access.ts canPull: only a member with `money` sees expenses; the cursor still moves past them.
        const { role, permissions } = server.membership;
        const visible = page.filter(r => r.entity !== 'expense' || role === 'owner' || permissions.money);
        const answer = clone({ changes: visible, cursor: page.length ? page[page.length - 1].seq : req.cursor, more: page.length === pageSize, conflicts, rejected, membership: server.membership });
        if (server.onAnswer) server.onAnswer(req);
        if (server.gate) await server.gate; // decided on the server, still on its way back
        return answer;
      } finally {
        server.inFlight -= 1;
      }
    }),
  };
  return server;
}

// A shop with one of everything: shop 1, cake 2, cookies 3, Fatima 4, Noora 5, order 6, expense 7,
// occasion 8, templates 9, subscription 10.
function seeded(options) {
  const server = fakeServer(options);
  server.put('shop', SHOP_ID, SHOP());
  server.put('product', CAKE_ID, CAKE());
  server.put('product', COOKIE_ID, COOKIES());
  server.put('customer', FATIMA_ID, FATIMA());
  server.put('customer', NOORA_ID, NOORA());
  server.put('order', ORDER_ID, ORDER());
  server.put('expense', EXPENSE_ID, EXPENSE());
  server.put('occasion', OCCASION_ID, OCCASION());
  server.put('setting', 'whatsappTemplates', TEMPLATES());
  server.put('setting', 'subscription', SUBSCRIPTION());
  return server;
}

// The app as Task 5 wires it: device prefs on S, every onChange state adopted into S in place, and S
// handed to commit().
function open(server, options = {}) {
  const S = { lang: 'ar', theme: 'system' };
  const changes = [], notices = [];
  const sync = createSync({
    api: server.api, map: options.map || map, shopId: SHOP_ID, ctx: { deviceCode: 'A7' },
    onChange: state => { changes.push(state); Object.assign(S, state); },
    onNotice: (notice, detail) => notices.push([notice, detail]),
  });
  return { S, sync, changes, notices };
}

async function started(server, options) {
  const app = open(server, options);
  await app.sync.start();
  return app;
}

const product = (app, id) => app.S.products.find(p => p.id === id);

afterEach(() => {
  vi.useRealTimers();
});

describe('start', () => {
  it('pulls every page from cursor 0, then builds the state once', async () => {
    const server = fakeServer({ pageSize: 2 });
    server.put('shop', SHOP_ID, SHOP());
    server.put('product', CAKE_ID, CAKE());
    server.put('product', COOKIE_ID, COOKIES());
    server.put('customer', FATIMA_ID, FATIMA());
    server.put('order', ORDER_ID, ORDER());
    const app = open(server);
    const state = await app.sync.start();
    expect(server.calls.map(c => [c.cursor, c.changes])).toEqual([[0, []], [2, []], [4, []]]);
    expect(app.changes).toHaveLength(1);
    expect(app.changes[0]).toBe(state);
    expect(state.products.map(p => [p.id, p.price])).toEqual([[CAKE_ID, 6.5], [COOKIE_ID, 3]]);
    expect(state.orders.map(o => [o.id, o.status, o.payments.map(p => p.amount)])).toEqual([[ORDER_ID, 'new', [5]]]);
    expect(app.S.shop.nameEn).toBe('Umm Ahmed Sweets');
  });

  it('builds every part of the web state, without deleted records, other entities or other settings', async () => {
    const server = fakeServer();
    server.put('shop', SHOP_ID, { ...SHOP(), currencyCode: 'SAR' });
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 999 });
    server.put('customer', FATIMA_ID, FATIMA());
    server.put('customer', NOORA_ID, NOORA(), true);
    server.put('stock_move', 'f0e1d2c3-b4a5-4968-8776-655443322110', { productId: CAKE_ID, delta: -2 });
    server.put('expense', EXPENSE_ID, EXPENSE());
    server.put('occasion', OCCASION_ID, OCCASION());
    server.put('setting', 'whatsappTemplates', TEMPLATES());
    server.put('setting', 'subscription', SUBSCRIPTION());
    server.put('setting', 'askConsent', { value: true });
    const { sync } = open(server);
    const state = await sync.start();
    expect(Object.keys(state).sort()).toEqual(['customers', 'expenses', 'occasions', 'orders', 'products', 'shop', 'stockEnabled', 'subscription', 'vat', 'waTemplates']);
    expect(state.shop).toEqual({ nameAr: 'حلويات أم أحمد', nameEn: 'Umm Ahmed Sweets', phone: '+97336005005', currency: 'SAR', pickupHours: '4:00 PM - 8:00 PM', dailyCapacity: 35, businessType: 'home' });
    expect(state.vat).toEqual({ enabled: true, trn: '220012345600003', pricesInclude: true });
    expect(state.stockEnabled).toBe(true);
    expect(state.products.map(p => [p.id, p.price])).toEqual([[CAKE_ID, 9.99]]);
    expect(state.customers.map(c => c.id)).toEqual([FATIMA_ID]);
    expect(state.orders).toEqual([]);
    expect(state.expenses.map(e => [e.id, e.amount])).toEqual([[EXPENSE_ID, 185]]);
    expect(state.occasions.map(o => [o.id, o.start, o.end])).toEqual([[OCCASION_ID, '2026-12-16', '2026-12-17']]);
    expect(state.waTemplates).toEqual({ confirmOrder: 'مرحبا {name}', orderReady: 'Your order is ready' });
    expect(state.subscription).toEqual({ status: 'active', expiresAt: '2026-10-29T00:00:00.000Z', platform: 'ios', updatedAt: '2026-09-29T07:00:00.000Z' });
    const again = sync.buildState();
    expect(again).toEqual(state);
    expect(again.products[0]).not.toBe(state.products[0]);
  });

  it('shows no templates and no subscription when the shop has neither', async () => {
    const server = fakeServer();
    server.put('shop', SHOP_ID, SHOP());
    const state = await open(server).sync.start();
    expect([state.waTemplates, state.subscription]).toEqual([null, null]);
  });

  it('keeps the membership from the last sync', async () => {
    const server = seeded();
    server.membership = { role: 'staff', permissions: { orders: true, prepare: true, money: false, products: false } };
    const { sync } = open(server);
    expect(sync.membership).toBeNull();
    await sync.start();
    expect(sync.membership).toEqual({ role: 'staff', permissions: { orders: true, prepare: true, money: false, products: false } });
    server.membership = { role: 'staff', permissions: { orders: true, prepare: true, money: true, products: false } };
    await sync.pull();
    expect(sync.membership.permissions.money).toBe(true);
  });

  it('starts afresh when started again (a member who lost `money` no longer sees expenses)', async () => {
    const server = seeded();
    const app = await started(server);
    expect(app.S.expenses.map(e => e.id)).toEqual([EXPENSE_ID]);
    server.membership = { role: 'staff', permissions: { orders: true, prepare: true, money: false, products: true } };
    await app.sync.start();
    expect(server.calls.at(-1).cursor).toBe(0);
    expect(app.S.expenses).toEqual([]);
    expect(app.S.products).toHaveLength(2);
  });

  it('stops paging when the server says more without moving the cursor', async () => {
    let answers = 0;
    const sync = vi.fn(async () => ({ changes: [], cursor: 0, more: ++answers < 4, conflicts: [], rejected: [], membership: OWNER }));
    const app = open({ api: { sync } });
    await app.sync.start();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(app.changes).toHaveLength(1);
    answers = 0;
    await app.sync.pull();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('fails with the CloudError when the first pull fails', async () => {
    const server = seeded();
    server.fail = new CloudError('offline', 0, 'network');
    const app = open(server);
    await expect(app.sync.start()).rejects.toBe(server.fail);
    expect(app.changes).toEqual([]);
  });
});

describe('commit', () => {
  it('pushes only the records the web changed, with their last seq as baseSeq', async () => {
    const server = seeded();
    const app = await started(server);
    product(app, CAKE_ID).price = 7.25;
    await expect(app.sync.commit(app.S)).resolves.toBe(true);
    expect(server.calls.at(-1).changes).toEqual([{ entity: 'product', id: CAKE_ID, data: { ...CAKE(), priceMinor: 7250 }, deleted: false, baseSeq: 2 }]);
    expect(server.row('product', CAKE_ID).data).toEqual({ ...CAKE(), priceMinor: 7250 });
    expect(app.sync.pending).toBe(0);
    expect(app.changes).toHaveLength(2);
    expect(product(app, CAKE_ID).price).toBe(7.25);
  });

  it('does not call the server when nothing changed', async () => {
    const server = seeded();
    const app = await started(server);
    await expect(app.sync.commit(app.S)).resolves.toBe(true);
    expect(server.calls).toHaveLength(1);
    expect(app.changes).toHaveLength(1);
  });

  it('sends a tombstone, with the last data, for each record the web deleted', async () => {
    const server = seeded();
    const app = await started(server);
    app.S.customers = app.S.customers.filter(c => c.id !== NOORA_ID);
    app.S.products.splice(app.S.products.findIndex(p => p.id === COOKIE_ID), 1);
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes).toEqual([
      { entity: 'customer', id: NOORA_ID, data: NOORA(), deleted: true, baseSeq: 5 },
      { entity: 'product', id: COOKIE_ID, data: COOKIES(), deleted: true, baseSeq: 3 },
    ]);
    expect([server.row('customer', NOORA_ID).deleted, server.row('product', COOKIE_ID).deleted]).toEqual([true, true]);
    expect(app.S.customers.map(c => c.id)).toEqual([FATIMA_ID]);
    expect(app.S.products.map(p => p.id)).toEqual([CAKE_ID]);
  });

  it('creates a record the web added, with baseSeq 0', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const server = seeded();
    const app = await started(server);
    app.S.customers.push({ id: NEW_ID, name: 'ريم سعيد', nameEn: 'Reem Saeed', phone: '+97333001099', area: '', notes: '' });
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes).toEqual([{
      entity: 'customer', id: NEW_ID, deleted: false, baseSeq: 0,
      data: { name: 'ريم سعيد', nameEn: 'Reem Saeed', phone: '+97333001099', area: null, notes: null, createdAt: NOW.toISOString() },
    }]);
    expect(app.S.customers.map(c => c.id)).toEqual([FATIMA_ID, NOORA_ID, NEW_ID]);
  });

  it('applies what other devices changed and keeps the web edit', async () => {
    const server = seeded();
    const app = await started(server);
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 }); // a phone raised the price
    app.S.customers.find(c => c.id === FATIMA_ID).notes = 'Evening delivery';
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes.map(c => c.id)).toEqual([FATIMA_ID]);
    expect(product(app, COOKIE_ID).price).toBe(3.5);
    expect(app.S.customers.find(c => c.id === FATIMA_ID).notes).toBe('Evening delivery');
  });

  it('removes a record another device deleted and does not bring it back', async () => {
    const server = seeded();
    const app = await started(server);
    server.put('customer', NOORA_ID, NOORA(), true);
    await app.sync.pull();
    expect(app.S.customers.map(c => c.id)).toEqual([FATIMA_ID]);
    app.S.customers[0].notes = 'VIP';
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes.map(c => [c.id, c.deleted])).toEqual([[FATIMA_ID, false]]);
    expect(server.row('customer', NOORA_ID).deleted).toBe(true);
  });

  it('never pushes an old copy of the state over a newer record from another device', async () => {
    const server = seeded();
    const app = await started(server);
    const oldProducts = app.S.products; // built before the phone's change
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    server.put('product', NEW_ID, { ...COOKIES(), nameEn: 'Brownies' }); // a phone added a product
    await app.sync.pull();
    expect(product(app, CAKE_ID).price).toBe(7);
    await app.sync.commit({ ...app.S, products: oldProducts }); // an app that held on to the old list
    expect(server.pushed()).toEqual([]);
    expect(server.row('product', CAKE_ID).data.priceMinor).toBe(7000);
    expect(server.row('product', NEW_ID).deleted).toBe(false);
  });

  it('does not push an old object that the app only annotated (its edits are judged against what it was built from)', async () => {
    const server = seeded();
    const app = await started(server);
    const oldCake = product(app, CAKE_ID);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000, stockQuantity: 9 });
    await app.sync.pull();
    oldCake.shownAt = 'today'; // a display note on a copy from before the pull
    await app.sync.commit({ ...app.S, products: [oldCake, product(app, COOKIE_ID)] });
    expect(server.pushed()).toEqual([]);
    expect(server.row('product', CAKE_ID).data).toMatchObject({ priceMinor: 7000, stockQuantity: 9 });
  });

  it('sends at most 500 changes per call', async () => {
    const server = seeded();
    const app = await started(server);
    for (let i = 1; i <= 501; i++) app.S.customers.push({ id: uuidFor(i), name: `زبون ${i}`, nameEn: '', phone: `+9733300${String(i).padStart(4, '0')}`, area: '', notes: '' });
    await expect(app.sync.commit(app.S)).resolves.toBe(true);
    expect(server.calls.filter(c => c.changes.length).map(c => c.changes.length)).toEqual([500, 1]);
    expect(app.sync.pending).toBe(0);
    expect(app.S.customers).toHaveLength(503);
  });

  it('counts a change as sent once the server takes it, even when its copy comes back on a later page', async () => {
    const server = seeded({ pageSize: 2 });
    const app = await started(server);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 });
    app.S.customers.push({ id: NEW_ID, name: 'ريم سعيد', nameEn: '', phone: '+97333001099', area: '', notes: '' });
    await app.sync.commit(app.S);
    expect(server.calls.slice(-2).map(c => c.changes.map(x => x.id))).toEqual([[NEW_ID], []]);
    expect(app.sync.pending).toBe(0);
    expect(app.S.customers.map(c => c.id)).toEqual([FATIMA_ID, NOORA_ID, NEW_ID]);
    await app.sync.pull();
    expect(server.pushed().filter(c => c.id === NEW_ID)).toHaveLength(1);
  });

  it('writes the shop, VAT and stock switches to the shop record', async () => {
    const server = seeded();
    const app = await started(server);
    app.S.shop.nameEn = 'Umm Ahmed Bakery';
    app.S.vat.enabled = false;
    app.S.stockEnabled = false;
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes).toEqual([{
      entity: 'shop', id: SHOP_ID, deleted: false, baseSeq: 1,
      data: { ...SHOP(), nameEn: 'Umm Ahmed Bakery', vat: { ...SHOP().vat, enabled: false }, stock: { enabled: false, defaultLowStockThreshold: 5 } },
    }]);
  });

  it('leaves a shop that has no record yet alone until the web edits it', async () => {
    const server = fakeServer();
    server.put('product', CAKE_ID, CAKE());
    const app = await started(server);
    expect([app.S.shop.nameAr, app.S.shop.currency]).toEqual(['', 'BHD']);
    await app.sync.commit(app.S);
    expect(server.calls).toHaveLength(1);
    app.S.shop.nameAr = 'عربة زاد';
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes.map(c => [c.entity, c.id, c.baseSeq, c.data.nameAr])).toEqual([['shop', SHOP_ID, 0, 'عربة زاد']]);
  });

  it('saves the WhatsApp templates, never the subscription, and never deletes a setting', async () => {
    const server = seeded();
    const app = await started(server);
    app.S.waTemplates.orderReady = 'طلبك جاهز';
    app.S.subscription.status = 'expired';
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes).toEqual([{
      entity: 'setting', id: 'whatsappTemplates', deleted: false, baseSeq: 9,
      data: { value: { confirmOrder: 'مرحبا {name}', orderReady: 'طلبك جاهز' } },
    }]);
    const calls = server.calls.length;
    app.S.waTemplates = null;
    app.S.subscription = null;
    await app.sync.commit(app.S);
    expect(server.calls).toHaveLength(calls);
    expect(server.row('setting', 'subscription').data).toEqual(SUBSCRIPTION());
  });

  it('hands the map the live web object, its raw record and ctx { decimals of the shop currency, now, deviceCode }', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const server = fakeServer();
    server.put('shop', SHOP_ID, { ...SHOP(), currencyCode: 'SAR' });
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 1250 });
    const spyMap = { ...map, productToCloud: vi.fn(map.productToCloud) };
    const app = await started(server, { map: spyMap });
    const cake = product(app, CAKE_ID);
    cake.price = 9.99;
    await app.sync.commit(app.S);
    expect(server.calls.at(-1).changes.map(c => c.data.priceMinor)).toEqual([999]);
    expect(spyMap.productToCloud).toHaveBeenCalledWith(cake, { ...CAKE(), priceMinor: 1250 }, { decimals: 2, now: NOW, deviceCode: 'A7' });
  });
});

describe('refused changes and conflicts', () => {
  it('puts back the server copy of a refused change and says forbidden', async () => {
    const server = seeded();
    server.refuse = c => c.entity === 'product';
    const app = await started(server);
    product(app, CAKE_ID).price = 1;
    await expect(app.sync.commit(app.S)).resolves.toBe(true);
    expect(app.notices.map(([notice, detail]) => [notice, detail.map(r => [r.entity, r.id, r.record.data.priceMinor])])).toEqual([['forbidden', [['product', CAKE_ID, 6500]]]]);
    expect(product(app, CAKE_ID).price).toBe(6.5);
    expect(app.sync.pending).toBe(0);
    await app.sync.commit(app.S);
    expect(server.pushed()).toHaveLength(1);
  });

  it('drops a refused new record that the server has no copy of', async () => {
    const server = seeded();
    server.refuse = c => c.entity === 'order';
    const app = await started(server);
    app.S.orders.push({
      id: NEW_ID, customerId: FATIMA_ID, dueAt: '2026-10-02T15:00:00.000Z', items: [{ pid: CAKE_ID, nameAr: 'كيك إسفنجي', nameEn: 'Sponge Cake', qty: 1, price: 6.5, cost: 2.5 }],
      fulfillment: 'pickup', area: '', deliveryFee: 0, source: 'whatsapp', payments: [], notes: '', changes: [{ kind: 'created', at: '2026-09-29T07:59:00.000Z' }], status: 'new', stockApplied: false,
    });
    await app.sync.commit(app.S);
    expect(app.notices.map(n => n[0])).toEqual(['forbidden']);
    expect(app.S.orders.map(o => o.id)).toEqual([ORDER_ID]);
    expect(app.sync.pending).toBe(0);
  });

  it('says conflict when another device wrote the record first, and the web edit wins', async () => {
    const server = seeded();
    const app = await started(server);
    const phoneSeq = server.put('product', CAKE_ID, { ...CAKE(), nameEn: 'Cake (phone)' });
    product(app, CAKE_ID).price = 8;
    await app.sync.commit(app.S);
    expect(app.notices).toEqual([['conflict', [{ entity: 'product', id: CAKE_ID, seq: phoneSeq }]]]);
    expect(server.row('product', CAKE_ID).data).toEqual({ ...CAKE(), priceMinor: 8000 });
    expect(product(app, CAKE_ID)).toMatchObject({ price: 8, nameEn: 'Sponge Cake' });
  });
});

describe('offline and failures', () => {
  it('keeps a change pending while offline and sends it with the next pull', async () => {
    const server = seeded();
    const app = await started(server);
    product(app, CAKE_ID).price = 7;
    server.fail = new CloudError('offline', 0, 'network');
    await expect(app.sync.commit(app.S)).resolves.toBe(false);
    expect(app.notices).toEqual([['offline', server.fail]]);
    expect(app.sync.pending).toBe(1);
    expect(app.changes).toHaveLength(1);
    expect(product(app, CAKE_ID).price).toBe(7);
    server.fail = null;
    await expect(app.sync.pull()).resolves.toBe(true);
    expect(server.calls.at(-1).changes.map(c => [c.id, c.data.priceMinor])).toEqual([[CAKE_ID, 7000]]);
    expect(app.sync.pending).toBe(0);
    expect(server.row('product', CAKE_ID).data.priceMinor).toBe(7000);
  });

  it.each([
    [new CloudError('unauthorized', 401, 'unauthorized'), 'unauthorized'],
    [new CloudError('forbidden', 403, 'forbidden'), 'no_access'],
    [new CloudError('rate_limited', 429, 'rate_limited'), 'rate_limited'],
    [new CloudError('server', 502, undefined), 'server'],
    [new CloudError('invalid', 413, 'too_large'), 'invalid'],
  ])('reports %s as %s and keeps the change', async (error, notice) => {
    const server = seeded();
    const app = await started(server);
    product(app, CAKE_ID).price = 7;
    server.fail = error;
    await expect(app.sync.commit(app.S)).resolves.toBe(false);
    expect(app.notices).toEqual([[notice, error]]);
    expect(app.sync.pending).toBe(1);
  });

  it('shows the pages it pulled when a later call of the same sync fails', async () => {
    const server = seeded({ pageSize: 2 });
    const app = await started(server);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 });
    server.put('customer', FATIMA_ID, { ...FATIMA(), notes: 'Evening delivery' });
    server.onAnswer = () => { server.fail = new CloudError('offline', 0, 'network'); }; // the next call gets no answer
    await expect(app.sync.pull()).resolves.toBe(false);
    expect([product(app, CAKE_ID).price, product(app, COOKIE_ID).price]).toEqual([7, 3.5]);
    expect(app.notices.map(n => n[0])).toEqual(['offline']);
    server.onAnswer = null;
    server.fail = null;
    await app.sync.pull();
    expect(app.S.customers.find(c => c.id === FATIMA_ID).notes).toBe('Evening delivery');
  });

  it('keeps an edit made while a later call of the same sync was failing', async () => {
    const server = seeded({ pageSize: 2 });
    const app = await started(server);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 });
    server.put('customer', NOORA_ID, { ...NOORA(), notes: 'Calls first' }); // on a second page
    const serverSync = server.api.sync;
    const gate = deferred();
    let calls = 0;
    server.api.sync = async body => {
      calls += 1;
      if (calls !== 2) return serverSync(body);
      await gate.promise;
      throw new CloudError('offline', 0, 'network');
    };
    const pulling = app.sync.pull();
    await until(() => calls === 2);
    app.S.customers[0].notes = 'VIP';
    gate.resolve();
    await expect(pulling).resolves.toBe(false);
    expect(product(app, CAKE_ID).price).toBe(7);
    expect(app.S.customers[0].notes).toBe('VIP');
    expect(app.sync.pending).toBe(1);
  });

  it('passes on an error that is not a CloudError and keeps working', async () => {
    const server = seeded();
    const app = await started(server);
    product(app, CAKE_ID).price = 7;
    server.fail = new TypeError('boom');
    await expect(app.sync.commit(app.S)).rejects.toThrow('boom');
    server.fail = null;
    await expect(app.sync.pull()).resolves.toBe(true);
    expect(server.row('product', CAKE_ID).data.priceMinor).toBe(7000);
  });
});

describe('edits made during a sync', () => {
  it('keeps an edit made while a pull was on its way back', async () => {
    const server = seeded();
    const app = await started(server);
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 }); // a phone's change, waiting to be pulled
    const gate = deferred();
    server.gate = gate.promise;
    const pulling = app.sync.pull();
    await until(() => server.inFlight === 1);
    app.S.orders[0].notes = 'Ring twice';
    server.gate = null;
    gate.resolve();
    await pulling;
    expect(app.changes).toHaveLength(2);
    expect(app.S.orders[0].notes).toBe('Ring twice');
    expect(product(app, COOKIE_ID).price).toBe(3.5);
    expect(app.sync.pending).toBe(1);
    await app.sync.commit(app.S);
    expect(server.row('order', ORDER_ID).data.notes).toBe('Ring twice');
    expect(app.sync.pending).toBe(0);
  });

  it('keeps an edit made while a refused change was on its way', async () => {
    const server = seeded();
    server.refuse = c => c.entity === 'product';
    const app = await started(server);
    product(app, CAKE_ID).price = 1;
    const gate = deferred();
    server.gate = gate.promise;
    const committing = app.sync.commit(app.S);
    await until(() => server.inFlight === 1);
    app.S.customers[0].notes = 'VIP';
    server.gate = null;
    gate.resolve();
    await committing;
    expect(product(app, CAKE_ID).price).toBe(6.5);
    expect(app.S.customers[0].notes).toBe('VIP');
    expect(app.sync.pending).toBe(1);
  });

  it('keeps an edit made while an empty last page was on its way, after an earlier page changed records', async () => {
    const server = seeded({ pageSize: 2 });
    const app = await started(server);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    server.put('product', COOKIE_ID, { ...COOKIES(), priceMinor: 3500 }); // exactly one full page
    const serverSync = server.api.sync;
    const gate = deferred();
    let calls = 0;
    server.api.sync = async body => {
      calls += 1;
      const answer = await serverSync(body);
      if (calls === 2) await gate.promise; // the second, empty page is still on its way
      return answer;
    };
    const pulling = app.sync.pull();
    await until(() => calls === 2);
    app.S.customers[0].notes = 'VIP';
    gate.resolve();
    await pulling;
    expect(product(app, CAKE_ID).price).toBe(7);
    expect(app.S.customers[0].notes).toBe('VIP');
    expect(app.sync.pending).toBe(1);
  });

  it('runs one sync at a time and folds the calls made meanwhile into one more', async () => {
    const server = seeded();
    const app = await started(server);
    const gate = deferred();
    server.gate = gate.promise;
    const first = app.sync.pull();
    await until(() => server.inFlight === 1);
    product(app, CAKE_ID).price = 9;
    const others = [app.sync.commit(app.S), app.sync.commit(app.S), app.sync.pull()];
    await new Promise(r => setTimeout(r, 0));
    expect(server.calls).toHaveLength(2);
    server.gate = null;
    gate.resolve();
    await expect(Promise.all([first, ...others])).resolves.toEqual([true, true, true, true]);
    expect(server.maxInFlight).toBe(1);
    expect(server.calls).toHaveLength(3);
    expect(server.calls[2].changes.map(c => [c.id, c.data.priceMinor])).toEqual([[CAKE_ID, 9000]]);
  });

  it('does nothing before start', async () => {
    const server = seeded();
    const app = open(server);
    await expect(app.sync.commit({ products: [{ id: CAKE_ID, nameAr: 'x' }] })).resolves.toBe(false);
    await expect(app.sync.pull()).resolves.toBe(false);
    expect(server.calls).toEqual([]);
  });

  it('ignores an answer that arrives after stop()', async () => {
    const server = seeded();
    const app = await started(server);
    server.put('product', CAKE_ID, { ...CAKE(), priceMinor: 7000 });
    const gate = deferred();
    server.gate = gate.promise;
    const pulling = app.sync.pull();
    await until(() => server.inFlight === 1);
    app.sync.stop();
    gate.resolve();
    await pulling;
    expect(app.changes).toHaveLength(1);
    expect(app.notices).toEqual([]);
    product(app, CAKE_ID).price = 1;
    await expect(app.sync.commit(app.S)).resolves.toBe(false);
    expect(server.calls).toHaveLength(2);
  });
});

describe('orders', () => {
  it('pushes an edited order once, then leaves it alone', async () => {
    const server = seeded();
    const app = await started(server);
    const order = app.S.orders[0];
    order.payments.push({ amount: 8, method: 'cash', note: '', at: '2026-09-29T07:45:00.000Z' });
    order.changes.push({ kind: 'payment', value: 8, at: '2026-09-29T07:45:00.000Z' });
    await app.sync.commit(app.S);
    expect(app.sync.pending).toBe(0);
    const data = server.row('order', ORDER_ID).data;
    expect(data.paymentStatus).toBe('paid');
    expect(data.payments.map(p => [p.amountMinor, p.method])).toEqual([[5000, 'benefit'], [8000, 'cash']]);
    expect(data.changes.map(c => [c.field, c.newValue])).toEqual([['order', 'created'], ['paymentStatus', 'paid']]);
    await app.sync.pull();
    await app.sync.commit(app.S);
    expect(server.pushed().filter(c => c.id === ORDER_ID)).toHaveLength(1);
    expect(app.S.orders[0].payments.map(p => p.amount)).toEqual([5, 8]);
  });
});
