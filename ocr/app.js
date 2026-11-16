/* Ψ-OCR – tekstgenkendelse til Reader. DAKI2501 og Claude, 2026. Freeware.
   Pipeline per scanned page:
     rasterize → find orientation (0/90/180/270) and skew from projection profiles → split two-page spreads
     → render each page upright and straight → remove dark scan borders, even out the background
     → Tesseract (LSTM, Danish/English) → lines → headers, page numbers, footnotes, paragraphs
   Everything runs in the browser; the language models are files next to this script. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = p => new URL(p, location.href).href;
const fmtInt = n => n.toLocaleString('da-DK');
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const store = {
  get(k, d) { try { const v = localStorage.getItem('reader.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('reader.' + k, JSON.stringify(v)); } catch (e) {} }
};
{ const t = (store.get('settings', {}) || {}).theme; if (t) document.documentElement.dataset.theme = t; }

const OPT_DEF = { lang: 'dan+eng', split: true, heads: true, hyph: true, notes: 'keep', forceText: false, dpi: 200 };
const opt = Object.assign({}, OPT_DEF, store.get('ocr', {}));
const saveOpt = () => store.set('ocr', opt);
const SERVED = /^https?:$/.test(location.protocol);
const COARSE = matchMedia('(pointer:coarse)').matches;

let toastTimer = 0;
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }

/* ================= lazy libraries ================= */
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('Kunne ikke hente ' + src)); };
    document.head.appendChild(s);
  }));
}
let pdfjs = null;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(abs('ocr/pdfjs/pdf.min.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = abs('ocr/pdfjs/pdf.worker.min.mjs');
  }
  return pdfjs;
}

/* ================= storage shared with Reader ================= */
let dbp = null;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('psy-reader', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }).createIndex('doc', 'docId');
      if (!d.objectStoreNames.contains('handoff')) d.createObjectStore('handoff', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('handoff', mode); let out;
    const q = fn(t.objectStore('handoff')); if (q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error);
  });
}

/* ================= canvases and pixels ================= */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }
function release(c) { if (c && c.width) { c.width = 1; c.height = 1; } }
function grayOf(id) {
  const d = id.data, n = d.length >> 2, g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8;
  return g;
}
function otsu(g, step = 1) {
  const hist = new Float64Array(256); let n = 0;
  for (let i = 0; i < g.length; i += step) { hist[g[i]]++; n++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; t = i; }
  }
  return t;
}
// Local (Sauvola) threshold with integral images: robust to shadows and uneven light.
function binarize(g, w, h) {
  const r = Math.max(6, Math.round(Math.min(w, h) / 45)), W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1)), I2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0, s2 = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; s += v; s2 += v * v;
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s; I2[(y + 1) * W1 + x + 1] = I2[y * W1 + x + 1] + s2;
    }
  }
  const B = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; if (v > 215) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), n = (y1 - y0) * (x1 - x0);
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const s2 = I2[y1 * W1 + x1] - I2[y0 * W1 + x1] - I2[y1 * W1 + x0] + I2[y0 * W1 + x0];
      const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
      if (v < m * (1 + 0.28 * (sd / 128 - 1)) && v < m - 12) B[y * w + x] = 1;
    }
  }
  return B;
}
// Clear dark runs that start at the image edge (scanner lid, book edges, gutter shadow after a split).
function wipeEdgesBin(B, w, h) {
  const mx = Math.max(2, Math.round(w * 0.02)), my = Math.max(2, Math.round(h * 0.02));
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let x = 0; while (x < mx && !B[o + x]) x++; if (x < mx) while (x < w && B[o + x]) B[o + x++] = 0;
    x = w - 1; while (x >= w - mx && !B[o + x]) x--; if (x >= w - mx) while (x >= 0 && B[o + x]) B[o + x--] = 0;
  }
  for (let x = 0; x < w; x++) {
    let y = 0; while (y < my && !B[y * w + x]) y++; if (y < my) while (y < h && B[y * w + x]) { B[y * w + x] = 0; y++; }
    y = h - 1; while (y >= h - my && !B[y * w + x]) y--; if (y >= h - my) while (y >= 0 && B[y * w + x]) { B[y * w + x] = 0; y--; }
  }
}
// Solid dark areas (photos, black borders) are not text: clear tiles that are mostly ink.
function clearSolid(B, w, h) {
  const T = 12;
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    let n = 0, ink = 0;
    for (let y = ty; y < Math.min(h, ty + T); y++) for (let x = tx; x < Math.min(w, tx + T); x++) { n++; ink += B[y * w + x]; }
    if (ink > n * 0.62) for (let y = ty; y < Math.min(h, ty + T); y++) B.fill(0, y * w + tx, y * w + Math.min(w, tx + T));
  }
}

