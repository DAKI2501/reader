// The app: the only place that knows about everything else. It opens a text, picks a clock and a
// view, and connects them. Clocks and views never see each other directly.

import { parse, serialize, toPlace, resolvePlace, quoteAt, tocPath, tocSpans, pageAt, blockIndexAt, hash } from '../core/document.js';
import { createNote, locate, exportNotes, exportText } from '../core/notes.js';
import { importText } from '../import/text.js';
import { importFile, accepts } from '../import/index.js';
import { fits } from '../time/clock.js';
import { createTempoClock } from '../time/tempo.js';
import { db } from '../store/db.js';
import { createTextView } from '../views/text.js';
import { createPacer, drawNotes } from '../views/pacer.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setting = (key, fallback) => { try { return JSON.parse(localStorage.getItem('reader2.' + key)) ?? fallback; } catch (e) { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem('reader2.' + key, JSON.stringify(value)); } catch (e) {} };

let R = null;   // what is open: { id, meta, doc, clock, text, view, notes }

/* ---------- start screen ---------- */

async function showStart() {
  if (R) { savePlace(); R.clock.dispose(); R.view.clear(); R = null; }
  $('read').hidden = true; $('start').hidden = false;
  const list = await db.list();
  $('libraryHead').hidden = !list.length;
  $('library').innerHTML = list.map(m => `<li><button data-open="${esc(m.id)}">${esc(m.title)}<small>${m.words} ord · ${Math.round(100 * (m.progress || 0))} %</small></button><button data-remove="${esc(m.id)}" aria-label="Fjern ${esc(m.title)}">×</button></li>`).join('');
}

async function addAndOpen(doc) {
  const id = 'd' + hash(doc.title + '|' + doc.wordCount + '|' + doc.blocks.slice(0, 40).map(b => b.text).join('\n'));
  if (!(await db.meta(id))) {
    await db.putText(id, serialize(doc));
    await db.putMeta({ id, title: doc.title, words: doc.wordCount, added: Date.now(), opened: Date.now(), place: null, progress: 0 });
  }
  return open(id);
}

$('go').addEventListener('click', () => { const t = $('paste').value.trim(); if (t) { $('paste').value = ''; addAndOpen(importText(t)); } });
const PROBLEMS = {
  drm: 'Bogen er kopibeskyttet (DRM) og kan ikke åbnes.',
  scanned: 'PDF\'en er scannet og har ingen tekst. Kør den gennem Ψ-OCR først.',
  zip: 'Filen kunne ikke læses som en e-bog.',
  empty: 'Der var ingen tekst i filen.'
};
const status = text => { $('status').textContent = text || ''; };
$('file').accept = accepts;
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    status(`Åbner ${f.name} …`);
    const doc = await importFile(f, (n, of) => status(`Åbner ${f.name}: ${n} af ${of}`));
    status(); await addAndOpen(doc);
  } catch (err) { console.error(err); status(PROBLEMS[err.code] || `Filen kunne ikke åbnes (${err.message}).`); }
});
$('library').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) open(b.dataset.open);
  if (b.dataset.remove) { await db.remove(b.dataset.remove); showStart(); }
});

/* ---------- reading ---------- */

async function open(id) {
  const meta = await db.meta(id), doc = parse(await db.text(id));
  meta.opened = Date.now(); await db.putMeta(meta);
  $('start').hidden = true; $('read').hidden = false;

  const text = createTextView($('text'), doc), view = createPacer(text);
  const clock = createTempoClock({ wpm: setting('wpm', 300) });
  if (!fits(clock.caps, view.needs)) throw new Error('view and clock do not fit');
  clock.load(doc);
  clock.seek(resolvePlace(doc, meta.place).running);
  R = { id, meta, doc, clock, text, view, notes: await db.notes(id) };

  const rate = $('rate'), caps = clock.caps.rate;
  rate.min = caps.min; rate.max = caps.max; rate.step = caps.step; rate.value = clock.rate;
  showRate();
  clock.on('state', ({ playing }) => { $('play').textContent = playing ? 'Pause' : 'Fortsæt'; if (!playing) savePlace(); });
  clock.on('rate', showRate);
  $('play').textContent = meta.place ? 'Fortsæt' : 'Start';
  showNotes();
  text.reveal(clock.now().running, false);
  requestAnimationFrame(frame);
}

let shown = -1;
function frame() {
  if (!R) return;
  const now = R.clock.now();
  R.view.draw(now);
  if (now.running !== shown) { shown = now.running; if (shown % 20 === 0 || !R.clock.playing) showWhere(shown); }
  requestAnimationFrame(frame);
}

function showWhere(running) {
  const section = tocPath(R.doc, running).pop(), page = pageAt(R.doc, running);
  $('where').textContent = [section ? section.title : R.doc.title, page && 's. ' + page, Math.round(100 * running / Math.max(1, R.doc.wordCount - 1)) + ' %'].filter(Boolean).join(' · ');
}
function showRate() { $('rateOut').textContent = Math.round(R.clock.rate); $('rate').value = R.clock.rate; }

