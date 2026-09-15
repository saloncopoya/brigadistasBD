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
//  Generador de HTML (VERSIÓN UNIFICADA)
// ==========================================================================
function generateHTML({ tipo, title, content, image, slug, pageUrl, baseUrl, extra }) {
  const safeTitle = escapeHTML(title);
  const safeImage = image ? escapeHTML(image) : `${baseUrl}/img.png`;
  const typeLabel = tipo === 'ruta' ? 'Ruta' : tipo === 'market' ? 'Anuncio' : 'Publicación';

  // Construir descripción enriquecida para SEO
  let enrichedContent = content || '';
  if (tipo === 'ruta' && extra?.route) {
    const r = extra.route;
    const parts = [];
    if (r.paradas?.length) parts.push(`📍 Paradas: ${r.paradas.slice(0, 5).join(', ')}${r.paradas.length > 5 ? '...' : ''}`);
    if (r.pois?.length) parts.push(`🏥 POIs: ${r.pois.slice(0, 5).join(', ')}${r.pois.length > 5 ? '...' : ''}`);
    if (r.calles?.length) parts.push(`🛣️ Calles: ${r.calles.slice(0, 4).join(', ')}${r.calles.length > 4 ? '...' : ''}`);
    if (r.tarifa) parts.push(`💰 Tarifa: ${r.tarifa}`);
    if (r.frecuencia) parts.push(`⏱️ ${r.frecuencia}`);
    if (parts.length) enrichedContent = parts.join(' · ');
  }
  const safeDesc = escapeHTML(enrichedContent.slice(0, 160));

  // Schema.org
  let schema;
  if (tipo === 'ruta') {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'BusTrip',
      name: title,
      description: safeDesc,
      url: pageUrl,
      image: safeImage,
      provider: { '@type': 'Organization', name: 'Rutas BGD', url: baseUrl }
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

  // Cuerpo del contenido (mapa, info, etc.)
  let bodyContent = '';
  if (tipo === 'ruta' && extra?.route) {
    bodyContent = renderRouteMapBlock(extra.route) + renderRouteBody(extra.route);
  } else if (tipo === 'market' && extra?.market) {
    bodyContent = renderMarketBody(extra.market);
  } else {
    bodyContent = `<div class="post-content">${escapeHTML(content).replace(/\n/g, '<br>')}</div>`;
  }

  // ✨ INICIO DE LA PLANTILLA UNIFICADA ✨
  // Esta plantilla replica la estructura y los estilos de la aplicación principal (index.html + app.js).
  // Se cargan los mismos scripts para que la lógica del mapa, las secciones colapsables, etc., funcionen igual.
  return `<!DOCTYPE html>
<html lang="es" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
<meta name="theme-color" content="#0a0e1a">
<meta name="description" content="${safeDesc}">
<title>${safeTitle} · Rutas BGD</title>
<link rel="canonical" href="${pageUrl}">

<!-- Open Graph / Twitter -->
<meta property="og:type" content="${tipo === 'post' ? 'article' : 'website'}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="Rutas BGD">
<meta property="og:locale" content="es_MX">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${safeImage}">

<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="apple-touch-icon" href="/assets/icon.svg">

<!-- Preconexiones -->
<link rel="preconnect" href="https://unpkg.com">
<link rel="preconnect" href="https://tile.openstreetmap.org">
<link rel="preconnect" href="https://res.cloudinary.com">
<link rel="preconnect" href="https://www.gstatic.com">

<!-- Leaflet CSS -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">

<!-- Schema.org -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>

<!-- Estilos de la App (copiados para que se vea idéntico) -->

<style>
/* ============================================================
   VARIABLES Y TEMAS
   ============================================================ */
:root{
  --cyan:#00e5ff;
  --cyan-d:#00b8cc;
  --cyan-glow:rgba(0,229,255,.35);
  --purple:#a855f7;
  --green:#10b981;
  --amber:#f59e0b;
  --red:#ef4444;
  --pink:#ec4899;
  --radius:14px;
  --radius-sm:10px;
  --radius-lg:22px;
  --shadow:0 10px 30px rgba(0,0,0,.35);
  --shadow-sm:0 4px 12px rgba(0,0,0,.25);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --nav-h:64px;
  --header-h:58px;
  --transition:.25s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"]{
  --bg:#0a0e1a;
  --bg-2:#0f1526;
  --bg-3:#161e33;
  --surface:#141c30;
  --surface-2:#1c2540;
  --surface-3:#242f4d;
  --border:#26314f;
  --border-2:#334066;
  --text:#e8edf7;
  --text-2:#a9b4cc;
  --text-3:#6b7793;
  --input-bg:#0f1626;
  --overlay:rgba(5,8,16,.85);
  --map-filter:none;
}
[data-theme="light"]{
  --bg:#f4f6fb;
  --bg-2:#ffffff;
  --bg-3:#eef1f8;
  --surface:#ffffff;
  --surface-2:#f4f6fb;
  --surface-3:#e8ecf5;
  --border:#dde3ee;
  --border-2:#c5cfe2;
  --text:#0c1322;
  --text-2:#4a5773;
  --text-3:#8a95ad;
  --input-bg:#f8fafd;
  --overlay:rgba(15,20,35,.55);
  --map-filter:none;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{
  font-family:var(--font);
  background:var(--bg);
  color:var(--text);
  overflow-x:hidden;
  overscroll-behavior-y:none;
  transition:background var(--transition),color var(--transition);
  -webkit-font-smoothing:antialiased;
}
button,input,textarea,select{font-family:inherit;font-size:inherit;color:inherit}
button{cursor:pointer;border:none;background:none}
a{color:var(--cyan);text-decoration:none}
img{max-width:100%;display:block}
.hidden{display:none!important}
::selection{background:var(--cyan);color:#00121a}

/* Scrollbar */
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:var(--cyan-d)}

/* ============================================================
   HEADER
   ============================================================ */
.header{
  position:fixed;top:0;left:0;right:0;height:var(--header-h);
  background:color-mix(in srgb,var(--surface) 92%,transparent);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  padding:0 14px;z-index:1000;
}
.header-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.3px}
.header-brand .logo{
  width:32px;height:32px;border-radius:9px;
  background:linear-gradient(135deg,var(--cyan),var(--cyan-d));
  display:grid;place-items:center;color:#00121a;font-size:17px;
  box-shadow:0 0 18px var(--cyan-glow);
}
.header-brand .logo svg{width:20px;height:20px}
.header-brand .brand-txt{background:linear-gradient(90deg,var(--cyan),#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.header-actions{display:flex;align-items:center;gap:6px}
.icon-btn{
  width:40px;height:40px;border-radius:11px;display:grid;place-items:center;
  color:var(--text-2);transition:var(--transition);position:relative;
}
.icon-btn:hover{background:var(--surface-2);color:var(--cyan)}
.icon-btn:active{transform:scale(.92)}
.icon-btn svg{width:20px;height:20px}
.conn-dot{
  position:absolute;bottom:6px;right:6px;width:8px;height:8px;border-radius:50%;
  background:var(--green);border:2px solid var(--surface);transition:var(--transition);
}
.conn-dot.off{background:var(--red)}
.install-btn{
  display:none;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;
  background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;
  font-weight:700;font-size:12.5px;
}
.install-btn.show{display:flex}

/* ============================================================
   LAYOUT PRINCIPAL
   ============================================================ */
.app{padding-top:var(--header-h);padding-bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));min-height:100vh}
.page{display:none;animation:fadeIn .3s ease}
.page.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.container{max-width:1100px;margin:0 auto;padding:14px}

/* ============================================================
   NAV INFERIOR
   ============================================================ */
.bottom-nav{
  position:fixed;bottom:0;left:0;right:0;height:calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding-bottom:env(safe-area-inset-bottom);
  background:color-mix(in srgb,var(--surface) 96%,transparent);
  backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border-top:1px solid var(--border);
  display:grid;grid-template-columns:repeat(3,1fr);z-index:1000;
}
.nav-item{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;color:var(--text-3);font-size:11px;font-weight:600;
  transition:var(--transition);position:relative;
}
.nav-item svg{width:23px;height:23px;transition:var(--transition)}
.nav-item.active{color:var(--cyan)}
.nav-item.active svg{transform:translateY(-2px) scale(1.08)}
.nav-item.active::before{
  content:"";position:absolute;top:6px;width:44px;height:3px;border-radius:0 0 4px 4px;
  background:var(--cyan);box-shadow:0 0 14px var(--cyan-glow);
}
.nav-item:active{transform:scale(.94)}

/* ============================================================
   TARJETAS / UI GENERAL
   ============================================================ */
.card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px;transition:var(--transition);
}
.card:hover{border-color:var(--border-2)}
.section-title{
  font-size:15px;font-weight:800;letter-spacing:.3px;margin:18px 0 10px;
  display:flex;align-items:center;gap:8px;color:var(--text);
}
.section-title svg{width:18px;height:18px;color:var(--cyan)}
.muted{color:var(--text-2);font-size:13px}
.tiny{color:var(--text-3);font-size:11.5px}

/* Botones */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:11px 16px;border-radius:var(--radius-sm);font-weight:700;font-size:13.5px;
  transition:var(--transition);border:1px solid transparent;
}
.btn svg{width:17px;height:17px}
.btn:active{transform:scale(.96)}
.btn-primary{background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;box-shadow:0 6px 18px -6px var(--cyan-glow)}
.btn-primary:hover{filter:brightness(1.08);box-shadow:0 8px 22px -6px var(--cyan-glow)}
.btn-ghost{background:var(--surface-2);color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--surface-3);border-color:var(--border-2)}
.btn-danger{background:color-mix(in srgb,var(--red) 18%,transparent);color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,transparent)}
.btn-danger:hover{background:color-mix(in srgb,var(--red) 28%,transparent)}
.btn-block{width:100%}
.btn-sm{padding:8px 12px;font-size:12.5px}
.btn-icon{padding:9px;width:38px;height:38px}

/* Chips */
.chips{display:flex;gap:8px;overflow-x:auto;padding:4px 2px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{
  flex-shrink:0;padding:8px 14px;border-radius:99px;font-size:12.5px;font-weight:700;
  background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);
  transition:var(--transition);white-space:nowrap;
  display:inline-flex;align-items:center;gap:6px;
}
.chip svg{flex-shrink:0;transition:var(--transition);}
.chip.active svg{color:#00121a;}
.chip:hover{border-color:var(--border-2);color:var(--text)}
.chip.active{background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;border-color:transparent;box-shadow:0 4px 14px -4px var(--cyan-glow)}
.chip.mini{padding:4px 10px;font-size:11px;font-weight:600}

/* Inputs */
.input,.textarea,.select{
  width:100%;padding:12px 14px;border-radius:var(--radius-sm);
  background:var(--input-bg);border:1px solid var(--border);color:var(--text);
  font-size:14px;transition:var(--transition);
}
.input:focus,.textarea:focus,.select:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px color-mix(in srgb,var(--cyan) 18%,transparent)}
.textarea{resize:vertical;min-height:90px;line-height:1.5}
.select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7793' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:16px;padding-right:38px}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.field label{font-size:12.5px;font-weight:700;color:var(--text-2);letter-spacing:.2px}
.form-grid{display:grid;grid-template-columns:1fr;gap:0}

/* Badges */
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
.badge-urbana{background:color-mix(in srgb,var(--cyan) 16%,transparent);color:var(--cyan);border:1px solid color-mix(in srgb,var(--cyan) 30%,transparent)}
.badge-foranea{background:color-mix(in srgb,var(--purple) 18%,transparent);color:var(--purple);border:1px solid color-mix(in srgb,var(--purple) 32%,transparent)}
.badge-green{background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green);border:1px solid color-mix(in srgb,var(--green) 30%,transparent)}
.badge-amber{background:color-mix(in srgb,var(--amber) 18%,transparent);color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 32%,transparent)}

/* Empty state */
.empty{text-align:center;padding:40px 20px;color:var(--text-3)}
.empty svg{width:56px;height:56px;margin-bottom:12px;opacity:.4}
.empty h3{font-size:15px;margin-bottom:6px;color:var(--text-2)}
.empty p{font-size:13px;max-width:300px;margin:0 auto}

/* Toast */
.toast-wrap{position:fixed;top:calc(var(--header-h) + 10px);left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:calc(100% - 24px);max-width:400px}
.toast{
  background:var(--surface-3);color:var(--text);padding:12px 16px;border-radius:var(--radius-sm);
  border:1px solid var(--border-2);box-shadow:var(--shadow);font-size:13.5px;font-weight:600;
  display:flex;align-items:center;gap:10px;pointer-events:auto;
  animation:toastIn .3s cubic-bezier(.4,0,.2,1);
}
.toast.ok{border-color:color-mix(in srgb,var(--green) 50%,transparent)}
.toast.err{border-color:color-mix(in srgb,var(--red) 50%,transparent)}
.toast svg{width:18px;height:18px;flex-shrink:0}
.toast.ok svg{color:var(--green)}
.toast.err svg{color:var(--red)}
@keyframes toastIn{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}

/* Modal base */
.modal{
  position:fixed;inset:0;background:var(--overlay);z-index:2000;
  display:flex;align-items:flex-end;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
}
.modal.open{opacity:1;pointer-events:auto}
.modal.center{align-items:center;padding:16px}
.modal-sheet{
  background:var(--surface);width:100%;max-width:560px;border-radius:var(--radius-lg) var(--radius-lg) 0 0;
  max-height:92vh;display:flex;flex-direction:column;
  transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);
  border-top:1px solid var(--border-2);
}
.modal.open .modal-sheet{transform:translateY(0)}
.modal.center .modal-sheet{border-radius:var(--radius-lg);transform:scale(.94);border:1px solid var(--border-2)}
.modal.center.open .modal-sheet{transform:scale(1)}
.sheet-handle{padding:10px 0 4px;display:grid;place-items:center;cursor:grab}
.sheet-handle::before{content:"";width:40px;height:4px;border-radius:99px;background:var(--border-2)}
.sheet-head{padding:6px 18px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.sheet-head h3{font-size:16px;font-weight:800}
.sheet-body{padding:16px 18px;overflow-y:auto;flex:1}

/* Visor imagen */
.viewer{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:3000;display:none;align-items:center;justify-content:center;padding:20px}
.viewer.open{display:flex}
.viewer img,.viewer video{max-width:100%;max-height:100%;border-radius:8px;object-fit:contain}
.viewer-close{position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.12);display:grid;place-items:center;color:#fff;backdrop-filter:blur(8px)}
.viewer-close svg{width:22px;height:22px}

/* ============================================================
   FEED (INICIO)
   ============================================================ */
.feed{display:flex;flex-direction:column;gap:14px;max-width:620px;margin:0 auto;padding:14px}
.post-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:var(--transition)}
.post-card:hover{border-color:var(--border-2)}
.post-head{display:flex;align-items:center;gap:10px;padding:12px 14px}
.post-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));display:grid;place-items:center;color:#00121a;font-weight:800;font-size:16px;flex-shrink:0}
.post-meta{flex:1;min-width:0}
.post-meta .name{font-weight:700;font-size:14px}
.post-meta .time{font-size:11.5px;color:var(--text-3)}
.post-body{padding:0 14px 12px;font-size:14.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.post-media{width:100%;max-height:520px;object-fit:cover;background:#000;cursor:zoom-in}
.post-actions{display:flex;border-top:1px solid var(--border);padding:4px}
.post-action{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border-radius:8px;color:var(--text-2);font-size:13px;font-weight:700;transition:var(--transition);position:relative}
.post-action:hover{background:var(--surface-2);color:var(--text)}
.post-action.liked{color:var(--pink)}
.post-action svg{width:19px;height:19px}
.heart-burst{position:absolute;pointer-events:none;font-size:38px;animation:heartBurst .8s ease forwards}
@keyframes heartBurst{0%{transform:scale(0);opacity:1}50%{transform:scale(1.4)}100%{transform:scale(1.8) translateY(-40px);opacity:0}}

/* ============================================================
   RUTAS
   ============================================================ */
.search-bar{display:grid;gap:10px;margin-bottom:14px}
.search-row{display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 4px 4px 14px;position:relative}
.search-row svg{width:18px;height:18px;color:var(--text-3);flex-shrink:0}
.search-row input{flex:1;border:none;background:transparent;padding:11px 8px;font-size:14px}
.search-row input:focus{outline:none}
.search-row .swap{background:var(--surface-2);border-radius:8px;width:36px;height:36px;display:grid;place-items:center;color:var(--cyan);flex-shrink:0}
.suggestions{
  position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--surface-3);
  border:1px solid var(--border-2);border-radius:var(--radius-sm);z-index:50;
  max-height:260px;overflow-y:auto;box-shadow:var(--shadow);
}
.suggestion{padding:11px 14px;display:flex;align-items:center;gap:10px;font-size:13.5px;cursor:pointer;transition:var(--transition)}
.suggestion:hover,.suggestion.hl{background:var(--surface-2);color:var(--cyan)}
.suggestion svg{width:16px;height:16px;color:var(--cyan);flex-shrink:0}

.routes-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .route-card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 10px;position:relative;transition:var(--transition);overflow:hidden;
  display:flex;flex-direction:column;gap:8px;min-height:110px;
  align-items:center;text-align:center;
}
.route-card:hover{border-color:var(--cyan);transform:translateY(-2px);box-shadow:var(--shadow-sm)}
.route-card .route-icon{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));display:grid;place-items:center;color:#00121a}
.route-card .route-icon svg{width:24px;height:24px}
.route-card .route-name{font-weight:800;font-size:14px;letter-spacing:.3px;text-transform:uppercase;line-height:1.25;word-break:break-word;text-align:center;width:100%}
   
   .route-card .route-actions{display:flex;gap:6px;margin-top:auto}
.route-card .route-actions .icon-btn{width:32px;height:32px;background:var(--surface-2);border-radius:8px}
.route-card .route-actions .icon-btn svg{width:15px;height:15px}
.route-card .edit-del{position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:var(--transition)}
.route-card:hover .edit-del,.route-card:focus-within .edit-del{opacity:1}
.route-card .edit-del .icon-btn{width:28px;height:28px;background:var(--surface-3);border-radius:7px}
.route-card .edit-del .icon-btn svg{width:14px;height:14px}

.list-group{display:flex;flex-direction:column;gap:10px}
.list-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.list-item .li-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.list-item .li-title{font-weight:700;font-size:13.5px}
.list-item .li-chips{display:flex;flex-wrap:wrap;gap:6px}

/* Resultados búsqueda */
.result-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px;transition:var(--transition);cursor:pointer}
.result-card:hover{border-color:var(--cyan);box-shadow:var(--shadow-sm)}
.result-card.directa{border-left:3px solid var(--green)}
.result-card.transbordo{border-left:3px solid var(--amber)}
.result-card.warn{border-left:3px solid var(--amber);background:color-mix(in srgb,var(--amber) 6%,var(--surface))}
.result-card .rc-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.result-card .rc-head .rc-icon{width:36px;height:36px;border-radius:9px;background:var(--surface-2);display:grid;place-items:center;color:var(--cyan)}
.result-card .rc-head .rc-icon svg{width:20px;height:20px}
.result-card .rc-route{font-weight:800;font-size:14px;text-transform:uppercase}
.result-card .rc-sub{font-size:11.5px;color:var(--text-3)}
.result-card .rc-body{font-size:13px;color:var(--text-2);line-height:1.5}
.result-card .rc-steps{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.rc-step{display:flex;gap:8px;font-size:12.5px;padding:8px 10px;background:var(--surface-2);border-radius:8px}
.rc-step .step-num{width:20px;height:20px;border-radius:50%;background:var(--cyan);color:#00121a;display:grid;place-items:center;font-weight:800;font-size:11px;flex-shrink:0}

/* Mapa */
.map-wrap{position:relative;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);background:var(--surface-2)}
#map,#mapFull{width:100%;height:42vh;min-height:260px;z-index:1}
   .map-toolbar{
  position:absolute;top:10px;left:10px;right:10px;z-index:500;
  display:flex;gap:6px;flex-wrap:wrap;pointer-events:none;
}
.map-toolbar .tb{pointer-events:auto;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(10px);border:1px solid var(--border-2);border-radius:10px;padding:8px 11px;font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:5px;box-shadow:var(--shadow-sm);transition:var(--transition)}
.map-toolbar .tb svg{width:15px;height:15px}
.map-toolbar .tb:hover{border-color:var(--cyan);color:var(--cyan)}
.map-toolbar .tb.active{background:var(--cyan);color:#00121a;border-color:transparent}
.map-back{position:absolute;top:12px;left:12px;z-index:600;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid var(--border-2);border-radius:12px;width:42px;height:42px;display:grid;place-items:center;color:var(--text);box-shadow:var(--shadow);backdrop-filter:blur(10px)}
.map-back svg{width:22px;height:22px}
.map-full-btn{position:absolute;top:12px;right:12px;z-index:600;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid var(--border-2);border-radius:12px;width:42px;height:42px;display:grid;place-items:center;color:var(--text);box-shadow:var(--shadow);backdrop-filter:blur(10px)}
.map-full-btn svg{width:20px;height:20px}

/* 🖥️ Botón de pantalla completa dentro del mapa (esquina inferior derecha) */
.map-fs-btn{
  position:absolute;bottom:12px;right:12px;z-index:600;
  background:color-mix(in srgb,var(--surface) 96%,transparent);
  border:1px solid var(--border-2);border-radius:12px;
  width:42px;height:42px;display:grid;place-items:center;
  color:var(--text);box-shadow:var(--shadow);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  transition:var(--transition);cursor:pointer;
}
.map-fs-btn:hover{background:var(--surface-3);border-color:var(--cyan);color:var(--cyan)}
.map-fs-btn:active{transform:scale(.94)}
.map-fs-btn svg{width:20px;height:20px}

/* Estado de pantalla completa: el wrapper ocupa toda la pantalla */
.map-wrap.is-fullscreen,
#routeMapWrap.is-fullscreen,
#tripMapWrap.is-fullscreen{
  position:fixed !important;
  inset:0 !important;
  z-index:9500 !important;
  margin:0 !important;
  border-radius:0 !important;
  border:none !important;
}
.map-wrap.is-fullscreen > div[id$="Map"],
.map-wrap.is-fullscreen > div[id="map"]{
  height:100vh !important;
  width:100vw !important;
}
body.fs-active{overflow:hidden !important}

.leaflet-container{background:var(--bg-2)!important;font-family:var(--font)!important}
.leaflet-control-zoom a{background:var(--surface)!important;color:var(--text)!important;border-color:var(--border)!important}
.leaflet-control-attribution{background:color-mix(in srgb,var(--surface) 88%,transparent)!important;color:var(--text-2)!important;font-size:10px!important}
.leaflet-control-attribution a{color:var(--cyan)!important}


   .leaflet-popup-content-wrapper{background:var(--surface-3)!important;color:var(--text)!important;border-radius:12px!important;border:1px solid var(--border-2)!important}
.leaflet-popup-tip{background:var(--surface-3)!important}

/* 🚫 Quitar el outline negro al hacer focus en cualquier capa SVG del mapa */
.leaflet-interactive:focus,
.leaflet-interactive:focus-visible,
.leaflet-interactive:active {
  outline: none !important;
  outline-width: 0 !important;
  outline-offset: 0 !important;
  box-shadow: none !important;
  -webkit-tap-highlight-color: transparent !important;
}

/* Por si el navegador dibuja el outline sobre el SVG padre */
.leaflet-container svg:focus,
.leaflet-container svg:focus-visible,
.leaflet-container svg path:focus,
.leaflet-container svg path:focus-visible {
  outline: none !important;
  outline-width: 0 !important;
  -webkit-tap-highlight-color: transparent !important;
}
   
.marker-a,.marker-b,.marker-c,.marker-d,.marker-e{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;color:#fff;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.5)}
.marker-a{background:#10b981}.marker-b{background:#ef4444}.marker-c{background:#f59e0b}.marker-d{background:#3b82f6}.marker-e{background:#a855f7}

/* Panel ruta individual */
.route-hero{padding:14px;display:flex;flex-direction:column;gap:10px}
.route-hero h1{font-size:24px;font-weight:900;letter-spacing:-.4px;text-transform:uppercase;line-height:1.15}
.route-hero .hero-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.route-hero .share-row{display:flex;gap:8px;margin-top:4px}
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

/* Calles con flechas */
.street-seq{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.street-step{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;background:var(--surface-2);border-radius:99px;font-size:12.5px;font-weight:600}
.street-step .arrow{color:var(--cyan);font-weight:800}

/* ============================================================
   MARKETPLACE
   ============================================================ */
.market-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.market-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:var(--transition);display:flex;flex-direction:column}
.market-card:hover{border-color:var(--cyan);transform:translateY(-3px);box-shadow:var(--shadow)}
.market-media{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--surface-3);display:grid;place-items:center;color:var(--text-3)}
.market-media svg{width:44px;height:44px}
.market-body{padding:12px 14px;display:flex;flex-direction:column;gap:8px;flex:1}
.market-title{font-weight:800;font-size:14.5px;line-height:1.3}
.market-price{font-weight:800;font-size:16px;color:var(--green)}
.market-desc{font-size:12.5px;color:var(--text-2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.market-foot{display:flex;gap:6px;padding:0 14px 14px;margin-top:auto}

/* Admin */
.admin-bar{position:fixed;bottom:calc(var(--nav-h) + 14px);right:14px;z-index:900}
.fab{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,var(--cyan),var(--cyan-d));color:#00121a;display:grid;place-items:center;box-shadow:0 10px 28px -8px var(--cyan-glow);transition:var(--transition)}
.fab:hover{transform:translateY(-3px) scale(1.04)}
.fab:active{transform:scale(.94)}
.fab svg{width:26px;height:26px}

/* Pasos wizard */
.steps{display:flex;align-items:center;gap:6px;margin-bottom:16px}
.step-dot{flex:1;height:5px;border-radius:99px;background:var(--border);transition:var(--transition)}
.step-dot.done{background:var(--green)}
.step-dot.active{background:var(--cyan);box-shadow:0 0 10px var(--cyan-glow)}
.step-num{font-size:11px;font-weight:800;color:var(--text-3);text-align:center;margin-bottom:4px}

/* Barra progreso */
.progress{height:6px;border-radius:99px;background:var(--surface-3);overflow:hidden}
.progress > div{height:100%;background:linear-gradient(90deg,var(--cyan),var(--cyan-d));transition:width .3s ease;border-radius:99px}

/* ============================================================
   RESPONSIVE
   ============================================================ */
/* ============================================================
   TRIP SEARCH — Controles compactos arriba del mapa
   ============================================================ */
.trip-controls{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;
}

/* Toolbar DENTRO del mapa (esquina inferior izquierda) */
.map-toolbar-below{
  position:absolute;
  left:12px;
  bottom:12px;
  z-index:600;
  display:flex;
  gap:5px;
  padding:4px;
  background:color-mix(in srgb,var(--surface) 96%,transparent);
  border:1px solid var(--border-2);
  border-radius:10px;
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  box-shadow:var(--shadow);
}
   
.map-toolbar-below .tb{
  width:34px;height:28px;
  justify-content:center;align-items:center;
  background:var(--surface-2);
  border:1px solid var(--border);
  border-radius:8px;
  color:var(--text);
  display:flex;
  transition:var(--transition);
  padding:0;
}

   .map-toolbar-below .tb.tb-text{
  width:auto;
  padding:0 10px;
  gap:5px;
}
.map-toolbar-below .tb.tb-text span{
  font-size:10.5px;
  font-weight:800;
  letter-spacing:.3px;
  color:inherit;
  line-height:1;
}
.map-toolbar-below .tb svg{width:14px;height:14px}
.map-toolbar-below .tb:hover{border-color:var(--cyan);color:var(--cyan)}
.map-toolbar-below .tb.active{background:var(--cyan);color:#00121a;border-color:transparent}
   
.trip-controls-row{
  display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;
}
.trip-controls-row .trip-radius-box{flex:2;min-width:140px}
.trip-controls-row .trip-transfers-box{flex:1;min-width:110px}
.trip-controls-row label{
  font-size:11px;font-weight:700;color:var(--text-2);display:block;margin-bottom:3px;
}
.trip-controls-row input[type="range"]{width:100%;accent-color:var(--cyan)}
.trip-controls-row .select{padding:7px 28px 7px 10px;font-size:12px}

.trip-points-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:6px;
}
.trip-points-grid .trip-point-card{
  background:var(--surface-2);border:1px solid var(--border);border-radius:8px;
  padding:6px 8px;display:flex;align-items:center;gap:6px;font-size:11px;
  min-width:0;
}
.trip-points-grid .trip-point-card .tpc-letter{
  width:24px;height:24px;border-radius:50%;display:grid;place-items:center;
  color:#fff;font-weight:800;font-size:12px;flex-shrink:0;
}
.trip-points-grid .trip-point-card .tpc-coords{
  flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--text);font-size:12px;font-weight:800;
  letter-spacing:.2px;
}
.trip-points-grid .trip-point-card .tpc-actions{display:flex;gap:2px;flex-shrink:0}
.trip-points-grid .trip-point-card .tpc-actions button{
  width:20px;height:20px;border-radius:5px;background:var(--surface-3);
  display:grid;place-items:center;color:var(--text-2);font-size:11px;
}
.trip-points-grid .trip-point-card .tpc-actions button:hover{color:var(--red)}
.trip-points-grid .empty-trip{
  grid-column:1/-1;text-align:center;padding:14px 10px;font-size:12.5px;
  color:var(--text-2);font-weight:600;line-height:1.5;
  border:1px dashed var(--border-2);border-radius:10px;
  background:var(--surface-2);
}

/* Resultados enriquecidos */
.trip-result-actions{
  display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;
}
.trip-result-actions .btn{padding:6px 10px;font-size:11.5px}
.trip-badge-route{
  display:inline-block;padding:2px 7px;border-radius:99px;font-size:10px;
  font-weight:800;color:#fff;margin-right:4px;
}

/* 🔗 Cadena de rutas (chips cuadrados) en el encabezado de cada transbordo */
.trip-chain{
  display:flex;flex-wrap:wrap;align-items:center;gap:4px;
  padding:0;
  margin-bottom:4px;
}
.trip-chain-item{
  display:inline-flex;align-items:center;gap:6px;
  padding:4px 8px 4px 4px;
  background:var(--surface-2);
  border:1px solid var(--border);
  border-radius:10px;
}
.trip-chain-chip{
  width:22px;height:22px;border-radius:6px;
  display:grid;place-items:center;
  color:#fff;font-weight:800;font-size:11px;flex-shrink:0;
  box-shadow:0 2px 6px rgba(0,0,0,.25);
}
.trip-chain-name{
  font-size:12.5px;font-weight:700;color:var(--text);
  text-transform:uppercase;letter-spacing:.2px;
  white-space:nowrap;
}
.trip-chain-sep{
  color:var(--text-3);font-weight:800;font-size:16px;
  margin:0 2px;line-height:1;
}
.trip-legend{
  display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding:8px 10px;
  background:var(--surface-2);border-radius:8px;font-size:11px;
}
.trip-legend .tl-item{display:flex;align-items:center;gap:5px}
.trip-legend .tl-color{width:14px;height:4px;border-radius:2px}

/* ============================================================
   RESPONSIVE
   ============================================================ */
@media(min-width:720px){
  .form-grid{grid-template-columns:1fr 1fr;gap:0 14px}
  .form-grid .field.full{grid-column:1/-1}
  .routes-grid{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}
   .feed{max-width:680px}
}
@media(min-width:1000px){
  .app{max-width:1200px;margin:0 auto}
  .bottom-nav{max-width:560px;left:50%;transform:translateX(-50%);border-radius:18px 18px 0 0;border-left:1px solid var(--border);border-right:1px solid var(--border)}
  #map{height:70vh}
}
@media(max-width:380px){
  .map-toolbar-below .tb{width:28px;height:24px}
  .map-toolbar-below .tb svg{width:12px;height:12px}
  .routes-grid{grid-template-columns:repeat(3,1fr)}
   
  .header-brand .brand-txt{font-size:14px}
  .route-card{padding:10px 8px;min-height:100px}
  .route-card .route-icon{width:34px;height:34px}
  .route-card .route-icon svg{width:18px;height:18px}
  .route-card .route-name{font-size:11px}
  .route-card .route-actions .icon-btn{width:26px;height:26px}
  .route-card .edit-del .icon-btn{width:24px;height:24px}
}
   /* Leyenda del mapa */
.map-legend {
  pointer-events: none;
}
</style>
</head>
<body>

<!-- ============================ HEADER ============================ -->
<header class="header">
  <div class="header-brand">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>
    <span class="brand-txt">Rutas BGD</span>
  </div>
  <div class="header-actions">
    <button class="icon-btn" id="themeBtn" title="Cambiar tema">
      <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
    <a class="icon-btn" href="${baseUrl}" title="Ir al sitio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </a>
  </div>
</header>

<!-- ============================ APP ============================ -->
<main class="app" id="app">
  <!-- PÁGINA: RUTA INDIVIDUAL (única página que se muestra) -->
  <section class="page active" id="page-route">
    <!-- La imagen OG se oculta visualmente pero se mantiene para SEO -->
    <img src="${safeImage}" alt="${safeTitle}" style="display:none;">
    
    <div class="route-hero" id="routeHero"></div>
    <div class="map-wrap" id="routeMapWrap" style="margin:0 14px">
      <div id="map"></div>
      <button class="map-fs-btn" id="routeMapFsBtn" title="Pantalla completa">...</button>
    </div>
    <div class="container">
      <div class="route-panel" id="routePanel"></div>
    </div>
  </section>
</main>

<!-- ============================ NAV INFERIOR ============================ -->
<nav class="bottom-nav">
  <button class="nav-item" onclick="window.location.href='${baseUrl}/?tab=home'">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <span>Inicio</span>
  </button>
  <button class="nav-item active" onclick="window.location.href='${baseUrl}/?tab=routes'">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V9a4 4 0 0 1 4-4h4"/><path d="M18 8v7a4 4 0 0 1-4 4H9"/></svg>
    <span>Rutas</span>
  </button>
  <button class="nav-item" onclick="window.location.href='${baseUrl}/?tab=market'">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    <span>Market</span>
  </button>
</nav>

<!-- ============================ SCRIPTS ============================ -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="https://cdn.jsdelivr.net/npm/idb@8/build/umd.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
<script src="/js/db.js"></script>
<script src="/js/publisher.js"></script>
<script src="/js/app.js"></script>

<!-- Script de inicialización específico para esta página -->
<script>
  window.ROUTE_DATA_FOR_STATIC_PAGE = ${JSON.stringify(extra?.route || null)};
</script>
</body>
</html>`;
}
// ==========================================================================
//  FIN DEL GENERADOR DE HTML UNIFICADO
// ==========================================================================

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

  // Si no hay NADA de geometría ni puntos, no mostramos el bloque
  if (!puntos.length && !puntosVuelta.length && !geomIda.length && !geomVuelta.length) {
    return '';
  }

  const colorIda    = route.colorIda    || '#00e5ff';
  const colorVuelta = route.colorVuelta || '#a855f7';
  const nombre      = escapeHTML(route.nombre || 'Ruta');

  // Serializar los datos con JSON.stringify y escapar `</script>`
  const dataJSON = JSON.stringify({
    puntos, puntosVuelta, geomIda, geomVuelta, colorIda, colorVuelta, nombre
  }).replace(/<\/script/gi, '<\\/script');

  return `
    <div class="route-map-card">
      <div class="route-map-head">
        <h3>🗺️ Trazado de la ruta</h3>
        <span class="route-map-badge">Ida <span style="display:inline-block;width:12px;height:3px;background:${colorIda};vertical-align:middle;border-radius:2px"></span></span>
        <span class="route-map-badge">Regreso <span style="display:inline-block;width:12px;height:3px;background:${colorVuelta};vertical-align:middle;border-radius:2px"></span></span>
      </div>
      <div id="shareMap" style="width:100%;height:420px;border-radius:12px;overflow:hidden"></div>
    </div>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin><\/script>
    <script>
    (function(){
      var DATA = ${dataJSON};
      if (typeof L === 'undefined') return;
      var map = L.map('shareMap', { zoomControl: true, scrollWheelZoom: false });
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
      }

      var idaCoords = (DATA.geomIda && DATA.geomIda.length > 1) ? DATA.geomIda : DATA.puntos;
      var vueltaCoords = (DATA.geomVuelta && DATA.geomVuelta.length > 1) ? DATA.geomVuelta : DATA.puntosVuelta;
      drawLine(idaCoords, DATA.colorIda, false);
      drawLine(vueltaCoords, DATA.colorVuelta, true);

      if (DATA.puntos && DATA.puntos.length) {
        DATA.puntos.forEach(function(p){
          L.circleMarker(p, { radius: 6, color: DATA.colorIda, fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(map);
        });
      }
      if (DATA.puntosVuelta && DATA.puntosVuelta.length) {
        DATA.puntosVuelta.forEach(function(p){
          L.circleMarker(p, { radius: 6, color: DATA.colorVuelta, fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(map);
        });
      }

      if (allCoords.length > 1) {
        try { map.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e) {}
      } else if (allCoords.length === 1) {
        map.setView(allCoords[0], 15);
      } else {
        map.setView([16.7530, -93.1150], 13);
      }
    })();
    <\/script>
  `;
}

