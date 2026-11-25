import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openZip } from '../src/import/zip.js';

test('entries are read one at a time, stored or compressed', async () => {
  const zip = await openZip(new Blob([readFileSync(new URL('./fixtures/lille.epub', import.meta.url))]));
  assert.ok(zip.has('OEBPS/k1.xhtml'));
  assert.equal(await zip.text('mimetype'), 'application/epub+zip');        // stored
  assert.match(await zip.text('OEBPS/bog.opf'), /Lille prøvebog/);          // compressed
  assert.equal((await zip.entry('mimetype', 'text/plain')).type, 'text/plain');
  assert.equal(await zip.entry('findes-ikke'), null);
  await assert.rejects(openZip(new Blob(['ikke en zip-fil'])), { code: 'zip' });
});
