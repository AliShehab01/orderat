// Integrity review (3 Oct 2026): the call sites in app.js and live.js. The rules themselves are tested in
// live-core.test.js; these keep the screens wired to them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = f => readFileSync(new URL(`../public/orderat/${f}`, import.meta.url), 'utf8');
const app = src('app.js'), live = src('live.js');
const forms = app.slice(app.indexOf('const FORMS = {'));
const END = '\n  },\n';
const handler = name => {
  const start = forms.indexOf(`  '${name}'(`);
  expect(start).toBeGreaterThan(-1);
  return forms.slice(start, forms.indexOf(END, start));
};

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
