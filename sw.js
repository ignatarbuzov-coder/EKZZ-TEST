/* Офлайн-работа: все файлы программы (включая модели распознавания) сохраняются на устройстве. */
const CACHE = 'tp-v6';
const FILES = ["./","css/app.css","data/base.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","index.html","js/app.js","js/importers.js","js/library.js","js/voice.js","js/ocr.js","js/search.js","js/store.js","lib/jszip.min.js","lib/pdf/pdf.min.js","lib/pdf/pdf.worker.min.js","lib/tessdata/eng.traineddata.gz","lib/tessdata/rus.traineddata.gz","lib/tesseract/tesseract-core-lstm.wasm.js","lib/tesseract/tesseract-core-simd-lstm.wasm.js","lib/tesseract/tesseract.min.js","lib/tesseract/worker.min.js","lib/xlsx.full.min.js","manifest.webmanifest"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const isHtml = r => r && r.ok && (r.headers.get('content-type') || '').includes('text/html');
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Открытие программы: всегда страница index.html (из сети, без сети — из памяти телефона)
    e.respondWith(fetch(req).then(r => isHtml(r) ? r : caches.match('index.html'))
      .catch(() => caches.match('index.html')).then(r => r || fetch('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return res;
  })));
});
