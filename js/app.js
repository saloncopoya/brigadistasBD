// js/app.js — Motor principal de la PWA Brigadistas BD
import * as DB from './db.js';
import { publishResource, unpublishResource, uploadToCloudinary } from './publisher.js';

// ═══════════════════════ CONFIG ═══════════════════════
const FIREBASE_URL = 'https://galloslivebadge-default-rtdb.firebaseio.com';
const TUXTLA = [16.7528, -93.1150]; // Centro de Tuxtla Gutiérrez, Chiapas
const DEFAULT_ZOOM = 13;

// ═══════════════════════ ESTADO GLOBAL ═══════════════════════
export const state = {
  routes: [],
  posts: [],
  market: [],
  tab: 'routes',           // routes | posts | market | route-detail | trip-map
  mode: 'rutas',           // rutas | paradas | pois | calles | retornos
  marketCat: 'all',
  marketFilter: '',
  isAdmin: false,
  online: navigator.onLine,
  currentRoute: null,
  historyStack: [],
  tripPoints: [],          // [{lat,lng,label,color,radius}]
  tripResults: [],
  editingRoute: null,
  wizardStep: 1,
  currentPost: null
};

// ═══════════════════════ UTILS ═══════════════════════
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[',.\s]+/g,' ').trim();

function haversine(a, b) {
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(b.lat-a.lat), dLon = toRad(b.lng-a.lng);
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function distToSegment(p, a, b) {
  const dx = b.lng-a.lng, dy = b.lat-a.lat;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return haversine(p, a);
  let t = ((p.lng-a.lng)*dx + (p.lat-a.lat)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return haversine(p, { lat: a.lat + t*dy, lng: a.lng + t*dx });
}
function distToRoute(point, routeCoords) {
  let min = Infinity;
  for (let i = 1; i < routeCoords.length; i++) {
    const d = distToSegment(point, routeCoords[i-1], routeCoords[i]);
    if (d < min) min = d;
  }
  return min;
}

// ═══════════════════════ NAVEGACIÓN / HISTORIAL ═══════════════════════
function buildUrl() {
  if (!state.online) return location.pathname + location.search; // URL fija offline
  const p = new URLSearchParams();
  if (state.tab !== 'routes') p.set('tab', state.tab);
  if (state.mode !== 'rutas') p.set('mode', state.mode);
  if (state.currentRoute) p.set('ruta', state.currentRoute.id);
  if (state.currentPost)  p.set('post', state.currentPost.id);
  const q = p.toString();
  return q ? `?${q}` : location.pathname;
}

function navigateTo(tab, { push = true, mode, route, post } = {}) {
  if (mode !== undefined) state.mode = mode;
  if (route !== undefined) state.currentRoute = route;
  if (post !== undefined) state.currentPost = post;
  state.tab = tab;
  if (push) {
    state.historyStack.push({ tab, mode: state.mode, routeId: route?.id, postId: post?.id });
    if (state.online) history.pushState({ ...state.historyStack.at(-1) }, '', buildUrl());
  }
  render();
}

window.addEventListener('popstate', () => {
  state.historyStack.pop();
  const prev = state.historyStack.at(-1);
  if (prev) {
    state.tab = prev.tab;
    state.mode = prev.mode || 'rutas';
    state.currentRoute = prev.routeId ? state.routes.find(r => r.id === prev.routeId) : null;
    state.currentPost  = prev.postId  ? state.posts.find(p => p.id === prev.postId)   : null;
  } else {
    state.tab = 'routes'; state.mode = 'rutas'; state.currentRoute = null; state.currentPost = null;
  }
  closeAllOverlays();
  render();
});

function applyUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('tab'))  state.tab  = p.get('tab');
  if (p.get('mode')) state.mode = p.get('mode');
  if (p.get('ruta')) state.currentRoute = state.routes.find(r => r.id === p.get('ruta')) || null;
  if (p.get('post')) state.currentPost  = state.posts.find(x => x.id === p.get('post'))  || null;
}

// ═══════════════════════ RENDER ═══════════════════════
function showPage(id) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-' + id)?.classList.add('active');
  // tabs bottom
  $$('nav.bottom-nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === (id === 'route-detail' ? 'routes' : id === 'trip-map' ? 'routes' : id));
  });
}

