import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, serialize, parse, toRunning, toPlace, resolvePlace, quoteAt, tocPath, tocSpans, tocStep, pageAt, validate, generatedId } from '../src/core/document.js';

const lecture = () => createDocument({
  title: 'Forelæsning 3',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Forelæsning 3' },
    { id: 'h2a', type: 'heading', level: 2, text: 'Behaviorismen' },
    { id: 'p1', label: 'A1 s.37 ¶3', text: 'Watson afviste introspektion som metode i psykologien.' },
    { id: 't1', type: 'table', text: 'År Navn 1913 Watson', speak: null },
    { id: 'h2b', type: 'heading', level: 2, text: 'Den kognitive vending' },
    { id: 'p2', text: 'Miller beskrev korttidshukommelsens grænse som syv plus minus to.' },
    { text: '   ' }
  ],
  toc: [{ title: 'Forelæsning 3', level: 1, block: 'h1' }, { title: 'Behaviorismen', level: 2, block: 'h2a' }, { title: 'Den kognitive vending', level: 2, block: 'h2b' }],
  pages: [{ label: '37', block: 'p1' }, { label: '38', block: 'p2', word: 4 }]
});

test('empty blocks are dropped and words are counted', () => {
  const d = lecture();
  assert.equal(d.blocks.length, 6);
  assert.equal(d.wordCount, 2 + 1 + 7 + 4 + 3 + 9);
  assert.deepEqual(validate(d), []);
});

test('places and running numbers convert both ways', () => {
  const d = lecture();
  for (let r = 0; r < d.wordCount; r++) assert.equal(toRunning(d, toPlace(d, r)), r);
  assert.deepEqual(toPlace(d, 3), { block: 'p1', word: 0 });
  assert.equal(toRunning(d, { block: 'missing', word: 0 }), null);
});

test('contents have levels; pages are a separate axis', () => {
  const d = lecture(), inP2 = toRunning(d, { block: 'p2', word: 5 });
  assert.deepEqual(tocPath(d, inP2).map(e => e.title), ['Forelæsning 3', 'Den kognitive vending']);
  assert.equal(pageAt(d, inP2), '38');
  assert.equal(pageAt(d, toRunning(d, { block: 'p2', word: 1 })), '37');
  assert.equal(pageAt(d, 0), null);
  const spans = tocSpans(d);
  assert.equal(spans[0].end, d.wordCount);
  assert.equal(spans[1].end, spans[2].start);
});

test('stepping through contents: back goes to the start of the entry first', () => {
  const d = lecture(), inP2 = toRunning(d, { block: 'p2', word: 5 });
  assert.equal(tocStep(d, inP2, -1).title, 'Den kognitive vending');
  assert.equal(tocStep(d, toRunning(d, { block: 'h2b', word: 0 }), -1).title, 'Behaviorismen');
  assert.equal(tocStep(d, 0, +1).title, 'Behaviorismen');
  assert.equal(tocStep(d, inP2, +1), null);
  assert.equal(tocStep(d, inP2, -1, 1).title, 'Forelæsning 3');
});

test('speak: null means shown but not read aloud; equal text is not stored twice', () => {
  const d = createDocument({ blocks: [{ text: 'a b', speak: 'a b' }, { text: 'x²', speak: 'x i anden' }, { text: 'tabel', speak: null }] });
  assert.equal('speak' in d.blocks[0], false);
  assert.equal(d.blocks[1].speak, 'x i anden');
  assert.equal(d.blocks[2].speak, null);
});

test('generated ids are stable, and equal blocks get distinct ids', () => {
  const a = createDocument({ blocks: [{ text: 'Samme tekst her.' }, { text: 'Samme tekst her.' }, { text: 'Noget andet.' }] });
  const b = createDocument({ blocks: [{ text: 'Samme  tekst her.' }, { text: 'Noget andet.' }] });
  assert.equal(a.blocks[0].id, generatedId('Samme tekst her.'));
  assert.notEqual(a.blocks[0].id, a.blocks[1].id);
  assert.equal(a.blocks[0].id, b.blocks[0].id);
  assert.equal(a.blocks[2].id, b.blocks[1].id);
  assert.throws(() => createDocument({ blocks: [{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }] }), /duplicate/);
});

test('a place is found again by quote when the block id has changed', () => {
  const d = lecture(), place = { block: 'p2', word: 3 }, stored = { ...place, quote: quoteAt(d, place) };
  const again = createDocument({ blocks: [{ id: 'new1', text: 'Indledning.' }, { id: 'new2', text: 'Miller beskrev korttidshukommelsens grænse som syv plus minus to.' }] });
  const r = resolvePlace(again, stored);
  assert.equal(r.how, 'quote');
  assert.equal(toPlace(again, r.running).block, 'new2');
  assert.equal(resolvePlace(again, { block: 'gone', word: 0, quote: 'findes ikke' }).how, 'lost');
  assert.equal(resolvePlace(d, stored).how, 'id');
});

test('a document survives being written and read', () => {
  const d = lecture(), back = parse(JSON.parse(JSON.stringify(serialize(d))));
  assert.deepEqual(serialize(back), serialize(d));
  assert.throws(() => parse({ format: 'something-else', blocks: [] }), /expected format/);
  assert.throws(() => createDocument({ blocks: [{ id: 'a', text: 'x' }], toc: [{ title: 't', block: 'nope' }] }), /unknown block/);
});
