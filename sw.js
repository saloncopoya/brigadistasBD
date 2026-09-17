

/* ============================================================
   🔔 FIREBASE MESSAGING — Service Worker de notificaciones push
   ============================================================ */
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// ✅ MISMO proyecto que tu app (aplicacion-2c1c8)
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


// Notificaciones push en segundo plano
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    if (event.data) {
      try { payload = event.data.json(); } catch (e) {}
    }

    const customData = payload.data || {};

    const botones = [];
    for (let i = 1; i <= 3; i++) {
      const nombreBoton = customData[`letra${i}`];
      const urlBoton = customData[`boton${i}`];
      if (nombreBoton && urlBoton) {
        botones.push({ action: `boton_${i}`, title: nombreBoton });
      }
    }

    const actions = botones.length > 0 ? botones : [
      { action: 'ver', title: '👁️ VER' },
      { action: 'compartir', title: '📤 COMPARTIR' },
      { action: 'recordar', title: '⏰ RECORDAR' }
    ];

    const urlsBotones = {};
    for (let i = 1; i <= 3; i++) {
      const urlBoton = customData[`boton${i}`];
      if (urlBoton) urlsBotones[`boton_${i}`] = urlBoton;
    }

    const notificationTitle = (payload.notification && payload.notification.title) || 'Rutas BGD';
    const notificationOptions = {
      body: (payload.notification && payload.notification.body) || 'Notificación importante',
      icon: (payload.notification && payload.notification.image) || '/img.png',
      badge: '/img.png',
      image: (payload.notification && payload.notification.image) || '/img.png',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      priority: 'high',
      silent: false,
      renotify: true,
      tag: 'bgd_notificacion_' + Date.now(),
      actions: actions,
      data: {
        urls: urlsBotones,
        url_por_defecto: customData.url || '/'
      }
    };

    await self.registration.showNotification(notificationTitle, notificationOptions);
  })());
});

// Clic en los botones de la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlsGuardadas = (event.notification.data && event.notification.data.urls) || {};
  const urlPorDefecto = (event.notification.data && event.notification.data.url_por_defecto) || '/';

  let urlToOpen = urlPorDefecto;
  if (event.action === 'boton_1' && urlsGuardadas['boton_1']) urlToOpen = urlsGuardadas['boton_1'];
  else if (event.action === 'boton_2' && urlsGuardadas['boton_2']) urlToOpen = urlsGuardadas['boton_2'];
  else if (event.action === 'boton_3' && urlsGuardadas['boton_3']) urlToOpen = urlsGuardadas['boton_3'];
  else if (event.action === 'ver') urlToOpen = '/?tab=routes';
  else if (event.action === 'compartir') urlToOpen = '/?tab=home';
  else if (event.action === 'recordar') urlToOpen = '/?tab=market';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

/* SW.JS — v8 · NO intercepta tiles ni APIs externas */
const VERSION = 'bgd-v1.3';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  '/', '/index.html', '/admin.html', '/offline.html',
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

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ⚠️ NO interceptar recursos externos (tiles, firebase, etc.)
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(htmlStrategy(req));
    return;
  }
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

async function htmlStrategy(req) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) { cache.put(req, fresh.clone()); return fresh; }
    throw new Error('bad');
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response('<h1>Sin conexión</h1>', { status: 503, headers: { 'Content-Type': 'text/html' } });
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

/* ============================================================
   🗺️ CACHÉ DE TILES OSM — capa extra sobre IndexedDB
   ------------------------------------------------------------
   ✔ Solo guarda tiles que el usuario VE (no prefetch).
   ✔ Respeta la política de OSM (caché por uso).
   ✔ Si el usuario borra IndexedDB, el SW aún tiene los tiles.
   ============================================================ */
const TILE_CACHE = 'bgd-tiles-v1';
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org'
];
const TILE_MAX_ENTRIES = 2000;   // tope duro para no llenar el disco

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!TILE_HOSTS.includes(url.hostname)) return;

  event.respondWith(handleTileRequest(req));
});

async function handleTileRequest(req) {
  const cache = await caches.open(TILE_CACHE);

  // 1️⃣ Cache-first (rápido y offline-friendly)
  const cached = await cache.match(req);
  if (cached) return cached;

  // 2️⃣ No hay caché → red
  try {
    const fresh = await fetch(req, { mode: 'cors', credentials: 'omit' });
    if (fresh && fresh.ok) {
      // Guardar copia (sin await para no bloquear la respuesta)
      cache.put(req, fresh.clone()).then(() => pruneTileCache(cache));
    }
    return fresh;
  } catch (err) {
    // 3️⃣ Sin red y sin caché → tile vacío (transparente 1x1 PNG)
    return new Response(
      Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      ), c => c.charCodeAt(0)),
      { status: 200, headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// Poda: si superamos N tiles, borramos los más antiguos
async function pruneTileCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= TILE_MAX_ENTRIES) return;
    const toDelete = keys.length - TILE_MAX_ENTRIES;
    // Las keys vienen en orden de inserción → las primeras son las más viejas
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) {}
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