/* ================= orientation, skew and spreads ================= */
// Points are ink pixels in coordinates centred on the image. Rotating the page by φ maps
// (x, y) → (x cosφ − y sinφ, x sinφ + y cosφ); deskewing by the measured tilt a uses φ = −a.
function inkPoints(B, w, h, maxN = 260000) {
  let n = 0; for (let i = 0; i < B.length; i++) n += B[i];
  const step = Math.max(1, Math.ceil(n / maxN)), m = Math.ceil(n / step);
  const xs = new Float32Array(m), ys = new Float32Array(m), cx = w / 2, cy = h / 2;
  let k = 0, c = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!B[y * w + x]) continue;
    if (c++ % step === 0 && k < m) { xs[k] = x - cx + 0.5; ys[k] = y - cy + 0.5; k++; }
  }
  return { xs: xs.subarray(0, k), ys: ys.subarray(0, k), n: k, w, h };
}
// Sharpness of the profile along Q after tilting by a: text lines give tall, crisp peaks.
function profile(P, Q, a, len, bin = 1) {
  const c = Math.cos(a), s = Math.sin(a), off = len / 2, H = new Float32Array(Math.ceil(len / bin) + 2);
  for (let i = 0; i < P.length; i++) { const v = ((Q[i] * c - P[i] * s + off) / bin) | 0; if (v >= 0 && v < H.length) H[v]++; }
  return H;
}
function sharp(H) { let s = 0; for (let i = 1; i < H.length; i++) { const d = H[i] - H[i - 1]; s += d * d; } return s; }
function bestAngle(P, Q, len, lo, hi, step) {
  let best = { a: 0, s: -1 };
  for (let d = lo; d <= hi + 1e-9; d += step) { const s = sharp(profile(P, Q, rad(d), len)); if (s > best.s) best = { a: d, s }; }
  return best;
}
function skewSearch(P, Q, len, centre = 0, span = 7) {
  let b = bestAngle(P, Q, len, centre - span, centre + span, span > 2 ? 0.5 : 0.1);
  b = bestAngle(P, Q, len, b.a - (span > 2 ? 0.5 : 0.1), b.a + (span > 2 ? 0.5 : 0.1), 0.05);
  return b;
}
function rotPts(pt, d) { // rotate the point cloud by d degrees (page rotation)
  const a = rad(d), c = Math.cos(a), s = Math.sin(a), xs = new Float32Array(pt.n), ys = new Float32Array(pt.n);
  for (let i = 0; i < pt.n; i++) { xs[i] = pt.xs[i] * c - pt.ys[i] * s; ys[i] = pt.xs[i] * s + pt.ys[i] * c; }
  const sw = Math.round(Math.abs(d)) % 180 === 90;
  return { xs, ys, n: pt.n, w: sw ? pt.h : pt.w, h: sw ? pt.w : pt.h };
}
function subset(pt, keep) {
  let n = 0; for (let i = 0; i < pt.n; i++) if (keep(pt.xs[i], pt.ys[i])) n++;
  const xs = new Float32Array(n), ys = new Float32Array(n); let k = 0;
  for (let i = 0; i < pt.n; i++) if (keep(pt.xs[i], pt.ys[i])) { xs[k] = pt.xs[i]; ys[k] = pt.ys[i]; k++; }
  return { xs, ys, n, w: pt.w, h: pt.h };
}
// Latin text has more ink above the x-height band (ascenders, capitals) than below it (descenders).
// Returns [above, below] summed over all text lines.
function upDown(pt, a) {
  const len = Math.hypot(pt.w, pt.h) + 4, H = profile(pt.xs, pt.ys, rad(a), len);
  const S = new Float32Array(H.length); for (let i = 1; i < H.length - 1; i++) S[i] = (H[i - 1] + 2 * H[i] + H[i + 1]) / 4;
  const nz = [...S].filter(v => v > 0).sort((x, y) => x - y); if (nz.length < 10) return [0, 0];
  const T = nz[Math.floor(nz.length * 0.9)] * 0.42;
  let A = 0, Bl = 0;
  for (let i = 1; i < S.length; i++) {
    if (!(S[i] >= T && S[i - 1] < T)) continue;
    let j = i; while (j < S.length && S[j] >= T) j++;
    const core = j - i; if (core < 3 || core > 80) { i = j; continue; }
    const z = Math.max(2, Math.round(core * 0.7));
    for (let k = Math.max(0, i - z); k < i; k++) A += S[k];
    for (let k = j; k < Math.min(S.length, j + z); k++) Bl += S[k];
    i = j;
  }
  return [A, Bl];
}
// Find the gutter of a two-page spread in the deskewed point cloud. Returns x (centred coords) or null.
function findGutter(pt, a) {
  if (pt.w < pt.h * 1.12) return null;
  const len = pt.w + 4, c = Math.cos(rad(a)), s = Math.sin(rad(a)), H = new Float32Array(len), off = pt.w / 2;
  for (let i = 0; i < pt.n; i++) { const x = (pt.xs[i] * c + pt.ys[i] * s + off) | 0; if (x >= 0 && x < len) H[x]++; }
  const r = Math.max(2, Math.round(pt.w * 0.006)), Sm = new Float32Array(len);
  for (let i = 0; i < len; i++) { let t = 0, n = 0; for (let k = i - r; k <= i + r; k++) if (k >= 0 && k < len) { t += H[k]; n++; } Sm[i] = t / n; }
  const nz = [...Sm].filter(v => v > 0).sort((x, y) => x - y); if (!nz.length) return null;
  const med = nz[Math.floor(nz.length / 2)], zero = med * 0.16, lo = Math.round(pt.w * 0.34), hi = Math.round(pt.w * 0.66);
  // empty column runs in the middle third; a gutter shadow shows up as a thin line between two of them
  const runs = []; let st = -1;
  for (let i = lo; i <= hi + 1; i++) { const z = i <= hi && Sm[i] <= zero; if (z && st < 0) st = i; if (!z && st >= 0) { runs.push([st, i - 1]); st = -1; } }
  if (!runs.length) return null;
  runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const R1 = runs[0]; if (R1[1] - R1[0] < pt.w * 0.008) return null;
  let cut = (R1[0] + R1[1]) / 2;
  const R2 = runs.slice(1).find(r => r[1] - r[0] >= pt.w * 0.004 && (Math.abs(r[0] - R1[1]) < pt.w * 0.02 || Math.abs(R1[0] - r[1]) < pt.w * 0.02));
  if (R2) cut = R2[0] > R1[1] ? (R1[1] + R2[0]) / 2 : (R2[1] + R1[0]) / 2;
  let left = 0, total = 0; for (let i = 0; i < len; i++) { total += H[i]; if (i < cut) left += H[i]; }
  if (left < total * 0.22 || left > total * 0.78) return null;
  return cut - off;
}
// Work out how to turn the page: rotation, tilt, and the page parts (one, or two for a spread).
function analyze(src, forcedRot) {
  const W = src.width, H = src.height, k0 = Math.min(1, 1600 / Math.max(W, H));
  const aw = Math.max(1, Math.round(W * k0)), ah = Math.max(1, Math.round(H * k0));
  const sc = canvas(aw, ah), cx = ctx2d(sc);
  cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, aw, ah);
  let g = grayOf(cx.getImageData(0, 0, aw, ah)); release(sc);
  let mean = 0; for (let i = 0; i < g.length; i += 7) mean += g[i]; mean /= Math.ceil(g.length / 7);
  const inverted = mean < 100; if (inverted) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  const B = binarize(g, aw, ah); g = null;
  clearSolid(B, aw, ah); wipeEdgesBin(B, aw, ah);
  const pt0 = inkPoints(B, aw, ah);
  const plan = { k: W / aw, inverted, rot: 0, parts: [], notes: {} };
  if (pt0.n < 250) { plan.empty = true; return plan; }
  const diag = Math.hypot(aw, ah) + 4;
  let rot = forcedRot, ptR;
  if (rot == null) {
    const rows = skewSearch(pt0.xs, pt0.ys, diag), cols = skewSearch(pt0.ys, pt0.xs, diag);
    plan.notes.vert = cols.s / Math.max(1, rows.s);
    rot = cols.s > rows.s * 1.15 ? 90 : 0;
  }
  ptR = rot ? rotPts(pt0, rot) : pt0;
  const sk = skewSearch(ptR.xs, ptR.ys, diag);
  const gut = opt.split ? findGutter(ptR, sk.a) : null;
  const halfW = ptR.w / 2;
  const ranges = gut == null ? [[-halfW, halfW]] : [[-halfW, gut], [gut, halfW]];
  let A = 0, Bl = 0;
  const c = Math.cos(rad(sk.a)), s = Math.sin(rad(sk.a));
  for (const [x0, x1] of ranges) {
    const sub = gut == null ? ptR : subset(ptR, (x, y) => { const xx = x * c + y * s; return xx >= x0 && xx < x1; });
    let a = sk.a;
    if (gut != null && sub.n > 200) a = skewSearch(sub.xs, sub.ys, diag, sk.a, 1.5).a;
    const [u, d] = sub.n > 200 ? upDown(sub, a) : [0, 0]; A += u; Bl += d;
    plan.parts.push({ x0, x1, a });
  }
  plan.rot = rot; plan.w = ptR.w; plan.h = ptR.h;
  plan.notes.up = Bl ? A / Bl : 1;
  if (forcedRot == null && A < Bl * 0.87) flipPlan(plan);
  return plan;
}
function flipPlan(p) {
  p.rot = (p.rot + 180) % 360;
  p.parts = p.parts.map(q => ({ x0: -q.x1, x1: -q.x0, a: q.a })).reverse();
  p.flipped = !p.flipped;
  return p;
}
function copyPlan(p) { return Object.assign({}, p, { parts: p.parts.map(q => Object.assign({}, q)), notes: Object.assign({}, p.notes) }); }
// Render one page part upright and straight at full resolution.
function renderPart(src, plan, q) {
  const W = src.width, H = src.height, sw = plan.rot % 180 !== 0, W1 = sw ? H : W, H1 = sw ? W : H, k = plan.k;
  const X0 = clamp(Math.round(q.x0 * k + W1 / 2), 0, W1), X1 = clamp(Math.round(q.x1 * k + W1 / 2), 0, W1);
  const c = canvas(X1 - X0, H1), x = ctx2d(c);   // left transparent: alpha marks what lies outside the scan
  x.translate(W1 / 2 - X0, H1 / 2); x.rotate(rad(plan.rot - q.a));
  x.imageSmoothingQuality = 'high'; x.drawImage(src, -W / 2, -H / 2);
  return c;
}
// Make the page easy to read for Tesseract: white paper, no dark edges, even light.
function cleanPart(c, inverted) {
  const w = c.width, h = c.height, x = ctx2d(c), id = x.getImageData(0, 0, w, h), g = grayOf(id), d0 = id.data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) { if (d0[i * 4 + 3] < 128) { out[i] = 1; g[i] = 255; } else if (inverted) g[i] = 255 - g[i]; }
  // dark runs from the edges of the scan (after skipping the area outside it)
  const T = Math.min(otsu(g, 5), 150), mx = Math.max(3, Math.round(w * 0.025)), my = Math.max(3, Math.round(h * 0.02));
  const wipe = (start, step, n, m) => {
    let i = 0; while (i < n && out[start + i * step]) i++;
    for (let k = 0; k < 3 && i < n; k++, i++) g[start + i * step] = 255;   // ragged rim of the scan
    const s0 = i; while (i < n && i - s0 < m && g[start + i * step] >= T) i++;
    if (i < n && i - s0 < m) {
      while (i < n && g[start + i * step] < T + 25) { g[start + i * step] = 255; i++; }
      for (let k = 0; k < 8 && i < n && g[start + i * step] < 238; k++, i++) g[start + i * step] = 255;   // the grey seam after it
    }
  };
  for (let y = 0; y < h; y++) { wipe(y * w, 1, w, mx); wipe(y * w + w - 1, -1, w, mx); }
  for (let xx = 0; xx < w; xx++) { wipe(xx, w, h, my); wipe((h - 1) * w + xx, -w, h, my); }
  // background: brightest value per block, widened and smoothed, then divided out
  const S = 40, gw = Math.ceil(w / S), gh = Math.ceil(h / S), bg = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let m = 0; const ye = Math.min(h, (by + 1) * S), xe = Math.min(w, (bx + 1) * S);
    for (let y = by * S; y < ye; y += 2) for (let xi = bx * S; xi < xe; xi += 2) { const v = g[y * w + xi]; if (v > m) m = v; }
    bg[by * gw + bx] = m;
  }
  const dil = new Float32Array(bg.length);
  for (let y = 0; y < gh; y++) for (let xi = 0; xi < gw; xi++) {
    let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xq = xi + dx; if (yy >= 0 && yy < gh && xq >= 0 && xq < gw) m = Math.max(m, bg[yy * gw + xq]); }
    dil[y * gw + xi] = m;
  }
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < gh; y++) for (let xi = 0; xi < gw; xi++) {
    let t = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xq = xi + dx; if (yy >= 0 && yy < gh && xq >= 0 && xq < gw) { t += dil[yy * gw + xq]; n++; } }
    bg[y * gw + xi] = t / n;
  }
  for (let i = 0; i < bg.length; i++) dil[i] = Math.max(bg[i], 60);
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) / S - 0.5, 0, gh - 1), y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let xi = 0; xi < w; xi++) {
      const fx = clamp((xi + 0.5) / S - 0.5, 0, gw - 1), x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const b = (dil[y0 * gw + x0] * (1 - tx) + dil[y0 * gw + x1] * tx) * (1 - ty) + (dil[y1 * gw + x0] * (1 - tx) + dil[y1 * gw + x1] * tx) * ty;
      const i = y * w + xi; let v = g[i] * 255 / b;
      v = v >= 232 ? 255 : v * 1.04;
      g[i] = v > 255 ? 255 : v;
    }
  }
  const d = id.data; for (let i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = g[i]; d[j + 3] = 255; }
  x.putImageData(id, 0, 0);
  const head = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`), pgm = new Uint8Array(head.length + g.length);
  pgm.set(head); pgm.set(g, head.length);
  return pgm;
}
function toBlob(c, type, q) { return new Promise(res => c.toBlob(res, type, q)); }
async function scaledJpeg(c, s, q = 0.78) {
  if (s >= 0.999) return toBlob(c, 'image/jpeg', q);
  const o = canvas(Math.round(c.width * s), Math.round(c.height * s)), x = o.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.width, o.height);
  const b = await toBlob(o, 'image/jpeg', q); release(o); return b;
}

/* ================= Tesseract workers ================= */
const Pool = {
  ws: [], busy: new Set(), wait: [], lang: null, starting: null,
  size() { return COARSE ? 1 : clamp(Math.floor((navigator.hardwareConcurrency || 2) / 2), 1, 3); },
  async ensure() {
    if (this.lang && this.lang !== opt.lang && !this.busy.size) await this.reset();
    if (this.ws.length) return;
    if (!this.starting) {
      const lang = opt.lang;
      this.starting = (async () => {
        await loadScript('ocr/tesseract.min.js');
        const ws = await Promise.all(Array.from({ length: this.size() }, () => Tesseract.createWorker(lang.split('+'), 1, {
          workerPath: abs('ocr/worker.min.js'), corePath: abs('ocr/core'), langPath: abs('ocr/lang'), gzip: false, cacheMethod: 'none'
        })));
        this.ws = ws; this.lang = lang;
      })().finally(() => { this.starting = null; });
    }
    await this.starting;
  },
  acquire() {
    const w = this.ws.find(x => !this.busy.has(x));
    if (w) { this.busy.add(w); return Promise.resolve(w); }
    return new Promise(res => this.wait.push(res));
  },
  release(w) { this.busy.delete(w); const n = this.wait.shift(); if (n) { this.busy.add(w); n(w); } },
  async run(img, dpi) {
    await this.ensure();
    const w = await this.acquire();
    try {
      await w.setParameters({ user_defined_dpi: String(Math.round(clamp(dpi, 70, 600))) });
      const r = await w.recognize(img, {}, { text: false, tsv: true });
      return r.data;
    } finally { this.release(w); }
  },
  async reset() { const ws = this.ws; this.ws = []; this.lang = null; this.busy.clear(); await Promise.all(ws.map(w => w.terminate().catch(() => {}))); }
};

/* ================= recognised text → lines → page structure ================= */
const LIG = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const normWord = t => t.replace(/[ﬀ-ﬆ]/g, c => LIG[c] || c).replace(/\u00AD(?=.)/g, '');
function parseTsv(tsv) {
  const lines = []; let cur = null;
  for (const row of (tsv || '').split('\n')) {
    const f = row.split('\t'); if (f.length < 12) continue;
    const lvl = +f[0]; if (!(lvl === 4 || lvl === 5)) continue;
    const x0 = +f[6], y0 = +f[7], x1 = x0 + +f[8], y1 = y0 + +f[9];
    if (lvl === 4) { cur = { b: +f[2], p: +f[3], x0, y0, x1, y1, words: [] }; lines.push(cur); continue; }
    const t = normWord(f.slice(11).join(' ').trim());
    if (t && cur) cur.words.push({ t, c: +f[10], x0, y0, x1, y1 });
  }
  for (const l of lines) {   // vertical rules and page edges read as | at the ends of a line
    const bar = w => /^[|¦!\[\]/\\Il]$/.test(w.t) && w.c < 75 || /^[|¦]+$/.test(w.t);
    // a lone mark far from the text (specks, the edge of the scan)
    const stray = (w, nb) => nb && (/^[\p{P}\p{S}]{1,2}$/u.test(w.t) || (w.t.length <= 2 && w.c < 93)) && Math.max(w.x0 - nb.x1, nb.x0 - w.x1) > 2.5 * Math.max(8, nb.y1 - nb.y0);
    const W = l.words;
    while (W.length && (bar(W[W.length - 1]) || stray(W[W.length - 1], W[W.length - 2]))) W.pop();
    while (W.length && (bar(W[0]) || stray(W[0], W[1]))) W.shift();
    if (l.words.length) { l.x0 = l.words[0].x0; l.x1 = l.words[l.words.length - 1].x1; }
  }
  return lines.filter(l => l.words.length).map(geom);
}
const lineText = l => l.words.map(w => w.t).join(' ');
// Robust line geometry from its words (line boxes swell with specks and slight tilt).
function geom(l) {
  const W = l.words.filter(w => /[\p{L}\p{N}]/u.test(w.t)), use = W.length ? W : l.words;
  l.ty0 = median(use.map(w => w.y0)); l.ty1 = median(use.map(w => w.y1)); l.wh = Math.max(1, median(use.map(w => w.y1 - w.y0)));
  const good = use.filter(w => w.c > 50); l.mx = Math.max(1, ...(good.length ? good : use).map(w => w.y1 - w.y0)); l.nw = W.length;
  return l;
}
function junkLine(l, W) {
  const t = lineText(l), al = (t.match(/[\p{L}\p{N}]/gu) || []).length, conf = l.words.reduce((a, w) => a + w.c, 0) / l.words.length;
  if (al <= 2 && W && (l.x1 < W * 0.08 || l.x0 > W * 0.92)) return true;   // specks along the edge of the page
  if (t.length <= 2 && !/^\d+$/.test(t) && conf < 80) return true;
  return conf < 22 || (conf < 45 && al < 4) || (al < t.length * 0.45 && conf < 72) || (al < 2 && t.length < 3 && conf < 85);
}
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const ROMAN = /^(?=[ivx]{1,7}$)(x{0,3})(ix|iv|v?i{0,3})$/i;
function pageNumberIn(t) {
  const s = t.replace(/^[\s\-–—.·•([]+|[\s\-–—.·•)\]]+$/g, '').replace(/^(side|s\.|page|p\.)\s*/i, '');
  if (/^\d{1,4}$/.test(s)) return s;
  if (ROMAN.test(s)) return s.toLowerCase();
  return null;
}
function headKey(t) { return t.toLowerCase().replace(/[\d\s.,:;\-–—·|]+/g, ' ').trim(); }
// Split a page's lines into header, footer and paragraphs (with headings and footnotes marked).
function structure(lines, W, H) {
  const out = { paras: [], head: null, foot: null };
  if (!lines.length) return out;
  const mh = median(lines.map(l => l.wh)) || 10;
  const allH = lines.flatMap(l => l.words.filter(w => /\p{L}/u.test(w.t) && w.c > 50).map(w => w.y1 - w.y0)).sort((a, b) => a - b);
  const bodyH = allH.length ? allH[Math.floor(allH.length * 0.85)] : mh * 1.3;
  const byY = [...lines].sort((a, b) => a.ty0 - b.ty0);
  const gaps = byY.slice(1).map((l, i) => l.ty0 - byY[i].ty1).filter(g => g > 0), normGap = median(gaps) || mh * 0.5;
  const lineW = median(lines.map(l => l.x1 - l.x0));
  const take = (l, other, top) => {
    const t = lineText(l); if (t.length > 110 || byY.length < 4) return null;
    if (l.x1 - l.x0 > lineW * 0.8 && !pageNumberIn(t)) return null;   // a full line of text
    const gap = top ? (other ? other.ty0 - l.ty1 : 1e9) : (other ? l.ty0 - other.ty1 : 1e9);
    const inZone = top ? l.ty0 < H * 0.3 : l.ty1 > H * 0.6;   // scans often have wide margins
    if (!inZone || gap < Math.max(mh * 0.5, normGap * 1.6)) return null;
    if (!top && /^\W{0,2}\d{1,3}\W{0,2}\s+\p{Lu}/u.test(t) && t.length > 30) return null;   // a footnote
    let num = pageNumberIn(t), kind = 'head';
    if (!num && t.length <= 60 && !/\p{Ll}[.!?]$/u.test(t)) {
      const m = t.match(/^(\d{1,4})\s+\S.*$/) || t.match(/^.*\S\s+(\d{1,4})$/); if (m) num = m[1];
    }
    if (num && pageNumberIn(t)) kind = 'num';
    if (!num && (t.match(/[\p{L}\p{N}]/gu) || []).length < 3) kind = 'junk';
    return { text: t, key: headKey(t), num, kind, line: l };
  };
  if (byY.length > 1) {
    out.head = take(byY[0], byY[1], true);
    const last = byY[byY.length - 1], prev = byY[byY.length - 2];
    if (last !== (out.head && out.head.line)) out.foot = take(last, prev, false);
  }
  const body = lines.filter(l => l !== (out.head && out.head.line) && l !== (out.foot && out.foot.line));
  // group by Tesseract block, keep reading order
  const blocks = []; for (const l of body) { const bl = blocks[blocks.length - 1]; if (bl && bl.b === l.b) bl.lines.push(l); else blocks.push({ b: l.b, lines: [l] }); }
  const pitchOf = L => L.slice(1).map((l, i) => l.ty0 - L[i].ty0).filter(d => d > mh * 0.6 && d < mh * 4);
  const pagePitch = median(blocks.flatMap(b => pitchOf(b.lines))) || mh * 1.6;
  for (const bl of blocks) {
    const ps = pitchOf(bl.lines), pitch = ps.length >= 3 ? median(ps) : pagePitch;
    const L = bl.lines, xs = L.map(l => l.x0).sort((a, b) => a - b), xe = L.map(l => l.x1).sort((a, b) => a - b);
    const left = L.length > 3 ? xs[Math.floor(xs.length * 0.15)] : xs[0], right = L.length > 3 ? xe[Math.floor(xe.length * 0.85)] : xe[xe.length - 1], bw = Math.max(1, right - left);
    const ind = l => l.x0 - left > mh * 0.9 && l.x0 - left < bw * 0.3;
    let cur = null;
    L.forEach((l, i) => {
      const prev = L[i - 1], hl = l.wh;
      let brk = !prev;
      if (prev) {
        const pt = lineText(prev), short = prev.x1 < right - bw * 0.1, hp = prev.wh;
        if (l.ty0 - prev.ty0 > pitch * 1.38) brk = true;
        else if (ind(l) && !ind(prev)) brk = true;
        else if (short && (/[.!?:»"”)]$/.test(pt) || prev.x1 < right - bw * 0.3)) brk = true;
        else if (l.nw >= 3 && prev.nw >= 3 && Math.abs(l.mx - prev.mx) > bodyH * 0.25) brk = true;
        else if (l.x0 - left > bw * 0.3) brk = true;
      }
      if (brk) { cur = { lines: [], indent: ind(l), hs: [], y0: l.ty0 }; out.paras.push(cur); }
      cur.lines.push(l.words.map(w => ({ t: w.t, c: w.c }))); cur.hs.push(l.mx);
    });
  }
  for (const p of out.paras) {
    const h = median(p.hs), n = p.lines.length, len = p.lines.reduce((a, l) => a + l.length, 0);
    p.kind = (h > bodyH * 1.22 && n <= 3 && len <= 18) ? 'h' : (h < bodyH * 0.86 && p.y0 > H * 0.55 && len >= 4) ? 'note' : 'p';
    delete p.hs;
  }
  // once footnotes start, the rest of the page is footnotes too (unless it is large text)
  let inNotes = false;
  for (const p of out.paras) { if (p.kind === 'note') inNotes = true; else if (inNotes && p.kind === 'p') p.kind = 'note'; }
  return out;
}
// Join word lists line by line, healing hyphenation at line ends.
const ENDS = /[.!?:…»"”)\]]$/;
function joinWords(ws, next) {
  if (!ws.length) return next.slice();
  const a = ws[ws.length - 1], b = next[0];
  if (opt.hyph && b && /\p{L}[-¬\u2010\u2011\u00AD]$/u.test(a.t) && /^\p{Ll}/u.test(b.t)) {
    const merged = { t: a.t.slice(0, -1) + b.t, c: Math.min(a.c, b.c) };
    return ws.slice(0, -1).concat([merged], next.slice(1));
  }
  return ws.concat(next);
}
function paraWords(p, lex) { let ws = []; for (const l of p.lines) ws = joinWords(ws, lex ? l.map(w => fixWord(w, lex)) : l); return ws; }

/* A document-wide word list from confidently read words fixes typical slips in uncertain ones:
   'fenomenologi' becomes 'fænomenologi' when the book spells it that way elsewhere. */
const CONFUSE = [['e', 'æ'], ['a', 'æ'], ['a', 'å'], ['o', 'ø'], ['ae', 'æ'], ['oe', 'ø'], ['aa', 'å'], ['å', 'ä'], ['a', 'ä'], ['o', 'ö'], ['u', 'ü'], ['B', 'ß'], ['é', 'è'], ['c', 'e'], ['rn', 'm'], ['l', 'I'], ['1', 'l'], ['0', 'o'], ['Z', 'L'], ['ii', 'ü'], ['li', 'h']];
const coreOf = t => { const m = t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u); return m ? [m[1], m[2], m[3]] : ['', t, '']; };
function lexicon() {
  const lex = new Map(), all = new Map();
  lex.all = all;
  const add = (t, c) => { const k = coreOf(t)[1]; if (k.length <= 2) return; all.set(k, (all.get(k) || 0) + 1); if (c >= 88) lex.set(k, (lex.get(k) || 0) + 1); };
  for (const p of pages) if (p.state === 'done') for (const q of p.parts) {
    if (q.kind === 'text') q.text.forEach(t => t.split(/\s+/).forEach(w => add(w, 100)));
    else for (const l of q.lines || []) for (const w of l.words) add(w.t, w.c);
  }
  return lex;
}
function fixWord(w, lex) {
  const [pre, core, post] = coreOf(w.t);
  // uncertain words that the book never spells this way; or long words the book mostly spells otherwise
  const own = lex.all.get(core) || 0, sure = w.c >= 88;
  if (core.length < 4 || (sure && core.length < 8) || (!sure && (lex.get(core) || 0) > 0)) return w;
  let best = null, bn = sure ? Math.max(2, 2 * own - 1) : 1;
  for (const [a, b] of CONFUSE) for (const [x, y] of [[a, b], [b, a]]) {
    for (let i = core.indexOf(x); i >= 0; i = core.indexOf(x, i + 1)) {
      const cand = core.slice(0, i) + y + core.slice(i + x.length), n = lex.get(cand) || 0;
      if (n > bn) { bn = n; best = cand; }
    }
  }
  return best ? { t: pre + best + post, c: 89 } : w;
}

/* ================= pages ================= */
let seq = 0;
const pages = [];   // source pages in order: one per PDF page, image or TIFF frame
let title = '';
const naturalCmp = new Intl.Collator('da', { numeric: true, sensitivity: 'base' }).compare;
async function headBytes(f, n = 16) { return new Uint8Array(await f.slice(0, n).arrayBuffer()); }
function sniff(h, name, type) {
  const n = (name || '').toLowerCase();
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf';
  if ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2A) || (h[0] === 0x4D && h[1] === 0x4D && h[3] === 0x2A)) return 'tiff';
  if (h[0] === 0x50 && h[1] === 0x4B) return 'zip';
  if (/\.(pdf)$/.test(n)) return 'pdf';
  if (/\.tiff?$/.test(n)) return 'tiff';
  if ((type || '').startsWith('image/') || /\.(jpe?g|jfif|png|gif|webp|avif|bmp|ico|svg|heic|heif)$/.test(n)) return 'image';
  if (/\.(html?|xhtml)$/.test(n) || type === 'text/html') return 'html';
  if (/\.(txt|md|markdown|text)$/.test(n) || (type || '').startsWith('text/')) return 'text';
  if (h[0] === 0xFF && h[1] === 0xD8) return 'image';
  return null;
}
async function addFiles(list) {
  if (!SERVED) { toast('Åbn Ψ-OCR fra webadressen for at genkende tekst.'); return; }
  const files = [...list].filter(Boolean).sort((a, b) => naturalCmp(a.name || '', b.name || ''));
  if (!files.length) return;
  if (!pages.length && !$('#title').value.trim()) $('#title').value = title = cleanTitle(files[0].name);
  $('#job').hidden = false;
  const before = pages.length;
  for (const f of files) {
    try { await expand(f, f.name || 'Indsat billede'); }
    catch (e) { console.error(e); toast(`${f.name || 'Filen'} kunne ikke åbnes: ${friendly(e)}`, 6000); }
  }
  if (pages.length === before) { if (!pages.length) $('#job').hidden = true; return; }
  renderList(); pump();
}
function cleanTitle(n) { return (n || 'Scanning').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Scanning'; }
function friendly(e) {
  const m = String(e && (e.message || e)) || '';
  if (/password/i.test(m)) return 'PDF\'en er beskyttet med adgangskode.';
  if (/heic|heif/i.test(m)) return 'HEIC-billeder kan kun åbnes i Safari. Gem billedet som JPEG, og prøv igen.';
  if (/Kunne ikke hente/.test(m)) return 'en programfil kunne ikke hentes. Tjek internetforbindelsen, og prøv igen.';
  return m.length < 140 ? m : 'ukendt fejl';
}
function addPage(p) { p.id = 'p' + (++seq); p.state = 'queued'; pages.push(p); return p; }
async function expand(f, name, depth = 0) {
  const kind = sniff(await headBytes(f), name, f.type);
  if (kind === 'pdf') return expandPdf(f, name);
  if (kind === 'tiff') return expandTiff(f, name);
  if (kind === 'image') { addPage({ name, raster: () => rasterImage(f, name) }); return; }
  if (kind === 'zip' && depth < 2) return expandZip(f, name, depth);
  if (kind === 'text') { const t = await f.text(); addTextPage(name, t.split(/\r?\n\s*\r?\n/)); return; }
  if (kind === 'html') { const d = new DOMParser().parseFromString(await f.text(), 'text/html'); addTextPage(name, blockTexts(d.body)); return; }
  throw new Error('filtypen kendes ikke.');
}
function addTextPage(name, paras) {
  paras = paras.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!paras.length) return;
  addPage({ name, text: paras });
}
async function expandPdf(f, name) {
  const lib = await getPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), wasmUrl: abs('ocr/pdfjs/wasm/'), isEvalSupported: false, useSystemFonts: true });
  task.onPassword = (cb, reason) => { const p = prompt(reason === 2 ? 'Forkert adgangskode. Prøv igen:' : `${name} er beskyttet. Skriv adgangskoden:`); if (p == null) task.destroy(); else cb(p); };
  const doc = await task.promise;
  for (let i = 1; i <= doc.numPages; i++) addPage({ name: doc.numPages > 1 ? `${name}, side ${i}` : name, pdf: { doc, i, file: f } });
}
async function expandTiff(f, name) {
  await loadScript('ocr/utif.min.js');
  const buf = await f.arrayBuffer(), ifds = UTIF.decode(buf).filter(d => !(d.t254 && (d.t254[0] & 1)));
  ifds.forEach((ifd, n) => addPage({ name: ifds.length > 1 ? `${name}, side ${n + 1}` : name, raster: async () => {
    UTIF.decodeImage(buf, ifd);
    const w = ifd.width, h = ifd.height, rgba = UTIF.toRGBA8(ifd), c = canvas(w, h);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    ifd.data = null;
    const dpi = ifd.t282 ? ifd.t282[0] : 0;
    return fitRaster(c, w, h, dpi);
  } }));
}
// ZIP, CBZ, DOCX, ODT, PPTX, EPUB: page images inside, plus text for Word and OpenDocument.
async function openZip(f) {
  const buf = await f.arrayBuffer(), u8 = new Uint8Array(buf), dv = new DataView(buf), td = new TextDecoder();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arkivet er beskadiget.');
  const count = dv.getUint16(eocd + 10, true), files = [];
  let off = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count && off + 46 <= u8.length; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    files.push({ name: td.decode(u8.subarray(off + 46, off + 46 + nlen)), method, csize, usize, lho });
    off += 46 + nlen + xlen + clen;
  }
  async function bytes(e) {
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true), data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error('arkivet bruger en ukendt komprimering.');
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return { files, bytes, text: async e => td.decode(await bytes(e)) };
}
async function expandZip(f, name, depth) {
  const z = await openZip(f), get = n => z.files.find(e => e.name === n);
  const office = /\.(docx|docm|odt|odp|pptx)$/i.test(name) || get('word/document.xml') || get('content.xml');
  // text from Word / OpenDocument / PowerPoint
  const xmlText = async (e, para, tags) => {
    const d = new DOMParser().parseFromString(await z.text(e), 'application/xml'), out = [];
    for (const p of d.getElementsByTagName(para)) { let t = ''; const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (tags.test(n.localName)) t += c.nodeValue; } else if (c.nodeType === 1) { if (/^(tab|br|s)$/.test(c.localName)) t += ' '; walk(c); } } }; walk(p); out.push(t); }
    return out;
  };
  let text = [];
  if (get('word/document.xml')) text = await xmlText(get('word/document.xml'), 'w:p', /^t$/);
  else if (get('content.xml') && /opendocument/.test(await z.text(get('mimetype') || { lho: 0, csize: 0, method: 0 }).catch(() => ''))) {
    const d = new DOMParser().parseFromString(await z.text(get('content.xml')), 'application/xml');
    for (const p of d.querySelectorAll('p, h')) if (/text/.test(p.namespaceURI || '')) text.push(p.textContent);
  } else {
    const slides = z.files.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => naturalCmp(a.name, b.name));
    for (const s of slides) text.push(...await xmlText(s, 'a:p', /^t$/));
  }
  if (text.join('').trim().length > 40) addTextPage(name, text);
  const minSize = office ? 30000 : 4000;
  const imgs = z.files.filter(e => !/(^|\/)(__MACOSX|\.)/.test(e.name) && /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|pdf)$/i.test(e.name) && e.usize >= minSize && !/thumbnail/i.test(e.name))
    .sort((a, b) => naturalCmp(a.name, b.name));
  for (const e of imgs) {
    const sub = new File([await z.bytes(e)], e.name.split('/').pop(), { type: /\.pdf$/i.test(e.name) ? 'application/pdf' : '' });
    const label = `${name}: ${e.name.split('/').pop()}`;
    if (/\.(pdf|tiff?)$/i.test(e.name)) await expand(sub, label, depth + 1);
    else addPage({ name: label, raster: () => rasterImage(sub, label) });
  }
  if (!imgs.length && text.join('').trim().length <= 40) throw new Error(/\.epub$/i.test(name) ? 'e-bogen har ingen billeder af sider. Åbn den direkte i Reader.' : 'arkivet indeholder ingen billeder eller tekst.');
}
function blockTexts(root) {
  const out = []; let buf = '';
  const BLOCK = /^(p|div|h[1-6]|li|blockquote|section|article|tr|td|th|pre|br|hr|dd|dt|figcaption)$/i;
  const flush = () => { if (buf.trim()) out.push(buf); buf = ''; };
  const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) buf += c.nodeValue; else if (c.nodeType === 1 && !/^(script|style|noscript|template)$/i.test(c.localName)) { const b = BLOCK.test(c.localName); if (b) flush(); walk(c); if (b) flush(); } } };
  if (root) walk(root); flush();
  return out;
}
// Decode an image file to a canvas at a resolution that suits Tesseract.
async function rasterImage(f, name) {
  let src;
  try { src = await createImageBitmap(f); }
  catch (e) {
    src = await new Promise((res, rej) => { const u = URL.createObjectURL(f), im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(/\.hei[cf]$/i.test(name) ? 'heic' : 'billedet kunne ikke læses.')); im.src = u; });
  }
  const w = src.width || src.naturalWidth || 1600, h = src.height || src.naturalHeight || 1600;
  const r = fitRaster(src, w, h, 0);
  if (src.close) src.close();
  return r;
}
function fitRaster(src, w, h, dpi) {
  const long = Math.max(w, h);
  let s = 1;
  if (long < 1800) s = Math.min(3, 2400 / long);
  if (w * h * s * s > 14e6) s = Math.sqrt(14e6 / (w * h));
  if (long * s > 7000) s = 7000 / long;
  let c = src;
  if (Math.abs(s - 1) > 0.01 || !(src instanceof HTMLCanvasElement)) {
    c = canvas(w * s, h * s); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    if (src instanceof HTMLCanvasElement) release(src);
  }
  // pixels per PDF point: from the file's own resolution, or assume a 300 dpi scan of a normal page
  let ppt = dpi > 50 ? dpi * s / 72 : 300 / 72;
  const longPt = Math.max(c.width, c.height) / ppt;
  if (!(dpi > 50) && (longPt > 1300 || longPt < 400)) ppt = Math.max(c.width, c.height) / 842;
  return { canvas: c, ppt };
}
async function rasterPdf(p) {
  const page = await p.pdf.doc.getPage(p.pdf.i), v1 = page.getViewport({ scale: 1 });
  let s = Math.min(300 / 72, Math.sqrt(14e6 / (v1.width * v1.height)), 7000 / Math.max(v1.width, v1.height));
  const v = page.getViewport({ scale: s }), c = canvas(v.width, v.height), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: v, intent: 'print', annotationMode: 0 }).promise;
  page.cleanup();
  return { canvas: c, ppt: c.width / v1.width };
}
// A PDF page that already has real text: take it as lines, no recognition needed.
async function pdfTextPage(p) {
  const page = await p.pdf.doc.getPage(p.pdf.i), v = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const chars = tc.items.reduce((a, it) => a + (it.str ? it.str.replace(/\s/g, '').length : 0), 0);
  if (chars < 60) return null;
  const lines = []; let cur = null;
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const m = pdfjs.Util.transform(v.transform, it.transform), x = m[4], y = m[5], fh = Math.hypot(m[2], m[3]) || 10, wd = it.width * (v.scale || 1);
    const isNew = !cur || Math.abs(y - cur.base) > fh * 0.5 || x < cur.x1 - fh;
    if (isNew) { if (!it.str.trim()) continue; cur = { b: 0, x0: x, x1: x, y0: y - fh * 0.8, y1: y + fh * 0.22, base: y, words: [] }; lines.push(cur); }
    const toks = it.str.split(/\s+/).filter(Boolean); if (!toks.length) { continue; }
    const glue = cur.words.length && !/\s$/.test(cur.last || '') && !/^\s/.test(it.str) && x - cur.x1 < fh * 0.12;
    toks.forEach((t, k) => {
      const tw = wd * t.length / Math.max(1, it.str.length), tx = x + wd * it.str.indexOf(t) / Math.max(1, it.str.length);
      if (k === 0 && glue) { const lw = cur.words[cur.words.length - 1]; lw.t += normWord(t); lw.x1 = tx + tw; }
      else cur.words.push({ t: normWord(t), c: 100, x0: tx, y0: cur.y0, x1: tx + tw, y1: cur.y1 });
    });
    cur.last = it.str; cur.x1 = Math.max(cur.x1, x + wd);
  }
  // thumbnail
  const ts = 160 / v.width, tv = page.getViewport({ scale: ts }), tcv = canvas(tv.width, tv.height), tx = tcv.getContext('2d');
  tx.fillStyle = '#fff'; tx.fillRect(0, 0, tcv.width, tcv.height);
  await page.render({ canvasContext: tx, viewport: tv, annotationMode: 0 }).promise;
  const thumb = URL.createObjectURL(await toBlob(tcv, 'image/jpeg', 0.7)); release(tcv); page.cleanup();
  return { kind: 'pdftext', lines: lines.filter(l => l.words.length).map(geom), w: v.width, h: v.height, ptW: v.width, ptH: v.height, conf: 100, thumb };
}

/* ================= processing queue ================= */
const run = { paused: false, active: 0, t0: 0, done0: 0, lock: null, lastLang: opt.lang };
async function pump() {
  if (run.pumping) return; run.pumping = true;
  try {
    const inflight = new Set();
    if (!run.t0) { run.t0 = performance.now(); run.done0 = pages.filter(p => p.state !== 'queued' && p.state !== 'work').length; }
    wake(true);
    while (!run.paused) {
      const p = pages.find(x => x.state === 'queued');
      if (!p) break;
      p.state = 'work'; renderPage(p); progress();
      const job = processPage(p).catch(e => { console.error(e); p.state = 'error'; p.err = friendly(e); })
        .finally(() => { inflight.delete(job); renderPage(p); progress(); });
      inflight.add(job);
      if (inflight.size >= Math.max(1, Pool.size())) await Promise.race(inflight);
    }
    await Promise.all(inflight);
  } finally {
    run.pumping = false; run.t0 = 0; wake(false); progress();
    if (!run.paused && pages.some(x => x.state === 'queued')) pump();
  }
}
async function wake(on) {
  try {
    if (on && !run.lock && navigator.wakeLock) run.lock = await navigator.wakeLock.request('screen');
    if (!on && run.lock) { run.lock.release(); run.lock = null; }
  } catch (e) {}
}
async function processPage(p) {
  p.parts = []; p.err = null; p.info = null;
  if (p.text) { p.parts = [{ kind: 'text', text: p.text, conf: 100 }]; p.state = 'done'; return; }
  if (p.pdf && !opt.forceText) {
    const tp = await pdfTextPage(p);
    if (tp) { Object.assign(tp, structure(tp.lines, tp.w, tp.h)); p.parts = [tp]; p.state = 'done'; p.info = 'PDF\'ens egen tekst'; return; }
  }
  const src = p.pdf ? await rasterPdf(p) : await p.raster();
  try {
    let plan = analyze(src.canvas, p.manualRot);
    if (plan.empty) { p.state = 'empty'; return; }
    let parts = [];
    for (let i = 0; i < plan.parts.length; i++) parts.push(await recognizePart(src, plan, i));
    // Doubtful orientation: try the page the other way round and keep the better reading.
    const conf = parts.reduce((a, q) => a + q.conf * q.words, 0) / Math.max(1, parts.reduce((a, q) => a + q.words, 0));
    if (p.manualRot == null && (conf < 62 || (plan.notes.up > 0.87 && plan.notes.up < 1.15 && conf < 80))) {
      const alts = [flipPlan(copyPlan(plan))];
      if (conf < 45) for (const r of [90, 270]) { const a = analyze(src.canvas, (plan.rot + r) % 360); if (!a.empty) alts.push(a); }
      let best = { plan, parts, conf };
      for (const a of alts) {
        const first = await recognizePart(src, a, 0);
        if (first.conf > best.conf + 8 && first.words >= 3) {
          const ps = [first]; for (let i = 1; i < a.parts.length; i++) ps.push(await recognizePart(src, a, i));
          const c = ps.reduce((s, q) => s + q.conf * q.words, 0) / Math.max(1, ps.reduce((s, q) => s + q.words, 0));
          freeParts(best.parts); best = { plan: a, parts: ps, conf: c };
        } else freeParts([first]);
      }
      plan = best.plan; parts = best.parts;
    }
    p.plan = { rot: plan.rot, a: plan.parts.map(q => q.a), split: plan.parts.length > 1 };
    p.parts = parts.filter(q => q.words > 0 || parts.length === 1);
    p.state = parts.every(q => !q.words) ? 'empty' : 'done';
  } finally { release(src.canvas); }
}
function freeParts(ps) { for (const q of ps) { if (q.thumb) URL.revokeObjectURL(q.thumb); } }
async function recognizePart(src, plan, i) {
  const q = plan.parts[i], c = renderPart(src.canvas, plan, q);
  const pgm = cleanPart(c, plan.inverted);
  const ppt = src.ppt, w = c.width, h = c.height;
  const outS = Math.min(1, (opt.dpi / 72) / ppt);
  const [img, thumbB] = await Promise.all([scaledJpeg(c, outS, opt.dpi >= 300 ? 0.82 : 0.75), scaledJpeg(c, 160 / w, 0.7)]);
  release(c);
  const data = await Pool.run(pgm, ppt * 72);
  const lines = parseTsv(data.tsv).filter(l => !junkLine(l, w));
  const words = lines.reduce((a, l) => a + l.words.length, 0);
  const conf = words ? lines.reduce((a, l) => a + l.words.reduce((s, x) => s + x.c, 0), 0) / words : 0;
  return Object.assign({ kind: 'ocr', lang: opt.lang, lines, w, h, ptW: w / ppt, ptH: h / ppt, img, thumb: URL.createObjectURL(thumbB), conf, words, side: plan.parts.length > 1 ? (i ? 'højre' : 'venstre') : '' }, structure(lines, w, h));
}

/* ================= assembling the whole text ================= */
// Pages in reading order, each a part of a source page (spreads give two).
function allParts() {
  const out = [];
  for (const p of pages) if (p.state === 'done' && !p.off) for (const q of p.parts) out.push(q);
  return out;
}
function assemble() {
  const parts = allParts(), N = parts.length, lex = lexicon();
  // running heads: the same text at the top or bottom of several pages
  const keyCount = new Map();
  for (const q of parts) for (const hf of [q.head, q.foot]) if (hf && hf.key && hf.key.length > 2) keyCount.set(hf.key, (keyCount.get(hf.key) || 0) + 1);
  const drop = hf => hf && (hf.kind === 'junk' || (opt.heads && (hf.num != null || (keyCount.get(hf.key) || 0) >= 2)));
  // printed page numbers, with gaps filled when the numbering is regular
  const nums = parts.map(q => { for (const hf of [q.head, q.foot]) if (hf && hf.num && /^\d+$/.test(hf.num)) return +hf.num; return null; });
  const offs = new Map(); nums.forEach((n, i) => { if (n != null) offs.set(n - i, (offs.get(n - i) || 0) + 1); });
  let off = null, offN = 0; for (const [o, c] of offs) if (c > offN) { off = o; offN = c; }
  const known = nums.filter(n => n != null).length;
  // a misread number between two that fit the sequence is corrected
  if (off != null && offN >= 3) nums.forEach((n, i) => { if (n != null && n !== i + off && nums[i - 1] === i - 1 + off && nums[i + 1] === i + 1 + off) nums[i] = i + off; });
  const labels = parts.map((q, i) => {
    if (nums[i] != null) return String(nums[i]);
    for (const hf of [q.head, q.foot]) if (hf && hf.num && !/^\d+$/.test(hf.num)) return hf.num;
    if (off != null && known >= 2 && offN >= known * 0.6 && i + off >= 1) return String(i + off);
    return '';
  });
  const out = []; let cur = null, notes = [], pendingMarks = [];
  const flushCur = () => { if (cur) { out.push(cur); cur = null; } if (notes.length) { out.push(...notes); notes = []; } };
  parts.forEach((q, pi) => {
    const label = labels[pi] || String(pi + 1);
    pendingMarks.push({ page: pi, label });
    let paras;
    if (q.kind === 'text') paras = q.text.map(t => ({ kind: 'p', words: t.split(/\s+/).filter(Boolean).map(x => ({ t: x, c: 100 })) }));
    else if (q.edited != null) paras = q.edited.map(t => ({ kind: 'p', words: t.split(/\s+/).filter(Boolean).map(x => ({ t: x, c: 100 })) }));
    else {
      paras = q.paras.map(p => ({ kind: p.kind, indent: p.indent, words: paraWords(p, lex) }));
      if (q.head && !drop(q.head)) paras.unshift({ kind: 'p', words: q.head.line.words.map(w => ({ t: w.t, c: w.c })) });
      if (q.foot && !drop(q.foot)) paras.push({ kind: 'p', words: q.foot.line.words.map(w => ({ t: w.t, c: w.c })) });
    }
    let first = true;
    for (const p of paras) {
      if (!p.words.length) continue;
      if (p.kind === 'note') {
        if (opt.notes === 'drop') continue;
        const n = { kind: 'note', words: p.words, marks: [] };
        if (cur) notes.push(n); else { n.marks.push(...pendingMarks.map(m => ({ ...m, at: 0 }))); pendingMarks = []; out.push(n); }
        continue;
      }
      const t0 = p.words[0].t, prev = cur && cur.words[cur.words.length - 1];
      const cont = first && cur && cur.kind === 'p' && p.kind === 'p' && prev &&
        ((opt.hyph && /\p{L}[-¬\u2010\u2011\u00AD]$/u.test(prev.t) && /^\p{Ll}/u.test(t0)) || /^\p{Ll}/u.test(t0) || (!ENDS.test(prev.t) && !p.indent));
      if (cont) {
        const at = cur.words.length - (opt.hyph && /\p{L}[-¬\u2010\u2011\u00AD]$/u.test(prev.t) && /^\p{Ll}/u.test(t0) ? 1 : 0);
        cur.marks.push(...pendingMarks.map(m => ({ ...m, at }))); pendingMarks = [];
        cur.words = joinWords(cur.words, p.words);
      } else {
        flushCur();
        cur = { kind: p.kind, words: p.words.slice(), marks: pendingMarks.map(m => ({ ...m, at: 0 })) }; pendingMarks = [];
      }
      first = false;
      if (p.kind !== 'p') flushCur();
    }
  });
  flushCur();
  if (pendingMarks.length && out.length) { const last = out[out.length - 1]; last.marks.push(...pendingMarks.map(m => ({ ...m, at: last.words.length }))); }
  for (const p of out) p.text = p.words.map(w => w.t).join(' ');
  return { paras: out, labels, N, parts };
}
function readerDoc() {
  const A = assemble(), paragraphs = [], pageStarts = new Array(A.N).fill(-1);
  let total = 0;
  for (const p of A.paras) {
    for (const m of p.marks) if (pageStarts[m.page] < 0) pageStarts[m.page] = total + Math.min(m.at, Math.max(0, p.words.length - 1));
    paragraphs.push(p.kind === 'h' ? p.text : p.text);
    total += p.words.length;
  }
  for (let i = A.N - 1; i >= 0; i--) if (pageStarts[i] < 0) pageStarts[i] = i + 1 < A.N ? pageStarts[i + 1] : Math.max(0, total - 1);
  const pageNums = A.labels.some(Boolean) ? A.labels.map((l, i) => l || String(i + 1)) : null;
  return { title: docTitle(), paragraphs, pageStarts, pageNums, pageLabel: 'side', words: total, A };
}
function docTitle() { return ($('#title').value || title || 'Scanning').trim(); }
function plainText(A) { return docTitle() + '\n\n' + A.paras.map(p => p.text).join('\n\n') + '\n'; }

/* ================= exports ================= */
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const fileBase = () => docTitle().replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Scanning';
function guard() {
  const parts = allParts();
  if (!parts.length) { toast('Der er ingen genkendt tekst endnu.'); return false; }
  return true;
}
function partialNote() {
  const left = pages.filter(p => p.state === 'queued' || p.state === 'work').length;
  return left ? ` ${left} ${left === 1 ? 'side er' : 'sider er'} ikke færdige og er ikke med.` : '';
}
$('#dlTxt').addEventListener('click', () => { if (!guard()) return; const d = readerDoc(); download(new Blob([plainText(d.A)], { type: 'text/plain;charset=utf-8' }), fileBase() + '.txt'); toast('Teksten er hentet.' + partialNote()); });
$('#copy').addEventListener('click', async () => { if (!guard()) return; try { await navigator.clipboard.writeText(plainText(readerDoc().A)); toast('Teksten er kopieret.' + partialNote()); } catch (e) { toast('Browseren tillod ikke kopiering. Brug Tekst i stedet.'); } });
$('#toReader').addEventListener('click', async () => {
  if (!guard()) return;
  const d = readerDoc(); delete d.A;
  if (d.words < 2) { toast('Der er ingen tekst at læse.'); return; }
  try { await idb('readwrite', s => s.put({ key: 'toReader', doc: d, t: Date.now() })); location.href = './#from-ocr'; }
  catch (e) { toast('Kunne ikke sende teksten til Reader. Hent den som e-bog eller tekst i stedet.', 6000); }
});

// --- EPUB 3 (stored ZIP, no compression needed) ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(entries) {
  const te = new TextEncoder(), chunks = [], central = []; let off = 0;
  for (const e of entries) {
    const name = te.encode(e.name), data = typeof e.data === 'string' ? te.encode(e.data) : e.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x5A21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x5A21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const cs = central.reduce((a, b) => a + b.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, end.buffer], { type: 'application/epub+zip' });
}
$('#dlEpub').addEventListener('click', () => {
  if (!guard()) return;
  const A = assemble(), t = docTitle(), id = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16));
  const lang = opt.lang === 'eng' ? 'en' : 'da', x = s => esc(s);
  // chapters start at headings (when there are several)
  const chapters = [[]]; let heads = 0;
  for (const p of A.paras) { if (p.kind === 'h' && chapters[chapters.length - 1].length) { chapters.push([]); } if (p.kind === 'h') heads++; chapters[chapters.length - 1].push(p); }
  const chs = heads >= 2 ? chapters : [A.paras];
  const pageList = [], toc = [];
  const body = (ps, file) => ps.map(p => {
    const marks = [...p.marks].sort((a, b) => a.at - b.at); let html = '', wi = 0;
    const mk = m => { pageList.push(`<li><a href="${file}#side-${m.page + 1}">${x(m.label)}</a></li>`); return `<span epub:type="pagebreak" role="doc-pagebreak" id="side-${m.page + 1}" aria-label="${x(m.label)}"></span>`; };
    let mi = 0;
    for (; wi <= p.words.length; wi++) {
      while (mi < marks.length && marks[mi].at <= wi) html += mk(marks[mi++]);
      if (wi < p.words.length) html += (wi ? ' ' : '') + x(p.words[wi].t);
    }
    if (p.kind === 'h') { const hid = 'h' + toc.length; toc.push(`<li><a href="${file}#${hid}">${x(p.text)}</a></li>`); return `<h2 id="${hid}">${html}</h2>`; }
    return p.kind === 'note' ? `<p class="note">${html}</p>` : `<p>${html}</p>`;
  }).join('\n');
  const xhtml = (ttl, inner) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"><head><meta charset="utf-8"/><title>${x(ttl)}</title><link rel="stylesheet" href="style.css"/></head><body>\n${inner}\n</body></html>`;
  const files = chs.map((ps, i) => { const f = `kap${String(i + 1).padStart(3, '0')}.xhtml`; return { name: 'OEBPS/' + f, f, data: xhtml(t, (i === 0 ? `<h1>${x(t)}</h1>\n` : '') + body(ps, f)) }; });
  const nav = xhtml(t, `<nav epub:type="toc" id="toc"><h1>Indhold</h1><ol>${toc.length ? toc.join('') : `<li><a href="${files[0].f}">${x(t)}</a></li>`}</ol></nav>\n<nav epub:type="page-list" hidden=""><ol>${pageList.join('')}</ol></nav>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${x(t)}</dc:title><dc:language>${lang}</dc:language><dc:source>Tekstgenkendelse med Ψ-OCR</dc:source><meta property="dcterms:modified">${now}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${files.map((f, i) => `<item id="c${i}" href="${f.f}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${files.map((f, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`;
  const css = 'body{font-family:serif;line-height:1.5;margin:0 5%}h1{font-size:1.5em}h2{font-size:1.2em;margin-top:2em}p{margin:0 0 .8em}p.note{font-size:.85em;color:#555}';
  const blob = zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/style.css', data: css },
    ...files.map(f => ({ name: f.name, data: f.data }))
  ]);
  download(blob, fileBase() + '.epub'); toast('E-bogen er hentet.' + partialNote());
});