function renderRouteBody(route) {
  const blocks = [];
  if (route.paradas?.length) blocks.push(`<div class="block"><h3>📍 Paradas</h3><ul>${route.paradas.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);
  if (route.retornos?.length) blocks.push(`<div class="block"><h3>↩️ Retornos</h3><ul>${route.retornos.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);
  if (route.pois?.length) blocks.push(`<div class="block"><h3>🏥 POIs de Ida</h3><ul>${route.pois.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);
  if (route.poisVuelta?.length) blocks.push(`<div class="block"><h3>🏥 POIs de Regreso</h3><ul>${route.poisVuelta.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);
  if (route.calles?.length) blocks.push(`<div class="block"><h3>🛣️ Calles</h3><ul>${route.calles.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul></div>`);
  const info = [];
  if (route.tarifa) info.push(`<li>💰 Tarifa: ${escapeHTML(route.tarifa)}</li>`);
  if (route.frecuencia) info.push(`<li>⏱️ Frecuencia: ${escapeHTML(route.frecuencia)}</li>`);
  if (route.horarioIni) info.push(`<li>🕐 Horario: ${escapeHTML(route.horarioIni)} - ${escapeHTML(route.horarioFin || '')}</li>`);
  if (route.dias) info.push(`<li>📅 Días: ${escapeHTML(route.dias)}</li>`);
  if (info.length) blocks.unshift(`<div class="block"><h3>ℹ️ Información</h3><ul>${info.join('')}</ul></div>`);
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
