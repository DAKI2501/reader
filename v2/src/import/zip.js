// Read a ZIP archive (an EPUB is one) piece by piece from a File or Blob. Only the directory at
// the end is read up front; each entry is read when asked for, so a book with an hour of audio
// in it does not have to fit in memory. No ZIP64, no encryption.
// The directory parsing is taken from the old Reader (DAKI2501/reader @ 1652e0d, index.html,
// openZip); changed here to read slices of the file instead of the whole file.

const EOCD = 0x06054b50, CENTRAL = 0x02014b50;

export async function openZip(blob) {
  const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
  let e = tail.byteLength - 22;
  while (e >= 0 && tail.getUint32(e, true) !== EOCD) e--;
  if (e < 0) throw Object.assign(new Error('not a zip archive'), { code: 'zip' });
  const count = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), start = tail.getUint32(e + 16, true);
  const dir = new DataView(await blob.slice(start, start + size).arrayBuffer()), text = new TextDecoder(), files = new Map();
  for (let n = 0, off = 0; n < count && off + 46 <= dir.byteLength && dir.getUint32(off, true) === CENTRAL; n++) {
    const nameLen = dir.getUint16(off + 28, true), extraLen = dir.getUint16(off + 30, true), commentLen = dir.getUint16(off + 32, true);
    const name = text.decode(new Uint8Array(dir.buffer, off + 46, nameLen));
    files.set(name, { method: dir.getUint16(off + 10, true), packed: dir.getUint32(off + 20, true), header: dir.getUint32(off + 42, true) });
    off += 46 + nameLen + extraLen + commentLen;
  }

  /** The entry as a Blob. An entry stored without compression is a slice of the file itself, so nothing is copied. */
  async function entry(name, type = '') {
    const f = files.get(name);
    if (!f) return null;
    const h = new DataView(await blob.slice(f.header, f.header + 30).arrayBuffer());
    const from = f.header + 30 + h.getUint16(26, true) + h.getUint16(28, true), packed = blob.slice(from, from + f.packed, type);
    if (f.method === 0) return packed;
    if (f.method !== 8) throw Object.assign(new Error('unsupported zip compression'), { code: 'zip' });
    return new Response(packed.stream().pipeThrough(new DecompressionStream('deflate-raw')), { headers: { 'Content-Type': type } }).blob();
  }
  return {
    names: [...files.keys()],
    has: name => files.has(name),
    entry,
    async text(name) { const b = await entry(name); return b ? b.text() : null; }
  };
}