function render() {
  const tabMap = { routes: 'routes', posts: 'posts', market: 'market', 'route-detail': 'route-detail', 'trip-map': 'trip-map' };
  showPage(tabMap[state.tab] || 'routes');

  if (state.tab === 'routes')      renderRoutesList();
  if (state.tab === 'posts')       renderPosts();
  if (state.tab === 'market')      renderMarket();
  if (state.tab === 'route-detail') renderRouteDetail();
  if (state.tab === 'trip-map')    initTripMap();
}

// ═══════════════════════ LISTA DE RUTAS Y MODOS ═══════════════════════
function renderRoutesList() {
  const wrap = $('#routesList');
  const empty = $('#routesEmpty');
  wrap.innerHTML = '';
  if (!state.routes.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  if (state.mode === 'rutas') {
    wrap.className = 'route-grid';
    state.routes.forEach(r => {
      const card = document.createElement('div');
      card.className = 'route-card';
      card.innerHTML = `
        <div class="bus">🚌</div>
        <div class="name">${esc(r.nombre)}</div>
        <span class="chip ${r.categoria === 'FORANEA' ? 'tag-foranea' : 'tag-urbana'}">${esc(r.categoria||'URBANA')}</span>
        <div class="actions">
          <button data-act="share" title="Compartir">🔗</button>
        </div>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        navigateTo('route-detail', { route: r });
      });
      card.querySelector('[data-act="share"]').addEventListener('click', (e) => {
        e.stopPropagation();
        share(`https://brigadistasbd.pages.dev/share/r/${r.id}`, r.nombre, 'Ruta de colectivo');
      });
      wrap.appendChild(card);
    });
    return;
  }

  // Modos agrupados: paradas, pois, calles, retornos
  wrap.className = '';
  const groups = {};
  const key = state.mode === 'paradas' ? 'paradas'
            : state.mode === 'calles'  ? 'calles'
            : state.mode === 'retornos'? 'retornos'
            : 'pois';
  const poisIda = [], poisReg = [];
  state.routes.forEach(r => {
    const arr = r[key] || [];
    arr.forEach(item => {
      const name = typeof item === 'string' ? item : item.nombre || item.name || '';
      if (!name) return;
      if (!groups[name]) groups[name] = new Set();
      groups[name].add(r.nombre);
      if (state.mode === 'pois') (item.tipo === 'regreso' ? poisReg : poisIda).push(name);
    });
  });
  const entries = Object.entries(groups);
  if (!entries.length) {
    wrap.innerHTML = `<div class="empty"><span class="em">📭</span><p>Sin datos en este modo</p></div>`;
    return;
  }
  entries.forEach(([name, routes]) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<b>${esc(name)}</b><div class="chips">${[...routes].map(rn => `<span class="chip">${esc(rn)}</span>`).join('')}</div>`;
    card.addEventListener('click', () => {
      $('#originInput').value = name;
      navigateTo('routes', { mode: 'rutas', push: false });
    });
    wrap.appendChild(card);
  });
}

// ═══════════════════════ BUSCADOR DUAL ═══════════════════════
function setupSearch() {
  const originIn = $('#originInput'), destIn = $('#destInput');
  const originSg = $('#originSugg'), destSg = $('#destSugg');

  const allPlaces = () => {
    const set = new Set();
    state.routes.forEach(r => {
      ['paradas','pois','calles','retornos'].forEach(k => (r[k]||[]).forEach(it => {
        const n = typeof it === 'string' ? it : (it.nombre || it.name);
        if (n) set.add(n);
      }));
    });
    return [...set];
  };

  function attach(input, sugg) {
    input.addEventListener('input', () => {
      const q = norm(input.value);
      sugg.innerHTML = '';
      if (q.length < 2) { sugg.classList.remove('open'); return; }
      const matches = allPlaces().filter(p => norm(p).includes(q)).slice(0, 8);
      if (!matches.length) { sugg.classList.remove('open'); return; }
      matches.forEach(m => {
        const d = document.createElement('div');
        d.textContent = '📍 ' + m;
        d.addEventListener('click', () => { input.value = m; sugg.classList.remove('open'); });
        sugg.appendChild(d);
      });
      sugg.classList.add('open');
    });
    document.addEventListener('click', e => { if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.classList.remove('open'); });
  }
  attach(originIn, originSg);
  attach(destIn, destSg);

  $('#searchBtn').addEventListener('click', performTripSearch);
  $('#clearBtn').addEventListener('click', () => {
    originIn.value = ''; destIn.value = '';
    $('#searchResults').innerHTML = '';
    navigateTo('routes', { mode: 'rutas', push: false });
  });
  $('#mapTripBtn').addEventListener('click', () => navigateTo('trip-map'));
}

// ═══════════════════════ ALGORITMO DE BÚSQUEDA ═══════════════════════
function findRoutesForPoint(point, radius) {
  const hits = [];
  state.routes.forEach(r => {
    const coords = r.trazadoIda || [];
    if (!coords.length) return;
    const d = distToRoute(point, coords);
    if (d <= radius) hits.push({ ruta: r, dist: d });
  });
  return hits.sort((a,b) => a.dist - b.dist);
}

function performTripSearch() {
  const origin = $('#originInput').value.trim();
  const dest   = $('#destInput').value.trim();
  const out    = $('#searchResults');
  out.innerHTML = '';
  if (!origin || !dest) {
    out.innerHTML = `<div class="empty"><span class="em">✏️</span><p>Escribe origen y destino</p></div>`;
    return;
  }
  const oNorm = norm(origin), dNorm = norm(dest);
  const directas = [], transbordos = [];

  state.routes.forEach(r => {
    const places = [...(r.paradas||[]), ...(r.calles||[]), ...(r.pois||[]), ...(r.retornos||[])]
      .map(x => norm(typeof x === 'string' ? x : x.nombre || x.name));
    const hasO = places.some(p => p.includes(oNorm) || oNorm.includes(p));
    const hasD = places.some(p => p.includes(dNorm) || dNorm.includes(p));
    if (hasO && hasD) directas.push({ ruta: r, exacta: true });
  });

  // Transbordos: dos rutas que comparten una parada y una cubre O, otra cubre D
  if (!directas.length) {
    const routesWithO = state.routes.filter(r => (r.paradas||[]).some(p => norm(p).includes(oNorm)));
    const routesWithD = state.routes.filter(r => (r.paradas||[]).some(p => norm(p).includes(dNorm)));
    routesWithO.forEach(r1 => routesWithD.forEach(r2 => {
      if (r1.id === r2.id) return;
      const shared = (r1.paradas||[]).find(p => (r2.paradas||[]).some(q => norm(q) === norm(p)));
      if (shared) transbordos.push({ r1, r2, punto: shared });
    }));
  }

  let html = '';
  if (!directas.length && !transbordos.length) {
    html = `<div class="empty"><span class="em">🚫</span><p>No se encontraron combinaciones directas.<br>Prueba con nombres más generales.</p></div>`;
  }
  directas.forEach(d => {
    html += `<div class="card"><b>🚌 ${esc(d.ruta.nombre)}</b>
      <span class="chip tag-${d.ruta.categoria === 'FORANEA' ? 'foranea' : 'urbana'}">${esc(d.ruta.categoria||'URBANA')}</span>
      <p class="hint">Ruta directa. <button class="btn-secondary" data-route="${d.ruta.id}" style="padding:6px 10px;font-size:12px">Ver en mapa</button></p>
    </div>`;
  });
  transbordos.forEach(t => {
    html += `<div class="card"><b>🔀 Transbordo</b>
      <p>${esc(t.r1.nombre)} → <b>${esc(t.punto)}</b> → ${esc(t.r2.nombre)}</p>
      <button class="btn-secondary" data-route="${t.r1.id}" style="padding:6px 10px;font-size:12px">Ver 1ª ruta</button>
      <button class="btn-secondary" data-route="${t.r2.id}" style="padding:6px 10px;font-size:12px">Ver 2ª ruta</button>
    </div>`;
  });
  out.innerHTML = html;
  out.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => {
    const r = state.routes.find(x => x.id === b.dataset.route);
    if (r) navigateTo('route-detail', { route: r });
  }));
}

// ═══════════════════════ MAPA DETALLE DE RUTA ═══════════════════════
let detailMap = null, detailLayers = [];

function renderRouteDetail() {
  const r = state.currentRoute;
  const detail = $('#routeDetail');
  if (!r) { detail.innerHTML = '<div class="empty"><span class="em">❓</span><p>Ruta no encontrada</p></div>'; return; }

  detail.innerHTML = `
    <div class="head">
      <h2>${esc(r.nombre)}</h2>
      <span class="chip tag-${r.categoria === 'FORANEA' ? 'foranea' : 'urbana'}">${esc(r.categoria||'URBANA')}</span>
      <button class="icon-btn" id="shareRouteBtn">🔗</button>
    </div>
    <div class="detail-block"><h4>Información</h4>
      <div class="items">
        ${r.tarifa ? `<span>💵 ${esc(r.tarifa)}</span>` : ''}
        ${r.frecuencia ? `<span>⏱️ ${esc(r.frecuencia)}</span>` : ''}
        ${r.horario ? `<span>🕐 ${esc(r.horario)}</span>` : ''}
        ${r.dias ? `<span>📅 ${esc(r.dias)}</span>` : ''}
        ${r.accesibilidad ? `<span>♿ ${esc(r.accesibilidad)}</span>` : ''}
      </div>
    </div>
    <div class="detail-block"><h4>Paradas (${(r.paradas||[]).length})</h4>
      <div class="items">${(r.paradas||[]).map(p => `<span>📍 ${esc(typeof p==='string'?p:p.nombre||'')}</span>`).join('') || '<span>Sin paradas</span>'}</div>
    </div>
    <div class="detail-block"><h4>Calles (${(r.calles||[]).length})</h4>
      <div class="items">${(r.calles||[]).map(c => `<span>🛣️ ${esc(c)}</span>`).join('') || '<span>Sin calles</span>'}</div>
    </div>
    <div class="detail-block"><h4>Retornos (${(r.retornos||[]).length})</h4>
      <div class="items">${(r.retornos||[]).map(x => `<span>↩️ ${esc(typeof x==='string'?x:x.nombre||'')}</span>`).join('') || '<span>Sin retornos</span>'}</div>
    </div>
    <div class="detail-block"><h4>POIs (${(r.pois||[]).length})</h4>
      <div class="items">${(r.pois||[]).map(p => `<span>🏥 ${esc(typeof p==='string'?p:p.nombre||'')}</span>`).join('') || '<span>Sin POIs</span>'}</div>
    </div>`;

  $('#shareRouteBtn').addEventListener('click', () =>
    share(`https://brigadistasbd.pages.dev/share/r/${r.id}`, r.nombre, 'Ruta de colectivo Brigadistas BD'));

  // Mapa
  setTimeout(() => {
    if (!detailMap) {
      detailMap = L.map('map', { zoomControl: true }).setView(TUXTLA, DEFAULT_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
      }).addTo(detailMap);
    }
    detailLayers.forEach(l => detailMap.removeLayer(l));
    detailLayers = [];

    const ida = (r.trazadoIda || []).map(c => [c.lat, c.lng]);
    const vuelta = (r.trazadoVuelta || []).map(c => [c.lat, c.lng]);
    if (ida.length) detailLayers.push(L.polyline(ida, { color: r.colorIda || '#00e5ff', weight: 5, opacity: .9 }).addTo(detailMap));
    if (vuelta.length) detailLayers.push(L.polyline(vuelta, { color: r.colorVuelta || '#a855f7', weight: 5, opacity: .9, dashArray: '6 6' }).addTo(detailMap));
    (r.paradas || []).forEach(p => {
      if (p.lat && p.lng) detailLayers.push(L.circleMarker([p.lat, p.lng], { radius: 6, color: '#22c55e', fillOpacity: 1 }).addTo(detailMap).bindPopup(esc(p.nombre || 'Parada')));
    });
    if (ida.length) detailMap.fitBounds(ida, { padding: [30,30] });
    else detailMap.setView(TUXTLA, DEFAULT_ZOOM);
    setTimeout(() => detailMap.invalidateSize(), 200);
  }, 60);
}

