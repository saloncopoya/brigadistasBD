/* ============================================================
   /api/notify — Envía push a todos O a un usuario específico
   POST body: { 
     titulo, mensaje, url, imagen, tipo,
     destinatario: 'todos' | 'individual',  // ← NUEVO
     token: 'xxx'                            // ← NUEVO (si es individual)
   }
   ============================================================ */

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    const { titulo, mensaje, url, imagen, tipo, destinatario, token: tokenDirecto } = body;

    if (!titulo || !mensaje) {
      return new Response(JSON.stringify({ error: 'Faltan título o mensaje' }), { status: 400, headers });
    }

    // 🔑 Obtener access token de FCM
    const accessToken = await getFcmAccessToken(env);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No se pudo obtener access token FCM' }), { status: 500, headers });
    }

    const FIREBASE_DB = 'https://aplicacion-2c1c8.firebaseio.com';
    const FCM_URL = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

    // ============================================================
    // 🎯 MODO INDIVIDUAL: enviar solo a un token específico
    // ============================================================
    if (destinatario === 'individual' && tokenDirecto) {
      console.log('[notify] Modo INDIVIDUAL — enviando a 1 token');
      
      try {
        const res = await fetch(FCM_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              token: tokenDirecto,
              data: {
                title: titulo,
                body: mensaje,
                image: imagen || '',
                url: url || '/Comunidad',
                tipo: tipo || 'respuesta',
                timestamp: String(Date.now())
              },
              webpush: {
                headers: { Urgency: 'high', TTL: '86400' },
                fcm_options: { link: url || '/Comunidad' }
              },
              android: { priority: 'high' },
              apns: { headers: { 'apns-priority': '10' } }
            }
          })
        });

        if (res.ok) {
          return new Response(JSON.stringify({ 
            ok: true, 
            modo: 'individual',
            enviados: 1 
          }), { headers });
        } else {
          const err = await res.text();
          // Token inválido → eliminar de Firebase
          if (res.status === 404 || res.status === 410) {
            await removeToken(tokenDirecto, FIREBASE_DB);
          }
          return new Response(JSON.stringify({ 
            error: 'FCM error', 
            status: res.status,
            detail: err 
          }), { status: 500, headers });
        }
      } catch (e) {
        return new Response(JSON.stringify({ 
          error: 'Error enviando a token individual',
          detail: e.message 
        }), { status: 500, headers });
      }
    }

    // ============================================================
    // 🌍 MODO GLOBAL: enviar a TODOS los suscriptores
    // ============================================================
    console.log('[notify] Modo GLOBAL — enviando a todos');
    
    const tokensRes = await fetch(`${FIREBASE_DB}/pushTokens.json`);
    const tokensData = await tokensRes.json();

    if (!tokensData || typeof tokensData !== 'object') {
      return new Response(JSON.stringify({ ok: true, sent: 0, msg: 'Sin suscriptores' }), { headers });
    }

    const tokens = Object.values(tokensData)
      .map(d => d && d.token)
      .filter(t => typeof t === 'string' && t.length > 50);

    if (!tokens.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers });
    }

    let enviados = 0;
    let fallidos = 0;
    const BATCH_SIZE = 100;

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
                url: url || '/Comunidad',
                tipo: tipo || 'comentario',
                timestamp: String(Date.now())
              },
              webpush: {
                headers: { Urgency: 'high', TTL: '86400' },
                fcm_options: { link: url || '/Comunidad' }
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
      modo: 'global',
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

    const pemContents = serviceAccount.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
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
    const res = await fetch(`${FIREBASE_DB}/pushTokens.json`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return;

    for (const [deviceId, info] of Object.entries(data)) {
      if (info && info.token === token) {
        await fetch(`${FIREBASE_DB}/pushTokens/${deviceId}.json`, { method: 'DELETE' });
        console.log(`[FCM] Token muerto eliminado: ${deviceId}`);
      }
    }
  } catch (e) {
    console.warn('[FCM] Error removiendo token:', e);
  }
}