function savePlace() {
  const running = R.clock.now().running, place = toPlace(R.doc, running);
  R.meta.place = { ...place, quote: quoteAt(R.doc, place) };
  R.meta.progress = running / Math.max(1, R.doc.wordCount - 1);
  db.putMeta(R.meta);
}

const toggle = () => R.clock.playing ? R.clock.pause() : R.clock.play();
function go(running) { R.clock.seek(running); R.text.reveal(R.clock.now().running); showWhere(R.clock.now().running); if (!R.clock.playing) savePlace(); }
function setRate(n) { R.clock.setRate(n); remember('wpm', R.clock.rate); }
/** Start of the next or previous block. */
function stepBlock(dir) {
  const i = blockIndexAt(R.doc, R.clock.now().running), s = R.doc.starts;
  go(dir > 0 ? s[Math.min(i + 1, s.length - 1)] : (R.clock.now().running > s[i] ? s[i] : s[Math.max(0, i - 1)]));
}

$('play').addEventListener('click', toggle);
$('back').addEventListener('click', showStart);
$('rate').addEventListener('input', e => setRate(+e.target.value));
// While the text runs, a tap pauses. While paused, a tap on a word moves the reading there.
$('text').addEventListener('click', e => {
  if (R.clock.playing) return R.clock.pause();
  const w = R.text.wordAt(e.clientX, e.clientY);
  if (w !== null) go(w);
});
addEventListener('keydown', e => {
  if (!R || e.target.closest('textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  const step = R.clock.caps.rate.step;
  const keys = { ' ': toggle, ArrowUp: () => setRate(R.clock.rate + step), ArrowDown: () => setRate(R.clock.rate - step), ArrowRight: () => stepBlock(+1), ArrowLeft: () => stepBlock(-1), h: toggleMark, m: writeNote };
  const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (fn) { e.preventDefault(); fn(); }
});
document.addEventListener('visibilitychange', () => { if (R && document.hidden) { R.clock.pause(); savePlace(); } });

/* ---------- contents ---------- */

$('where').addEventListener('click', () => {
  const spans = tocSpans(R.doc), running = R.clock.now().running;
  const current = tocPath(R.doc, running).pop();
  $('tocList').innerHTML = spans.length
    ? spans.map(s => `<li><button data-go="${s.start}" style="--level:${s.level}"${current && current.i === s.i ? ' aria-current="true"' : ''}>${esc(s.title)}</button></li>`).join('')
    : '<li>Teksten har ingen overskrifter.</li>';
  $('tocDialog').showModal();
});
$('tocList').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { go(+b.dataset.go); $('tocDialog').close(); } });
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

/* ---------- notes and marks ---------- */

const located = () => locate(R.doc, R.notes);
function showNotes() { drawNotes(R.text, located().filter(n => n.how !== 'lost').map(n => n.running)); }

async function toggleMark() {
  const running = R.clock.now().running;
  const near = located().find(n => n.note.kind === 'mark' && Math.abs(n.running - running) <= 12);
  if (near) { await db.removeNote(near.note.id); R.notes = R.notes.filter(n => n.id !== near.note.id); }
  else { const n = createNote(R.doc, toPlace(R.doc, running)); await db.putNote(R.id, n); R.notes.push(n); }
  showNotes();
}

let notePlace = null;
function writeNote() {
  R.clock.pause();
  notePlace = toPlace(R.doc, R.clock.now().running);
  $('noteQuote').textContent = quoteAt(R.doc, notePlace);
  $('noteText').value = '';
  $('noteDialog').showModal();
}
$('noteSave').addEventListener('click', async () => {
  const text = $('noteText').value.trim();
  if (text) { const n = createNote(R.doc, notePlace, { text }); await db.putNote(R.id, n); R.notes.push(n); showNotes(); }
  $('noteDialog').close();
});

$('mark').addEventListener('click', toggleMark);
$('note').addEventListener('click', writeNote);
$('notes').addEventListener('click', () => {
  R.clock.pause();
  $('notesList').innerHTML = located().map(({ note, running, how }) =>
    `<li><button data-go="${how === 'lost' ? '' : running}">${note.kind === 'mark' ? '▍' : '✎'} ${esc(note.text || note.quote)}<small>${how === 'lost' ? 'Stedet findes ikke længere i teksten' : esc(note.text ? note.quote : (pageAt(R.doc, running) ? 's. ' + pageAt(R.doc, running) : ''))}</small></button><button data-del="${esc(note.id)}" aria-label="Slet">×</button></li>`
  ).join('') || '<li>Ingen noter endnu. Tryk H for at markere et sted, M for at skrive en note.</li>';
  $('notesDialog').showModal();
});
$('notesList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del) { await db.removeNote(b.dataset.del); R.notes = R.notes.filter(n => n.id !== b.dataset.del); showNotes(); b.closest('li').remove(); }
  else if (b.dataset.go) { go(+b.dataset.go); $('notesDialog').close(); }
});

function download(name, type, content) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = ext => R.doc.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) + '-noter.' + ext;
$('exportText').addEventListener('click', () => download(fileName('txt'), 'text/plain', exportText(R.doc, R.notes)));
$('exportJson').addEventListener('click', () => download(fileName('json'), 'application/json', JSON.stringify(exportNotes(R.doc, R.notes), null, 2)));

showStart();
