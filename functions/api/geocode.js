/* ==========================================================================
   GEOCODE.JS — Proxy para Nominatim (OpenStreetMap)
   Cumple con la política de uso:
   - Envía User-Agent válido que identifica la aplicación
   - Cachea resultados en el edge de Cloudflare por 24 horas
   - Respeta el límite de 1 req/segundo de Nominatim
   ========================================================================== */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');

  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: 'Faltan parámetros lat/lon' }), { 
      status: 400, 
      headers 
    });
  }

  // Validar que sean números
  if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
    return new Response(JSON.stringify({ error: 'lat/lon inválidos' }), { 
      status: 400, 
      headers 
    });
  }

  // 🔍 Cache key único por coordenada (redondeado a 5 decimales ≈ 1 metro)
  const cacheKey = `geo:${parseFloat(lat).toFixed(5)}:${parseFloat(lon).toFixed(5)}`;
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `/__geocode_cache/${cacheKey}`;

  // 1️⃣ Intentar desde la caché de Cloudflare
  const cache = caches.default;
  const cached = await cache.match(cacheUrl.toString());
  if (cached) {
    return cached;
  }

  // 2️⃣ Si no está en caché, consultar Nominatim
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`;

    const res = await fetch(nominatimUrl, {
      headers: {
        // ✅ User-Agent válido que identifica la app (requisito de Nominatim)
        'User-Agent': 'RutasBGD/1.0 (https://brigadistasbd.pages.dev; contacto@brigadistasbd.pages.dev)',
        'Accept': 'application/json',
        'Accept-Language': 'es-MX,es;q=0.9'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ 
        error: 'Nominatim error',
        status: res.status 
      }), { status: res.status, headers });
    }

    const data = await res.json();

    // 3️⃣ Crear la respuesta con caché de 24 horas
    const response = new Response(JSON.stringify(data), {
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    });

    // 4️⃣ Guardar en caché del edge
    // (usamos waitUntil para no bloquear la respuesta)
    context.waitUntil(cache.put(cacheUrl.toString(), response.clone()));

    return response;

  } catch (err) {
    return new Response(JSON.stringify({ 
      error: 'Error interno',
      detail: err.message 
    }), { status: 500, headers });
  }
}
