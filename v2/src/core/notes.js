// Notes and marks (reader-noter/1). A note lives at a place {block, word, quote}, never at a
// running word number, so it survives a new import of the same text and can be matched to the
// block ids of whoever produced the text. Contract: v2/schema/noter.md.

import { quoteAt, resolvePlace, tocPath, pageAt } from './document.js';

export const FORMAT = 'reader-noter/1';

let counter = 0;
const newId = now => 'n' + now.toString(36) + (counter++).toString(36);

/** kind: "note" (has text) or "mark" (a place only). */
export function createNote(doc, place, { text = '', kind = text ? 'note' : 'mark', now = Date.now() } = {}) {
  const block = doc.blocks[doc.index.get(place.block)];
  if (!block) throw new Error('reader-noter: place is not in the document');
  const note = { id: newId(now), kind, block: place.block, word: place.word | 0, quote: quoteAt(doc, place), text: String(text), created: now };
  if (block.label) note.label = block.label;
  return note;
}

/** Notes in reading order with where they are now; notes whose place is gone come last. */
export function locate(doc, notes) {
  return notes
    .map(n => { const r = resolvePlace(doc, n); return { note: n, running: r.how === 'lost' ? Infinity : r.running, how: r.how }; })
    .sort((a, b) => a.running - b.running || a.note.created - b.note.created);
}

/** The file other tools read. Labels and ids are passed through untouched. */
export function exportNotes(doc, notes, { now = Date.now() } = {}) {
  return {
    format: FORMAT,
    exported: new Date(now).toISOString(),
    document: { title: doc.title, source: doc.source },
    notes: locate(doc, notes).map(({ note, running, how }) => {
      const found = how !== 'lost';
      return {
        id: note.id, kind: note.kind, block: note.block, word: note.word, label: note.label || null,
        page: found ? pageAt(doc, running) : null,
        section: found ? tocPath(doc, running).map(e => e.title) : [],
        quote: note.quote, text: note.text, created: new Date(note.created).toISOString(), found: how
      };
    })
  };
}

/** The same notes as plain text, for reading. */
export function exportText(doc, notes) {
  const lines = [doc.title, ''];
  for (const { note, running, how } of locate(doc, notes)) {
    const where = [];
    if (how !== 'lost') { const p = pageAt(doc, running); if (p) where.push('s. ' + p); const t = tocPath(doc, running).pop(); if (t) where.push(t.title); }
    if (note.label) where.push(note.label);
    lines.push(`${note.kind === 'mark' ? '▍' : '✎'} ${where.join(' · ')}`.trimEnd(), `  «${note.quote}»`);
    if (note.text) lines.push('  ' + note.text.replace(/\n/g, '\n  '));
    lines.push('');
  }
  return lines.join('\n');
}