// --- searchable PDF: the cleaned page image with invisible text on top ---
$('#dlPdf').addEventListener('click', async () => {
  if (!guard()) return;
  const btn = $('#dlPdf'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Laver PDF …';
  try {
    await loadScript('ocr/pdf-lib.min.js');
    const L = PDFLib, doc = await L.PDFDocument.create(), font = await doc.embedFont(L.StandardFonts.Helvetica);
    doc.setTitle(docTitle()); doc.setCreator('Ψ-OCR'); doc.setProducer('Ψ-OCR med Tesseract og pdf-lib'); doc.setLanguage(opt.lang === 'eng' ? 'en' : 'da');
    const encCache = new Map();
    const encodable = ch => { if (!encCache.has(ch)) { try { font.encodeText(ch); encCache.set(ch, true); } catch (e) { encCache.set(ch, false); } } return encCache.get(ch); };
    const clean = s => [...s.normalize('NFC')].map(ch => encodable(ch) ? ch : (encodable(ch.normalize('NFD')[0]) ? ch.normalize('NFD')[0] : '?')).join('');
    const srcDocs = new Map(); let skipped = 0, labels = [];
    const A = assemble();
    for (let pi = 0; pi < A.parts.length; pi++) {
      const q = A.parts[pi];
      if (q.kind === 'pdftext') {
        const sp = pages.find(p => p.parts.includes(q));
        try {
          let sd = srcDocs.get(sp.pdf.file);
          if (!sd) { sd = await L.PDFDocument.load(await sp.pdf.file.arrayBuffer(), { ignoreEncryption: true }); srcDocs.set(sp.pdf.file, sd); }
          const [pg] = await doc.copyPages(sd, [sp.pdf.i - 1]); doc.addPage(pg); labels.push(A.labels[pi]); continue;
        } catch (e) { skipped++; continue; }
      }
      if (q.kind === 'text' || !q.img) { skipped++; continue; }
      const jpg = await doc.embedJpg(new Uint8Array(await q.img.arrayBuffer()));
      const page = doc.addPage([q.ptW, q.ptH]); labels.push(A.labels[pi]);
      page.drawImage(jpg, { x: 0, y: 0, width: q.ptW, height: q.ptH });
      const k = q.ptW / q.w, key = page.node.newFontDictionary(font.name, font.ref);
      const ops = [L.pushGraphicsState(), L.beginText(), L.setTextRenderingMode(L.TextRenderingMode.Invisible)];
      for (const l of q.lines) {
        const lh = Math.max(1, l.y1 - l.y0), size = Math.max(1, lh * k * 0.8), base = q.ptH - (l.y1 - lh * 0.2) * k;
        for (const w of l.words) {
          const s = clean(w.t); if (!s) continue;
          const nat = font.widthOfTextAtSize(s, size); if (!nat) continue;
          const sq = clamp(100 * (w.x1 - w.x0) * k / nat, 5, 1000);
          ops.push(L.setFontAndSize(key, size), L.setCharacterSqueeze(sq), L.setTextMatrix(1, 0, 0, 1, w.x0 * k, base), L.showText(font.encodeText(s + ' ')));
        }
      }
      ops.push(L.endText(), L.popGraphicsState());
      page.pushOperators(...ops);
    }
    if (!doc.getPageCount()) { toast('Der er ingen scannede sider at lægge i en PDF.'); return; }
    // page labels = printed page numbers when they are regular
    const firstNum = labels.findIndex(l => /^\d+$/.test(l));
    if (firstNum >= 0 && labels.every((l, i) => i < firstNum || l === String(+labels[firstNum] + i - firstNum) || !l)) {
      const nums = firstNum > 0 ? [0, { S: 'r' }, firstNum, { S: 'D', St: +labels[firstNum] }] : [0, { S: 'D', St: +labels[firstNum] }];
      doc.catalog.set(L.PDFName.of('PageLabels'), doc.context.obj({ Nums: nums }));
    }
    const bytes = await doc.save();
    download(new Blob([bytes], { type: 'application/pdf' }), fileBase() + ' (søgbar).pdf');
    toast('PDF\'en er hentet.' + (skipped ? ` ${skipped} ${skipped === 1 ? 'side' : 'sider'} uden billede er udeladt.` : '') + partialNote(), 5000);
  } catch (e) { console.error(e); toast('PDF\'en kunne ikke laves: ' + friendly(e), 6000); }
  finally { btn.disabled = false; btn.textContent = old; }
});

/* ================= list and progress ================= */
const partNo = new Map();
function numberParts() {
  partNo.clear(); let n = 0;
  for (const p of pages) if (p.state === 'done' && !p.off) for (const q of p.parts) partNo.set(q, ++n);
}
function metaFor(p, q) {
  if (p.state === 'queued') return 'Venter';
  if (p.state === 'work') return 'Genkender …';
  if (p.state === 'error') return 'Fejl: ' + (p.err || 'ukendt');
  if (p.state === 'empty') return 'Tom side';
  const bits = [];
  if (q.kind === 'ocr') bits.push(`${Math.round(q.conf)} % sikker`);
  if (q.kind === 'pdftext') bits.push('PDF\'ens egen tekst');
  if (q.kind === 'text') bits.push('tekst');
  if (p.plan && p.plan.rot) bits.push(`drejet ${p.plan.rot}°`);
  if (p.plan && q.kind === 'ocr') { const a = p.plan.a[p.parts.indexOf(q)] || 0; if (Math.abs(a) >= 0.2) bits.push(`rettet ${Math.abs(a).toFixed(1).replace('.', ',')}°`); }
  if (q.side) bits.push(`${q.side} side af opslag`);
  if (q.edited) bits.push('rettet af dig');
  const lab = (q.head && q.head.num) || (q.foot && q.foot.num); if (lab) bits.push('sidetal ' + lab);
  return bits.join(', ');
}
function previewOf(q) {
  if (q.kind === 'text') return q.text.join(' ').slice(0, 220);
  if (q.edited) return q.edited.join(' ').slice(0, 220);
  return (q.paras || []).map(p => paraWords(p).map(w => w.t).join(' ')).join(' ').slice(0, 220);
}
const ICON = {
  l: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M8 5H4v4M4.5 8.5A8 8 0 1 1 6 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  r: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M16 5h4v4M19.5 8.5A8 8 0 1 0 18 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  u: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
function rowHTML(p, q) {
  const done = p.state === 'done', n = q ? partNo.get(q) : null, raster = done && q && q.kind !== 'text';
  const name = q && q.kind === 'text' ? 'Tekst' : n ? `Side ${n}` : p.name;
  const thumb = q && q.thumb ? `<img src="${q.thumb}" alt="">` : '';
  const act = p.off
    ? `<button class="icon" data-act="undo" title="Tag med igen" aria-label="Tag med igen">${ICON.u}</button>`
    : `${p.text || (q && q.kind === 'pdftext') ? '' : `<button class="icon" data-act="rotL" title="Drej mod venstre og genkend igen" aria-label="Drej mod venstre">${ICON.l}</button><button class="icon" data-act="rotR" title="Drej mod højre og genkend igen" aria-label="Drej mod højre">${ICON.r}</button>`}<button class="icon" data-act="off" title="Udelad siden" aria-label="Udelad siden">${ICON.x}</button>`;
  const multi = new Set(pages.map(x => x.name.split(/, side |: /)[0])).size > 1;
  return `<div class="row ${p.state}${p.off ? ' off' : ''}" data-part="${q ? p.parts.indexOf(q) : -1}">
    <button class="thumb" data-act="view" ${done && q ? '' : 'disabled'} aria-label="Vis og ret ${esc(name)}">${thumb}</button>
    <div class="pmain"><div class="ptitle"><b>${esc(name)}</b><span class="pmeta${p.state === 'error' ? ' err' : ''}">${esc(metaFor(p, q || {}))}${multi && n ? ', ' + esc(p.name) : ''}</span></div>
    ${done && q ? `<p class="pprev">${esc(previewOf(q)) || '<i>ingen tekst</i>'}</p>` : ''}</div>
    <div class="pact">${p.state === 'work' ? '' : act}</div></div>`;
}
function liHTML(p) { return (p.state === 'done' && p.parts.length) ? p.parts.map(q => rowHTML(p, q)).join('') : rowHTML(p, null); }
function renderList() {
  numberParts();
  document.body.classList.toggle('hasjob', pages.length > 0);
  $('#dropTitle').textContent = pages.length ? 'Tilføj flere sider' : 'Slip scannede sider her';
  $('#pages').innerHTML = pages.map(p => `<li data-id="${p.id}">${liHTML(p)}</li>`).join('');
  progress();
}
let renumberTimer = 0;
function renderPage(p) {
  const li = $(`#pages li[data-id="${p.id}"]`); if (!li) return renderList();
  clearTimeout(renumberTimer);
  renumberTimer = setTimeout(renderList, 400);   // page numbers after this one may shift
  numberParts(); li.innerHTML = liHTML(p);
}
function progress() {
  const total = pages.length, done = pages.filter(p => !['queued', 'work'].includes(p.state)).length;
  $('#bar').style.width = total ? (100 * done / total).toFixed(1) + '%' : '0';
  const busy = pages.some(p => p.state === 'work' || p.state === 'queued');
  let s;
  if (!total) s = '';
  else if (busy) {
    const el = (performance.now() - run.t0) / 1000, k = done - run.done0;
    const left = k > 0 && run.t0 ? Math.round(el / k * (total - done)) : null;
    s = `${done} af ${total} ${total === 1 ? 'side' : 'sider'} færdige` + (left != null ? `, ca. ${left < 60 ? 'under 1 min' : Math.round(left / 60) + ' min'} tilbage` : '') + (run.paused ? ', på pause' : '');
  } else {
    const parts = allParts(), errs = pages.filter(p => p.state === 'error').length, empty = pages.filter(p => p.state === 'empty').length;
    const words = parts.reduce((a, q) => a + (q.kind === 'text' ? q.text.join(' ').split(/\s+/).length : (q.lines || []).reduce((s, l) => s + l.words.length, 0)), 0);
    s = `Færdig: ${parts.length} ${parts.length === 1 ? 'side' : 'sider'}, ca. ${fmtInt(words)} ord` + (empty ? `, ${empty} tomme` : '') + (errs ? `, ${errs} med fejl` : '');
  }
  $('#status').textContent = s;
  $('#pause').hidden = !busy;
  $('#pause').textContent = run.paused ? 'Fortsæt' : 'Sæt på pause';
  $('#exportbar').hidden = !allParts().length;
  $('#expNote').textContent = busy ? 'Du kan hente det, der er færdigt, eller vente på resten.' : '';
  $$('#lang button').forEach(b => b.disabled = busy && b.dataset.v !== opt.lang);
  const relang = !busy && pages.some(p => p.state === 'done' && p.parts.some(q => q.kind === 'ocr' && q.lang && q.lang !== opt.lang));
  $('#relang').hidden = !relang;
  if (relang) $('#relang').textContent = `Genkend igen på ${LANG_NAME[opt.lang]}`;
}
const LANG_NAME = { 'dan+eng': 'dansk og engelsk', dan: 'dansk', eng: 'engelsk' };

$('#pages').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const li = b.closest('li[data-id]'), p = pages.find(x => x.id === li.dataset.id); if (!p) return;
  const qi = +b.closest('.row').dataset.part, act = b.dataset.act;
  if (act === 'view') { openPage(p.parts[qi]); return; }
  if (act === 'off') { p.off = true; renderList(); return; }
  if (act === 'undo') { p.off = false; renderList(); return; }
  if (act === 'rotL' || act === 'rotR') rotatePage(p, act === 'rotR' ? 90 : 270);
});
function rotatePage(p, d) {
  if (p.state === 'work') return;
  const base = p.manualRot != null ? p.manualRot : (p.plan ? p.plan.rot : 0);
  p.manualRot = (base + d) % 360;
  freeParts(p.parts || []); p.parts = []; p.state = 'queued'; p.off = false;
  renderList(); pump();
}
$('#pause').addEventListener('click', () => { run.paused = !run.paused; progress(); if (!run.paused) pump(); });
$('#relang').addEventListener('click', () => {
  for (const p of pages) if (p.state === 'done' && p.parts.some(q => q.kind === 'ocr')) { freeParts(p.parts); p.parts = []; p.state = 'queued'; }
  renderList(); pump();
});
$('#clear').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Ryd alt?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Ryd'; }, 3000); return; }
  delete b.dataset.armed; b.textContent = 'Ryd';
  run.paused = false;
  for (const p of pages) { if (p.state === 'queued') p.state = 'cancel'; freeParts(p.parts || []); }
  pages.length = 0; title = ''; $('#title').value = '';
  renderList(); $('#job').hidden = true;
});
$('#title').addEventListener('input', () => { title = $('#title').value; });