// ═══════════════════════ MAPA BUSCAR VIAJE ═══════════════════════
let tripMap = null, tripLayerGroup = null;

function initTripMap() {
  setTimeout(() => {
    if (!tripMap) {
      tripMap = L.map('tripMap').setView(TUXTLA, DEFAULT_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(tripMap);
      tripLayerGroup = L.layerGroup().addTo(tripMap);
      tripMap.on('click', (e) => addTripPoint(e.latlng.lat, e.latlng.lng));
    }
    setTimeout(() => tripMap.invalidateSize(), 200);
    drawTripPoints();
  }, 60);
}

const POINT_COLORS = ['#22c55e','#ef4444','#facc15','#00e5ff','#a855f7','#f97316','#ec4899','#14b8a6'];
const POINT_LETTERS = ['A','B','C','D','E','F','G','H'];

function addTripPoint(lat, lng) {
  if (state.tripPoints.length >= 8) return;
  const i = state.tripPoints.length;
  state.tripPoints.push({ lat, lng, label: POINT_LETTERS[i], color: POINT_COLORS[i], radius: +$('#radiusSlider').value });
  drawTripPoints();
  runTripMapSearch();
}

function drawTripPoints() {
  if (!tripLayerGroup) return;
  tripLayerGroup.clearLayers();
  state.tripPoints.forEach((p, i) => {
    L.circle([p.lat, p.lng], { radius: p.radius, color: p.color, fillColor: p.color, fillOpacity: .12, weight: 2 }).addTo(tripLayerGroup);
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: `<div style="background:${p.color};color:#fff;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:800;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)">${p.label}</div>`, iconSize: [32,32], iconAnchor: [16,16] })
    }).addTo(tripLayerGroup);
  });
}

