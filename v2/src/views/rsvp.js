// RSVP: one word at a time in a fixed place, so the eyes do not move. The letter the eye should
// rest on (about a third into the word) stays in the middle and is coloured.

export function createRsvp(text, stage) {
  const before = document.createElement('span'), pivot = document.createElement('b'), after = document.createElement('span');
  let last = -1;
  return {
    mount() { stage.replaceChildren(before, pivot, after); stage.hidden = false; },
    draw({ running }) {
      if (running === last) return;
      last = running;
      const w = text.word(running), p = Math.min(w.length - 1, Math.floor((w.replace(/[^\p{L}\p{N}]+$/u, '').length + 2) / 4));
      before.textContent = w.slice(0, p); pivot.textContent = w[p]; after.textContent = w.slice(p + 1);
    },
    clear() { last = -1; stage.hidden = true; stage.replaceChildren(); }
  };
}
