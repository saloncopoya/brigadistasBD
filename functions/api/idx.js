/* ============================================================
   /api/idx — Cachea índices de Firebase y GitHub en Cloudflare KV
   Reduce ~20x los reads a Firebase y elimina el rate limit de GitHub
   ============================================================ */

const ALLOWED_KEYS = ['rutas_index', 'marketplace', 'posts_index'];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: cors });
  }

  const key = url.searchParams.get('key');
  if (!key) {
    return new Response(JSON.stringify({ error: 'Falta parámetro key' }), { status: 400, headers: cors });
  }

  const isGeo = key.startsWith('rutas_geo/');
  if (!ALLOWED_KEYS.includes(key) && !isGeo) {
    return new Response(JSON.stringify({ error: 'Key no permitida' }), { status: 403, headers: cors });
  }

  // ── 1) ¿Está en KV? ─────────────────────────────────────────
  const kvKey = 'idx:' + key;
  let cached = null;
  try { cached = await env.INDEX_CACHE.get(kvKey); } catch (e) {}

  if (cached) {
    return new Response(cached, { headers: { ...cors, 'X-Cache': 'HIT-KV' } });
  }

  // ── 2) Traer origen ────────────────────────────────────────
  let data = null;

  if (key === 'posts_index') {
    // GitHub raw (no cuenta contra rate limit de la API de GitHub)
    const ghUrl = `https://raw.githubusercontent.com/${env.REPO_OWNER}/${env.REPO_NAME}/main/share/posts-index.json`;
    try {
      const res = await fetch(ghUrl, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (res.ok) data = await res.text();
    } catch (e) {}
  } else {
    // Firebase REST
    const fbUrl = `https://aplicacion-2c1c8.firebaseio.com/${key}.json`;
    try {
      const res = await fetch(fbUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
      if (res.ok) data = await res.text();
    } catch (e) {}
  }

  if (!data || data === 'null') {
    // Firebase vacío → devolver vacío limpio (no 502)
    const empty = key === 'posts_index' ? '{"posts":[],"total":0}' : '{}';
    context.waitUntil(env.INDEX_CACHE.put(kvKey, empty, { expirationTtl: 60 }));
    return new Response(empty, { headers: { ...cors, 'X-Cache': 'EMPTY' } });
  }

  // ── 3) Guardar en KV con TTL ───────────────────────────────
  const ttl = isGeo ? 3600 : 300; // geometría: 1h, índices: 5 min
  context.waitUntil(env.INDEX_CACHE.put(kvKey, data, { expirationTtl: ttl }));

  return new Response(data, { headers: { ...cors, 'X-Cache': 'MISS' } });
}