function runTripMapSearch() {
  const results = $('#tripResults');
  if (!state.tripPoints.length) { results.innerHTML = ''; return; }
  const points = state.tripPoints;
  const hits = [];
  state.routes.forEach(r => {
    const coords = r.trazadoIda || [];
    if (!coords.length) return;
    const allTouch = points.every(p => distToRoute(p, coords) <= p.radius);
    if (allTouch) {
      hits.push({ ruta: r, tipo: points.length === 1 ? 'ruta' : 'directa', points });
    }
  });

  // Si hay ≥2 puntos y no hay directas, buscar transbordos
  if (points.length >= 2 && !hits.length) {
    for (let i = 0; i < points.length - 1; i++) {
      const A = points[i], B = points[i+1];
      const routesA = state.routes.filter(r => (r.trazadoIda||[]).length && distToRoute(A, r.trazadoIda) <= A.radius);
      const routesB = state.routes.filter(r => (r.trazadoIda||[]).length && distToRoute(B, r.trazadoIda) <= B.radius);
      routesA.forEach(r1 => routesB.forEach(r2 => {
        if (r1.id === r2.id) return;
        // Buscar punto de transbordo: punto medio más cercano entre ambas rutas
        let best = null, bestD = Infinity;
        r1.trazadoIda.forEach(c1 => r2.trazadoIda.forEach(c2 => {
          const d = haversine(c1, c2);
          if (d < bestD && d < 300) { bestD = d; best = { lat: (c1.lat+c2.lat)/2, lng: (c1.lng+c2.lng)/2 }; }
        }));
        if (best) hits.push({ ruta: r1, ruta2: r2, tipo: 'transbordo', punto: best });
      }));
    }
  }

  if (!hits.length) {
    results.innerHTML = `<div class="empty"><span class="em">🎯</span><p>Sin resultados. Aumenta el radio o mueve los puntos.</p></div>`;
    return;
  }
  results.innerHTML = hits.map((h, i) => `
    <div class="card">
      <b>${h.tipo === 'transbordo' ? '🔀 Transbordo' : h.tipo === 'ruta' ? '🚌 Ruta' : '✅ Directa'}</b>
      <p>${esc(h.ruta.nombre)}${h.ruta2 ? ` → ${esc(h.ruta2.nombre)}` : ''}</p>
      ${h.punto ? `<p class="hint">Transbordo en ${h.punto.lat.toFixed(4)}, ${h.punto.lng.toFixed(4)}</p>` : ''}
      <button class="btn-secondary" data-trip-route="${h.ruta.id}" style="padding:6px 10px;font-size:12px;margin-top:6px">Ver en mapa</button>
    </div>`).join('');

  results.querySelectorAll('[data-trip-route]').forEach(b => b.addEventListener('click', () => {
    const r = state.routes.find(x => x.id === b.dataset.tripRoute);
    if (r) navigateTo('route-detail', { route: r });
  }));

  // Dibujar rutas encontradas
  if (tripLayerGroup && hits.length) {
    hits.slice(0, 5).forEach((h, i) => {
      const coords = (h.ruta.trazadoIda || []).map(c => [c.lat, c.lng]);
      if (coords.length) L.polyline(coords, { color: POINT_COLORS[i % POINT_COLORS.length], weight: 4, dashArray: '4 6' }).addTo(tripLayerGroup);
      if (h.punto) L.circleMarker([h.punto.lat, h.punto.lng], { radius: 8, color: '#facc15', fillColor: '#facc15', fillOpacity: 1 }).addTo(tripLayerGroup);
    });
  }
}

