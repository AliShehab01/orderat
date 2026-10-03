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

  it('snapshots the shop VAT on a NEW order and numbers it once', () => {
    const order = { items: [{ qty: 2, price: 5 }], deliveryFee: 1 };
    let calls = 0;
    const issue = () => { calls++; return { invoiceNumber: 7, invoiceIdentifier: 'INV-A7-000007' }; };
    core.applyVat(order, { enabled: true, rateBps: 1000, pricesInclude: false }, 'BHD', issue);
    expect(order).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 1100, invoiceNumber: 7, invoiceIdentifier: 'INV-A7-000007' });
    // An edit recomputes from the order's own snapshot and never takes another invoice number.
    order.items[0].qty = 3;
    core.reapplyVat(order, 'BHD');
    expect(order.vatMinor).toBe(1600);
    expect(calls).toBe(1);
  });

  it('uses the currency default when the shop has no rate, and leaves an order without VAT when the shop has none', () => {
    const order = { items: [{ qty: 1, price: 11.5 }], deliveryFee: 0 };
    core.applyVat(order, { enabled: true, rateBps: null, pricesInclude: true }, 'SAR', () => ({}));
    expect(order.vatRateBps).toBe(1500);
    expect(order.vatMinor).toBe(150);
    const plain = { items: [{ qty: 1, price: 2 }], deliveryFee: 0 };
    core.applyVat(plain, { enabled: false }, 'BHD', () => { throw new Error('no'); });
    core.applyVat(plain, undefined, 'BHD', () => { throw new Error('no'); });
    expect(plain).toEqual({ items: [{ qty: 1, price: 2 }], deliveryFee: 0 });
  });

  // Integrity review R1 (3 Oct 2026): editing an existing order used to copy the shop's CURRENT VAT
  // settings onto it (100.000 + 10% = 110.000 became 100.000 once the shop switched to "prices include
  // VAT"), keeping its invoice number. The shop's VAT settings are for new orders only; the Android
  // edit form is the reference.
  describe('an existing order keeps its own VAT (integrity review R1)', () => {
    const issue = () => ({ invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017' });
    const exclusive10 = { enabled: true, rateBps: 1000, pricesInclude: false };
    const inclusive10 = { enabled: true, rateBps: 1000, pricesInclude: true };
    const total = o => core.orderMinor(o, 3).total;
    /** 100.000 BHD + 10% on top, as created while the shop's prices excluded VAT. */
    const hundred = () => {
      const o = { items: [{ pid: 'p1', qty: 1, price: 100 }], deliveryFee: 0, payments: [] };
      core.applyVat(o, exclusive10, 'BHD', issue);
      return o;
    };

    it('creates 110.000: 10%, exclusive, one invoice number', () => {
      const o = hundred();
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 10000, invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017' });
      expect(total(o)).toBe(110000);
    });

    it('a notes-only edit after the shop switched to prices-include-VAT: still 110.000, 10%, exclusive', () => {
      const o = hundred();
      o.notes = 'Write "Happy birthday"'; // what the edit changed; the caller then recomputes VAT
      core.reapplyVat(o, 'BHD');
      expect(total(o)).toBe(110000);
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 10000, invoiceNumber: 17, invoiceIdentifier: 'INV-A7-000017' });
    });

    it('a quantity edit: 220.000, still exclusive, the same invoice', () => {
      const o = hundred();
      o.items[0].qty = 2;
      core.reapplyVat(o, 'BHD');
      expect(total(o)).toBe(220000);
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 20000, invoiceIdentifier: 'INV-A7-000017' });
    });

    it('a delivery fee edit (and pickup back from delivery) moves the VAT with the amount, on the same rate and mode', () => {
      const o = hundred();
      o.deliveryFee = 5;
      core.reapplyVat(o, 'BHD');
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 10500 });
      expect(total(o)).toBe(115500);
      o.deliveryFee = 0;
      core.reapplyVat(o, 'BHD');
      expect(total(o)).toBe(110000);
    });

    it('applyVat itself never replaces a snapshot an order already has with the shop settings of today', () => {
      // The shop now says prices include VAT, at 15%: the old behaviour made this order 100.000.
      const o = hundred();
      core.applyVat(o, { enabled: true, rateBps: 1500, pricesInclude: true }, 'BHD', () => { throw new Error('no new invoice'); });
      expect(total(o)).toBe(110000);
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 10000 });
      o.items[0].qty = 3;
      core.applyVat(o, inclusive10, 'BHD', () => { throw new Error('no new invoice'); });
      expect(total(o)).toBe(330000);
      core.applyVat(o, { enabled: false }, 'BHD', () => { throw new Error('no new invoice'); });
      expect(total(o)).toBe(330000);
      core.applyVat(o, undefined, 'BHD', () => { throw new Error('no new invoice'); });
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: 30000 });
    });

    it('edits keep the order\'s 10% exclusive when the shop turns VAT off, or changes its rate, after the order', () => {
      const o = hundred();
      for (const shop of [{ enabled: false }, undefined, { enabled: true, rateBps: 0, pricesInclude: true }, { enabled: true, rateBps: 500, pricesInclude: false }]) {
        o.items[0].qty += 1;
        core.applyVat(o, shop, 'BHD', () => { throw new Error('no new invoice'); });
        core.reapplyVat(o, 'BHD');
        expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: false, vatMinor: o.items[0].qty * 10000, invoiceIdentifier: 'INV-A7-000017' });
      }
    });

    it('a VAT-inclusive order stays inclusive: the same price, the VAT inside it', () => {
      const o = { items: [{ qty: 1, price: 110 }], deliveryFee: 0, payments: [] };
      core.applyVat(o, inclusive10, 'BHD', issue);
      expect(o).toMatchObject({ vatIncluded: true, vatMinor: 10000 });
      core.applyVat(o, exclusive10, 'BHD', issue); // the shop switched to prices that exclude VAT
      o.items[0].qty = 2;
      core.reapplyVat(o, 'BHD');
      expect(o).toMatchObject({ vatRateBps: 1000, vatIncluded: true, vatMinor: 20000 });
      expect(total(o)).toBe(220000);
    });

    it('an order created without VAT stays without VAT when edited, and takes no invoice number', () => {
      const plain = { items: [{ qty: 1, price: 100 }], deliveryFee: 0, payments: [] };
      core.applyVat(plain, { enabled: false }, 'BHD', issue); // the shop had no VAT when it was made
      expect(plain.vatRateBps).toBeUndefined();
      plain.items[0].qty = 4; // ... and the shop has VAT now; an edit goes through reapplyVat
      core.reapplyVat(plain, 'BHD');
      expect(plain).toEqual({ items: [{ qty: 4, price: 100 }], deliveryFee: 0, payments: [] });
      expect(total(plain)).toBe(400000);
      // The phones write explicit nulls (or Android a 0 rate): no snapshot, or a rate of 0, is still no VAT.
      const nulls = { items: [{ qty: 1, price: 100 }], deliveryFee: 0, vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: null, invoiceIdentifier: null };
      core.reapplyVat(nulls, 'BHD');
      expect(nulls).toMatchObject({ vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: null, invoiceIdentifier: null });
      const zero = { items: [{ qty: 2, price: 100 }], deliveryFee: 0, vatRateBps: 0, vatIncluded: false, vatMinor: 0 };
      core.reapplyVat(zero, 'BHD');
      expect(zero.vatMinor).toBe(0);
    });

    it('rounds an edit half-up in the currency\'s minor units, like the phones', () => {
      const o = { items: [{ qty: 1, price: 0.015 }], deliveryFee: 0, vatRateBps: 1000, vatIncluded: false, vatMinor: 2 };
      core.reapplyVat(o, 'BHD');
      expect(o.vatMinor).toBe(2); // 15 fils × 10% = 1.5 → 2
      const sar = { items: [{ qty: 3, price: 11.5 }], deliveryFee: 0, vatRateBps: 1500, vatIncluded: true, vatMinor: 0 };
      core.reapplyVat(sar, 'SAR');
      expect(sar.vatMinor).toBe(450);
    });
  });

  it('totals an order from its own snapshot, like Order.totalMinor', () => {
    expect(core.orderMinor({ items: [{ qty: 2, price: 5, cost: 1 }], deliveryFee: 1, vatIncluded: false, vatMinor: 1100, payments: [{ amount: 3 }] }, 3))
      .toEqual({ itemsAndDelivery: 11000, vat: 1100, total: 12100, paid: 3000, cost: 2000, due: 9100 });
    expect(core.orderMinor({ items: [{ qty: 1, price: 11 }], deliveryFee: 0, vatIncluded: true, vatMinor: 1000, payments: [] }, 3))
      .toMatchObject({ vat: 1000, total: 11000 });
    expect(core.orderMinor({ items: [{ qty: 1, price: 1.25 }], deliveryFee: 0, payments: [] }, 2)).toMatchObject({ vat: 0, total: 125 });
  });
});

