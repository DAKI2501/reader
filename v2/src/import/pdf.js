// PDF → document, with pdf.js (Mozilla, Apache 2.0; the copy that Ψ-OCR already ships in ocr/pdfjs).
// The rules for lines, running heads and paragraphs are taken from the old Reader
// (DAKI2501/reader @ 1652e0d, index.html, "PDF": pageLines, assemble, readPdf). Changed here:
// pages become a page list beside the text, the PDF's own page labels are used when it has them,
// and its bookmarks become the contents.

import { createDocument } from '../core/document.js';

const PDFJS = new URL('../../../ocr/pdfjs/', import.meta.url);
let lib = null;
async function pdfjs() {
  if (!lib) { lib = await import(new URL('pdf.min.mjs', PDFJS).href); lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDFJS).href; }
  return lib;
}

const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const pct = (a, q) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
const HY_LOWER = /\p{Ll}[-­‐‑]$/u, HY_UPPER = /[\p{Lu}\d][-‐‑]$/u;
function joinTwo(out, l) {
  if (!out) return l;
  if (HY_LOWER.test(out) && /^\p{Ll}/u.test(l)) return out.slice(0, -1) + l;
  if (HY_UPPER.test(out) && /^\p{L}/u.test(l)) return out + l;
  return out + ' ' + l;
}

/** Text items of one page → lines with position and height. */
function pageLines(items) {
  const lines = []; let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const s = it.str, tr = it.transform, x = tr[4], y = tr[5], h = Math.hypot(tr[2], tr[3]) || it.height || 10;
    if (!cur || Math.abs(y - cur.y) > Math.max(cur.h, h) * 0.5) {
      if (!s.trim()) continue;
      cur = { y, x, h, text: '', right: x }; lines.push(cur);
    }
    if (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(s) && x - cur.right > h * 0.12) cur.text += ' ';
    cur.text += s;
    cur.right = Math.max(cur.right, x + (it.width || 0));
    if (s.trim()) cur.h = Math.max(cur.h, h);
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim().replace(/­(?=.)/g, '');
  return lines.filter(l => l.text);
}

/** Lines of all pages → paragraphs, and for each page the paragraph and word where it begins. */
function assemble(pages) {
  const N = pages.length, key = t => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim(), counts = new Map();
  for (const ls of pages) new Set([...ls.slice(0, 2), ...ls.slice(-2)].map(l => key(l.text))).forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
  // lines that come back at the top or bottom of many pages are running heads; lone numbers there are page numbers
  const repeated = new Set([...counts].filter(([, c]) => N >= 4 && c >= Math.max(3, N * 0.3)).map(([k]) => k));
  const PAGE_RE = /^[-–—\s]*((side|page|s\.)\s*)?(\d{1,4}|[ivxlc]{1,6})(\s*(af|of|\/)\s*\d{1,4})?[-–—\s]*$/i;
  const all = [];
  pages.forEach((ls, page) => ls.forEach((l, i) => {
    if ((i < 2 || i >= ls.length - 2) && (repeated.has(key(l.text)) || PAGE_RE.test(l.text))) return;
    all.push({ ...l, page });
  }));
  const gaps = [];
  for (let i = 1; i < all.length; i++) if (all[i].page === all[i - 1].page) { const g = all[i - 1].y - all[i].y; if (g > 0) gaps.push(g); }
  const medH = median(all.map(l => l.h)) || 10, medGap = median(gaps) || medH * 1.3, Lx = [], Rx = [];
  for (let p = 0; p < N; p++) { const ls = all.filter(l => l.page === p); Lx[p] = pct(ls.map(l => l.x), 0.15); Rx[p] = pct(ls.map(l => l.right), 0.85); }
  const ends = t => /[.!?:»”"')]$/.test(t), count = t => t.split(/\s+/).filter(Boolean).length;
  const paragraphs = [], starts = new Array(N).fill(null);
  let cur = '';
  for (let i = 0; i < all.length; i++) {
    const l = all[i], prev = all[i - 1];
    let brk = !prev;
    if (prev) {
      const sizeJump = Math.abs(l.h - prev.h) > medH * 0.22, shortPrev = prev.right < Rx[prev.page] - medH * 2.5, indented = l.x > Lx[l.page] + medH * 0.8;
      const gap = prev.page === l.page ? prev.y - l.y : 0;
      brk = gap > medGap * 1.45 || gap < -medH || sizeJump || (ends(prev.text) && (shortPrev || indented));
    }
    if (brk && cur) { paragraphs.push(cur); cur = ''; }
    if (!starts[l.page]) starts[l.page] = { at: paragraphs.length, word: cur ? count(cur) : 0 };
    cur = joinTwo(cur, l.text);
  }
  if (cur) paragraphs.push(cur);
  return { paragraphs: paragraphs.map(p => p.replace(/­/g, '')), starts };
}

/** The PDF's bookmarks as contents entries, each pointing at the start of its page. */
async function outline(pdf, starts) {
  const out = [];
  async function walk(items, level) {
    for (const it of items || []) {
      try {
        const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
        const page = dest && (typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : dest[0]);
        if (Number.isInteger(page) && starts[page] && it.title.trim()) out.push({ title: it.title.trim(), level, ...starts[page] });
      } catch (e) { /* a bookmark that points nowhere is left out */ }
      await walk(it.items, level + 1);
    }
  }
  await walk(await pdf.getOutline().catch(() => null), 1);
  return out;
}

export async function importPdf(file, onProgress = () => {}) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise, pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(n, pdf.numPages);
    const page = await pdf.getPage(n);
    pages.push(pageLines((await page.getTextContent()).items));
    page.cleanup();
  }
  const { paragraphs, starts } = assemble(pages);
  // almost no text on the pages: a scan, which needs text recognition first
  if (paragraphs.join(' ').split(/\s+/).length < pdf.numPages * 12) { await task.destroy().catch(() => {}); throw Object.assign(new Error('pdf: scanned'), { code: 'scanned' }); }
  const labels = await pdf.getPageLabels().catch(() => null), toc = await outline(pdf, starts);
  await task.destroy().catch(() => {});
  return createDocument({
    title: file.name.replace(/\.pdf$/i, ''), source: { kind: 'pdf', name: file.name },
    blocks: paragraphs.map(text => ({ type: 'para', text })), toc,
    pages: starts.map((s, i) => s && s.at < paragraphs.length && { label: (labels && labels[i]) || String(i + 1), ...s }).filter(Boolean)
  });
}
