/* ============================================================

ESTO ES EL CODIGO PARA ENVIAR COMO NOTIFICACIONES LOS COMENTARIOS DE USUARIOS
   /api/notify — Envía push a todos los suscriptores
   POST body: { titulo, mensaje, url, imagen, tipo }
   ============================================================ */

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
    const { titulo, mensaje, url, imagen, icono, tipo, letra1, boton1, letra2, boton2, letra3, boton3 } = body;
     

    if (!titulo || !mensaje) {
      return new Response(JSON.stringify({ error: 'Faltan título o mensaje' }), { status: 400, headers });
    }

    // 🛡️ Rate limit básico: máx 1 notif cada 30s desde el mismo origen
    // (opcional, se puede mejorar con KV)

    // 1️⃣ Leer todos los tokens suscritos desde Firebase RTDB
    const FIREBASE_DB = 'https://aplicacion-2c1c8.firebaseio.com';
    const tokensRes = await fetch(`${FIREBASE_DB}/pushTokens.json`);
    const tokensData = await tokensRes.json();

    if (!tokensData || typeof tokensData !== 'object') {
      return new Response(JSON.stringify({ ok: true, sent: 0, msg: 'Sin suscriptores' }), { headers });
    }

    // Extraer tokens válidos
    const tokens = Object.values(tokensData)
      .map(d => d && d.token)
      .filter(t => typeof t === 'string' && t.length > 50);

    if (!tokens.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers });
    }

    // 2️⃣ Obtener access token de FCM (OAuth 2.0)
    const accessToken = await getFcmAccessToken(env);

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No se pudo obtener access token FCM' }), { status: 500, headers });
    }

    // 3️⃣ Enviar notificación a cada token
    const FCM_URL = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
    let enviados = 0;
    let fallidos = 0;

    // Enviar en paralelo pero con límite (evitar saturar)
    const BATCH_SIZE = 100; // FCM permite hasta 500 por batch, pero usamos 100 para no bloquear

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);

      const promesas = batch.map(token =>
        fetch(FCM_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              token: token,
              data: {
                title: titulo,
                body: mensaje,
                image: imagen || '',
                icon: icono || '',
                url: url || '/Comunidad',
                tipo: tipo || 'comentario',
                timestamp: String(Date.now()),
                letra1: letra1 || '',
                boton1: boton1 || '',
                letra2: letra2 || '',
                boton2: boton2 || '',
                letra3: letra3 || '',
                boton3: boton3 || ''
              },
              webpush: {
                headers: {
                  Urgency: 'high',
                  TTL: '86400'
                },
                fcm_options: {
                  link: url || '/Comunidad'
                }
              },
              android: { priority: 'high' },
              apns: { headers: { 'apns-priority': '10' } }
            }
          })
        })
          .then(r => {
            if (r.ok) enviados++;
            else {
              fallidos++;
              // Si el token expiró, eliminar de Firebase
              if (r.status === 404 || r.status === 410) {
                removeToken(token, FIREBASE_DB);
              }
            }
          })
          .catch(() => { fallidos++; })
      );

      await Promise.all(promesas);
    }

    return new Response(JSON.stringify({
      ok: true,
      total: tokens.length,
      enviados,
      fallidos
    }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Error interno',
      detail: err.message
    }), { status: 500, headers });
  }
}

/* ============================================================
   Obtener access token de FCM via Service Account
   Usa el flow de JWT (RS256) → OAuth 2.0
   ============================================================ */
async function getFcmAccessToken(env) {
  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');

    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      console.error('[FCM] FIREBASE_SERVICE_ACCOUNT no configurado');
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };

    const base64url = (obj) => btoa(JSON.stringify(obj))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const unsigned = `${base64url(header)}.${base64url(payload)}`;

    // Importar la private key
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';
    const pemContents = serviceAccount.private_key
      .replace(pemHeader, '')
      .replace(pemFooter, '')
      .replace(/\s/g, '');

    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(unsigned)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const jwt = `${unsigned}.${signatureB64}`;

    // Intercambiar JWT por access_token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    const tokenJson = await tokenRes.json();
    return tokenJson.access_token || null;

  } catch (e) {
    console.error('[FCM] Error obteniendo access token:', e);
    return null;
  }
}

/* ============================================================
   Eliminar token inválido de Firebase
   ============================================================ */
async function removeToken(token, FIREBASE_DB) {
  try {
    // Leer TODOS los tokens y buscar el que coincida
    // (más lento pero funciona sin índice)
    const res = await fetch(`${FIREBASE_DB}/pushTokens.json`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return;

    for (const [deviceId, info] of Object.entries(data)) {
      if (info && info.token === token) {
        await fetch(`${FIREBASE_DB}/pushTokens/${deviceId}.json`, {
          method: 'DELETE'
        });
        console.log(`[FCM] Token muerto eliminado: ${deviceId}`);
      }
    }
  } catch (e) {
    console.warn('[FCM] Error removiendo token:', e);
  }
}
