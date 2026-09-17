

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
const VERSION = 'bgd-v7';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  // Páginas principales (URLs limpias — el usuario las escribe así)
  '/',
  '/admin',
  '/mapainteractivo',
  '/offline.html',
  '/404.html',

  // Metadatos
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',

  // Assets de la app
  '/assets/icon.svg',
  '/js/db.js',
  '/js/publisher.js',
  '/js/app.js',

  // Leaflet
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/leaflet/images/layers.png',
  '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet-image/leaflet-image.js',

  // IndexedDB / Firebase
  '/vendor/idb/umd.js',
  '/vendor/firebase/firebase-app-compat.js',
  '/vendor/firebase/firebase-database-compat.js',
  '/vendor/firebase/firebase-messaging-compat.js'
];

/* ============================================================
   🚀 INSTALL — precachea HTML/JS/CSS + DESCARGA RUTAS DE FIREBASE
   ============================================================ */
const FIREBASE_REST_URL =
  'https://aplicacion-2c1c8.firebaseio.com/rutas_colectivos_tgz.json';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 1) Precargar HTML/JS/CSS como antes
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) {}
    }));

    // 2) 🔥 NUEVO: descargar rutas de Firebase y guardarlas en IndexedDB
    try {
      await precacheRoutesToIndexedDB();
    } catch (e) {
      console.warn('[SW] No se pudieron precachear rutas:', e);
    }

    await self.skipWaiting();
  })());
});

/* ============================================================
   📦 PRECACHE DE RUTAS EN INDEXEDDB
   Descarga todas las rutas desde Firebase REST API y las
   guarda en IndexedDB (base de datos "bgd-db", store "routes")
   para que /mapainteractivo funcione offline desde la 1ª visita.
   ============================================================ */
async function precacheRoutesToIndexedDB() {
  // 1) Descargar rutas desde Firebase (REST, sin SDK)
  const res = await fetch(FIREBASE_REST_URL, {
    cache: 'no-store',
    credentials: 'omit'
  });
  if (!res.ok) throw new Error('Firebase HTTP ' + res.status);

  const data = await res.json();
  if (!data) return;

  const routes = Object.values(data).filter(r => r && r.id);
  if (!routes.length) return;

  console.log('[SW] 🔥 Rutas descargadas de Firebase:', routes.length);

  // 2) Abrir IndexedDB
  const db = await openSWDatabase();

  // Verificar que el store existe
  if (!db.objectStoreNames.contains('routes')) {
    console.warn('[SW] ⚠️ Store "routes" no existe, esperando upgrade...');
    db.close();
    return;
  }

  const tx = db.transaction('routes', 'readwrite');
  const store = tx.objectStore('routes');

  for (const route of routes) {
    store.put(route);
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  console.log('[SW] 💾 Rutas guardadas en IndexedDB:', routes.length);

  // 3) Guardar también en Cache Storage (por si IndexedDB se borra)
  try {
    const cache = await caches.open('bgd-routes-v1');
    await cache.put(
      '/__routes_snapshot__.json',
      new Response(JSON.stringify(routes), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch (e) {}
}

/* ============================================================
   🗄️ Abre (o crea) la base de datos IndexedDB desde el SW.
   ⚠️ Debe coincidir EXACTAMENTE con la config de /js/db.js
   ============================================================ */
/* ============================================================
   🗄️ Abre (o crea) la base de datos IndexedDB desde el SW.
   ✅ Coincide EXACTAMENTE con /js/db.js:
      DB_NAME = 'tgz_offline_db', DB_VERSION = 3
      Stores: posts, routes, market, syncQueue, tiles, meta, history
   ============================================================ */
function openSWDatabase() {
  return new Promise((resolve, reject) => {
    const DB_NAME = 'tgz_offline_db';
    const DB_VERSION = 3;

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Mismos stores que db.js
      ['posts', 'routes', 'market', 'syncQueue', 'tiles', 'meta', 'history']
        .forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            const s = db.createObjectStore(store, { keyPath: 'id' });

            // Índices solo para posts/routes/market (igual que db.js)
            if (store === 'posts' || store === 'routes' || store === 'market') {
              s.createIndex('timestamp', 'timestamp');
              s.createIndex('updatedAt', 'updatedAt');
              s.createIndex('tipo', 'tipo');
            }
            if (store === 'syncQueue') {
              s.createIndex('createdAt', 'createdAt');
            }
          }
        });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}


self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});



// 🎯 URLs que NO pasan por el SW → el navegador ve el 301 del servidor
const SW_BYPASS_PATHS = [
  /\.php$/
];

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ⚠️ NO interceptar recursos externos (tiles, firebase, etc.)
  if (url.origin !== self.location.origin) return;

  // 🔥 BYPASS: URLs con .html, .php y /share/* van directo al navegador
  if (SW_BYPASS_PATHS.some(re => re.test(url.pathname))) {
    return;
  }

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(htmlStrategy(req));
    return;
  }
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});



async function htmlStrategy(req) {
  try {
    // 1️⃣ Red primero con redirect manual (para poder PROPAGAR 301/302)
    const fresh = await fetch(req, { redirect: 'manual' });

    // 🔥 301/302/308 → propagar al navegador tal cual
    if (fresh.status === 301 || fresh.status === 302 || fresh.status === 308) {
      return fresh;
    }

    // 200 OK → guardar en caché y devolver
    if (fresh.ok) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    }

    // 404 u otro → devolver sin cachear
    return fresh;

  } catch (e) {
  const cache = await caches.open(HTML_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;

  // 🔥 Devolver 404 con el contenido de 404.html
  const notFound = await caches.match('/?tab=routes');
  if (notFound) {
    // Convertir el 200 de caché a 404 real
    const body = await notFound.text();
    return new Response(body, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // Sin caché de 404.html → respuesta mínima
  return new Response('<h1>404 - Sin conexión</h1>', {
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
const TILE_MAX_ENTRIES = 1000;   // tope duro para no llenar el disco

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
