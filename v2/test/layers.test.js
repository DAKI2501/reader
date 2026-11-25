// The layering rule from docs/arkitektur.md, checked by machine: a module may only import from its
// own layer or a layer below it. This is what keeps new features from being bolted on sideways.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
// lower number = further down; a layer may import from layers with a lower or equal number
const LAYER = { core: 0, import: 1, sync: 1, time: 1, store: 1, views: 2, app: 3 };

function files(dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
}

test('modules only import from their own layer or a layer below', () => {
  const bad = [];
  for (const f of files(src)) {
    const from = relative(src, f).split('/')[0];
    assert.ok(from in LAYER, `unknown layer "${from}" – add it to LAYER and to docs/arkitektur.md`);
    for (const m of readFileSync(f, 'utf8').matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.'), `${relative(src, f)} imports "${m[1]}": no outside packages`);
      const to = relative(src, resolve(dirname(f), m[1])).split('/')[0];
      if (LAYER[to] > LAYER[from]) bad.push(`${relative(src, f)} → ${m[1]}`);
      if (LAYER[to] === LAYER[from] && to !== from) bad.push(`${relative(src, f)} → ${m[1]} (sideways between ${from} and ${to})`);
    }
  }
  assert.deepEqual(bad, []);
});
