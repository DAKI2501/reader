// Pacer: marks the word the clock is at and keeps it in view. The first view; the others
// (fixation points, phrases, RSVP, stream) take the same three members.
//   needs   what the view requires of a clock (see time/clock.js, fits)
//   draw    called on every frame with clock.now()
//   clear   remove everything the view has drawn

export function createPacer(text) {
  const supported = typeof Highlight !== 'undefined' && CSS.highlights;
  let last = -1;
  return {
    needs: { grain: 'word' },
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
