// The document model (reader-dok/1). Every importer produces this, every view and clock reads it.
// Contract: v2/schema/dokument.md. No DOM, no storage: runs in the browser and in Node.

export const FORMAT = 'reader-dok/1';

export const BLOCK_TYPES = ['heading', 'para', 'quote', 'list', 'footnote', 'caption', 'table', 'formula', 'reference', 'other'];

export const tokenize = text => String(text).split(/\s+/).filter(Boolean);

// Small synchronous hash (FNV-1a, 32 bit). Ids only have to be stable and unlikely to collide
// inside one document; collisions are resolved with a suffix.
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Id for a block that has none from its source: "r" + hash of its first 12 words, lower-cased,
// letters and digits only. Stable when the same text is imported again.
export function generatedId(text) {
  const key = tokenize(text).slice(0, 12).join(' ').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  return 'r' + fnv(key);
}

/**
 * Build a document from importer output. Blocks without text are dropped, missing ids are
 * generated, and toc/pages entries are checked against the blocks. A toc or page entry names its
 * block by id (`block`) or, before ids exist, by position in the input list (`at`).
 * @param {{title?:string, lang?:string, source?:object, blocks:Array, toc?:Array, pages?:Array}} input
 */
export function createDocument(input) {
  const seen = new Map(), blocks = [], starts = [], index = new Map(), idAt = [];
  let n = 0;
  for (const b of input.blocks || []) {
    idAt.push(null);
    const text = String(b.text ?? '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
    const words = tokenize(text);
    if (!words.length) continue;
    let id = b.id ? String(b.id) : generatedId(text);
    if (seen.has(id)) {
      if (b.id) throw new Error(`reader-dok: duplicate block id "${id}"`);
      const k = seen.get(id) + 1; seen.set(id, k); id = `${id}-${k}`;
    }
    seen.set(id, seen.get(id) || 1);
    const type = BLOCK_TYPES.includes(b.type) ? b.type : 'para';
    const block = { id, type, text, words };
    if (type === 'heading') block.level = Math.min(6, Math.max(1, b.level | 0 || 1));
    if (b.label) block.label = String(b.label);
    if (b.speak === null) block.speak = null; else if (typeof b.speak === 'string' && b.speak.trim() && b.speak !== text) block.speak = b.speak.trim();
    idAt[idAt.length - 1] = id;
    index.set(id, blocks.length); starts.push(n); n += words.length; blocks.push(block);
  }
  const blockOf = e => e.block != null ? String(e.block) : idAt[e.at];
  const point = (e, what) => {
    e = { ...e, block: blockOf(e) };
    if (!index.has(e.block)) throw new Error(`reader-dok: ${what} points at unknown block "${e.block}"`);
    const len = blocks[index.get(e.block)].words.length;
    return Math.min(Math.max(0, e.word | 0), len - 1);
  };
  const toc = (input.toc || []).map(e => ({ title: String(e.title || '').trim(), level: Math.max(1, e.level | 0 || 1), block: blockOf(e), word: point(e, 'toc entry') }));
  const pages = (input.pages || []).map(e => ({ label: String(e.label), block: blockOf(e), word: point(e, 'page') }));
  const doc = { format: FORMAT, title: String(input.title || '').trim() || 'Uden titel', lang: input.lang || null, source: input.source || null, blocks, toc, pages, starts, index, wordCount: n };
  const at = e => starts[index.get(e.block)] + e.word;
  for (const list of [toc, pages]) list.sort((a, b) => at(a) - at(b));
  return doc;
}

/** What crosses a file or storage boundary: the document without derived fields. */
export function serialize(doc) {
  return {
    format: FORMAT, title: doc.title, lang: doc.lang, source: doc.source,
    blocks: doc.blocks.map(({ words, ...b }) => b), toc: doc.toc, pages: doc.pages
  };
}

export function parse(data) {
  if (!data || data.format !== FORMAT) throw new Error(`reader-dok: expected format ${FORMAT}`);
  return createDocument(data);
}

/* ---------- places ----------
   A place is {block, word[, quote]}: a block id and a word index inside that block. The running
   word number (0 … wordCount-1) is only a convenience for views and clocks; it is never stored. */

export function toRunning(doc, place) {
  const i = doc.index.get(place.block);
  if (i === undefined) return null;
  return doc.starts[i] + Math.min(Math.max(0, place.word | 0), doc.blocks[i].words.length - 1);
}

export function blockIndexAt(doc, running) {
  let lo = 0, hi = doc.blocks.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (doc.starts[m] <= running) lo = m; else hi = m - 1; }
  return lo;
}

