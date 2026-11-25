import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/core/document.js';
import { assertClock, fits } from '../src/time/clock.js';
import { createTempoClock, profiles } from '../src/time/tempo.js';

const doc = createDocument({ blocks: [{ text: Array.from({ length: 1000 }, (_, i) => 'w' + i).join(' ') }] });
function setup(opts = {}) { let t = 0; const c = createTempoClock({ time: () => t, ...opts }); c.load(doc); return { c, step: ms => { t += ms; } }; }

test('the tempo clock fulfils the clock contract', () => {
  const { c } = setup();
  assert.doesNotThrow(() => assertClock(c));
  assert.throws(() => assertClock({ kind: 'x' }), /not a clock/);
});

test('300 words per minute is five words a second; pauses do not count', () => {
  const { c, step } = setup({ wpm: 300 });
  c.play(); step(2000);
  assert.equal(c.now().running, 10);
  c.pause(); step(60000);
  assert.equal(c.now().running, 10);
  c.play(); step(100);
  assert.deepEqual(c.now(), { running: 10, frac: 0.5 });
  assert.equal(c.playedMs, 2100);
});

test('changing tempo and seeking take effect from where the reading is', () => {
  const { c, step } = setup({ wpm: 300 });
  const seen = []; c.on('rate', e => seen.push(e.rate));
  c.play(); step(1000); c.setRate(600); step(1000);
  assert.equal(c.now().running, 15);
  c.seek(100); step(500);
  assert.equal(c.now().running, 105);
  c.setRate(99999);
  assert.deepEqual(seen, [600, 2000]);
});

test('the clock stops and says so at the end of the text', () => {
  const { c, step } = setup({ wpm: 600 });
  let ended = 0; c.on('end', () => ended++);
  c.play(); step(200000);
  assert.equal(c.playing, false);
  assert.deepEqual(c.now(), { running: 999, frac: 1 });
  assert.equal(ended, 1);
});

test('profiles change the tempo over time without touching the clock', () => {
  const sprint = setup({ wpm: 300, profile: profiles.sprint({ factor: 2, on: 20, every: 60 }) });
  sprint.c.play(); sprint.step(20000);
  assert.equal(sprint.c.now().running, 200);       // 20 s at 600
  sprint.step(40000);
  assert.equal(sprint.c.now().running, 400);       // + 40 s at 300
  const ramp = setup({ wpm: 300, profile: profiles.ramp({ perMinute: 60 }) });
  ramp.c.play(); ramp.step(60000);
  assert.ok(Math.abs(ramp.c.now().running - 330) <= 1); // average 330 over the first minute
  assert.ok(Math.abs(ramp.c.wpm() - 360) < 1);
});

test('a view only gets a clock that fits what it needs', () => {
  const { c } = setup();
  assert.equal(fits(c.caps, { grain: 'word', maxWpm: 900 }), true);
  const audio = { rateUnit: 'x', rate: { min: 0.5, max: 3 }, grain: 'sentence', seek: 'sentence', background: true };
  assert.equal(fits(audio, { grain: 'word' }), false);      // RSVP needs word timing
  assert.equal(fits(audio, { grain: 'block' }), true);      // plain highlight does not
  assert.equal(fits(audio, { rateUnit: 'wpm' }), false);    // sprint intervals need a tempo clock
});
