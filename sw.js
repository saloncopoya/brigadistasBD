/* ============================================================
   🔔 FIREBASE MESSAGING — Service Worker de notificaciones push
   ============================================================ */
importScripts('/vendor/firebase/firebase-app-compat.js');
importScripts('/vendor/firebase/firebase-messaging-compat.js');

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

/* ============================================================
   🔔 PUSH EN SEGUNDO PLANO
   Soporta:
   - payload.notification (título + body + icon)
   - payload.data (data-only push)
   - Botones personalizados via data.letra1/2/3 + data.boton1/2/3
   - Botones por defecto: VER / COMPARTIR / RECORDAR
   ============================================================ */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    if (event.data) {
      try { payload = event.data.json(); } catch (e) {
        try { payload = { notification: { title: 'Rutas BGD', body: event.data.text() } }; } catch (e2) {}
      }
    }

    const customData = payload.data || {};
    const notif = payload.notification || {};

    // Botones personalizados (letra1/boton1, letra2/boton2, letra3/boton3)
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

    const notificationTitle = notif.title || customData.title || 'Rutas BGD';
    const notificationBody  = notif.body  || customData.body  || 'Notificación importante';
    const notificationImage = notif.image || customData.image || '/img.png';

    const notificationOptions = {
      body: notificationBody,
      icon: notificationImage,
      badge: '/img.png',
      image: notificationImage,
      vibrate: [200, 100, 200],
      requireInteraction: true,
      priority: 'high',
      silent: false,
      renotify: true,
      tag: 'bgd_notificacion_' + Date.now(),
      actions: actions,
      data: {
        urls: urlsBotones,
        url_por_defecto: customData.url || notif.click_action || '/'
      }
    };

    await self.registration.showNotification(notificationTitle, notificationOptions);
  })());
});

/* ============================================================
   👆 CLIC EN NOTIFICACIÓN (botones y cuerpo)
   ============================================================ */
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

/* ============================================================
   🚫 CIERRE DE NOTIFICACIÓN (opcional, para limpieza)
   ============================================================ */
self.addEventListener('notificationclose', (event) => {
  // Nada que limpiar por ahora, pero es buena práctica tenerlo
});

/* ============================================================
   💾 CACHÉS
   ============================================================ */
const VERSION = 'bgd-v3.6.1';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/404.html',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/assets/icon.svg',
  '/img.png',
  '/js/db.js',
  '/js/publisher.js',
  '/js/app.js',
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
    await Promise.all(
      keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ============================================================
   🌐 FETCH — HTML y estáticos
   ============================================================ */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // No interceptar recursos externos (tiles, firebase, cloudinary, etc.)
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
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
      return fresh;
    }
    throw new Error('bad');
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response('<h1>Sin conexión</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
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

/* ============================================================
   🗺️ CACHÉ DE TILES OSM
   ============================================================ */
const TILE_CACHE = 'bgd-tiles-v1';
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org'
];
const TILE_MAX_ENTRIES = 2000;

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
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) {}
}

/* ============================================================
   💬 MENSAJES DESDE LA APP
   ============================================================ */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