export function toPlace(doc, running) {
  if (!doc.wordCount) return null;
  const r = Math.min(Math.max(0, Math.floor(running)), doc.wordCount - 1), i = blockIndexAt(doc, r);
  return { block: doc.blocks[i].id, word: r - doc.starts[i] };
}

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The words around a place, kept with it so it can be found again in a changed text. */
export function quoteAt(doc, place, before = 4, after = 8) {
  const r = toRunning(doc, place);
  if (r === null) return '';
  const i = doc.index.get(place.block), b = doc.blocks[i], w = r - doc.starts[i];
  return b.words.slice(Math.max(0, w - before), w + after + 1).join(' ');
}

/**
 * Find a stored place in a document. Order: the block id; then the quote anywhere in the text.
 * Returns {running, how} where how is "id", "quote" or "lost" (running 0).
 */
export function resolvePlace(doc, place) {
  const r = place ? toRunning(doc, place) : null;
  if (r !== null) return { running: r, how: 'id' };
  const q = place && place.quote ? norm(place.quote) : '';
  if (q) {
    for (let i = 0; i < doc.blocks.length; i++) {
      const hay = norm(doc.blocks[i].text), at = hay.indexOf(q);
      if (at < 0) continue;
      const word = at ? hay.slice(0, at).trim().split(' ').length : 0;
      return { running: doc.starts[i] + Math.min(word, doc.blocks[i].words.length - 1), how: 'quote' };
    }
  }
  return { running: 0, how: 'lost' };
}

/* ---------- contents and pages ---------- */

const runningOf = (doc, e) => doc.starts[doc.index.get(e.block)] + e.word;

function lastAtOrBefore(doc, list, running) {
  let lo = -1, hi = list.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (runningOf(doc, list[m]) <= running) lo = m; else hi = m - 1; }
  return lo;
}

/** The chain of contents entries a position lies under, outermost first (course → lecture → topic). */
export function tocPath(doc, running) {
  const k = lastAtOrBefore(doc, doc.toc, running), path = [];
  if (k < 0) return path;
  let level = Infinity;
  for (let i = k; i >= 0; i--) if (doc.toc[i].level < level) { level = doc.toc[i].level; path.unshift({ ...doc.toc[i], i }); if (level === 1) break; }
  return path;
}

/** Contents as a flat list with start and end (running word numbers) for each entry. */
export function tocSpans(doc) {
  return doc.toc.map((e, i) => {
    let j = i + 1;
    while (j < doc.toc.length && doc.toc[j].level > e.level) j++;
    return { ...e, i, start: runningOf(doc, e), end: j < doc.toc.length ? runningOf(doc, doc.toc[j]) : doc.wordCount };
  });
}

/** The next or previous contents entry from a position, at most as deep as maxLevel. */
export function tocStep(doc, running, dir, maxLevel = Infinity) {
  const spans = tocSpans(doc).filter(e => e.level <= maxLevel);
  if (dir > 0) return spans.find(e => e.start > running) || null;
  // going back first returns to the start of the current entry, then to the one before
  const cur = [...spans].reverse().find(e => e.start <= running);
  if (!cur) return null;
  if (running - cur.start > 3) return cur;
  return [...spans].reverse().find(e => e.start < cur.start) || null;
}

/** The printed page a position is on, or null when the text has no page list. */
export function pageAt(doc, running) {
  const k = lastAtOrBefore(doc, doc.pages, running);
  return k < 0 ? null : doc.pages[k].label;
}

/** Problems that would make a document unsafe to use. Empty list = valid. */
export function validate(doc) {
  const out = [];
  if (doc.format !== FORMAT) out.push(`format is not ${FORMAT}`);
  if (!doc.blocks.length) out.push('no blocks');
  const ids = new Set();
  for (const b of doc.blocks) {
    if (ids.has(b.id)) out.push(`duplicate block id ${b.id}`);
    ids.add(b.id);
    if (!BLOCK_TYPES.includes(b.type)) out.push(`block ${b.id}: unknown type ${b.type}`);
  }
  for (const e of doc.toc) if (!ids.has(e.block)) out.push(`toc entry "${e.title}" points at unknown block`);
  for (const e of doc.pages) if (!ids.has(e.block)) out.push(`page ${e.label} points at unknown block`);
  return out;
}
