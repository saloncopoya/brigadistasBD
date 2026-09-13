// js/app.js
// App principal - Rutas Tuxtla Gutiérrez
// Conserva TODAS las funciones originales + modo simple/avanzado + publicación

(function () {
  'use strict';

  // ==================== CONFIG ====================
  const FIREBASE_DB_URL = 'https://galloslivebadge-default-rtdb.firebaseio.com';
  const CLOUDINARY_CONFIG = { cloud_name: 'dxjgyqcby', upload_preset: 'sinfirmaupload' };
  const TUXTLA_CENTER = [16.7538, -93.1156];
  const DEFAULT_ZOOM = 13;
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

  // ==================== ESTADO ====================
  const state = {
    map: null,
    routes: [],
    pois: [],
    currentRoute: null,
    editingRouteId: null,
    isEditing: false,
    isTracking: false,
    trackedPoints: [],
    detectedStreets: [],
    detectedPois: [],
    watchId: null,
    routeLayers: {},
    poiLayers: [],
    editingLayer: null,
    editingMarkers: [],
    db: null,
    isOnline: navigator.onLine,
    filterText: '',
    activeTool: 'draw',
    searchPoints: [],
    searchRadius: 500,
    searchMarkers: [],
    searchRouteLayers: [],
    routesVisibility: 'none',
    selectedRouteId: null,
    currentPage: 'routes',
    mapMode: 'half',
    uiMode: localStorage.getItem('ui-mode') || 'simple',
    pendingPublishRoute: null,
  };

  // ==================== HELPERS ====================
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function showToast(msg, dur = 2500) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), dur);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function pointToSegmentDistance(p, a, b) {
    const atob = { lat: b.lat - a.lat, lng: b.lng - a.lng };
    const atop = { lat: p.lat - a.lat, lng: p.lng - a.lng };
    const len = atob.lat ** 2 + atob.lng ** 2;
    let t = len === 0 ? 0 : (atop.lat * atob.lat + atop.lng * atob.lng) / len;
    t = Math.max(0, Math.min(1, t));
    const closest = { lat: a.lat + t * atob.lat, lng: a.lng + t * atob.lng };
    return calculateDistance(p.lat, p.lng, closest.lat, closest.lng);
  }

  function pointToLineDistance(point, line) {
    if (!line || line.length < 2) return Infinity;
    let minDist = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
      const d = pointToSegmentDistance(point, line[i], line[i + 1]);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  function updateConnectionStatus() {
    state.isOnline = navigator.onLine;
    const dot = $('#conn-dot');
    const txt = $('#conn-text');
    if (dot) dot.classList.toggle('offline', !state.isOnline);
    if (txt) txt.textContent = state.isOnline ? 'Online' : 'Offline';
  }

  // ==================== NOMINATIM ====================
  const geocodeCache = new Map();

  async function reverseGeocode(lat, lng) {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      const res = await fetch(
        `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=es`,
        { headers: { 'User-Agent': 'RutasTuxtlaApp/1.0' } }
      );
      if (!res.ok) throw new Error('geocode');
      const data = await res.json();
      const result = {
        displayName: data.display_name || '',
        address: data.address || {},
        type: data.type || '',
        class: data.class || '',
      };
      geocodeCache.set(key, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  async function searchPlaces(query) {
    try {
      const res = await fetch(
        `${NOMINATIM_URL}/search?q=${encodeURIComponent(
          query
        )}&format=json&addressdetails=1&limit=8&accept-language=es&countrycodes=mx`,
        { headers: { 'User-Agent': 'RutasTuxtlaApp/1.0' } }
      );
      if (!res.ok) throw new Error('search');
      return await res.json();
    } catch (e) {
      return [];
    }
  }

  // ==================== DETECCIÓN ====================
  async function detectStreetsAlongRoute(points, onProgress) {
    if (!points || points.length < 2) return [];
    const sampleCount = Math.min(12, points.length);
    const step = Math.max(1, Math.floor(points.length / sampleCount));
    const samples = [];
    for (let i = 0; i < points.length; i += step) samples.push(points[i]);
    if (samples[samples.length - 1] !== points[points.length - 1])
      samples.push(points[points.length - 1]);

    const streets = [];
    const seen = new Set();
    for (let i = 0; i < samples.length; i++) {
      if (onProgress) onProgress(i + 1, samples.length);
      const p = samples[i];
      try {
        const r = await reverseGeocode(p.lat, p.lng);
        if (r && r.address) {
          const road =
            r.address.road ||
            r.address.pedestrian ||
            r.address.footway ||
            r.address.path ||
            r.address.neighbourhood ||
            r.address.suburb ||
            'Vía sin nombre';
          if (!seen.has(road)) {
            seen.add(road);
            streets.push({
              id: generateId(),
              nombre: road,
              lat: p.lat,
              lng: p.lng,
              colonia: r.address.suburb || r.address.neighbourhood || '',
              ciudad: r.address.city || r.address.town || 'Tuxtla Gutiérrez',
              orden: streets.length + 1,
              direccion: r.displayName,
            });
          }
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1100));
    }
    return streets;
  }

  async function detectBusinessesAlongRoute(points, onProgress) {
    const businesses = [];
    const sampleCount = Math.min(8, points.length);
    const step = Math.max(1, Math.floor(points.length / sampleCount));
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      try {
        const r = await reverseGeocode(p.lat, p.lng);
        if (r && r.address) {
          const a = r.address;
          const amenity = a.amenity || a.shop || a.tourism || a.leisure;
          if (amenity) {
            businesses.push({
              id: generateId(),
              lat: p.lat,
              lng: p.lng,
              nombre: amenity,
              tipo: 'business',
              icono: '🏪',
              descripcion: r.displayName,
            });
          }
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1100));
    }
    return businesses;
  }

  // ==================== INDEXEDDB ====================
  async function initDB() {
    state.db = await idb.openDB('rutas-tuxtla-db', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('rutas'))
          db.createObjectStore('rutas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pois'))
          db.createObjectStore('pois', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sync-queue'))
          db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
      },
    });
  }

  const localDB = {
    async saveRoute(route) {
      if (!state.db) await initDB();
      await state.db.put('rutas', route);
    },
    async getRoutes() {
      if (!state.db) await initDB();
      return await state.db.getAll('rutas');
    },
    async deleteRoute(id) {
      if (!state.db) await initDB();
      await state.db.delete('rutas', id);
    },
    async queueSync(op) {
      if (!state.db) await initDB();
      await state.db.add('sync-queue', { ...op, ts: Date.now() });
    },
    async getQueue() {
      if (!state.db) await initDB();
      return await state.db.getAll('sync-queue');
    },
    async clearQueue() {
      if (!state.db) await initDB();
      await state.db.clear('sync-queue');
    },
  };

  // ==================== FIREBASE ====================
  async function syncRouteToFirebase(route) {
    const url = `${FIREBASE_DB_URL}/rutas/${route.id}.json`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...route, updatedAt: Date.now() }),
    });
    if (!res.ok) throw new Error('sync');
    return res.json();
  }

  async function deleteRouteFromFirebase(id) {
    const res = await fetch(`${FIREBASE_DB_URL}/rutas/${id}.json`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete');
  }

  async function loadRoutesFromFirebase() {
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/rutas.json`);
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      if (!data) return [];
      return Object.entries(data).map(([id, r]) => ({ ...r, id }));
    } catch (e) {
      return [];
    }
  }

  async function processSyncQueue() {
    if (!state.isOnline) return;
    const queue = await localDB.getQueue();
    if (!queue.length) return;
    for (const op of queue) {
      try {
        if (op.type === 'save') await syncRouteToFirebase(op.route);
        else if (op.type === 'delete') await deleteRouteFromFirebase(op.id);
      } catch (e) {
        return;
      }
    }
    await localDB.clearQueue();
    showToast('Sincronización pendiente completada');
  }

  // ==================== CLOUDINARY ====================
  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_CONFIG.upload_preset);
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloud_name}/image/upload`,
      { method: 'POST', body: fd }
    );
    if (!res.ok) throw new Error('upload');
    const data = await res.json();
    return data.secure_url;
  }

  // ==================== MAPA ====================
  function initMap() {
    state.map = L.map('map', {
      center: TUXTLA_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(state.map);
    const hot = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OSM HOT',
    });
    L.control.layers({ Estándar: osm, 'Alto contraste': hot }, null, {
      position: 'bottomright',
    }).addTo(state.map);
    state.map.on('click', handleMapClick);
    setTimeout(() => state.map.invalidateSize(), 300);
  }

  function handleMapClick(e) {
    const { lat, lng } = e.latlng;
    if (state.isEditing) {
      if (state.activeTool === 'draw') addTrackedPoint({ lat, lng, tipo: 'manual' });
      else if (state.activeTool === 'poi') addPoiAtLocation(lat, lng);
      return;
    }
    if (state.currentPage === 'trip' && state.searchPoints.length < 3) {
      addSearchPoint(lat, lng);
    }
  }

  function createLetterIcon(letter, color) {
    return L.divIcon({
      className: 'search-marker',
      html: `<div style="background:${color};color:#fff;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.3)">${letter}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  // ==================== RENDER RUTAS ====================
  function renderRoutesList() {
    const container = $('#routes-list-container');
    if (!container) return;
    const filtered = state.routes.filter((r) => {
      if (!state.filterText) return true;
      const s = state.filterText.toLowerCase();
      return (
        r.nombre?.toLowerCase().includes(s) ||
        r.descripcion?.toLowerCase().includes(s) ||
        r.empresa?.toLowerCase().includes(s) ||
        r.streets?.some((st) => st.nombre?.toLowerCase().includes(s))
      );
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          <p>${state.filterText ? 'No se encontraron rutas' : 'No hay rutas registradas'}</p>
          <p class="small">Toca "+ Nueva Ruta" para agregar una</p>
        </div>`;
      return;
    }

    container.innerHTML = filtered
      .map((route) => {
        const color = route.color || '#1e40af';
        return `
      <div class="route-card ${
        state.selectedRouteId === route.id ? 'selected' : ''
      }" data-id="${route.id}" style="--rc:${color}">
        <div class="route-card-head">
          <h3>${escapeHtml(route.nombre || 'Sin nombre')}</h3>
          <span class="badge badge-${route.tipo || 'ida'}">${route.tipo || 'ida'}</span>
        </div>
        ${
          route.descripcion
            ? `<p class="route-desc">${escapeHtml(route.descripcion)}</p>`
            : ''
        }
        <div class="route-meta">
          <span>📍 ${route.puntos?.length || 0} pts</span>
          ${
            route.streets?.length
              ? `<span>🛣️ ${route.streets.length} calles</span>`
              : ''
          }
          ${route.pois?.length ? `<span>🏪 ${route.pois.length}</span>` : ''}
          ${route.tarifa ? `<span>💰 ${escapeHtml(route.tarifa)}</span>` : ''}
        </div>
        <div class="route-actions">
          <button class="btn btn-sm btn-primary" data-action="view" data-id="${
            route.id
          }">👁️ Ver</button>
          <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${
            route.id
          }">✏️ Editar</button>
          <button class="btn btn-sm btn-success" data-action="publish" data-id="${
            route.id
          }">📤 Publicar</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${
            route.id
          }">🗑️</button>
        </div>
      </div>`;
      })
      .join('');

    container.querySelectorAll('.route-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selectRoute(card.dataset.id);
      });
    });
    container.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'view') selectRoute(id);
        else if (action === 'edit') openEditor(id);
        else if (action === 'delete') deleteRoute(id);
        else if (action === 'publish') openPublishDialog(id);
      });
    });
  }

  function renderRoutesOnMap() {
    Object.values(state.routeLayers).forEach((layer) => {
      if (layer.polyline) state.map.removeLayer(layer.polyline);
      if (layer.markers) layer.markers.forEach((m) => state.map.removeLayer(m));
    });
    state.routeLayers = {};

    if (state.routesVisibility === 'none') return;

    state.routes.forEach((route) => {
      if (!route.puntos || route.puntos.length < 2) return;
      if (state.routesVisibility === 'selected' && state.selectedRouteId !== route.id)
        return;

      const coords = route.puntos.map((p) => [p.lat, p.lng]);
      const color = route.color || '#1e40af';

      const polyline = L.polyline(coords, {
        color,
        weight: 4,
        opacity: 0.8,
        lineJoin: 'round',
      }).addTo(state.map);

      const markers = [];
      const startIcon = L.divIcon({
        className: 'route-marker',
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      markers.push(
        L.marker(coords[0], { icon: startIcon })
          .bindPopup(`<b>${escapeHtml(route.nombre)}</b><br>Inicio`)
          .addTo(state.map)
      );
      markers.push(
        L.marker(coords[coords.length - 1], { icon: startIcon })
          .bindPopup(`<b>${escapeHtml(route.nombre)}</b><br>Fin`)
          .addTo(state.map)
      );

      if (route.pois?.length) {
        route.pois.forEach((poi) => {
          const m = L.marker([poi.lat, poi.lng], {
            icon: L.divIcon({
              className: 'poi-marker',
              html: `<div style="background:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,.25);border:2px solid ${color}">${
                poi.icono || '📍'
              }</div>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
            .bindPopup(
              `<b>${escapeHtml(poi.nombre)}</b><br>${escapeHtml(
                poi.descripcion || ''
              )}`
            )
            .addTo(state.map);
          markers.push(m);
        });
      }
      state.routeLayers[route.id] = { polyline, markers, color };
    });
  }

  function selectRoute(id) {
    const route = state.routes.find((r) => r.id === id);
    if (!route) return;
    state.currentRoute = route;
    state.selectedRouteId = id;
    if (state.routesVisibility === 'selected' || state.routesVisibility === 'all')
      renderRoutesOnMap();
    renderRoutesList();
    Object.entries(state.routeLayers).forEach(([rid, layer]) => {
      if (layer.polyline) {
        layer.polyline.setStyle({
          weight: rid === id ? 6 : 4,
          opacity: rid === id ? 1 : 0.6,
        });
      }
    });
    if (state.routeLayers[id]) {
      state.map.fitBounds(state.routeLayers[id].polyline.getBounds(), {
        padding: [50, 50],
      });
      if (state.mapMode === 'hidden') setMapMode('half');
    }
    navigateTo('map');
    showToast(`Ruta: ${route.nombre}`);
  }

  // ==================== NAVEGACIÓN ====================
  function navigateTo(page) {
    state.currentPage = page;
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
    $$('.panel-page').forEach((p) =>
      p.classList.toggle('active', p.id === `page-${page}`)
    );

    const tools = $('#map-tools');
    if (page === 'editor') {
      tools.classList.add('visible');
      if (!state.isEditing) startEditing(state.editingRouteId);
    } else {
      tools.classList.remove('visible');
    }

    const panel = $('#app-panel');
    panel.classList.remove('hidden');

    if (state.mapMode === 'hidden' && (page === 'map' || page === 'editor' || page === 'trip')) {
      setMapMode('half');
    }

    if (page === 'routes') renderRoutesList();
    else if (page === 'trip') renderTripSearch();
    else if (page === 'pois') renderPoisList();
    else if (page === 'settings') renderSettings();

    setTimeout(() => state.map.invalidateSize(), 350);
  }

  function setMapMode(mode) {
    state.mapMode = mode;
    const wrap = $('#map-wrap');
    wrap.classList.remove('mode-full', 'mode-half', 'mode-hidden');
    wrap.classList.add(`mode-${mode}`);
    $$('.map-size-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.size === mode)
    );
    setTimeout(() => state.map.invalidateSize(), 400);
  }

  // ==================== EDITOR ====================
  function openEditor(routeId = null) {
    state.editingRouteId = routeId;
    state.isEditing = true;
    state.trackedPoints = [];
    state.detectedStreets = [];
    state.detectedPois = [];

    $('#route-form').reset();
    $('#route-id').value = '';
    $('#image-preview').style.display = 'none';
    $('#image-preview').src = '';
    $('#route-color').value = '#1e40af';
    $$('.color-chip').forEach((c) =>
      c.classList.toggle('active', c.dataset.color === '#1e40af')
    );

    if (routeId) {
      $('#editor-title').textContent = '✏️ Editar Ruta';
      const r = state.routes.find((x) => x.id === routeId);
      if (r) {
        $('#route-id').value = r.id;
        $('#route-name').value = r.nombre || '';
        $('#route-desc').value = r.descripcion || '';
        $('#route-type').value = r.tipo || 'ida';
        $('#route-company').value = r.empresa || '';
        $('#route-color').value = r.color || '#1e40af';
        $('#route-fare').value = r.tarifa || '';
        $('#route-frequency').value = r.frecuencia || '';
        if (r.horario) {
          const parts = r.horario.split(' - ');
          if (parts[0]) $('#route-schedule').value = parts[0];
          if (parts[1]) $('#route-schedule-end').value = parts[1];
        }
        $('#route-days').value = r.dias || 'todos';
        $('#route-accessible').value = r.accesible || 'no';
        $('#route-notes').value = r.notas || '';
        if (r.imagen) {
          $('#image-preview').src = r.imagen;
          $('#image-preview').style.display = 'block';
        }
        state.trackedPoints = [...(r.puntos || [])];
        state.detectedStreets = [...(r.streets || [])];
        state.detectedPois = [...(r.pois || [])];
        $$('.color-chip').forEach((c) =>
          c.classList.toggle('active', c.dataset.color === (r.color || '#1e40af'))
        );
      }
    } else {
      $('#editor-title').textContent = '➕ Registrar Ruta';
    }

    renderEditingTrack();
    updatePointsUI();
    renderStreetsList();
    renderPoisEditList();
    navigateTo('editor');
    setMapMode(state.mapMode === 'hidden' ? 'half' : state.mapMode);
  }

  function closeEditor() {
    state.isEditing = false;
    state.editingRouteId = null;
    state.trackedPoints = [];
    state.detectedStreets = [];
    state.detectedPois = [];
    if (state.editingLayer) {
      state.map.removeLayer(state.editingLayer);
      state.editingLayer = null;
    }
    state.editingMarkers.forEach((m) => state.map.removeLayer(m));
    state.editingMarkers = [];
    state.poiLayers.forEach((m) => state.map.removeLayer(m));
    state.poiLayers = [];
    if (state.isTracking) stopTracking();
    $('#map-tools').classList.remove('visible');
    navigateTo('routes');
  }

  function startEditing() {
    state.isEditing = true;
  }

  function addTrackedPoint(point) {
    state.trackedPoints.push(point);
    updatePointsUI();
    renderEditingTrack();
  }

  function renderEditingTrack() {
    if (state.editingLayer) {
      state.map.removeLayer(state.editingLayer);
      state.editingLayer = null;
    }
    state.editingMarkers.forEach((m) => state.map.removeLayer(m));
    state.editingMarkers = [];
    if (state.trackedPoints.length < 2) return;

    const coords = state.trackedPoints.map((p) => [p.lat, p.lng]);
    state.editingLayer = L.polyline(coords, {
      color: $('#route-color').value || '#1e40af',
      weight: 5,
      opacity: 0.9,
      dashArray: state.isTracking ? '8, 8' : null,
    }).addTo(state.map);

    state.trackedPoints.forEach((p, i) => {
      if (p.tipo === 'manual') {
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: 7,
          fillColor: '#dc2626',
          color: '#fff',
          weight: 2,
          fillOpacity: 1,
        }).addTo(state.map);
        marker.bindPopup(`Punto ${i + 1}${p.nombre ? ': ' + p.nombre : ''}`);
        state.editingMarkers.push(marker);
      }
    });
  }

  function updatePointsUI() {
    const c = state.trackedPoints.length;
    const el = $('#points-count');
    if (el) el.textContent = c;
    const rt = $('#recording-text');
    if (rt) rt.textContent = `Grabando... ${c} pts`;
    const preview = $('#points-list-preview');
    if (preview) {
      if (c === 0) preview.textContent = 'Aún no hay puntos trazados.';
      else preview.textContent = `✅ ${c} puntos trazados listos para guardar.`;
    }
  }

  function renderStreetsList() {
    const container = $('#streets-list');
    if (!container) return;
    const count = $('#streets-count');
    if (count) count.textContent = state.detectedStreets.length;

    if (state.detectedStreets.length === 0) {
      container.innerHTML =
        '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Traza la ruta primero y toca "Detectar ahora".</p>';
      return;
    }
    container.innerHTML = state.detectedStreets
      .map(
        (s, i) => `
      <div class="list-item">
        <div class="list-num">${i + 1}</div>
        <div class="list-body">
          <h4>${escapeHtml(s.nombre)}</h4>
          ${s.colonia ? `<p>Col. ${escapeHtml(s.colonia)}</p>` : ''}
        </div>
        <div class="list-actions">
          <button class="icon-mini" data-action="edit-street" data-id="${
            s.id
          }">✏️</button>
          <button class="icon-mini danger" data-action="rm-street" data-id="${
            s.id
          }">✕</button>
        </div>
      </div>`
      )
      .join('');

    container.querySelectorAll('[data-action="edit-street"]').forEach((b) => {
      b.addEventListener('click', () => {
        const s = state.detectedStreets.find((x) => x.id === b.dataset.id);
        if (!s) return;
        const nn = prompt('Nombre de la calle:', s.nombre);
        if (nn !== null) {
          s.nombre = nn;
          renderStreetsList();
        }
      });
    });
    container.querySelectorAll('[data-action="rm-street"]').forEach((b) => {
      b.addEventListener('click', () => {
        state.detectedStreets = state.detectedStreets.filter(
          (x) => x.id !== b.dataset.id
        );
        renderStreetsList();
      });
    });
  }

  function renderPoisEditList() {
    const container = $('#pois-list-edit');
    if (!container) return;
    const count = $('#pois-count');
    if (count) count.textContent = state.detectedPois.length;

    if (state.detectedPois.length === 0) {
      container.innerHTML =
        '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px">No hay puntos de interés.</p>';
      return;
    }
    container.innerHTML = state.detectedPois
      .map(
        (p) => `
      <div class="list-item">
        <div class="list-icon">${p.icono || '📍'}</div>
        <div class="list-body">
          <h4>${escapeHtml(p.nombre)}</h4>
          <p>${escapeHtml(p.descripcion || '')}</p>
        </div>
        <button class="icon-mini danger" data-action="rm-poi" data-id="${
          p.id
        }">✕</button>
      </div>`
      )
      .join('');

    container.querySelectorAll('[data-action="rm-poi"]').forEach((b) => {
      b.addEventListener('click', () => {
        state.detectedPois = state.detectedPois.filter((x) => x.id !== b.dataset.id);
        renderPoisEditList();
      });
    });
  }

  function addPoiAtLocation(lat, lng) {
    const poi = {
      id: generateId(),
      lat,
      lng,
      nombre: 'Nuevo punto',
      descripcion: '',
      tipo: 'custom',
      icono: '📍',
    };
    state.detectedPois.push(poi);
    renderPoisEditList();
    renderPoiMarker(poi);
    reverseGeocode(lat, lng).then((r) => {
      if (r && r.displayName) {
        poi.descripcion = r.displayName;
        if (r.address) {
          const a = r.address;
          if (a.amenity || a.shop) {
            poi.nombre = a.amenity || a.shop;
            poi.tipo = 'business';
            poi.icono = '🏪';
          } else if (a.road) {
            poi.nombre = a.road;
            poi.tipo = 'street';
            poi.icono = '🛣️';
          }
        }
        renderPoisEditList();
      }
    });
  }

  function renderPoiMarker(poi) {
    const marker = L.marker([poi.lat, poi.lng], {
      icon: L.divIcon({
        className: 'editing-poi',
        html: `<div style="background:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid #1e40af">${
          poi.icono || '📍'
        }</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
      draggable: true,
    }).addTo(state.map);
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      poi.lat = pos.lat;
      poi.lng = pos.lng;
    });
    marker.on('click', () => {
      const nn = prompt('Nombre del punto:', poi.nombre);
      if (nn !== null) {
        poi.nombre = nn;
        renderPoisEditList();
      }
    });
    state.poiLayers.push(marker);
  }

  // ==================== GPS ====================
  function startTracking() {
    if (!navigator.geolocation) {
      showToast('Geolocalización no soportada');
      return;
    }
    state.isTracking = true;
    $('#recording-bar').classList.add('active');
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        addTrackedPoint({
          lat: latitude,
          lng: longitude,
          accuracy,
          tipo: 'gps',
          timestamp: pos.timestamp,
        });
        state.map.setView([latitude, longitude], 16);
      },
      (err) => {
        showToast('Error GPS: ' + err.message);
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
    showToast('Grabando recorrido...');
  }

  function stopTracking() {
    state.isTracking = false;
    if (state.watchId) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    $('#recording-bar').classList.remove('active');
    showToast(`Detenido: ${state.trackedPoints.length} puntos`);
  }

  // ==================== BUSCAR VIAJE ====================
  function renderTripSearch() {
    const spList = $('#search-points-list');
    if (spList) renderSearchPointsList();
    const r = $('#search-radius');
    if (r) r.value = state.searchRadius;
    const rv = $('#radius-value');
    if (rv) rv.textContent = `${state.searchRadius}m`;
  }

  function addSearchPoint(lat, lng) {
    if (state.searchPoints.length >= 3) {
      showToast('Máximo 3 puntos (A, B, C)');
      return;
    }
    const letter = String.fromCharCode(65 + state.searchPoints.length);
    const colors = { A: '#16a34a', B: '#dc2626', C: '#f59e0b' };
    const color = colors[letter] || '#1e40af';
    const point = { lat, lng, letter, color };
    state.searchPoints.push(point);

    const marker = L.marker([lat, lng], { icon: createLetterIcon(letter, color) }).addTo(
      state.map
    );
    const circle = L.circle([lat, lng], {
      radius: state.searchRadius,
      color,
      fillColor: color,
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5',
    }).addTo(state.map);
    marker._circle = circle;
    state.searchMarkers.push(marker);

    renderSearchPointsList();
    if (state.mapMode === 'hidden') setMapMode('half');
    showToast(`Punto ${letter} marcado`);
  }

  function renderSearchPointsList() {
    const container = $('#search-points-list');
    if (!container) return;
    if (state.searchPoints.length === 0) {
      container.innerHTML =
        '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;background:var(--bg);border-radius:10px;margin-bottom:10px">Sin puntos marcados. Toca el mapa.</p>';
      return;
    }
    container.innerHTML = state.searchPoints
      .map(
        (p, i) => `
      <div class="search-point">
        <div class="search-letter ${p.letter}">${p.letter}</div>
        <div class="search-info">
          <h4>Punto ${p.letter}</h4>
          <p>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</p>
        </div>
        <button class="icon-mini danger" data-idx="${i}">✕</button>
      </div>`
      )
      .join('');

    container.querySelectorAll('[data-idx]').forEach((b) => {
      b.addEventListener('click', () => removeSearchPoint(parseInt(b.dataset.idx)));
    });
  }

  function removeSearchPoint(index) {
    const marker = state.searchMarkers[index];
    if (marker) {
      if (marker._circle) state.map.removeLayer(marker._circle);
      state.map.removeLayer(marker);
    }
    state.searchPoints.splice(index, 1);
    state.searchMarkers.splice(index, 1);
    state.searchMarkers.forEach((m, i) => {
      const letter = String.fromCharCode(65 + i);
      const colors = { A: '#16a34a', B: '#dc2626', C: '#f59e0b' };
      const color = colors[letter] || '#1e40af';
      m.setIcon(createLetterIcon(letter, color));
      if (m._circle) m._circle.setStyle({ color, fillColor: color });
    });
    state.searchPoints.forEach((p, i) => {
      p.letter = String.fromCharCode(65 + i);
      const colors = { A: '#16a34a', B: '#dc2626', C: '#f59e0b' };
      p.color = colors[p.letter] || '#1e40af';
    });
    renderSearchPointsList();
  }

  function clearSearchPoints() {
    state.searchPoints = [];
    state.searchMarkers.forEach((m) => {
      if (m._circle) state.map.removeLayer(m._circle);
      state.map.removeLayer(m);
    });
    state.searchMarkers = [];
    state.searchRouteLayers.forEach((l) => state.map.removeLayer(l));
    state.searchRouteLayers = [];
    renderSearchPointsList();
    const results = $('#search-results');
    if (results) results.innerHTML = '';
  }

  async function performTripSearch() {
    if (state.searchPoints.length < 2) {
      showToast('Marca al menos 2 puntos');
      return;
    }
    state.searchRouteLayers.forEach((l) => state.map.removeLayer(l));
    state.searchRouteLayers = [];

    const radius = state.searchRadius;
    const resultsEl = $('#search-results');
    resultsEl.innerHTML =
      '<div class="loading"><div class="spinner"></div><span>Buscando rutas...</span></div>';

    const routesPerPoint = state.searchPoints.map((p) => ({
      point: p,
      routes: findRoutesNearPoint(p, radius),
    }));

    const routesThroughAll = state.routes.filter((route) => {
      if (!route.puntos || route.puntos.length < 2) return false;
      return routesPerPoint.every((rp) => rp.routes.some((r) => r.id === route.id));
    });

    const routesThrough2 = state.routes.filter((route) => {
      if (!route.puntos || route.puntos.length < 2) return false;
      const count = routesPerPoint.filter((rp) =>
        rp.routes.some((r) => r.id === route.id)
      ).length;
      return count >= 2;
    });

    const singleRoutes = routesPerPoint.map((rp) => ({
      point: rp.point,
      routes: rp.routes.filter((r) => !routesThrough2.includes(r)),
    }));

    let html = '';
    if (routesThroughAll.length > 0) {
      html +=
        '<h3 style="font-size:13px;margin-bottom:10px;color:var(--success)">✅ Rutas que pasan por todos los puntos</h3>';
      routesThroughAll.forEach((route) => {
        html += renderRouteResultCard(route, 'success');
        drawSearchRoute(route, '#16a34a');
      });
    }
    if (routesThrough2.length > 0) {
      html +=
        '<h3 style="font-size:13px;margin:14px 0 10px;color:var(--warning)">🔄 Rutas que conectan varios puntos</h3>';
      routesThrough2
        .filter((r) => !routesThroughAll.includes(r))
        .forEach((route) => {
          html += renderRouteResultCard(route, 'warning');
          drawSearchRoute(route, '#f59e0b');
        });
    }
    const hasSingles = singleRoutes.some((s) => s.routes.length > 0);
    if (hasSingles) {
      html +=
        '<h3 style="font-size:13px;margin:14px 0 10px;color:var(--primary)">📍 Rutas cercanas a cada punto</h3>';
      singleRoutes.forEach((sr) => {
        if (sr.routes.length === 0) return;
        html += `<p style="font-size:12px;font-weight:600;margin:8px 0 6px">Punto ${sr.point.letter}:</p>`;
        sr.routes.forEach((route) => {
          html += renderRouteResultCard(route, 'primary');
          drawSearchRoute(route, '#1e40af');
        });
      });
    }
    if (!html) {
      html =
        '<div class="empty-state"><p>No se encontraron rutas cerca</p><p class="small">Intenta aumentar el radio</p></div>';
    }
    resultsEl.innerHTML = html;
  }

  function renderRouteResultCard(route, type) {
    const color = route.color || '#1e40af';
    return `
    <div class="result-card ${type}" data-id="${route.id}" style="border-left-color:${color}">
      <div class="route-card-head">
        <h3>${escapeHtml(route.nombre)}</h3>
        <span class="badge badge-${route.tipo || 'ida'}">${route.tipo || 'ida'}</span>
      </div>
      <div class="route-meta" style="margin:6px 0 0">
        <span>🛣️ ${route.streets?.length || 0} calles</span>
        ${route.tarifa ? `<span>💰 ${escapeHtml(route.tarifa)}</span>` : ''}
      </div>
    </div>`;
  }

  function drawSearchRoute(route, color) {
    if (!route.puntos || route.puntos.length < 2) return;
    const coords = route.puntos.map((p) => [p.lat, p.lng]);
    const line = L.polyline(coords, {
      color,
      weight: 5,
      opacity: 0.75,
      dashArray: '10, 6',
    }).addTo(state.map);
    state.searchRouteLayers.push(line);
  }

  function findRoutesNearPoint(point, radius) {
    return state.routes.filter((route) => {
      if (!route.puntos || route.puntos.length < 2) return false;
      return pointToLineDistance(point, route.puntos) <= radius;
    });
  }

  // ==================== GUARDAR ====================
  async function saveRoute() {
    const name = $('#route-name').value.trim();
    if (!name) {
      showToast('Ingresa un nombre');
      return;
    }
    if (state.trackedPoints.length < 2) {
      showToast('Necesitas al menos 2 puntos en el mapa');
      return;
    }

    const btn = $('#btn-save');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Guardando...';

    try {
      const routeId = $('#route-id').value || generateId();
      const imgFile = $('#route-image').files[0];
      let imageUrl = null;

      if (imgFile) {
        if (state.isOnline) {
          try {
            imageUrl = await uploadImage(imgFile);
          } catch (e) {
            console.error(e);
          }
        }
        if (!imageUrl) {
          imageUrl = await new Promise((res) => {
            const r = new FileReader();
            r.onload = (ev) => res(ev.target.result);
            r.readAsDataURL(imgFile);
          });
        }
      } else if ($('#image-preview').src && $('#image-preview').style.display !== 'none') {
        imageUrl = $('#image-preview').src;
      }

      const existing = state.routes.find((r) => r.id === routeId);

      const route = {
        id: routeId,
        nombre: name,
        descripcion: $('#route-desc').value.trim(),
        tipo: $('#route-type').value,
        empresa: $('#route-company').value.trim(),
        color: $('#route-color').value,
        tarifa: $('#route-fare').value.trim(),
        frecuencia: $('#route-frequency').value.trim(),
        horario: `${$('#route-schedule').value} - ${$('#route-schedule-end').value}`,
        dias: $('#route-days').value,
        accesible: $('#route-accessible').value,
        notas: $('#route-notes').value.trim(),
        imagen: imageUrl,
        puntos: [...state.trackedPoints],
        streets: [...state.detectedStreets],
        pois: [...state.detectedPois],
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      await localDB.saveRoute(route);

      if (state.isOnline) {
        try {
          await syncRouteToFirebase(route);
          showToast('Ruta guardada y sincronizada');
        } catch (e) {
          await localDB.queueSync({ type: 'save', route });
          showToast('Guardado local (pendiente sync)');
        }
      } else {
        await localDB.queueSync({ type: 'save', route });
        showToast('Ruta guardada offline');
      }

      const idx = state.routes.findIndex((r) => r.id === routeId);
      if (idx >= 0) state.routes[idx] = route;
      else state.routes.push(route);

      state.selectedRouteId = routeId;
      state.routesVisibility = 'all';
      $$('#visibility-chips .chip').forEach((c) =>
        c.classList.toggle('active', c.dataset.visibility === 'all')
      );

      renderRoutesList();
      renderRoutesOnMap();

      // Preguntar si publicar como post
      if (confirm('¿Publicar esta ruta como post en el blog para Google?')) {
        openPublishDialog(routeId);
      } else {
        closeEditor();
      }
    } catch (e) {
      console.error(e);
      showToast('Error al guardar');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function deleteRoute(id) {
    const route = state.routes.find((r) => r.id === id);
    if (!route) return;
    if (!confirm(`¿Eliminar "${route.nombre}"?`)) return;
    try {
      await localDB.deleteRoute(id);
      if (state.isOnline) {
        try {
          await deleteRouteFromFirebase(id);
        } catch (e) {
          await localDB.queueSync({ type: 'delete', id });
        }
      } else {
        await localDB.queueSync({ type: 'delete', id });
      }
      state.routes = state.routes.filter((r) => r.id !== id);
      if (state.routeLayers[id]) {
        if (state.routeLayers[id].polyline)
          state.map.removeLayer(state.routeLayers[id].polyline);
        state.routeLayers[id].markers?.forEach((m) => state.map.removeLayer(m));
        delete state.routeLayers[id];
      }
      if (state.selectedRouteId === id) state.selectedRouteId = null;
      renderRoutesList();
      renderRoutesOnMap();
      showToast('Ruta eliminada');
    } catch (e) {
      showToast('Error al eliminar');
    }
  }

  // ==================== PUBLICAR ====================
  function openPublishDialog(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;

    state.pendingPublishRoute = route;

    const slug = slugify(route.nombre);
    const dialog = $('#publish-dialog');
    if (!dialog) return;

    $('#publish-slug').value = slug;
    $('#publish-title').value = route.nombre;
    $('#publish-description').value =
      route.descripcion || `Ruta de transporte en Tuxtla Gutiérrez: ${route.nombre}`;
    $('#publish-content').value =
      route.descripcion ||
      `Recorrido de la ruta ${route.nombre}. Consulta paradas, calles y puntos de interés.`;
    $('#publish-password').value = '';

    // Preview de imagen
    const prev = $('#publish-preview');
    if (route.imagen) {
      prev.src = route.imagen;
      prev.style.display = 'block';
    } else {
      prev.style.display = 'none';
    }

    dialog.classList.add('active');
    dialog.style.display = 'flex';
  }

  async function publishRoute() {
    const route = state.pendingPublishRoute;
    if (!route) return;

    const password = $('#publish-password').value;
    if (!password) {
      showToast('Ingresa la contraseña');
      return;
    }

    const btn = $('#btn-do-publish');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '⏳ Publicando...';

    try {
      const payload = {
        password,
        slug: $('#publish-slug').value,
        title: $('#publish-title').value,
        description: $('#publish-description').value,
        content: $('#publish-content').value,
        image: route.imagen || '',
        routeData: route,
        mapPoints: route.puntos || [],
        streets: (route.streets || []).map((s) => s.nombre),
        pois: route.pois || [],
        metadata: {
          tipo: route.tipo,
          color: route.color,
          empresa: route.empresa,
          tarifa: route.tarifa,
          frecuencia: route.frecuencia,
          horario: route.horario,
          dias: route.dias,
          accesible: route.accesible,
          streets: route.streets || [],
          mapPoints: route.puntos || [],
        },
      };

      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Error ${res.status}`);
      }

      showToast('✅ Post publicado. Google lo indexará pronto.');
      $('#publish-dialog').style.display = 'none';
      $('#publish-dialog').classList.remove('active');
      closeEditor();

      if (confirm('¿Ver el post publicado ahora?')) {
        window.open(data.url, '_blank');
      }
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // ==================== POIS GLOBALES ====================
  function renderPoisList() {
    const container = $('#pois-list');
    if (!container) return;
    const all = [];
    state.routes.forEach((r) => {
      (r.pois || []).forEach((p) => all.push({ ...p, rutaNombre: r.nombre, rutaId: r.id }));
    });
    if (all.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><p>No hay puntos de interés registrados</p></div>';
      return;
    }
    container.innerHTML = all
      .map(
        (p) => `
      <div class="list-item" data-route="${p.rutaId}">
        <div class="list-icon">${p.icono || '📍'}</div>
        <div class="list-body">
          <h4>${escapeHtml(p.nombre)}</h4>
          <p>${escapeHtml(p.rutaNombre)}</p>
        </div>
      </div>`
      )
      .join('');
    container.querySelectorAll('.list-item').forEach((it) => {
      it.addEventListener('click', () => selectRoute(it.dataset.route));
    });
  }

  // ==================== AJUSTES ====================
  function renderSettings() {
    const totalStreets = state.routes.reduce((s, r) => s + (r.streets?.length || 0), 0);
    const totalPois = state.routes.reduce((s, r) => s + (r.pois?.length || 0), 0);
    const totalPoints = state.routes.reduce((s, r) => s + (r.puntos?.length || 0), 0);
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set('#settings-stat-routes', state.routes.length);
    set('#settings-stat-streets', totalStreets);
    set('#settings-stat-pois', totalPois);
    set('#settings-stat-points', totalPoints);
    set('#stat-routes', state.routes.length);
    set('#stat-streets', totalStreets);
    set('#stat-pois', totalPois);
    set('#stat-points', totalPoints);
  }

  // ==================== BÚSQUEDA ====================
  async function handleSearch() {
    const q = $('#search-input').value.trim();
    state.filterText = q;
    renderRoutesList();
    navigateTo('routes');
    if (!q || q.length < 3) return;
    const results = await searchPlaces(q);
    if (results.length) {
      const r = results[0];
      const lat = parseFloat(r.lat),
        lng = parseFloat(r.lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        state.map.setView([lat, lng], 15);
        L.marker([lat, lng]).addTo(state.map).bindPopup(escapeHtml(r.display_name)).openPopup();
        if (state.mapMode === 'hidden') setMapMode('half');
      }
    }
  }

  // ==================== UI MODE ====================
  function applyUiMode(mode) {
    state.uiMode = mode;
    localStorage.setItem('ui-mode', mode);
    document.body.classList.remove('mode-simple', 'mode-advanced');
    document.body.classList.add(`mode-${mode}`);
    $$('.mode-toggle').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );
  }

  // ==================== EVENTOS ====================
  function setupEventListeners() {
    // Toggle modo simple/avanzado
    $$('.mode-toggle').forEach((b) => {
      b.addEventListener('click', () => applyUiMode(b.dataset.mode));
    });

    // Búsqueda
    $('#search-input')?.addEventListener('input', (e) => {
      state.filterText = e.target.value.trim();
      if (state.currentPage !== 'routes' && state.filterText) navigateTo('routes');
      renderRoutesList();
    });
    $('#search-btn')?.addEventListener('click', handleSearch);
    $('#search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
      }
    });

    // Nav
    $$('.nav-item').forEach((n) => {
      n.addEventListener('click', () => navigateTo(n.dataset.page));
    });

    // Botones mapa
    $('#btn-map-toggle')?.addEventListener('click', () => {
      setMapMode(state.mapMode === 'hidden' ? 'half' : 'hidden');
    });
    $('#btn-map-fullscreen')?.addEventListener('click', () => {
      setMapMode(state.mapMode === 'full' ? 'half' : 'full');
    });
    $$('.map-size-btn').forEach((b) => {
      b.addEventListener('click', () => setMapMode(b.dataset.size));
    });
    $$('[data-mapsize]').forEach((b) => {
      b.addEventListener('click', () => setMapMode(b.dataset.mapsize));
    });

    // Chips visibilidad
    $$('#visibility-chips .chip').forEach((c) => {
      c.addEventListener('click', () => {
        state.routesVisibility = c.dataset.visibility;
        $$('#visibility-chips .chip').forEach((x) =>
          x.classList.toggle('active', x === c)
        );
        renderRoutesOnMap();
      });
    });

    // Botones rutas
    $('#btn-new-route-list')?.addEventListener('click', () => openEditor(null));
    $('#quick-add-route')?.addEventListener('click', () => openEditor(null));
    $('#btn-refresh-routes')?.addEventListener('click', async () => {
      if (!state.isOnline) {
        showToast('Sin conexión');
        return;
      }
      const fb = await loadRoutesFromFirebase();
      state.routes = fb;
      for (const r of fb) await localDB.saveRoute(r);
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      showToast('Sincronizado');
    });

    // Herramientas mapa
    $$('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'undo') {
          if (state.trackedPoints.length > 0) {
            state.trackedPoints.pop();
            renderEditingTrack();
            updatePointsUI();
          }
          return;
        }
        if (tool === 'clear') {
          if (confirm('¿Limpiar todos los puntos?')) {
            state.trackedPoints = [];
            state.detectedStreets = [];
            state.detectedPois = [];
            renderEditingTrack();
            updatePointsUI();
            renderStreetsList();
            renderPoisEditList();
          }
          return;
        }
        if (tool === 'gps') {
          if (state.isTracking) stopTracking();
          else startTracking();
          return;
        }
        if (tool === 'detect') {
          detectAllNow();
          return;
        }
        $$('.tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTool = tool;
      });
    });

    // GPS editor
    $('#btn-start-tracking')?.addEventListener('click', () => {
      if (state.isTracking) stopTracking();
      else startTracking();
    });
    $('#quick-gps')?.addEventListener('click', () => {
      if (!state.isEditing) openEditor(null);
      setTimeout(() => {
        if (!state.isTracking) startTracking();
      }, 300);
    });
    $('#btn-stop-recording')?.addEventListener('click', stopTracking);

    $('#btn-clear-points')?.addEventListener('click', () => {
      if (confirm('¿Limpiar todos los puntos?')) {
        state.trackedPoints = [];
        state.detectedStreets = [];
        state.detectedPois = [];
        renderEditingTrack();
        updatePointsUI();
        renderStreetsList();
        renderPoisEditList();
      }
    });

    // Detectar calles
    $('#btn-detect-streets')?.addEventListener('click', async () => {
      if (state.trackedPoints.length < 2) {
        showToast('Traza la ruta primero');
        return;
      }
      const bar = $('#detecting-bar');
      bar.classList.add('active');
      try {
        const streets = await detectStreetsAlongRoute(state.trackedPoints, (i, t) => {
          $('#detecting-text').textContent = `Detectando calles... ${i}/${t}`;
        });
        state.detectedStreets = streets;
        renderStreetsList();
        showToast(`${streets.length} calles detectadas`);
      } catch (e) {
        showToast('Error en detección');
      } finally {
        bar.classList.remove('active');
      }
    });

    $('#btn-reverse-order')?.addEventListener('click', () => {
      state.detectedStreets.reverse();
      renderStreetsList();
      showToast('Orden invertido');
    });

    $('#btn-detect-businesses')?.addEventListener('click', async () => {
      if (state.trackedPoints.length < 2) {
        showToast('Traza la ruta primero');
        return;
      }
      const bar = $('#detecting-bar');
      bar.classList.add('active');
      try {
        const pois = await detectBusinessesAlongRoute(state.trackedPoints);
        state.detectedPois = [...state.detectedPois, ...pois];
        renderPoisEditList();
        pois.forEach((p) => renderPoiMarker(p));
        showToast(`${pois.length} negocios detectados`);
      } catch (e) {
        showToast('Error en detección');
      } finally {
        bar.classList.remove('active');
      }
    });

    $('#btn-add-custom-poi')?.addEventListener('click', () => {
      state.activeTool = 'poi';
      $$('.tool-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.tool === 'poi')
      );
      showToast('Toca el mapa para agregar un punto');
    });

    // Imagen
    $('#image-upload-area')?.addEventListener('click', () => $('#route-image').click());
    $('#route-image')?.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) {
        const r = new FileReader();
        r.onload = (ev) => {
          $('#image-preview').src = ev.target.result;
          $('#image-preview').style.display = 'block';
        };
        r.readAsDataURL(f);
      }
    });

    // Guardar / cancelar
    $('#btn-save')?.addEventListener('click', saveRoute);
    $('#btn-cancel-edit')?.addEventListener('click', () => {
      if (confirm('¿Descartar cambios?')) closeEditor();
    });

    // Color
    $$('.color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $$('.color-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        $('#route-color').value = chip.dataset.color;
        if (state.editingLayer) state.editingLayer.setStyle({ color: chip.dataset.color });
      });
    });

    // Buscar viaje
    $('#btn-add-search-point')?.addEventListener('click', () => {
      if (state.searchPoints.length >= 3) {
        showToast('Máximo 3 puntos');
        return;
      }
      if (!navigator.geolocation) {
        showToast('GPS no disponible');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => addSearchPoint(pos.coords.latitude, pos.coords.longitude),
        () => showToast('No se pudo obtener ubicación')
      );
    });
    $('#btn-clear-search-points')?.addEventListener('click', clearSearchPoints);
    $('#btn-search-trip')?.addEventListener('click', performTripSearch);
    $('#search-radius')?.addEventListener('input', (e) => {
      state.searchRadius = parseInt(e.target.value);
      $('#radius-value').textContent = `${state.searchRadius}m`;
      state.searchMarkers.forEach((m) => {
        if (m._circle) m._circle.setRadius(state.searchRadius);
      });
    });

    document.addEventListener('click', (e) => {
      const card = e.target.closest('.result-card');
      if (card) selectRoute(card.dataset.id);
    });

    // Exportar / importar / sync
    $('#btn-export')?.addEventListener('click', () => {
      const data = JSON.stringify(state.routes, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rutas-tuxtla-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    $('#btn-import')?.addEventListener('click', () => $('#import-file').click());
    $('#import-file')?.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('formato');
        for (const r of data) {
          if (r.id) await localDB.saveRoute(r);
        }
        const all = await localDB.getRoutes();
        state.routes = all;
        renderRoutesList();
        renderRoutesOnMap();
        renderSettings();
        showToast(`${data.length} rutas importadas`);
      } catch (err) {
        showToast('Error al importar');
      }
    });

    $('#btn-sync')?.addEventListener('click', async () => {
      if (!state.isOnline) {
        showToast('Sin conexión');
        return;
      }
      await processSyncQueue();
      const fb = await loadRoutesFromFirebase();
      state.routes = fb;
      for (const r of fb) await localDB.saveRoute(r);
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      showToast('Sincronizado');
    });

    $('#btn-clear-all')?.addEventListener('click', async () => {
      if (!confirm('¿Borrar TODAS las rutas? Esta acción no se puede deshacer.')) return;
      for (const r of state.routes) {
        await localDB.deleteRoute(r.id);
        if (state.isOnline)
          try {
            await deleteRouteFromFirebase(r.id);
          } catch (e) {}
      }
      state.routes = [];
      Object.values(state.routeLayers).forEach((l) => {
        if (l.polyline) state.map.removeLayer(l.polyline);
        l.markers?.forEach((m) => state.map.removeLayer(m));
      });
      state.routeLayers = {};
      state.selectedRouteId = null;
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      showToast('Todas las rutas eliminadas');
    });

    // Quick buttons
    $('#quick-center')?.addEventListener('click', () =>
      state.map.setView(TUXTLA_CENTER, DEFAULT_ZOOM)
    );
    $('#quick-locate')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('GPS no disponible');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => state.map.setView([pos.coords.latitude, pos.coords.longitude], 16),
        () => showToast('No se pudo obtener ubicación')
      );
    });

    // Publicar dialog
    $('#btn-do-publish')?.addEventListener('click', publishRoute);
    $('#btn-cancel-publish')?.addEventListener('click', () => {
      $('#publish-dialog').style.display = 'none';
      $('#publish-dialog').classList.remove('active');
    });

    // Online/offline
    window.addEventListener('online', () => {
      updateConnectionStatus();
      showToast('Conexión restaurada');
      processSyncQueue();
    });
    window.addEventListener('offline', () => {
      updateConnectionStatus();
      showToast('Modo offline');
    });
  }

  // ==================== DETECT ALL ====================
  async function detectAllNow() {
    if (state.trackedPoints.length < 2) {
      showToast('Traza la ruta primero');
      return;
    }
    $('#detecting-bar').classList.add('active');
    try {
      $('#detecting-text').textContent = 'Detectando calles...';
      const streets = await detectStreetsAlongRoute(state.trackedPoints, (i, t) => {
        $('#detecting-text').textContent = `Detectando calles... ${i}/${t}`;
      });
      state.detectedStreets = streets;
      renderStreetsList();

      $('#detecting-text').textContent = 'Detectando negocios...';
      const pois = await detectBusinessesAlongRoute(state.trackedPoints);
      state.detectedPois = [...state.detectedPois, ...pois];
      renderPoisEditList();
      pois.forEach((p) => renderPoiMarker(p));

      showToast(`Detectados: ${streets.length} calles, ${pois.length} negocios`);
    } catch (e) {
      console.error(e);
      showToast('Error detectando');
    } finally {
      $('#detecting-bar').classList.remove('active');
    }
  }

  // ==================== INIT ====================
  async function init() {
    // Aplicar modo UI
    applyUiMode(state.uiMode);

    await initDB();
    initMap();
    setupEventListeners();
    updateConnectionStatus();

    const localRoutes = await localDB.getRoutes();
    if (localRoutes.length > 0) {
      state.routes = localRoutes;
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
    }

    if (state.isOnline) {
      const fbRoutes = await loadRoutesFromFirebase();
      const merged = [...fbRoutes];
      localRoutes.forEach((l) => {
        if (!fbRoutes.find((f) => f.id === l.id)) merged.push(l);
      });
      state.routes = merged;
      for (const r of merged) await localDB.saveRoute(r);
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      processSyncQueue();
    }

    navigateTo('routes');
    setMapMode('half');

    window.addEventListener('resize', () =>
      setTimeout(() => state.map.invalidateSize(), 200)
    );
    setTimeout(() => state.map.invalidateSize(), 500);
  }

  // Exponer para HTML
  window.RutasApp = { state, showToast, openEditor, openPublishDialog };

  init().catch(console.error);
})();
