// The text on the page. Renders a document once and answers two questions for the other views:
// which piece of the page is word n, and which word is at this point on the screen.
// Words are not wrapped in elements; they are addressed as ranges inside each block's text.

export function createTextView(root, doc) {
  root.textContent = '';
  const els = doc.blocks.map(b => {
    const el = document.createElement(b.type === 'heading' ? 'h' + Math.min(6, b.level + 1) : 'p');
    el.className = b.type; el.dataset.id = b.id;
    el.textContent = b.words.join(' ');
    root.append(el);
    return el;
  });
  const offsets = new Map();   // block index → character offset of each word, made when first needed
  function offs(i) {
    if (!offsets.has(i)) { let at = 0; offsets.set(i, doc.blocks[i].words.map(w => { const a = at; at += w.length + 1; return a; })); }
    return offsets.get(i);
  }
  function blockOf(running) {
    let lo = 0, hi = doc.blocks.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (doc.starts[m] <= running) lo = m; else hi = m - 1; }
    return lo;
  }

  return {
    /** A range covering `count` words from word number `running` (kept inside one block). */
    range(running, count = 1) {
      const i = blockOf(running), b = doc.blocks[i], o = offs(i), w = running - doc.starts[i];
      const last = Math.min(b.words.length - 1, w + count - 1), node = els[i].firstChild, r = document.createRange();
      r.setStart(node, o[w]); r.setEnd(node, o[last] + b.words[last].length);
      return r;
    },
    /** The word number at a point on the screen, or null outside the text. */
    wordAt(x, y) {
      const p = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
      const r = p ? { node: p.offsetNode, offset: p.offset } : (c => c && { node: c.startContainer, offset: c.startOffset })(document.caretRangeFromPoint && document.caretRangeFromPoint(x, y));
      const el = r && r.node && (r.node.nodeType === 3 ? r.node.parentElement : r.node), i = el ? els.indexOf(el) : -1;
      if (i < 0) return null;
      const o = offs(i); let w = o.length - 1;
      while (w > 0 && o[w] > r.offset) w--;
      return doc.starts[i] + w;
    },
    /** Bring a word to a comfortable height in the window. */
    reveal(running, smooth = true) {
      const box = this.range(running).getBoundingClientRect(), h = innerHeight;
      if (box.top > h * 0.25 && box.bottom < h * 0.6) return;
      scrollBy({ top: box.top - h * 0.38, behavior: smooth ? 'smooth' : 'instant' });
    }
  };
}
