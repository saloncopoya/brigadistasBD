/* ==========================================================================
   PUBLISH.JS — Cloudflare Function para publicar posts, rutas y market
   en GitHub con SEO completo (Open Graph, Schema.org, sitemap, índice)
   ========================================================================== */

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    let { password, tipo, slug, title, content, image, extra } = body;

    // 🖼️ Para rutas: usar mapImage si existe (imagen del mapa con trazado)
    if (tipo === 'ruta' && extra && extra.route && extra.route.mapImage) {
      image = extra.route.mapImage;
    }
    // 🖼️ Para market: usar extra.market.image si no se mandó image
    if (tipo === 'market' && !image && extra && extra.market && extra.market.image) {
      image = extra.market.image;
    }

    // Verificar contraseña
    if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Contraseña incorrecta' }), { status: 401, headers });
    }

    // Si es solo verificación
    if (body.__check) {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

     // ============================================================
    //  🗑️ MODO ELIMINAR: borra el HTML, del índice y del sitemap
    // ============================================================
    if (body.__delete) {
      if (!slug || !tipo) {
        return new Response(JSON.stringify({ error: 'Faltan slug o tipo para eliminar' }), { status: 400, headers });
      }

      const { GITHUB_TOKEN: T, REPO_OWNER: O, REPO_NAME: N, SITE_DOMAIN: D } = env;
      if (!T || !O || !N) {
        return new Response(JSON.stringify({ error: 'Configuración de GitHub incompleta' }), { status: 500, headers });
      }

      const domain = (D || 'brigadistasbd.pages.dev').replace(/^https?:\/\//, '').replace(/\/$/, '');
      const baseUrl = `https://${domain}`;

      let folder = 'share/post';
      if (tipo === 'ruta') folder = 'share/ruta';
      else if (tipo === 'market') folder = 'share/m';

      const safeSlug = slug.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
      const htmlPath = `${folder}/${safeSlug}.html`;

      const ghHeaders = {
        'Authorization': `Bearer ${T}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'brigadistasbd-publisher',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      const apiBase = `https://api.github.com/repos/${O}/${N}/contents`;

      let deletedHtml = false;

      // 1️⃣ Borrar el HTML
      try {
        const checkRes = await fetch(`${apiBase}/${htmlPath}?ref=main`, { headers: ghHeaders });
        if (checkRes.ok) {
          const checkJson = await checkRes.json();
          const delRes = await fetch(`${apiBase}/${htmlPath}`, {
            method: 'DELETE',
            headers: ghHeaders,
            body: JSON.stringify({
              message: `eliminar: ${tipo} ${safeSlug}`,
              sha: checkJson.sha,
              branch: 'main'
            })
          });
          deletedHtml = delRes.ok;
        }
      } catch (e) {
        console.warn('[delete] Error borrando HTML:', e);
      }

      // 2️⃣ Leer índice, quitar entrada, y GUARDAR
      const indexPath = 'share/posts-index.json';
      let index = { posts: [], total: 0, updatedAt: null };
      let indexSha = null;

      try {
        const idxRes = await fetch(`${apiBase}/${indexPath}?ref=main`, { headers: ghHeaders });
        if (idxRes.ok) {
          const idxJson = await idxRes.json();
          indexSha = idxJson.sha;
          const decoded = decodeURIComponent(escape(atob(idxJson.content.replace(/\n/g, ''))));
          index = JSON.parse(decoded);
        }
      } catch (e) {
        console.warn('[delete] Error leyendo índice:', e);
      }

      const before = (index.posts || []).length;
      index.posts = (index.posts || []).filter(p => {
        if (p.slug === safeSlug) return false;
        const pUrl = String(p.url || '').replace(/\.html$/, '').split('?')[0];
        if (pUrl.endsWith('/' + safeSlug)) return false;
        return true;
      });
      const removed = before - index.posts.length;
      index.total = index.posts.length;
      index.updatedAt = new Date().toISOString();

      if (indexSha) {
        try {
          const putRes = await fetch(`${apiBase}/${indexPath}`, {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: `actualizar índice (eliminar ${safeSlug})`,
              content: b64EncodeUnicode(JSON.stringify(index, null, 2)),
              sha: indexSha,
              branch: 'main'
            })
          });
          if (!putRes.ok) {
            const errTxt = await putRes.text();
            console.error('[delete] Error guardando índice:', errTxt);
          }
        } catch (e) {
          console.error('[delete] Error guardando índice:', e);
        }
      }

      // 3️⃣ Regenerar sitemap con el índice YA actualizado
      try {
        await regenerateSitemap(env, ghHeaders, baseUrl, index);
      } catch (e) {
        console.error('[delete] Error regenerando sitemap:', e);
      }

      return new Response(JSON.stringify({
        ok: true,
        deleted: true,
        slug: safeSlug,
        htmlDeleted: deletedHtml,
        removedFromIndex: removed,
        totalInIndex: index.posts.length
      }), { headers });
    }
     

    // ---------- Si no es eliminar, es crear/actualizar ----------
    if (!slug || !title) {
      return new Response(JSON.stringify({ error: 'Faltan slug o título' }), { status: 400, headers });
    }

    const {
      GITHUB_TOKEN, REPO_OWNER, REPO_NAME, SITE_DOMAIN
    } = env;

    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
      return new Response(JSON.stringify({ error: 'Configuración de GitHub incompleta' }), { status: 500, headers });
    }

    const domain = SITE_DOMAIN || 'brigadistasbd.pages.dev';
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${cleanDomain}`;

    // Determinar carpeta según tipo
    let folder = 'share/post';
    if (tipo === 'ruta') folder = 'share/ruta';
    else if (tipo === 'market') folder = 'share/m';

    const safeSlug = slug.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
     const htmlPath = `${folder}/${safeSlug}.html`;
const cleanPath = `${folder}/${safeSlug}`;
    const pageUrl = `${baseUrl}/${cleanPath}`;
    // ---------- Generar HTML con SEO completo ----------
    const html = generateHTML({
      tipo, title, content, image, slug: safeSlug, pageUrl, baseUrl, extra
    });

    // ---------- Subir a GitHub ----------
    const ghHeaders = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'brigadistasbd-publisher',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    const apiBase = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

    // Obtener SHA si el archivo existe
    let sha = null;
    try {
      const checkRes = await fetch(`${apiBase}/${htmlPath}?ref=main`, { headers: ghHeaders });
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        sha = checkJson.sha;
      }
    } catch (e) {}

    // Crear/actualizar archivo HTML
    const putBody = {
      message: `publicar: ${tipo} ${safeSlug}`,
      content: b64EncodeUnicode(html),
      branch: 'main'
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(`${apiBase}/${htmlPath}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const errTxt = await putRes.text();
      return new Response(JSON.stringify({ error: 'Error al subir HTML', detail: errTxt }), { status: 502, headers });
    }

    // ---------- Actualizar índice posts-index.json ----------
    const indexPath = 'share/posts-index.json';
    let index = { posts: [], total: 0, updatedAt: null };
    try {
      const idxRes = await fetch(`${apiBase}/${indexPath}?ref=main`, { headers: ghHeaders });
      if (idxRes.ok) {
        const idxJson = await idxRes.json();
        const decoded = decodeURIComponent(escape(atob(idxJson.content.replace(/\n/g, ''))));
        index = JSON.parse(decoded);
        index.__sha = idxJson.sha;
      }
    } catch (e) {}

    index.posts = index.posts || [];
    // Eliminar duplicados por slug
    index.posts = index.posts.filter(p => p.slug !== safeSlug);
    index.posts.unshift({
      slug: safeSlug,
      title,
      description: (content || '').slice(0, 160),
      image: image || '',
      url: `/${cleanPath}`,
      tipo: tipo || 'post',
      timestamp: Date.now(),
      updatedAt: new Date().toISOString(),
      // 🔍 Campos extra para SEO/búsqueda
      categoria: extra?.route?.categoria || '',
      tarifa: extra?.route?.tarifa || '',
      frecuencia: extra?.route?.frecuencia || '',
      horarioIni: extra?.route?.horarioIni || '',
      horarioFin: extra?.route?.horarioFin || '',
      dias: extra?.route?.dias || '',
      paradas: extra?.route?.paradas || [],
      calles: extra?.route?.calles || [],
      pois: extra?.route?.pois || []
    });
     
    index.total = index.posts.length;
    index.updatedAt = new Date().toISOString();

    const idxPutBody = {
      message: `actualizar índice: ${safeSlug}`,
      content: b64EncodeUnicode(JSON.stringify(index, null, 2)),
      branch: 'main'
    };
    if (index.__sha) idxPutBody.sha = index.__sha;

    await fetch(`${apiBase}/${indexPath}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(idxPutBody)
    }).catch(() => {});

    // ---------- Regenerar sitemap.xml ----------
    await regenerateSitemap(env, ghHeaders, baseUrl, index);

    return new Response(JSON.stringify({
      ok: true,
      url: pageUrl,
      canonical: pageUrl,
      index,
      folder
    }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error interno', detail: err.message }), { status: 500, headers });
  }
}

// ==========================================================================
//  Utilidades
// ==========================================================================
function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ==========================================================================
//  Generador de HTML
// ==========================================================================
function generateHTML({ tipo, title, content, image, slug, pageUrl, baseUrl, extra }) {
  // 📰 Título optimizado para SEO (50-60 caracteres)
  let seoTitle = title;
  if (tipo === 'ruta') {
    // Añadir palabras clave al título
    const cat = extra?.route?.categoria ? ` - ${extra.route.categoria}` : '';
    const kw = 'Tuxtla Gutiérrez Chiapas';
    seoTitle = `${title}${cat} · ${kw}`;
  } else if (tipo === 'market') {
    seoTitle = `${title} · Marketplace Tuxtla Gutiérrez`;
  } else {
    seoTitle = `${title} · Blog Rutas BGD`;
  }
  // Limitar a 60 caracteres
  if (seoTitle.length > 60) seoTitle = seoTitle.slice(0, 57) + '...';

  const safeTitle = escapeHTML(title);       // título original (para h1)
  const safeSeoTitle = escapeHTML(seoTitle); // título SEO (para <title> y og:title)

   
 
// 🛡️ Helpers anti-crash
const toStr = (v) => (v == null ? '' : String(v));
const toStrArr = (v) => Array.isArray(v) ? v.filter(Boolean).map(toStr) : [];

// Construir descripción enriquecida según el tipo
let enrichedContent = toStr(content);
if (tipo === 'ruta' && extra?.route) {
  const r = extra.route;
  const parts = [];

  if (r.notas) {
    parts.push(` ${toStr(r.notas).slice(0, 80)}`);
  }

  const paradas = toStrArr(r.paradas);
  if (paradas.length) {
    parts.push(`📍 ${paradas.slice(0, 5).join(', ')}${paradas.length > 5 ? '...' : ''}`);
  }

  const pois = toStrArr(r.pois);
  if (pois.length) {
    parts.push(` ${pois.slice(0, 5).join(', ')}${pois.length > 5 ? '...' : ''}`);
  }

  const calles = toStrArr(r.calles);
  if (calles.length) {
    parts.push(` ${calles.slice(0, 4).join(', ')}${calles.length > 4 ? '...' : ''}`);
  }

  if (r.tarifa) parts.push(`💰 ${toStr(r.tarifa)}`);
  if (r.frecuencia) parts.push(`⏱️ ${toStr(r.frecuencia)}`);

  if (parts.length) {
    enrichedContent = parts.join(' · ');
  }
}
   
// 📝 Descripción: 155 caracteres para meta description (Google corta a ~160)
const safeDesc = escapeHTML(enrichedContent.slice(0, 155));
// 🐦 Para OG (redes sociales cortan a ~125)
const safeDescOG = escapeHTML(enrichedContent.slice(0, 125));
   
   const safeImage = (image && typeof image === 'string' && image.trim().startsWith('http'))
     ? escapeHTML(image.trim())
     : `${baseUrl}/img.png`;
   
  const typeLabel = tipo === 'ruta' ? 'Ruta' : tipo === 'market' ? 'Anuncio' : 'Publicación';

  // Schema.org
  let schema;
  if (tipo === 'ruta') {
    const r = extra?.route || {};
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BusTrip',
      name: title,
      description: enrichedContent.slice(0, 160),
      url: pageUrl,
      image: safeImage,
      provider: { '@type': 'Organization', name: 'Rutas BGD', url: baseUrl },
      departureTime: r.horarioIni || undefined,
      arrivalTime: r.horarioFin || undefined,
      offers: r.tarifa ? {
        '@type': 'Offer',
        price: String(r.tarifa).replace(/[^0-9.]/g, '') || '0',
        priceCurrency: 'MXN'
      } : undefined,
itinerary: toStrArr(r.paradas).map(p => ({ '@type': 'Place', name: p }))
    };
  } else if (tipo === 'market') {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: title,
      description: safeDesc,
      image: safeImage,
      url: pageUrl,
      offers: {
        '@type': 'Offer',
        price: extra?.market?.price || '0',
        priceCurrency: 'MXN',
        availability: 'https://schema.org/InStock'
      }
    };
  } else {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      description: safeDesc,
      image: safeImage,
      url: pageUrl,
      datePublished: new Date().toISOString(),
      author: { '@type': 'Organization', name: 'Rutas BGD' },
      publisher: {
        '@type': 'Organization',
        name: 'Rutas BGD',
        logo: { '@type': 'ImageObject', url: `${baseUrl}/assets/icon.svg` }
      }
    };
  }

  let bodyContent;
  if (tipo === 'ruta' && extra?.route) {
    // 🗺️ Para rutas: primero el mapa interactivo, luego los datos
bodyContent = renderRouteMapBlock(extra.route, baseUrl) + renderRouteBody(extra.route, baseUrl);
  } else if (tipo === 'market' && extra?.market) {
    bodyContent = renderMarketBody(extra.market);
  } else {
    bodyContent = `<div class="post-content">${escapeHTML(content).replace(/\n/g, '<br>')}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="es" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
<meta name="theme-color" content="#0a0e1a">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${safeSeoTitle}</title>
<meta name="description" content="${safeDesc}">
<link rel="canonical" href="${pageUrl}">
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icon.svg">
<link rel="apple-touch-icon" sizes="152x152" href="/assets/icon.svg">
<link rel="apple-touch-icon" sizes="120x120" href="/assets/icon.svg">
<meta name="format-detection" content="telephone=no">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Rutas BGD">
<link rel="preconnect" href="https://unpkg.com">
<link rel="preconnect" href="https://tile.openstreetmap.org">

<!-- Open Graph -->
<meta property="og:type" content="${tipo === 'post' ? 'article' : 'website'}">
<meta property="og:title" content="${safeSeoTitle}">
<meta property="og:description" content="${safeDescOG}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="Rutas BGD">
<meta property="og:locale" content="es_MX">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeSeoTitle}">
<meta name="twitter:description" content="${safeDescOG}">
<meta name="twitter:image" content="${safeImage}">

