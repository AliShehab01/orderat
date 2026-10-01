// public/orderat/app.js: the New order (and Edit items) quantity − / + buttons used to be announced as
// just "−" and "+" (accessibility retest, 1 Oct 2026). They now say what they do and to which line,
// "Increase quantity of Cheesecake" / "زيادة كمية تشيز كيك", in the shop's language, while the icons
// stay what is seen. The items editor is run here as the page runs it, with i18n.js's real labels.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const src = f => readFileSync(new URL(`../public/orderat/${f}`, import.meta.url), 'utf8');
const app = src('app.js');

/** The source of a one-line `const name = ...;` from app.js. */
function constLine(name) {
  const line = app.split('\n').find(l => l.startsWith(`const ${name} = `));
  if (!line) throw new Error(`app.js has no const ${name}`);
  return line;
}
/** The source of a top-level `function name(...) {...}` from app.js (its braces are balanced). */
function functionSource(name) {
  const start = app.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`app.js has no function ${name}`);
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced function ${name}`);
}

const PRODUCTS = [
  { id: 'p1', nameAr: 'تشيز كيك', nameEn: 'Cheesecake', price: 4.5, active: true },
  { id: 'p2', nameAr: 'كوكيز "سارة"', nameEn: `Sara's "Best" cookies`, price: 3, active: true },
];

/** itemsEditor(items, 'd') in `lang`, with stand-ins only for what draws icons. */
function renderItems(lang, items) {
  const sandbox = { S: { lang, addressAs: 'male', products: PRODUCTS } };
  vm.runInNewContext([
    src('i18n.js'),
    "const icon = name => `<svg data-icon=\"${name}\"></svg>`;",
    ...['esc', 'pick', 'pName', 'productOf', 'qtyNum', 'lineName', 'lineLabel'].map(constLine),
    functionSource('itemsEditor'),
    'this.html = itemsEditor(this.items, "d");',
  ].join('\n'), Object.assign(sandbox, { items }));
  return sandbox.html;
}

/** Every quantity button's aria-label (attribute text, still HTML-escaped) and icon, in order. */
const stepButtons = html => [...html.matchAll(/<button type="button" data-act="item-qty"[^>]*aria-label="([^"]*)"><svg data-icon="(\w+)"/g)].map(m => [m[1], m[2]]);

describe('New order quantity buttons', () => {
  const items = [{ pid: 'p1', qty: 2, price: 4.5 }, { pid: 'custom', name: '', qty: 1, price: 0 }, { pid: 'custom', name: 'Brownies', qty: 3, price: 1 }];

  it('name the action and the line in English, keeping the − / + icons', () => {
    expect(stepButtons(renderItems('en', items))).toEqual([
      ['Decrease quantity of Cheesecake', 'minus'],
      ['Increase quantity of Cheesecake', 'plus'],
      ['Remove Custom item', 'trash'], // one left: − takes the line out, as its icon shows
      ['Increase quantity of Custom item', 'plus'],
      ['Decrease quantity of Brownies', 'minus'],
      ['Increase quantity of Brownies', 'plus'],
    ]);
  });

  it('and in Arabic', () => {
    expect(stepButtons(renderItems('ar', items))).toEqual([
      ['تقليل كمية تشيز كيك', 'minus'],
      ['زيادة كمية تشيز كيك', 'plus'],
      ['حذف صنف آخر', 'trash'],
      ['زيادة كمية صنف آخر', 'plus'],
      ['تقليل كمية Brownies', 'minus'],
      ['زيادة كمية Brownies', 'plus'],
    ]);
  });

  it('escape the item name inside the label', () => {
    expect(stepButtons(renderItems('en', [{ pid: 'p2', qty: 2, price: 3 }])).map(([label]) => label)).toEqual([
      'Decrease quantity of Sara&#39;s &quot;Best&quot; cookies',
      'Increase quantity of Sara&#39;s &quot;Best&quot; cookies',
    ]);
  });
});

describe.each(['app.js', 'live.js'])('%s', file => {
  it('labels no button with a bare symbol', () => {
    expect(src(file).match(/aria-label="[+−-]"/g) || []).toEqual([]);
  });
});
