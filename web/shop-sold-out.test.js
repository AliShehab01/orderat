// public/orderat/s/sold-out.js: the public shop page's "Sold out" rules (docs/marketing-tools.md).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const load = createRequire(import.meta.url);
const SoldOut = load('../public/orderat/s/sold-out.js');
const src = f => readFileSync(new URL(`../public/orderat/s/${f}`, import.meta.url), 'utf8');

const items = () => [
  { id: 'p1', name: { ar: 'كب تشيز كيك', en: 'Cheesecake cups' }, priceMinor: 4500, available: true },
  { id: 'p2', name: { ar: 'كوكيز', en: 'Cookies' }, priceMinor: 3000, available: true, soldOut: true },
  { id: 'p3', name: { ar: 'براونيز', en: 'Brownies' }, priceMinor: 2500, available: true, soldOut: false },
];

describe('isSoldOut', () => {
  it('is true only for soldOut: true (a missing flag, from an older document, is not sold out)', () => {
    expect(items().map(SoldOut.isSoldOut)).toEqual([false, true, false]);
    expect(SoldOut.isSoldOut(null)).toBe(false);
    expect(SoldOut.isSoldOut({ soldOut: 'true' })).toBe(false);
  });
});

describe('refusedIds', () => {
  it("reads the product ids of the server's 409 sold_out answer", () => {
    expect(SoldOut.refusedIds(409, { error: 'sold_out', productIds: ['p2', 7, '', 'p3'] })).toEqual(['p2', 'p3']);
  });
  it('is null for anything else', () => {
    expect(SoldOut.refusedIds(400, { error: 'sold_out', productIds: ['p2'] })).toBeNull();
    expect(SoldOut.refusedIds(409, { error: 'slug_taken' })).toBeNull();
    expect(SoldOut.refusedIds(409, null)).toBeNull();
  });
});

describe('takeOut', () => {
  it('takes every sold-out product out of a saved cart and returns them for the message', () => {
    const cart = { p1: 2, p2: 1, p3: 4 }, list = items();
    const removed = SoldOut.takeOut(cart, list, null);
    expect(removed.map(x => x.id)).toEqual(['p2']);
    expect(cart).toEqual({ p1: 2, p3: 4 });
  });

  it("takes out the ids the server refused and marks them sold out on the page's copy", () => {
    const cart = { p1: 2, p3: 4 }, list = items();
    const removed = SoldOut.takeOut(cart, list, ['p3', 'gone']);
    expect(removed.map(x => x.id)).toEqual(['p3']);
    expect(cart).toEqual({ p1: 2 });
    expect(list[2].soldOut).toBe(true);
  });

  it('changes nothing when nothing in the cart is sold out', () => {
    const cart = { p1: 1 };
    expect(SoldOut.takeOut(cart, items(), null)).toEqual([]);
    expect(cart).toEqual({ p1: 1 });
  });
});

describe('the shop page', () => {
  it('loads sold-out.js before shop.js', () => {
    const html = src('index.html');
    expect(html.indexOf('src="sold-out.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="sold-out.js"')).toBeLessThan(html.indexOf('src="shop.js"'));
  });

  it('shows a sold-out product with its badge and no add control, and handles the 409', () => {
    const code = src('shop.js');
    expect(code).toMatch(/if \(!available \|\| soldOut \|\| !canOrder\(\)\) \{\s*control = null;/);
    expect(code).toContain('h("span", { class: "badge sold-out", text: t("soldOut") })');
    expect(code).toContain('SoldOut.refusedIds(res.status, res.data)');
    expect(code).toMatch(/soldOut: "نفد"/);
    expect(code).toMatch(/soldOut: "Sold out"/);
  });
});
