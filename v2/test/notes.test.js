import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/core/document.js';
import { createNote, exportNotes, exportText, locate, FORMAT } from '../src/core/notes.js';

const doc = createDocument({
  title: 'Tekst', source: { kind: 'epub', name: 'forelaesning-3.epub' },
  blocks: [{ id: 'h', type: 'heading', text: 'Emne et' }, { id: 'a', label: 'A1 s.37 ¶3', text: 'en to tre fire fem seks syv otte ni ti' }, { id: 'b', text: 'elleve tolv tretten' }],
  toc: [{ title: 'Emne et', level: 1, block: 'h' }], pages: [{ label: '37', block: 'a' }]
});

test('a note carries block id, label and quote; export keeps them untouched', () => {
  const n1 = createNote(doc, { block: 'b', word: 1 }, { now: 2 });
  const n2 = createNote(doc, { block: 'a', word: 5 }, { text: 'vigtigt', now: 1 });
  assert.equal(n1.kind, 'mark'); assert.equal(n2.kind, 'note');
  assert.equal(n2.label, 'A1 s.37 ¶3');
  const out = exportNotes(doc, [n1, n2], { now: 0 });
  assert.equal(out.format, FORMAT);
  assert.deepEqual(out.notes.map(n => n.block), ['a', 'b']);
  assert.deepEqual(out.notes[0], { id: n2.id, kind: 'note', block: 'a', word: 5, label: 'A1 s.37 ¶3', page: '37', section: ['Emne et'], quote: 'to tre fire fem seks syv otte ni ti', text: 'vigtigt', created: '1970-01-01T00:00:00.001Z', found: 'id' });
  assert.match(exportText(doc, [n1, n2]), /✎ s\. 37 · Emne et · A1 s\.37 ¶3\n  «to tre/);
});

test('notes whose place is gone are kept and listed last', () => {
  const lost = { id: 'x', kind: 'note', block: 'zzz', word: 0, quote: 'ukendt sted', text: 't', created: 0 };
  const here = createNote(doc, { block: 'a', word: 0 }, { now: 5 });
  const l = locate(doc, [lost, here]);
  assert.deepEqual(l.map(x => x.how), ['id', 'lost']);
  assert.equal(exportNotes(doc, [lost, here]).notes[1].found, 'lost');
  assert.throws(() => createNote(doc, { block: 'zzz', word: 0 }), /not in the document/);
});
