/* ============================================================
   RUTAS TUXTLA GUTIÉRREZ - APP.JS
   Versión corregida con modo simple/avanzado funcional
   ============================================================ */

(function () {
  'use strict';

  console.log('🚀 Rutas Tuxtla App iniciando...');

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

  function showToast(msg, dur) {
    dur = dur || 2500;
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, dur);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function escapeHtml(text) {
    if (text == null) return '';
    var div = document.createElement('div');
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
    var R = 6371000;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLon = ((lon2 - lon1) * Math.PI) / 180;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function pointToSegmentDistance(p, a, b) {
    var atob = { lat: b.lat - a.lat, lng: b.lng - a.lng };
    var atop = { lat: p.lat - a.lat, lng: p.lng - a.lng };
    var len = atob.lat * atob.lat + atob.lng * atob.lng;
    var t = len === 0 ? 0 : (atop.lat * atob.lat + atop.lng * atob.lng) / len;
    t = Math.max(0, Math.min(1, t));
    var closest = { lat: a.lat + t * atob.lat, lng: a.lng + t * atob.lng };
    return calculateDistance(p.lat, p.lng, closest.lat, closest.lng);
  }

  function pointToLineDistance(point, line) {
    if (!line || line.length < 2) return Infinity;
    var minDist = Infinity;
    for (var i = 0; i < line.length - 1; i++) {
      var d = pointToSegmentDistance(point, line[i], line[i + 1]);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  function updateConnectionStatus() {
    state.isOnline = navigator.onLine;
    var dot = $('#conn-dot');
    var txt = $('#conn-text');
    if (dot) dot.classList.toggle('offline', !state.isOnline);
    if (txt) txt.textContent = state.isOnline ? 'Online' : 'Offline';
  }

  // ==================== NOMINATIM ====================
  var geocodeCache = new Map();

  async function reverseGeocode(lat, lng) {
    var key = lat.toFixed(5) + ',' + lng.toFixed(5);
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      var res = await fetch(
        NOMINATIM_URL + '/reverse?lat=' + lat + '&lon=' + lng + '&format=json&addressdetails=1&accept-language=es',
        { headers: { 'User-Agent': 'RutasTuxtlaApp/1.0' } }
      );
      if (!res.ok) throw new Error('geocode');
      var data = await res.json();
      var result = {
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
      var res = await fetch(
        NOMINATIM_URL + '/search?q=' + encodeURIComponent(query) + '&format=json&addressdetails=1&limit=8&accept-language=es&countrycodes=mx',
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
    var sampleCount = Math.min(12, points.length);
    var step = Math.max(1, Math.floor(points.length / sampleCount));
    var samples = [];
    for (var i = 0; i < points.length; i += step) samples.push(points[i]);
    if (samples[samples.length - 1] !== points[points.length - 1])
      samples.push(points[points.length - 1]);

    var streets = [];
    var seen = new Set();
    for (var j = 0; j < samples.length; j++) {
      if (onProgress) onProgress(j + 1, samples.length);
      var p = samples[j];
      try {
        var r = await reverseGeocode(p.lat, p.lng);
        if (r && r.address) {
          var road =
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
      await new Promise(function (r) { setTimeout(r, 1100); });
    }
    return streets;
  }

  async function detectBusinessesAlongRoute(points) {
    var businesses = [];
    var sampleCount = Math.min(8, points.length);
    var step = Math.max(1, Math.floor(points.length / sampleCount));
    for (var i = 0; i < points.length; i += step) {
      var p = points[i];
      try {
        var r = await reverseGeocode(p.lat, p.lng);
        if (r && r.address) {
          var a = r.address;
          var amenity = a.amenity || a.shop || a.tourism || a.leisure;
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
      await new Promise(function (r) { setTimeout(r, 1100); });
    }
    return businesses;
  }

  // ==================== INDEXEDDB ====================
  async function initDB() {
    if (typeof idb === 'undefined') {
      console.warn('idb no cargado');
      return;
    }
    state.db = await idb.openDB('rutas-tuxtla-db', 2, {
      upgrade: function (db) {
        if (!db.objectStoreNames.contains('rutas')) db.createObjectStore('rutas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pois')) db.createObjectStore('pois', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sync-queue')) db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
      },
    });
  }

  var localDB = {
    saveRoute: async function (route) {
      if (!state.db) await initDB();
      if (state.db) await state.db.put('rutas', route);
    },
    getRoutes: async function () {
      if (!state.db) await initDB();
      if (!state.db) return [];
      return await state.db.getAll('rutas');
    },
    deleteRoute: async function (id) {
      if (!state.db) await initDB();
      if (state.db) await state.db.delete('rutas', id);
    },
    queueSync: async function (op) {
      if (!state.db) await initDB();
      if (state.db) await state.db.add('sync-queue', Object.assign({}, op, { ts: Date.now() }));
    },
    getQueue: async function () {
      if (!state.db) await initDB();
      if (!state.db) return [];
      return await state.db.getAll('sync-queue');
    },
    clearQueue: async function () {
      if (!state.db) await initDB();
      if (state.db) await state.db.clear('sync-queue');
    },
  };

  // ==================== FIREBASE ====================
  async function syncRouteToFirebase(route) {
    var url = FIREBASE_DB_URL + '/rutas/' + route.id + '.json';
    var res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, route, { updatedAt: Date.now() })),
    });
    if (!res.ok) throw new Error('sync');
    return res.json();
  }

  async function deleteRouteFromFirebase(id) {
    var res = await fetch(FIREBASE_DB_URL + '/rutas/' + id + '.json', { method: 'DELETE' });
    if (!res.ok) throw new Error('delete');
  }

  async function loadRoutesFromFirebase() {
    try {
      var res = await fetch(FIREBASE_DB_URL + '/rutas.json');
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      if (!data) return [];
      return Object.entries(data).map(function (entry) {
        return Object.assign({}, entry[1], { id: entry[0] });
      });
    } catch (e) {
      return [];
    }
  }

  async function processSyncQueue() {
    if (!state.isOnline) return;
    var queue = await localDB.getQueue();
    if (!queue.length) return;
    for (var i = 0; i < queue.length; i++) {
      var op = queue[i];
      try {
        if (op.type === 'save') await syncRouteToFirebase(op.route);
        else if (op.type === 'delete') await deleteRouteFromFirebase(op.id);
      } catch (e) {
        return;
      }
    }
    await localDB.clearQueue();
    showToast('Sincronización completada');
  }

  // ==================== CLOUDINARY ====================
  async function uploadImage(file) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_CONFIG.upload_preset);
    var res = await fetch(
      'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CONFIG.cloud_name + '/image/upload',
      { method: 'POST', body: fd }
    );
    if (!res.ok) throw new Error('upload');
    var data = await res.json();
    return data.secure_url;
  }

  // ==================== MAPA ====================
  function initMap() {
    if (typeof L === 'undefined') {
      console.error('Leaflet no cargado');
      return;
    }
    state.map = L.map('map', {
      center: TUXTLA_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(state.map);
    var hot = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OSM HOT',
    });
    L.control.layers({ 'Estándar': osm, 'Alto contraste': hot }, null, {
      position: 'bottomright',
    }).addTo(state.map);
    state.map.on('click', handleMapClick);
    setTimeout(function () { state.map.invalidateSize(); }, 300);
  }

  function handleMapClick(e) {
    var lat = e.latlng.lat;
    var lng = e.latlng.lng;
    if (state.isEditing) {
      if (state.activeTool === 'draw') addTrackedPoint({ lat: lat, lng: lng, tipo: 'manual' });
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
      html: '<div style="background:' + color + ';color:#fff;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.3)">' + letter + '</div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  // ==================== RENDER RUTAS ====================
  function renderRoutesList() {
    var container = $('#routes-list-container');
    if (!container) return;
    var filtered = state.routes.filter(function (r) {
      if (!state.filterText) return true;
      var s = state.filterText.toLowerCase();
      return (
        (r.nombre && r.nombre.toLowerCase().indexOf(s) >= 0) ||
        (r.descripcion && r.descripcion.toLowerCase().indexOf(s) >= 0) ||
        (r.empresa && r.empresa.toLowerCase().indexOf(s) >= 0)
      );
    });

    if (filtered.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>' +
        '<p>' + (state.filterText ? 'No se encontraron rutas' : 'No hay rutas registradas') + '</p>' +
        '<p class="small">Toca "+ Nueva Ruta" para agregar una</p>' +
        '</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (route) {
      var color = route.color || '#1e40af';
      var isSelected = state.selectedRouteId === route.id;
      var pts = (route.puntos && route.puntos.length) || 0;
      var streets = (route.streets && route.streets.length) || 0;
      var pois = (route.pois && route.pois.length) || 0;

      html += '<div class="route-card ' + (isSelected ? 'selected' : '') + '" data-id="' + route.id + '" style="--rc:' + color + '">';
      html += '<div class="route-card-head">';
      html += '<h3>' + escapeHtml(route.nombre || 'Sin nombre') + '</h3>';
      html += '<span class="badge badge-' + (route.tipo || 'ida') + '">' + (route.tipo || 'ida') + '</span>';
      html += '</div>';
      if (route.descripcion) {
        html += '<p class="route-desc">' + escapeHtml(route.descripcion) + '</p>';
      }
      html += '<div class="route-meta">';
      html += '<span>📍 ' + pts + ' pts</span>';
      if (streets) html += '<span>🛣️ ' + streets + ' calles</span>';
      if (pois) html += '<span>🏪 ' + pois + '</span>';
      if (route.tarifa) html += '<span>💰 ' + escapeHtml(route.tarifa) + '</span>';
      html += '</div>';
      html += '<div class="route-actions">';
      html += '<button class="btn btn-sm btn-primary" data-action="view" data-id="' + route.id + '">👁️ Ver</button>';
      html += '<button class="btn btn-sm btn-secondary" data-action="edit" data-id="' + route.id + '">✏️ Editar</button>';
      html += '<button class="btn btn-sm btn-success" data-action="publish" data-id="' + route.id + '">📤 Publicar</button>';
      html += '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + route.id + '">🗑️</button>';
      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.route-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        selectRoute(card.dataset.id);
      });
    });
    container.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.id;
        var action = btn.dataset.action;
        if (action === 'view') selectRoute(id);
        else if (action === 'edit') openEditor(id);
        else if (action === 'delete') deleteRoute(id);
        else if (action === 'publish') openPublishDialog(id);
      });
    });
  }

  function renderRoutesOnMap() {
    if (!state.map) return;
    Object.values(state.routeLayers).forEach(function (layer) {
      if (layer.polyline) state.map.removeLayer(layer.polyline);
      if (layer.markers) layer.markers.forEach(function (m) { state.map.removeLayer(m); });
    });
    state.routeLayers = {};

    if (state.routesVisibility === 'none') return;

    state.routes.forEach(function (route) {
      if (!route.puntos || route.puntos.length < 2) return;
      if (state.routesVisibility === 'selected' && state.selectedRouteId !== route.id) return;

      var coords = route.puntos.map(function (p) { return [p.lat, p.lng]; });
      var color = route.color || '#1e40af';

      var polyline = L.polyline(coords, {
        color: color,
        weight: 4,
        opacity: 0.8,
        lineJoin: 'round',
      }).addTo(state.map);

      var markers = [];
      var startIcon = L.divIcon({
        className: 'route-marker',
        html: '<div style="background:' + color + ';width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      markers.push(L.marker(coords[0], { icon: startIcon }).bindPopup('<b>' + escapeHtml(route.nombre) + '</b><br>Inicio').addTo(state.map));
      markers.push(L.marker(coords[coords.length - 1], { icon: startIcon }).bindPopup('<b>' + escapeHtml(route.nombre) + '</b><br>Fin').addTo(state.map));

      state.routeLayers[route.id] = { polyline: polyline, markers: markers, color: color };
    });
  }

  function selectRoute(id) {
    var route = state.routes.find(function (r) { return r.id === id; });
    if (!route) return;
    state.currentRoute = route;
    state.selectedRouteId = id;
    if (state.routesVisibility === 'selected' || state.routesVisibility === 'all')
      renderRoutesOnMap();
    renderRoutesList();
    if (state.routeLayers[id] && state.map) {
      state.map.fitBounds(state.routeLayers[id].polyline.getBounds(), { padding: [50, 50] });
      if (state.mapMode === 'hidden') setMapMode('half');
    }
    navigateTo('map');
    showToast('Ruta: ' + route.nombre);
  }

  // ==================== NAVEGACIÓN ====================
  function navigateTo(page) {
    state.currentPage = page;
    $$('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.page === page);
    });
    $$('.panel-page').forEach(function (p) {
      p.classList.toggle('active', p.id === 'page-' + page);
    });

    var tools = $('#map-tools');
    if (tools) {
      if (page === 'editor') {
        tools.classList.add('visible');
        if (!state.isEditing) state.isEditing = true;
      } else {
        tools.classList.remove('visible');
      }
    }

    var panel = $('#app-panel');
    if (panel) panel.classList.remove('hidden');

    if (state.mapMode === 'hidden' && (page === 'map' || page === 'editor' || page === 'trip')) {
      setMapMode('half');
    }

    if (page === 'routes') renderRoutesList();
    else if (page === 'trip') renderTripSearch();
    else if (page === 'settings') renderSettings();
    else if (page === 'blog') loadBlogPosts();

    if (state.map) setTimeout(function () { state.map.invalidateSize(); }, 350);
  }

  function setMapMode(mode) {
    state.mapMode = mode;
    var wrap = $('#map-wrap');
    if (!wrap) return;
    wrap.classList.remove('mode-full', 'mode-half', 'mode-hidden');
    wrap.classList.add('mode-' + mode);
    $$('.map-size-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.size === mode);
    });
    if (state.map) setTimeout(function () { state.map.invalidateSize(); }, 400);
  }

  // ==================== EDITOR ====================
  function openEditor(routeId) {
    state.editingRouteId = routeId || null;
    state.isEditing = true;
    state.trackedPoints = [];
    state.detectedStreets = [];
    state.detectedPois = [];

    var form = $('#route-form');
    if (form) form.reset();
    var idEl = $('#route-id');
    if (idEl) idEl.value = '';
    var prev = $('#image-preview');
    if (prev) {
      prev.style.display = 'none';
      prev.src = '';
    }
    var colorEl = $('#route-color');
    if (colorEl) colorEl.value = '#1e40af';
    $$('.color-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.color === '#1e40af');
    });

    if (routeId) {
      var titleEl = $('#editor-title');
      if (titleEl) titleEl.textContent = '✏️ Editar Ruta';
      var r = state.routes.find(function (x) { return x.id === routeId; });
      if (r) {
        setVal('#route-id', r.id);
        setVal('#route-name', r.nombre || '');
        setVal('#route-desc', r.descripcion || '');
        setVal('#route-type', r.tipo || 'ida');
        setVal('#route-company', r.empresa || '');
        setVal('#route-color', r.color || '#1e40af');
        setVal('#route-fare', r.tarifa || '');
        setVal('#route-frequency', r.frecuencia || '');
        setVal('#route-days', r.dias || 'todos');
        setVal('#route-accessible', r.accesible || 'no');
        setVal('#route-notes', r.notas || '');
        if (r.imagen && prev) {
          prev.src = r.imagen;
          prev.style.display = 'block';
        }
        state.trackedPoints = (r.puntos || []).slice();
        state.detectedStreets = (r.streets || []).slice();
        state.detectedPois = (r.pois || []).slice();
      }
    } else {
      var titleEl2 = $('#editor-title');
      if (titleEl2) titleEl2.textContent = '➕ Registrar Ruta';
    }

    renderEditingTrack();
    updatePointsUI();
    renderStreetsList();
    renderPoisEditList();
    navigateTo('editor');
    if (state.mapMode === 'hidden') setMapMode('half');
  }

  function setVal(sel, val) {
    var el = $(sel);
    if (el) el.value = val;
  }

  function closeEditor() {
    state.isEditing = false;
    state.editingRouteId = null;
    state.trackedPoints = [];
    state.detectedStreets = [];
    state.detectedPois = [];
    if (state.editingLayer && state.map) {
      state.map.removeLayer(state.editingLayer);
      state.editingLayer = null;
    }
    state.editingMarkers.forEach(function (m) {
      if (state.map) state.map.removeLayer(m);
    });
    state.editingMarkers = [];
    state.poiLayers.forEach(function (m) {
      if (state.map) state.map.removeLayer(m);
    });
    state.poiLayers = [];
    if (state.isTracking) stopTracking();
    var tools = $('#map-tools');
    if (tools) tools.classList.remove('visible');
    navigateTo('routes');
  }

  function addTrackedPoint(point) {
    state.trackedPoints.push(point);
    updatePointsUI();
    renderEditingTrack();
  }

  function renderEditingTrack() {
    if (!state.map) return;
    if (state.editingLayer) {
      state.map.removeLayer(state.editingLayer);
      state.editingLayer = null;
    }
    state.editingMarkers.forEach(function (m) { state.map.removeLayer(m); });
    state.editingMarkers = [];
    if (state.trackedPoints.length < 2) return;

    var coords = state.trackedPoints.map(function (p) { return [p.lat, p.lng]; });
    var colorEl = $('#route-color');
    state.editingLayer = L.polyline(coords, {
      color: colorEl ? colorEl.value : '#1e40af',
      weight: 5,
      opacity: 0.9,
      dashArray: state.isTracking ? '8, 8' : null,
    }).addTo(state.map);

    state.trackedPoints.forEach(function (p, i) {
      if (p.tipo === 'manual') {
        var marker = L.circleMarker([p.lat, p.lng], {
          radius: 7,
          fillColor: '#dc2626',
          color: '#fff',
          weight: 2,
          fillOpacity: 1,
        }).addTo(state.map);
        marker.bindPopup('Punto ' + (i + 1));
        state.editingMarkers.push(marker);
      }
    });
  }

  function updatePointsUI() {
    var c = state.trackedPoints.length;
    var el = $('#points-count');
    if (el) el.textContent = c;
    var rt = $('#recording-text');
    if (rt) rt.textContent = 'Grabando... ' + c + ' pts';
    var preview = $('#points-list-preview');
    if (preview) {
      if (c === 0) preview.textContent = 'Aún no hay puntos trazados.';
      else preview.textContent = '✅ ' + c + ' puntos trazados listos para guardar.';
    }
  }

  function renderStreetsList() {
    var container = $('#streets-list');
    if (!container) return;
    var count = $('#streets-count');
    if (count) count.textContent = state.detectedStreets.length;

    if (state.detectedStreets.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Traza la ruta primero y toca "Detectar ahora".</p>';
      return;
    }
    var html = '';
    state.detectedStreets.forEach(function (s, i) {
      html += '<div class="list-item">';
      html += '<div class="list-num">' + (i + 1) + '</div>';
      html += '<div class="list-body">';
      html += '<h4>' + escapeHtml(s.nombre) + '</h4>';
      if (s.colonia) html += '<p>Col. ' + escapeHtml(s.colonia) + '</p>';
      html += '</div>';
      html += '<div class="list-actions">';
      html += '<button class="icon-mini danger" data-action="rm-street" data-id="' + s.id + '">✕</button>';
      html += '</div>';
      html += '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('[data-action="rm-street"]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.detectedStreets = state.detectedStreets.filter(function (x) { return x.id !== b.dataset.id; });
        renderStreetsList();
      });
    });
  }

  function renderPoisEditList() {
    var container = $('#pois-list-edit');
    if (!container) return;
    var count = $('#pois-count');
    if (count) count.textContent = state.detectedPois.length;

    if (state.detectedPois.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px">No hay puntos de interés.</p>';
      return;
    }
    var html = '';
    state.detectedPois.forEach(function (p) {
      html += '<div class="list-item">';
      html += '<div class="list-icon">' + (p.icono || '📍') + '</div>';
      html += '<div class="list-body">';
      html += '<h4>' + escapeHtml(p.nombre) + '</h4>';
      html += '<p>' + escapeHtml(p.descripcion || '') + '</p>';
      html += '</div>';
      html += '<button class="icon-mini danger" data-action="rm-poi" data-id="' + p.id + '">✕</button>';
      html += '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('[data-action="rm-poi"]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.detectedPois = state.detectedPois.filter(function (x) { return x.id !== b.dataset.id; });
        renderPoisEditList();
      });
    });
  }

  function addPoiAtLocation(lat, lng) {
    var poi = {
      id: generateId(),
      lat: lat,
      lng: lng,
      nombre: 'Nuevo punto',
      descripcion: '',
      tipo: 'custom',
      icono: '📍',
    };
    state.detectedPois.push(poi);
    renderPoisEditList();
    renderPoiMarker(poi);
  }

  function renderPoiMarker(poi) {
    if (!state.map) return;
    var marker = L.marker([poi.lat, poi.lng], {
      icon: L.divIcon({
        className: 'editing-poi',
        html: '<div style="background:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid #1e40af">' + (poi.icono || '📍') + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
      draggable: true,
    }).addTo(state.map);
    marker.on('dragend', function (e) {
      var pos = e.target.getLatLng();
      poi.lat = pos.lat;
      poi.lng = pos.lng;
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
    var bar = $('#recording-bar');
    if (bar) bar.classList.add('active');
    state.watchId = navigator.geolocation.watchPosition(
      function (pos) {
        var latitude = pos.coords.latitude;
        var longitude = pos.coords.longitude;
        addTrackedPoint({
          lat: latitude,
          lng: longitude,
          accuracy: pos.coords.accuracy,
          tipo: 'gps',
          timestamp: pos.timestamp,
        });
        if (state.map) state.map.setView([latitude, longitude], 16);
      },
      function (err) {
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
    var bar = $('#recording-bar');
    if (bar) bar.classList.remove('active');
    showToast('Detenido: ' + state.trackedPoints.length + ' puntos');
  }

  // ==================== BUSCAR VIAJE ====================
  function renderTripSearch() {
    renderSearchPointsList();
    var r = $('#search-radius');
    if (r) r.value = state.searchRadius;
    var rv = $('#radius-value');
    if (rv) rv.textContent = state.searchRadius + 'm';
  }

  function addSearchPoint(lat, lng) {
    if (state.searchPoints.length >= 3) {
      showToast('Máximo 3 puntos (A, B, C)');
      return;
    }
    var letter = String.fromCharCode(65 + state.searchPoints.length);
    var colors = { A: '#16a34a', B: '#dc2626', C: '#f59e0b' };
    var color = colors[letter] || '#1e40af';
    var point = { lat: lat, lng: lng, letter: letter, color: color };
    state.searchPoints.push(point);

    if (state.map) {
      var marker = L.marker([lat, lng], { icon: createLetterIcon(letter, color) }).addTo(state.map);
      var circle = L.circle([lat, lng], {
        radius: state.searchRadius,
        color: color,
        fillColor: color,
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5',
      }).addTo(state.map);
      marker._circle = circle;
      state.searchMarkers.push(marker);
    }

    renderSearchPointsList();
    if (state.mapMode === 'hidden') setMapMode('half');
    showToast('Punto ' + letter + ' marcado');
  }

  function renderSearchPointsList() {
    var container = $('#search-points-list');
    if (!container) return;
    if (state.searchPoints.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;background:var(--bg);border-radius:10px;margin-bottom:10px">Sin puntos marcados. Toca el mapa.</p>';
      return;
    }
    var html = '';
    state.searchPoints.forEach(function (p, i) {
      html += '<div class="search-point">';
      html += '<div class="search-letter ' + p.letter + '">' + p.letter + '</div>';
      html += '<div class="search-info">';
      html += '<h4>Punto ' + p.letter + '</h4>';
      html += '<p>' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</p>';
      html += '</div>';
      html += '<button class="icon-mini danger" data-idx="' + i + '">✕</button>';
      html += '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('[data-idx]').forEach(function (b) {
      b.addEventListener('click', function () { removeSearchPoint(parseInt(b.dataset.idx)); });
    });
  }

  function removeSearchPoint(index) {
    var marker = state.searchMarkers[index];
    if (marker && state.map) {
      if (marker._circle) state.map.removeLayer(marker._circle);
      state.map.removeLayer(marker);
    }
    state.searchPoints.splice(index, 1);
    state.searchMarkers.splice(index, 1);
    renderSearchPointsList();
  }

  function clearSearchPoints() {
    state.searchPoints = [];
    state.searchMarkers.forEach(function (m) {
      if (m._circle && state.map) state.map.removeLayer(m._circle);
      if (state.map) state.map.removeLayer(m);
    });
    state.searchMarkers = [];
    state.searchRouteLayers.forEach(function (l) {
      if (state.map) state.map.removeLayer(l);
    });
    state.searchRouteLayers = [];
    renderSearchPointsList();
    var results = $('#search-results');
    if (results) results.innerHTML = '';
  }

  async function performTripSearch() {
    if (state.searchPoints.length < 2) {
      showToast('Marca al menos 2 puntos');
      return;
    }
    state.searchRouteLayers.forEach(function (l) {
      if (state.map) state.map.removeLayer(l);
    });
    state.searchRouteLayers = [];

    var radius = state.searchRadius;
    var resultsEl = $('#search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div class="loading"><div class="spinner"></div><span>Buscando rutas...</span></div>';

    var routesPerPoint = state.searchPoints.map(function (p) {
      return { point: p, routes: findRoutesNearPoint(p, radius) };
    });

    var routesThroughAll = state.routes.filter(function (route) {
      if (!route.puntos || route.puntos.length < 2) return false;
      return routesPerPoint.every(function (rp) {
        return rp.routes.some(function (r) { return r.id === route.id; });
      });
    });

    var routesThrough2 = state.routes.filter(function (route) {
      if (!route.puntos || route.puntos.length < 2) return false;
      var count = routesPerPoint.filter(function (rp) {
        return rp.routes.some(function (r) { return r.id === route.id; });
      }).length;
      return count >= 2;
    });

    var html = '';
    if (routesThroughAll.length > 0) {
      html += '<h3 style="font-size:14px;margin-bottom:10px;color:var(--success);font-weight:800">✅ Rutas que pasan por todos los puntos</h3>';
      routesThroughAll.forEach(function (route) {
        html += renderRouteResultCard(route, 'success');
        drawSearchRoute(route, '#16a34a');
      });
    }
    if (routesThrough2.length > 0) {
      html += '<h3 style="font-size:14px;margin:14px 0 10px;color:var(--warning);font-weight:800">🔄 Rutas que conectan varios puntos</h3>';
      routesThrough2
        .filter(function (r) { return routesThroughAll.indexOf(r) === -1; })
        .forEach(function (route) {
          html += renderRouteResultCard(route, 'warning');
          drawSearchRoute(route, '#f59e0b');
        });
    }

    var singleRoutes = routesPerPoint.map(function (rp) {
      return {
        point: rp.point,
        routes: rp.routes.filter(function (r) { return routesThrough2.indexOf(r) === -1; }),
      };
    });

    var hasSingles = singleRoutes.some(function (s) { return s.routes.length > 0; });
    if (hasSingles) {
      html += '<h3 style="font-size:14px;margin:14px 0 10px;color:var(--primary);font-weight:800">📍 Rutas cercanas a cada punto</h3>';
      singleRoutes.forEach(function (sr) {
        if (sr.routes.length === 0) return;
        html += '<p style="font-size:13px;font-weight:700;margin:8px 0 6px">Punto ' + sr.point.letter + ':</p>';
        sr.routes.forEach(function (route) {
          html += renderRouteResultCard(route, 'primary');
          drawSearchRoute(route, '#1e40af');
        });
      });
    }
    if (!html) {
      html = '<div class="empty-state"><p>No se encontraron rutas cerca</p><p class="small">Intenta aumentar el radio</p></div>';
    }
    resultsEl.innerHTML = html;
  }

  function renderRouteResultCard(route, type) {
    var color = route.color || '#1e40af';
    var streets = (route.streets && route.streets.length) || 0;
    var html = '<div class="result-card ' + type + '" data-id="' + route.id + '" style="border-left-color:' + color + ';background:#fff;border:2px solid #e2e8f0;border-left-width:6px;border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer">';
    html += '<div class="route-card-head">';
    html += '<h3 style="font-size:16px;font-weight:800;color:#0f172a">' + escapeHtml(route.nombre) + '</h3>';
    html += '<span class="badge badge-' + (route.tipo || 'ida') + '">' + (route.tipo || 'ida') + '</span>';
    html += '</div>';
    html += '<div class="route-meta" style="margin-top:8px">';
    html += '<span>🛣️ ' + streets + ' calles</span>';
    if (route.tarifa) html += '<span>💰 ' + escapeHtml(route.tarifa) + '</span>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function drawSearchRoute(route, color) {
    if (!route.puntos || route.puntos.length < 2 || !state.map) return;
    var coords = route.puntos.map(function (p) { return [p.lat, p.lng]; });
    var line = L.polyline(coords, {
      color: color,
      weight: 5,
      opacity: 0.75,
      dashArray: '10, 6',
    }).addTo(state.map);
    state.searchRouteLayers.push(line);
  }

  function findRoutesNearPoint(point, radius) {
    return state.routes.filter(function (route) {
      if (!route.puntos || route.puntos.length < 2) return false;
      return pointToLineDistance(point, route.puntos) <= radius;
    });
  }

  // ==================== GUARDAR ====================
  async function saveRoute() {
    var nameEl = $('#route-name');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      showToast('Ingresa un nombre');
      return;
    }
    if (state.trackedPoints.length < 2) {
      showToast('Necesitas al menos 2 puntos en el mapa');
      return;
    }

    var btn = $('#btn-save');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando...';
    }

    try {
      var routeId = ($('#route-id') && $('#route-id').value) || generateId();
      var imgFile = $('#route-image') && $('#route-image').files[0];
      var imageUrl = null;

      if (imgFile) {
        if (state.isOnline) {
          try {
            imageUrl = await uploadImage(imgFile);
          } catch (e) {
            console.error(e);
          }
        }
        if (!imageUrl) {
          imageUrl = await new Promise(function (res) {
            var r = new FileReader();
            r.onload = function (ev) { res(ev.target.result); };
            r.readAsDataURL(imgFile);
          });
        }
      } else if ($('#image-preview') && $('#image-preview').src && $('#image-preview').style.display !== 'none') {
        imageUrl = $('#image-preview').src;
      }

      var existing = state.routes.find(function (r) { return r.id === routeId; });

      var route = {
        id: routeId,
        nombre: name,
        descripcion: getVal('#route-desc'),
        tipo: getVal('#route-type') || 'ida',
        empresa: getVal('#route-company'),
        color: getVal('#route-color') || '#1e40af',
        tarifa: getVal('#route-fare'),
        frecuencia: getVal('#route-frequency'),
        horario: getVal('#route-schedule') + ' - ' + getVal('#route-schedule-end'),
        dias: getVal('#route-days') || 'todos',
        accesible: getVal('#route-accessible') || 'no',
        notas: getVal('#route-notes'),
        imagen: imageUrl,
        puntos: state.trackedPoints.slice(),
        streets: state.detectedStreets.slice(),
        pois: state.detectedPois.slice(),
        createdAt: (existing && existing.createdAt) || Date.now(),
        updatedAt: Date.now(),
      };

      await localDB.saveRoute(route);

      if (state.isOnline) {
        try {
          await syncRouteToFirebase(route);
          showToast('✅ Ruta guardada y sincronizada');
        } catch (e) {
          await localDB.queueSync({ type: 'save', route: route });
          showToast('💾 Guardado local (pendiente sync)');
        }
      } else {
        await localDB.queueSync({ type: 'save', route: route });
        showToast('💾 Ruta guardada offline');
      }

      var idx = state.routes.findIndex(function (r) { return r.id === routeId; });
      if (idx >= 0) state.routes[idx] = route;
      else state.routes.push(route);

      state.selectedRouteId = routeId;
      state.routesVisibility = 'all';
      $$('#visibility-chips .chip').forEach(function (c) {
        c.classList.toggle('active', c.dataset.visibility === 'all');
      });

      renderRoutesList();
      renderRoutesOnMap();

      closeEditor();

      setTimeout(function () {
        if (confirm('¿Publicar esta ruta como post en el blog para Google?')) {
          openPublishDialog(routeId);
        }
      }, 500);
    } catch (e) {
      console.error(e);
      showToast('Error al guardar: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💾 Guardar Ruta';
      }
    }
  }

  function getVal(sel) {
    var el = $(sel);
    return el ? el.value.trim() : '';
  }

  async function deleteRoute(id) {
    var route = state.routes.find(function (r) { return r.id === id; });
    if (!route) return;
    if (!confirm('¿Eliminar "' + route.nombre + '"?')) return;
    try {
      await localDB.deleteRoute(id);
      if (state.isOnline) {
        try {
          await deleteRouteFromFirebase(id);
        } catch (e) {
          await localDB.queueSync({ type: 'delete', id: id });
        }
      } else {
        await localDB.queueSync({ type: 'delete', id: id });
      }
      state.routes = state.routes.filter(function (r) { return r.id !== id; });
      if (state.routeLayers[id] && state.map) {
        if (state.routeLayers[id].polyline) state.map.removeLayer(state.routeLayers[id].polyline);
        if (state.routeLayers[id].markers) {
          state.routeLayers[id].markers.forEach(function (m) { state.map.removeLayer(m); });
        }
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
    var route = state.routes.find(function (r) { return r.id === routeId; });
    if (!route) return;
    state.pendingPublishRoute = route;

    var dialog = $('#publish-dialog');
    if (!dialog) {
      showToast('No hay diálogo de publicación');
      return;
    }

    setVal('#publish-slug', slugify(route.nombre));
    setVal('#publish-title', route.nombre);
    setVal('#publish-description', route.descripcion || 'Ruta de transporte en Tuxtla Gutiérrez: ' + route.nombre);
    setVal('#publish-content', route.descripcion || 'Recorrido de la ruta ' + route.nombre);
    setVal('#publish-password', '');

    var prev = $('#publish-preview');
    if (prev) {
      if (route.imagen) {
        prev.src = route.imagen;
        prev.style.display = 'block';
      } else {
        prev.style.display = 'none';
      }
    }

    dialog.style.display = 'flex';
  }

  async function publishRoute() {
    var route = state.pendingPublishRoute;
    if (!route) return;

    var password = getVal('#publish-password');
    if (!password) {
      showToast('Ingresa la contraseña');
      return;
    }

    var btn = $('#btn-do-publish');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Publicando...';
    }

    try {
      var payload = {
        password: password,
        slug: getVal('#publish-slug'),
        title: getVal('#publish-title'),
        description: getVal('#publish-description'),
        content: getVal('#publish-content'),
        image: route.imagen || '',
        routeData: route,
        mapPoints: route.puntos || [],
        streets: (route.streets || []).map(function (s) { return s.nombre; }),
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

      var res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      var data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Error ' + res.status);
      }

      showToast('✅ Post publicado');
      var dialog = $('#publish-dialog');
      if (dialog) dialog.style.display = 'none';

      if (confirm('¿Ver el post publicado?')) {
        window.open(data.url, '_blank');
      }
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Publicar';
      }
    }
  }

  // ==================== BLOG ====================
  async function loadBlogPosts() {
    var grid = $('#blog-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading"><div class="spinner"></div><span>Cargando posts...</span></div>';

    try {
      var posts = [];
      try {
        var res = await fetch('/api/posts');
        if (res.ok) {
          var data = await res.json();
          posts = data.posts || [];
        }
      } catch (e) {}

      if (!posts.length) {
        try {
          var res2 = await fetch('/paginas/posts-index.json');
          if (res2.ok) {
            var data2 = await res2.json();
            posts = data2.posts || [];
          }
        } catch (e) {}
      }

      if (!posts.length) {
        grid.innerHTML = '<div class="empty-state"><p>No hay posts publicados</p></div>';
        return;
      }

      var html = '';
      posts.forEach(function (post) {
        var img = post.image ? '<img src="' + escapeHtml(post.image) + '" alt="' + escapeHtml(post.title) + '" loading="lazy">' : '🚌';
        html += '<a class="blog-card" href="/' + escapeHtml(post.url) + '">';
        html += '<div class="blog-card-img">' + img + '</div>';
        html += '<div class="blog-card-body">';
        html += '<h2>' + escapeHtml(post.title) + '</h2>';
        html += '<p>' + escapeHtml(post.description || 'Ruta de transporte') + '</p>';
        html += '<div class="blog-card-meta">';
        html += '<span>🚌 ' + escapeHtml(post.tipo || 'ida') + '</span>';
        html += '<span>📍 ' + (post.calles || 0) + ' calles</span>';
        html += '</div>';
        html += '</div>';
        html += '</a>';
      });
      grid.innerHTML = html;
    } catch (e) {
      console.error(e);
      grid.innerHTML = '<div class="empty-state"><p>Error cargando posts</p></div>';
    }
  }

  // ==================== AJUSTES ====================
  function renderSettings() {
    var totalStreets = state.routes.reduce(function (s, r) { return s + ((r.streets && r.streets.length) || 0); }, 0);
    var totalPois = state.routes.reduce(function (s, r) { return s + ((r.pois && r.pois.length) || 0); }, 0);
    var totalPoints = state.routes.reduce(function (s, r) { return s + ((r.puntos && r.puntos.length) || 0); }, 0);
    var set = function (id, v) {
      var el = $(id);
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
    var input = $('#search-input');
    if (!input) return;
    var q = input.value.trim();
    state.filterText = q;
    renderRoutesList();
    navigateTo('routes');
    if (!q || q.length < 3) return;
    var results = await searchPlaces(q);
    if (results.length && state.map) {
      var r = results[0];
      var lat = parseFloat(r.lat);
      var lng = parseFloat(r.lon);
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
    document.body.classList.add('mode-' + mode);
    $$('.mode-toggle').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  // ==================== EVENTOS ====================
  function setupEventListeners() {
    // Modo
    $$('.mode-toggle').forEach(function (b) {
      b.addEventListener('click', function () { applyUiMode(b.dataset.mode); });
    });

    // Búsqueda
    var si = $('#search-input');
    if (si) {
      si.addEventListener('input', function (e) {
        state.filterText = e.target.value.trim();
        if (state.currentPage !== 'routes' && state.filterText) navigateTo('routes');
        renderRoutesList();
      });
      si.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearch();
        }
      });
    }
    var sb = $('#search-btn');
    if (sb) sb.addEventListener('click', handleSearch);

    // Nav
    $$('.nav-item').forEach(function (n) {
      n.addEventListener('click', function () { navigateTo(n.dataset.page); });
    });

    // Mapa controles
    var bt = $('#btn-map-toggle');
    if (bt) bt.addEventListener('click', function () {
      setMapMode(state.mapMode === 'hidden' ? 'half' : 'hidden');
    });
    var bf = $('#btn-map-fullscreen');
    if (bf) bf.addEventListener('click', function () {
      setMapMode(state.mapMode === 'full' ? 'half' : 'full');
    });
    $$('.map-size-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMapMode(b.dataset.size); });
    });
    $$('[data-mapsize]').forEach(function (b) {
      b.addEventListener('click', function () { setMapMode(b.dataset.mapsize); });
    });

    // Chips
    $$('#visibility-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        state.routesVisibility = c.dataset.visibility;
        $$('#visibility-chips .chip').forEach(function (x) {
          x.classList.toggle('active', x === c);
        });
        renderRoutesOnMap();
      });
    });

    // Nueva ruta
    var nr = $('#btn-new-route-list');
    if (nr) nr.addEventListener('click', function () { openEditor(null); });
    var qa = $('#quick-add-route');
    if (qa) qa.addEventListener('click', function () { openEditor(null); });

    // Herramientas
    $$('.tool-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tool = btn.dataset.tool;
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
        $$('.tool-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.activeTool = tool;
      });
    });

    // GPS editor
    var st = $('#btn-start-tracking');
    if (st) st.addEventListener('click', function () {
      if (state.isTracking) stopTracking();
      else startTracking();
    });
    var qg = $('#quick-gps');
    if (qg) qg.addEventListener('click', function () {
      if (!state.isEditing) openEditor(null);
      setTimeout(function () {
        if (!state.isTracking) startTracking();
      }, 300);
    });
    var sr = $('#btn-stop-recording');
    if (sr) sr.addEventListener('click', stopTracking);

    var cp = $('#btn-clear-points');
    if (cp) cp.addEventListener('click', function () {
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
    var ds = $('#btn-detect-streets');
    if (ds) ds.addEventListener('click', async function () {
      if (state.trackedPoints.length < 2) {
        showToast('Traza la ruta primero');
        return;
      }
      var bar = $('#detecting-bar');
      if (bar) bar.classList.add('active');
      try {
        var streets = await detectStreetsAlongRoute(state.trackedPoints, function (i, t) {
          var dt = $('#detecting-text');
          if (dt) dt.textContent = 'Detectando calles... ' + i + '/' + t;
        });
        state.detectedStreets = streets;
        renderStreetsList();
        showToast(streets.length + ' calles detectadas');
      } catch (e) {
        showToast('Error en detección');
      } finally {
        if (bar) bar.classList.remove('active');
      }
    });

    var ro = $('#btn-reverse-order');
    if (ro) ro.addEventListener('click', function () {
      state.detectedStreets.reverse();
      renderStreetsList();
      showToast('Orden invertido');
    });

    var db = $('#btn-detect-businesses');
    if (db) db.addEventListener('click', async function () {
      if (state.trackedPoints.length < 2) {
        showToast('Traza la ruta primero');
        return;
      }
      var bar = $('#detecting-bar');
      if (bar) bar.classList.add('active');
      try {
        var pois = await detectBusinessesAlongRoute(state.trackedPoints);
        state.detectedPois = state.detectedPois.concat(pois);
        renderPoisEditList();
        pois.forEach(function (p) { renderPoiMarker(p); });
        showToast(pois.length + ' negocios detectados');
      } catch (e) {
        showToast('Error en detección');
      } finally {
        if (bar) bar.classList.remove('active');
      }
    });

    var acp = $('#btn-add-custom-poi');
    if (acp) acp.addEventListener('click', function () {
      state.activeTool = 'poi';
      $$('.tool-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tool === 'poi');
      });
      showToast('Toca el mapa para agregar un punto');
    });

    // Imagen
    var iu = $('#image-upload-area');
    if (iu) iu.addEventListener('click', function () {
      var ri = $('#route-image');
      if (ri) ri.click();
    });
    var ri = $('#route-image');
    if (ri) ri.addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (f) {
        var r = new FileReader();
        r.onload = function (ev) {
          var p = $('#image-preview');
          if (p) {
            p.src = ev.target.result;
            p.style.display = 'block';
          }
        };
        r.readAsDataURL(f);
      }
    });

    // Guardar / cancelar
    var bs = $('#btn-save');
    if (bs) bs.addEventListener('click', saveRoute);
    var bc = $('#btn-cancel-edit');
    if (bc) bc.addEventListener('click', function () {
      if (confirm('¿Descartar cambios?')) closeEditor();
    });

    // Color
    $$('.color-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        $$('.color-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var rc = $('#route-color');
        if (rc) rc.value = chip.dataset.color;
        if (state.editingLayer) state.editingLayer.setStyle({ color: chip.dataset.color });
      });
    });

    // Buscar viaje
    var asp = $('#btn-add-search-point');
    if (asp) asp.addEventListener('click', function () {
      if (state.searchPoints.length >= 3) {
        showToast('Máximo 3 puntos');
        return;
      }
      if (!navigator.geolocation) {
        showToast('GPS no disponible');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { addSearchPoint(pos.coords.latitude, pos.coords.longitude); },
        function () { showToast('No se pudo obtener ubicación'); }
      );
    });
    var csp = $('#btn-clear-search-points');
    if (csp) csp.addEventListener('click', clearSearchPoints);
    var bst = $('#btn-search-trip');
    if (bst) bst.addEventListener('click', performTripSearch);
    var srad = $('#search-radius');
    if (srad) srad.addEventListener('input', function (e) {
      state.searchRadius = parseInt(e.target.value);
      var rv = $('#radius-value');
      if (rv) rv.textContent = state.searchRadius + 'm';
      state.searchMarkers.forEach(function (m) {
        if (m._circle) m._circle.setRadius(state.searchRadius);
      });
    });

    document.addEventListener('click', function (e) {
      var card = e.target.closest('.result-card');
      if (card && card.dataset.id) selectRoute(card.dataset.id);
    });

    // Export
    var be = $('#btn-export');
    if (be) be.addEventListener('click', function () {
      var data = JSON.stringify(state.routes, null, 2);
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'rutas-tuxtla-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    var bi = $('#btn-import');
    if (bi) bi.addEventListener('click', function () {
      var fi = $('#import-file');
      if (fi) fi.click();
    });
    var fi = $('#import-file');
    if (fi) fi.addEventListener('change', async function (e) {
      var f = e.target.files[0];
      if (!f) return;
      try {
        var text = await f.text();
        var data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('formato');
        for (var i = 0; i < data.length; i++) {
          if (data[i].id) await localDB.saveRoute(data[i]);
        }
        var all = await localDB.getRoutes();
        state.routes = all;
        renderRoutesList();
        renderRoutesOnMap();
        renderSettings();
        showToast(data.length + ' rutas importadas');
      } catch (err) {
        showToast('Error al importar');
      }
    });

    var bsy = $('#btn-sync');
    if (bsy) bsy.addEventListener('click', async function () {
      if (!state.isOnline) {
        showToast('Sin conexión');
        return;
      }
      await processSyncQueue();
      var fb = await loadRoutesFromFirebase();
      state.routes = fb;
      for (var i = 0; i < fb.length; i++) {
        await localDB.saveRoute(fb[i]);
      }
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      showToast('Sincronizado');
    });

    var bca = $('#btn-clear-all');
    if (bca) bca.addEventListener('click', async function () {
      if (!confirm('¿Borrar TODAS las rutas?')) return;
      for (var i = 0; i < state.routes.length; i++) {
        await localDB.deleteRoute(state.routes[i].id);
        if (state.isOnline) {
          try {
            await deleteRouteFromFirebase(state.routes[i].id);
          } catch (e) {}
        }
      }
      state.routes = [];
      Object.values(state.routeLayers).forEach(function (l) {
        if (l.polyline && state.map) state.map.removeLayer(l.polyline);
        if (l.markers) l.markers.forEach(function (m) { if (state.map) state.map.removeLayer(m); });
      });
      state.routeLayers = {};
      state.selectedRouteId = null;
      renderRoutesList();
      renderRoutesOnMap();
      renderSettings();
      showToast('Todas las rutas eliminadas');
    });

    // Quick buttons
    var qc = $('#quick-center');
    if (qc) qc.addEventListener('click', function () {
      if (state.map) state.map.setView(TUXTLA_CENTER, DEFAULT_ZOOM);
    });
    var ql = $('#quick-locate');
    if (ql) ql.addEventListener('click', function () {
      if (!navigator.geolocation) {
        showToast('GPS no disponible');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (state.map) state.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
        },
        function () { showToast('No se pudo obtener ubicación'); }
      );
    });

    // Publicar
    var bdp = $('#btn-do-publish');
    if (bdp) bdp.addEventListener('click', publishRoute);
    var bcp = $('#btn-cancel-publish');
    if (bcp) bcp.addEventListener('click', function () {
      var d = $('#publish-dialog');
      if (d) d.style.display = 'none';
    });

    // Online/Offline
    window.addEventListener('online', function () {
      updateConnectionStatus();
      showToast('Conexión restaurada');
      processSyncQueue();
    });
    window.addEventListener('offline', function () {
      updateConnectionStatus();
      showToast('Modo offline');
    });
  }

  async function detectAllNow() {
    if (state.trackedPoints.length < 2) {
      showToast('Traza la ruta primero');
      return;
    }
    var bar = $('#detecting-bar');
    if (bar) bar.classList.add('active');
    try {
      var dt = $('#detecting-text');
      if (dt) dt.textContent = 'Detectando calles...';
      var streets = await detectStreetsAlongRoute(state.trackedPoints, function (i, t) {
        if (dt) dt.textContent = 'Detectando calles... ' + i + '/' + t;
      });
      state.detectedStreets = streets;
      renderStreetsList();

      if (dt) dt.textContent = 'Detectando negocios...';
      var pois = await detectBusinessesAlongRoute(state.trackedPoints);
      state.detectedPois = state.detectedPois.concat(pois);
      renderPoisEditList();
      pois.forEach(function (p) { renderPoiMarker(p); });

      showToast('Detectados: ' + streets.length + ' calles, ' + pois.length + ' negocios');
    } catch (e) {
      console.error(e);
      showToast('Error detectando');
    } finally {
      if (bar) bar.classList.remove('active');
    }
  }

  // ==================== INIT ====================
  async function init() {
    console.log('✅ Iniciando init...');
    applyUiMode(state.uiMode);
    console.log('✅ Modo UI aplicado:', state.uiMode);

    try {
      await initDB();
      console.log('✅ DB lista');
    } catch (e) {
      console.warn('⚠️ DB error:', e);
    }

    initMap();
    console.log('✅ Mapa listo');

    setupEventListeners();
    console.log('✅ Eventos configurados');

    updateConnectionStatus();

    try {
      var localRoutes = await localDB.getRoutes();
      if (localRoutes.length > 0) {
        state.routes = localRoutes;
        renderRoutesList();
        renderRoutesOnMap();
        renderSettings();
      }
    } catch (e) {
      console.warn('Error cargando rutas locales:', e);
    }

    if (state.isOnline) {
      try {
        var fbRoutes = await loadRoutesFromFirebase();
        var merged = fbRoutes.slice();
        state.routes.forEach(function (l) {
          if (!fbRoutes.find(function (f) { return f.id === l.id; })) merged.push(l);
        });
        state.routes = merged;
        for (var i = 0; i < merged.length; i++) {
          await localDB.saveRoute(merged[i]);
        }
        renderRoutesList();
        renderRoutesOnMap();
        renderSettings();
        processSyncQueue();
      } catch (e) {
        console.warn('Error cargando Firebase:', e);
      }
    }

    navigateTo('routes');
    setMapMode('half');

    window.addEventListener('resize', function () {
      if (state.map) setTimeout(function () { state.map.invalidateSize(); }, 200);
    });

    setTimeout(function () {
      if (state.map) state.map.invalidateSize();
    }, 500);

    console.log('🎉 App lista');
  }

  // Exponer
  window.RutasApp = {
    state: state,
    showToast: showToast,
    openEditor: openEditor,
    openPublishDialog: openPublishDialog,
  };

  // Arrancar cuando DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
