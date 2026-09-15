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
      updatedAt: new Date().toISOString()
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
    if (r.paradas?.length) {
      parts.push(`📍 Paradas: ${r.paradas.slice(0, 5).join(', ')}${r.paradas.length > 5 ? '...' : ''}`);
    }
    if (r.pois?.length) {
      parts.push(`🏥 POIs: ${r.pois.slice(0, 5).join(', ')}${r.pois.length > 5 ? '...' : ''}`);
    }
    if (r.calles?.length) {
      parts.push(`🛣️ Calles: ${r.calles.slice(0, 4).join(', ')}${r.calles.length > 4 ? '...' : ''}`);
    }
    if (r.tarifa) parts.push(`💰 Tarifa: ${r.tarifa}`);
    if (r.frecuencia) parts.push(`⏱️ ${r.frecuencia}`);
    if (r.horarioIni) parts.push(`🕐 Horario: ${r.horarioIni} - ${r.horarioFin || ''}`);
    if (r.dias) parts.push(`📅 Días: ${r.dias}`);
    if (parts.length) enrichedContent = parts.join(' · ');
  }

  const safeDesc = escapeHTML(enrichedContent.slice(0, 160));
  const safeImage = image ? escapeHTML(image) : `${baseUrl}/img.png`;
  const typeLabel = tipo === 'ruta' ? 'Ruta' : tipo === 'market' ? 'Anuncio' : 'Publicación';
  const cleanDomainName = baseUrl.replace(/^https?:\/\//, '');
  const fechaISO = new Date().toISOString();
  const fechaLegible = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  // ============================================================
  //  SCHEMA.ORG COMPLETO PARA SEO
  // ============================================================
  let schema;
  if (tipo === 'ruta') {
    const r = extra?.route || {};
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BusTrip',
      name: title,
      description: enrichedContent.slice(0, 300),
      url: pageUrl,
      image: [safeImage],
      provider: {
        '@type': 'Organization',
        name: 'Rutas BGD',
        url: baseUrl,
        logo: { '@type': 'ImageObject', url: `${baseUrl}/assets/icon.svg` }
      },
      departureBusStop: r.paradas?.[0] ? {
        '@type': 'BusStop',
        name: r.paradas[0]
      } : undefined,
      arrivalBusStop: r.paradas?.[r.paradas.length - 1] ? {
        '@type': 'BusStop',
        name: r.paradas[r.paradas.length - 1]
      } : undefined,
      itinerary: {
        '@type': 'ItemList',
        numberOfItems: r.paradas?.length || 0,
        itemListElement: (r.paradas || []).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: { '@type': 'Place', name: p }
        }))
      },
      offers: r.tarifa ? {
        '@type': 'Offer',
        price: r.tarifa.replace(/[^0-9.]/g, '') || '0',
        priceCurrency: 'MXN',
        availability: 'https://schema.org/InStock'
      } : undefined,
      additionalProperty: [
        r.categoria && { '@type': 'PropertyValue', name: 'Categoría', value: r.categoria },
        r.frecuencia && { '@type': 'PropertyValue', name: 'Frecuencia', value: r.frecuencia },
        r.horarioIni && { '@type': 'PropertyValue', name: 'Horario', value: `${r.horarioIni} - ${r.horarioFin}` },
        r.dias && { '@type': 'PropertyValue', name: 'Días', value: r.dias },
        r.accesibilidad && { '@type': 'PropertyValue', name: 'Accesibilidad', value: r.accesibilidad },
        r.notas && { '@type': 'PropertyValue', name: 'Notas', value: r.notas }
      ].filter(Boolean)
    };
  } else if (tipo === 'market') {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: title,
      description: safeDesc,
      image: [safeImage],
      url: pageUrl,
      offers: {
        '@type': 'Offer',
        price: extra?.market?.price?.replace(/[^0-9.]/g, '') || '0',
        priceCurrency: 'MXN',
        availability: 'https://schema.org/InStock',
        seller: {
          '@type': 'Person',
          name: 'Vendedor',
          telephone: extra?.market?.phone || ''
        }
      }
    };
  } else {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      description: safeDesc,
      image: [safeImage],
      url: pageUrl,
      datePublished: fechaISO,
      dateModified: fechaISO,
      author: { '@type': 'Organization', name: 'Rutas BGD' },
      publisher: {
        '@type': 'Organization',
        name: 'Rutas BGD',
        logo: { '@type': 'ImageObject', url: `${baseUrl}/assets/icon.svg` }
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl }
    };
  }

  // ============================================================
  //  DATOS INYECTADOS PARA LA APP
  // ============================================================
  let injectedData;
  if (tipo === 'ruta') {
    injectedData = { __ROUTE_DATA__: JSON.stringify(extra?.route || {}) };
  } else if (tipo === 'post') {
    injectedData = {
      __POST_DATA__: JSON.stringify({
        id: slug, slug: slug, title: title, content: content,
        media: image, tipo: 'post', timestamp: Date.now(),
        updatedAt: Date.now(), url: pageUrl,
        likes: 0, likedBy: [], comments: []
      })
    };
  } else {
    injectedData = {
      __MARKET_DATA__: JSON.stringify({
        id: slug, slug: slug, title: title, description: content,
        image: image, tipo: 'market', timestamp: Date.now(),
        updatedAt: Date.now(), url: pageUrl,
        ...(extra?.market || {})
      })
    };
  }

  const injectedScript = Object.entries(injectedData)
    .map(([k, v]) => `window.${k} = ${v};`)
    .join('\n');

  // ============================================================
  //  🔥 DETERMINAR QUÉ PÁGINA DEBE ESTAR ACTIVA EN EL HTML ESTÁTICO
  //  Esto evita el parpadeo (FOUC) y ayuda al SEO sin JS
  // ============================================================
  const activePage = tipo === 'post'
    ? 'page-post'
    : tipo === 'market'
      ? 'page-market'
      : 'page-route';

  // ============================================================
  //  HTML COMPLETO CON LA MISMA INTERFAZ QUE index.html
  // ============================================================
  return `<!DOCTYPE html>
<html lang="es" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
<meta name="theme-color" content="#0a0e1a">
<title>${safeTitle} · Rutas BGD</title>
<meta name="description" content="${safeDesc}">
<meta name="keywords" content="${safeTitle}, ruta colectivo, Tuxtla Gutiérrez, Chiapas, transporte público, ${extra?.route?.categoria || ''}, ${(extra?.route?.paradas || []).slice(0, 5).join(', ')}">
<meta name="author" content="Rutas BGD">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${pageUrl}">

<!-- Open Graph -->
<meta property="og:type" content="${tipo === 'post' ? 'article' : 'website'}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:secure_url" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:alt" content="${safeTitle}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="Rutas BGD">
<meta property="og:locale" content="es_MX">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${safeImage}">
<meta name="twitter:image:alt" content="${safeTitle}">
<meta name="twitter:site" content="@RutasBGD">

<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="apple-touch-icon" href="/assets/icon.svg">
<link rel="preconnect" href="https://unpkg.com">
<link rel="preconnect" href="https://tile.openstreetmap.org">
<link rel="preconnect" href="https://res.cloudinary.com">

<!-- Schema.org -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>

<!-- 🔥 DATOS INYECTADOS PARA LA APP 🔥 -->
<script>
${injectedScript}
</script>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">

<style>
/* ============================================================
   ESTILOS COMPLETOS (idénticos a index.html)
   ============================================================ */
:root{
  --cyan:#00e5ff;--cyan-d:#00b8cc;--cyan-glow:rgba(0,229,255,.35);
  --purple:#a855f7;--green:#10b981;--amber:#f59e0b;--red:#ef4444;--pink:#ec4899;
  --radius:14px;--radius-sm:10px;--radius-lg:22px;
  --shadow:0 10px 30px rgba(0,0,0,.35);--shadow-sm:0 4px 12px rgba(0,0,0,.25);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --nav-h:64px;--header-h:58px;--transition:.25s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"]{--bg:#0a0e1a;--bg-2:#0f1526;--bg-3:#161e33;--surface:#141c30;--surface-2:#1c2540;--surface-3:#242f4d;--border:#26314f;--border-2:#334066;--text:#e8edf7;--text-2:#a9b4cc;--text-3:#6b7793;--input-bg:#0f1626;--overlay:rgba(5,8,16,.85)}
[data-theme="light"]{--bg:#f4f6fb;--bg-2:#fff;--bg-3:#eef1f8;--surface:#fff;--surface-2:#f4f6fb;--surface-3:#e8ecf5;--border:#dde3ee;--border-2:#c5cfe2;--text:#0c1322;--text-2:#4a5773;--text-3:#8a95ad;--input-bg:#f8fafd;--overlay:rgba(15,20,35,.55)}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{font-family:var(--font);background:var(--bg);color:var(--text);overflow-x:hidden;overscroll-behavior-y:none;transition:background var(--transition),color var(--transition);-webkit-font-smoothing:antialiased}
button,input,textarea,select{font-family:inherit;font-size:inherit;color:inherit}
button{cursor:pointer;border:none;background:none}
a{color:var(--cyan);text-decoration:none}
img{max-width:100%;display:block}
.hidden{display:none!important}
::selection{background:var(--cyan);color:#00121a}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:var(--cyan-d)}

/* Header */
.header{position:fixed;top:0;left:0;right:0;height:var(--header-h);background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:1000}
.header-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.3px}
.header-brand .logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));display:grid;place-items:center;color:#00121a;font-size:17px;box-shadow:0 0 18px var(--cyan-glow)}
.header-brand .logo svg{width:20px;height:20px}
.header-brand .brand-txt{background:linear-gradient(90deg,var(--cyan),#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.header-actions{display:flex;align-items:center;gap:6px}
.icon-btn{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:var(--text-2);transition:var(--transition);position:relative}
.icon-btn:hover{background:var(--surface-2);color:var(--cyan)}
.icon-btn:active{transform:scale(.92)}
.icon-btn svg{width:20px;height:20px}

/* Layout */
.app{padding-top:var(--header-h);padding-bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));min-height:100vh}
.page{display:none;animation:fadeIn .3s ease}
.page.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.container{max-width:1100px;margin:0 auto;padding:14px}

/* Nav inferior */
.bottom-nav{position:fixed;bottom:0;left:0;right:0;height:calc(var(--nav-h) + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:color-mix(in srgb,var(--surface) 96%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);z-index:1000}
.nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--text-3);font-size:11px;font-weight:600;transition:var(--transition);position:relative}
.nav-item svg{width:23px;height:23px;transition:var(--transition)}
.nav-item.active{color:var(--cyan)}
.nav-item.active svg{transform:translateY(-2px) scale(1.08)}
.nav-item:active{transform:scale(.94)}

/* Cards y UI */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;transition:var(--transition)}
.card:hover{border-color:var(--border-2)}
.section-title{font-size:15px;font-weight:800;letter-spacing:.3px;margin:18px 0 10px;display:flex;align-items:center;gap:8px;color:var(--text)}
.section-title svg{width:18px;height:18px;color:var(--cyan)}
.muted{color:var(--text-2);font-size:13px}
.tiny{color:var(--text-3);font-size:11.5px}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
.badge-urbana{background:color-mix(in srgb,var(--cyan) 16%,transparent);color:var(--cyan);border:1px solid color-mix(in srgb,var(--cyan) 30%,transparent)}
.badge-foranea{background:color-mix(in srgb,var(--purple) 18%,transparent);color:var(--purple);border:1px solid color-mix(in srgb,var(--purple) 32%,transparent)}
.badge-green{background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green);border:1px solid color-mix(in srgb,var(--green) 30%,transparent)}
.badge-amber{background:color-mix(in srgb,var(--amber) 18%,transparent);color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 32%,transparent)}

/* Botones */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:var(--radius-sm);font-weight:700;font-size:13.5px;transition:var(--transition);border:1px solid transparent}
.btn svg{width:17px;height:17px}
.btn:active{transform:scale(.96)}
.btn-primary{background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;box-shadow:0 6px 18px -6px var(--cyan-glow)}
.btn-primary:hover{filter:brightness(1.08)}
.btn-ghost{background:var(--surface-2);color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--surface-3);border-color:var(--border-2)}
.btn-sm{padding:8px 12px;font-size:12.5px}

/* Chips */
.chip{flex-shrink:0;padding:8px 14px;border-radius:99px;font-size:12.5px;font-weight:700;background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);transition:var(--transition);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.chip.mini{padding:4px 10px;font-size:11px;font-weight:600}

/* Route hero */
.route-hero{padding:14px;display:flex;flex-direction:column;gap:10px}
.route-hero h1{font-size:24px;font-weight:900;letter-spacing:-.4px;text-transform:uppercase;line-height:1.15}
.route-hero .hero-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.route-hero .share-row{display:flex;gap:8px;margin-top:4px}

/* Mapa */
.map-wrap{position:relative;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);background:var(--surface-2)}
#map{width:100%;height:42vh;min-height:260px;z-index:1}
.map-fs-btn{position:absolute;bottom:12px;right:12px;z-index:600;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid var(--border-2);border-radius:12px;width:42px;height:42px;display:grid;place-items:center;color:var(--text);box-shadow:var(--shadow);backdrop-filter:blur(10px);transition:var(--transition);cursor:pointer}
.map-fs-btn:hover{background:var(--surface-3);border-color:var(--cyan);color:var(--cyan)}
.map-fs-btn svg{width:20px;height:20px}
.map-wrap.is-fullscreen{position:fixed !important;inset:0 !important;z-index:9500 !important;margin:0 !important;border-radius:0 !important;border:none !important}
.map-wrap.is-fullscreen #map{height:100vh !important;width:100vw !important}
body.fs-active{overflow:hidden !important}
.leaflet-container{background:var(--bg-2)!important;font-family:var(--font)!important}
.leaflet-control-zoom a{background:var(--surface)!important;color:var(--text)!important;border-color:var(--border)!important}
.leaflet-control-attribution{background:color-mix(in srgb,var(--surface) 88%,transparent)!important;color:var(--text-2)!important;font-size:10px!important}
.leaflet-control-attribution a{color:var(--cyan)!important}
.leaflet-popup-content-wrapper{background:var(--surface-3)!important;color:var(--text)!important;border-radius:12px!important;border:1px solid var(--border-2)!important}
.leaflet-popup-tip{background:var(--surface-3)!important}
.leaflet-interactive:focus,.leaflet-interactive:focus-visible,.leaflet-interactive:active{outline:none !important;box-shadow:none !important;-webkit-tap-highlight-color:transparent !important}

/* Route panel */
.route-panel{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.route-block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.route-block-head{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
.route-block-head .rbh-l{display:flex;align-items:center;gap:9px;font-weight:800;font-size:13.5px}
.route-block-head .rbh-l svg{width:17px;height:17px;color:var(--cyan)}
.route-block-head .count{font-size:11.5px;color:var(--text-3);background:var(--surface-2);padding:3px 9px;border-radius:99px;font-weight:700}
.route-block-body{padding:0 14px 14px;display:none}
.route-block.open .route-block-body{display:block;animation:fadeIn .25s ease}
.route-block-head .chev{transition:transform .25s ease}
.route-block.open .route-block-head .chev{transform:rotate(180deg)}
.poi-list{display:flex;flex-direction:column;gap:6px}
.poi-item{padding:9px 12px;background:var(--surface-2);border-radius:9px;font-size:13px;display:flex;align-items:center;gap:9px;cursor:pointer;transition:var(--transition)}
.poi-item:hover{background:var(--surface-3);color:var(--cyan)}
.poi-item svg{width:14px;height:14px;color:var(--cyan);flex-shrink:0}
.street-seq{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.street-step{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;background:var(--surface-2);border-radius:99px;font-size:12.5px;font-weight:600}
.street-step .arrow{color:var(--cyan);font-weight:800}

/* Imagen de portada oculta visualmente pero presente para SEO */
.seo-cover-image{
  position:absolute !important;
  width:1px !important;
  height:1px !important;
  opacity:0.01 !important;
  pointer-events:none !important;
  z-index:-1 !important;
  overflow:hidden !important;
  clip:rect(0,0,0,0) !important;
}

/* SEO: contenido semántico oculto visualmente pero accesible */
.seo-content{
  position:absolute;
  width:1px;height:1px;
  padding:0;margin:-1px;
  overflow:hidden;
  clip:rect(0,0,0,0);
  white-space:nowrap;
  border:0;
}

/* Toast */
.toast-wrap{position:fixed;top:calc(var(--header-h) + 10px);left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:calc(100% - 24px);max-width:400px}
.toast{background:var(--surface-3);color:var(--text);padding:12px 16px;border-radius:var(--radius-sm);border:1px solid var(--border-2);box-shadow:var(--shadow);font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:10px;pointer-events:auto;animation:toastIn .3s ease}
@keyframes toastIn{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}

.empty{text-align:center;padding:40px 20px;color:var(--text-3)}
.empty svg{width:56px;height:56px;margin-bottom:12px;opacity:.4}
.empty h3{font-size:15px;margin-bottom:6px;color:var(--text-2)}
.empty p{font-size:13px;max-width:300px;margin:0 auto}

@media(min-width:720px){
  .form-grid{grid-template-columns:1fr 1fr;gap:0 14px}
  .feed{max-width:680px}
}
@media(min-width:1000px){
  .app{max-width:1200px;margin:0 auto}
  .bottom-nav{max-width:560px;left:50%;transform:translateX(-50%);border-radius:18px 18px 0 0;border-left:1px solid var(--border);border-right:1px solid var(--border)}
  #map{height:70vh}
}
</style>
</head>
<body>

<!-- 🔥 IMAGEN DE PORTADA OCULTA PARA SEO (presente en el DOM pero no visible) 🔥 -->
<img class="seo-cover-image" src="${safeImage}" alt="${safeTitle} - Imagen de portada" width="1200" height="630" loading="eager">

<!-- 🔥 CONTENIDO SEMÁNTICO OCULTO PARA SEO (accesible para crawlers) 🔥 -->
<div class="seo-content" itemscope itemtype="https://schema.org/BusTrip">
  <h1 itemprop="name">${safeTitle}</h1>
  <div itemprop="description">${enrichedContent}</div>
  <div itemprop="provider" itemscope itemtype="https://schema.org/Organization">
    <span itemprop="name">Rutas BGD</span>
    <link itemprop="url" href="${baseUrl}">
  </div>
  ${extra?.route?.paradas?.length ? `
  <div itemprop="itinerary" itemscope itemtype="https://schema.org/ItemList">
    <meta itemprop="numberOfItems" content="${extra.route.paradas.length}">
    ${extra.route.paradas.map((p, i) => `
      <div itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <meta itemprop="position" content="${i + 1}">
        <span itemprop="name">${escapeHTML(p)}</span>
      </div>`).join('')}
  </div>` : ''}
  ${extra?.route?.tarifa ? `
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
    <meta itemprop="price" content="${extra.route.tarifa.replace(/[^0-9.]/g, '')}">
    <meta itemprop="priceCurrency" content="MXN">
  </div>` : ''}
</div>

<!-- ============================ HEADER ============================ -->
<header class="header">
  <div class="header-brand">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
    <span class="brand-txt">Rutas BGD</span>
  </div>
  <div class="header-actions">
    <button class="icon-btn" id="themeBtn" title="Cambiar tema">
      <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
    <a class="icon-btn" href="${baseUrl}/" title="Ir al inicio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </a>
  </div>
</header>

<!-- ============================ APP ============================ -->
<main class="app" id="app">
  <section class="page ${activePage === 'page-route' ? 'active' : ''}" id="page-route">
    <div class="route-hero" id="routeHero"></div>
    <div class="map-wrap" id="routeMapWrap" style="margin:0 14px">
      <div id="map"></div>
      <button class="map-fs-btn" id="routeMapFsBtn" title="Pantalla completa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
          <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
          <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
      </button>
    </div>
    <div class="container">
      <div class="route-panel" id="routePanel"></div>
    </div>
  </section>

  <!-- Página post -->
  <section class="page ${activePage === 'page-post' ? 'active' : ''}" id="page-post">    <div class="container">
      <button class="btn btn-ghost btn-sm" id="postBack" style="margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Volver
      </button>
      <div class="feed" id="postSingle" style="padding:0"></div>
    </div>
  </section>

  <!-- Página market -->
  <section class="page ${activePage === 'page-market' ? 'active' : ''}" id="page-market">
    <div class="container">
      <div class="section-title">Marketplace</div>
      <div class="market-grid" id="marketGrid"></div>
    </div>
  </section>

  <!-- Página home (oculta por defecto) -->
  <section class="page" id="page-home">
    <div class="container">
      <div class="section-title">Publicaciones recientes</div>
      <div class="feed" id="feed"></div>
    </div>
  </section>

  <!-- Página routes (oculta por defecto) -->
  <section class="page" id="page-routes">
    <div class="container">
      <div class="section-title">Rutas</div>
      <div id="routeContent"></div>
    </div>
  </section>

  <!-- Página trip (oculta por defecto) -->
  <section class="page" id="page-trip">
    <div class="container">
      <div class="section-title">Buscar viaje</div>
      <div class="map-wrap" id="tripMapWrap">
        <div id="tripMap" style="width:100%;height:40vh;min-height:260px"></div>
      </div>
      <div id="tripResults"></div>
    </div>
  </section>
</main>

<!-- ============================ NAV INFERIOR ============================ -->
<nav class="bottom-nav">
  <a class="nav-item" href="${baseUrl}/?tab=home">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <span>Inicio</span>
  </a>
  <a class="nav-item active" href="${baseUrl}/?tab=routes">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V9a4 4 0 0 1 4-4h4"/><path d="M18 8v7a4 4 0 0 1-4 4H9"/></svg>
    <span>Rutas</span>
  </a>
  <a class="nav-item" href="${baseUrl}/?tab=market">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    <span>Market</span>
  </a>
</nav>

<!-- ============================ MODALES ============================ -->
<div class="modal" id="commentsModal">
  <div class="modal-sheet" id="commentsSheet">
    <div class="sheet-handle" id="commentsHandle"></div>
    <div class="sheet-head">
      <h3>Comentarios</h3>
      <button class="icon-btn" id="commentsClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="sheet-body" id="commentsList"></div>
  </div>
</div>

<div class="modal" id="editorModal">
  <div class="modal-sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3 id="editorTitle">Registrar ruta</h3>
      <button class="icon-btn" onclick="App.closeModal('editorModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="sheet-body" id="editorBody"></div>
  </div>
</div>

<div class="modal center" id="authModal">
  <div class="modal-sheet">
    <div class="sheet-head">
      <h3>🔐 Acceso administrador</h3>
      <button class="icon-btn" onclick="App.closeModal('authModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label>Contraseña</label>
        <input type="password" class="input" id="adminPass" placeholder="••••••••">
      </div>
      <button class="btn btn-primary btn-block" id="adminLogin">Entrar</button>
    </div>
  </div>
</div>

<div class="viewer" id="viewer">
  <button class="viewer-close" id="viewerClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  <div id="viewerContent"></div>
</div>

<div class="toast-wrap" id="toastWrap"></div>

<!-- ============================ SCRIPTS ============================ -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="https://cdn.jsdelivr.net/npm/idb@8/build/umd.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
<script src="/js/db.js"></script>
<script src="/js/publisher.js"></script>
<script src="/js/app.js"></script>

</body>
</html>`;
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
    urls.push({
      loc: `${baseUrl}${p.url}`,
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
