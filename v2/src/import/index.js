// The importers. A file type is added by adding one entry here; the rest of Reader only calls
// importFile. The heavier importers are loaded the first time they are needed.
// An importer takes (file, onProgress) and returns a document. When it cannot, it throws an
// error with a `code` ('drm', 'scanned', 'zip', 'empty') that the app turns into a message.

import { parse } from '../core/document.js';
import { importText } from './text.js';

const importers = [
  { ext: ['epub'], run: (f, p) => import('./epub.js').then(m => m.importEpub(f, p)) },
  { ext: ['pdf'], run: (f, p) => import('./pdf.js').then(m => m.importPdf(f, p)) },
  { ext: ['json'], run: async f => parse(JSON.parse(await f.text())) },   // a document already in reader-dok/1
  { ext: ['txt', 'md', 'text'], run: async f => importText(await f.text(), { name: f.name }) }
];

export const accepts = importers.flatMap(i => i.ext.map(e => '.' + e)).join(',');

export function importFile(file, onProgress) {
  const ext = (/\.([^.]+)$/.exec(file.name) || [])[1]?.toLowerCase();
  const importer = importers.find(i => i.ext.includes(ext)) || importers.at(-1);
  return importer.run(file, onProgress);
}
