

/* ============================================================
   🔔 FIREBASE MESSAGING — Service Worker de notificaciones push
   ============================================================ */


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

    const n = payload.notification || {};
    const d = payload.data || {};

    const notificationTitle = n.title || d.title || 'Rutas BGD';
    const notificationOptions = {
      body: n.body || d.body || 'Notificación importante',
      icon: n.icon || d.image || '/img.png',
      badge: '/img.png',
      image: n.image || d.image || '/img.png',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      priority: 'high',
      silent: false,
      renotify: true,
      tag: 'bgd_notificacion_' + Date.now(),
      actions: actions,
      data: {
        urls: urlsBotones,
        url_por_defecto: d.url || n.click_action || '/'
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
const VERSION = 'bgd-v15';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE = [
  '/', 
   '/index.html', '/admin.html',
   '/index', 
   '/offline.html',
  '/manifest.json', 
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

 // ⚠️ NO interceptar recursos externos
  if (url.origin !== self.location.origin) return;

  // 🚫 No interceptar APIs
  if (url.pathname.startsWith('/api/')) return;

  // 🛑 NUEVO: NO interceptar sitemap.xml ni robots.txt
  if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
    return; // Deja que el navegador y Google lo pidan directo a Cloudflare
  }

   
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
   🗺️ CACHÉ DE TILES OSM — v3 con validación y network-first
   ------------------------------------------------------------
   ✔ Intenta RED primero (tiles frescos)
   ✔ Valida que el tile no esté vacío/negro antes de cachear
   ✔ Si la red falla → cae al CACHÉ (offline)
   ✔ Sin red y sin caché → tile transparente 1x1
   ✔ Poda automática de tiles viejos
   ============================================================ */
const TILE_CACHE = 'bgd-tiles-v3';
const TILE_HOSTS = [
  'api.maptiler.com'
];
const TILE_MAX_ENTRIES = 5000;
const TILE_MIN_BYTES = 200;          // PNG real > 200 bytes; vacío ~100
const TILE_FETCH_TIMEOUT_MS = 8000;  // timeout de red por tile

// 🛡️ Tile transparente 1x1 (fallback final)
const TRANSPARENT_TILE = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
), c => c.charCodeAt(0));

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

  // ─────────────────────────────────────────────
  // 1️⃣ Intentar RED con timeout (tiles frescos)
  // ─────────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TILE_FETCH_TIMEOUT_MS);

    const fresh = await fetch(req, {
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (fresh && fresh.ok) {
      // 🔍 Validar que el tile NO esté vacío
      const clone = fresh.clone();
      const blob = await clone.blob();

      if (blob.size >= TILE_MIN_BYTES) {
        // ✅ Tile real → guardar en caché
        cache.put(req, fresh.clone()).then(() => pruneTileCache(cache)).catch(() => {});
        return fresh;
      }

      // ⚠️ Tile sospechosamente pequeño (negro/vacío)
      //    NO lo cacheamos, pero SÍ lo devolvemos por si MapTiler
      //    lo usa legítimamente (raro pero posible)
      return fresh;
    }

    // ❌ Respuesta no-ok (404, 403, 500) → NO cachear
    //    Caer al caché si existe
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(TRANSPARENT_TILE, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });

  } catch (err) {
    // ─────────────────────────────────────────────
    // 2️⃣ Red falló (offline, timeout, sin WiFi real)
    //    → caer al CACHÉ
    // ─────────────────────────────────────────────
    const cached = await cache.match(req);
    if (cached) return cached;

    // ─────────────────────────────────────────────
    // 3️⃣ Sin red y sin caché → tile transparente
    // ─────────────────────────────────────────────
    return new Response(TRANSPARENT_TILE, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });
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
