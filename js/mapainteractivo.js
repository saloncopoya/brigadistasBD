/* ==========================================================================
   MAPAINTERACTIVO.JS — Lógica exclusiva de la página /mapainteractivo
   Funcionalidad idéntica a la pestaña "Buscar viaje en mapa" de index.html
   ========================================================================== */
(function(global) {
  'use strict';

  // ==================== CONFIGURACIÓN ====================
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAiojpfnGUPhaoQkpAh1Yey3fp6uWU-iFQ",
    authDomain: "aplicacion-2c1c8.firebaseapp.com",
    databaseURL: "https://aplicacion-2c1c8.firebaseio.com",
    projectId: "aplicacion-2c1c8",
    storageBucket: "aplicacion-2c1c8.firebasestorage.app",
    messagingSenderId: "837629411067",
    appId: "1:837629411067:web:6c96cfcd7490b049787a5e",
    measurementId: "G-SFP1SEY20W"
  };
  const DEFAULT_CENTER = [16.7530, -93.1150];
  const DEFAULT_ZOOM = 13;

  // ==================== UTILIDADES ====================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }));
  const norm = s => String(s || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[',.\s]+/g, ' ').trim();

  function toast(msg, type = 'ok') {
    const w = $('#toastWrap');
    if (!w) return;
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    const icon = type === 'ok'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    t.innerHTML = icon + '<span>' + esc(msg) + '</span>';
    w.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
      t.style.transition = 'all .3s';
      setTimeout(() => t.remove(), 300);
    }, 2800);
  }

  // ==================== HELPER DE MAPAS ====================
  const registeredMaps = new Set();
  function registerMap(mapInstance) {
    if (!mapInstance || registeredMaps.has(mapInstance)) return;
    registeredMaps.add(mapInstance);
    const container = mapInstance.getContainer();
    if (!container) return;
    const fix = () => {
      requestAnimationFrame(() => {
        try { mapInstance.invalidateSize({ pan: false, animate: false }); } catch (e) {}
      });
    };
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(fix);
      ro.observe(container);
      mapInstance.__ro = ro;
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting && e.intersectionRatio > 0) fix(); });
      }, { threshold: [0, 0.01, 0.1] });
      io.observe(container);
      mapInstance.__io = io;
    }
    const modalObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const el = m.target;
          if (el.classList && el.classList.contains('open')) fix();
        }
      }
    });
    document.querySelectorAll('.modal').forEach(el => {
      modalObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    mapInstance.__mo = modalObserver;
    if (!mapInstance.__visHandler) {
      mapInstance.__visHandler = () => { if (!document.hidden) fix(); };
      document.addEventListener('visibilitychange', mapInstance.__visHandler, { passive: true });
    }
    if (!mapInstance.__winHandler) {
      mapInstance.__winHandler = () => fix();
      window.addEventListener('resize', mapInstance.__winHandler, { passive: true });
    }
    fix();
  }

  // ==================== ESTADO ====================
  const state = {
    tripMap: null,
    tripPoints: [],
    tripMarkers: [],
    tripCircles: [],
    tripRadius: 300,
    userReactivated: false,
    routes: [],
    fbDB: null
  };

  // ==================== FIREBASE ====================
  let fbDB = null;
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      fbDB = firebase.database();
      state.fbDB = fbDB;
    }
  } catch (e) { console.warn('[Firebase] No inicializado:', e); }

  // ==================== TEMA ====================
  const savedTheme = localStorage.getItem('tgz_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  function updateThemeIcon() {
    const t = document.documentElement.getAttribute('data-theme');
    const icon = $('#themeIcon');
    if (!icon) return;
    icon.innerHTML = t === 'dark'
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
  updateThemeIcon();
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tgz_theme', next);
    updateThemeIcon();
    if (state.tripMap) {
      state.tripMap.eachLayer(l => { if (l instanceof L.TileLayer) l.redraw(); });
    }
  };

  // ==================== CARGA DE RUTAS ====================
  async function loadRoutes() {
    let local = [];
    try { local = await DB.getAll('routes'); } catch (e) {}
    state.routes = local.sort((a, b) =>
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true, sensitivity: 'base' })
    );
    // Firebase en background
    if (navigator.onLine && fbDB) {
      (async () => {
        try {
          const snap = await fbDB.ref('rutas_colectivos_tgz').once('value');
          const val = snap.val() || {};
          const map = new Map(state.routes.map(r => [r.id, r]));
          Object.values(val).forEach(r => {
            if (r && r.id && !map.has(r.id)) map.set(r.id, r);
          });
          state.routes = Array.from(map.values()).sort((a, b) =>
            String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true, sensitivity: 'base' })
          );
          if (state.tripPoints.length) performTripSearch();
        } catch (e) {}
      })();
    }
    return state.routes;
  }

  // ==================== INICIALIZAR MAPA ====================
  function initTripMap() {
    if (state.tripMap) { state.tripMap.invalidateSize(); return; }
    const el = document.getElementById('tripMap');
    if (!el) return;
    state.tripMap = L.map(el, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    registerMap(state.tripMap);

    // Botón pantalla completa
    const fsBtn = document.getElementById('tripMapFsBtn');
    const wrap = document.getElementById('tripMapWrap');
    if (fsBtn && wrap) {
      const HTML_ENTER = fsBtn.innerHTML;
      const HTML_EXIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 3v3a2 2 0 0 1-2 2H4"/><path d="M21 9h-3a2 2 0 0 0-2 2v3"/><path d="M3 15h3a2 2 0 0 1 2 2v3"/><path d="M15 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
      fsBtn.onclick = () => {
        const isFs = wrap.classList.toggle('is-fullscreen');
        document.body.classList.toggle('fs-active', isFs);
        fsBtn.innerHTML = isFs ? HTML_EXIT : HTML_ENTER;
        setTimeout(() => state.tripMap && state.tripMap.invalidateSize(), 250);
      };
    }

    L.tileLayer.offline('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap'
    }).addTo(state.tripMap);

    state.tripMap.on('click', e => {
      const activeBtn = document.querySelector('#tripToolbar .tb.active');
      const mode = activeBtn ? activeBtn.dataset.tool : 'addpoint';
      if (mode !== 'addpoint') return;
      if (state.tripPoints.length >= 5) { toast('Máximo 5 puntos', 'err'); return; }
      if (state.tripPoints.length >= 2 && !state.userReactivated) {
        const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
        if (addBtn) addBtn.classList.remove('active');
        toast('Máx. 2 puntos. Pulsa +Agregar para añadir más.');
        return;
      }
      addTripPoint(e.latlng.lat, e.latlng.lng);
      if (state.tripPoints.length >= 2) {
        state.userReactivated = false;
        const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
        if (addBtn) addBtn.classList.remove('active');
      }
    });
  }

  // ==================== PUNTOS DEL VIAJE ====================
  const TRIP_DEFAULT_NAMES = ['ESTOY AQUÍ', 'LLEGARÉ AQUÍ', 'PASO POR', 'DESVÍO A', 'DESTINO'];

  function addTripPoint(lat, lng) {
    const idx = state.tripPoints.length;
    const letter = String.fromCharCode(65 + idx);
    const color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
    const name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + letter);
    state.tripPoints.push({ lat, lng, letter, color, radius: state.tripRadius, name });

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-${letter.toLowerCase()}" style="background:${color}">${letter}</div>`,
      iconSize: [26, 26], iconAnchor: [13, 13]
    });
    const marker = L.marker([lat, lng], { icon }).addTo(state.tripMap);
    const circle = L.circle([lat, lng], { radius: state.tripRadius, color, fillColor: color, fillOpacity: 0.1, weight: 1.5 }).addTo(state.tripMap);
    state.tripMarkers.push(marker);
    state.tripCircles.push(circle);

    // Scroll automático al primer punto
    if (state.tripPoints.length === 1) {
      const mapWrap = document.querySelector('#tripMapWrap');
      if (mapWrap) {
        setTimeout(() => {
          const headerH = 58;
          const rect = mapWrap.getBoundingClientRect();
          const targetY = window.scrollY + rect.top - headerH - 8;
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }, 100);
      }
    }

    renderTripPointsList();
    performTripSearch();
  }

  function renderTripPointsList() {
    const el = $('#tripPointsList');
    if (!el) return;
    if (!state.tripPoints.length) {
      el.innerHTML = '<div class="empty-trip">Toca el mapa para agregar ubicaciones y ver las rutas cercanas.</div>';
      return;
    }
    el.innerHTML = state.tripPoints.map((p, i) => `
      <div class="trip-point-card">
        <div class="tpc-letter" style="background:${p.color}">${p.letter}</div>
        <span class="tpc-coords">${esc(p.name || ('Punto ' + p.letter))}</span>
        <div class="tpc-actions">
          <button data-trip-del="${i}" title="Eliminar">✕</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('[data-trip-del]').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.tripDel;
        state.tripMap.removeLayer(state.tripMarkers[i]);
        state.tripMap.removeLayer(state.tripCircles[i]);
        state.tripMarkers.splice(i, 1);
        state.tripCircles.splice(i, 1);
        state.tripPoints.splice(i, 1);
        state.tripPoints.forEach((p, idx) => {
          p.letter = String.fromCharCode(65 + idx);
          p.color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
          const isDefault = TRIP_DEFAULT_NAMES.includes(p.name) || /^PUNTO [A-E]$/.test(p.name);
          if (isDefault) p.name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + p.letter);
        });
        state.tripMarkers.forEach((m, idx) => {
          const pt = state.tripPoints[idx];
          if (!pt) return;
          const icon = L.divIcon({
            className: '',
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color}">${pt.letter}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          });
          m.setIcon(icon);
        });
        renderTripPointsList();
        performTripSearch();
        state.userReactivated = false;
        if (state.tripPoints.length <= 1) {
          const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
          if (addBtn && !addBtn.classList.contains('active')) {
            $$('#tripToolbar .tb').forEach(x => x.classList.remove('active'));
            addBtn.classList.add('active');
          }
        }
      };
    });
  }

  // ==================== UTILIDADES GEO ====================
  function pointToSegmentDistance(p, a, b) {
    const [px, py] = p, [ax, ay] = a, [bx, by] = b;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getRouteAllSegments(route) {
    const segments = [];
    const ida = (route.geometriaIda && route.geometriaIda.length > 1) ? route.geometriaIda : (route.puntos || []);
    const vuelta = (route.geometriaVuelta && route.geometriaVuelta.length > 1) ? route.geometriaVuelta : (route.puntosVuelta || []);
    if (ida.length > 1) segments.push(ida);
    if (vuelta.length > 1) segments.push(vuelta);
    return segments;
  }

  function routeDistanceToPoint(route, lat, lng) {
    const segments = getRouteAllSegments(route);
    if (!segments.length) return Infinity;
    let min = Infinity;
    for (const pts of segments) {
      for (let i = 0; i < pts.length - 1; i++) {
        const midLat = (pts[i][0] + pts[i + 1][0]) / 2;
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
        const seg = [
          [pts[i][0] * metersPerDegLat, pts[i][1] * metersPerDegLng],
          [pts[i + 1][0] * metersPerDegLat, pts[i + 1][1] * metersPerDegLng]
        ];
        const p = [lat * metersPerDegLat, lng * metersPerDegLng];
        const dMeters = pointToSegmentDistance(p, seg[0], seg[1]);
        if (dMeters < min) min = dMeters;
      }
    }
    return min;
  }

  // ==================== MOTOR DE BÚSQUEDA ====================
  const TRIP_COLORS = ['#00e5ff','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#84cc16','#f97316','#14b8a6','#8b5cf6','#eab308'];
  let tripRouteLayers = [];

  function clearTripRouteLayers() {
    tripRouteLayers.forEach(l => { try { state.tripMap.removeLayer(l); } catch(e){} });
    tripRouteLayers = [];
  }

  function getRouteCoords(route) {
    if (route.geometriaIda && route.geometriaIda.length > 1) {
      return route.geometriaIda.map(c => [c[0], c[1]]);
    }
    return (route.puntos || []).map(c => [c[0], c[1]]);
  }

  function getRouteCoordsVuelta(route) {
    if (route.geometriaVuelta && route.geometriaVuelta.length > 1) {
      return route.geometriaVuelta.map(c => [c[0], c[1]]);
    }
    return (route.puntosVuelta || []).map(c => [c[0], c[1]]);
  }

  function routeTotalDistance(route) {
    const coords = getRouteCoords(route);
    if (coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversine(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }
    return total;
  }

  function offsetPolyline(coords, offsetMeters) {
    if (!coords || coords.length < 2) return coords;
    const out = [];
    const R = 6371000;
    for (let i = 0; i < coords.length; i++) {
      const p = coords[i];
      const prev = coords[Math.max(0, i - 1)];
      const next = coords[Math.min(coords.length - 1, i + 1)];
      const dLat = next[0] - prev[0];
      const dLng = next[1] - prev[1];
      const len = Math.hypot(dLat, dLng) || 1;
      const perpLat = -dLng / len;
      const perpLng =  dLat / len;
      const dLatDeg = (offsetMeters / R) * (180 / Math.PI);
      const dLngDeg = (offsetMeters / (R * Math.cos(p[0] * Math.PI / 180))) * (180 / Math.PI);
      out.push([p[0] + perpLat * dLatDeg, p[1] + perpLng * dLngDeg]);
    }
    return out;
  }

  function drawTripRoutesOnMap(routeList, highlightIdx = null) {
    clearTripRouteLayers();
    if (!state.tripMap) return;
    const total = routeList.length;
    routeList.forEach((item, idx) => {
      const route = item.route || item;
      const coordsIda = getRouteCoords(route);
      const coordsVuelta = getRouteCoordsVuelta(route);
      const color = TRIP_COLORS[idx % TRIP_COLORS.length];
      const isHl = highlightIdx === null || highlightIdx === idx;

      if (coordsIda.length > 1) {
        let idaDraw = coordsIda;
        if (total > 1) {
          const offset = (idx - (total - 1) / 2) * 4;
          idaDraw = offsetPolyline(coordsIda, offset);
        }
        const lineIda = L.polyline(idaDraw, {
          color, weight: item.type === 'transfer' ? (isHl ? 5 : 3) : (isHl ? 6 : 4),
          opacity: isHl ? 0.95 : 0.5, lineJoin: 'round', lineCap: 'round'
        }).addTo(state.tripMap);
        lineIda.bindTooltip((item.label || route.nombre || 'Ruta') + ' · IDA', { sticky: true });
        tripRouteLayers.push(lineIda);
      }

      if (coordsVuelta.length > 1) {
        let vueltaDraw = coordsVuelta;
        if (total > 1) {
          const offset = (idx - (total - 1) / 2) * 4;
          vueltaDraw = offsetPolyline(coordsVuelta, -offset);
        }
        const lineVuelta = L.polyline(vueltaDraw, {
          color, weight: isHl ? 4 : 2, opacity: isHl ? 0.85 : 0.4,
          lineJoin: 'round', lineCap: 'round', dashArray: '10,6'
        }).addTo(state.tripMap);
        lineVuelta.bindTooltip((item.label || route.nombre || 'Ruta') + ' · REGRESO', { sticky: true });
        tripRouteLayers.push(lineVuelta);
      }

      if (item.transferPoint) {
        const tp = L.circleMarker(item.transferPoint, {
          radius: 9, color: '#fff', fillColor: color, fillOpacity: 1, weight: 3
        }).addTo(state.tripMap).bindPopup('🔄 Transbordo: ' + (item.label || ''));
        tripRouteLayers.push(tp);
      }
    });
  }

  function routesMinDistance(r1, r2) {
    const c1 = getRouteCoords(r1);
    const c2 = getRouteCoords(r2);
    let best = Infinity, bestPt = null, bestPt2 = null;
    c1.forEach(p1 => {
      c2.forEach(p2 => {
        const d = haversine(p1[0], p1[1], p2[0], p2[1]);
        if (d < best) { best = d; bestPt = p1; bestPt2 = p2; }
      });
    });
    return { dist: best, p1: bestPt, p2: bestPt2, mid: bestPt ? [(bestPt[0]+bestPt2[0])/2, (bestPt[1]+bestPt2[1])/2] : null };
  }

  function routeNearPoint(route, point, radius) {
    return routeDistanceToPoint(route, point.lat, point.lng) <= radius;
  }

  function findTransferChains(startPoint, endPoint, maxTransfers) {
    maxTransfers = Math.max(1, +maxTransfers || 1);
    const chains = [];
    const startRoutes = state.routes.filter(r => routeNearPoint(r, startPoint, startPoint.radius));
    const endRoutes   = state.routes.filter(r => routeNearPoint(r, endPoint, endPoint.radius));
    if (!startRoutes.length || !endRoutes.length) return chains;

    if (maxTransfers >= 1) {
      startRoutes.forEach(r1 => {
        endRoutes.forEach(r2 => {
          if (r1.id === r2.id) return;
          const inter = routesMinDistance(r1, r2);
          if (inter.dist <= 400) {
            chains.push({
              type: 'transfer', legs: [r1, r2], transferPoints: [inter.mid],
              totalDist: routeTotalDistance(r1) + routeTotalDistance(r2), transfers: 1
            });
          }
        });
      });
    }

    if (maxTransfers >= 2) {
      startRoutes.forEach(r1 => {
        state.routes.forEach(r2 => {
          if (r2.id === r1.id) return;
          const i12 = routesMinDistance(r1, r2);
          if (i12.dist > 400) return;
          endRoutes.forEach(r3 => {
            if (r3.id === r2.id || r3.id === r1.id) return;
            const i23 = routesMinDistance(r2, r3);
            if (i23.dist > 400) return;
            chains.push({
              type: 'transfer', legs: [r1, r2, r3], transferPoints: [i12.mid, i23.mid],
              totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3), transfers: 2
            });
          });
        });
      });
    }

    if (maxTransfers >= 3) {
      startRoutes.forEach(r1 => {
        state.routes.forEach(r2 => {
          if (r2.id === r1.id) return;
          const i12 = routesMinDistance(r1, r2);
          if (i12.dist > 400) return;
          state.routes.forEach(r3 => {
            if (r3.id === r2.id || r3.id === r1.id) return;
            const i23 = routesMinDistance(r2, r3);
            if (i23.dist > 400) return;
            endRoutes.forEach(r4 => {
              if (r4.id === r3.id || r4.id === r2.id || r4.id === r1.id) return;
              const i34 = routesMinDistance(r3, r4);
              if (i34.dist > 400) return;
              chains.push({
                type: 'transfer', legs: [r1, r2, r3, r4], transferPoints: [i12.mid, i23.mid, i34.mid],
                totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3) + routeTotalDistance(r4), transfers: 3
              });
            });
          });
        });
      });
    }

    if (maxTransfers >= 4) {
      startRoutes.forEach(r1 => {
        state.routes.forEach(r2 => {
          if (r2.id === r1.id) return;
          const i12 = routesMinDistance(r1, r2);
          if (i12.dist > 400) return;
          state.routes.forEach(r3 => {
            if (r3.id === r2.id || r3.id === r1.id) return;
            const i23 = routesMinDistance(r2, r3);
            if (i23.dist > 400) return;
            state.routes.forEach(r4 => {
              if (r4.id === r3.id || r4.id === r2.id || r4.id === r1.id) return;
              const i34 = routesMinDistance(r3, r4);
              if (i34.dist > 400) return;
              endRoutes.forEach(r5 => {
                if (r5.id === r4.id || r5.id === r3.id || r5.id === r2.id || r5.id === r1.id) return;
                const i45 = routesMinDistance(r4, r5);
                if (i45.dist > 400) return;
                chains.push({
                  type: 'transfer', legs: [r1, r2, r3, r4, r5], transferPoints: [i12.mid, i23.mid, i34.mid, i45.mid],
                  totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3) + routeTotalDistance(r4) + routeTotalDistance(r5), transfers: 4
                });
              });
            });
          });
        });
      });
    }

    const seen = new Set();
    return chains.filter(c => {
      const key = c.legs.map(l => l.id).join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function performTripSearch() {
    const el = $('#tripResults');
    if (!el) return;
    clearTripRouteLayers();
    if (state.tripPoints.length < 1) { el.innerHTML = ''; return; }

    const maxTransfers = +($('#tripMaxTransfers')?.value || 2);
    const results = { direct: [], transfers: [] };

    if (state.tripPoints.length === 1) {
      const p = state.tripPoints[0];
      state.routes.forEach(r => {
        const d = routeDistanceToPoint(r, p.lat, p.lng);
        if (d <= p.radius) results.direct.push({ route: r, dist: d, type: 'direct' });
      });
    } else {
      const start = state.tripPoints[0];
      const end   = state.tripPoints[state.tripPoints.length - 1];

      state.routes.forEach(r => {
        const touchesAll = state.tripPoints.every(p => routeNearPoint(r, p, p.radius));
        if (touchesAll) results.direct.push({ route: r, type: 'direct', label: r.nombre });
      });

      if (!results.direct.length || maxTransfers >= 1) {
        if (state.tripPoints.length === 2) {
          const chains = findTransferChains(start, end, maxTransfers);
          chains.sort((a, b) => a.transfers - b.transfers || a.totalDist - b.totalDist);
          results.transfers = chains.slice(0, 20);
        } else {
          const pairs = [];
          for (let i = 0; i < state.tripPoints.length - 1; i++) {
            const a = state.tripPoints[i];
            const b = state.tripPoints[i+1];
            const chains = findTransferChains(a, b, maxTransfers);
            if (chains.length) pairs.push(chains[0]);
          }
          if (pairs.length) {
            const allLegs = [];
            const allTransferPts = [];
            pairs.forEach(pair => {
              pair.legs.forEach(l => { if (!allLegs.find(x => x.id === l.id)) allLegs.push(l); });
              allTransferPts.push(...(pair.transferPoints || []));
            });
            results.transfers.push({
              type: 'transfer', legs: allLegs, transferPoints: allTransferPts,
              totalDist: pairs.reduce((s, p) => s + p.totalDist, 0), transfers: allLegs.length - 1
            });
          }
        }
      }
    }

    if (results.direct.length) {
      drawTripRoutesOnMap(results.direct.map(d => ({ route: d.route, label: d.route.nombre, type: 'direct' })), null);
    } else if (results.transfers.length) {
      const t0 = results.transfers[0];
      drawTripRoutesOnMap(t0.legs.map((l, li) => ({
        route: l, label: l.nombre, type: 'transfer',
        transferPoint: li === 0 ? t0.transferPoints[0] : (t0.transferPoints[li - 1] || null)
      })));
    }

    let html = '';

    if (results.direct.length) {
      html += `<div class="section-title">✅ Rutas directas (${results.direct.length})</div>`;
      html += results.direct.map((r, idx) => `
        <div class="result-card directa" data-result-idx="${idx}" data-result-type="direct">
          <div class="rc-head">
            <div class="rc-icon" style="background:${TRIP_COLORS[idx % TRIP_COLORS.length]}20;color:${TRIP_COLORS[idx % TRIP_COLORS.length]}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 11h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
            </div>
            <div style="flex:1">
              <div class="rc-route">
                <span class="trip-badge-route" style="background:${TRIP_COLORS[idx % TRIP_COLORS.length]}">${idx+1}</span>
                ${esc(r.route.nombre)}
              </div>
              <div class="rc-sub">${esc(r.route.categoria || 'urbana')}${r.dist ? ' · ' + Math.round(r.dist) + 'm del punto' : ''}</div>
            </div>
            <span class="badge badge-green">Directa</span>
          </div>
          <div class="trip-result-actions">
            <button class="btn btn-primary btn-sm" data-trip-show-direct="${idx}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/></svg>
              Ver trazos en mapa
            </button>
            <button class="btn btn-ghost btn-sm" data-trip-open-direct="${r.route.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
              Abrir ruta
            </button>
          </div>
        </div>`).join('');
    }

    if (results.transfers.length) {
      html += `<div class="section-title">🔄 Transbordos (${results.transfers.length})</div>`;
      html += results.transfers.map((t, idx) => {
        const colorOffset = results.direct.length;
        const color = TRIP_COLORS[(colorOffset + idx) % TRIP_COLORS.length];
        const chipsHtml = t.legs.map((leg, li) => {
          const legColor = TRIP_COLORS[(colorOffset + li) % TRIP_COLORS.length];
          return `<div class="trip-chain-item"><div class="trip-chain-chip" style="background:${legColor}">${li + 1}</div><span class="trip-chain-name">${esc(leg.nombre)}</span></div>`;
        }).join('<span class="trip-chain-sep">›</span>');
        const buttonsHtml = t.legs.map((leg, li) => `
          <button class="btn btn-ghost btn-sm" data-trip-focus="${leg.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            Abrir ${li + 1}ª ruta
          </button>`).join('');
        return `
        <div class="result-card transbordo" data-result-idx="${idx}" data-result-type="transfer">
          <div class="rc-head">
            <div class="rc-icon" style="background:${color}20;color:${color}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>
            </div>
            <div style="flex:1">
              <div class="trip-chain">${chipsHtml}</div>
              <div class="rc-sub">${t.transfers} transbordo(s) · ~${Math.round(t.totalDist)}m totales</div>
            </div>
            <span class="badge badge-amber">${t.transfers}T</span>
          </div>
          <div class="trip-result-actions">
            ${buttonsHtml}
            <button class="btn btn-primary btn-sm" data-trip-show="${idx}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/></svg>
              Ver trazos en mapa
            </button>
          </div>
        </div>`;
      }).join('');
    }

    if (!results.direct.length && !results.transfers.length) {
      html = `<div class="card" style="text-align:center;padding:20px"><div class="empty" style="padding:0"><h3>Sin resultados</h3><p>No se encontraron rutas. Prueba aumentar el radio o el máximo de transbordos.</p></div></div>`;
    }

    el.innerHTML = html;

    el.querySelectorAll('[data-trip-show-direct]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const idx = +b.dataset.tripShowDirect;
        const r = results.direct[idx];
        if (!r) return;
        drawTripRoutesOnMap([{ route: r.route, label: r.route.nombre, type: 'direct' }]);
        const allCoords = [...getRouteCoords(r.route), ...getRouteCoordsVuelta(r.route)];
        if (allCoords.length) {
          try { state.tripMap.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e){}
        }
        const mapWrap = document.querySelector('#tripMapWrap');
        if (mapWrap) {
          const headerH = 58;
          const rect = mapWrap.getBoundingClientRect();
          window.scrollTo({ top: window.scrollY + rect.top - headerH - 8, behavior: 'smooth' });
        }
        toast('Mostrando trazo de: ' + r.route.nombre);
      };
    });

    el.querySelectorAll('[data-trip-open-direct]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        window.location.href = '/?tab=ruta&ruta=' + b.dataset.tripOpenDirect;
      };
    });

    el.querySelectorAll('[data-trip-show]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const idx = +b.dataset.tripShow;
        const t = results.transfers[idx];
        if (!t) return;
        drawTripRoutesOnMap(t.legs.map((l, li) => ({
          route: l, label: l.nombre, type: 'transfer',
          transferPoint: li === 0 ? t.transferPoints[0] : (t.transferPoints[li - 1] || null)
        })));
        const allCoords = [];
        t.legs.forEach(l => { allCoords.push(...getRouteCoords(l)); allCoords.push(...getRouteCoordsVuelta(l)); });
        t.transferPoints.forEach(tp => { if (tp) allCoords.push(tp); });
        if (allCoords.length) {
          try { state.tripMap.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e){}
        }
        const mapWrap = document.querySelector('#tripMapWrap');
        if (mapWrap) {
          const headerH = 58;
          const rect = mapWrap.getBoundingClientRect();
          window.scrollTo({ top: window.scrollY + rect.top - headerH - 8, behavior: 'smooth' });
        }
        toast('Mostrando ' + t.legs.length + ' trazos del transbordo');
      };
    });

    el.querySelectorAll('[data-trip-focus]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        window.location.href = '/?tab=ruta&ruta=' + b.dataset.tripFocus;
      };
    });
  }

  // ==================== CONTROLES ====================
  $('#tripRadius').oninput = e => {
    state.tripRadius = +e.target.value;
    $('#tripRadiusVal').textContent = e.target.value;
  };
  $('#tripMaxTransfers')?.addEventListener('change', () => {
    if (state.tripPoints.length) performTripSearch();
  });
  $('#btnTripSearch').onclick = performTripSearch;

  const tripShareBtn = document.getElementById('tripShareBtn');
  if (tripShareBtn) {
    tripShareBtn.onclick = async () => {
      const url = location.origin + '/mapainteractivo';
      const res = await Publisher.share({
        title: 'Buscar viaje en mapa · Rutas BGD',
        text: 'Encuentra rutas cercanas a tu ubicación en el mapa',
        url
      });
      if (res.method === 'clipboard') toast('Enlace copiado ✓');
    };
  }

  $$('#tripToolbar .tb').forEach(b => {
    b.onclick = () => {
      const tool = b.dataset.tool;
      if (tool === 'undo') {
        if (!state.tripPoints.length) { toast('No hay puntos para deshacer', 'err'); return; }
        const lastIdx = state.tripPoints.length - 1;
        if (state.tripMarkers[lastIdx]) state.tripMap.removeLayer(state.tripMarkers[lastIdx]);
        if (state.tripCircles[lastIdx]) state.tripMap.removeLayer(state.tripCircles[lastIdx]);
        state.tripMarkers.splice(lastIdx, 1);
        state.tripCircles.splice(lastIdx, 1);
        state.tripPoints.splice(lastIdx, 1);
        state.tripPoints.forEach((p, idx) => {
          p.letter = String.fromCharCode(65 + idx);
          p.color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
          const isDefault = TRIP_DEFAULT_NAMES.includes(p.name) || /^PUNTO [A-E]$/.test(p.name);
          if (isDefault) p.name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + p.letter);
        });
        state.tripMarkers.forEach((m, idx) => {
          const pt = state.tripPoints[idx];
          if (!pt) return;
          const icon = L.divIcon({
            className: '',
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color}">${pt.letter}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          });
          m.setIcon(icon);
        });
        renderTripPointsList();
        performTripSearch();
        state.userReactivated = false;
        if (state.tripPoints.length <= 1) {
          const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
          if (addBtn) {
            $$('#tripToolbar .tb').forEach(x => x.classList.remove('active'));
            addBtn.classList.add('active');
          }
        }
        toast('Punto eliminado');
        return;
      }
      if (tool === 'clear') {
        state.tripMarkers.forEach(m => state.tripMap.removeLayer(m));
        state.tripCircles.forEach(c => state.tripMap.removeLayer(c));
        state.tripMarkers = []; state.tripCircles = []; state.tripPoints = [];
        clearTripRouteLayers();
        renderTripPointsList(); performTripSearch();
        state.userReactivated = false;
        const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
        if (addBtn) {
          $$('#tripToolbar .tb').forEach(x => x.classList.remove('active'));
          addBtn.classList.add('active');
        }
        toast('Puntos limpiados');
        return;
      }
      if (tool === 'locate') {
        if (!navigator.geolocation) { toast('GPS no disponible', 'err'); return; }
        navigator.geolocation.getCurrentPosition(pos => {
          const { latitude: lat, longitude: lng } = pos.coords;
          if (state.tripMap) state.tripMap.setView([lat, lng], 15);
          addTripPoint(lat, lng);
        }, err => toast('GPS: ' + err.message, 'err'), { enableHighAccuracy: true });
        return;
      }
      $$('#tripToolbar .tb').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (tool === 'addpoint') {
        state.userReactivated = true;
      } else {
        state.userReactivated = false;
      }
    };
  });

  // ==================== INIT ====================
  async function init() {
    // Service Worker
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) {}
    }
    // Cargar rutas
    await loadRoutes();
    // Inicializar mapa
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initTripMap();
        renderTripPointsList();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública por si se necesita
  global.MapaInteractivo = {
    state,
    initTripMap,
    performTripSearch,
    addTripPoint,
    renderTripPointsList
  };

})(window);
