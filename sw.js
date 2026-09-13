/* SW.JS — v4 · Corregido para /admin y navegación HTML */
const VERSION = 'bgd-v4';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;
const TILES_CACHE = `${VERSION}-tiles`;

const PRECACHE = [
  '/',
  '/index.html',
  '/admin.html',
  '/offline.html',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/assets/icon.svg',
  '/js/db.js',
  '/js/publisher.js',
  '/js/app.js',
  '/js/main.js',
  '/js/blog.js'
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

  // Tiles OSM
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(req));
    return;
  }

  // Externos (CDNs, Firebase, Nominatim, Cloudinary) → red directa
  if (url.origin !== self.location.origin) return;

  // HTML (navegación) → network-first SIN fallback a index.html
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(htmlStrategy(req));
    return;
  }

  // Estáticos propios → cache-first
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

async function htmlStrategy(req) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.status === 200) {
      cache.put(req, fresh.clone());
      console.log('🌐 Desde INTERNET:', new URL(req.url).pathname);
      return fresh;
    }
    // Si la red responde error (404, 308, 503...) intentamos cache
    throw new Error('bad status ' + fresh.status);
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) {
      console.log('✅ Desde CACHÉ:', new URL(req.url).pathname);
      return cached;
    }
    // Sin cache → offline.html
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    return new Response('<h1>Sin conexión</h1>', {
      status: 503, headers: { 'Content-Type': 'text/html' }
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) { console.log('✅ Desde CACHÉ:', new URL(req.url).pathname); return cached; }
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    console.log('🌐 Desde INTERNET:', new URL(req.url).pathname);
    return fresh;
  } catch (e) { return cached || Response.error(); }
}

async function tileStrategy(req) {
  const cache = await caches.open(TILES_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req, { mode: 'cors' });
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
      const keys = await cache.keys();
      if (keys.length > 500) await cache.delete(keys[0]);
    }
    return fresh;
  } catch (e) { return new Response('', { status: 504 }); }
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
