// js/db.js — Capa de base de datos local (IndexedDB) con fallback
import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8.0.0/+esm';

const DB_NAME = 'brigadistas_db';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('routes'))   db.createObjectStore('routes',   { keyPath: 'id' });
        if (!db.objectStoreNames.contains('posts'))    db.createObjectStore('posts',    { keyPath: 'id' });
        if (!db.objectStoreNames.contains('market'))   db.createObjectStore('market',   { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tiles'))    db.createObjectStore('tiles',    { keyPath: 'url' });
        if (!db.objectStoreNames.contains('syncQueue'))db.createObjectStore('syncQueue',{ keyPath: 'qid', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta'))     db.createObjectStore('meta',     { keyPath: 'k' });
      }
    });
  }
  return dbPromise;
}

// ── Rutas ──
export const saveRoute    = async (r) => (await getDB()).put('routes', r);
export const getRoutes    = async () => (await getDB()).getAll('routes');
export const getRoute     = async (id) => (await getDB()).get('routes', id);
export const deleteRoute  = async (id) => (await getDB()).delete('routes', id);

// ── Posts ──
export const savePost     = async (p) => (await getDB()).put('posts', p);
export const getPosts     = async () => {
  const all = await (await getDB()).getAll('posts');
  return all.sort((a,b) => (b.ts||0) - (a.ts||0));
};
export const getPost      = async (id) => (await getDB()).get('posts', id);
export const deletePost   = async (id) => (await getDB()).delete('posts', id);

// ── Market ──
export const saveMarket   = async (m) => (await getDB()).put('market', m);
export const getMarket    = async () => (await getDB()).getAll('market');
export const getMarketOne = async (id) => (await getDB()).get('market', id);
export const deleteMarket = async (id) => (await getDB()).delete('market', id);

// ── Cola de sincronización ──
export const queueSync = async (op) => (await getDB()).add('syncQueue', { ...op, ts: Date.now() });
export const getQueue  = async () => (await getDB()).getAll('syncQueue');
export const clearQueue= async () => (await getDB()).clear('syncQueue');
export const removeQ   = async (qid) => (await getDB()).delete('syncQueue', qid);

// ── Meta ──
export const setMeta = async (k, v) => (await getDB()).put('meta', { k, v });
export const getMeta = async (k) => (await getDB()).get('meta', k);

// ── Tiles del mapa (offline) ──
export const saveTile = async (url, blob) => (await getDB()).put('tiles', { url, blob, ts: Date.now() });
export const getTile  = async (url) => (await getDB()).get('tiles', url);
export const countTiles = async () => (await getDB()).count('tiles');

// ── Utilidad: generar ID corto ──
export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}
export function genId(name) {
  const d = new Date();
  const stamp = `${d.getDate()}${d.getMonth()+1}${d.getFullYear()}`;
  return `${slugify(name)}-${stamp}-${Math.random().toString(36).slice(2,6)}`;
}
