// Tempo clock: the position moves at a set number of words per minute. This is the old Reader's
// only way of keeping time, made into one clock among several.
// A profile turns the base tempo into the tempo right now (steady, rising, sprint intervals), so
// new tempo programs are added as profiles, not as branches in the clock.

import { emitter } from './clock.js';

export const profiles = {
  steady: () => (base) => base,
  // + perMinute words per minute for every minute played
  ramp: ({ perMinute = 25 } = {}) => (base, playedMs) => base + perMinute * playedMs / 60000,
  // the first `on` seconds of every `every` seconds at `factor` × the base tempo
  sprint: ({ factor = 2, on = 20, every = 60 } = {}) => (base, playedMs) => ((playedMs / 1000) % every) < on ? base * factor : base
};

/**
 * @param {{wpm?:number, profile?:Function, time?:()=>number}} opts  time is injected so tests need no real clock
 */
export function createTempoClock({ wpm = 300, profile = profiles.steady(), time = () => performance.now() } = {}) {
  const ev = emitter();
  const caps = { rateUnit: 'wpm', rate: { min: 50, max: 2000, step: 10 }, grain: 'word', seek: 'word', background: false };
  let doc = null, base = wpm, playing = false, pos = 0, played = 0, last = 0;

  // Integrate in small steps so a profile that changes tempo over time is followed closely.
  function settle() {
    if (!playing || !doc) return;
    const t = time();
    let dt = Math.max(0, t - last); last = t;
    const end = doc.wordCount;
    while (dt > 0 && pos < end) {
      const step = Math.min(dt, 50), speed = clamp(profile(base, played));
      pos += speed * step / 60000; played += step; dt -= step;
    }
    if (pos >= end) { pos = end; playing = false; ev.emit('state', { playing }); ev.emit('end'); }
  }
  const clamp = n => Math.min(3000, Math.max(30, n));

  return {
    kind: 'tempo', caps,
    load(d) { doc = d; pos = 0; played = 0; playing = false; },
    play() { if (playing || !doc || pos >= doc.wordCount) return; playing = true; last = time(); ev.emit('state', { playing }); },
    pause() { if (!playing) return; settle(); if (!playing) return; playing = false; ev.emit('state', { playing }); },
    get playing() { settle(); return playing; },
    seek(running) { settle(); pos = Math.min(Math.max(0, Math.floor(running)), Math.max(0, (doc ? doc.wordCount : 1) - 1)); last = time(); ev.emit('seek', { running: pos }); },
    now() {
      settle();
      const max = doc ? Math.max(0, doc.wordCount - 1) : 0, running = Math.min(Math.floor(pos), max);
      return { running, frac: pos >= max + 1 ? 1 : pos - running };
    },
    get rate() { return base; },
    setRate(n) { settle(); base = Math.min(caps.rate.max, Math.max(caps.rate.min, Number(n) || base)); ev.emit('rate', { rate: base }); },
    setProfile(p) { settle(); profile = p; },
    wpm() { return clamp(profile(base, played)); },
    /** Milliseconds actually played in this session (pauses not counted). */
    get playedMs() { settle(); return played; },
    on: ev.on,
    dispose() { playing = false; ev.clear(); }
  };
}