<!-- Schema.org -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">

<style>
:root{
  --cyan:#00e5ff;--cyan-d:#00b8cc;--cyan-glow:rgba(0,229,255,.35);
  --purple:#a855f7;--green:#10b981;--amber:#f59e0b;--red:#ef4444;
  --radius:14px;--radius-sm:10px;--radius-lg:22px;
  --shadow:0 10px 30px rgba(0,0,0,.35);--shadow-sm:0 4px 12px rgba(0,0,0,.25);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --header-h:58px;--nav-h:64px;--transition:.25s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"]{--bg:#0a0e1a;--bg-2:#0f1526;--surface:#141c30;--surface-2:#1c2540;--surface-3:#242f4d;--border:#26314f;--border-2:#334066;--text:#e8edf7;--text-2:#a9b4cc;--text-3:#6b7793;--input-bg:#0f1626}
[data-theme="light"]{--bg:#f4f6fb;--bg-2:#fff;--surface:#fff;--surface-2:#f4f6fb;--surface-3:#e8ecf5;--border:#dde3ee;--border-2:#c5cfe2;--text:#0c1322;--text-2:#4a5773;--text-3:#8a95ad;--input-bg:#f8fafd}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.6;padding:0;padding-top:var(--header-h);padding-bottom:calc(var(--nav-h) + env(safe-area-inset-bottom))}

/* HEADER */
.header{position:fixed;top:0;left:0;right:0;height:var(--header-h);background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:1000}
.header-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.3px;color:var(--text);text-decoration:none}
.header-brand .logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));display:grid;place-items:center;color:#00121a;box-shadow:0 0 18px var(--cyan-glow)}
.header-brand .logo svg{width:20px;height:20px}
.header-brand .brand-txt{background:linear-gradient(90deg,var(--cyan),#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.header-actions{display:flex;align-items:center;gap:6px}
.icon-btn{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:var(--text-2);transition:var(--transition);text-decoration:none}
.icon-btn:hover{background:var(--surface-2);color:var(--cyan)}
.icon-btn svg{width:20px;height:20px}

/* NAV INFERIOR */
.bottom-nav{position:fixed;bottom:0;left:0;right:0;height:calc(var(--nav-h) + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:color-mix(in srgb,var(--surface) 96%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);z-index:1000}
.nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--text-3);font-size:11px;font-weight:600;transition:var(--transition);text-decoration:none;position:relative}
.nav-item svg{width:23px;height:23px}
.nav-item.active{color:var(--cyan)}
.nav-item.active::before{content:"";position:absolute;top:6px;width:44px;height:3px;border-radius:0 0 4px 4px;background:var(--cyan);box-shadow:0 0 14px var(--cyan-glow)}

/* CONTENIDO */
.wrap{max-width:760px;margin:0 auto;padding:20px}
.back{display:inline-flex;align-items:center;gap:6px;color:var(--cyan);text-decoration:none;font-size:13px;font-weight:700;margin-bottom:16px}
h1{font-size:26px;font-weight:900;letter-spacing:-.4px;margin-bottom:8px;line-height:1.2}
.meta{color:var(--text-2);font-size:13px;margin-bottom:20px}

/* 🔒 IMAGEN SEO: oculta visualmente pero presente para crawlers */
.seo-hero{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* MAPA GRANDE */
.route-map-hero{
  width:100%;height:50vh;min-height:340px;
  border-radius:var(--radius);overflow:hidden;
  border:1px solid var(--border);background:var(--surface-2);
  position:relative;margin-bottom:20px;
}
#shareMapBig{width:100%;height:100%;z-index:1}
.map-fs-btn{position:absolute;bottom:12px;right:12px;z-index:600;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid var(--border-2);border-radius:12px;width:42px;height:42px;display:grid;place-items:center;color:var(--text);box-shadow:var(--shadow);backdrop-filter:blur(10px);cursor:pointer}
.map-fs-btn svg{width:20px;height:20px}
.map-wrap.is-fullscreen{position:fixed!important;inset:0!important;z-index:9500!important;margin:0!important;border-radius:0!important;border:none!important;height:100vh!important}
.map-wrap.is-fullscreen #shareMapBig{height:100vh!important;width:100vw!important}
body.fs-active{overflow:hidden!important}
.leaflet-container{background:var(--bg-2)!important;font-family:var(--font)!important}
.leaflet-control-attribution{background:color-mix(in srgb,var(--surface) 88%,transparent)!important;color:var(--text-2)!important;font-size:10px!important}
.leaflet-control-attribution a{color:var(--cyan)!important}
.leaflet-control-zoom a{background:var(--surface)!important;color:var(--text)!important;border-color:var(--border)!important}


/* LEYENDA MAPA (compacta) */
.map-legend{background:color-mix(in srgb,var(--surface) 92%,transparent)!important;padding:4px 10px;border-radius:8px;font-size:11px;color:var(--text);border:1px solid var(--border);line-height:1.3;backdrop-filter:blur(8px)}
.map-legend .lg-line{display:inline-block;width:16px;height:5px;vertical-align:middle;margin-right:6px;border-radius:2px}

/* Botón centrado inferior dentro del mapa */
.map-trip-btn-wrap{pointer-events:auto;padding-bottom:0px;position:absolute!important;left:50%!important;bottom:10px!important;transform:translateX(-50%)!important;z-index:700!important}
.leaflet-bottom.leaflet-left,.leaflet-bottom.leaflet-right{width:100%;pointer-events:none}
.leaflet-bottom.leaflet-left>*,.leaflet-bottom.leaflet-right>*{pointer-events:auto}

.map-trip-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:2px 5px;border-radius:12px;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.2px;border:1px solid transparent;box-shadow:0 6px 18px -6px rgba(0,229,255,.35);cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);text-align:center;white-space:nowrap}
.map-trip-btn:hover{filter:brightness(1.08);box-shadow:0 8px 22px -6px rgba(0,229,255,.55)}
.map-trip-btn:active{transform:scale(.96)}
.map-trip-btn svg{width:14px;height:14px}
.map-trip-btn span{font-size:11.5px;font-weight:800;line-height:1}
.map-trip-btn small{font-size:9.5px;font-weight:600;opacity:.75;line-height:1;letter-spacing:.1px}

