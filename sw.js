/* ============================================================
   SERVICE WORKER — Rutas BGD
   v5.0 · No intercepta /admin ni /mapainteractivo
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAiojpfnGUPhaoQkpAh1Yey3fp6uWU-iFQ",
  authDomain: "aplicacion-2c1c8.firebaseapp.com",
  databaseURL: "https://aplicacion-2c1c8.firebaseio.com",
  projectId: "aplicacion-2c1c8",
  storageBucket: "aplicacion-2c1c8.firebasestorage.app",
  messagingSenderId: "837629411067",
  appId: "1:837629411067:web:6c96cfcd7490b049787a5e",
  measurementId: "G-SFP1SEY20W"
});

/* ─── NOTIFICACIONES PUSH ─── */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    if (event.data) { try { payload = event.data.json(); } catch (e) {} }
    const customData = payload.data || {};
    const botones = [];
    for (let i = 1; i <= 3; i++) {
      const n = customData[`letra${i}`], u = customData[`boton${i}`];
      if (n && u) botones.push({ action: `boton_${i}`, title: n });
    }
    const actions = botones.length > 0 ? botones : [
      { action: 'ver', title: '👁️ VER' },
      { action: 'compartir', title: '📤 COMPARTIR' },
      { action: 'recordar', title: '⏰ RECORDAR' }
    ];
    const urlsBotones = {};
    for (let i = 1; i <= 3; i++) {
      const u = customData[`boton${i}`];
      if (u) urlsBotones[`boton_${i}`] = u;
    }
    await self.registration.showNotification(
      (payload.notification && payload.notification.title) || 'Rutas BGD',
      {
        body: (payload.notification && payload.notification.body) || 'Notificación importante',
        icon: (payload.notification && payload.notification.image) || '/img.png',
        badge: '/img.png',
        image: (payload.notification && payload.notification.image) || '/img.png',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        priority: 'high',
        silent: false,
        renotify: true,
        tag: 'bgd_notif_' + Date.now(),
        actions,
        data: { urls: urlsBotones, url_por_defecto: customData.url || '/' }
      }
    );
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urls = (event.notification.data && event.notification.data.urls) || {};
  const def  = (event.notification.data && event.notification.data.url_por_defecto) || '/';
  let urlToOpen = def;
  if (event.action === 'boton_1' && urls['boton_1']) urlToOpen = urls['boton_1'];
  else if (event.action === 'boton_2' && urls['boton_2']) urlToOpen = urls['boton_2'];
  else if (event.action === 'boton_3' && urls['boton_3']) urlToOpen = urls['boton_3'];
  else if (event.action === 'ver') urlToOpen = '/?tab=routes';
  else if (event.action === 'compartir') urlToOpen = '/?tab=home';
  else if (event.action === 'recordar') urlToOpen = '/?tab=market';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url === urlToOpen && 'focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

/* ─── CACHÉ ─── */
const VERSION = 'bgd-v5.0';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  '/', '/index.html', '/offline.html',
  '/manifest.json', '/robots.txt', '/sitemap.xml',
  '/assets/icon.svg', '/js/db.js', '/js/publisher.js', '/js/app.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/leaflet/images/layers.png',
  '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet-image/leaflet-image.js',
  '/vendor/idb/umd.js',
  '/vendor/firebase/firebase-app-compat.js',
  '/vendor/firebase/firebase-database-compat.js',
  '/vendor/firebase/firebase-messaging-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) {}
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

/* ─── FETCH (un solo listener, con exclusiones primero) ─── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 🚫 EXCLUSIONES ABSOLUTAS — ni tocar estas rutas
  const EXCLUIR = ['/admin', '/admin/', '/mapainteractivo', '/mapainteractivo/'];
  if (EXCLUIR.includes(url.pathname)) return;
  if (url.pathname.startsWith('/share/')) return;

  // 🗺️ TILES OSM
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(handleTileRequest(req));
    return;
  }

  // Externos → no tocar
  if (url.origin !== self.location.origin) return;

  // 📄 HTML
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(htmlStrategy(req));
    return;
  }

  // 📦 Estáticos
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

async function htmlStrategy(req) {
  const cache = await caches.open(HTML_CACHE);

  // 🔑 CLAVE: Reconstruir la request con redirect: 'follow'
  let reqToFetch = req;
  try {
    reqToFetch = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'follow',
      cache: 'no-cache'
    });
  } catch (e) {}

  try {
    const fresh = await fetch(reqToFetch);
    if (fresh && fresh.ok) {
      try { cache.put(req, fresh.clone()); } catch (e) {}
      return fresh;
    }
    throw new Error('bad');
  } catch (e) {
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
  } catch (e) {
    return cached || new Response('', { status: 503, statusText: 'Offline' });
  }
}

/* ─── TILES OSM ─── */
const TILE_CACHE = 'bgd-tiles-v2';
const TILE_MAX_ENTRIES = 2000;

async function handleTileRequest(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req, { mode: 'cors', credentials: 'omit' });
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone()).then(() => pruneTileCache(cache));
    }
    return fresh;
  } catch (err) {
    return new Response(
      Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      ), c => c.charCodeAt(0)),
      { status: 200, headers: { 'Content-Type': 'image/png' } }
    );
  }
}

async function pruneTileCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= TILE_MAX_ENTRIES) return;
    const toDelete = keys.length - TILE_MAX_ENTRIES;
    for (let i = 0; i < toDelete; i++) await cache.delete(keys[i]);
  } catch (e) {}
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
