/* Deixa o app abrir sem internet (o salão do sorteio pode não ter sinal). */
const CACHE = 'sorteio-vagas-v4';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'data.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'img/mapa-original.jpg',
  'fonts/barlow-latin-400-normal.woff2',
  'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-500-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-800-normal.woff2',
];

// Tudo é guardado já na primeira visita, antes de o service worker assumir a página.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Com sinal, busca a versão mais nova; sem sinal ou com sinal ruim, responde do cache.
// Se a própria página teve de vir do cache, o resto dela vem do cache sem esperar a rede.
let cacheFirstUntil = 0;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isPage = request.mode === 'navigate';

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const fresh = fetch(request.url, { cache: 'no-cache' }).then((response) => {
        if (response.ok && !response.redirected) cache.put(url.origin + url.pathname, response.clone());
        return response;
      });
      if (!cached) return fresh;
      event.waitUntil(fresh.catch(() => {}));

      const offline = self.navigator.onLine === false;
      if (offline && isPage) cacheFirstUntil = Date.now() + 20000;
      if (offline || (!isPage && Date.now() < cacheFirstUntil)) return cached;

      return new Promise((resolve) => {
        let settled = false;
        const useCache = () => {
          if (settled) return;
          settled = true;
          if (isPage) cacheFirstUntil = Date.now() + 20000;
          resolve(cached);
        };
        const timer = setTimeout(useCache, isPage ? 1500 : 2500);
        fresh.then((response) => {
          if (settled) return;
          if (!response.ok) { useCache(); return; }
          settled = true;
          clearTimeout(timer);
          resolve(response);
        }, useCache);
      });
    })
  );
});
