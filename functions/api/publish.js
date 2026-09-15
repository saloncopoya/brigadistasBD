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

      const {
        GITHUB_TOKEN: T, REPO_OWNER: O, REPO_NAME: N, SITE_DOMAIN: D
      } = env;

      if (!T || !O || !N) {
        return new Response(JSON.stringify({ error: 'Configuración de GitHub incompleta' }), { status: 500, headers });
      }

      const domain = (D || 'brigadistasbd.pages.dev').replace(/^https?:\/\//, '').replace(/\/$/, '');
      const baseUrl = `https://${domain}`;

      // Carpeta según tipo
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

      // 1️⃣ Obtener SHA del HTML y borrarlo
      let deletedHtml = false;
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
      } catch (e) {}

      // 2️⃣ Quitar del índice posts-index.json
      const indexPath = 'share/posts-index.json';
      try {
        const idxRes = await fetch(`${apiBase}/${indexPath}?ref=main`, { headers: ghHeaders });
        if (idxRes.ok) {
          const idxJson = await idxRes.json();
          const decoded = decodeURIComponent(escape(atob(idxJson.content.replace(/\n/g, ''))));
          const index = JSON.parse(decoded);
          index.posts = (index.posts || []).filter(p => p.slug !== safeSlug);
          index.total = index.posts.length;
          index.updatedAt = new Date().toISOString();

          await fetch(`${apiBase}/${indexPath}`, {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: `actualizar índice (eliminar ${safeSlug})`,
              content: b64EncodeUnicode(JSON.stringify(index, null, 2)),
              sha: idxJson.sha,
              branch: 'main'
            })
          });
        }
      } catch (e) {}

      // 3️⃣ Regenerar sitemap sin la entrada borrada
      try {
        // Leer el índice actualizado
        const idxRes2 = await fetch(`${apiBase}/${indexPath}?ref=main`, { headers: ghHeaders });
        if (idxRes2.ok) {
          const idxJson2 = await idxRes2.json();
          const decoded2 = decodeURIComponent(escape(atob(idxJson2.content.replace(/\n/g, ''))));
          const index2 = JSON.parse(decoded2);
          await regenerateSitemap(env, ghHeaders, baseUrl, index2);
        }
      } catch (e) {}

      return new Response(JSON.stringify({
        ok: true,
        deleted: true,
        slug: safeSlug,
        htmlDeleted: deletedHtml
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
  const safeTitle = escapeHTML(title);
 // Construir descripción enriquecida según el tipo
let enrichedContent = content || '';
if (tipo === 'ruta' && extra?.route) {
  const r = extra.route;
  const parts = [];

   if (r.notas) {
    parts.push(` ${r.notas.slice(0, 80)}`);
  }
   
  if (r.paradas?.length) {
    parts.push(`📍 ${r.paradas.slice(0, 5).join(', ')}${r.paradas.length > 5 ? '...' : ''}`);
  }
  if (r.pois?.length) {
    parts.push(` ${r.pois.slice(0, 5).join(', ')}${r.pois.length > 5 ? '...' : ''}`);
  }
  if (r.calles?.length) {
    parts.push(` ${r.calles.slice(0, 4).join(', ')}${r.calles.length > 4 ? '...' : ''}`);
  }
  if (r.tarifa) {
    parts.push(`💰 ${r.tarifa}`);
  }
  if (r.frecuencia) {
    parts.push(`⏱️ ${r.frecuencia}`);
  }
  
  if (parts.length) {
    enrichedContent = parts.join(' · ');
  }
}

const safeDesc = escapeHTML(enrichedContent.slice(0, 160));
  const safeImage = image ? escapeHTML(image) : `${baseUrl}/img.png`;

  const typeLabel = tipo === 'ruta' ? 'Ruta' : tipo === 'market' ? 'Anuncio' : 'Publicación';

  // Schema.org
  let schema;
  if (tipo === 'ruta') {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BusTrip',
      name: title,
     description: enrichedContent.slice(0, 160),
      url: pageUrl,
      image: safeImage,
      provider: { '@type': 'Organization', name: 'Rutas BGD', url: baseUrl },
       departureTime: route.horarioIni,
  arrivalTime: route.horarioFin,
  offers: { '@type': 'Offer', price: route.tarifa, priceCurrency: 'MXN' },
  itinerary: route.paradas?.map(p => ({ '@type': 'Place', name: p }))
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
    bodyContent = renderRouteMapBlock(extra.route) + renderRouteBody(extra.route);
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
<title>${safeTitle} · Rutas BGD</title>
<meta name="description" content="${safeDesc}">
<link rel="canonical" href="${pageUrl}">
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="preconnect" href="https://unpkg.com">
<link rel="preconnect" href="https://tile.openstreetmap.org">

<!-- Open Graph -->
<meta property="og:type" content="${tipo === 'post' ? 'article' : 'website'}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="Rutas BGD">
<meta property="og:locale" content="es_MX">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
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

/* LEYENDA MAPA */
.map-legend{background:color-mix(in srgb,var(--surface) 92%,transparent)!important;padding:8px 12px;border-radius:10px;font-size:12px;color:var(--text);border:1px solid var(--border);line-height:1.6;backdrop-filter:blur(8px)}
.map-legend .lg-line{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:6px;border-radius:2px}

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
    <span class="brand-txt">VER TODAS LAS RUTAS</span>
    </a>
  <div class="header-actions">
    <a class="icon-btn" href="${baseUrl}/" title="Ir al inicio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </a>
  </div>
</header>

<div class="wrap">
  <span class="badge badge-${tipo === 'ruta' ? (extra?.route?.categoria === 'foranea' ? 'foranea' : 'urbana') : tipo === 'market' ? 'green' : 'urbana'}">${typeLabel}</span>
  <h1>${safeTitle}</h1>
  <div class="meta">${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

  <!-- 🔒 IMAGEN SEO: oculta visualmente pero indexable por Google -->
  ${image ? `<img class="seo-hero" src="${safeImage}" alt="${safeTitle}" width="1200" height="630" loading="eager">` : ''}

  ${bodyContent}

  <div class="cta">
    <a class="btn btn-primary" href="${baseUrl}/">🚌 Ver todas las rutas</a>
    <a class="btn btn-ghost" href="${baseUrl}/?tab=market">🛒 Marketplace</a>
  </div>
  <footer>© ${new Date().getFullYear()} Rutas BGD · <a href="${baseUrl}">${cleanDomain(baseUrl)}</a></footer>
</div>

<!-- NAV INFERIOR -->
<nav class="bottom-nav">
  <a class="nav-item" href="${baseUrl}/?tab=home">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <span>Inicio</span>
  </a>
  <a class="nav-item ${tipo === 'ruta' ? 'active' : ''}" href="${baseUrl}/?tab=routes">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V9a4 4 0 0 1 4-4h4"/><path d="M18 8v7a4 4 0 0 1-4 4H9"/></svg>
    <span>Rutas</span>
  </a>
  <a class="nav-item ${tipo === 'market' ? 'active' : ''}" href="${baseUrl}/?tab=market">
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
function renderRouteMapBlock(route) {
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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
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

      // POIs
      if (DATA.puntos && DATA.puntos.length) {
        DATA.puntos.forEach(function(p){
          L.circleMarker(p, { radius: 5, color: DATA.colorIda, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);
        });
      }
      if (DATA.puntosVuelta && DATA.puntosVuelta.length) {
        DATA.puntosVuelta.forEach(function(p){
          L.circleMarker(p, { radius: 5, color: DATA.colorVuelta, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);
        });
      }

      // Ajustar zoom
      if (allCoords.length > 1) {
        try { map.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e) {}
      } else if (allCoords.length === 1) {
        map.setView(allCoords[0], 15);
      } else {
        map.setView([16.7530, -93.1150], 13);
      }

      // 🏷️ LEYENDA IDA / REGRESO
      var legend = L.control({ position: 'bottomleft' });
      legend.onAdd = function(){
        var div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = '<div><span class="lg-line" style="background:' + DATA.colorIda + '"></span> IDA</div>' +
                        '<div><span class="lg-line" style="background:' + DATA.colorVuelta + '"></span> REGRESO</div>';
        return div;
      };
      legend.addTo(map);
    })();
    <\/script>
  `;
}

function renderRouteBody(route) {
  const blocks = [];

  // 📝 NOTAS primero (arriba de todo)
  if (route.notas && String(route.notas).trim()) {
    blocks.push(`<div class="block"><h3>📝 Notas adicionales</h3><div style="font-size:14px;line-height:1.6;color:var(--text-2);white-space:pre-wrap">${escapeHTML(route.notas)}</div></div>`);
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

// ==========================================================================
//  Regenerar sitemap.xml
// ==========================================================================
async function regenerateSitemap(env, ghHeaders, baseUrl, index) {
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = env;
  const apiBase = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: baseUrl + '/', priority: '1.0', changefreq: 'daily' },
    { loc: baseUrl + '/?tab=routes', priority: '0.95', changefreq: 'daily' },
    { loc: baseUrl + '/?tab=home', priority: '0.9', changefreq: 'daily' },
    { loc: baseUrl + '/?tab=market', priority: '0.9', changefreq: 'daily' }
  ];

  (index.posts || []).forEach(p => {
    let cleanUrl = String(p.url || '');
    if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;
    urls.push({
      loc: `${baseUrl}${cleanUrl}`,
      priority: '0.8',
      changefreq: 'weekly',
      image: p.image || null,
      lastmod: p.updatedAt || today
    });
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${u.image ? `
    <image:image><image:loc>${u.image}</image:loc></image:image>` : ''}
  </url>`).join('\n')}
</urlset>`;

  // Obtener SHA si existe
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

  await fetch(`${apiBase}/sitemap.xml`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify(body)
  }).catch(() => {});
}