// ═══════════════════════ POSTS (INICIO) ═══════════════════════
function renderPosts() {
  const feed = $('#postsFeed');
  const empty = $('#postsEmpty');
  feed.innerHTML = '';
  if (!state.posts.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  // Si hay un post abierto por URL, mostrar solo ese
  const list = state.currentPost ? [state.currentPost] : state.posts;

  if (state.currentPost) {
    feed.innerHTML = `<button class="btn-secondary" id="backToFeed" style="margin-bottom:10px">← Ver todas las publicaciones</button>`;
    feed.querySelector('#backToFeed').addEventListener('click', () => navigateTo('posts', { post: null }));
  }

  list.forEach(p => feed.appendChild(renderPostCard(p)));
}

function renderPostCard(p) {
  const card = document.createElement('div');
  card.className = 'post';
  const likes = (p.likedBy || []).length;
  const liked = (p.likedBy || []).includes('me');
  const media = p.image
    ? (p.image.match(/\.(mp4|webm)$/i)
        ? `<video class="media" src="${esc(p.image)}" controls preload="metadata"></video>`
        : `<img class="media" src="${esc(p.image)}" alt="${esc(p.title||'')}" loading="lazy"/>`)
    : '';
  card.innerHTML = `
    <div class="head">
      <div class="avatar">B</div>
      <div class="meta">
        <b>Brigadistas BD</b>
        <small>${p.ts ? new Date(p.ts).toLocaleString('es-MX') : ''}</small>
      </div>
      ${state.isAdmin ? `<button class="icon-btn" data-del title="Eliminar">🗑️</button>` : ''}
    </div>
    ${p.title ? `<div style="padding:0 14px 6px;font-weight:700;font-size:15px">${esc(p.title)}</div>` : ''}
    ${p.content ? `<div class="body">${esc(p.content)}</div>` : ''}
    ${media}
    <div class="foot">
      <button class="like ${liked ? 'liked' : ''}">${liked ? '❤️' : '🤍'} ${likes}</button>
      <button class="comm">💬 ${(p.comments || []).length}</button>
      <button class="share">🔗 Compartir</button>
    </div>`;

  card.querySelector('.like').addEventListener('click', (e) => {
    p.likedBy = p.likedBy || [];
    const i = p.likedBy.indexOf('me');
    if (i >= 0) p.likedBy.splice(i, 1); else p.likedBy.push('me');
    DB.savePost(p);
    e.currentTarget.classList.add('heart-pop');
    setTimeout(() => renderPosts(), 220);
  });
  card.querySelector('.comm').addEventListener('click', () => openComments(p));
  card.querySelector('.share').addEventListener('click', () =>
    share(`https://brigadistasbd.pages.dev/share/p/${p.id}`, p.title || 'Publicación', p.content || ''));
  const mediaEl = card.querySelector('.media');
  if (mediaEl) mediaEl.addEventListener('click', () => openViewer(mediaEl.outerHTML));
  card.querySelector('[data-del]')?.addEventListener('click', async () => {
    const c = await Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true, confirmText: 'Eliminar', confirmButtonColor: '#ef4444' });
    if (c.isConfirmed) {
      await DB.deletePost(p.id);
      state.posts = state.posts.filter(x => x.id !== p.id);
      try { await unpublishResource('p', p.id, prompt('Contraseña admin:') || ''); } catch(_) {}
      render();
    }
  });
  return card;
}

