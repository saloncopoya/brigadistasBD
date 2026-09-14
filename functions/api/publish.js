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
  const safeDesc = escapeHTML((content || '').slice(0, 160));
  const safeImage = image ? escapeHTML(image) : `${baseUrl}/img.png`;

  const typeLabel = tipo === 'ruta' ? 'Ruta' : tipo === 'market' ? 'Anuncio' : 'Publicación';

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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} · Rutas BGD</title>
<meta name="description" content="${safeDesc}">
<link rel="canonical" href="${pageUrl}">

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

<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<meta name="theme-color" content="#0a0e1a">

<!-- Schema.org -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>

<style>
:root{--cyan:#00e5ff;--bg:#0a0e1a;--surface:#141c30;--text:#e8edf7;--text-2:#a9b4cc;--border:#26314f}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:0}
.wrap{max-width:760px;margin:0 auto;padding:20px}
.back{display:inline-flex;align-items:center;gap:6px;color:var(--cyan);text-decoration:none;font-size:13px;font-weight:700;margin-bottom:16px}
h1{font-size:26px;font-weight:900;letter-spacing:-.4px;margin-bottom:8px;line-height:1.2}
.meta{color:var(--text-2);font-size:13px;margin-bottom:20px}
.post-content{font-size:15.5px;line-height:1.7;color:var(--text);background:var(--surface);padding:18px;border-radius:14px;border:1px solid var(--border);margin-bottom:20px}
.post-image{width:100%;border-radius:14px;margin-bottom:20px;border:1px solid var(--border)}
.badge{display:inline-block;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px}
.badge-urbana{background:rgba(0,229,255,.16);color:var(--cyan)}
.badge-foranea{background:rgba(168,85,247,.18);color:#a855f7}
.badge-green{background:rgba(16,185,129,.16);color:#10b981}
.block{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:14px}
.block h3{font-size:14px;font-weight:800;margin-bottom:10px;color:var(--cyan)}
.block ul{list-style:none;padding:0}
.block li{padding:7px 0;border-bottom:1px solid var(--border);font-size:14px}
.block li:last-child{border-bottom:none}
/* 🗺️ Bloque de mapa interactivo */
.route-map-card{
  background:var(--surface,#141c30);
  border:1px solid var(--border,#26314f);
  border-radius:14px;
  padding:14px;
  margin-bottom:16px;
}
.route-map-head{
  display:flex;
  align-items:center;
  gap:12px;
  flex-wrap:wrap;
  margin-bottom:10px;
}
.route-map-head h3{
  font-size:14px;
  font-weight:800;
  margin:0;
  color:var(--cyan,#00e5ff);
}
.route-map-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:11.5px;
  font-weight:700;
  color:var(--text-2,#a9b4cc);
  background:var(--surface-2,#1c2540);
  padding:4px 10px;
  border-radius:99px;
}
#shareMap{
  border-radius:12px;
  background:#0f1526;
}
.leaflet-container{
  background:#0f1526 !important;
  font-family:inherit !important;
}
.leaflet-control-attribution{
  background:rgba(20,28,48,.88) !important;
  color:#a9b4cc !important;
  font-size:10px !important;
}
.leaflet-control-attribution a{color:#00e5ff !important}
.leaflet-control-zoom a{
  background:#141c30 !important;
  color:#e8edf7 !important;
  border-color:#26314f !important;
}
.cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:11px 18px;border-radius:10px;font-weight:700;font-size:13.5px;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
.btn-primary{background:linear-gradient(135deg,var(--cyan),#00b8cc);color:#00121a}
.btn-ghost{background:var(--surface);color:var(--text);border:1px solid var(--border)}
.price{font-size:22px;font-weight:900;color:#10b981;margin:10px 0}
footer{margin-top:30px;padding-top:20px;border-top:1px solid var(--border);color:var(--text-2);font-size:12px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="${baseUrl}/">← Volver a Rutas BGD</a>
  <span class="badge badge-${tipo === 'ruta' ? (extra?.route?.categoria === 'foranea' ? 'foranea' : 'urbana') : tipo === 'market' ? 'green' : 'urbana'}">${typeLabel}</span>
  <h1>${safeTitle}</h1>
  <div class="meta">${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  ${image ? `<img class="post-image" src="${safeImage}" alt="${safeTitle}">` : ''}
  ${bodyContent}
  <div class="cta">
    <a class="btn btn-primary" href="${baseUrl}/">🚌 Ver todas las rutas</a>
    <a class="btn btn-ghost" href="${baseUrl}/?tab=market">🛒 Marketplace</a>
  </div>
  <footer>© ${new Date().getFullYear()} Rutas BGD · <a href="${baseUrl}" style="color:var(--cyan)">${cleanDomain(baseUrl)}</a></footer>
</div>
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