// Integrity review R2/R3 (3 Oct 2026): "Unchanged physical stock must not rise or fall solely because
// tracking was toggled." An order keeps what it actually took out of every product in its own ledger,
// `stockDeducted` { productId: units }, and gives back exactly that. Statuses and today's tracking switches
// say nothing about the past: not the product's own `track`, and not the shop-wide switch either.
describe('stock', () => {
  const ids = () => { let n = 0; return () => `m${++n}`; };
  const at = NOW.toISOString();
  const ON = { shopTracking: true }, OFF = { shopTracking: false };
  const products = () => [
    { id: 'p1', track: true, qty: 5, stockMoves: [] },
    { id: 'p2', track: false, qty: 0 },
    { id: 'p3', track: true, qty: 1, stockMoves: Array.from({ length: 50 }, (_, i) => ({ id: `old${i}` })) },
  ];
  const items = () => [{ pid: 'p1', qty: 2 }, { pid: 'p2', qty: 1 }, { pid: 'p3', qty: 1 }, { pid: null, qty: 4 }];
  const order = (over = {}) => ({ id: 'o1', status: 'new', items: items(), ...over });
  const qtys = ps => Object.fromEntries(ps.map(p => [p.id, p.qty]));
  /** What the app does on an edit (app.js FORMS['edit-items']): stock first, then the lines change. */
  const edit = (ps, o, next, opts = ON) => {
    const changed = core.stockForEdit(ps, o, next, at, ids(), opts);
    o.items = next;
    return changed;
  };
  /** What the app does on a status change (app.js setStatus): stock first, then the status. */
  const move = (ps, o, to, opts = ON) => {
    const changed = core.stockForStatus(ps, o, o.status, to, at, ids(), opts);
    o.status = to;
    return changed;
  };

  describe('into confirmed, ready or collected', () => {
    it('takes the units of the products that track stock, writes them as the ledger, with an orderConfirmed move first', () => {
      const ps = products(), o = order();
      const changed = core.stockForStatus(ps, o, 'new', 'confirmed', at, ids(), ON);
      expect(changed.map(p => p.id)).toEqual(['p1', 'p3']);
      expect(o.stockDeducted).toEqual({ p1: 2, p3: 1 }); // not p2 (it does not track stock), not the custom line
      expect(qtys(ps)).toEqual({ p1: 3, p2: 0, p3: 0 });
      expect(ps[0].stockMoves[0]).toEqual({ id: 'm1', delta: -2, reason: 'orderConfirmed', orderId: 'o1', note: null, at });
      expect(ps[1].stockMoves).toBeUndefined();
      expect(ps[2].stockMoves).toHaveLength(50);
      expect(ps[2].stockMoves[0].reason).toBe('orderConfirmed');
      expect(ps[2].stockMoves[49].id).toBe('old48');
    });

    it('does the same from new or cancelled into any of the three statuses', () => {
      for (const from of ['new', 'cancelled', 'other']) {
        for (const to of ['confirmed', 'ready', 'collected']) {
          const ps = products(), o = order();
          core.stockForStatus(ps, o, from, to, at, ids(), ON);
          expect(o.stockDeducted).toEqual({ p1: 2, p3: 1 });
          expect(qtys(ps)).toEqual({ p1: 3, p2: 0, p3: 0 });
        }
      }
    });

    it("sums an order's lines of one product into one ledger entry and one move", () => {
      const ps = products(), o = order({ items: [{ pid: 'p1', qty: 1 }, { pid: 'p1', qty: 2 }, { pid: 'custom', qty: 9 }] });
      core.stockForStatus(ps, o, 'new', 'confirmed', at, ids(), ON);
      expect(o.stockDeducted).toEqual({ p1: 3 });
      expect(ps[0].qty).toBe(2);
      expect(ps[0].stockMoves).toHaveLength(1);
      expect(ps[0].stockMoves[0]).toMatchObject({ delta: -3, reason: 'orderConfirmed' });
    });

    it("takes nothing while the shop's stock tracking is off: no stock move, and the ledger says { }", () => {
      for (const options of [OFF, undefined, {}]) {
        const ps = products(), o = order();
        expect(core.stockForStatus(ps, o, 'new', 'confirmed', at, ids(), options)).toEqual([]);
        expect(o.stockDeducted).toEqual({});
        expect(qtys(ps)).toEqual({ p1: 5, p2: 0, p3: 1 });
        expect(ps[0].stockMoves).toEqual([]);
        expect(ps[2].stockMoves).toHaveLength(50);
        expect(ps[2].stockMoves[0].id).toBe('old0');
      }
    });

    it('takes nothing of a product that does not track stock (it is not in the ledger either)', () => {
      const ps = products(), o = order({ items: [{ pid: 'p2', qty: 3 }] });
      core.stockForStatus(ps, o, 'new', 'confirmed', at, ids(), ON);
      expect(o.stockDeducted).toEqual({});
      expect(ps[1].qty).toBe(0);
    });

    it('does nothing between two statuses that hold stock, or two that do not, and leaves the ledger as it is', () => {
      const held = () => order({ status: 'confirmed', stockDeducted: { p1: 2 } });
      for (const [from, to] of [['confirmed', 'ready'], ['ready', 'collected'], ['collected', 'ready'], ['ready', 'confirmed']]) {
        const ps = products(), o = held();
        expect(core.stockForStatus(ps, o, from, to, at, ids(), ON)).toEqual([]);
        expect(o.stockDeducted).toEqual({ p1: 2 });
        expect(qtys(ps)).toEqual({ p1: 5, p2: 0, p3: 1 });
      }
      for (const [from, to] of [['new', 'cancelled'], ['cancelled', 'new'], ['new', 'other']]) {
        const ps = products(), o = order();
        expect(core.stockForStatus(ps, o, from, to, at, ids(), ON)).toEqual([]);
        expect(o).not.toHaveProperty('stockDeducted'); // nothing was taken and nothing needs saying
        expect(qtys(ps)).toEqual({ p1: 5, p2: 0, p3: 1 });
      }
    });
  });

  describe('out of them (cancelled, or back to new)', () => {
    it('gives back exactly the ledger, with an orderCancelled move per product, then the ledger is { }', () => {
      for (const to of ['cancelled', 'new']) {
        const ps = products(), o = order({ status: 'ready', stockDeducted: { p1: 2, p3: 1 } });
        const changed = core.stockForStatus(ps, o, 'ready', to, at, ids(), ON);
        expect(changed.map(p => p.id)).toEqual(['p1', 'p3']);
        expect(qtys(ps)).toEqual({ p1: 7, p2: 0, p3: 2 });
        expect(ps[0].stockMoves[0]).toEqual({ id: 'm1', delta: 2, reason: 'orderCancelled', orderId: 'o1', note: null, at });
        expect(o.stockDeducted).toEqual({});
      }
    });

    it('gives it back whatever the tracking switches say now: the product switched off, the shop switched off', () => {
      const ps = products(), o = order({ status: 'confirmed', stockDeducted: { p1: 2, p2: 3 } });
      ps[0].track = false; // p1 was switched off since the order was confirmed
      // p2 does not track stock now either, but it did when the order took 3 of it: the goods come back.
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), OFF);
      expect(qtys(ps)).toEqual({ p1: 7, p2: 3, p3: 1 });
      expect(ps[1].stockMoves[0]).toMatchObject({ delta: 3, reason: 'orderCancelled', orderId: 'o1' });
      expect(o.stockDeducted).toEqual({});
    });

    it('never gives back what the order did not take, however the products track now (it would invent stock)', () => {
      const ps = products(), o = order({ status: 'confirmed', stockDeducted: { p1: 2 } }); // p3 was not tracked at confirmation
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(qtys(ps)).toEqual({ p1: 7, p2: 0, p3: 1 });
      const none = order({ status: 'confirmed', stockDeducted: {} }); // it took nothing at all
      const again = products();
      expect(core.stockForStatus(again, none, 'confirmed', 'cancelled', at, ids(), ON)).toEqual([]);
      expect(qtys(again)).toEqual({ p1: 5, p2: 0, p3: 1 });
    });

    it('skips a product that no longer exists', () => {
      const ps = products(), o = order({ status: 'confirmed', stockDeducted: { p1: 2, gone: 5 } });
      const changed = core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(changed.map(p => p.id)).toEqual(['p1']);
      expect(o.stockDeducted).toEqual({});
    });
  });

  describe('editing the items of an order that holds stock', () => {
    const held = (stockDeducted = { p1: 2 }, status = 'confirmed') => order({ status, items: [{ pid: 'p1', qty: 2 }], stockDeducted });
    const heldProducts = () => [{ id: 'p1', track: true, qty: 8, stockMoves: [] }, { id: 'p2', track: false, qty: 0 }, { id: 'p3', track: true, qty: 4, stockMoves: [] }];

    it('moves the difference of a product in the ledger (an orderEdited move) and the entry follows, gone at 0', () => {
      const ps = heldProducts(), o = held();
      expect(edit(ps, o, [{ pid: 'p1', qty: 5 }]).map(p => p.id)).toEqual(['p1']);
      expect(ps[0].qty).toBe(5);
      expect(ps[0].stockMoves[0]).toEqual({ id: 'm1', delta: -3, reason: 'orderEdited', orderId: 'o1', note: null, at });
      expect(o.stockDeducted).toEqual({ p1: 5 });
      edit(ps, o, [{ pid: 'p1', qty: 1 }]);
      expect([ps[0].qty, o.stockDeducted]).toEqual([9, { p1: 1 }]);
      edit(ps, o, [{ pid: 'p3', qty: 1 }]); // the line goes, and another product's line comes
      expect(ps[0].qty).toBe(10);
      expect(o.stockDeducted).not.toHaveProperty('p1');
    });

    it("does it even when tracking is off now: the shop switch, and the product's own", () => {
      const ps = heldProducts(), o = held();
      ps[0].track = false;
      edit(ps, o, [{ pid: 'p1', qty: 4 }], OFF);
      expect([ps[0].qty, o.stockDeducted]).toEqual([6, { p1: 4 }]);
      edit(ps, o, [{ pid: 'p1', qty: 1 }], OFF);
      expect([ps[0].qty, o.stockDeducted]).toEqual([9, { p1: 1 }]);
    });

    it('never gives back more than the ledger holds (a ledger smaller than the line: some units never left)', () => {
      const ps = heldProducts(), o = order({ status: 'ready', items: [{ pid: 'p1', qty: 3 }], stockDeducted: { p1: 1 } });
      edit(ps, o, [{ pid: 'p3', qty: 1 }]);
      expect(ps[0].qty).toBe(9);
      expect(o.stockDeducted).toEqual({ p3: 1 });
    });

    it('a NEW line takes its units when the shop and the product track stock, and is then in the ledger', () => {
      const ps = heldProducts(), o = held({});
      edit(ps, o, [{ pid: 'p1', qty: 2 }, { pid: 'p3', qty: 2 }]);
      expect(qtys(ps)).toEqual({ p1: 8, p2: 0, p3: 2 });
      expect(ps[2].stockMoves[0]).toMatchObject({ delta: -2, reason: 'orderEdited', orderId: 'o1' });
      expect(o.stockDeducted).toEqual({ p3: 2 });
    });

    it("a new line takes nothing with the shop's tracking off, or for a product that does not track", () => {
      const ps = heldProducts(), o = held({});
      edit(ps, o, [{ pid: 'p1', qty: 2 }, { pid: 'p3', qty: 2 }], OFF);
      expect(qtys(ps)).toEqual({ p1: 8, p2: 0, p3: 4 });
      expect(o.stockDeducted).toEqual({});
      edit(ps, o, [{ pid: 'p1', qty: 2 }, { pid: 'p3', qty: 2 }, { pid: 'p2', qty: 3 }], ON);
      expect(qtys(ps)).toEqual({ p1: 8, p2: 0, p3: 4 }); // p3's line is not new any more; p2 does not track
      expect(o.stockDeducted).toEqual({});
    });

    it('a line that was already there and never took stock stays out: more, less or removed moves nothing', () => {
      const ps = heldProducts(), o = held({});
      edit(ps, o, [{ pid: 'p1', qty: 5 }]);
      edit(ps, o, [{ pid: 'p1', qty: 1 }]);
      expect(qtys(ps)).toEqual({ p1: 8, p2: 0, p3: 4 });
      edit(ps, o, [{ pid: 'p3', qty: 1 }]); // p1's line goes; p3's line is new
      expect(qtys(ps)).toEqual({ p1: 8, p2: 0, p3: 3 });
      expect(o.stockDeducted).toEqual({ p3: 1 });
    });

    it('a line moved to another product gives the first back and takes the second', () => {
      const ps = heldProducts(), o = held();
      edit(ps, o, [{ pid: 'p3', qty: 2 }]);
      expect(qtys(ps)).toEqual({ p1: 10, p2: 0, p3: 2 });
      expect(o.stockDeducted).toEqual({ p3: 2 });
    });

    it('sums lines of one product, and ignores custom lines and lines with no product', () => {
      const ps = heldProducts(), o = held();
      edit(ps, o, [{ pid: 'p1', qty: 1 }, { pid: 'p1', qty: 2 }, { pid: null, qty: 7 }, { pid: 'custom', qty: 7 }]);
      expect([ps[0].qty, o.stockDeducted]).toEqual([7, { p1: 3 }]);
    });

    it('changes nothing when no quantity changed, and leaves the ledger as it is', () => {
      const ps = heldProducts(), o = held();
      expect(edit(ps, o, [{ pid: 'p1', qty: 2, price: 9 }])).toEqual([]);
      expect([ps[0].qty, o.stockDeducted]).toEqual([8, { p1: 2 }]);
    });

    it('moves nothing for an order that holds no stock (new or cancelled), and leaves it without a ledger', () => {
      for (const status of ['new', 'cancelled']) {
        const ps = heldProducts(), o = held(undefined, status);
        delete o.stockDeducted;
        expect(edit(ps, o, [{ pid: 'p1', qty: 6 }])).toEqual([]);
        expect(o).not.toHaveProperty('stockDeducted');
        expect(ps[0].qty).toBe(8);
      }
    });

    it('a product that no longer exists keeps the ledger in step without a stock move', () => {
      const ps = heldProducts(), o = order({ status: 'confirmed', items: [{ pid: 'gone', qty: 2 }], stockDeducted: { gone: 2 } });
      expect(edit(ps, o, [{ pid: 'gone', qty: 1 }])).toEqual([]);
      expect(o.stockDeducted).toEqual({ gone: 1 });
    });
  });

  describe('a legacy order (no stockDeducted)', () => {
    const MOVE = (delta, reason, orderId = 'o1') => ({ id: `x${delta}${reason}`, delta, reason, orderId, note: null, at });

    it('derives the ledger from the stock moves that carry its id: net units taken out, summed with their signs, only where positive', () => {
      const ps = [
        { id: 'a', track: true, qty: 1, stockMoves: [MOVE(-3, 'orderConfirmed'), MOVE(-1, 'orderEdited'), MOVE(3, 'orderCancelled'), MOVE(-3, 'orderConfirmed')] }, // 3 + 1 - 3 + 3 = 4
        { id: 'b', track: true, qty: 1, stockMoves: [MOVE(-2, 'orderConfirmed'), MOVE(2, 'orderCancelled')] }, // took and gave back: 0
        { id: 'c', track: true, qty: 1, stockMoves: [MOVE(4, 'orderCancelled')] }, // gave back what was never taken: -4, kept out (it would invent stock)
        { id: 'd', track: true, qty: 1, stockMoves: [MOVE(-5, 'correction'), MOVE(-5, 'received'), MOVE(-5, 'damaged')] }, // manual moves are no order's
        { id: 'e', track: true, qty: 1, stockMoves: [MOVE(-6, 'orderConfirmed', 'o2')] }, // another order's
        { id: 'f', track: false, qty: 1, stockMoves: [MOVE(-1, 'orderConfirmed')] }, // dormant now, but it took 1 then
        { id: 'g', track: true, qty: 1 }, // no moves
      ];
      expect(core.ledgerFromMoves(ps, 'o1')).toEqual({ a: 4, f: 1 });
      expect(core.ledgerFromMoves(ps, 'nobody')).toEqual({});
      expect(core.ledgerFromMoves(ps, undefined)).toEqual({});
      expect(core.ledgerFromMoves(undefined, 'o1')).toEqual({});
    });

    it('leaving a held status: gives back what its moves say it took, and writes { }', () => {
      const ps = [{ id: 'p1', track: true, qty: 7, stockMoves: [MOVE(-3, 'orderConfirmed')] }, { id: 'p3', track: true, qty: 1, stockMoves: [] }];
      const o = order({ status: 'confirmed', items: [{ pid: 'p1', qty: 3 }, { pid: 'p3', qty: 1 }] });
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(qtys(ps)).toEqual({ p1: 10, p3: 1 }); // p3 took nothing then (no moves): nothing back
      expect(o.stockDeducted).toEqual({});
    });

    it("the review's sequence: confirmed while tracking was off (no moves), tracking on, cancelled: nothing comes back", () => {
      const ps = [{ id: 'p1', track: true, qty: 10, stockMoves: [] }];
      const o = order({ status: 'confirmed', items: [{ pid: 'p1', qty: 3 }] });
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(ps[0].qty).toBe(10); // it was 13
    });

    it('known limit: a product keeps only its last 50 moves, so a very old order may derive { } and give back nothing', () => {
      const newer = Array.from({ length: 50 }, (_, i) => MOVE(-1, 'orderConfirmed', `later${i}`));
      const ps = [{ id: 'p1', track: true, qty: 7, stockMoves: newer }]; // o1's own confirmation fell off the end
      const o = order({ status: 'confirmed', items: [{ pid: 'p1', qty: 3 }] });
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(ps[0].qty).toBe(7); // under-counts, never invents
      expect(o.stockDeducted).toEqual({});
    });

    it('an item edit derives the ledger first, applies the edit, and writes it in the same change', () => {
      const ps = [{ id: 'p1', track: true, qty: 7, stockMoves: [MOVE(-3, 'orderConfirmed'), MOVE(10, 'received', null)] }];
      const o = order({ status: 'confirmed', items: [{ pid: 'p1', qty: 3 }] });
      edit(ps, o, [{ pid: 'p1', qty: 4 }]);
      expect(ps[0].qty).toBe(6);
      expect(o.stockDeducted).toEqual({ p1: 4 });
      // ... and an edit that moves no units still writes what was derived.
      const same = [{ id: 'p1', track: true, qty: 7, stockMoves: [MOVE(-3, 'orderConfirmed')] }];
      const o2 = order({ status: 'ready', items: [{ pid: 'p1', qty: 3 }] });
      expect(edit(same, o2, [{ pid: 'p1', qty: 3, price: 12 }])).toEqual([]);
      expect(o2.stockDeducted).toEqual({ p1: 3 });
    });

    it('an item edit of a legacy order that took nothing: { } is written, an older line stays out, a new line takes its units', () => {
      const ps = [{ id: 'p1', track: true, qty: 10, stockMoves: [] }, { id: 'p3', track: true, qty: 4, stockMoves: [] }];
      const o = order({ status: 'confirmed', items: [{ pid: 'p1', qty: 3 }] });
      edit(ps, o, [{ pid: 'p1', qty: 5 }, { pid: 'p3', qty: 1 }]);
      expect(qtys(ps)).toEqual({ p1: 10, p3: 3 });
      expect(o.stockDeducted).toEqual({ p3: 1 });
    });

    it('the demo has no moves: its stockApplied flag says the order took its units of the products that track stock', () => {
      const ps = products();
      const flagged = order({ status: 'confirmed', stockApplied: true });
      expect(core.ledgerFromFlag(ps, flagged)).toEqual({ p1: 2, p3: 1 });
      expect(core.ledgerFromFlag(ps, order({ status: 'confirmed', stockApplied: false }))).toEqual({});
      expect(core.ledgerFromFlag(ps, order({ status: 'confirmed' }))).toEqual({});
      const o = order({ status: 'confirmed', stockApplied: true });
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), { shopTracking: true, legacy: core.ledgerFromFlag });
      expect(qtys(ps)).toEqual({ p1: 7, p2: 0, p3: 2 });
      expect(o.stockDeducted).toEqual({});
    });
  });

  describe('the ledger as the cloud carries it', () => {
    it('reads a clean { productId: whole units > 0 }; nothing else is a ledger', () => {
      expect(core.ledgerOf({ stockDeducted: { p1: 2, p2: 0, p3: -1, p4: 1.5, p5: '2', p6: null, '': 4, p7: 3 } })).toEqual({ p1: 2, p7: 3 });
      expect(core.ledgerOf({ stockDeducted: {} })).toEqual({});
      for (const v of [undefined, null, 'p1:2', 5, true, [], [{ p1: 2 }]]) expect(core.ledgerOf({ stockDeducted: v })).toBeUndefined();
      expect(core.ledgerOf(null)).toBeUndefined();
      const proto = core.ledgerOf({ stockDeducted: JSON.parse('{"__proto__": 3, "p1": 1}') });
      expect(Object.keys(proto)).toEqual(['p1']);
      expect({}.polluted).toBeUndefined();
    });

    it('an order with a ledger { } does not derive anything from moves: it took nothing', () => {
      const ps = [{ id: 'p1', track: true, qty: 7, stockMoves: [{ id: 'm', delta: -3, reason: 'orderConfirmed', orderId: 'o1' }] }];
      const o = order({ status: 'confirmed', stockDeducted: {} });
      core.stockForStatus(ps, o, 'confirmed', 'cancelled', at, ids(), ON);
      expect(ps[0].qty).toBe(7);
    });
  });

  // The review's acceptance sequences: tracking switched off then on, and on then off, around confirmation,
  // cancellation, item edits and re-confirmation. Physical stock (10 on the shelf) ends where reality says.
  describe("the review's sequences", () => {
    const cake = (over = {}) => ({ id: 'p1', track: true, qty: 10, stockMoves: [], ...over });
    const cakes = n => order({ items: [{ pid: 'p1', qty: n }] });

    it('product tracking off at confirmation, on at cancellation: stays 10 (it was 13)', () => {
      const ps = [cake({ track: false })], o = cakes(3);
      move(ps, o, 'confirmed');
      expect(ps[0].qty).toBe(10);
      ps[0].track = true;
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);
    });

    it('product tracking on at confirmation, off at cancellation: back to 10 (it stayed 7)', () => {
      const ps = [cake()], o = cakes(3);
      move(ps, o, 'confirmed');
      expect(ps[0].qty).toBe(7);
      ps[0].track = false;
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);
    });

    it('the shop-wide switch off at confirmation, on at cancellation: stays 10; on then off: back to 10', () => {
      const ps = [cake()], o = cakes(3);
      move(ps, o, 'confirmed', OFF);
      move(ps, o, 'cancelled', ON);
      expect(ps[0].qty).toBe(10);
      const p2 = [cake()], o2 = cakes(3);
      move(p2, o2, 'confirmed', ON);
      expect(p2[0].qty).toBe(7);
      move(p2, o2, 'cancelled', OFF);
      expect(p2[0].qty).toBe(10);
    });

    it("an item edit follows what the order took, not today's switches", () => {
      const ps = [cake()], o = cakes(3);
      move(ps, o, 'confirmed');
      ps[0].track = false;
      edit(ps, o, [{ pid: 'p1', qty: 5 }], OFF); // 2 more left the shelf
      expect(ps[0].qty).toBe(5);
      ps[0].track = true;
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);

      const q = [cake({ track: false })], o2 = cakes(3);
      move(q, o2, 'confirmed'); // took nothing
      q[0].track = true;
      edit(q, o2, [{ pid: 'p1', qty: 5 }]); // a line that never took stock: nothing moves
      expect(q[0].qty).toBe(10);
      move(q, o2, 'cancelled');
      expect(q[0].qty).toBe(10);
    });

    it('confirm, cancel, reopen and confirm again, with the switches moving in between', () => {
      const ps = [cake()], o = cakes(3);
      move(ps, o, 'confirmed');
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);
      ps[0].track = false;
      move(ps, o, 'new');
      move(ps, o, 'confirmed'); // took nothing this time
      expect(ps[0].qty).toBe(10);
      ps[0].track = true;
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);
      move(ps, o, 'new');
      move(ps, o, 'confirmed');
      expect(ps[0].qty).toBe(7);
      move(ps, o, 'ready');
      move(ps, o, 'collected');
      move(ps, o, 'cancelled');
      expect(ps[0].qty).toBe(10);
    });

    // Many random sequences. Whatever the switches do, the shelf plus what the orders hold is the stock we
    // started with, an order holds units only while it is confirmed, ready or collected, never more than its
    // lines, and when every order is cancelled the shelf is exactly where it began.
    it('holds for random sequences of switches, status changes and item edits', () => {
      let seed = 20261003;
      const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return Math.floor((seed / 2 ** 32) * n); };
      const STATUSES = ['new', 'confirmed', 'ready', 'collected', 'cancelled'];
      const HOLDING = ['confirmed', 'ready', 'collected'];
      const problems = [];
      for (let run = 0; run < 300; run++) {
        const ps = [cake({ qty: 20 }), cake({ id: 'p2', qty: 5, track: false })];
        const orders = [order({ id: 'a', items: [{ pid: 'p1', qty: 3 }] }), order({ id: 'b', items: [{ pid: 'p1', qty: 2 }, { pid: 'p2', qty: 1 }] })];
        let shop = true;
        for (let step = 0; step < 40; step++) {
          const o = orders[rnd(2)], pick = rnd(6);
          if (pick === 0) shop = !shop;
          else if (pick === 1) { const p = ps[rnd(2)]; p.track = !p.track; }
          else if (pick <= 3) move(ps, o, STATUSES[rnd(5)], { shopTracking: shop });
          else edit(ps, o, [{ pid: 'p1', qty: rnd(5) }, { pid: 'p2', qty: rnd(3) }].filter(x => x.qty > 0).concat(rnd(2) ? [{ pid: 'p1', qty: 1 }] : []), { shopTracking: shop });
          const held = pid => orders.reduce((sum, x) => sum + ((x.stockDeducted && x.stockDeducted[pid]) || 0), 0);
          if (ps[0].qty + held('p1') !== 20 || ps[1].qty + held('p2') !== 5) problems.push(`run ${run} step ${step}: the shelf and the orders no longer add up to the stock we started with`);
          orders.forEach(x => {
            const lines = pid => x.items.filter(it => it.pid === pid).reduce((sum, it) => sum + it.qty, 0);
            const ledger = x.stockDeducted || {};
            if (!HOLDING.includes(x.status) && Object.keys(ledger).length) problems.push(`run ${run} step ${step}: ${x.status} order ${x.id} still holds stock`);
            Object.keys(ledger).forEach(pid => { if (ledger[pid] > lines(pid)) problems.push(`run ${run} step ${step}: order ${x.id} holds more ${pid} than its lines`); });
          });
        }
        orders.forEach(x => move(ps, x, 'cancelled', { shopTracking: rnd(2) === 0 }));
        if (ps[0].qty !== 20 || ps[1].qty !== 5) problems.push(`run ${run}: the shelf ended at ${ps[0].qty} and ${ps[1].qty}, not 20 and 5`);
      }
      expect(problems.slice(0, 5)).toEqual([]);
    });
  });
});

