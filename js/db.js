// js/db.js — capa de IndexedDB compartida
const DB_NAME = "blog-offline-db";
const DB_VERSION = 1;
const STORES = ["posts", "pages", "images", "meta"];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode = "readonly") {
  const db = await openDB();
  return db.transaction(store, mode).objectStore(store);
}

const DB = {
  async put(store, value) {
    const s = await tx(store, "readwrite");
    return new Promise((res, rej) => {
      const r = s.put(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(store, id) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async all(store) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async clear(store) {
    const s = await tx(store, "readwrite");
    return new Promise((res, rej) => {
      const r = s.clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
};

// Exponer global
self.DB = DB;

// ===== Helpers de negocio =====

// Guarda todos los posts del índice en IndexedDB
async function cachePostsIndex(posts) {
  for (const p of posts) {
    await DB.put("posts", { id: p.slug, ...p });
  }
  await DB.put("meta", { id: "lastSync", value: Date.now() });
}

// Devuelve los posts locales ordenados por fecha
async function getLocalPosts() {
  const all = await DB.all("posts");
  return all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Guarda el HTML completo de una página (url -> html)
async function cachePage(url, html) {
  await DB.put("pages", { id: url, html, ts: Date.now() });
}

async function getPage(url) {
  return DB.get("pages", url);
}

// Precarga y cachea el HTML de cada post + su imagen
async function precacheAllPosts(posts) {
  for (const p of posts) {
    const url = "/" + p.url;
    try {
      const cached = await getPage(url);
      if (cached) continue;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const html = await res.text();
        await cachePage(url, html);
      }
    } catch (e) {
      // offline, se guardará después
    }
    if (p.image) {
      try {
        const already = await DB.get("images", p.image);
        if (already) continue;
        const r = await fetch(p.image, { mode: "cors" });
        if (r.ok) {
          const blob = await r.blob();
          await DB.put("images", { id: p.image, blob });
        }
      } catch {}
    }
  }
}

self.BlogCache = {
  cachePostsIndex,
  getLocalPosts,
  cachePage,
  getPage,
  precacheAllPosts,
};
