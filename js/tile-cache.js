/* ==========================================================================
   TILE-CACHE.JS — Caché de mosaicos OSM en IndexedDB para uso offline
   --------------------------------------------------------------------------
   ✔ Cumple la política de OSM: solo guarda lo que el usuario VE.
   ✔ Sin prefetch ni scraping. Límite configurable de tiles.
   ✔ Comparte la caché entre TODOS los mapas (ruta, trip, editor).
   ✔ Si la red falla, devuelve el tile desde IndexedDB.
   ========================================================================== */
(function (global) {
  'use strict';

  // ─── Configuración ────────────────────────────────────────────────────
  const DB_NAME   = 'bgd_tiles_v1';
  const STORE     = 'tiles';
  const MAX_TILES = 1500;                              // tope duro (~50 MB)
  const MAX_AGE   = 1000 * 60 * 60 * 24 * 30;          // 30 días
  const FLUSH_EVERY = 25;                              // guarda en lote

  // ─── IndexedDB helpers ────────────────────────────────────────────────
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'url' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbPromise;
  }

  async function getTile(url) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(url);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async function putTile(record) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async function countTiles() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(0);
      });
    } catch (e) { return 0; }
  }

  async function deleteTile(url) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(url);
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  // Poda: borra los tiles más viejos si superamos MAX_TILES
  async function pruneOldest() {
    try {
      const db = await openDB();
      const total = await countTiles();
      if (total <= MAX_TILES) return;
      const toDelete = total - MAX_TILES;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const idx = tx.objectStore(STORE).index('savedAt');
        let deleted = 0;
        idx.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || deleted >= toDelete) { resolve(); return; }
          cursor.delete();
          deleted++;
          cursor.continue();
        };
      });
    } catch (e) {}
  }

  // Limpieza por antigüedad
  async function pruneExpired() {
    try {
      const db = await openDB();
      const cutoff = Date.now() - MAX_AGE;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const idx = tx.objectStore(STORE).index('savedAt');
        const range = IDBKeyRange.upperBound(cutoff);
        idx.openCursor(range).onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) { resolve(); return; }
          cursor.delete();
          cursor.continue();
        };
      });
    } catch (e) {}
  }

  // ─── Convertir respuesta a blob para guardar ──────────────────────────
  async function responseToBlob(response) {
    try {
      return await response.clone().blob();
    } catch (e) {
      return null;
    }
  }

  // ─── Leaflet Plugin ───────────────────────────────────────────────────
  let pending = [];   // lote de escrituras
  let pendingCount = 0;

  async function flushPending() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    pendingCount = 0;
    for (const rec of batch) await putTile(rec);
    // Tras escribir, podar si hace falta
    const total = await countTiles();
    if (total > MAX_TILES) pruneOldest();
  }

  function scheduleeFlush() {
    if (pendingCount >= FLUSH_EVERY) {
      flushPending();
    } else {
      clearTimeout(scheduleeFlush._t);
      scheduleeFlush._t = setTimeout(flushPending, 1500);
    }
  }

  // Plugin: extiende L.TileLayer con soporte de IndexedDB
  if (typeof L !== 'undefined') {
    L.TileLayer.Offline = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        // Construir URL del tile (igual que hace Leaflet)
        const url = this.getTileUrl(coords);

        // 1️⃣ Intentar primero en IndexedDB
        (async () => {
          const cached = await getTile(url);
          if (cached && cached.blob) {
            const objectUrl = URL.createObjectURL(cached.blob);
            tile.onload = () => {
              URL.revokeObjectURL(objectUrl);
              done(null, tile);
            };
            tile.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              // Aunque falle, intentamos red
              fetchAndCacheTile(tile, url, done);
            };
            tile.src = objectUrl;
            return;
          }
          // 2️⃣ No hay caché → red
          fetchAndCacheTile(tile, url, done);
        })();

        return tile;
      }
    });

    async function fetchAndCacheTile(tile, url, done) {
      try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const blob = await responseToBlob(response);
        if (blob) {
          pending.push({ url, blob, savedAt: Date.now() });
          pendingCount++;
          scheduleeFlush();
        }

        const objectUrl = URL.createObjectURL(blob);
        tile.onload = () => {
          URL.revokeObjectURL(objectUrl);
          done(null, tile);
        };
        tile.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          done(new Error('img error'), tile);
        };
        tile.src = objectUrl;
      } catch (err) {
        // Sin red y sin caché → tile vacío
        done(err, tile);
      }
    }

    L.tileLayer.offline = function (url, options) {
      return new L.TileLayer.Offline(url, options);
    };
  }

  // ─── API pública ──────────────────────────────────────────────────────
  global.TileCache = {
    get count() { return countTiles(); },
    clear: async () => {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve(true);
      });
    },
    pruneExpired,
    flushPending,
    // Diagnóstico para la consola
    stats: async () => {
      const total = await countTiles();
      return { total, maxTiles: MAX_TILES, maxAgeDays: MAX_AGE / (1000*60*60*24) };
    }
  };

  // Limpieza al arrancar
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => pruneExpired());
    } else {
      pruneExpired();
    }
  }
})(window);