// ═══════════════════════ COMENTARIOS ═══════════════════════
function openComments(post) {
  state.currentPost = post;
  const modal = $('#commentsModal');
  $('#commentsCount').textContent = (post.comments || []).length;
  const list = $('#commentsList');
  list.innerHTML = (post.comments || []).map((c, i) => `
    <div class="comment">
      <div class="av">👤</div>
      <div class="txt">
        ${esc(c.text || c)}
        <div class="ops">
          <button data-e="${i}">Editar</button>
          <button data-d="${i}">Eliminar</button>
        </div>
      </div>
    </div>`).join('') || '<p class="hint">Sin comentarios. Sé el primero.</p>';

  list.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', async () => {
    post.comments.splice(+b.dataset.d, 1);
    await DB.savePost(post);
    openComments(post);
  }));
  list.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', async () => {
    const cur = post.comments[+b.dataset.e];
    const { value } = await Swal.fire({ input: 'text', inputValue: cur.text || cur, showCancelButton: true });
    if (value) { post.comments[+b.dataset.e] = { text: value, ts: Date.now() }; await DB.savePost(post); openComments(post); }
  }));

  modal.classList.add('open');
  if (state.online) history.pushState({ ...state.historyStack.at(-1), modal: 'comments' }, '', location.href);
}

