// Pacer: marks the word the clock is at and keeps it in view. The view contract is in index.js.

export function createPacer(text) {
  const supported = typeof Highlight !== 'undefined' && CSS.highlights;
  let last = -1;
  return {
    draw({ running }) {
      if (running === last) return;
      last = running;
      if (supported) CSS.highlights.set('reader-now', new Highlight(text.range(running)));
      text.reveal(running);
    },
    clear() { last = -1; if (supported) CSS.highlights.delete('reader-now'); }
  };
}

/** Marks and notes shown in the text. Not tied to a clock. */
export function drawNotes(text, places) {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return;
  CSS.highlights.set('reader-note', new Highlight(...places.map(r => text.range(r, 4))));
}