/* BLOQUES */
.block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px}
.block h3{font-size:14px;font-weight:800;margin-bottom:10px;color:var(--cyan);display:flex;align-items:center;gap:6px}
.block ul{list-style:none;padding:0}
.block li{padding:7px 0;border-bottom:1px solid var(--border);font-size:14px}
.block li:last-child{border-bottom:none}
.post-content{font-size:15.5px;line-height:1.7;color:var(--text);background:var(--surface);padding:18px;border-radius:var(--radius);border:1px solid var(--border);margin-bottom:20px}
.badge{display:inline-block;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px}
.badge-urbana{background:rgba(0,229,255,.16);color:var(--cyan)}
.badge-foranea{background:rgba(168,85,247,.18);color:var(--purple)}
.badge-green{background:rgba(16,185,129,.16);color:var(--green)}
.price{font-size:22px;font-weight:900;color:var(--green);margin:10px 0}
.cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:11px 18px;border-radius:10px;font-weight:700;font-size:13.5px;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
.btn-primary{background:linear-gradient(135deg,var(--cyan),#00b8cc);color:#00121a}
.btn-ghost{background:var(--surface);color:var(--text);border:1px solid var(--border)}
/* 📝 PÁRRAFOS INTRODUCTORIOS (SEO) */
.intro-paragraphs{margin:20px 0}
.intro-paragraphs p{font-size:14.5px;line-height:1.75;color:var(--text-2);margin-bottom:14px;text-align:justify}
.intro-paragraphs p strong{color:var(--text);font-weight:700}
.intro-paragraphs p a{color:var(--cyan);text-decoration:none}
.intro-paragraphs p a:hover{text-decoration:underline}

footer{margin-top:30px;padding-top:20px;border-top:1px solid var(--border);color:var(--text-2);font-size:12px;text-align:center}
footer a{color:var(--cyan)}
</style>
</head>
<body data-theme="dark">

<!-- HEADER -->
<header class="header">
  <a class="header-brand" href="${baseUrl}/">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
    <span class="brand-txt">TUXRUTAS</span>
    </a>
  <div class="header-actions">
    <a class="icon-btn" href="${baseUrl}/" title="Ir al inicio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </a>
  </div>
</header>

<div class="wrap">

 <div class="cta">
    <a class="btn btn-primary" href="${baseUrl}/">🚌 Ver todas las rutas</a>
    <a class="btn btn-ghost" href="${baseUrl}/?tab=market" rel="nofollow">🛒 Marketplace</a>
  </div>

  
  <span class="badge badge-${tipo === 'ruta' ? (extra?.route?.categoria === 'foranea' ? 'foranea' : 'urbana') : tipo === 'market' ? 'green' : 'urbana'}">${typeLabel}</span>
  <h1>${safeTitle}</h1>
  <div class="meta">${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

  <!-- 🔒 IMAGEN SEO: oculta visualmente pero indexable por Google -->
  ${image ? `<img class="seo-hero" src="${safeImage}" alt="${safeTitle}" title="${safeTitle}" width="1200" height="630" loading="eager">` : ''}
  
  ${bodyContent}


  ${introParagraph(extra?.route, title, baseUrl)}


  
  
  <footer>© ${new Date().getFullYear()} Rutas BGD · <a href="${baseUrl}">${cleanDomain(baseUrl)}</a></footer>
</div>

<!-- NAV INFERIOR -->
<nav class="bottom-nav">
  <a class="nav-item" href="${baseUrl}/?tab=home" rel="nofollow">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <span>Inicio</span>
  </a>
  <a class="nav-item ${tipo === 'ruta' ? 'active' : ''}" href="${baseUrl}/?tab=routes" rel="nofollow">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V9a4 4 0 0 1 4-4h4"/><path d="M18 8v7a4 4 0 0 1-4 4H9"/></svg>
    <span>Rutas</span>
  </a>
  <a class="nav-item ${tipo === 'market' ? 'active' : ''}" href="${baseUrl}/?tab=market" rel="nofollow">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    <span>Market</span>
  </a>
</nav>

<script>
// 🖥️ Botón pantalla completa del mapa
(function(){
  var btn = document.getElementById('mapFsBtn');
  var wrap = document.getElementById('mapWrapHero');
  if(!btn || !wrap) return;
  var ENTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 3v3a2 2 0 0 1-2 2H4"/><path d="M21 9h-3a2 2 0 0 0-2 2v3"/><path d="M3 15h3a2 2 0 0 1 2 2v3"/><path d="M15 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  btn.innerHTML = ENTER;
  btn.onclick = function(){
    var isFs = wrap.classList.toggle('is-fullscreen');
    document.body.classList.toggle('fs-active', isFs);
    btn.innerHTML = isFs ? EXIT : ENTER;
    setTimeout(function(){ if(window.__shareMap) window.__shareMap.invalidateSize(); }, 250);
  };
})();
</script>
</body>
</html>`;
}

function cleanDomain(baseUrl) {
  return baseUrl.replace(/^https?:\/\//, '');
}

// ============================================================
//  🗺️  BLOQUE DE MAPA INTERACTIVO PARA RUTAS COMPARTIDAS
// ============================================================
function renderRouteMapBlock(route, baseUrl) {
  baseUrl = baseUrl || 'https://brigadistasbd.pages.dev';
  if (!route) return '';
  const puntos       = route.puntos || [];
  const puntosVuelta = route.puntosVuelta || [];
  const geomIda      = route.geometriaIda || [];
  const geomVuelta   = route.geometriaVuelta || [];

  if (!puntos.length && !puntosVuelta.length && !geomIda.length && !geomVuelta.length) {
    return '';
  }

  const colorIda    = route.colorIda    || '#00e5ff';
  const colorVuelta = route.colorVuelta || '#a855f7';
  const nombre      = escapeHTML(route.nombre || 'Ruta');

  const dataJSON = JSON.stringify({
    puntos, puntosVuelta, geomIda, geomVuelta, colorIda, colorVuelta, nombre
  }).replace(/<\/script/gi, '<\\/script');

  return `
    <div class="route-map-hero map-wrap" id="mapWrapHero">
      <div id="shareMapBig"></div>
      <button class="map-fs-btn" id="mapFsBtn" title="Pantalla completa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
          <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
          <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
      </button>
    </div>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin><\/script>
    <script>
    (function(){
      var DATA = ${dataJSON};
      if (typeof L === 'undefined') return;
      var map = L.map('shareMapBig', { zoomControl: true, scrollWheelZoom: false });
      window.__shareMap = map;
      // Caché de mosaicos compartida (mismo IndexedDB que la app principal)
      // 🛡️ En páginas publicadas, usar tileLayer estándar.
      // El SW cachea automáticamente y el navegador cachea HTTP.
      // NO usar L.tileLayer.offline aquí para evitar dependencias de scripts.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        crossOrigin: true,
        attribution: '© OpenStreetMap'
      }).addTo(map);

      var allCoords = [];
         function drawLine(coords, color, dashed){
        if (!coords || coords.length < 2) return;
        var line = L.polyline(coords, {
          color: color,
          weight: 5,
          opacity: 0.95,
          dashArray: dashed ? '10,6' : null,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(map);
        allCoords = allCoords.concat(coords);
        return line;
      }

      // Offset perpendicular para separar ida y vuelta en la misma calle
      function offsetPolyline(coords, offsetMeters){
        if(!coords || coords.length < 2) return coords;
        var out = [];
        var R = 6371000;
        for(var i=0;i<coords.length;i++){
          var p = coords[i];
          var prev = coords[Math.max(0,i-1)];
          var next = coords[Math.min(coords.length-1,i+1)];
          var dLat = next[0]-prev[0];
          var dLng = next[1]-prev[1];
          var len = Math.hypot(dLat,dLng) || 1;
          var perpLat = -dLng/len;
          var perpLng =  dLat/len;
          var dLatDeg = (offsetMeters / R) * (180/Math.PI);
          var dLngDeg = (offsetMeters / (R*Math.cos(p[0]*Math.PI/180))) * (180/Math.PI);
          out.push([p[0] + perpLat*dLatDeg, p[1] + perpLng*dLngDeg]);
        }
        return out;
      }

      var idaCoords = (DATA.geomIda && DATA.geomIda.length > 1) ? DATA.geomIda : DATA.puntos;
      var vueltaCoords = (DATA.geomVuelta && DATA.geomVuelta.length > 1) ? DATA.geomVuelta : DATA.puntosVuelta;

      var hasIda = idaCoords && idaCoords.length > 1;
      var hasVuelta = vueltaCoords && vueltaCoords.length > 1;

      // Dibujar IDA con offset +4m si hay vuelta
      if (hasIda) {
        var idaDraw = hasVuelta ? offsetPolyline(idaCoords, 4) : idaCoords;
        drawLine(idaDraw, DATA.colorIda, false);
        // Marcadores inicio/fin IDA
        L.circleMarker(idaDraw[0], { radius: 7, color: DATA.colorIda, fillColor: '#fff', fillOpacity: 1, weight: 3 })
          .addTo(map).bindPopup('🟢 Inicio IDA');
        L.circleMarker(idaDraw[idaDraw.length-1], { radius: 7, color: DATA.colorIda, fillColor: DATA.colorIda, fillOpacity: 1, weight: 2 })
          .addTo(map).bindPopup('🔴 Fin IDA');
      }

      // Dibujar VUELTA con offset -4m si hay ida
      if (hasVuelta) {
        var vueltaDraw = hasIda ? offsetPolyline(vueltaCoords, -4) : vueltaCoords;
        drawLine(vueltaDraw, DATA.colorVuelta, true);
        L.circleMarker(vueltaDraw[0], { radius: 7, color: DATA.colorVuelta, fillColor: '#fff', fillOpacity: 1, weight: 3 })
          .addTo(map).bindPopup('🟣 Inicio REGRESO');
        L.circleMarker(vueltaDraw[vueltaDraw.length-1], { radius: 7, color: DATA.colorVuelta, fillColor: DATA.colorVuelta, fillOpacity: 1, weight: 2 })
          .addTo(map).bindPopup('🔵 Fin REGRESO');
      }



      // Ajustar zoom
      if (allCoords.length > 1) {
        try { map.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e) {}
      } else if (allCoords.length === 1) {
        map.setView(allCoords[0], 15);
      } else {
        map.setView([16.7530, -93.1150], 13);
      }

      // 🏷️ LEYENDA IDA / REGRESO (compacta, líneas gruesas) + botón viaje
      var legend = L.control({ position: 'bottomleft' });
      legend.onAdd = function(){
        var div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML =
          '<div style="background:rgba(20,28,48,.92);padding:4px 10px;border-radius:8px;font-size:11px;color:#e8edf7;border:1px solid #26314f;line-height:1.3;display:flex;flex-direction:column;gap:2px">' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<span style="display:inline-block;width:16px;height:5px;background:' + DATA.colorIda + ';border-radius:2px"></span>' +
              '<span>Ida</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<span style="display:inline-block;width:16px;height:5px;background:' + DATA.colorVuelta + ';border-radius:2px"></span>' +
              '<span>Regreso</span>' +
            '</div>' +
          '</div>';
        return div;
      };
      legend.addTo(map);

      // 🚀 Botón centrado abajo: "Agregar puntos de viaje" → ir a trip
var tripBtn = L.control({ position: 'bottomleft' });
tripBtn.onAdd = function(){
        var div = L.DomUtil.create('div', 'map-trip-btn-wrap');
        div.innerHTML =
          '<button class="map-trip-btn" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14">' +
              '<circle cx="12" cy="12" r="10"/>' +
              '<line x1="12" y1="8" x2="12" y2="16"/>' +
              '<line x1="8" y1="12" x2="16" y2="12"/>' +
            '</svg>' +
            '<span>Agregar puntos de viaje</span>' +
            '<small>Rutas relacionadas · Mapa interactivo</small>' +
          '</button>';
        var btn = div.querySelector('.map-trip-btn');
        L.DomEvent.disableClickPropagation(div);
        btn.addEventListener('click', function(){
          window.location.href = '${baseUrl}/?tab=trip';
        });
        return div;
      };
      tripBtn.addTo(map);
    })();
    <\/script>
  `;
}

// ============================================================
//  📝 PÁRRAFO INTRODUCTORIO — texto largo para SEO
// ============================================================
function introParagraph(route, title, baseUrl) {
  if (!route) return '';
  const r = route;

  const paradas = r.paradas || [];
  const pois = r.pois || [];
  const poisVuelta = r.poisVuelta || [];
  const calles = r.calles || [];
  const retornos = r.retornos || [];
  const notas = r.notas || '';
  const tarifa = r.tarifa || '';
  const frecuencia = r.frecuencia || '';
  const horarioIni = r.horarioIni || '';
  const horarioFin = r.horarioFin || '';
  const dias = r.dias || '';
  const categoria = r.categoria || 'urbana';

  const p1 = `<p>La <strong>${escapeHTML(title)}</strong> es una ruta de colectivo de categoría <strong>${escapeHTML(categoria)}</strong> que opera en la ciudad de Tuxtla Gutiérrez, Chiapas, México. ${tarifa ? `El costo del pasaje es de <strong>${escapeHTML(tarifa)}</strong>.` : ''} ${frecuencia ? `La frecuencia de paso aproximada es <strong>${escapeHTML(frecuencia)}</strong>.` : ''} ${horarioIni ? `Presta servicio desde las <strong>${escapeHTML(horarioIni)}</strong> hasta las <strong>${escapeHTML(horarioFin || 'última hora')}</strong>.` : ''} ${dias ? `Los días de operación son <strong>${escapeHTML(dias)}</strong>.` : ''}</p>`;

  const p2 = paradas.length
    ? `<p>Esta ruta cuenta con un total de <strong>${paradas.length} paradas oficiales</strong> a lo largo de su recorrido, entre las que destacan: ${paradas.slice(0, 10).map(p => escapeHTML(p)).join(', ')}${paradas.length > 10 ? ', entre otras' : ''}. Los usuarios pueden abordar y descender en cualquiera de estos puntos para llegar a su destino de forma segura y eficiente.</p>`
    : '';

  const p3 = calles.length
    ? `<p>El recorrido de la ruta atraviesa las siguientes vialidades principales de Tuxtla Gutiérrez: ${calles.slice(0, 12).map(c => escapeHTML(c)).join(', ')}${calles.length > 12 ? ', entre otras calles y avenidas' : ''}. Este trayecto conecta zonas clave de la ciudad y facilita el transporte de miles de pasajeros diariamente.</p>`
    : '';

  const allPois = [...pois, ...poisVuelta];
  const p4 = allPois.length
    ? `<p>A lo largo de su trayecto, esta ruta pasa cerca de importantes puntos de interés (POIs) como: ${allPois.slice(0, 10).map(p => escapeHTML(p)).join(', ')}${allPois.length > 10 ? ', entre otros lugares de interés' : ''}. Estos puntos de referencia son de gran utilidad para los usuarios que necesitan ubicarse dentro de la ciudad o identificar su parada más cercana.</p>`
    : '';

  const p5 = retornos.length
    ? `<p>Los principales retornos y puntos de regreso de esta ruta incluyen: ${retornos.slice(0, 8).map(r2 => escapeHTML(r2)).join(', ')}${retornos.length > 8 ? ', entre otros' : ''}. Esto permite a los conductores y usuarios conocer el sentido completo del recorrido de ida y vuelta.</p>`
    : '';

  const p6 = notas
    ? `<p><strong>Notas adicionales:</strong> ${escapeHTML(notas)}</p>`
    : '';

  const p7 = `<p>Si necesitas planificar tu viaje en transporte público dentro de Tuxtla Gutiérrez, esta ruta de colectivo es una excelente opción. Puedes consultar más detalles, ver el mapa interactivo del trazado completo, las paradas oficiales y los puntos de interés cercanos directamente en esta página. Además, puedes compartir esta información con otros usuarios para que también puedan aprovecharla.</p>`;

  const p8 = `<p>La información aquí presentada se actualiza periódicamente para asegurar que los usuarios cuenten con los datos más precisos sobre tarifas, horarios, recorridos y paradas. Si detectas alguna inconsistencia o deseas sugerir una mejora, puedes contactarnos a través del sitio principal <a href="${baseUrl}/">${baseUrl.replace(/^https?:\/\//, '')}</a>.</p>`;

  return `<div class="intro-paragraphs">${p1}${p2}${p3}${p4}${p5}${p6}${p7}${p8}</div>`;
}

function renderRouteBody(route, baseUrl) {
  baseUrl = baseUrl || 'https://brigadistasbd.pages.dev';
  const blocks = [];

  // 📝 NOTAS primero (arriba de todo)
  if (route.notas && String(route.notas).trim()) {
    blocks.push(`<div class="block"><h3>📝 Notas adicionales</h3><div style="font-size:14px;line-height:1.6;color:var(--text-2);white-space:pre-wrap">${escapeHTML(route.notas)}</div></div>`);
  }

  // 🗺️ PÁRRAFO RESUMEN DE LA RUTA
  const resumen = [];
  if (route.paradas?.length) resumen.push(`${route.paradas.length} paradas oficiales`);
  if (route.calles?.length) resumen.push(`${route.calles.length} calles y avenidas`);
  if (route.pois?.length) resumen.push(`${route.pois.length} POIs de ida`);
  if (route.poisVuelta?.length) resumen.push(`${route.poisVuelta.length} POIs de regreso`);
  if (route.retornos?.length) resumen.push(`${route.retornos.length} retornos`);

  if (resumen.length) {
    blocks.push(`<div class="block"><h3>📊 Resumen del recorrido</h3><p style="font-size:14.5px;line-height:1.75;color:var(--text-2);margin:0">Esta ruta de colectivo cuenta con un total de <strong>${resumen.join(', ')}</strong> a lo largo de su recorrido completo. A continuación se detalla cada uno de estos elementos para que los usuarios puedan planificar su viaje con información precisa y actualizada.</p></div>`);
  }
   
  // ℹ️ Información
  const info = [];
  if (route.tarifa) info.push(`<li>💰 Tarifa: ${escapeHTML(route.tarifa)}</li>`);
  if (route.frecuencia) info.push(`<li>⏱️ Frecuencia: ${escapeHTML(route.frecuencia)}</li>`);
  if (route.horarioIni) info.push(`<li>🕐 Horario: ${escapeHTML(route.horarioIni)} - ${escapeHTML(route.horarioFin || '')}</li>`);
  if (route.dias) info.push(`<li>📅 Días: ${escapeHTML(route.dias)}</li>`);
  if (info.length) blocks.push(`<div class="block"><h3>ℹ️ Información</h3><ul>${info.join('')}</ul></div>`);

  // 📍 Paradas
  if (route.paradas?.length) blocks.push(`<div class="block"><h3>📍 Paradas</h3><ul>${route.paradas.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);

  // ↩️ Retornos
  if (route.retornos?.length) blocks.push(`<div class="block"><h3>↩️ Retornos</h3><ul>${route.retornos.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);

  // 🏥 POIs de Ida
  if (route.pois?.length) blocks.push(`<div class="block"><h3>🏥 POIs de Ida</h3><ul>${route.pois.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);

  // 🏥 POIs de Regreso
  if (route.poisVuelta?.length) blocks.push(`<div class="block"><h3>🏥 POIs de Regreso</h3><ul>${route.poisVuelta.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);

  // 🛣️ Calles
  if (route.calles?.length) blocks.push(`<div class="block"><h3>🛣️ Calles</h3><ul>${route.calles.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);

  return blocks.join('');
}

function renderMarketBody(market) {
  return `
    ${market.price ? `<div class="price">${escapeHTML(market.price)}</div>` : ''}
    <div class="post-content">${escapeHTML(market.description || '').replace(/\n/g, '<br>')}</div>
    ${market.phone ? `<div class="block"><h3>📞 Contacto</h3><a class="btn btn-primary" href="https://wa.me/${market.phone.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, me interesa: ' + market.title)}" target="_blank" rel="noopener">💬 WhatsApp</a></div>` : ''}
  `;
}


async function regenerateSitemap(env, ghHeaders, baseUrl, index) {
  const { REPO_OWNER, REPO_NAME } = env;
  const apiBase = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

  const today = new Date().toISOString().split('T')[0];

  const safeLastmod = (val) => {
    if (!val) return today;
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return today;
  };

  const escapeXml = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const buildFullUrl = (relativeUrl) => {
    let cleanUrl = String(relativeUrl || '').trim();
    cleanUrl = cleanUrl.replace(/\.html$/i, '');
    cleanUrl = cleanUrl.split('?')[0];
    cleanUrl = cleanUrl.split('#')[0];
    if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;
    if (cleanUrl.length > 1 && cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    const parts = cleanUrl.split('/').map(part => {
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch (e) {
        return encodeURIComponent(part);
      }
    });
    return baseUrl + parts.join('/');
  };

  const urls = [
    { loc: baseUrl + '/', priority: '1.0', changefreq: 'daily', lastmod: today }
  ];

  (index.posts || []).forEach(p => {
    if (!p.url) return;

    const fullUrl = buildFullUrl(p.url);

    try {
      new URL(fullUrl);
    } catch (e) {
      console.warn('[sitemap] URL inválida, se omite:', fullUrl);
      return;
    }

    urls.push({
      loc: fullUrl,
      priority: '0.8',
      changefreq: 'weekly',
      lastmod: safeLastmod(p.updatedAt || p.timestamp),
      image: p.image && String(p.image).startsWith('http') ? escapeXml(p.image) : null
    });
  });

  const xmlEntries = urls.map(u => {
    const lines = [
      '  <url>',
      `    <loc>${escapeXml(u.loc)}</loc>`,
      `    <lastmod>${u.lastmod}</lastmod>`,
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`
    ];
    if (u.image) {
      lines.push(`    <image:image>`);
      lines.push(`      <image:loc>${u.image}</image:loc>`);
      lines.push(`    </image:image>`);
    }
    lines.push('  </url>');
    return lines.join('\n');
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${xmlEntries}
</urlset>`;

  if (!xml.startsWith('<?xml') || !xml.trim().endsWith('</urlset>')) {
    console.error('[sitemap] XML mal formado, se aborta');
    return;
  }

  let sha = null;
  try {
    const res = await fetch(`${apiBase}/sitemap.xml?ref=main`, { headers: ghHeaders });
    if (res.ok) { const j = await res.json(); sha = j.sha; }
  } catch (e) {}

  const body = {
    message: 'actualizar sitemap.xml',
    content: b64EncodeUnicode(xml),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  try {
    const putRes = await fetch(`${apiBase}/sitemap.xml`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body)
    });
    if (!putRes.ok) {
      console.error('[sitemap] Error al subir:', await putRes.text());
    }
  } catch (e) {
    console.error('[sitemap] Error al subir:', e);
  }
}
