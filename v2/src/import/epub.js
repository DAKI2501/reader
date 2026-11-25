// EPUB → document. Needs the browser's XML parser.
// Based on the old Reader (DAKI2501/reader @ 1652e0d, index.html, "EPUB"). Changed here:
//  - an element's id becomes the block's id, and its address (file#id) is kept as `ref`
//  - the contents keep their levels and may point into the middle of a file
//  - printed page numbers are read (page-list, or page-break marks in the text) and kept apart
//    from the contents
//  - headings, quotes, lists, captions and tables become typed blocks

import { createDocument } from '../core/document.js';
import { openZip } from './zip.js';

const BLOCK = new Set('address article aside blockquote body dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table ul caption center hgroup'.split(' '));
const SKIP = new Set('script style head rt rp svg math img noscript template title'.split(' '));
const TYPE = { blockquote: 'quote', li: 'list', dd: 'list', dt: 'list', figcaption: 'caption', caption: 'caption' };
const fail = code => Object.assign(new Error('epub: ' + code), { code });
const xml = (t, type = 'application/xml') => new DOMParser().parseFromString(t || '', type);
const all = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const clean = s => s.replace(/\s+/g, ' ').trim();
const epubType = el => el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || el.getAttribute('role') || '';
const resolve = (base, href) => { try { const u = new URL(href, 'http://x/' + base); return decodeURIComponent(u.pathname.slice(1)) + decodeURIComponent(u.hash); } catch (e) { return href; } };
const words = s => s.split(/\s+/).filter(Boolean).length;

