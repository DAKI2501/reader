// Plain text → document. The paragraph rules (line-end hyphens, text with a hard break on every
// line, citation lines from e-book platforms) are taken from the old Reader:
// DAKI2501/reader @ 1652e0d, index.html, "text → document". Changed here: returns reader-dok/1
// through createDocument instead of a list of paragraphs, and Markdown-style "# " lines become
// headings with a contents entry.

import { createDocument } from '../core/document.js';

const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
// Line-end hyphens: ASCII, soft hyphen, Unicode hyphen and non-breaking hyphen.
const HY_LOWER = /\p{Ll}[-­‐‑]$/u, HY_UPPER = /[\p{Lu}\d][-‐‑]$/u;
function joinTwo(out, l) {
  if (!out) return l;
  if (HY_LOWER.test(out) && /^\p{Ll}/u.test(l)) return out.slice(0, -1) + l;
  if (HY_UPPER.test(out) && /^\p{L}/u.test(l)) return out + l;
  return out + ' ' + l;
}
function joinLines(lines) {
  let out = '';
  for (let l of lines) { l = l.trim(); if (l) out = joinTwo(out, l); }
  return out;
}
const PARA_END = /[.!?:»”"')\]]$/;

const VENDOR_LINE = /ProQuest Ebook Central|ebookcentral\.proquest\.com|^\s*central\.proquest\.com|^\s*Created from \S+ on \d{4}-\d{2}-\d{2}|^\s*Copyright\s*©\s*\d{4}\b.*All rights reserved\.?\s*$/i;
function vendorDrop(texts) {
  const drop = new Set();
  texts.forEach((t, i) => {
    if (!VENDOR_LINE.test(t)) return;
    drop.add(i);
    // author and title of the citation often sit on the line before
    if (/^\s*ProQuest Ebook Central/i.test(t) && i > 0 && /\b(1[89]|20)\d\d\.?\s*$/.test(texts[i - 1]) && texts[i - 1].length < 220) drop.add(i - 1);
  });
  return drop;
}

export function paragraphs(raw) {
  let t = String(raw).replace(/\r\n?/g, '\n').replace(/[​‌‍﻿]/g, '').replace(/[\t ]/g, ' ');
  { const ls = t.split('\n'), d = vendorDrop(ls); if (d.size) t = ls.filter((_, i) => !d.has(i)).join('\n'); }
  let blocks;
  if (/\n[ ]*\n/.test(t)) blocks = t.split(/\n[ ]*\n+/).map(b => joinLines(b.split('\n')));
  else {
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const lens = lines.map(l => l.length), M = median(lens);
    // Text copied from a PDF often has a hard break on every line and no blank lines between paragraphs.
    const wrapped = lines.length >= 4 && M >= 30 && M <= 140
      && lens.filter(n => n >= M * 0.6).length >= lines.length * 0.6
      && lines.filter(l => !PARA_END.test(l)).length >= lines.length * 0.4;
    if (wrapped) {
      blocks = []; let cur = '';
      for (const l of lines) {
        cur = joinTwo(cur, l);
        if (PARA_END.test(l) && l.length < M * 0.8) { blocks.push(cur); cur = ''; }
      }
      if (cur) blocks.push(cur);
    } else blocks = lines;
  }
  return blocks.map(s => s.replace(/­/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function titleFrom(paras) {
  const all = (paras[0] || '').split(/\s+/), w = all.slice(0, 7).join(' ');
  return w.length > 60 ? w.slice(0, 57) + '…' : w + (all.length > 7 ? ' …' : '');
}

export function importText(raw, { title, name } = {}) {
  const blocks = [], toc = [];
  for (const p of paragraphs(raw)) {
    const h = /^(#{1,6}) +(.+)$/.exec(p);
    if (h) { toc.push({ title: h[2], level: h[1].length, at: blocks.length }); blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); }
    else blocks.push({ type: 'para', text: p });
  }
  return createDocument({ title: title || titleFrom(blocks.map(b => b.text)), source: { kind: 'text', name: name || null }, blocks, toc });
}
