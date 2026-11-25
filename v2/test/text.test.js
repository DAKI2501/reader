import test from 'node:test';
import assert from 'node:assert/strict';
import { importText, paragraphs } from '../src/import/text.js';
import { validate, tocPath } from '../src/core/document.js';

test('blank lines separate paragraphs and line-end hyphens are joined', () => {
  assert.deepEqual(paragraphs('Første af-\nsnit her.\n\nAndet afsnit.'), ['Første afsnit her.', 'Andet afsnit.']);
});

test('text with a hard break on every line is put back into paragraphs', () => {
  const raw = ['Dette er en linje fra en PDF som er brudt midt i en', 'sætning og fortsætter på næste linje uden nogen tom', 'linje imellem. Kort slut.', 'Næste afsnit begynder her og løber også over flere af', 'de hårde linjeskift, som kopieret tekst plejer at få.'].join('\n');
  assert.equal(paragraphs(raw).length, 2);
});

test('citation lines from ProQuest are removed', () => {
  const p = paragraphs('Rigtig tekst.\n\nForfatter, A. Titel. Forlag, 2019.\nProQuest Ebook Central, http://ebookcentral.proquest.com/lib/x.\nCreated from kbdk on 2026-11-01 10:00:00.\n\nMere tekst.');
  assert.deepEqual(p, ['Rigtig tekst.', 'Mere tekst.']);
});

test('lines starting with # become headings with contents entries', () => {
  const d = importText('# Kapitel 1\n\nTekst et.\n\n## Emne\n\nTekst to.', { name: 'note.md' });
  assert.deepEqual(validate(d), []);
  assert.deepEqual(d.toc.map(e => [e.level, e.title]), [[1, 'Kapitel 1'], [2, 'Emne']]);
  assert.deepEqual(tocPath(d, d.wordCount - 1).map(e => e.title), ['Kapitel 1', 'Emne']);
  assert.equal(d.title, 'Kapitel 1');
  assert.equal(d.source.kind, 'text');
});
