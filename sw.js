// Reader – service worker: keeps the app on the device so it starts offline.
// Pages (Reader and Ψ-OCR) are fetched fresh when there is a connection, so a new
// version shows up the next time the app is opened; without a connection the stored
// copy is used. Other files are served from the store and refreshed in the background.
// Ψ-OCR's program files and language models (ocr/…) are stored the first time they are used.
const CACHE = 'reader-v3';
const FILES = ['./', './index.html', './ocr.html', './ocr/app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const offline = () => new Response('Reader er offline, og siden er ikke gemt endnu.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // dictionary look-ups go straight to the network
  if (req.mode === 'navigate') {
    // network first (a quick check with the server), stored copy if offline or slow
    const key = url.pathname.endsWith('/') ? './index.html' : url.pathname.replace(/^.*\//, './');
    e.respondWith(caches.open(CACHE).then(async cache => {
      const net = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
        .then(res => { if (res.ok) cache.put(key, res.clone()); return res; });
      const slow = new Promise(r => setTimeout(r, 4000, null));
      try {
        const res = await Promise.race([net, slow]);
        if (res && res.ok) return res;
      } catch (err) {}
      e.waitUntil(net.catch(() => null));
      return (await cache.match(key, { ignoreSearch: true })) || (await net.catch(() => null)) || offline();
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || offline();
  }));
});
