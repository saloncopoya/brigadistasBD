const CACHE_NAME = 'cotejo-offline-v1.0.0.61'; 
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
     '/img.png',
   "/index.html",
  "/admin.html",
  "/offline.html",
  "/css/style.css",
  "/js/main.js",
  "/js/publisher.js",
  "/js/db.js",
  "/manifest.json",
  "/paginas/posts-index.json",
    'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js'
];

// Instalar Service Worker
self.addEventListener('install', event => {
    console.log('⚡ Service Worker instalando...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async cache => {
                console.log('📦 Cacheando archivos base...');
                
                for (const url of urlsToCache) {
                    try {
                        await cache.add(url);
                        console.log('✅ Cacheado:', url);
                    } catch (err) {
                        console.warn('⚠️ No se pudo cachear:', url, err);
                    }
                }
            })
    );
    self.skipWaiting();
});

// Activar Service Worker
self.addEventListener('activate', event => {
    console.log('✅ Service Worker activado');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('🧹 Eliminando cache antiguo:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Interceptar peticiones
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Estrategia: Primero caché, luego red
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Si el archivo está en caché, lo devolvemos inmediatamente
                if (response) {
                    console.log('✅ Desde CACHÉ:', url.pathname);
                    return response;
                }
                
                // Si NO está en caché, vamos a internet
                console.log('🌐 Desde INTERNET:', url.pathname);
                const fetchRequest = event.request.clone();
                
                return fetch(fetchRequest).then(response => {
                    // Verificar que la respuesta sea válida
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    
                    // Clonar la respuesta para guardarla y devolverla
                    const responseToCache = response.clone();
                    
                    // Guardar automáticamente en caché el archivo visitado
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                        console.log('💾 Guardado en CACHÉ:', url.pathname);
                    });
                    
                    return response;
                }).catch(() => {
                    // Si falla la red y no está en caché, mostrar index.html
                    if (event.request.mode === 'navigate') {
                        console.log('📴 Offline - Mostrando index.html');
                        return caches.match('/index.html');
                    }
                    return new Response('Contenido no disponible offline', {
                        status: 503,
                        statusText: 'Offline',
                        headers: new Headers({ 'Content-Type': 'text/plain' })
                    });
                });
            })
    );
});
