/* ==========================================================================
   APP.JS — Motor principal de la PWA
   Estado global, mapa Leaflet, rutas, búsqueda, editor, navegación, Firebase
   ========================================================================== */
(function (global) {
  'use strict';

  // ==================== CONFIGURACIÓN ====================
  const FIREBASE_CONFIG = {
 apiKey: "AIzaSyASox7mRak5V0py29htEVWCVeipGpA0yfs",
  authDomain: "galloslivebadge.firebaseapp.com",
  databaseURL: "https://galloslivebadge-default-rtdb.firebaseio.com",
  projectId: "galloslivebadge",
  storageBucket: "galloslivebadge.firebasestorage.app",
  messagingSenderId: "979482928760",
  appId: "1:979482928760:web:3ea879dc4ee1e020df6f8d",
  measurementId: "G-8L3Z484S3D"
  };

const DEFAULT_CENTER = [16.7530, -93.1150];
  const DEFAULT_ZOOM = 13;

  // ==================== UTILIDADES ====================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const norm = s => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[',.\s]+/g, ' ')
    .trim();

  const splitList = v => String(v || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);

  const fmtTime = ts => {
    const d = new Date(ts);
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h';
    if (diff < 604800) return Math.floor(diff / 86400) + ' d';
    return d.toLocaleDateString();
  };

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
      t.style.opacity = '0';
      t.style.transform = 'translateY(-10px)';
      t.style.transition = 'all .3s';
      setTimeout(() => t.remove(), 300);
    }, 2800);
  }

  // ==================== ESTADO GLOBAL ====================
  const state = {
    currentPage: 'routes',
    currentTab: 'routes',
    routeMode: 'rutas',
    routes: [],
    posts: [],
    market: [],
    filteredMarket: [],
    marketFilter: 'all',
    marketQuery: '',
    currentRoute: null,
    currentPost: null,
    currentMarket: null,
    isAdmin: false,
    online: navigator.onLine,
    historyStack: [],
    // Editor
    editingRoute: null,
    routeDraft: { puntos: [], puntosVuelta: [], calles: [], pois: [], geometriaIda: [], geometriaVuelta: [], colorIda: '#00e5ff', colorVuelta: '#a855f7' },
    editorMap: null,
    editorLayers: { ida: null, vuelta: null, markers: [] },
    drawMode: 'draw',
    drawing: false,
    gpsWatch: null,
    // Mapa principal
    map: null,
    mapLayers: {},
    // Trip search
    tripMap: null,
    tripPoints: [],
    tripMarkers: [],
    tripCircles: [],
    tripRadius: 300,
    userReactivated: false,   // ← NUEVA bandera: el usuario reactivó "+Agregar" manualmente
    // Firebase
    fbDB: null,
    // Comentarios
    commentPostId: null
  };
  global.__APP_STATE__ = state;

  // ==================== FIREBASE ====================
  let fbDB = null;
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      fbDB = firebase.database();
      state.fbDB = fbDB;
    }
  } catch (e) { console.warn('[Firebase] No inicializado:', e); }

  // ==================== NAVEGACIÓN / HISTORIAL ====================
  function buildURL(params) {
    const url = new URL(location.origin + location.pathname);
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
    return url.pathname + (url.search ? url.search : '');
  }

  function pushURL(params, replace = false) {
    const url = buildURL(params);
    const fn = replace ? 'replaceState' : 'pushState';
    history[fn]({ ...params, __ts: Date.now() }, '', url);
    state.historyStack.push({ ...params, __ts: Date.now() });
    try { DB.pushHistory({ params, url, at: Date.now() }); } catch (e) {}
  }

  function navigateTo(page, opts = {}) {
    opts = opts || {};
    // Ocultar todas las páginas
    $$('.page').forEach(p => p.classList.remove('active'));
    const el = $('#page-' + page);
    if (el) el.classList.add('active');

    state.currentPage = page;

    // Nav inferior
    $$('.nav-item').forEach(n => {
      n.classList.toggle('active',
        (page === 'home' && n.dataset.page === 'home') ||
        (page === 'routes' && n.dataset.page === 'routes') ||
        (page === 'market' && n.dataset.page === 'market')
      );
    });

    // Cerrar modales abiertos
    if (!opts.keepModals) closeAllModals();

    // URL
    const params = { tab: page };
    if (opts.post) params.post = opts.post;
    if (opts.ruta) params.ruta = opts.ruta;
    if (opts.market) params.market = opts.market;
    pushURL(params, opts.replace);

    // Acciones específicas
    if (page === 'routes') {
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 200);
      renderRouteContent();
    }
    if (page === 'market') renderMarket();
    if (page === 'home') renderFeed();
    if (page === 'route' && opts.route) renderRouteDetail(opts.route);
    if (page === 'post' && opts.postObj) renderSinglePost(opts.postObj);
    if (page === 'trip') {
      setTimeout(() => {
        initTripMap();
        // Forzar invalidateSize después de que el DOM esté listo
        if (state.tripMap) {
          setTimeout(() => state.tripMap.invalidateSize(), 300);
        }
      }, 200);
    }
     
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    if (state.historyStack.length > 1) {
      state.historyStack.pop();
      const prev = state.historyStack[state.historyStack.length - 1];
      history.back();
      return prev;
    }
    history.back();
  }

  // Manejar popstate
  window.addEventListener('popstate', e => {
    const st = e.state || {};
    const page = st.tab || 'home';
    // Cerrar modales primero
    if ($('.modal.open')) { closeAllModals(); }
    if ($('#viewer.open')) { closeViewer(); return; }
    navigateTo(page, { ...st, replace: true, keepModals: true });
  });

  // ==================== TEMA ====================
  const savedTheme = localStorage.getItem('tgz_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon();

  function updateThemeIcon() {
    const t = document.documentElement.getAttribute('data-theme');
    const icon = $('#themeIcon');
    if (!icon) return;
    icon.innerHTML = t === 'dark'
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }

  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tgz_theme', next);
    updateThemeIcon();
    // Refrescar tiles del mapa si existe
    if (state.map) {
      state.map.eachLayer(l => { if (l instanceof L.TileLayer) l.redraw(); });
    }
  };

  // ==================== CONEXIÓN ====================
  function updateConn() {
    state.online = navigator.onLine;
    const dot = $('#connDot');
    if (dot) dot.classList.toggle('off', !state.online);
    if (state.online) {
      syncPendingQueue();
      syncFromFirebase();
    } else {
      toast('Sin conexión — modo offline activo', 'err');
    }
  }
  window.addEventListener('online', updateConn);
  window.addEventListener('offline', updateConn);
  $('#connBtn').onclick = () => {
    toast(state.online ? 'Conectado ✓' : 'Sin conexión', state.online ? 'ok' : 'err');
  };

  // ==================== PWA INSTALL ====================
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').classList.add('show');
  });
  $('#installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('App instalada ✓');
    deferredPrompt = null;
    $('#installBtn').classList.remove('show');
  };

  // ==================== POSTS / FEED ====================
  async function loadPosts() {
    let local = [];
    try { local = await DB.getAll('posts'); } catch (e) {}
    local.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    state.posts = local;

    // Intentar complementar con índice remoto
    try {
      const idx = await Publisher.fetchIndex();
      if (idx && Array.isArray(idx.posts)) {
        // Fusionar por id
        const map = new Map(state.posts.map(p => [p.id, p]));
        idx.posts.forEach(p => { if (!map.has(p.id)) map.set(p.id, p); });
        state.posts = Array.from(map.values())
          .filter(p => p.tipo === 'post' || !p.tipo)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
    } catch (e) {}
    return state.posts;
  }

  function renderFeed() {
    const feed = $('#feed');
    if (!feed) return;
    if (!state.posts.length) {
      feed.innerHTML = `
        <div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <h3>Sin publicaciones</h3>
          <p>Aún no hay publicaciones. ${state.isAdmin ? 'Usa el botón para crear la primera.' : 'Vuelve más tarde.'}</p>
        </div>`;
      return;
    }
    feed.innerHTML = state.posts.map(p => renderPostCard(p)).join('');
    bindPostEvents(feed);
  }

  function renderPostCard(p) {
    const liked = (p.likedBy || []).includes(getUserId());
    const mediaHTML = p.media
      ? (String(p.media).match(/\.(mp4|webm|ogg)$/i) || String(p.media).includes('video')
        ? `<video class="post-media" src="${esc(p.media)}" controls preload="metadata" onclick="App.openViewer('${esc(p.media)}','video')"></video>`
        : `<img class="post-media" src="${esc(p.media)}" alt="${esc(p.title)}" loading="lazy" onclick="App.openViewer('${esc(p.media)}','image')">`)
      : '';
    return `
      <article class="post-card" data-post-id="${esc(p.id)}">
        <div class="post-head">
          <div class="post-avatar">${esc((p.title || 'P')[0].toUpperCase())}</div>
          <div class="post-meta">
            <div class="name">${esc(p.title || 'Publicación')}</div>
            <div class="time">${fmtTime(p.timestamp || Date.now())}${p.updatedAt ? ' · editado' : ''}</div>
          </div>
          ${state.isAdmin ? `<button class="icon-btn" data-act="del-post" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
        </div>
        ${p.content ? `<div class="post-body">${esc(p.content)}</div>` : ''}
        ${mediaHTML}
        <div class="post-actions">
          <button class="post-action ${liked ? 'liked' : ''}" data-act="like">
            <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${p.likes || 0}</span>
          </button>
          <button class="post-action" data-act="comment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>${(p.comments || []).length}</span>
          </button>
          <button class="post-action" data-act="share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </article>`;
  }

  function bindPostEvents(root) {
    root.querySelectorAll('.post-card').forEach(card => {
      const id = card.dataset.postId;
      card.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          const post = state.posts.find(p => p.id === id);
          if (!post) return;

          if (act === 'like') {
            await toggleLike(post, card, btn);
          } else if (act === 'comment') {
            openComments(post);
          } else if (act === 'share') {
            sharePost(post);
          } else if (act === 'del-post') {
            if (!confirm('¿Eliminar esta publicación?')) return;
            await DB.delete('posts', id);
            if (fbDB) fbDB.ref('publicaciones/' + id).remove().catch(() => {});
            await loadPosts(); renderFeed();
            toast('Publicación eliminada');
          }
        };
      });
    });
  }

  function getUserId() {
    let uid = localStorage.getItem('tgz_uid');
    if (!uid) {
      uid = 'u_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('tgz_uid', uid);
    }
    return uid;
  }

  async function toggleLike(post, card, btn) {
    const uid = getUserId();
    post.likedBy = post.likedBy || [];
    const i = post.likedBy.indexOf(uid);
    if (i >= 0) {
      post.likedBy.splice(i, 1);
      post.likes = Math.max(0, (post.likes || 0) - 1);
      btn.classList.remove('liked');
      btn.querySelector('svg').setAttribute('fill', 'none');
    } else {
      post.likedBy.push(uid);
      post.likes = (post.likes || 0) + 1;
      btn.classList.add('liked');
      btn.querySelector('svg').setAttribute('fill', 'currentColor');
      // Animación corazón
      const burst = document.createElement('div');
      burst.className = 'heart-burst';
      burst.textContent = '❤';
      burst.style.left = (btn.offsetLeft + btn.offsetWidth / 2 - 18) + 'px';
      burst.style.top = (btn.offsetTop - 10) + 'px';
      btn.appendChild(burst);
      setTimeout(() => burst.remove(), 800);
    }
    btn.querySelector('span').textContent = post.likes;
    await DB.put('posts', post);
    if (fbDB && state.online) fbDB.ref('publicaciones/' + post.id).update({
      likes: post.likes, likedBy: post.likedBy
    }).catch(() => {});
  }

  async function sharePost(post) {
const url = location.origin + '/share/post/' + post.id;
     const res = await Publisher.share({
      title: post.title,
      text: post.content ? post.content.slice(0, 100) : 'Mira esta publicación',
      url
    });
    if (res.method === 'clipboard') toast('Enlace copiado ✓');
  }

  // ==================== COMENTARIOS ====================
  function openComments(post) {
    state.commentPostId = post.id;
    const modal = $('#commentsModal');
    const list = $('#commentsList');
    const comments = post.comments || [];
    list.innerHTML = comments.length
      ? comments.map((c, i) => `
        <div class="list-item" style="margin-bottom:8px">
          <div style="flex:1">
            <div style="font-size:13px;line-height:1.5">${esc(c)}</div>
            <div class="tiny" style="margin-top:4px">Anónimo</div>
          </div>
          ${state.isAdmin ? `<div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-sm" data-cact="edit" data-ci="${i}">✏️</button>
            <button class="btn btn-danger btn-sm" data-cact="del" data-ci="${i}">🗑️</button>
          </div>` : ''}
        </div>`).join('')
      : '<div class="empty" style="padding:20px"><p>Aún no hay comentarios. ¡Sé el primero!</p></div>';

    list.querySelectorAll('[data-cact]').forEach(b => {
      b.onclick = async () => {
        const i = +b.dataset.ci;
        if (b.dataset.cact === 'del') {
          if (!confirm('¿Eliminar comentario?')) return;
          post.comments.splice(i, 1);
        } else {
          const nv = prompt('Editar comentario:', post.comments[i]);
          if (nv == null) return;
          post.comments[i] = nv.trim();
        }
        await DB.put('posts', post);
        if (fbDB && state.online) fbDB.ref('publicaciones/' + post.id).update({ comments: post.comments }).catch(() => {});
        openComments(post);
      };
    });

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  $('#commentsClose').onclick = () => {
    $('#commentsModal').classList.remove('open');
    document.body.style.overflow = '';
  };

  $('#commentSend').onclick = async () => {
    const inp = $('#commentInput');
    const txt = inp.value.trim();
    if (!txt) return;
    const post = state.posts.find(p => p.id === state.commentPostId);
    if (!post) return;
    post.comments = post.comments || [];
    post.comments.push(txt);
    await DB.put('posts', post);
    if (fbDB && state.online) fbDB.ref('publicaciones/' + post.id).update({ comments: post.comments }).catch(() => {});
    inp.value = '';
    openComments(post);
    toast('Comentario agregado');
  };

  // Handle drag para cerrar
  (function bindCommentsDrag() {
    const handle = $('#commentsHandle');
    const sheet = $('#commentsSheet');
    if (!handle || !sheet) return;
    let startY = 0, curY = 0, dragging = false;
    handle.addEventListener('touchstart', e => {
      dragging = true;
      startY = e.touches[0].clientY;
      sheet.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      if (!dragging) return;
      curY = e.touches[0].clientY - startY;
      if (curY > 0) sheet.style.transform = `translateY(${curY}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', () => {
      dragging = false;
      sheet.style.transition = '';
      if (curY > 100) {
        $('#commentsModal').classList.remove('open');
        document.body.style.overflow = '';
      }
      sheet.style.transform = '';
      curY = 0;
    });
  })();

  // ==================== VISOR DE IMAGEN ====================
  function openViewer(src, type = 'image') {
    const v = $('#viewer');
    const c = $('#viewerContent');
    c.innerHTML = type === 'video'
      ? `<video src="${esc(src)}" controls autoplay style="max-width:100%;max-height:100%"></video>`
      : `<img src="${esc(src)}" alt="">`;
    v.classList.add('open');
    document.body.style.overflow = 'hidden';
    pushURL({ viewer: '1' });
  }
  function closeViewer() {
    $('#viewer').classList.remove('open');
    $('#viewerContent').innerHTML = '';
    document.body.style.overflow = '';
  }
  $('#viewerClose').onclick = closeViewer;
  $('#viewer').onclick = (e) => { if (e.target.id === 'viewer') closeViewer(); };

  // ==================== RUTAS ====================
  async function loadRoutes() {
    let local = [];
    try { local = await DB.getAll('routes'); } catch (e) {}
    state.routes = local.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Complementar con Firebase si online
    if (state.online && fbDB) {
      try {
        const snap = await fbDB.ref('rutas_colectivos_tgz').once('value');
        const val = snap.val() || {};
        const map = new Map(state.routes.map(r => [r.id, r]));
        Object.values(val).forEach(r => {
          if (r && r.id && !map.has(r.id)) map.set(r.id, r);
        });
        state.routes = Array.from(map.values());
      } catch (e) {}
    }
    return state.routes;
  }

  function renderRouteContent() {
    const mode = state.routeMode;
    const el = $('#routeContent');
    if (!el) return;
    if (mode === 'rutas') el.innerHTML = renderRoutesGrid();
    else if (mode === 'paradas') el.innerHTML = renderParadas();
    else if (mode === 'pois') el.innerHTML = renderPois();
    else if (mode === 'calles') el.innerHTML = renderCalles();
    else if (mode === 'retornos') el.innerHTML = renderRetornos();
    bindRouteCardEvents(el);
  }

  function renderRoutesGrid() {
    if (!state.routes.length) {
      return `<div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V9a4 4 0 0 1 4-4h4"/></svg>
        <h3>Sin rutas registradas</h3>
        <p>${state.isAdmin ? 'Usa el botón + para agregar la primera ruta.' : 'Vuelve más tarde.'}</p>
      </div>`;
    }
    return `<div class="routes-grid">` + state.routes.map(r => `
      <div class="route-card" data-route-id="${esc(r.id)}">
        ${state.isAdmin ? `<div class="edit-del">
          <button class="icon-btn" data-act="edit" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="icon-btn" data-act="del" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
        </div>` : ''}
        <div class="route-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 11h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></div>
        <div class="route-name">${esc(r.nombre || 'RUTA')}</div>
        <span class="badge ${r.categoria === 'foranea' ? 'badge-foranea' : 'badge-urbana'}">${esc(r.categoria || 'urbana')}</span>
        <div class="route-actions">
          <button class="icon-btn" data-act="open" title="Abrir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 6l8-3 6 3 8-3v15l-8 3-6-3-8 3z"/></svg></button>
          <button class="icon-btn" data-act="share" title="Compartir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
        </div>
      </div>`).join('') + `</div>`;
  }

  function renderParadas() {
    const map = new Map(); // nombre -> Set(rutas)
    state.routes.forEach(r => (r.paradas || []).forEach(p => {
      const key = p.trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(r.nombre);
    }));
    if (!map.size) return `<div class="empty"><p>Sin paradas registradas</p></div>`;
    return `<div class="list-group">` + Array.from(map.entries()).map(([parada, rutas]) => `
      <div class="list-item">
        <div class="li-head">
          <div class="li-title">📍 ${esc(parada)}</div>
          <button class="btn btn-ghost btn-sm" data-set-origin="${esc(parada)}">Usar como origen</button>
        </div>
        <div class="li-chips">${Array.from(rutas).map(n => `<span class="chip mini">${esc(n)}</span>`).join('')}</div>
      </div>`).join('') + `</div>`;
  }

  function renderPois() {
    const ida = new Map(); const vuelta = new Map();
    state.routes.forEach(r => {
      (r.pois || []).forEach(p => { const k = p.trim(); if (!k) return; if (!ida.has(k)) ida.set(k, new Set()); ida.get(k).add(r.nombre); });
      (r.poisVuelta || []).forEach(p => { const k = p.trim(); if (!k) return; if (!vuelta.has(k)) vuelta.set(k, new Set()); vuelta.get(k).add(r.nombre); });
    });
    const renderBlock = (title, m) => {
      if (!m.size) return '';
      return `<div class="section-title">${title}</div><div class="list-group">` + Array.from(m.entries()).map(([poi, rutas]) => `
        <div class="list-item">
          <div class="li-head">
            <div class="li-title">🏥 ${esc(poi)}</div>
            <button class="btn btn-ghost btn-sm" data-set-origin="${esc(poi)}">Origen</button>
          </div>
          <div class="li-chips">${Array.from(rutas).map(n => `<span class="chip mini">${esc(n)}</span>`).join('')}</div>
        </div>`).join('') + `</div>`;
    };
    const html = renderBlock('POIs de Ida', ida) + renderBlock('POIs de Regreso', vuelta);
    return html || `<div class="empty"><p>Sin POIs registrados</p></div>`;
  }

  function renderCalles() {
    const map = new Map();
    state.routes.forEach(r => (r.calles || []).forEach(c => {
      const k = c.trim(); if (!k) return;
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(r.nombre);
    }));
    if (!map.size) return `<div class="empty"><p>Sin calles registradas</p></div>`;
    return `<div class="list-group">` + Array.from(map.entries()).map(([calle, rutas]) => `
      <div class="list-item">
        <div class="li-head">
          <div class="li-title">🛣️ ${esc(calle)}</div>
          <button class="btn btn-ghost btn-sm" data-set-origin="${esc(calle)}">Buscar aquí</button>
        </div>
        <div class="li-chips">${Array.from(rutas).map(n => `<span class="chip mini">${esc(n)}</span>`).join('')}</div>
      </div>`).join('') + `</div>`;
  }

  function renderRetornos() {
    const map = new Map();
    state.routes.forEach(r => (r.retornos || []).forEach(t => {
      const k = t.trim(); if (!k) return;
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(r.nombre);
    }));
    if (!map.size) return `<div class="empty"><p>Sin retornos registrados</p></div>`;
    return `<div class="list-group">` + Array.from(map.entries()).map(([ret, rutas]) => `
      <div class="list-item">
        <div class="li-head">
          <div class="li-title">↩️ ${esc(ret)}</div>
          <button class="btn btn-ghost btn-sm" data-set-origin="${esc(ret)}">Usar como origen</button>
        </div>
        <div class="li-chips">${Array.from(rutas).map(n => `<span class="chip mini">${esc(n)}</span>`).join('')}</div>
      </div>`).join('') + `</div>`;
  }

  function bindRouteCardEvents(root) {
    root.querySelectorAll('.route-card').forEach(card => {
      const id = card.dataset.routeId;
      card.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          const route = state.routes.find(r => r.id === id);
          if (!route) return;
          if (act === 'open') { openRouteDetail(route); }
          else if (act === 'share') { shareRoute(route); }
          else if (act === 'edit') { openRouteEditor(route); }
          else if (act === 'del') {
            if (!confirm('¿Eliminar esta ruta?')) return;
            await DB.delete('routes', id);
            if (fbDB && state.online) fbDB.ref('rutas_colectivos_tgz/' + id).remove().catch(() => {});
            await loadRoutes(); renderRouteContent();
            toast('Ruta eliminada');
          }
        };
      });
      card.onclick = (e) => {
        if (e.target.closest('[data-act]')) return;
        const route = state.routes.find(r => r.id === id);
        if (route) openRouteDetail(route);
      };
    });

    // Botones "usar como origen"
    root.querySelectorAll('[data-set-origin]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        $('#originInput').value = btn.dataset.setOrigin;
        toast('Origen establecido: ' + btn.dataset.setOrigin);
      };
    });
  }

  async function openRouteDetail(route) {
    state.currentRoute = route;
    navigateTo('route', { ruta: route.id, route });
  }

  function renderRouteDetail(route) {
    const hero = $('#routeHero');
    hero.innerHTML = `
      <div>
        <div style="font-size:11.5px;color:var(--text-3);font-weight:700;letter-spacing:.4px">RUTA</div>
        <h1>${esc(route.nombre)}</h1>
      </div>
      <div class="hero-meta">
        <span class="badge ${route.categoria === 'foranea' ? 'badge-foranea' : 'badge-urbana'}">${esc(route.categoria || 'urbana')}</span>
        ${route.tarifa ? `<span class="chip mini">💰 ${esc(route.tarifa)}</span>` : ''}
        ${route.frecuencia ? `<span class="chip mini">⏱️ ${esc(route.frecuencia)}</span>` : ''}
        ${route.horarioIni ? `<span class="chip mini">🕐 ${esc(route.horarioIni)} - ${esc(route.horarioFin || '')}</span>` : ''}
        <span class="chip mini">📅 ${esc(route.dias || 'todos')}</span>
      </div>
      <div class="share-row" style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-sm" id="btnBackRoute">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Regresar
        </button>
        <button class="btn btn-primary btn-sm" id="btnShareRoute">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir ruta
        </button>
      </div>`;
    $('#btnShareRoute').onclick = () => shareRoute(route);
    $('#btnBackRoute').onclick = () => navigateTo('routes');
     
    // Panel inferior
    const panel = $('#routePanel');
    const blocks = [
      { key: 'paradas', title: 'Paradas', icon: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', items: route.paradas || [] },
      { key: 'retornos', title: 'Retornos', icon: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>', items: route.retornos || [] },
      { key: 'pois', title: 'POIs de Ida', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', items: route.pois || [] },
      { key: 'poisVuelta', title: 'POIs de Regreso', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', items: route.poisVuelta || [] },
      { key: 'calles', title: 'Recorrido de calles', icon: '<path d="M4 20h16"/><path d="M4 4h16"/><path d="M12 4v16"/>', items: route.calles || [] }
    ];
    panel.innerHTML = blocks.map(b => `
      <div class="route-block" data-block="${b.key}">
        <div class="route-block-head">
          <div class="rbh-l">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${b.icon}</svg>
            <span>${b.title}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="count">${b.items.length}</span>
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="route-block-body">
          ${b.items.length
            ? (b.key === 'calles'
              ? `<div class="street-seq">${b.items.map((it, i) => `<span class="street-step">${i > 0 ? '<span class="arrow">→</span>' : ''}${esc(it)}</span>`).join('')}</div>`
              : `<div class="poi-list">${b.items.map(it => `<div class="poi-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(it)}</div>`).join('')}</div>`)
            : '<div class="tiny" style="padding:8px 0">Sin datos registrados</div>'}
        </div>
      </div>`).join('');

    panel.querySelectorAll('.route-block-head').forEach(h => {
      h.onclick = () => h.parentElement.classList.toggle('open');
    });

    // Abrir el primer bloque por defecto
    const first = panel.querySelector('.route-block');
    if (first) first.classList.add('open');

    // Inicializar mapa
    setTimeout(() => initRouteMap(route), 200);
  }

     // Offset perpendicular a una polyline (separa ida y regreso en la misma calle)
  function offsetPolyline(coords, offsetMeters){
    if(!coords || coords.length < 2) return coords;
    const out = [];
    const R = 6371000;
    for(let i=0;i<coords.length;i++){
      const p = coords[i];
      const prev = coords[Math.max(0,i-1)];
      const next = coords[Math.min(coords.length-1,i+1)];
      const dLat = next[0]-prev[0];
      const dLng = next[1]-prev[1];
      const len = Math.hypot(dLat,dLng) || 1;
      const perpLat = -dLng/len;
      const perpLng =  dLat/len;
      const dLatDeg = (offsetMeters / R) * (180/Math.PI);
      const dLngDeg = (offsetMeters / (R*Math.cos(p[0]*Math.PI/180))) * (180/Math.PI);
      out.push([p[0] + perpLat*dLatDeg, p[1] + perpLng*dLngDeg]);
    }
    return out;
  }
   
  function initRouteMap(route) {
    const container = document.getElementById('map');
    if (!container) return;
    if (state.map) { state.map.remove(); state.map = null; }

    state.map = L.map(container, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // 🖥️ Conectar el botón de pantalla completa con este mapa
    setTimeout(() => bindFullscreenButton('routeMapFsBtn', 'routeMapWrap'), 50);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(state.map);

    const layers = [];
    const colorIda = route.colorIda || '#00e5ff';
    const colorVuelta = route.colorVuelta || '#a855f7';

    // --- IDA ---
    const ptsIda = (route.geometriaIda && route.geometriaIda.length) ? route.geometriaIda : (route.puntos || []);
    if (ptsIda.length > 1) {
      // Si hay vuelta, aplicamos offset; si no, dibujamos centrado
      const hasVuelta = (route.geometriaVuelta && route.geometriaVuelta.length > 1) ||
                        (route.puntosVuelta && route.puntosVuelta.length > 1);
      const finalPts = hasVuelta ? offsetPolyline(ptsIda, 4) : ptsIda;
      const lineIda = L.polyline(finalPts, {
        color: colorIda,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(state.map);
      layers.push(lineIda);

      // Marcadores de inicio/fin de ida
      const startIda = finalPts[0];
      const endIda = finalPts[finalPts.length - 1];
      L.circleMarker(startIda, { radius: 7, color: colorIda, fillColor: '#fff', fillOpacity: 1, weight: 3 })
        .addTo(state.map).bindPopup('🟢 Inicio ida');
      L.circleMarker(endIda, { radius: 7, color: colorIda, fillColor: colorIda, fillOpacity: 1, weight: 2 })
        .addTo(state.map).bindPopup('🔴 Fin ida');
    }

    // --- REGRESO ---
    const ptsVuelta = (route.geometriaVuelta && route.geometriaVuelta.length) ? route.geometriaVuelta : (route.puntosVuelta || []);
    if (ptsVuelta.length > 1) {
      const hasIda = (route.geometriaIda && route.geometriaIda.length > 1) ||
                     (route.puntos && route.puntos.length > 1);
      const finalPtsV = hasIda ? offsetPolyline(ptsVuelta, -4) : ptsVuelta;
      const lineVuelta = L.polyline(finalPtsV, {
        color: colorVuelta,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(state.map);
      layers.push(lineVuelta);

      // Marcadores de inicio/fin de regreso
      const startV = finalPtsV[0];
      const endV = finalPtsV[finalPtsV.length - 1];
      L.circleMarker(startV, { radius: 7, color: colorVuelta, fillColor: '#fff', fillOpacity: 1, weight: 3 })
        .addTo(state.map).bindPopup('🟣 Inicio regreso');
      L.circleMarker(endV, { radius: 7, color: colorVuelta, fillColor: colorVuelta, fillOpacity: 1, weight: 2 })
        .addTo(state.map).bindPopup('🔵 Fin regreso');
    }

    // --- POIs ---
    (route.pois || []).forEach((poi, i) => {
      if (Array.isArray(poi) && poi.length === 2) {
        L.circleMarker(poi, {
          radius: 6, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 2
        }).addTo(state.map).bindPopup('📍 POI ' + (i + 1));
      }
    });

    // --- Centrar mapa ---
    const allPts = (route.puntos || []).concat(route.puntosVuelta || []);
    if (allPts.length) {
      state.map.fitBounds(L.latLngBounds(allPts).pad(0.15));
    } else if (route.calles && route.calles.length) {
      // Si no hay puntos pero hay calles, mostrar centro por defecto
      state.map.setView(DEFAULT_CENTER, 13);
    } else {
      state.map.setView(DEFAULT_CENTER, 12);
    }

    // --- Leyenda flotante (opcional pero recomendado) ---
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <div style="background:rgba(20,28,48,.92);padding:8px 12px;border-radius:10px;font-size:12px;color:#e8edf7;border:1px solid #26314f;line-height:1.6">
          <div><span style="display:inline-block;width:14px;height:3px;background:${colorIda};vertical-align:middle;margin-right:6px"></span> Ida</div>
          <div><span style="display:inline-block;width:14px;height:3px;background:${colorVuelta};vertical-align:middle;margin-right:6px"></span> Regreso</div>
        </div>`;
      return div;
    };
    legend.addTo(state.map);

    state.mapLayers = { route: layers };
  }

  async function shareRoute(route) {
const url = location.origin + '/share/ruta/' + route.id;
     const res = await Publisher.share({
      title: 'Ruta ' + route.nombre,
      text: `Mira la ruta ${route.nombre} (${route.categoria || 'urbana'})`,
      url
    });
    if (res.method === 'clipboard') toast('Enlace copiado ✓');
  }

  // ==================== BÚSQUEDA DUAL ====================
  function getAllPlaces() {
    const places = new Set();
    state.routes.forEach(r => {
      (r.paradas || []).forEach(p => places.add(p));
      (r.pois || []).forEach(p => places.add(p));
      (r.poisVuelta || []).forEach(p => places.add(p));
      (r.calles || []).forEach(p => places.add(p));
      (r.retornos || []).forEach(p => places.add(p));
    });
    return Array.from(places);
  }

  function bindSuggest(inputId, sugId) {
    const input = $('#' + inputId);
    const sug = $('#' + sugId);
    if (!input || !sug) return;
    input.addEventListener('input', () => {
      const q = norm(input.value);
      if (!q) { sug.classList.add('hidden'); return; }
      const places = getAllPlaces();
      const matches = places.filter(p => norm(p).includes(q)).slice(0, 8);
      if (!matches.length) { sug.classList.add('hidden'); return; }
      sug.innerHTML = matches.map(m => `
        <div class="suggestion" data-val="${esc(m)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${esc(m)}</span>
        </div>`).join('');
      sug.classList.remove('hidden');
      sug.querySelectorAll('.suggestion').forEach(s => {
        s.onclick = () => { input.value = s.dataset.val; sug.classList.add('hidden'); };
      });
    });
    input.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 200));
  }
  bindSuggest('originInput', 'originSug');
  bindSuggest('destInput', 'destSug');

  // Algoritmo de búsqueda de rutas
  function findRoutes(origin, dest) {
    const o = norm(origin), d = norm(dest);
    const results = { direct: [], transfer: [] };

    state.routes.forEach(r => {
      const all = [].concat(r.paradas || [], r.pois || [], r.poisVuelta || [], r.calles || [], r.retornos || []);
      const hasO = all.some(x => norm(x).includes(o) || o.includes(norm(x)));
      const hasD = all.some(x => norm(x).includes(d) || d.includes(norm(x)));
      const byStreetOnly = hasO && hasD && !(r.paradas || []).some(x => norm(x).includes(o) || norm(x).includes(d));
      if (hasO && hasD) {
        results.direct.push({ route: r, warn: byStreetOnly });
      }
    });

    // Transbordos: buscar rutas que conecten a través de una parada/calle intermedia
    if (!results.direct.length) {
      state.routes.forEach(r1 => {
        const all1 = [].concat(r1.paradas || [], r1.pois || [], r1.calles || []);
        if (!all1.some(x => norm(x).includes(o) || o.includes(norm(x)))) return;
        state.routes.forEach(r2 => {
          if (r1.id === r2.id) return;
          const all2 = [].concat(r2.paradas || [], r2.pois || [], r2.calles || []);
          if (!all2.some(x => norm(x).includes(d) || d.includes(norm(x)))) return;
          // Buscar punto de transbordo
          const common = all1.filter(x => all2.some(y => norm(x) === norm(y)));
          if (common.length) {
            results.transfer.push({ r1, r2, transfer: common[0] });
          }
        });
      });
    }
    return results;
  }

  $('#btnSearch').onclick = async () => {
    const o = $('#originInput').value.trim();
    const d = $('#destInput').value.trim();
    if (!o || !d) { toast('Ingresa origen y destino', 'err'); return; }
    const res = findRoutes(o, d);
    const el = $('#searchResults');
    el.classList.remove('hidden');

    if (!res.direct.length && !res.transfer.length) {
      el.innerHTML = `<div class="card" style="text-align:center;padding:24px">
        <div class="empty" style="padding:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h3>Sin resultados</h3>
          <p>No se encontraron combinaciones entre "${esc(o)}" y "${esc(d)}".</p>
        </div>
      </div>`;
      return;
    }

    let html = '';
    if (res.direct.length) {
      html += `<div class="section-title">Rutas directas (${res.direct.length})</div>`;
      html += res.direct.map(r => `
        <div class="result-card ${r.warn ? 'warn' : 'directa'}" data-route-id="${esc(r.route.id)}">
          <div class="rc-head">
            <div class="rc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 11h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></div>
            <div style="flex:1">
              <div class="rc-route">${esc(r.route.nombre)}</div>
              <div class="rc-sub">${esc(r.route.categoria || 'urbana')}</div>
            </div>
            <span class="badge badge-green">Directa</span>
          </div>
          ${r.warn ? '<div class="badge badge-amber" style="margin-bottom:6px">⚠️ Coincidencia por calle</div>' : ''}
          <div class="rc-body">Esta ruta conecta los puntos seleccionados.</div>
        </div>`).join('');
    }
    if (res.transfer.length) {
      html += `<div class="section-title">Transbordos (${res.transfer.length})</div>`;
      html += res.transfer.slice(0, 6).map(t => `
        <div class="result-card transbordo" data-route-id="${esc(t.r1.id)}">
          <div class="rc-head">
            <div class="rc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>
            <div style="flex:1">
              <div class="rc-route">${esc(t.r1.nombre)} → ${esc(t.r2.nombre)}</div>
              <div class="rc-sub">Transbordo en: ${esc(t.transfer)}</div>
            </div>
            <span class="badge badge-amber">Transbordo</span>
          </div>
          <div class="rc-steps">
            <div class="rc-step"><div class="step-num">1</div><div>Toma la ruta <b>${esc(t.r1.nombre)}</b></div></div>
            <div class="rc-step"><div class="step-num">2</div><div>Baja en <b>${esc(t.transfer)}</b></div></div>
            <div class="rc-step"><div class="step-num">3</div><div>Sube a la ruta <b>${esc(t.r2.nombre)}</b></div></div>
          </div>
        </div>`).join('');
    }
    el.innerHTML = html;
    el.querySelectorAll('.result-card').forEach(c => {
      c.onclick = () => {
        const r = state.routes.find(x => x.id === c.dataset.routeId);
        if (r) openRouteDetail(r);
      };
    });
  };

  $('#btnClearSearch').onclick = () => {
    $('#originInput').value = '';
    $('#destInput').value = '';
    $('#searchResults').classList.add('hidden');
    state.routeMode = 'rutas';
    $$('#routeModes .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === 'rutas'));
    renderRouteContent();
  };

  $('#btnMapSearch').onclick = () => navigateTo('trip');

  // ============================================================
  //  🖥️ BOTÓN DE PANTALLA COMPLETA PARA LOS MAPAS
  // ============================================================
  function bindFullscreenButton(btnId, wrapId) {
    const btn = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    if (!btn || !wrap) return;

    // SVG: el mismo icono sirve de "expandir" y "salir" (lo rotamos por CSS)
    btn.onclick = (e) => {
      e.stopPropagation();
      const isFs = wrap.classList.toggle('is-fullscreen');
      btn.classList.toggle('is-fullscreen', isFs);
      document.body.classList.toggle('fs-active', isFs);
      btn.title = isFs ? 'Salir de pantalla completa' : 'Pantalla completa';

      // Invalidar el tamaño del mapa activo para que Leaflet recalcule
      setTimeout(() => {
        if (state.map && wrapId === 'routeMapWrap') state.map.invalidateSize();
        if (state.tripMap && wrapId === 'tripMapWrap') state.tripMap.invalidateSize();
        if (state.map && wrapId === 'editorMapWrap') state.map.invalidateSize();
      }, 250);
    };
  }

  // Chips de modo
  $$('#routeModes .chip').forEach(c => {
    c.onclick = () => {
      $$('#routeModes .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      state.routeMode = c.dataset.mode;
      renderRouteContent();
    };
  });

  // ==================== EDITOR DE RUTAS ====================
  function openRouteEditor(route) {
    if (!state.isAdmin) { requestAdminAuth(() => openRouteEditor(route)); return; }
    state.editingRoute = route || null;
    state.routeDraft = {
      puntos: route?.puntos || [],
      puntosVuelta: route?.puntosVuelta || [],
      calles: route?.calles || [],
      pois: route?.pois || [],
      geometriaIda: route?.geometriaIda || [],
      geometriaVuelta: route?.geometriaVuelta || [],
      colorIda: route?.colorIda || '#00e5ff',
      colorVuelta: route?.colorVuelta || '#a855f7'
    };

    const modal = $('#editorModal');
    $('#editorTitle').textContent = route ? 'Editar ruta' : 'Registrar ruta';
    const body = $('#editorBody');
    body.innerHTML = `
      <div class="steps">
        <div class="step-dot active" data-step="1"></div>
        <div class="step-dot" data-step="2"></div>
        <div class="step-dot" data-step="3"></div>
      </div>
      <div class="route-step" data-step="1">
        <div class="field"><label>Nombre de la ruta *</label><input class="input" id="erName" value="${esc(route?.nombre || '')}" placeholder="Ej: Centro - Universidad"></div>
        <div class="field"><label>Categoría</label><select class="select" id="erCat">
          <option value="urbana" ${route?.categoria === 'urbana' ? 'selected' : ''}>Urbana</option>
          <option value="foranea" ${route?.categoria === 'foranea' ? 'selected' : ''}>Foránea</option>
        </select></div>
        <div class="form-grid">
          <div class="field"><label>Tarifa</label><input class="input" id="erTarifa" value="${esc(route?.tarifa || '')}" placeholder="$10"></div>
          <div class="field"><label>Frecuencia</label><input class="input" id="erFrec" value="${esc(route?.frecuencia || '')}" placeholder="Cada 15 min"></div>
          <div class="field"><label>Horario inicio</label><input class="input" id="erHoraIni" value="${esc(route?.horarioIni || '')}" placeholder="05:00"></div>
          <div class="field"><label>Horario fin</label><input class="input" id="erHoraFin" value="${esc(route?.horarioFin || '')}" placeholder="22:00"></div>
        </div>
        <div class="field"><label>Notas</label><textarea class="textarea" id="erNotas">${esc(route?.notas || '')}</textarea></div>
      </div>
      <div class="route-step hidden" data-step="2">
        <div class="field"><label>Paradas (separadas por coma o salto de línea)</label><textarea class="textarea" id="erParadas">${esc((route?.paradas || []).join(', '))}</textarea></div>
        <div class="field"><label>Retornos</label><textarea class="textarea" id="erRetornos">${esc((route?.retornos || []).join(', '))}</textarea></div>
        <div class="field"><label>POIs de ida</label><textarea class="textarea" id="erPois">${esc((route?.pois || []).join(', '))}</textarea></div>
        <div class="field"><label>POIs de regreso</label><textarea class="textarea" id="erPoisVuelta">${esc((route?.poisVuelta || []).join(', '))}</textarea></div>
      </div>
      <div class="route-step hidden" data-step="3">
        <div class="field"><label>Calles por donde pasa</label><textarea class="textarea" id="erCalles">${esc((route?.calles || []).join(', '))}</textarea></div>
        <div class="muted tiny" style="margin-top:8px">Puntos trazados: <b>${state.routeDraft.puntos.length}</b> · Puntos de vuelta: <b>${state.routeDraft.puntosVuelta.length}</b></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" id="erPrev" style="visibility:hidden">← Anterior</button>
        <button class="btn btn-primary" style="flex:1" id="erNext">Siguiente →</button>
        <button class="btn btn-primary hidden" style="flex:1" id="erSave">Guardar ruta</button>
      </div>`;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    let step = 1;
    const goStep = n => {
      step = n;
      body.querySelectorAll('.route-step').forEach(s => s.classList.toggle('hidden', +s.dataset.step !== n));
      body.querySelectorAll('.step-dot').forEach(d => {
        const s = +d.dataset.step;
        d.classList.toggle('active', s === n);
        d.classList.toggle('done', s < n);
      });
      $('#erPrev').style.visibility = n === 1 ? 'hidden' : 'visible';
      $('#erNext').classList.toggle('hidden', n === 3);
      $('#erSave').classList.toggle('hidden', n !== 3);
    };
    $('#erPrev').onclick = () => goStep(Math.max(1, step - 1));
    $('#erNext').onclick = () => goStep(Math.min(3, step + 1));

    $('#erSave').onclick = async () => {
      const nombre = $('#erName').value.trim();
      if (!nombre) { toast('El nombre es obligatorio', 'err'); goStep(1); return; }
      const { dia, mes } = (() => { const d = new Date(); return { dia: d.getDate(), mes: d.getMonth() + 1 }; })();
      const id = state.editingRoute?.id || Publisher.slugify(nombre, dia, mes);
      const route = {
        id, slug: id, nombre: nombre.toUpperCase(),
        categoria: $('#erCat').value,
        tarifa: $('#erTarifa').value.trim(),
        frecuencia: $('#erFrec').value.trim(),
        horarioIni: $('#erHoraIni').value.trim(),
        horarioFin: $('#erHoraFin').value.trim(),
        notas: $('#erNotas').value.trim(),
        paradas: splitList($('#erParadas').value),
        retornos: splitList($('#erRetornos').value),
        pois: splitList($('#erPois').value),
        poisVuelta: splitList($('#erPoisVuelta').value),
        calles: splitList($('#erCalles').value),
        puntos: state.routeDraft.puntos,
        puntosVuelta: state.routeDraft.puntosVuelta,
        geometriaIda: state.routeDraft.geometriaIda || [],
        geometriaVuelta: state.routeDraft.geometriaVuelta || [],
        colorIda: state.routeDraft.colorIda,
        colorVuelta: state.routeDraft.colorVuelta,
        timestamp: state.editingRoute?.timestamp || Date.now(),
        updatedAt: Date.now(),
        url: `/share/ruta/${id}`
      };
      await DB.put('routes', route);
      if (fbDB && state.online) fbDB.ref('rutas_colectivos_tgz/' + id).set(route).catch(() => {});
      await loadRoutes();
      renderRouteContent();
      closeModal('editorModal');
      toast('Ruta guardada ✓');
    };
  }

  // ==================== MARKETPLACE ====================
  async function loadMarket() {
    let local = [];
    try { local = await DB.getAll('market'); } catch (e) {}
    state.market = local.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (state.online && fbDB) {
      try {
        const snap = await fbDB.ref('marketplace').once('value');
        const val = snap.val() || {};
        const map = new Map(state.market.map(m => [m.id, m]));
        Object.values(val).forEach(m => { if (m && m.id && !map.has(m.id)) map.set(m.id, m); });
        state.market = Array.from(map.values());
      } catch (e) {}
    }
    return state.market;
  }

  function renderMarket() {
    const grid = $('#marketGrid');
    if (!grid) return;
    const q = norm(state.marketQuery);
    const cat = state.marketFilter;
    const items = state.market.filter(m => {
      if (cat !== 'all' && m.categoria !== cat) return false;
      if (q && !(norm(m.title).includes(q) || norm(m.description).includes(q))) return false;
      return true;
    });
    if (!items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
        <h3>Sin anuncios</h3>
        <p>No hay resultados para esta búsqueda.</p>
      </div>`;
      return;
    }
    grid.innerHTML = items.map(m => `
      <div class="market-card" data-market-id="${esc(m.id)}">
        ${m.image
          ? `<img class="market-media" src="${esc(m.image)}" alt="${esc(m.title)}" loading="lazy">`
          : `<div class="market-media"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`}
        <div class="market-body">
          <span class="badge badge-urbana" style="align-self:flex-start">${esc(m.categoria || 'Otro')}</span>
          <div class="market-title">${esc(m.title)}</div>
          ${m.price ? `<div class="market-price">${esc(m.price)}</div>` : ''}
          <div class="market-desc">${esc(m.description || '')}</div>
        </div>
        <div class="market-foot">
          ${m.phone ? `<button class="btn btn-primary btn-sm" style="flex:1" data-mact="wa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>
            WhatsApp
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" data-mact="share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </div>`).join('');

    grid.querySelectorAll('.market-card').forEach(card => {
      const id = card.dataset.marketId;
      const ad = state.market.find(m => m.id === id);
      card.querySelectorAll('[data-mact]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          if (b.dataset.mact === 'wa' && ad?.phone) {
            const msg = encodeURIComponent('Hola, me interesa: ' + ad.title);
            window.open(`https://wa.me/${ad.phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
          } else if (b.dataset.mact === 'share') {
const url = location.origin + '/share/m/' + id;
             Publisher.share({ title: ad.title, text: ad.description?.slice(0, 100), url });
          }
        };
      });
    });
  }

  // Búsqueda y filtros de market
  $('#marketSearch').oninput = e => { state.marketQuery = e.target.value; renderMarket(); };
  $$('#marketCats .chip').forEach(c => {
    c.onclick = () => {
      $$('#marketCats .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      state.marketFilter = c.dataset.cat;
      renderMarket();
    };
  });

  // ==================== ADMIN AUTH ====================
  function requestAdminAuth(cb) {
    const modal = $('#authModal');
    modal.classList.add('open');
    const handler = async () => {
      const pass = $('#adminPass').value.trim();
      if (!pass) { toast('Ingresa la contraseña', 'err'); return; }
      // Validar con API
      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, __check: true })
        });
        if (res.ok || res.status === 200) {
          state.isAdmin = true;
          sessionStorage.setItem('tgz_admin', pass);
          closeModal('authModal');
          $('#adminFab').classList.remove('hidden');
          $('#feedAdminBar').classList.remove('hidden');
          $('#marketAdminBar').classList.remove('hidden');
          toast('Acceso concedido ✓');
          if (cb) cb();
        } else {
          toast('Contraseña incorrecta', 'err');
        }
      } catch (e) {
        // Fallback: aceptar localmente si no hay red
        state.isAdmin = true;
        sessionStorage.setItem('tgz_admin', pass);
        closeModal('authModal');
        $('#adminFab').classList.remove('hidden');
        $('#feedAdminBar').classList.remove('hidden');
        $('#marketAdminBar').classList.remove('hidden');
        toast('Modo admin offline');
        if (cb) cb();
      }
      $('#adminLogin').removeEventListener('click', handler);
    };
    $('#adminLogin').addEventListener('click', handler);
  }

  // Detección automática de admin por sesión
  const savedPass = sessionStorage.getItem('tgz_admin');
  if (savedPass) {
    state.isAdmin = true;
    $('#adminFab').classList.remove('hidden');
    $('#feedAdminBar').classList.remove('hidden');
    $('#marketAdminBar').classList.remove('hidden');
  }

  // ==================== MODALES ====================
  function closeModal(id) {
    const m = $('#' + id);
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  }
  function closeAllModals() {
    $$('.modal.open').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  }

  // ==================== SYNC ====================
  async function syncPendingQueue() {
    if (!state.online) return;
    try {
      const queue = await DB.getQueue();
      if (!queue.length) return;
      for (const item of queue) {
        try {
          const res = await Publisher.publish(item.payload || item);
          if (res.ok) await DB.removeQueueItem(item.id);
        } catch (e) { /* reintentar luego */ }
      }
      toast('Sincronización completada');
    } catch (e) {}
  }

  async function syncFromFirebase() {
    if (!state.online || !fbDB) return;
    try {
      const [postsSnap, routesSnap, marketSnap] = await Promise.all([
        fbDB.ref('publicaciones').once('value'),
        fbDB.ref('rutas_colectivos_tgz').once('value'),
        fbDB.ref('marketplace').once('value')
      ]);
      const posts = postsSnap.val() || {};
      const routes = routesSnap.val() || {};
      const market = marketSnap.val() || {};
      // Guardar en IndexedDB
      for (const p of Object.values(posts)) if (p && p.id) await DB.put('posts', p);
      for (const r of Object.values(routes)) if (r && r.id) await DB.put('routes', r);
      for (const m of Object.values(market)) if (m && m.id) await DB.put('market', m);
      // Recargar
      await loadPosts(); await loadRoutes(); await loadMarket();
      renderFeed(); renderRouteContent(); renderMarket();
    } catch (e) { console.warn('[Sync]', e); }
  }

  // ==================== TRIP SEARCH (MAPA) ====================
  function initTripMap() {
    if (state.tripMap) { state.tripMap.invalidateSize(); return; }
    const el = document.getElementById('tripMap');
    if (!el) return;
    state.tripMap = L.map(el, { zoomControl: true }).setView(DEFAULT_CENTER, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(state.tripMap);
        state.tripMap.on('click', e => {
      // Solo agregar si el modo activo e    state.tripMap.on('click', e => {
      // Solo agregar si el modo activo es "addpoint"
      const activeBtn = document.querySelector('#tripToolbar .tb.active');
      const mode = activeBtn ? activeBtn.dataset.tool : 'addpoint';
      if (mode !== 'addpoint') return;

      // Límite duro de 5 puntos
      if (state.tripPoints.length >= 5) {
        toast('Máximo 5 puntos', 'err');
        return;
      }

      // 🔒 Auto-bloqueo: SOLO si hay 2+ puntos Y el usuario NO reactivó manualmente.
      if (state.tripPoints.length >= 2 && !state.userReactivated) {
        const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
        if (addBtn) addBtn.classList.remove('active');
        toast('Máx. 2 puntos. Pulsa +Agregar para añadir más.');
        return;
      }

      // ✅ Agregamos el punto
      addTripPoint(e.latlng.lat, e.latlng.lng);

      // Después de agregar con reactivación manual, volvemos a bloquear el botón
      // hasta que el usuario lo pulse otra vez (si ya llegó a 2+).
      if (state.tripPoints.length >= 2) {
        state.userReactivated = false;
        const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
        if (addBtn) addBtn.classList.remove('active');
      }
    });
  }

  // Nombres amigables por defecto según el orden del punto
  const TRIP_DEFAULT_NAMES = ['ESTOY AQUÍ', 'LLEGARÉ AQUÍ', 'PASO POR', 'DESVÍO A', 'DESTINO'];

  function addTripPoint(lat, lng) {
    const idx = state.tripPoints.length;
    const letter = String.fromCharCode(65 + idx); // A, B, C, D, E
    const color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
    const name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + letter);
    state.tripPoints.push({ lat, lng, letter, color, radius: state.tripRadius, name });

       const icon = L.divIcon({
      className: '',
      html: `<div class="marker-${letter.toLowerCase()}" style="background:${color};position:relative">
        ${letter}
        <span style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);
          background:${color};color:#fff;font-size:9px;font-weight:800;
          padding:2px 6px;border-radius:6px;white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,.4)">${name}</span>
      </div>`,
      iconSize: [26, 26], iconAnchor: [13, 13]
    });
    const marker = L.marker([lat, lng], { icon }).addTo(state.tripMap);
     
    const circle = L.circle([lat, lng], { radius: state.tripRadius, color, fillColor: color, fillOpacity: 0.1, weight: 1.5 }).addTo(state.tripMap);
    state.tripMarkers.push(marker);
    state.tripCircles.push(circle);

    // 📜 Scroll automático SOLO al colocar el PRIMER punto
    // Se hace scroll hasta que el mapa quede pegado arriba (debajo del header)
    if (state.tripPoints.length === 1) {
      const mapWrap = document.querySelector('#page-trip .map-wrap');
      if (mapWrap) {
        // Esperamos un tick para que el DOM se asiente
        setTimeout(() => {
          const headerH = 58; // altura del header (--header-h)
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
      el.innerHTML = '<div class="empty-trip">Toca el mapa para agregar puntos (máx. 5)</div>';
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
        // Reetiquetar letras y colores (los nombres NO se reasignan para que
        // "LLEGARÉ AQUÍ" siga siendo el último punto, etc.)
        state.tripPoints.forEach((p, idx) => {
          p.letter = String.fromCharCode(65 + idx);
          p.color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
          // Asignar nombre por defecto si no lo tiene (para los que se movieron)
          if (!p.name) p.name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + p.letter);
        });
        // Reasignar nombres según nueva posición SOLO si eran nombres por defecto
        state.tripPoints.forEach((p, idx) => {
          const isDefault = TRIP_DEFAULT_NAMES.includes(p.name) || /^PUNTO [A-E]$/.test(p.name);
          if (isDefault) p.name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + p.letter);
        });
        // Redibujar markers en el mapa con nueva letra/color/nombre
        state.tripMarkers.forEach((m, idx) => {
          const pt = state.tripPoints[idx];
          if (!pt) return;
          const icon = L.divIcon({
            className: '',
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color};position:relative">
              ${pt.letter}
              <span style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);
                background:${pt.color};color:#fff;font-size:9px;font-weight:800;
                padding:2px 6px;border-radius:6px;white-space:nowrap;
                box-shadow:0 2px 6px rgba(0,0,0,.4)">${pt.name}</span>
            </div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          });
          m.setIcon(icon);
        });
        renderTripPointsList();
        performTripSearch();

        // 🔓 Reactivar automáticamente el botón "+Agregar" si quedan 0 o 1 puntos
        // y resetear la bandera de reactivación
        state.userReactivated = false;
        if (state.tripPoints.length <= 1) {
          const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
          if (addBtn && !addBtn.classList.contains('active')) {
            // Quitar "active" de todos y activar solo addpoint
            $$('#tripToolbar .tb').forEach(x => x.classList.remove('active'));
            addBtn.classList.add('active');
          }
        }
      };
    });
  }

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

  // Devuelve TODAS las polilíneas posibles de una ruta (ida + vuelta)
  // combinando geometría real (OSRM) y puntos crudos como fallback.
  function getRouteAllSegments(route) {
    const segments = [];
    const ida = (route.geometriaIda && route.geometriaIda.length > 1)
      ? route.geometriaIda
      : (route.puntos || []);
    const vuelta = (route.geometriaVuelta && route.geometriaVuelta.length > 1)
      ? route.geometriaVuelta
      : (route.puntosVuelta || []);
    if (ida.length > 1) segments.push(ida);
    if (vuelta.length > 1) segments.push(vuelta);
    return segments;
  }

  // Distancia mínima (en metros) de un punto a CUALQUIER segmento de una ruta.
  // Considera geometriaIda + geometriaVuelta (no solo los puntos crudos).
  function routeDistanceToPoint(route, lat, lng) {
    const segments = getRouteAllSegments(route);
    if (!segments.length) return Infinity;
    let min = Infinity;
    for (const pts of segments) {
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointToSegmentDistance([lat, lng], pts[i], pts[i + 1]);
        // d está en grados; convertir a metros usando latitud media
        const midLat = (pts[i][0] + pts[i + 1][0]) / 2;
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
        // Proyección local: aproximamos el segmento como recta en un plano
        const dLat = (lng != null ? (lat - (pts[i][0] + pts[i + 1][0]) / 2) : 0);
        // Usamos una conversión más precisa:
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

  // ============================================================
  //  MOTOR AVANZADO DE BÚSQUEDA DE VIAJES
  //  - Rutas directas
  //  - Transbordos de 1, 2, 3, 4 saltos
  //  - Ordenados por distancia total y cantidad de transbordos
  //  - Dibuja trazos en el mapa con colores únicos por resultado
  // ============================================================

  const TRIP_COLORS = ['#00e5ff','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#84cc16','#f97316','#14b8a6','#8b5cf6','#eab308'];
  let tripRouteLayers = [];        // capas de trazos de resultados en el mapa
  let tripCurrentHighlight = null; // índice del resultado resaltado

  function clearTripRouteLayers() {
    tripRouteLayers.forEach(l => { try { state.tripMap.removeLayer(l); } catch(e){} });
    tripRouteLayers = [];
  }

  // Devuelve las coordenadas [lat,lng] de la IDA de una ruta (geometría o puntos)
  function getRouteCoords(route) {
    if (route.geometriaIda && route.geometriaIda.length > 1) {
      return route.geometriaIda.map(c => [c[0], c[1]]);
    }
    return (route.puntos || []).map(c => [c[0], c[1]]);
  }

  // Devuelve las coordenadas [lat,lng] de la VUELTA de una ruta
  function getRouteCoordsVuelta(route) {
    if (route.geometriaVuelta && route.geometriaVuelta.length > 1) {
      return route.geometriaVuelta.map(c => [c[0], c[1]]);
    }
    return (route.puntosVuelta || []).map(c => [c[0], c[1]]);
  }

  // Distancia total de una ruta (en metros)
  function routeTotalDistance(route) {
    const coords = getRouteCoords(route);
    if (coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversine(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }
    return total;
  }

  // Offset perpendicular para separar visualmente 2 trazos en la misma calle.
  // (mismo algoritmo que usa el render de ruta individual)
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

  // Dibuja en el mapa un conjunto de rutas con colores únicos.
  // AHORA dibuja IDA y VUELTA, con offset cuando hay varias rutas o ambos sentidos.
  // Si se pasan varias rutas con el mismo color lógico (p.ej. varias directas),
  // se separan con offsets perpendiculares para que se vean ambas.
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

      // ---- IDA ----
      if (coordsIda.length > 1) {
        // Si hay más de 1 ruta en el mapa, aplicamos offset alterno
        // para que no se superpongan en calles compartidas.
        let idaDraw = coordsIda;
        if (total > 1) {
          // Offset entre -6 y +6 metros según índice, alternando signo
          const offset = (idx - (total - 1) / 2) * 4; // separa ±4m por índice
          idaDraw = offsetPolyline(coordsIda, offset);
        }
        const lineIda = L.polyline(idaDraw, {
          color,
          weight: item.type === 'transfer' ? (isHl ? 5 : 3) : (isHl ? 6 : 4),
          opacity: isHl ? 0.95 : 0.5,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: null
        }).addTo(state.tripMap);
        lineIda.bindTooltip(
          (item.label || route.nombre || 'Ruta') + ' · IDA' +
          ` <span style="color:${color}">●</span>`,
          { sticky: true }
        );
        tripRouteLayers.push(lineIda);
      }

      // ---- VUELTA ----
      if (coordsVuelta.length > 1) {
        let vueltaDraw = coordsVuelta;
        if (total > 1) {
          const offset = (idx - (total - 1) / 2) * 4;
          vueltaDraw = offsetPolyline(coordsVuelta, -offset); // signo contrario para separar de ida
        }
        const lineVuelta = L.polyline(vueltaDraw, {
          color,
          weight: isHl ? 4 : 2,
          opacity: isHl ? 0.85 : 0.4,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: '10,6' // guiones para distinguir vuelta de ida
        }).addTo(state.tripMap);
        lineVuelta.bindTooltip(
          (item.label || route.nombre || 'Ruta') + ' · REGRESO' +
          ` <span style="color:${color}">●</span>`,
          { sticky: true }
        );
        tripRouteLayers.push(lineVuelta);
      }

      // Si es transbordo, marcar el punto de encuentro
      if (item.transferPoint) {
        const tp = L.circleMarker(item.transferPoint, {
          radius: 9, color: '#fff', fillColor: color, fillOpacity: 1, weight: 3
        }).addTo(state.tripMap).bindPopup('🔄 Transbordo: ' + (item.label || ''));
        tripRouteLayers.push(tp);
      }
    });
  }

  // Calcula la distancia mínima entre dos rutas (para transbordos)
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

  // Verifica si una ruta pasa cerca de un punto
  function routeNearPoint(route, point, radius) {
    return routeDistanceToPoint(route, point.lat, point.lng) <= radius;
  }

  // Encuentra todos los transbordos posibles (1, 2, 3, 4 saltos)
  function findTransferChains(startPoint, endPoint, maxTransfers) {
    maxTransfers = Math.max(1, +maxTransfers || 1);
     const chains = [];
    const startRoutes = state.routes.filter(r => routeNearPoint(r, startPoint, startPoint.radius));
    const endRoutes   = state.routes.filter(r => routeNearPoint(r, endPoint, endPoint.radius));

    if (!startRoutes.length || !endRoutes.length) return chains;

    // 1 transbordo (2 rutas)
    if (maxTransfers >= 1) {
      startRoutes.forEach(r1 => {
        endRoutes.forEach(r2 => {
          if (r1.id === r2.id) return;
          const inter = routesMinDistance(r1, r2);
          if (inter.dist <= 400) {
            chains.push({
              type: 'transfer',
              legs: [r1, r2],
              transferPoints: [inter.mid],
              totalDist: routeTotalDistance(r1) + routeTotalDistance(r2),
              transfers: 1
            });
          }
        });
      });
    }

    // 2 transbordos (3 rutas)
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
              type: 'transfer',
              legs: [r1, r2, r3],
              transferPoints: [i12.mid, i23.mid],
              totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3),
              transfers: 2
            });
          });
        });
      });
    }

    // 3 transbordos (4 rutas)
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
                type: 'transfer',
                legs: [r1, r2, r3, r4],
                transferPoints: [i12.mid, i23.mid, i34.mid],
                totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3) + routeTotalDistance(r4),
                transfers: 3
              });
            });
          });
        });
      });
    }

    // 4 transbordos (5 rutas)
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
                  type: 'transfer',
                  legs: [r1, r2, r3, r4, r5],
                  transferPoints: [i12.mid, i23.mid, i34.mid, i45.mid],
                  totalDist: routeTotalDistance(r1) + routeTotalDistance(r2) + routeTotalDistance(r3) + routeTotalDistance(r4) + routeTotalDistance(r5),
                  transfers: 4
                });
              });
            });
          });
        });
      });
    }

    // Eliminar cadenas duplicadas (misma secuencia de rutas)
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
      // Rutas que tocan el punto A
      const p = state.tripPoints[0];
      state.routes.forEach(r => {
        const d = routeDistanceToPoint(r, p.lat, p.lng);
        if (d <= p.radius) results.direct.push({ route: r, dist: d, type: 'direct' });
      });
    } else {
      // ¿Existe una ruta directa que pase por TODOS los puntos?
      const start = state.tripPoints[0];
      const end   = state.tripPoints[state.tripPoints.length - 1];
      const middle = state.tripPoints.slice(1, -1);

      state.routes.forEach(r => {
        const touchesAll = state.tripPoints.every(p => routeNearPoint(r, p, p.radius));
        if (touchesAll) {
          results.direct.push({ route: r, type: 'direct', label: r.nombre });
        }
      });

            // Si no hay directa, o si el usuario quiere ver también transbordos,
      // calculamos cadenas de transbordos. SIEMPRE intentamos al menos 1.
      if (!results.direct.length || maxTransfers >= 1) {         
        // Para 2 puntos
        if (state.tripPoints.length === 2) {
          const chains = findTransferChains(start, end, maxTransfers);
          // Ordenar por: menos transbordos primero, luego distancia total
          chains.sort((a, b) => a.transfers - b.transfers || a.totalDist - b.totalDist);
          results.transfers = chains.slice(0, 20);
        } else {
          // Para 3+ puntos: buscar cadena que pase por todos los puntos
          // Estrategia simplificada: buscar ruta que una start→mid1, mid1→mid2, etc.
          // Aquí se puede extender; por ahora hacemos pares consecutivos
          const pairs = [];
          for (let i = 0; i < state.tripPoints.length - 1; i++) {
            const a = state.tripPoints[i];
            const b = state.tripPoints[i+1];
            const chains = findTransferChains(a, b, maxTransfers);
            if (chains.length) pairs.push(chains[0]); // la mejor de cada par
          }
          // Combinar en una sola "ruta multi-punto" (simplificado)
          if (pairs.length) {
            const allLegs = [];
            const allTransferPts = [];
            pairs.forEach(pair => {
              pair.legs.forEach(l => { if (!allLegs.find(x => x.id === l.id)) allLegs.push(l); });
              allTransferPts.push(...(pair.transferPoints || []));
            });
            results.transfers.push({
              type: 'transfer',
              legs: allLegs,
              transferPoints: allTransferPts,
              totalDist: pairs.reduce((s, p) => s + p.totalDist, 0),
              transfers: allLegs.length - 1
            });
          }
        }
      }
    }

       // Si hay directas, dibujarlas TODAS en el mapa con offset para que no se
    // superpongan. El offset se calcula dentro de drawTripRoutesOnMap.
    // Si NO hay directas pero SÍ hay transbordos, dibujamos automáticamente
    // el primer resultado de transbordo para que el mapa no quede vacío.
    if (results.direct.length) {
      drawTripRoutesOnMap(
        results.direct.map(d => ({
          route: d.route,
          label: d.route.nombre,
          type: 'direct'
        })),
        null  // sin highlight, todas con mismo peso
      );
    } else if (results.transfers.length) {
      const t0 = results.transfers[0];
      drawTripRoutesOnMap(
        t0.legs.map((l, li) => ({
          route: l,
          label: l.nombre,
          type: 'transfer',
          transferPoint: li === 0 ? t0.transferPoints[0] : (t0.transferPoints[li - 1] || null)
        }))
      );
    }

    // Render de resultados
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
        </div>`).join('');
    }

    if (results.transfers.length) {
      html += `<div class="section-title">🔄 Transbordos (${results.transfers.length})</div>`;
      html += results.transfers.map((t, idx) => {
        const colorOffset = results.direct.length;
        const color = TRIP_COLORS[(colorOffset + idx) % TRIP_COLORS.length];

        // Chips del encabezado: un chip cuadrado por cada tramo (ruta) del transbordo
        const chipsHtml = t.legs.map((leg, li) => {
          const legColor = TRIP_COLORS[(colorOffset + li) % TRIP_COLORS.length];
          return `
            <div class="trip-chain-item">
              <div class="trip-chain-chip" style="background:${legColor}">${li + 1}</div>
              <span class="trip-chain-name">${esc(leg.nombre)}</span>
            </div>`;
        }).join('<span class="trip-chain-sep">›</span>');

        // Botones: "Ver trazos" + "Abrir Nª ruta" para cada tramo
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
      html = `<div class="card" style="text-align:center;padding:20px">
        <div class="empty" style="padding:0">
          <h3>Sin resultados</h3>
          <p>No se encontraron rutas. Prueba aumentar el radio o el máximo de transbordos.</p>
        </div>
      </div>`;
    }

    el.innerHTML = html;

    // Eventos de resultados
    el.querySelectorAll('[data-trip-show]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const idx = +b.dataset.tripShow;
        const t = results.transfers[idx];
        if (!t) return;
        // Dibujar SOLO los trazos de este transbordo (ida + vuelta)
        drawTripRoutesOnMap(t.legs.map((l, li) => ({
          route: l,
          label: l.nombre,
          type: 'transfer',                        // ← añadido
          transferPoint: li === 0 ? t.transferPoints[0] : (t.transferPoints[li - 1] || null)
        })));
        // Recolectar todas las coordenadas (ida + vuelta + transbordos)
        const allCoords = [];
        t.legs.forEach(l => {
          allCoords.push(...getRouteCoords(l));
          allCoords.push(...getRouteCoordsVuelta(l));
        });
        t.transferPoints.forEach(tp => { if (tp) allCoords.push(tp); });
        if (allCoords.length) {
          try { state.tripMap.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e){}
        }
        // 📜 Scroll automático al mapa
        const mapEl = document.getElementById('tripMap');
        if (mapEl) {
          mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        toast('Mostrando ' + t.legs.length + ' trazos del transbordo');
      };
    });

    el.querySelectorAll('[data-trip-focus]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const r = state.routes.find(x => x.id === b.dataset.tripFocus);
        if (r) openRouteDetail(r);
      };
    });

    // Click en tarjeta de resultado directo → abrir ruta
    el.querySelectorAll('.result-card.directa').forEach(c => {
      c.onclick = () => {
        const idx = +c.dataset.resultIdx;
        const r = results.direct[idx];
        if (r) openRouteDetail(r.route);
      };
    });

 
  }

  $('#tripRadius').oninput = e => {
    state.tripRadius = +e.target.value;
    $('#tripRadiusVal').textContent = e.target.value;
  };
  $('#tripMaxTransfers')?.addEventListener('change', () => {
    if (state.tripPoints.length) performTripSearch();
  });
  $('#btnTripSearch').onclick = performTripSearch;

  // Toolbar trip
  $$('#tripToolbar .tb').forEach(b => {
    b.onclick = () => {
      const tool = b.dataset.tool;
      if (tool === 'undo') {
        if (!state.tripPoints.length) { toast('No hay puntos para deshacer', 'err'); return; }
        const lastIdx = state.tripPoints.length - 1;
        // Quitar marker y círculo del mapa
        if (state.tripMarkers[lastIdx]) state.tripMap.removeLayer(state.tripMarkers[lastIdx]);
        if (state.tripCircles[lastIdx]) state.tripMap.removeLayer(state.tripCircles[lastIdx]);
        state.tripMarkers.splice(lastIdx, 1);
        state.tripCircles.splice(lastIdx, 1);
        state.tripPoints.splice(lastIdx, 1);
        // Reetiquetar los que quedan
        state.tripPoints.forEach((p, idx) => {
          p.letter = String.fromCharCode(65 + idx);
          p.color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
          const isDefault = TRIP_DEFAULT_NAMES.includes(p.name) || /^PUNTO [A-E]$/.test(p.name);
          if (isDefault) p.name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + p.letter);
        });
        // Redibujar markers con nueva letra/color/nombre
        state.tripMarkers.forEach((m, idx) => {
          const pt = state.tripPoints[idx];
          if (!pt) return;
          const icon = L.divIcon({
            className: '',
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color};position:relative">
              ${pt.letter}
              <span style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);
                background:${pt.color};color:#fff;font-size:9px;font-weight:800;
                padding:2px 6px;border-radius:6px;white-space:nowrap;
                box-shadow:0 2px 6px rgba(0,0,0,.4)">${pt.name}</span>
            </div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          });
          m.setIcon(icon);
        });
              renderTripPointsList();
        performTripSearch();

        // 🔓 Reactivar "+Agregar" si quedan 0 o 1 puntos
        // y resetear la bandera de reactivación
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

        // 🔓 Reactivar "+Agregar" tras limpiar todo
        state.userReactivated = false;   // ← resetear bandera
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

      // 🎯 Si el usuario pulsa "+Agregar" manualmente, activamos la bandera
      // para permitir añadir el 3º, 4º o 5º punto aunque ya haya 2.
      if (tool === 'addpoint') {
        state.userReactivated = true;
      } else {
        state.userReactivated = false;
      }
    };
  });

  // ==================== BOTTOM NAV ====================
  $$('.nav-item').forEach(n => {
    n.onclick = () => navigateTo(n.dataset.page);
  });

  // ==================== INIT ====================
  async function init() {
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (e) { console.warn('SW:', e); }
    }

       // Leer URL inicial
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') || 'routes';
    const postParam = params.get('post');
    const rutaParam = params.get('ruta');
    const marketParam = params.get('market');

    // Cargar datos
    await loadPosts();
    await loadRoutes();
    await loadMarket();

    // Renderizar según URL
    if (postParam) {
      const post = state.posts.find(p => p.id === postParam);
      if (post) {
        state.currentPost = post;
        navigateTo('post', { post: postParam, postObj: post, replace: true });
        renderSinglePost(post);
      } else {
        navigateTo(tab === 'routes' ? 'routes' : 'home', { replace: true });
      }
    } else if (rutaParam) {
      const r = state.routes.find(x => x.id === rutaParam);
      if (r) {
        navigateTo('route', { ruta: rutaParam, route: r, replace: true });
      } else {
        navigateTo(tab === 'routes' ? 'routes' : 'home', { replace: true });
      }
    } else if (marketParam) {
      navigateTo('market', { replace: true });
      // Scroll al anuncio
      setTimeout(() => {
        const card = document.querySelector(`[data-market-id="${marketParam}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    } else {
      navigateTo(tab, { replace: true });
    }
    // Estado de conexión
    updateConn();

    // Cargar Firebase si está disponible
    if (fbDB) syncFromFirebase();
  }

  function renderSinglePost(post) {
    const el = $('#postSingle');
    if (!el) return;
    el.innerHTML = renderPostCard(post);
    bindPostEvents(el);
  }

  $('#postBack').onclick = () => navigateTo('home');

  // Manejar clics en enlaces de botón atrás del navegador dentro de la app
  window.addEventListener('load', () => {
    // Detectar si hay que abrir admin
    if (location.pathname.includes('admin')) {
      // redirigir
      return;
    }
  });

  // ==================== API PÚBLICA ====================
  global.App = {
    state,
    navigateTo,
    goBack,
    openRouteDetail,
    openRouteEditor,
    openPostEditor: () => {
      if (!state.isAdmin) { requestAdminAuth(() => App.openPostEditor()); return; }
      navigateTo('home');
      setTimeout(() => {
        const btn = $('#feedAdminBar button');
        if (btn) btn.click();
      }, 100);
    },
    openMarketEditor: () => {
      if (!state.isAdmin) { requestAdminAuth(() => App.openMarketEditor()); return; }
      navigateTo('market');
      setTimeout(() => {
        const btn = $('#marketAdminBar button');
        if (btn) btn.click();
      }, 100);
    },
    openViewer,
    closeViewer,
    openComments,
    closeModal,
    closeAllModals,
    toast,
    loadPosts,
    loadRoutes,
    loadMarket,
    renderFeed,
    renderRouteContent,
    renderMarket,
    requestAdminAuth,
    isAdmin: () => state.isAdmin
  };

  // Arrancar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
