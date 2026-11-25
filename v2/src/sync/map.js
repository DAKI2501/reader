// Sync map: the link between time in an audio file and places in a document. One neutral shape,
// whatever the source was (EPUB Media Overlays, a sync.json, forced alignment). The audio clock
// reads positions from it; nothing else in Reader knows where the timings came from.
//
// A clip is { block, start, end[, from, to][, src] }:
//   block       block id
//   start, end  seconds in the audio file
//   from, to    word range inside the block that the clip covers (to is exclusive);
//               left out = the whole block
//   src         audio file, when a document has more than one
// Clips for one file may not overlap. Blocks without a clip are shown but not heard.

/**
 * @returns {{clips:Array, grain:string, duration:number, placeAt:Function, timeAt:Function, problems:string[]}}
 */
export function createSyncMap(doc, clips) {
  const problems = [], out = [];
  for (const c of clips || []) {
    const i = doc.index.get(c.block);
    if (i === undefined) { problems.push(`clip points at unknown block "${c.block}"`); continue; }
    const len = doc.blocks[i].words.length;
    const from = Math.min(Math.max(0, c.from ?? 0), len - 1), to = Math.min(Math.max(from + 1, c.to ?? len), len);
    const start = Number(c.start), end = Number(c.end);
    if (!(end > start) || start < 0) { problems.push(`clip for block "${c.block}" has no length (${c.start}–${c.end})`); continue; }
    out.push({ block: c.block, src: c.src || null, start, end, from, to, first: doc.starts[i] + from, last: doc.starts[i] + to - 1 });
  }
  out.sort((a, b) => (a.src || '').localeCompare(b.src || '') || a.start - b.start);
  for (let k = 1; k < out.length; k++) if (out[k].src === out[k - 1].src && out[k].start < out[k - 1].end - 1e-6) problems.push(`clips overlap at ${out[k].start.toFixed(2)} s (block "${out[k].block}")`);
  const byText = [...out].sort((a, b) => a.first - b.first);

  // How fine the timings are: one clip per word, pieces of a block, or whole blocks.
  const words = out.reduce((n, c) => n + (c.to - c.from), 0);
  const grain = !out.length ? 'block' : words === out.length ? 'word' : out.some(c => c.to - c.from < doc.blocks[doc.index.get(c.block)].words.length) ? 'sentence' : 'block';

  function clipAtTime(t, src = null) {
    let lo = 0, hi = out.length - 1, hit = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1, c = out[m], d = (c.src || '').localeCompare(src || ''); if (d < 0 || (d === 0 && c.start <= t)) { if (d === 0) hit = m; lo = m + 1; } else hi = m - 1; }
    return hit < 0 ? null : out[hit];
  }

  return {
    clips: out, grain, problems,
    duration: out.reduce((m, c) => Math.max(m, c.end), 0),
    /** Where the reading is at time t. Inside a clip the position moves evenly over its words;
        in a gap between clips it stays on the last word heard. */
    placeAt(t, src = null) {
      const c = clipAtTime(t, src);
      if (!c) return out.length ? { running: byText[0].first, frac: 0, heard: false } : null;
      if (t >= c.end) return { running: c.last, frac: 1, heard: false };
      const n = c.to - c.from, x = (t - c.start) / (c.end - c.start) * n, w = Math.min(n - 1, Math.floor(x));
      return { running: c.first + w, frac: x - w, heard: true };
    },
    /** The time at which a running word number is heard. A place that is not heard (a table, a
        skipped block) gives the start of the next clip after it. */
    timeAt(running) {
      let lo = 0, hi = byText.length - 1, hit = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (byText[m].first <= running) { hit = m; lo = m + 1; } else hi = m - 1; }
      const c = hit < 0 ? null : byText[hit];
      if (c && running <= c.last) { const n = c.to - c.from; return { src: c.src, time: c.start + (running - c.first) / n * (c.end - c.start), heard: true }; }
      const next = byText[hit + 1];
      return next ? { src: next.src, time: next.start, heard: false } : null;
    }
  };
}
