// public/orderat/i18n.js: every label the web app asks for by a literal key (t('...')) exists, in English
// and Arabic, so a screen never shows a raw key such as "pay.onDelivery".
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const src = f => readFileSync(new URL(`../public/orderat/${f}`, import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(`${src('i18n.js')}\nthis.I18N = I18N;`, sandbox);
const { I18N } = sandbox;

describe.each(['app.js', 'live.js'])('%s', file => {
  // Literal keys only: a prefix joined with a code (t('order.status.' + s)) is checked by its screen.
  const keys = [...new Set([...src(file).matchAll(/\bt\('([\w.]+)'(?!\s*\+)/g)].map(m => m[1]))];

  it('asks only for labels i18n.js has, in both languages', () => {
    expect(keys.length).toBeGreaterThan(50);
    const missing = keys.filter(k => !Array.isArray(I18N[k]) || !I18N[k][0] || !I18N[k][1]);
    expect(missing).toEqual([]);
  });
});
