// The views. A way of showing the reading is added by adding one entry here.
// A view is made with create(text, stage) and has:
//   mount()   optional: take over the stage (the area that can cover the text)
//   draw(now) called on every frame with clock.now()
//   clear()   remove everything the view has drawn
// `needs` says what the view requires of a clock (time/clock.js, fits). `covers` is true when
// the view replaces the running text instead of drawing on it.

import { createPacer } from './pacer.js';
import { createRsvp } from './rsvp.js';

export const views = [
  { id: 'pacer', name: 'Pacer', needs: { grain: 'word' }, covers: false, create: createPacer },
  { id: 'rsvp', name: 'RSVP', needs: { grain: 'word', rateUnit: 'wpm' }, covers: true, create: createRsvp }
];
