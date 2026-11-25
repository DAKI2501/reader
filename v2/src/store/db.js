// What is kept on the device: texts with the place you got to, and notes. IndexedDB under its own
// name, so the old Reader's data is never touched.

const NAME = 'reader2', VERSION = 1;
let opening = null;

function open() {
  return opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('docs', { keyPath: 'id' });    // title, dates, the place you got to
      r.result.createObjectStore('texts', { keyPath: 'id' });   // the document itself, written once
      r.result.createObjectStore('notes', { keyPath: 'id' }).createIndex('doc', 'doc');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  /** Every text, newest first. */
  async list() { return (await run('docs', 'readonly', s => s.getAll())).sort((a, b) => b.opened - a.opened); },
  meta: id => run('docs', 'readonly', s => s.get(id)),
  putMeta: meta => run('docs', 'readwrite', s => s.put(meta)),
  async text(id) { const t = await run('texts', 'readonly', s => s.get(id)); return t && t.data; },
  putText: (id, data) => run('texts', 'readwrite', s => s.put({ id, data })),
  async remove(id) {
    for (const n of await db.notes(id)) await db.removeNote(n.id);
    await run('texts', 'readwrite', s => s.delete(id));
    return run('docs', 'readwrite', s => s.delete(id));
  },
  notes: docId => run('notes', 'readonly', s => s.index('doc').getAll(docId)),
  putNote: (docId, note) => run('notes', 'readwrite', s => s.put({ ...note, doc: docId })),
  removeNote: id => run('notes', 'readwrite', s => s.delete(id))
};
