import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, toRunning } from '../src/core/document.js';
import { createSyncMap } from '../src/sync/map.js';

const doc = createDocument({ blocks: [
  { id: 'a', text: 'en to tre fire' },
  { id: 'tab', type: 'table', text: 'celle celle', speak: null },
  { id: 'b', text: 'fem seks syv otte ni ti' }
] });
const R = (block, word) => toRunning(doc, { block, word });

test('inside a clip the position moves evenly over its words', () => {
  const m = createSyncMap(doc, [{ block: 'a', start: 0, end: 4 }, { block: 'b', start: 5, end: 11 }]);
  assert.equal(m.grain, 'block');
  assert.deepEqual(m.placeAt(2.5), { running: R('a', 2), frac: 0.5, heard: true });
  assert.equal(m.placeAt(4.5).running, R('a', 3));          // the gap: stays on the last word heard
  assert.equal(m.placeAt(4.5).heard, false);
  assert.equal(m.placeAt(7).running, R('b', 2));
  assert.equal(m.duration, 11);
  assert.deepEqual(m.problems, []);
});

test('a place that is not heard maps to the next clip', () => {
  const m = createSyncMap(doc, [{ block: 'a', start: 0, end: 4 }, { block: 'b', start: 5, end: 11 }]);
  assert.deepEqual(m.timeAt(R('a', 1)), { src: null, time: 1, heard: true });
  assert.deepEqual(m.timeAt(R('tab', 0)), { src: null, time: 5, heard: false });
  assert.equal(m.timeAt(R('b', 5)).time, 10);
});

test('pieces of a block give sentence grain, one clip per word gives word grain', () => {
  const s = createSyncMap(doc, [{ block: 'b', from: 0, to: 3, start: 0, end: 2 }, { block: 'b', from: 3, to: 6, start: 2, end: 5 }]);
  assert.equal(s.grain, 'sentence');
  assert.equal(s.placeAt(3.5).running, R('b', 4));
  const w = createSyncMap(doc, ['en', 'to', 'tre', 'fire'].map((_, i) => ({ block: 'a', from: i, to: i + 1, start: i, end: i + 1 })));
  assert.equal(w.grain, 'word');
  assert.equal(w.timeAt(R('a', 2)).time, 2);
});

test('bad clips are reported and left out, not silently used', () => {
  const m = createSyncMap(doc, [{ block: 'nope', start: 0, end: 1 }, { block: 'a', start: 3, end: 3 }, { block: 'a', start: 0, end: 4 }, { block: 'b', start: 3, end: 9 }]);
  assert.equal(m.clips.length, 2);
  assert.equal(m.problems.length, 3);
  assert.match(m.problems.join('\n'), /unknown block[\s\S]*no length[\s\S]*overlap/);
  assert.equal(createSyncMap(doc, []).placeAt(1), null);
});

test('several audio files are kept apart', () => {
  const m = createSyncMap(doc, [{ block: 'a', src: 'k1.m4a', start: 0, end: 4 }, { block: 'b', src: 'k2.m4a', start: 0, end: 6 }]);
  assert.deepEqual(m.problems, []);
  assert.equal(m.placeAt(1, 'k2.m4a').running, R('b', 1));
  assert.equal(m.timeAt(R('b', 0)).src, 'k2.m4a');
});
