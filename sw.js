/* Deixa o app abrir sem internet (o salão do sorteio pode não ter sinal). */
const CACHE = 'sorteio-vagas-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'data.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'img/mapa-original.jpg',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Com sinal, busca a versão mais nova; sem sinal (ou com sinal lento), responde do cache.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const ours = url.origin === self.location.origin;
  if (!ours && !FONT_HOSTS.includes(url.hostname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: ours });
      const fresh = fetch(ours ? request.url : request, ours ? { cache: 'no-cache' } : undefined).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      if (!cached) return fresh;
      if (!ours) {
        // as fontes não mudam: cache primeiro
        event.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
      return Promise.race([fresh.catch(() => cached), slow]);
    })
  );
});
