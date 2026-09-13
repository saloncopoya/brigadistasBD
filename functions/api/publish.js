// functions/api/publish.js — Cloudflare Pages Function
// Crea/actualiza el HTML SEO de post/ruta/market en GitHub, actualiza index y sitemap.

const GH_API = 'https://api.github.com';

const FOLDER = { p: 'share/p', r: 'share/r', m: 'share/m' };
const TYPE_LABEL = { p: 'Publicación', r: 'Ruta', m: 'Marketplace' };

export async function onRequest(context) {
  const { request, env } = context;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const body = await request.json();
    if (body.password !== env.ADMIN_PASSWORD) {
      return json({ ok: false, error: 'Contraseña incorrecta' }, 401, cors);
    }

    if (request.method === 'DELETE') return await handleDelete(body, env, cors);
    return await handlePublish(body, env, cors);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500, cors);
  }
}

async function handlePublish(b, env, cors) {
  const { type, slug, title, description, content, image, extra } = b;
  if (!type || !slug || !title) return json({ ok: false, error: 'Faltan campos' }, 400, cors);

  const folder = FOLDER[type] || 'share/p';
  const site = env.SITE_DOMAIN || 'https://brigadistasbd.pages.dev';
  const canonical = `${site}/${folder}/${slug}.html`;

  const html = buildHtml({ type, slug, title, description, content, image, extra, canonical, site });

  // 1) Subir HTML individual
  await ghPut(env, `${folder}/${slug}.html`, html, `Publicar ${type}: ${slug}`);

  // 2) Actualizar posts-index.json
  const index = await getJson(env, 'share/posts-index.json') || { posts: [], updatedAt: 0, total: 0 };
  index.posts = index.posts.filter(p => !(p.slug === slug && p.type === type));
  index.posts.unshift({
    slug, type, title, description: description || '',
    image: image || '', url: `/${folder}/${slug}.html`,
    ts: Date.now()
  });
  index.posts = index.posts.slice(0, 2000);
  index.updatedAt = Date.now();
  index.total = index.posts.length;
  await ghPut(env, 'share/posts-index.json', JSON.stringify(index, null, 2), `Update index: ${slug}`);

  // 3) Regenerar sitemap.xml
  await regenerateSitemap(env, index, site);

  return json({ ok: true, url: `/${folder}/${slug}.html`, canonical }, 200, cors);
}

async function handleDelete(b, env, cors) {
  const { type, slug } = b;
  const folder = FOLDER[type] || 'share/p';
  await ghDelete(env, `${folder}/${slug}.html`, `Eliminar ${type}: ${slug}`);

  const index = await getJson(env, 'share/posts-index.json') || { posts: [] };
  index.posts = index.posts.filter(p => !(p.slug === slug && p.type === type));
  index.updatedAt = Date.now();
  index.total = index.posts.length;
  await ghPut(env, 'share/posts-index.json', JSON.stringify(index, null, 2), `Update index (delete): ${slug}`);
  await regenerateSitemap(env, index, env.SITE_DOMAIN);
  return json({ ok: true }, 200, cors);
}

// ═══ GitHub helpers ═══
async function ghPut(env, path, contentStr, message) {
  const url = `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
  const headers = ghHeaders(env);
  // Obtener SHA si existe
  let sha = null;
  const cur = await fetch(url, { headers });
  if (cur.ok) { const j = await cur.json(); sha = j.sha; }
  const content = btoa(unescape(encodeURIComponent(contentStr)));
  const res = await fetch(url, {
    method: 'PUT', headers,
    body: JSON.stringify({ message, content, sha: sha || undefined, branch: 'main' })
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
}

async function ghDelete(env, path, message) {
  const url = `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
  const headers = ghHeaders(env);
  const cur = await fetch(url, { headers });
  if (!cur.ok) return; // ya no existe
  const { sha } = await cur.json();
  await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ message, sha, branch: 'main' }) });
}

async function getJson(env, path) {
  const url = `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) return null;
  const j = await res.json();
  const txt = decodeURIComponent(escape(atob(j.content)));
  return JSON.parse(txt);
}

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'brigadistas-bd',
    'Content-Type': 'application/json'
  };
}

async function regenerateSitemap(env, index, site) {
  const urls = ['/'];
  index.posts.forEach(p => urls.push(p.url));
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${site}${u}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>`;
  await ghPut(env, 'sitemap.xml', xml, 'Regenerar sitemap');
}

// ═══ HTML con SEO completo ═══
function buildHtml({ type, slug, title, description, content, image, extra, canonical, site }) {
  const img = image || `${site}/assets/icon.svg`;
  const desc = (description || (content || '').slice(0, 155)).replace(/[<>]/g, '');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': type === 'r' ? 'TouristTrip' : type === 'm' ? 'Product' : 'BlogPosting',
    name: title,
    headline: title,
    description: desc,
    image: img,
    url: canonical,
    publisher: { '@type': 'Organization', name: 'Brigadistas BD', logo: { '@type': 'ImageObject', url: `${site}/assets/icon.svg` } },
    datePublished: new Date().toISOString()
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · Brigadistas BD</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${canonical}"/>
<meta name="robots" content="index,follow"/>
<meta property="og:type" content="article"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(img)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:site_name" content="Brigadistas BD"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(img)}"/>
<link rel="icon" href="/assets/icon.svg"/>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0e1a;color:#e6edf7;line-height:1.6}
header{position:sticky;top:0;background:rgba(10,14,26,.9);backdrop-filter:blur(12px);border-bottom:1px solid #1f2a44;padding:12px 16px;display:flex;align-items:center;gap:12px}
header a{color:#00e5ff;text-decoration:none;font-weight:700}
main{max-width:800px;margin:0 auto;padding:20px}
img.hero{width:100%;max-height:480px;object-fit:cover;border-radius:14px;margin-bottom:16px}
h1{font-size:26px;margin:0 0 8px}
.meta{color:#9aa7bd;font-size:13px;margin-bottom:16px}
.content{white-space:pre-wrap;font-size:16px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.chip{padding:5px 10px;background:#131a2b;border:1px solid #1f2a44;border-radius:8px;font-size:12px}
footer{text-align:center;padding:30px;color:#9aa7bd;font-size:13px}
a.btn{display:inline-block;background:#00e5ff;color:#001820;padding:10px 18px;border-radius:10px;font-weight:800;text-decoration:none;margin-top:16px}
</style>
</head>
<body>
<header>
  <a href="/">← Brigadistas BD</a>
</header>
<main>
  <h1>${esc(title)}</h1>
  <div class="meta">${TYPE_LABEL[type] || 'Publicación'} · ${new Date().toLocaleDateString('es-MX')}</div>
  ${image ? `<img class="hero" src="${esc(image)}" alt="${esc(title)}"/>` : ''}
  <div class="content">${esc(content || '')}</div>
  ${extra && Object.keys(extra).length ? `<div class="chips">${Object.entries(extra).map(([k,v]) => `<span class="chip">${esc(k)}: ${esc(String(v))}</span>`).join('')}</div>` : ''}
  <a class="btn" href="/">Ver rutas y más en Brigadistas BD</a>
</main>
<footer>© ${new Date().getFullYear()} Brigadistas BD · Tuxtla Gutiérrez, Chiapas</footer>
<script src="/js/blog.js" defer></script>
</body>
</html>`;
}

function esc(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
