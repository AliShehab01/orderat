// Integrity review (3 Oct 2026): the call sites in app.js and live.js. The rules themselves are tested in
// live-core.test.js; these keep the screens wired to them.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const core = createRequire(import.meta.url)('../public/orderat/live-core.js');
const src = f => readFileSync(new URL(`../public/orderat/${f}`, import.meta.url), 'utf8');
const app = src('app.js'), live = src('live.js'), demo = src('demo.js');
const forms = app.slice(app.indexOf('const FORMS = {'));
const actions = app.slice(app.indexOf('const ACTIONS = {'), app.indexOf('const FORMS = {'));
const END = '\n  },\n';
// The body of one entry of FORMS (`handler`) or ACTIONS (`action`): from its key to the closing brace.
const entry = (table, name) => {
  const start = table.search(new RegExp(`^  '?${name}'?\\(`, 'm'));
  expect(start).toBeGreaterThan(-1);
  return table.slice(start, table.indexOf(END, start));
};
const handler = name => entry(forms, name);
const action = name => entry(actions, name);

describe('R1: an existing order keeps its own VAT', () => {
  it('snapshots the shop VAT only where an order is created', () => {
    const uses = [...app.matchAll(/snapshotOrderVat\(/g)].length;
    expect(uses).toBe(3); // its definition, web-add and new-order
    expect(app).not.toMatch(/Live\.applyOrderVat\((?!order\))/);
    expect(live.match(/applyOrderVat/g).length).toBeLessThanOrEqual(3);
  });
  it('recomputes from the order\'s own rate on every edit of its details and of its items', () => {
    expect(handler('edit-order')).toContain('reapplyOrderVat(o)');
    expect(handler('edit-items')).toContain('reapplyOrderVat(o)');
    expect(handler('edit-order')).not.toMatch(/\b(snapshotOrderVat|applyOrderVat)\b/);
    expect(handler('edit-items')).not.toMatch(/\b(snapshotOrderVat|applyOrderVat)\b/);
  });
  it('shows the order\'s own VAT in the demo too', () => {
    expect(app).toContain('const orderVatRate = o => Live.vatOf(o);');
    expect(app).toMatch(/function totals\(o\) \{\s*return Live\.totals\(o\);/);
  });
});

describe('R3: stock follows the order ledger', () => {
  it('goes through live-core in both modes, with the edit before the lines change', () => {
    expect(app).not.toMatch(/applyStock|Live\.stockFor/);
    expect(handler('edit-items').indexOf('stockForEdit(o, items)')).toBeGreaterThan(-1);
    expect(handler('edit-items').indexOf('stockForEdit(o, items)')).toBeLessThan(handler('edit-items').indexOf('o.items = items'));
    expect(app).toMatch(/function setStatus\(o, status\) \{\s*stockForStatus\(o, status\);\s*o\.status = status;/);
  });
  it('saving a product with the shop switch off leaves track, quantity and threshold alone', () => {
    expect(app).toContain('if (S.stockEnabled) Object.assign(data, { track:');
  });
});

describe('R5: a new order\'s deposit', () => {
  it('is checked against the final total before any customer or order is touched', () => {
    const h = handler('new-order');
    expect(h.indexOf('checkDeposit')).toBeGreaterThan(-1);
    expect(h.indexOf('checkDeposit')).toBeLessThan(h.indexOf('draftCustomer'));
    expect(h.indexOf('showDraftErrors(errors)')).toBeLessThan(h.indexOf('draftCustomer'));
    expect(h).toContain("t('neworder.depositOverTotal'");
  });
});

// Fourth review R2/R3: a payment is identified by its id and payments are add-only on the wire, so every
// way the web drops a payment must also put its id into the order's removedPaymentIds (live-core.js
// removePayment, tested in live-core.test.js). Both modes share these handlers.
describe('R2/R3: a deleted payment is remembered in removedPaymentIds', () => {
  it('the delete button goes through removePayment, not through a filter of o.payments', () => {
    const h = action('delete-payment');
    expect(h).toContain('OrderatLiveCore.removePayment(o,');
    expect(h).not.toMatch(/\.payments\s*=/);
    expect(h.indexOf('removePayment')).toBeLessThan(h.indexOf('save()')); // the id is on the order before it is saved
  });
  it('so does the Undo of a payment just recorded, by the id the payment was given', () => {
    const h = handler('payment');
    expect(h).toContain('OrderatLiveCore.removePayment(now, { id: pay.id,');
    expect(h).not.toMatch(/\.payments\s*=/);
    expect(h.indexOf('removePayment')).toBeLessThan(h.lastIndexOf('save()'));
  });
  it('and no other code drops a payment by rebuilding the list', () => {
    expect(app).not.toMatch(/\.payments\s*=\s*[\w.]+\.payments\.filter/);
    expect([...app.matchAll(/removePayment\(/g)]).toHaveLength(2); // the delete button and the Undo
  });
  it('every payment the web makes has its id from the start: the Undo and a later delete can always remember it', () => {
    expect(handler('payment')).toMatch(/const pay = \{ id: nid\(\),/);
    expect(handler('payment')).toContain('o.payments.push(pay);');
    expect(handler('new-order')).toMatch(/order\.payments\.push\(\{ id: nid\(\),/);
    expect(demo).toMatch(/order\.payments\.push\(\{ id: demoId\(\),/);
    // and no code path added later can make one without: every push of a payment names its id first
    expect([...app.matchAll(/\.payments\.push\(/g)].length).toBeGreaterThan(0);
    expect(app.match(/\.payments\.push\((?!pay\)|\{ id: nid\(\),)[^\n]*/g)).toBeNull();
  });
  it('the demo, run for real: every seeded payment has its own id in every business type, and deleting one is remembered', () => {
    const sandbox = {};
    vm.runInNewContext(`${demo}\nthis.makeDemoData = makeDemoData;`, sandbox);
    for (const type of ['home', 'shop', 'services', 'food', 'foodTruck', 'other']) {
      const data = sandbox.makeDemoData(type, new Date('2026-09-29T08:00:00.000Z'));
      const payments = data.orders.flatMap(o => o.payments);
      expect(payments.length).toBeGreaterThan(10);
      payments.forEach(p => expect(typeof p.id === 'string' && p.id.length > 0).toBe(true));
      expect(new Set(payments.map(p => p.id)).size).toBe(payments.length);
      data.orders.forEach(o => expect(o).not.toHaveProperty('removedPaymentIds')); // nothing deleted yet: no key
      const order = data.orders.find(o => o.payments.length), id = order.payments[0].id;
      expect(core.removePayment(order, { id })).toBe(true);
      expect(order.removedPaymentIds).toEqual([id]);
    }
  });
  it('a backup is the whole state, so orders carry the list out and back in', () => {
    expect(action('export')).toContain('data: S');
    const importer = app.slice(app.indexOf('  import(el) {'));
    expect(importer.slice(0, importer.indexOf(END))).toContain('S = Object.assign(d,'); // the backup's orders as they are
  });
});
