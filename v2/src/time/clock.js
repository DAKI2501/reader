// The clock contract. A clock answers one question: where in the document are we now?
// Views (pacer, fixation points, RSVP, stream, plain highlight) only ever talk to a clock, and a
// clock knows nothing about views. Tempo, an audio file and the device voice are three clocks.
// Contract in prose: v2/schema/tidskilde.md.
//
//   kind        'tempo' | 'audio' | 'voice' | …
//   caps        { rateUnit: 'wpm' | 'x', rate: {min, max, step}, grain: 'word' | 'sentence' | 'block',
//                 seek: 'word' | 'sentence' | 'block', background: boolean }
//   load(doc)   take a document (may return a promise)
//   play()      pause()      playing (getter)
//   seek(running)            move to a running word number; snaps to what caps.seek allows
//   now()       → { running, frac }   running word number and how far through that word (0–1)
//   rate (getter)            setRate(n)   in caps.rateUnit, clamped to caps.rate
//   wpm()       the present speed in words per minute, measured or set (for the display)
//   on(type, fn) → off()     'state' (play/pause), 'end', 'seek', 'rate'
//   dispose()

export const CLOCK_METHODS = ['load', 'play', 'pause', 'seek', 'now', 'setRate', 'wpm', 'on', 'dispose'];
export const GRAINS = ['word', 'sentence', 'block'];

/** Throws with a readable message when an object is not a clock. Used by tests and at registration. */
export function assertClock(c) {
  const bad = [];
  if (!c || typeof c.kind !== 'string') bad.push('kind');
  for (const m of CLOCK_METHODS) if (!c || typeof c[m] !== 'function') bad.push(m + '()');
  if (!c || typeof c.playing !== 'boolean') bad.push('playing');
  if (!c || typeof c.rate !== 'number') bad.push('rate');
  const k = c && c.caps;
  if (!k || !['wpm', 'x'].includes(k.rateUnit) || !k.rate || !(k.rate.min < k.rate.max) || !GRAINS.includes(k.grain) || !GRAINS.includes(k.seek) || typeof k.background !== 'boolean') bad.push('caps');
  if (bad.length) throw new Error('not a clock, missing or wrong: ' + bad.join(', '));
  return c;
}

/** What a view needs from a clock. A view declares this; the app only offers combinations that fit. */
export function fits(caps, needs = {}) {
  if (needs.grain && GRAINS.indexOf(caps.grain) > GRAINS.indexOf(needs.grain)) return false;
  if (needs.rateUnit && caps.rateUnit !== needs.rateUnit) return false;
  if (needs.maxWpm && caps.rateUnit === 'wpm' && caps.rate.max < needs.maxWpm) return false;
  return true;
}

/** Tiny event emitter shared by clocks. */
export function emitter() {
  const subs = new Map();
  return {
    on(type, fn) { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type).delete(fn); },
    emit(type, data) { for (const fn of subs.get(type) || []) fn(data); },
    clear() { subs.clear(); }
  };
}