$('#commentSend').addEventListener('click', async () => {
  const val = $('#commentInput').value.trim();
  if (!val || !state.currentPost) return;
  state.currentPost.comments = state.currentPost.comments || [];
  state.currentPost.comments.push({ text: val, ts: Date.now() });
  await DB.savePost(state.currentPost);
  $('#commentInput').value = '';
  openComments(state.currentPost);
});

// ═══════════════════════ MARKETPLACE ═══════════════════════
function renderMarket() {
  const grid = $('#marketGrid');
  const empty = $('#marketEmpty');
  grid.innerHTML = '';
  const q = norm(state.marketFilter);
  const list = state.market.filter(m =>
    (state.marketCat === 'all' || m.categoria === state.marketCat) &&
    (!q || norm(m.title).includes(q) || norm(m.desc).includes(q))
  );
  if (!list.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  list.forEach(m => {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.innerHTML = `
      ${m.image ? `<img class="img" src="${esc(m.image)}" alt="${esc(m.title)}" loading="lazy"/>`
                : `<div class="placeholder">🖼️</div>`}
      <div class="info">
        <span class="chip">${esc(m.categoria)}</span>
        <div class="title">${esc(m.title)}</div>
        <div class="price">${esc(m.price || 'A convenir')}</div>
        <div class="desc">${esc(m.desc || '')}</div>
        <div class="actions">
          <button class="wa">WhatsApp</button>
          <button class="share">🔗</button>
        </div>
      </div>`;
    card.querySelector('.wa').addEventListener('click', () => {
      const msg = encodeURIComponent(`Hola, me interesa: ${m.title} - https://brigadistasbd.pages.dev/share/m/${m.id}`);
      window.open(`https://wa.me/${(m.phone||'').replace(/\D/g,'')}?text=${msg}`, '_blank');
    });
    card.querySelector('.share').addEventListener('click', () =>
      share(`https://brigadistasbd.pages.dev/share/m/${m.id}`, m.title, m.desc || 'Marketplace'));
    card.querySelector('.img')?.addEventListener('click', () => openViewer(`<img src="${esc(m.image)}"/>`));
    grid.appendChild(card);
  });
}

// ═══════════════════════ COMPARTIR ═══════════════════════
async function share(url, title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch(_) {}
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(title + '\n' + text + '\n' + url)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const { isConfirmed } = await Swal.fire({
    title: 'Compartir', icon: 'info', showCancelButton: true,
    confirmButtonText: 'WhatsApp', cancelButtonText: 'Facebook',
    showDenyButton: true, denyButtonText: 'Copiar enlace'
  }).then(r => ({ isConfirmed: r.isConfirmed }));
  if (isConfirmed) window.open(wa, '_blank');
}

// ═══════════════════════ VISOR FULLSCREEN ═══════════════════════
function openViewer(html) {
  $('#viewerContent').innerHTML = html;
  $('#viewer').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (state.online) history.pushState({ ...state.historyStack.at(-1), modal: 'viewer' }, '', location.href);
}
$('#viewerClose').addEventListener('click', () => {
  $('#viewer').classList.remove('open');
  $('#viewerContent').innerHTML = '';
  document.body.style.overflow = '';
});
$('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') $('#viewerClose').click(); });

function closeAllOverlays() {
  $('#commentsModal').classList.remove('open');
  $('#viewer').classList.remove('open');
  $('#viewerContent').innerHTML = '';
  document.body.style.overflow = '';
}

