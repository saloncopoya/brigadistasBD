// functions/api/publish.js
// Cloudflare Pages Function: recibe post, verifica contraseña y sube a GitHub

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json();
    const {
      password,
      slug,
      title,
      description,
      content,
      image,
      metadata,
      mapPoints,
      streets,
      pois,
      routeData,
    } = body;

    // 1. Verificar contraseña
    if (!password || password !== env.ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validar campos
    if (!slug || !title) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Faltan campos obligatorios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanSlug = slug
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const domain = env.SITE_DOMAIN || 'https://rutas-tuxtla.pages.dev';
    const canonical = `${domain}/paginas/${cleanSlug}.html`;
    const now = new Date().toISOString();

    // 3. Leer posts-index.json actual desde GitHub
    const owner = env.REPO_OWNER;
    const repo = env.REPO_NAME;
    const token = env.GITHUB_TOKEN;
    const branch = 'main';

    if (!owner || !repo || !token) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Configuración del servidor incompleta' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ghApi = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RutasTuxtlaBot',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Leer índice actual
    let currentIndex = { posts: [], updatedAt: now, total: 0 };
    let indexSha = null;

    try {
      const idxRes = await fetch(`${ghApi}/paginas/posts-index.json?ref=${branch}`, {
        headers: ghHeaders,
      });
      if (idxRes.ok) {
        const idxData = await idxRes.json();
        indexSha = idxData.sha;
        const decoded = atob(idxData.content.replace(/\n/g, ''));
        currentIndex = JSON.parse(decoded);
      }
    } catch (e) {
      // Si no existe, se crea nuevo
    }

    // 4. Generar HTML del post individual
    const postHtml = generatePostHtml({
      slug: cleanSlug,
      title,
      description,
      content,
      image,
      metadata,
      canonical,
      domain,
      now,
    });

    // 5. Subir HTML del post a GitHub
    const postPath = `paginas/${cleanSlug}.html`;
    let postSha = null;

    try {
      const existRes = await fetch(`${ghApi}/${postPath}?ref=${branch}`, {
        headers: ghHeaders,
      });
      if (existRes.ok) {
        const existData = await existRes.json();
        postSha = existData.sha;
      }
    } catch (e) {}

    const postPayload = {
      message: `feat(post): ${title}`,
      content: btoa(unescape(encodeURIComponent(postHtml))),
      branch,
    };
    if (postSha) postPayload.sha = postSha;

    const postRes = await fetch(`${ghApi}/${postPath}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(postPayload),
    });

    if (!postRes.ok) {
      const err = await postRes.text();
      throw new Error(`Error subiendo post: ${err}`);
    }

    // 6. Actualizar índice
    const newEntry = {
      slug: cleanSlug,
      title,
      description: description || '',
      image: image || '',
      url: `paginas/${cleanSlug}.html`,
      canonical,
      tipo: metadata?.tipo || 'ida',
      color: metadata?.color || '#1e40af',
      empresa: metadata?.empresa || '',
      tarifa: metadata?.tarifa || '',
      frecuencia: metadata?.frecuencia || '',
      horario: metadata?.horario || '',
      dias: metadata?.dias || 'todos',
      accesible: metadata?.accesible || 'no',
      puntos: Array.isArray(mapPoints) ? mapPoints.length : 0,
      calles: Array.isArray(streets) ? streets.length : 0,
      pois: Array.isArray(pois) ? pois.length : 0,
      createdAt: now,
      updatedAt: now,
    };

    // Remover duplicados por slug
    currentIndex.posts = currentIndex.posts.filter((p) => p.slug !== cleanSlug);
    currentIndex.posts.unshift(newEntry);
    currentIndex.updatedAt = now;
    currentIndex.total = currentIndex.posts.length;

    const indexPayload = {
      message: `chore(index): actualizar índice - ${title}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(currentIndex, null, 2)))),
      branch,
    };
    if (indexSha) indexPayload.sha = indexSha;

    const indexRes = await fetch(`${ghApi}/paginas/posts-index.json`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(indexPayload),
    });

    if (!indexRes.ok) {
      const err = await indexRes.text();
      throw new Error(`Error actualizando índice: ${err}`);
    }

    // 7. Actualizar sitemap.xml
    await updateSitemap({ ghApi, ghHeaders, branch, domain, posts: currentIndex.posts });

    return new Response(
      JSON.stringify({
        ok: true,
        slug: cleanSlug,
        url: `/${postPath}`,
        canonical,
        message: 'Post publicado correctamente',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error en publish:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || 'Error interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/* ============================================================
   Genera el HTML del post individual
   ============================================================ */
function generatePostHtml({ slug, title, description, content, image, metadata, canonical, domain, now }) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description || '');
  const imageUrl = image || `${domain}/assets/icon.svg`;
  const dateStr = new Date(now).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Schema.org JSON-LD
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description || '',
    image: imageUrl,
    author: { '@type': 'Organization', name: 'Rutas Tuxtla Gutiérrez' },
    publisher: {
      '@type': 'Organization',
      name: 'Rutas Tuxtla Gutiérrez',
      logo: { '@type': 'ImageObject', url: `${domain}/assets/icon.svg` },
    },
    datePublished: now,
    dateModified: now,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  };

  // Breadcrumb schema
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: domain },
      { '@type': 'ListItem', position: 2, name: 'Rutas', item: `${domain}/#rutas` },
      { '@type': 'ListItem', position: 3, name: title, item: canonical },
    ],
  };

  const streetsList = (metadata?.streets || [])
    .map(
      (s, i) => `
      <li>
        <span class="num">${i + 1}</span>
        <span>${escapeHtml(typeof s === 'string' ? s : s.nombre || '')}</span>
      </li>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${safeTitle} | Rutas Tuxtla Gutiérrez</title>
<meta name="description" content="${safeDesc}">
<meta name="keywords" content="ruta, transporte, Tuxtla Gutiérrez, Chiapas, colectivo, ${safeTitle}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${canonical}">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Rutas Tuxtla Gutiérrez">
<meta property="og:locale" content="es_MX">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${imageUrl}">

<!-- Theme -->
<meta name="theme-color" content="#1e40af">
<link rel="icon" href="${domain}/assets/icon.svg" type="image/svg+xml">

<!-- CSS -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="${domain}/css/styles.css">

<!-- Schema.org -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
</head>
<body class="post-page">

<header class="post-hero">
  <div class="post-badges">
    <span class="badge">🚌 ${escapeHtml(metadata?.tipo || 'ida')}</span>
    <span class="badge">📍 ${escapeHtml(metadata?.empresa || 'Transporte público')}</span>
  </div>
  <h1>${safeTitle}</h1>
  <p>${safeDesc}</p>
</header>

<main class="post-content" itemscope itemtype="https://schema.org/Article">
  <meta itemprop="datePublished" content="${now}">
  <meta itemprop="dateModified" content="${now}">

  ${image ? `<img src="${imageUrl}" alt="${safeTitle}" style="width:100%;border-radius:16px;margin-bottom:24px" itemprop="image">` : ''}

  <div class="post-info-grid">
    ${metadata?.tarifa ? `<div class="post-info-box"><div class="label">💰 Tarifa</div><div class="value">${escapeHtml(metadata.tarifa)}</div></div>` : ''}
    ${metadata?.frecuencia ? `<div class="post-info-box"><div class="label">⏱️ Frecuencia</div><div class="value">${escapeHtml(metadata.frecuencia)}</div></div>` : ''}
    ${metadata?.horario ? `<div class="post-info-box"><div class="label">🕐 Horario</div><div class="value">${escapeHtml(metadata.horario)}</div></div>` : ''}
    ${metadata?.dias ? `<div class="post-info-box"><div class="label">📅 Días</div><div class="value">${escapeHtml(metadata.dias)}</div></div>` : ''}
    ${metadata?.accesible ? `<div class="post-info-box"><div class="label">♿ Accesible</div><div class="value">${escapeHtml(metadata.accesible)}</div></div>` : ''}
  </div>

  <h2>📝 Descripción del recorrido</h2>
  <div itemprop="articleBody">${content || `<p>${safeDesc}</p>`}</div>

  ${streetsList ? `
  <h2>🛣️ Calles por las que pasa</h2>
  <ul class="post-streets">${streetsList}</ul>
  ` : ''}

  ${metadata?.mapPoints && metadata.mapPoints.length >= 2 ? `
  <h2>🗺️ Mapa de la ruta</h2>
  <div id="route-map" class="post-map"></div>
  <script>
    window.__ROUTE_POINTS__ = ${JSON.stringify(metadata.mapPoints)};
    window.__ROUTE_COLOR__ = ${JSON.stringify(metadata.color || '#1e40af')};
    window.__ROUTE_NAME__ = ${JSON.stringify(title)};
  </script>
  ` : ''}

  <div class="post-cta">
    <h3>¿Necesitas buscar esta ruta?</h3>
    <p>Abre la app interactiva para ver el mapa en tiempo real, buscar rutas cercanas y más.</p>
    <a href="${domain}/" class="btn">🚌 Abrir la App</a>
  </div>

  <p style="font-size:13px;color:#64748b;text-align:center;margin-top:40px">
    Publicado el ${dateStr}
  </p>
</main>

<footer class="post-footer">
  <p>© ${new Date().getFullYear()} Rutas Tuxtla Gutiérrez · <a href="${domain}">Inicio</a></p>
</footer>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var pts = window.__ROUTE_POINTS__;
  if(!pts || pts.length < 2) return;
  var el = document.getElementById('route-map');
  if(!el) return;
  var map = L.map('route-map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);
  var coords = pts.map(function(p){ return [p.lat, p.lng]; });
  var line = L.polyline(coords, { color: window.__ROUTE_COLOR__, weight: 5, opacity: .85 }).addTo(map);
  L.marker(coords[0]).addTo(map).bindPopup('<b>Inicio</b>');
  L.marker(coords[coords.length-1]).addTo(map).bindPopup('<b>Fin</b>');
  map.fitBounds(line.getBounds(), { padding: [40, 40] });
})();
</script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   Actualiza sitemap.xml en el repo
   ============================================================ */
async function updateSitemap({ ghApi, ghHeaders, branch, domain, posts }) {
  const now = new Date().toISOString().split('T')[0];

  const urls = [
    `<url><loc>${domain}/</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...posts.map(
      (p) =>
        `<url><loc>${domain}/${p.url}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`
    ),
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  let sitemapSha = null;
  try {
    const res = await fetch(`${ghApi}/sitemap.xml?ref=${branch}`, { headers: ghHeaders });
    if (res.ok) {
      const data = await res.json();
      sitemapSha = data.sha;
    }
  } catch (e) {}

  const payload = {
    message: 'chore(sitemap): actualizar sitemap',
    content: btoa(unescape(encodeURIComponent(sitemap))),
    branch,
  };
  if (sitemapSha) payload.sha = sitemapSha;

  await fetch(`${ghApi}/sitemap.xml`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify(payload),
  });
}
