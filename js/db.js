/* ==========================================================================
   DB.JS — Capa de base de datos local con IndexedDB (idb)
   Proporciona CRUD offline para: posts, routes, market, sync queue, tiles
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'tgz_offline_db';
  const DB_VERSION = 3;

  let dbPromise = null;

  async function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        ['posts', 'routes', 'market', 'syncQueue', 'tiles', 'meta', 'history'].forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            const s = db.createObjectStore(store, { keyPath: 'id' });
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
      }
    });
    return dbPromise;
  }

  // ---------- CRUD genérico ----------
  async function get(store, id) {
    const db = await openDB();
    return db.get(store, id);
  }

  async function getAll(store) {
    const db = await openDB();
    return db.getAll(store);
  }

  async function put(store, value) {
    const db = await openDB();
    return db.put(store, value);
  }

  async function del(store, id) {
    const db = await openDB();
    return db.delete(store, id);
  }

  async function clear(store) {
    const db = await openDB();
    return db.clear(store);
  }

  async function count(store) {
    const db = await openDB();
    return db.count(store);
  }

  // ---------- Cola de sincronización ----------
  async function queueSync(op) {
    const db = await openDB();
    const item = {
      id: 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(),
      ...op
    };
    await db.put('syncQueue', item);
    return item;
  }

  async function getQueue() {
    const db = await openDB();
    return db.getAll('syncQueue');
  }

  async function clearQueue() {
    const db = await openDB();
    return db.clear('syncQueue');
  }

  async function removeQueueItem(id) {
    const db = await openDB();
    return db.delete('syncQueue', id);
  }

  // ---------- Meta helpers ----------
  async function setMeta(key, value) {
    return put('meta', { id: key, value, updatedAt: Date.now() });
  }
  async function getMeta(key) {
    const r = await get('meta', key);
    return r ? r.value : null;
  }

  // ---------- Historial local ----------
  async function pushHistory(entry) {
    const db = await openDB();
    const item = { id: 'h_' + Date.now(), ...entry };
    await db.put('history', item);
    // Limitar a 200 entradas
    const all = await db.getAll('history');
    if (all.length > 200) {
      all.sort((a, b) => a.id.localeCompare(b.id));
      const excess = all.slice(0, all.length - 200);
      for (const e of excess) await db.delete('history', e.id);
    }
    return item;
  }
  async function getHistory() {
    const db = await openDB();
    const all = await db.getAll('history');
    return all.sort((a, b) => b.id.localeCompare(a.id));
  }

  // ---------- Export/Import ----------
  async function exportAll() {
    const [posts, routes, market] = await Promise.all([
      getAll('posts'), getAll('routes'), getAll('market')
    ]);
    return { posts, routes, market, exportedAt: Date.now(), version: DB_VERSION };
  }

  async function importAll(data) {
    const db = await openDB();
    const tx = db.transaction(['posts', 'routes', 'market'], 'readwrite');
    if (data.posts) for (const p of data.posts) await tx.objectStore('posts').put(p);
    if (data.routes) for (const r of data.routes) await tx.objectStore('routes').put(r);
    if (data.market) for (const m of data.market) await tx.objectStore('market').put(m);
    await tx.done;
  }

  // ---------- API pública ----------
  global.DB = {
    openDB, get, getAll, put, delete: del, clear, count,
    queueSync, getQueue, clearQueue, removeQueueItem,
    setMeta, getMeta, pushHistory, getHistory,
    exportAll, importAll
  };

  // Aliases para compatibilidad con código que use otros nombres
  global.dbGet = get;
  global.dbPut = put;
  global.dbDel = del;
  global.dbAll = getAll;

})(window);