export async function importEpub(file, onProgress = () => {}) {
  const zip = await openZip(file);
  if (zip.has('META-INF/rights.xml') || zip.has('META-INF/license.lcpl')) throw fail('drm');
  const enc = await zip.text('META-INF/encryption.xml');
  // font obfuscation is not copy protection; anything else is
  if (enc && all(xml(enc), 'EncryptionMethod').some(m => !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(m.getAttribute('Algorithm') || ''))) throw fail('drm');

  const root = all(xml(await zip.text('META-INF/container.xml')), 'rootfile')[0], opfPath = root && root.getAttribute('full-path');
  if (!opfPath) throw fail('zip');
  const opf = xml(await zip.text(opfPath)), base = opfPath.replace(/[^/]*$/, '');
  const meta = name => clean((all(opf, name)[0] || {}).textContent || '');
  const manifest = new Map(all(opf, 'item').map(it => [it.getAttribute('id'), { path: resolve(base, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' }]));
  const spineEl = all(opf, 'spine')[0];
  const spine = all(opf, 'itemref').filter(r => r.getAttribute('linear') !== 'no').map(r => manifest.get(r.getAttribute('idref'))).filter(m => m && /html/.test(m.type));

  const blocks = [], anchors = new Map(), marks = [], usedIds = new Set();
  for (let i = 0; i < spine.length; i++) {
    onProgress(i + 1, spine.length);
    const src = await zip.text(spine[i].path);
    if (!src) continue;
    let doc = xml(src, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length) doc = xml(src, 'text/html');
    const body = doc.body || doc.getElementsByTagName('body')[0];
    if (body) readFile(body, spine[i].path);
  }

  function readFile(body, path) {
    let buf = '', type = 'para', level = 0, id = null;
    const here = () => ({ at: blocks.length, word: words(buf) });
    const flush = () => {
      const text = clean(buf.replace(/­/g, '')); buf = '';
      if (text) {
        const b = { type, text };
        if (type === 'heading') b.level = level;
        if (id) { b.ref = path + '#' + id; if (!usedIds.has(id)) { usedIds.add(id); b.id = id; } }
        blocks.push(b);
      }
      id = null;
    };
    anchors.set(path, here());
    (function walk(node, inherited) {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { buf += ch.nodeValue; continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.localName.toLowerCase(), kind = epubType(ch), chId = ch.getAttribute('id');
        if (/pagebreak/.test(kind)) { const label = clean(ch.getAttribute('title') || ch.getAttribute('aria-label') || ch.textContent); if (label) marks.push({ label, ...here() }); }
        if (SKIP.has(tag) || /noteref|pagebreak|footnote|endnote|rearnote/.test(kind)) { if (chId) anchors.set(path + '#' + chId, here()); continue; }
        if (tag === 'sup' && /^\W*[\divx*†]{1,4}\W*$/i.test(ch.textContent)) continue;
        if (tag === 'br') { buf += ' '; continue; }
        if (!BLOCK.has(tag)) { if (chId) anchors.set(path + '#' + chId, here()); walk(ch, inherited); continue; }
        flush();
        if (chId) anchors.set(path + '#' + chId, here());
        if (tag === 'table') {   // a table is one block: shown, not read aloud
          const rows = [...ch.getElementsByTagName('tr')].map(tr => [...tr.children].map(c => clean(c.textContent)).filter(Boolean).join(' · ')).filter(Boolean);
          if (rows.length) blocks.push({ type: 'table', text: rows.join(' / '), speak: null, ...(chId && { ref: path + '#' + chId }) });
          continue;
        }
        const h = /^h([1-6])$/.exec(tag), mine = h ? 'heading' : TYPE[tag] || inherited;
        type = mine; level = h ? +h[1] : 0; id = chId || null;
        walk(ch, mine === 'heading' ? 'para' : mine);
        flush();
        type = inherited; level = 0;
      }
    })(body, 'para');
    flush();
  }
  if (!blocks.length) throw fail('empty');

  const target = (from, href) => { const full = resolve(from.replace(/[^/]*$/, ''), href || ''); return anchors.get(full) || anchors.get(full.split('#')[0]); };
  const inBook = e => e && e.at < blocks.length;
  let toc = [], pages = [];
  const navItem = [...manifest.values()].find(m => /\bnav\b/.test(m.props));
  if (navItem) {
    const nav = xml(await zip.text(navItem.path), 'application/xhtml+xml'), navs = [...nav.getElementsByTagName('nav')];
    const list = (kind, fn) => { const n = navs.find(n => epubType(n).includes(kind)) || (kind === 'toc' && navs.find(n => !epubType(n))); if (n) for (const a of n.getElementsByTagName('a')) { const t = target(navItem.path, a.getAttribute('href')); if (inBook(t)) fn(a, t); } };
    const depth = a => { let d = 0; for (let p = a.parentElement; p && p.localName !== 'nav'; p = p.parentElement) if (p.localName === 'ol') d++; return Math.max(1, d); };
    list('toc', (a, t) => toc.push({ title: clean(a.textContent), level: depth(a), ...t }));
    list('page-list', (a, t) => pages.push({ label: clean(a.textContent), ...t }));
  }
  const ncx = spineEl && manifest.get(spineEl.getAttribute('toc'));
  if (!toc.length && ncx) {
    for (const np of all(xml(await zip.text(ncx.path)), 'navPoint')) {
      const label = all(np, 'text')[0], content = all(np, 'content')[0], t = content && target(ncx.path, content.getAttribute('src'));
      let level = 1; for (let p = np.parentElement; p && p.localName === 'navPoint'; p = p.parentElement) level++;
      if (label && inBook(t)) toc.push({ title: clean(label.textContent), level, ...t });
    }
  }
  if (!toc.length) blocks.forEach((b, at) => { if (b.type === 'heading' && b.level <= 3) toc.push({ title: b.text, level: b.level, at }); });
  if (!pages.length) pages = marks.filter(inBook);

  return createDocument({
    title: meta('title') || file.name.replace(/\.epub$/i, ''), lang: meta('language') || null,
    source: { kind: 'epub', name: file.name }, blocks, toc: toc.filter(e => e.title), pages
  });
}