describe('new order deposit (integrity review R5)', () => {
  const check = (text, totalMinor = 6500, currency = 'BHD') => core.checkDeposit(text, totalMinor, currency);

  it('refuses 65 on a 6.500 order (a slip of the decimal point), and gives the total back for the message', () => {
    expect(check('65')).toEqual({ ok: false, error: 'over', totalMinor: 6500 });
    expect(check('6.501')).toEqual({ ok: false, error: 'over', totalMinor: 6500 });
  });

  it('accepts a part of the total and all of it, in the currency\'s minor units', () => {
    expect(check('5')).toEqual({ ok: true, amount: 5, minor: 5000 });
    expect(check(' 2.25 ')).toEqual({ ok: true, amount: 2.25, minor: 2250 });
    expect(check(6.5)).toEqual({ ok: true, amount: 6.5, minor: 6500 });
    expect(check('6.500')).toEqual({ ok: true, amount: 6.5, minor: 6500 });
    expect(check('0.001')).toEqual({ ok: true, amount: 0.001, minor: 1 });
  });

  it('refuses what is not a finite number above 0: empty, zero, negative, text, NaN, Infinity', () => {
    for (const v of ['', '   ', '0', '0.000', '-1', '-0.5', 'abc', '1,5', '6.5.1', '1e400', 'Infinity', '-Infinity', 'NaN', null, undefined, NaN, Infinity, -Infinity, -5, 0, '0.0004']) {
      expect(check(v), String(v)).toEqual({ ok: false, error: 'amount' });
    }
  });

  it("rounds to the currency's decimals before comparing: BHD 3, SAR 2", () => {
    expect(check('6.5004')).toMatchObject({ ok: true, minor: 6500 });
    expect(check('6.5005')).toEqual({ ok: false, error: 'over', totalMinor: 6500 });
    expect(check('1.2345')).toEqual({ ok: true, amount: 1.235, minor: 1235 });
    expect(check('6.504', 650, 'SAR')).toMatchObject({ ok: true, minor: 650 });
    expect(check('6.505', 650, 'SAR')).toEqual({ ok: false, error: 'over', totalMinor: 650 });
    expect(check('0.004', 650, 'SAR')).toEqual({ ok: false, error: 'amount' });
  });

  it('on a free order (total 0) any deposit is more than the total', () => {
    expect(check('1', 0)).toEqual({ ok: false, error: 'over', totalMinor: 0 });
    expect(check('', 0)).toEqual({ ok: false, error: 'amount' });
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

describe('out for delivery', () => {
  const OUT = '2026-09-29T07:30:00.000Z';

  it('is a ready order with outForDeliveryAt set', () => {
    expect(core.isOutForDelivery({ status: 'ready', outForDeliveryAt: OUT })).toBe(true);
    expect(core.isOutForDelivery({ status: 'ready', outForDeliveryAt: null })).toBe(false);
    expect(core.isOutForDelivery({ status: 'ready' })).toBe(false);
    expect(core.isOutForDelivery({ status: 'collected', outForDeliveryAt: OUT })).toBe(false); // an older app delivered it
    expect(core.isOutForDelivery(null)).toBe(false);
  });

  it('puts the step between Ready and Delivered for delivery orders only', () => {
    const step = (status, fulfillment, outForDeliveryAt = null, options) => core.nextStep({ status, fulfillment, outForDeliveryAt }, options);
    expect(['new', 'confirmed', 'ready', 'collected', 'cancelled', 'other'].map(s => step(s, 'delivery'))).toEqual(['confirmed', 'ready', 'out', null, null, null]);
    expect(step('ready', 'delivery', OUT)).toBe('collected');
    expect(step('ready', 'pickup')).toBe('collected');
    expect(step('ready', 'delivery', null, { out: false })).toBe('collected');
  });

  it('labels the history step: out for delivery, or back to Ready', () => {
    expect(core.historyLabel({ kind: 'outForDelivery', value: OUT })).toEqual({ key: 'history.outForDelivery' });
    expect(core.historyLabel({ kind: 'outForDelivery', value: true })).toEqual({ key: 'history.outForDelivery' });
    for (const value of [null, '', false, 'false', undefined]) expect(core.historyLabel({ kind: 'outForDelivery', value })).toEqual({ key: 'history.backToReady' });
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

  // How app.js describes the shop (addressPlace): a Bahrain shop's area list, labels in the app's language.
  const place = (over = {}) => ({
    bahrain: true, sep: ', ', labels: { block: 'Block', road: 'Road', building: 'Building', flat: 'Flat' },
    areaCode: name => ({ riffa: 'riffa', 'الرفاع': 'riffa', manama: 'manama' })[String(name).toLowerCase()] || '',
    ...over,
  });

  it('reads the delivery keys from the draft, else from the answer (an older server sends none)', () => {
    expect(core.answerDraft({ draft: { notes: 'x', items: [] }, lang: 'ar' })).toEqual({ notes: 'x', items: [] });
    expect(core.answerDraft({ draft: { fulfillment: 'pickup' }, fulfillment: 'delivery', address: { text: 'A' }, deliveryNote: 'Call' }))
      .toEqual({ fulfillment: 'pickup', address: { text: 'A' }, deliveryNote: 'Call' });
    expect(core.answerDraft({ draft: { fulfillment: null }, fulfillment: 'delivery' })).toEqual({ fulfillment: 'delivery' });
    expect(core.answerDraft(null)).toEqual({});
  });

  it("puts a Bahrain address into the area list and the address line, the delivery note last, and leaves the notes alone", () => {
    const d = core.draftFields({
      items: [], notes: 'No nuts', fulfillment: 'delivery',
      address: { area: 'Riffa', block: '935', road: 3510, building: '12', flat: '4' }, deliveryNote: 'Call when outside',
    }, products, place());
    expect(d).toEqual({ items: [], notes: 'No nuts', fulfillment: 'delivery', area: 'riffa', address: 'Block 935, Road 3510, Building 12, Flat 4\nCall when outside' });
    const ar = core.draftFields({ items: [], fulfillment: 'delivery', address: { area: 'الرفاع', block: '٩٣٥' } }, products, place({ sep: '، ', labels: { block: 'مجمع' } }));
    expect(ar).toEqual({ items: [], fulfillment: 'delivery', area: 'riffa', address: 'مجمع ٩٣٥' });
  });

  it('writes a Saudi or UAE address (no area list) as the single address field', () => {
    const saudi = core.draftFields({ items: [], fulfillment: 'delivery', address: { text: 'حي العليا، شارع الأمير سلطان، الرياض' } }, products, place({ bahrain: false }));
    expect(saudi).toEqual({ items: [], fulfillment: 'delivery', address: 'حي العليا، شارع الأمير سلطان، الرياض' });
    const uae = core.draftFields({ items: [], address: { area: 'Al Barsha', city: 'Dubai', building: 'Tower 2', flat: '1203' }, deliveryNote: 'Reception' }, products, place({ bahrain: false, sep: '، ', labels: { flat: 'شقة' } }));
    expect(uae).toEqual({ items: [], fulfillment: 'delivery', address: 'Al Barsha، Dubai، Tower 2، شقة 1203\nReception' });
    expect(core.draftFields({ items: [], fulfillment: 'delivery', address: { area: 'Riffa' } }, products, place({ bahrain: false })).address).toBe('Riffa');
  });

  it('takes pickup or delivery as said, and an address with neither said as a delivery', () => {
    expect(core.draftFields({ items: [], fulfillment: 'pickup' }, products, place())).toEqual({ items: [], fulfillment: 'pickup' });
    expect(core.draftFields({ items: [], fulfillment: 'later', address: null, deliveryNote: '' }, products, place())).toEqual({ items: [] });
    expect(core.draftFields({ items: [], fulfillment: null, address: { area: 'Manama' } }, products, place())).toEqual({ items: [], fulfillment: 'delivery', area: 'manama' });
    expect(core.draftFields({ items: [], deliveryNote: 'Gate 2' }, products, place())).toEqual({ items: [], fulfillment: 'delivery', address: 'Gate 2' });
    // A caller that does not say how the shop writes addresses gets no address.
    expect(core.draftFields({ items: [], fulfillment: 'delivery', address: { text: 'x' } }, products)).toEqual({ items: [], fulfillment: 'delivery' });
  });

  it('labels bare numbers only, takes a known city when the area is not on the list, and skips repeats', () => {
    expect(core.deliveryAddress({ area: 'Seef', city: 'Manama', block: 'Block 428', road: '٢٨٠٣' }, '', place()))
      .toEqual({ area: 'manama', address: 'Seef, Block 428, Road ٢٨٠٣' });
    expect(core.deliveryAddress({ block: '1', text: 'Block 1' }, '', place())).toEqual({ area: '', address: 'Block 1' });
    expect(core.deliveryAddress({ area: 'Dubai', city: ' dubai ' }, '', place({ bahrain: false }))).toEqual({ area: '', address: 'Dubai' });
    expect(core.deliveryAddress('Villa 7', 'Ring twice', place())).toEqual({ area: '', address: 'Villa 7\nRing twice' });
    expect(core.deliveryAddress({ block: {}, road: NaN, text: 42 }, null, place())).toEqual({ area: '', address: '42' });
    expect(core.deliveryAddress(undefined, undefined, place())).toEqual({ area: '', address: '' });
  });
});

describe('default delivery fee', () => {
  it('reads the setting value { feeMinor }; anything else is no default', () => {
    expect(core.deliveryFeeMinor({ feeMinor: 1500 })).toBe(1500);
    expect(core.deliveryFeeMinor({ feeMinor: 0, freeAbove: 20000 })).toBe(0);
    for (const v of [null, undefined, 'x', [1500], { feeMinor: -5 }, { feeMinor: 1.5 }, { feeMinor: '1500' }, { feeMinor: NaN }]) expect(core.deliveryFeeMinor(v)).toBe(0);
  });

  it('fills the default into a delivery whose fee is still empty or 0 and untouched, and takes it out on pickup', () => {
    const turn = (state, fulfillment) => core.feeForFulfillment(state, fulfillment, 1.5);
    expect(turn({ fee: '', touched: false, auto: false }, 'delivery')).toEqual({ fee: '1.5', auto: true });
    expect(turn({ fee: '0', touched: false, auto: false }, 'delivery')).toEqual({ fee: '1.5', auto: true });
    expect(turn({ fee: '1.5', touched: false, auto: true }, 'delivery')).toEqual({ fee: '1.5', auto: true }); // the AI says delivery again
    expect(turn({ fee: '1.5', touched: false, auto: true }, 'pickup')).toEqual({ fee: '', auto: false });
    expect(turn(undefined, 'delivery')).toEqual({ fee: '1.5', auto: true });
  });

  it("never changes a fee the seller typed (0 included) or an order's saved fee, and does nothing without a default", () => {
    const turn = (state, fulfillment, fee = 1.5) => core.feeForFulfillment(state, fulfillment, fee);
    expect(turn({ fee: '2', touched: true }, 'delivery')).toEqual({ fee: '2', auto: false });
    expect(turn({ fee: '0', touched: true }, 'delivery')).toEqual({ fee: '0', auto: false });
    expect(turn({ fee: '2', touched: true }, 'pickup')).toEqual({ fee: '2', auto: false });
    expect(turn({ fee: 3, touched: false, auto: false }, 'delivery')).toEqual({ fee: '3', auto: false });
    expect(turn({ fee: '', touched: false, auto: false }, 'delivery', 0)).toEqual({ fee: '', auto: false });
    expect(turn({ fee: '', touched: false, auto: false }, 'pickup')).toEqual({ fee: '', auto: false });
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