// ═══════════════════════ TEMA ═══════════════════════
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('tgz_theme', t);
  $('#themeBtn').textContent = t === 'light' ? '☀️' : '🌙';
}
$('#themeBtn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

// ═══════════════════════ NAV INFERIOR ═══════════════════════
$$('nav.bottom-nav button').forEach(b => b.addEventListener('click', () => {
  state.currentPost = null;
  navigateTo(b.dataset.tab);
}));

// ═══════════════════════ CHIPS ═══════════════════════
$$('#modeChips .chip').forEach(c => c.addEventListener('click', () => {
  $$('#modeChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.mode = c.dataset.mode;
  renderRoutesList();
}));
$$('#marketCats .chip').forEach(c => c.addEventListener('click', () => {
  $$('#marketCats .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.marketCat = c.dataset.cat;
  renderMarket();
}));
$('#marketSearch').addEventListener('input', e => { state.marketFilter = e.target.value; renderMarket(); });

// ═══════════════════════ BUSCAR VIAJE POR MAPA ═══════════════════════
$('#backFromTrip').addEventListener('click', () => navigateTo('routes'));
$('#backFromRoute').addEventListener('click', () => navigateTo('routes'));
$('#tripClearBtn').addEventListener('click', () => { state.tripPoints = []; drawTripPoints(); $('#tripResults').innerHTML = ''; });
$('#tripLocBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('GPS no disponible');
  navigator.geolocation.getCurrentPosition(pos => {
    addTripPoint(pos.coords.latitude, pos.coords.longitude);
    tripMap?.setView([pos.coords.latitude, pos.coords.longitude], 15);
  });
});
$('#radiusSlider').addEventListener('input', e => {
  $('#radiusVal').textContent = e.target.value;
  state.tripPoints.forEach(p => p.radius = +e.target.value);
  drawTripPoints();
});
$('#tripSearchBtn').addEventListener('click', runTripMapSearch);

// ═══════════════════════ FULLSCREEN MAPA ═══════════════════════
$('#mapFullBtn').addEventListener('click', () => {
  const el = $('#map');
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.();
});
$('#myLocBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    detailMap?.setView([pos.coords.latitude, pos.coords.longitude], 16);
    L.circleMarker([pos.coords.latitude, pos.coords.longitude], { radius: 8, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 1 }).addTo(detailMap);
  });
});

// ═══════════════════════ INSTALACIÓN PWA ═══════════════════════
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').style.display = 'grid';
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBtn').style.display = 'none';
});

// ═══════════════════════ CONEXIÓN ═══════════════════════
function updateOnline() {
  state.online = navigator.onLine;
  $('#offlineBadge').classList.toggle('show', !state.online);
  if (state.online) syncFromFirebase();
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

// ═══════════════════════ FIREBASE (sync) ═══════════════════════
async function syncFromFirebase() {
  try {
    const [rR, rP, rM] = await Promise.all([
      fetch(`${FIREBASE_URL}/rutas_colectivos_tgz.json`).then(r => r.json()),
      fetch(`${FIREBASE_URL}/publicaciones.json`).then(r => r.json()),
      fetch(`${FIREBASE_URL}/marketplace.json`).then(r => r.json())
    ]);
    if (rR) { state.routes = Object.values(rR); for (const r of state.routes) await DB.saveRoute(r); }
    if (rP) { state.posts  = Object.values(rP).sort((a,b) => (b.ts||0)-(a.ts||0)); for (const p of state.posts) await DB.savePost(p); }
    if (rM) { state.market = Object.values(rM); for (const m of state.market) await DB.saveMarket(m); }
    render();
  } catch (e) { console.warn('Firebase sync:', e.message); }
}

// ═══════════════════════ ARRANQUE ═══════════════════════
async function bootstrap() {
  applyTheme(localStorage.getItem('tgz_theme') || 'dark');
  updateOnline();

  // Cargar desde IndexedDB primero (rápido y offline)
  state.routes = await DB.getRoutes();
  state.posts  = await DB.getPosts();
  state.market = await DB.getMarket();

  applyUrl();
  setupSearch();

  // Sembrar datos demo si está vacío (útil en primer arranque)
  if (!state.routes.length && navigator.onLine) {
    try {
      const demo = await fetch('/share/posts-index.json').then(r => r.json()).catch(() => null);
      // No forzamos nada aquí; puedes dejarlo vacío
    } catch(_) {}
  }

  render();
  if (state.online) syncFromFirebase();

  // Esperar a que carguen las rutas antes de re-aplicar URL
  setTimeout(() => { applyUrl(); render(); }, 400);
}

bootstrap();