/* ================= page view and corrections ================= */
let viewQ = null;
function viewList() { numberParts(); return [...partNo.keys()]; }
function openPage(q) {
  if (!q) return;
  viewQ = q;
  const n = partNo.get(q), list = viewList(), i = list.indexOf(q);
  $('#dlgTitle').textContent = q.kind === 'text' ? 'Tekst' : `Side ${n} af ${list.length}`;
  $('#prevPg').disabled = i <= 0; $('#nextPg').disabled = i < 0 || i >= list.length - 1;
  const sp = pages.find(p => p.parts.includes(q));
  $('#rotL').hidden = $('#rotR').hidden = !sp || !!sp.text || q.kind === 'pdftext';
  const pimg = $('#pimg');
  if (q.img) { const u = URL.createObjectURL(q.img); pimg.innerHTML = `<img src="${u}" alt="Den rettede side">`; pimg.firstChild.onload = () => URL.revokeObjectURL(u); }
  else pimg.innerHTML = q.thumb ? `<img src="${q.thumb}" alt="">` : '';
  pimg.hidden = !q.img && !q.thumb;
  const hf = (h, where) => h ? `<p class="hf">${where}${h.num != null && opt.heads ? ' (fjernes)' : ''}: ${esc(h.text)}</p>` : '';
  $('#hfTop').innerHTML = q.kind === 'ocr' || q.kind === 'pdftext' ? hf(q.head, 'Sidehoved') : '';
  $('#hfBot').innerHTML = q.kind === 'ocr' || q.kind === 'pdftext' ? hf(q.foot, 'Sidefod') : '';
  let html;
  if (q.edited) html = q.edited.map(t => `<p>${esc(t)}</p>`).join('');
  else if (q.kind === 'text') html = q.text.map(t => `<p>${esc(t)}</p>`).join('');
  else { const lex = lexicon(); html = q.paras.map(p => `<p class="${p.kind === 'p' ? '' : p.kind}">${paraWords(p, lex).map(w => w.c < 62 ? `<mark>${esc(w.t)}</mark>` : esc(w.t)).join(' ')}</p>`).join(''); }
  $('#edit').innerHTML = html || '<p></p>';
  $('#edit').lang = opt.lang === 'eng' ? 'en' : 'da';
  $('#saveEdit').disabled = true;
  $('#resetEdit').hidden = !q.edited;
  $('#editHint').textContent = q.kind === 'ocr' ? (q.paras.some(p => p.lines.some(l => l.some(w => w.c < 62))) ? 'Usikre ord er understreget. Ret direkte i teksten.' : 'Ret direkte i teksten.') : 'Ret direkte i teksten.';
  if (!$('#dlgPage').open) $('#dlgPage').showModal();
  $('.ped').scrollTop = 0; $('#pimg').scrollTop = 0;
}
$('#edit').addEventListener('input', () => { $('#saveEdit').disabled = false; });
$('#saveEdit').addEventListener('click', () => {
  if (!viewQ) return;
  const raw = $('#edit').innerText.replace(/ /g, ' ');
  viewQ.edited = raw.split(/\n\s*\n|\n/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  $('#saveEdit').disabled = true; $('#resetEdit').hidden = false;
  const sp = pages.find(p => p.parts.includes(viewQ)); if (sp) renderPage(sp);
  toast('Rettelserne er gemt.', 1600);
});
$('#resetEdit').addEventListener('click', () => { if (!viewQ) return; delete viewQ.edited; const sp = pages.find(p => p.parts.includes(viewQ)); if (sp) renderPage(sp); openPage(viewQ); });
function stepPage(d) {
  if (!$('#saveEdit').disabled) $('#saveEdit').click();
  const list = viewList(), i = list.indexOf(viewQ); if (list[i + d]) openPage(list[i + d]);
}
$('#prevPg').addEventListener('click', () => stepPage(-1));
$('#nextPg').addEventListener('click', () => stepPage(1));
$('#closePg').addEventListener('click', () => $('#dlgPage').close());
$('#dlgPage').addEventListener('close', () => { viewQ = null; });
$('#dlgPage').addEventListener('cancel', e => { if (!$('#saveEdit').disabled && !confirm('Luk uden at gemme rettelserne?')) e.preventDefault(); });
$('#dlgPage').addEventListener('keydown', e => {
  if (e.target.isContentEditable) return;
  if (e.key === 'ArrowLeft') stepPage(-1); else if (e.key === 'ArrowRight') stepPage(1);
});
for (const [id, d] of [['#rotL', 270], ['#rotR', 90]]) $(id).addEventListener('click', () => { const sp = pages.find(p => p.parts.includes(viewQ)); $('#dlgPage').close(); if (sp) rotatePage(sp, d); });

/* ================= input ================= */
$('#pick').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#cam').addEventListener('change', e => { addFiles([...e.target.files].map((f, i) => new File([f], `Foto ${new Date().toLocaleTimeString('da-DK')} ${i + 1}.jpg`, { type: f.type }))); e.target.value = ''; });
$('#camLbl').hidden = !COARSE;
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); addFiles(e.dataTransfer.files); });
addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  const fs = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (fs.length) { e.preventDefault(); addFiles(fs.map((f, i) => new File([f], `Indsat billede ${new Date().toLocaleTimeString('da-DK')}${fs.length > 1 ? ' ' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }))); }
});

/* ================= options ================= */
function syncOpts() {
  $$('#lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === opt.lang)));
  $$('[data-o]').forEach(el => { if (el.type === 'checkbox') el.checked = !!opt[el.dataset.o]; else el.value = String(opt[el.dataset.o]); });
}
$('#lang').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b || b.disabled) return; opt.lang = b.dataset.v; saveOpt(); syncOpts(); progress(); checkReady(); });
$$('[data-o]').forEach(el => el.addEventListener('change', () => {
  const k = el.dataset.o; opt[k] = el.type === 'checkbox' ? el.checked : (k === 'dpi' ? +el.value : el.value); saveOpt();
  if (['heads', 'hyph', 'notes'].includes(k)) renderList();
}));
syncOpts();

// Show whether the program and the chosen languages are stored for use without internet.
const ASSETS = () => ['ocr.html', 'ocr/app.js', 'ocr/tesseract.min.js', 'ocr/worker.min.js', 'ocr/core/tesseract-core-simd-lstm.wasm.js', 'ocr/core/tesseract-core-lstm.wasm.js', ...opt.lang.split('+').map(l => `ocr/lang/${l}.traineddata`)];
async function checkReady() {
  const el = $('#ready'); el.textContent = '';
  if (!SERVED || !('caches' in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
  try {
    const hits = await Promise.all(ASSETS().map(a => caches.match(abs(a), { ignoreSearch: true })));
    const simd = hits[4] || hits[5];
    el.textContent = hits.every((h, i) => h || i === 4 || i === 5) && simd ? 'Virker også uden internet' : '';
  } catch (e) {}
}

/* ================= start ================= */
if (!SERVED) {
  $('#fileNotice').hidden = false; $('#pick').disabled = true; $('#pickLbl').style.opacity = .4;
  $('#backLink').href = 'index.html';
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => setTimeout(checkReady, 800)).catch(() => {});
  if (location.hash === '#from-reader') {
    history.replaceState(null, '', location.pathname);
    idb('readonly', s => s.get('toOcr')).then(async h => {
      if (!h || !h.file) return;
      await idb('readwrite', s => s.delete('toOcr')).catch(() => {});
      const f = h.file instanceof File ? h.file : new File([h.file], h.name || 'scanning.pdf', { type: 'application/pdf' });
      addFiles([f]);
    }).catch(() => {});
  }
}
addEventListener('beforeunload', e => { if (pages.some(p => p.state === 'work' || p.state === 'queued')) { e.preventDefault(); e.returnValue = ''; } });
window.__ocr = { pages, opt, assemble, readerDoc, analyze, Pool };
