/* ==========================================================================
   SW.JS — Corregido: NO intercepta tiles con credentials:include
   Los tiles deben ir DIRECTO a la red sin que el SW los toque.
   ========================================================================== */

const VERSION = 'bgd-v6';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  '/', '/index.html', '/admin.html', '/offline.html',
  '/manifest.json', '/robots.txt', '/sitemap.xml',
  '/assets/icon.svg', '/js/db.js', '/js/publisher.js', '/js/app.js',
  '/js/main.js', '/js/blog.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { console.warn('[SW precache fail]', url); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ⚠️ CRÍTICO: NO interceptar tiles. Dejarlos pasar DIRECTO.
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('tile.openstreetmap.fr') ||
      url.hostname.includes('maps.wikimedia.org')) {
    return; // El navegador maneja el fetch normalmente
  }

  // NO interceptar APIs externas
  if (url.hostname.includes('nominatim.openstreetmap.org') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('cloudinary.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  // Mismo origen
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(htmlStrategy(req));
      return;
    }
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  }
});

async function htmlStrategy(req) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
      return fresh;
    }
    throw new Error('bad status');
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response('<h1>Sin conexión</h1>', {
      status: 503, headers: { 'Content-Type': 'text/html' }
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) { return cached || Response.error(); }
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
