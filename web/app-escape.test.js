// public/orderat/app.js and live.js build HTML from template strings. Record ids and codes come from
// synced records other members can write, so every one must go through esc() (review C1).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = f => readFileSync(new URL(`../public/orderat/${f}`, import.meta.url), 'utf8');

describe.each(['app.js', 'live.js'])('%s', file => {
  const code = src(file);

  it('never interpolates a record id without esc()', () => {
    const bare = code.match(/\$\{\s*[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\.(id|pid|photoId|customerId)\s*\}/g) || [];
    expect(bare).toEqual([]);
    expect(code.match(/\$\{[^}`]*\?\s*[A-Za-z_$][\w$]*\.id\s*:[^}`]*\}/g) || []).toEqual([]);
  });

  it('never interpolates an order source or status code without esc()', () => {
    const bare = code.match(/\$\{\s*(s|[A-Za-z_$][\w$]*\.(source|status))\s*\}/g) || [];
    expect(bare).toEqual([]);
  });
});
