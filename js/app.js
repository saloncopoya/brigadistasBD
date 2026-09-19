/* ==========================================================================
   APP.JS — Motor principal de la PWA
   Estado global, mapa Leaflet, rutas, búsqueda, editor, navegación, Firebase
   ========================================================================== */
(function (global) {
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
  const DEFAULT_ZOOM = 14;

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

     // ==================== HELPER PROFESIONAL DE MAPAS ====================
  // Sin timers, sin sondeo. Usa solo eventos nativos del navegador:
  //  - ResizeObserver: avisa cuando el contenedor cambia de tamaño
  //  - IntersectionObserver: avisa cuando el contenedor se hace visible
  //  - requestAnimationFrame: garantiza que el layout ya está calculado
  //  - MutationObserver: avisa cuando se abre un modal (.modal.open)
  //
  // REGLA DE ORO: el CSS de .page.has-map mantiene el layout de las páginas
  // con mapa aunque estén ocultas. Así el contenedor NUNCA nace 0x0.

  const registeredMaps = new Set();

  function registerMap(mapInstance) {
    if (!mapInstance || registeredMaps.has(mapInstance)) return;
    registeredMaps.add(mapInstance);

    const container = mapInstance.getContainer();
    if (!container) return;

    // Corrige el tamaño en el siguiente frame de pintado (layout ya calculado)
    const fix = () => {
      requestAnimationFrame(() => {
        try { mapInstance.invalidateSize({ pan: false, animate: false }); } catch (e) {}
      });
    };

    // 1) Cuando el contenedor cambia de tamaño
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(fix);
      ro.observe(container);
      mapInstance.__ro = ro;
    }

    // 2) Cuando el contenedor entra al viewport
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting && e.intersectionRatio > 0) fix();
        });
      }, { threshold: [0, 0.01, 0.1] });
      io.observe(container);
      mapInstance.__io = io;
    }

    // 3) Cuando un modal (.modal) se abre
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

    // 4) Cuando el documento vuelve a ser visible (cambio de pestaña)
    if (!mapInstance.__visHandler) {
      mapInstance.__visHandler = () => { if (!document.hidden) fix(); };
      document.addEventListener('visibilitychange', mapInstance.__visHandler, { passive: true });
    }

    // 5) Cuando la ventana cambia de tamaño (rotación de móvil)
    if (!mapInstance.__winHandler) {
      mapInstance.__winHandler = () => fix();
      window.addEventListener('resize', mapInstance.__winHandler, { passive: true });
    }

    // 6) Una corrección inicial en el siguiente frame
    fix();
  }

  function refreshMap(mapInstance) {
    if (!mapInstance) return;
    try { mapInstance.invalidateSize({ pan: false, animate: false }); } catch (e) {}
  }

   
  // ==================== ESTADO GLOBAL ====================
  const state = {
    currentPage: 'routes',
    currentTab: 'routes',
    routeMode: 'rutas',
    routes: [],
    posts: [],
     postsShown: 2,           
    market: [],
       marketShown: 2,
    filteredMarket: [],
    marketFilter: 'all',
    marketQuery: '',
    currentRoute: null,
    currentPost: null,
    currentMarket: null,
    isAdmin: false,
    online: navigator.onLine,
    historyStack: [],
    editingRoute: null,
    routeDraft: { puntos: [], puntosVuelta: [], calles: [], pois: [], geometriaIda: [], geometriaVuelta: [], colorIda: '#00e5ff', colorVuelta: '#a855f7' },
    editorMap: null,
    editorLayers: { ida: null, vuelta: null, markers: [] },
    drawMode: 'draw',
    drawing: false,
    gpsWatch: null,
    map: null,
    mapLayers: {},
    tripMap: null,
    tripPoints: [],
    tripMarkers: [],
    tripCircles: [],
    tripRadius: 300,
    userReactivated: false,
    fbDB: null,
    commentPostId: null,
    // 🛰️ GPS en vivo
    gpsLive: {
      watchId: null,
      marker: null,
      accuracyCircle: null,
      autoFollow: true,
      firstFix: false,
      heading: null,
      lastLatLng: null,
      minDistanceToPan: 8,
      active: false
    }
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




   
     // ==================== HELPER DE ÍNDICES (Cloudflare Worker + KV) ====================
  // Todos los usuarios comparten 1 read cada 5 min. Baja ~20x el consumo de Firebase.
  async function fetchIndex(key) {
    try {

       
      const res = await fetch('/api/idx?key=' + encodeURIComponent(key), {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('[fetchIndex] Falló:', key, e);
      return null;
    }
  }


   


   
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
  const params = {};
  if (page !== 'routes') params.tab = page;
  if (opts.post)   params.post   = opts.post;
  if (opts.ruta)   params.ruta   = opts.ruta;
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          initTripMap();
          renderTripPointsList();
          // registerMap() ya se encarga de invalidateSize cuando esté listo
        });
      });
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
    const page = st.tab || 'routes';
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

  // ==================== CONEXIÓN (sin UI) ====================
  // Solo mantiene el estado `state.online` actualizado y sincroniza
  function updateConn() {
    state.online = navigator.onLine;
    if (state.online) {
      // Al recuperar conexión, sincronizar (silenciosamente)
      syncPendingQueue();
      syncFromFirebase();
    }
  }
  window.addEventListener('online', updateConn);
  window.addEventListener('offline', updateConn);

  // ==================== PWA INSTALL ====================
 let deferredPrompt = null;

// ✅ NO llamamos e.preventDefault() → el banner NATIVO aparece
window.addEventListener('beforeinstallprompt', e => {
  deferredPrompt = e;
  $('#installBtn').classList.add('show');
});

$('#installBtn').onclick = async () => {
  // Intento 1: prompt nativo
  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') 
      deferredPrompt = null;
      $('#installBtn').classList.remove('show');
      return;
    } catch (err) {
      console.warn('[install] prompt no disponible, mostrando instrucciones');
    }
  }

  // Intento 2: instrucciones específicas por navegador
  const ua = navigator.userAgent.toLowerCase();
  let msg = 'Busca "Instalar aplicación" en el menú del navegador';
  if (ua.includes('edg')) msg = 'Menú Edge (⋯) → Aplicaciones → Instalar esta aplicación';
  else if (ua.includes('chrome') || ua.includes('android')) msg = 'Menú (⋮) → "Instalar aplicación" o "Añadir a pantalla de inicio"';
  else if (ua.includes('firefox')) msg = 'Menú Firefox → "Instalar"';
  else if (ua.includes('safari')) msg = 'Botón Compartir (□↑) → "Añadir a pantalla de inicio"';
  toast(msg, 'ok');
};

window.addEventListener('appinstalled', () => {
  $('#installBtn').classList.remove('show');
  toast('¡App instalada 2! 🎉');
});

if (window.matchMedia('(display-mode: standalone)').matches) {
  $('#installBtn').classList.remove('show');
}

   
   


  // ==================== ANTI-RESURRECCIÓN (TOMBSTONES) ====================
  async function getDeletedSet(tipo) {
    try {
      const db = await DB.openDB();
      const all = await db.getAll('deleted');
      const now = Date.now();
      const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
      const set = new Set();
      for (const d of all) {
        if (!d || d.tipo !== tipo) continue;
        if (now - d.deletedAt > ONE_WEEK) {
          try { await DB.delete('deleted', d.id); } catch(e){}
          continue;
        }
        set.add(d.refId);
      }
      return set;
    } catch(e) { return new Set(); }
  }

  // ==================== POSTS / FEED ====================
  async function loadPosts() {
  const deleted = await getDeletedSet('post');

  let local = [];
  try { local = await DB.getAll('posts'); } catch (e) {}
  local = local.filter(p => !deleted.has(p.id));
  local.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  state.posts = local;
  state.postsShown = 2;

  if (state.posts.length && state.currentPage === 'home') {
    try { renderFeed(); } catch (e) {}
  }

  (async () => {
    try {
      const idx = await Publisher.fetchIndex();
      if (idx && Array.isArray(idx.posts)) {
        const map = new Map(state.posts.map(p => [p.id, p]));
        idx.posts.forEach(p => {
          if (!map.has(p.id) && !deleted.has(p.id)) map.set(p.id, p);
        });
        state.posts = Array.from(map.values())
          .filter(p => p.tipo === 'post' || !p.tipo)
          .filter(p => !deleted.has(p.id))
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (state.currentPage === 'home') renderFeed();
      }
    } catch (e) {}
  })();

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

    // 🔢 PAGINACIÓN: mostrar solo state.postsShown
    const total = state.posts.length;
    const shown = Math.min(state.postsShown, total);
    const visible = state.posts.slice(0, shown);
    const remaining = total - shown;

    feed.innerHTML = visible.map(p => renderPostCard(p)).join('');

    // Botón "Cargar más" (solo si quedan)
    if (remaining > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-block';
      btn.id = 'feedLoadMore';
      btn.style.marginTop = '14px';
      btn.textContent = `Cargar más (${remaining} restantes)`;
      feed.appendChild(btn);

      btn.onclick = () => {
        state.postsShown += 20;
        renderFeed();
      };
    } else if (total > 20) {
      // Mensaje de fin
      const end = document.createElement('div');
      end.className = 'tiny';
      end.style.textAlign = 'center';
      end.style.padding = '14px';
      end.style.opacity = '.6';
      end.textContent = `· ${total} publicaciones cargadas ·`;
      feed.appendChild(end);
    }

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
          <button class="post-action post-share" data-act="share">
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

            let pass = sessionStorage.getItem('tgz_admin') || '';
            if (!pass) pass = prompt('Contraseña admin para eliminar:') || '';
            if (!pass) {
              toast('Se necesita la contraseña para eliminar del servidor', 'err');
              return;
            }

            try {
              const db = await DB.openDB();
              const tx = db.transaction('deleted', 'readwrite');
              tx.objectStore('deleted').put({
                id: 'post:' + id, tipo: 'post', refId: id, deletedAt: Date.now()
              });
              await tx.done;
            } catch(e){}

            await DB.delete('posts', id);
            if (fbDB) {
              try { await fbDB.ref('publicaciones/' + id).remove(); }
              catch (e) { console.warn('[del post]', e); }
            }

            try {
              const res = await Publisher.deleteFromGitHub({ tipo: 'post', slug: id, password: pass });
              if (res.ok) toast('Publicación eliminada ✓');
              else toast('Eliminado local. GitHub: ' + (res.error || ''), 'err');
            } catch (e) {
              toast('Eliminado local (sin conexión)', 'err');
            }

            await loadPosts();
            renderFeed();
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
      



     async function loadRoutes() {
    // ─── FASE 1: IndexedDB local (rápido) ───
    let local = [];
    try { local = await DB.getAll('routes'); } catch (e) {}
    state.routes = local.sort((a, b) =>
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es',
        { numeric: true, sensitivity: 'base' })
    );

    if (state.routes.length && state.currentPage === 'routes') {
      try { renderRouteContent(); } catch (e) {}
    }

    // ─── FASE 2: Worker (índice compartido, cacheado en KV) ───
    if (state.online) {
      (async () => {
        try {
          const idx = await fetchIndex('rutas_index');
          if (!idx) return;
          const map = new Map(state.routes.map(r => [r.id, r]));
          Object.values(idx).forEach(r => {
            if (r && r.id) map.set(r.id, { ...(map.get(r.id) || {}), ...r });
          });
          state.routes = Array.from(map.values()).sort((a, b) =>
            String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es',
              { numeric: true, sensitivity: 'base' })
          );
          if (state.currentPage === 'routes') {
            try { renderRouteContent(); } catch (e) {}
          }
        } catch (e) {
          console.warn('[loadRoutes] Worker falló:', e);
        }
      })();
    }

    __routeIndex = null;
    return state.routes;
  }

  // 🚀 Carga la geometría pesada de UNA ruta bajo demanda.
  // La guarda en IndexedDB para no volver a pedirla.
  async function loadRouteGeo(id) {
    // 1) IndexedDB primero
    try {
      const cached = await DB.get('routes_geo', id);
      if (cached && Array.isArray(cached.geometriaIda)) return cached;
    } catch (e) {}
    // 2) Worker → KV → Firebase
    if (!state.online) return null;
    try {
      const geo = await fetchIndex('rutas_geo/' + id);
      if (geo && typeof geo === 'object') {
        const record = { id, ...geo };
        try { await DB.put('routes_geo', record); } catch (e) {}
        return record;
      }
    } catch (e) {}
    return null;
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
  return `<div class="empty" style="padding:32px 20px">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         style="width:40px;height:40px;margin-bottom:12px;opacity:.6;animation:spin 1s linear infinite">
      <circle cx="12" cy="12" r="10" stroke-opacity=".25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
    </svg>
    <h3>Espere, cargando datos…</h3>
    <p style="margin-top:8px">Si esto tarda demasiado, recargue la pagina y revise su conexión.</p>
  </div>`;
}
     
    const rutasOrdenadas = [...state.routes].sort((a, b) =>
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true, sensitivity: 'base' })
    );
    return `<div class="routes-grid">` + rutasOrdenadas.map(r => `
    <div class="route-card" data-route-id="${esc(r.id)}">
        ${state.isAdmin ? `<div class="edit-del">
          <button class="icon-btn" data-act="edit" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="icon-btn" data-act="del" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
        </div>` : ''}
        <div class="route-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#ffffff" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 5C4.5 3.62 5.62 2.5 7 2.5h10c1.38 0 2.5 1.12 2.5 2.5v11c0 1.1-.9 2-2 2H17v3c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-3h-4v3c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-3H6.5c-1.1 0-2-.9-2-2V5Zm2 .5v2h11v-2h-11Zm0 4V13h5V9.5h-5Zm6 0V13h5V9.5h-5ZM8 15a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg></div>
        <div class="route-name">${esc(r.nombre || 'RUTA')}</div>
        <span class="badge ${r.categoria === 'foranea' ? 'badge-foranea' : 'badge-urbana'}">${esc(r.categoria || 'urbana')}</span>
        <div class="route-actions">
          <button class="icon-btn" data-act="open" title="Abrir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 6l8-3 6 3 8-3v15l-8 3-6-3-8 3z"/></svg></button>
          <button class="icon-btn btn-share" data-act="share" title="Compartir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
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
          <div class="li-title" style="display:flex;align-items:center;gap:8px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16" style="color:var(--cyan);flex-shrink:0;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
  <span>${esc(parada)}</span>
</div>

<button class="btn btn-ghost btn-sm" data-set-place="${esc(parada)}">Seleccionar</button>
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
            <div class="li-title" style="display:flex;align-items:center;gap:8px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16" style="color:var(--cyan);flex-shrink:0;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
  <span>${esc(poi)}</span>
</div>
<button class="btn btn-ghost btn-sm" data-set-place="${esc(poi)}">Seleccionar</button>
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
          <div class="li-title" style="display:flex;align-items:center;gap:8px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16" style="color:var(--cyan);flex-shrink:0;"><path d="M4 20h16"/><path d="M4 4h16"/><path d="M12 4v4"/><path d="M12 12v4"/><path d="M12 20v-4"/></svg>
  <span>${esc(calle)}</span>
</div>
<button class="btn btn-ghost btn-sm" data-set-place="${esc(calle)}">Seleccionar</button>
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
        <div class="li-title" style="display:flex;align-items:center;gap:8px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16" style="color:var(--cyan);flex-shrink:0;"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
  <span>${esc(ret)}</span>
</div>
<button class="btn btn-ghost btn-sm" data-set-place="${esc(ret)}">Seleccionar</button>
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

    // 🎯 NUEVA LÓGICA CÍCLICA: Botones "Seleccionar" con auto-búsqueda
    root.querySelectorAll('[data-set-place]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const valor = btn.dataset.setPlace;
        const originInput = $('#originInput');
        const destInput = $('#destInput');

        // 1. Ir a la pestaña de Rutas
        if (state.currentPage !== 'routes') {
          navigateTo('routes');
        }

        // 2. Lógica cíclica de 3 estados
        if (!originInput.value.trim()) {
          // Estado 1: "Estoy en" vacío → lo llenamos
          originInput.value = valor;
          toast('Origen: ' + valor);
        } else if (!destInput.value.trim()) {
          // Estado 2: "Estoy en" lleno, "A dónde vamos" vacío → lo llenamos
          destInput.value = valor;
          toast('Destino: ' + valor);
        } else {
          // Estado 3: Ambos llenos → limpiamos todo, avisamos y empezamos de nuevo
          originInput.value = '';
          destInput.value = '';
          toast('Campos reiniciados. Nuevo origen: ' + valor, 'ok');
          originInput.value = valor;
        }

              // 3. Auto-buscar si el origen tiene valor
        // (con o sin destino). Consistente con bindSuggest().
        if (originInput.value.trim()) {
          setTimeout(() => {
            const btnSearch = $('#btnSearch');
            if (btnSearch) btnSearch.click();
          }, 200);
        }
      };
    });
  }




     async function openRouteDetail(route) {
    state.currentRoute = route;
    navigateTo('route', { ruta: route.id, route });

    // 🚀 Cargar geometría bajo demanda si no la tenemos
    const needsGeo = !route.geometriaIda || !route.geometriaIda.length;
    if (needsGeo && state.online) {
      const geo = await loadRouteGeo(route.id);
      if (geo) {
        Object.assign(route, geo);
        // Refrescar el mapa con la geometría nueva
        if (state.currentPage === 'route' && state.currentRoute?.id === route.id) {
          try { initRouteMap(route); } catch (e) {}
        }
      }
    }
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
        <button class="btn btn-share btn-sm" id="btnShareRoute">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir ruta
        </button>
      </div>`;
    $('#btnShareRoute').onclick = () => shareRoute(route);
    $('#btnBackRoute').onclick = () => {
      // 🎯 Comportarse como el botón físico de retroceder
      if (state.historyStack.length > 1) {
        state.historyStack.pop();
        history.back();
      } else {
        navigateTo('routes');
      }
    };
     
    // Panel inferior
    const panel = $('#routePanel');
    const blocks = [
      ...(route.notas && String(route.notas).trim() ? [{ key: 'notas', title: 'Notas adicionales', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>', items: [route.notas], isText: true }] : []),
      { key: 'paradas', title: 'Paradas', icon: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', items: route.paradas || [] },      { key: 'retornos', title: 'Retornos', icon: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>', items: route.retornos || [] },
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
            ? (b.isText
              ? `<div style="font-size:14px;line-height:1.6;color:var(--text-2);white-space:pre-wrap">${esc(b.items[0])}</div>`
              : b.key === 'calles'
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

    // Inicializar mapa en el siguiente frame de pintado.
    // La página ya tiene layout gracias a .page.has-map en el CSS.
    // No usamos timers: requestAnimationFrame es determinista.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initRouteMap(route);
      });
    });
  }

     // Offset perpendicular a una polyline (separa ida y regreso en la misma calle)

   
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

  // 🛡️ Destruir el mapa anterior de forma segura
  if (state.map) {
    try {
      // 1. Cancelar animaciones en curso
      state.map.stop();
      // 2. Desconectar observers del helper registerMap
      try { state.map.__ro?.disconnect(); } catch (e) {}
      try { state.map.__io?.disconnect(); } catch (e) {}
      try { state.map.__mo?.disconnect(); } catch (e) {}
      // 3. Remover el mapa
      state.map.remove();
    } catch (e) { console.warn('[initRouteMap] cleanup:', e); }
    state.map = null;
  }

  // Limpiar el contenedor
  const cont = document.getElementById('map');
  if (cont) {
    if (cont._leaflet_id) {
      try { delete cont._leaflet_id; } catch (e) { cont._leaflet_id = undefined; }
    }
    // Vaciar por si quedaron residuos
    cont.innerHTML = '';
  }
     
     
    state.map = L.map(container, {
  zoomControl: true,
  minZoom: 13,
maxZoom: 22, zoomSnap: 0.5, zoomDelta: 0.5,
  // 🛡️ Evita animaciones de zoom que rompen _leaflet_pos
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

     
     // ✨ Registrar el mapa para auto-reparación (sin timers)
    registerMap(state.map);

     
    // 🖥️ Conectar el botón de pantalla completa con este mapa (sin timers)
    bindFullscreenButton('routeMapFsBtn', 'routeMapWrap');
   

          L.tileLayer('https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}@2x.png?key=kXZYdaMbZkD1EevhGXMI', {
  tileSize: 512,
  zoomOffset: -1,
  minZoom: 13,
 maxZoom: 22,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  maxNativeZoom: 20,
  crossOrigin: true,
  attribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
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
        lineCap: 'round',
                 dashArray: '10, 6'
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
      // Refrescamos tamaño ANTES de fitBounds y lo repetimos en los siguientes
      // frames de pintado, para garantizar que se calcula con el tamaño correcto.
      refreshMap(state.map);
      try { state.map.fitBounds(L.latLngBounds(allPts).pad(0.15)); } catch (e) {}
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refreshMap(state.map);
          try { state.map.fitBounds(L.latLngBounds(allPts).pad(0.15)); } catch (e) {}
        });
      });
    } else if (route.calles && route.calles.length) {
      // Si no hay puntos pero hay calles, mostrar centro por defecto
      state.map.setView(DEFAULT_CENTER, 13);
    } else {
      state.map.setView(DEFAULT_CENTER, 12);
    }

    // --- Leyenda flotante (compacta, líneas gruesas) + botón centrar viaje ---
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <div style="background:rgba(20,28,48,.92);padding:4px 10px;border-radius:8px;font-size:11px;color:#e8edf7;border:1px solid #26314f;line-height:1.3;display:flex;flex-direction:column;gap:2px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:16px;height:5px;background:${colorIda};border-radius:2px"></span>
            <span>Ida</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:16px;height:5px;background:${colorVuelta};border-radius:2px"></span>
            <span>Regreso</span>
          </div>
        </div>`;
      return div;
    };
    legend.addTo(state.map);

    // --- Botón inferior centrado: "Agregar ubicación" → ir a trip ---
const tripBtn = L.control({ position: 'topleft' });
     tripBtn.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-trip-btn-wrap');
      div.innerHTML = `
        <button class="map-trip-btn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span>Agregar Ubicacion</span>
          <small>Rutas cercanas · Mapa interactivo</small>
        </button>`;
      const btn = div.querySelector('.map-trip-btn');
      L.DomEvent.disableClickPropagation(div);
      btn.addEventListener('click', () => {
        navigateTo('trip');
      });
      return div;
    };
    tripBtn.addTo(state.map);

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

         
        s.onclick = () => {
          input.value = s.dataset.val;
          sug.classList.add('hidden');
          // 🔎 Auto-buscar si el campo de origen ya tiene valor
          // (con o sin destino). Si solo hay origen, muestra las rutas
          // que pasan por ahí; si hay ambos, hace la búsqueda completa.
          const o = $('#originInput')?.value.trim();
          if (o) {
            setTimeout(() => { $('#btnSearch')?.click(); }, 80);
          }
        };

         
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
    const el = $('#searchResults');
    el.classList.remove('hidden');

    // 🎯 CASO 1: Solo hay origen → filtramos rutas que pasan por ahí
    if (o && !d) {
      const rutasFiltradas = state.routes.filter(r => {
        const all = [].concat(r.paradas || [], r.pois || [], r.poisVuelta || [], r.calles || [], r.retornos || []);
        return all.some(x => norm(x).includes(norm(o)) || norm(o).includes(norm(x)));
      });

      if (!rutasFiltradas.length) {
        el.innerHTML = `<div class="card" style="text-align:center;padding:24px">
          <div class="empty" style="padding:0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <h3>Sin resultados</h3>
            <p>No se encontraron rutas que pasen por "${esc(o)}".</p>
          </div>
        </div>`;
        return;
      }

      let html = `<div class="section-title">Rutas que pasan por "${esc(o)}" (${rutasFiltradas.length})</div>`;
      html += rutasFiltradas.map(r => `
        <div class="result-card directa" data-route-id="${esc(r.id)}" style="cursor:pointer">
          <div class="rc-head">
          
            
            <div style="flex:1">
              <div class="rc-route">${esc(r.nombre)}</div>
              <div class="rc-sub">${esc(r.categoria || 'urbana')}</div>
            </div>
            <span class="badge badge-green">Pasa por aquí</span>

            
          </div>
        </div>`).join('');
       
      el.innerHTML = html;

      el.querySelectorAll('.result-card').forEach(c => {
        c.onclick = () => {
          const r = state.routes.find(x => x.id === c.dataset.routeId);
          if (r) openRouteDetail(r);
        };
      });
      return;
    }

    // 🎯 CASO 2: No hay nada → avisar
    if (!o && !d) {
      toast('Ingresa al menos un origen', 'err');
      el.classList.add('hidden');
      return;
    }

    // 🎯 CASO 3: Hay origen y destino → búsqueda completa (directas + transbordos)
    const res = findRoutes(o, d);

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
        <div class="result-card transbordo">
          <div class="rc-head">
            <div class="rc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>
            <div style="flex:1">
              <div class="rc-route">${esc(t.r1.nombre)} → ${esc(t.r2.nombre)}</div>
            </div>
            <span class="badge badge-amber">Transbordo</span>
          </div>
          <div class="rc-steps">
            <div class="rc-step" data-open-route="${esc(t.r1.id)}" style="cursor:pointer">
              <div class="step-num">1</div>
              <div>Toma la ruta <b>${esc(t.r1.nombre)}</b></div>
            </div>
            <div class="rc-step" data-open-route="${esc(t.r2.id)}" style="cursor:pointer">
              <div class="step-num">2</div>
              <div>Sube a la ruta <b>${esc(t.r2.nombre)}</b></div>
            </div>
          </div>
        </div>`).join('');
    }

     
    el.innerHTML = html;

    // Click en la tarjeta completa (rutas directas con data-route-id)
    el.querySelectorAll('.result-card[data-route-id]').forEach(c => {
      c.onclick = (e) => {
        if (e.target.closest('[data-open-route]')) return;
        const r = state.routes.find(x => x.id === c.dataset.routeId);
        if (r) openRouteDetail(r);
      };
    });

    // 🎯 Click en los pasos "Toma la ruta" / "Sube a la ruta" (transbordos)
    el.querySelectorAll('[data-open-route]').forEach(step => {
      step.onclick = (e) => {
        e.stopPropagation();
        const r = state.routes.find(x => x.id === step.dataset.openRoute);
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

    // HTML de los dos estados del botón
    const HTML_ENTER = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
        <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
        <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
      </svg>
    `;
    const HTML_EXIT = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
        <path d="M9 3v3a2 2 0 0 1-2 2H4"/>
        <path d="M21 9h-3a2 2 0 0 0-2 2v3"/>
        <path d="M3 15h3a2 2 0 0 1 2 2v3"/>
        <path d="M15 21v-3a2 2 0 0 1 2-2h3"/>
      </svg>
    `;

    // Asegurar estado inicial
    btn.innerHTML = HTML_ENTER;
    btn.title = 'Pantalla completa';

    btn.onclick = (e) => {
      e.stopPropagation();
      const isFs = wrap.classList.toggle('is-fullscreen');
      btn.classList.toggle('is-fullscreen', isFs);
      document.body.classList.toggle('fs-active', isFs);

      // 🎨 Cambiar el icono y el tooltip según el estado
      btn.innerHTML = isFs ? HTML_EXIT : HTML_ENTER;
      btn.title = isFs ? 'Salir de pantalla completa' : 'Pantalla completa';

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
      if (fbDB && state.online) {
        // 🎯 Separar índice y geometría
        const routeIndex = { ...route };
        delete routeIndex.geometriaIda;
        delete routeIndex.geometriaVuelta;

        const routeGeo = {
          id,
          geometriaIda: state.routeDraft.geometriaIda || [],
          geometriaVuelta: state.routeDraft.geometriaVuelta || []
        };

        await Promise.all([
          fbDB.ref('rutas_index/' + id).set(routeIndex).catch(() => {}),
          fbDB.ref('rutas_geo/' + id).set(routeGeo).catch(() => {})
        ]);
      }
      await loadRoutes();
      renderRouteContent();
      closeModal('editorModal');
      toast('Ruta guardada ✓');
       
    };
  }

  // ==================== MARKETPLACE ====================
  async function loadMarket() {
  const deleted = await getDeletedSet('market');

  let local = [];
  try { local = await DB.getAll('market'); } catch (e) {}
  local = local.filter(m => !deleted.has(m.id));
  state.market = local.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  state.marketShown = 2;

  if (state.market.length && state.currentPage === 'market') {
    try { renderMarket(); } catch (e) {}
  }

  if (state.online) {
    (async () => {
      try {
        const val = await fetchIndex('marketplace');
        if (!val) return;
        const map = new Map(state.market.map(m => [m.id, m]));
        Object.values(val).forEach(m => {
          if (m && m.id && !map.has(m.id) && !deleted.has(m.id)) map.set(m.id, m);
        });
        state.market = Array.from(map.values())
          .filter(m => !deleted.has(m.id))
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (state.currentPage === 'market') renderMarket();
      } catch (e) {}
    })();
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
       // 🔢 PAGINACIÓN: mostrar solo state.marketShown
    const total = items.length;
    const shown = Math.min(state.marketShown, total);
    const visible = items.slice(0, shown);
    const remaining = total - shown;

    grid.innerHTML = visible.map(m => `
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
          <button class="btn btn-share btn-sm" data-mact="share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </div>`).join('');

    // Botón "Cargar más" (solo si quedan)
    if (remaining > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.id = 'marketLoadMore';
      btn.style.gridColumn = '1 / -1';
      btn.style.marginTop = '14px';
      btn.textContent = `Cargar más (${remaining} restantes)`;
      grid.appendChild(btn);

      btn.onclick = () => {
        state.marketShown += 20;
        renderMarket();
      };
    } else if (total > 20) {
      const end = document.createElement('div');
      end.className = 'tiny';
      end.style.gridColumn = '1 / -1';
      end.style.textAlign = 'center';
      end.style.padding = '14px';
      end.style.opacity = '.6';
      end.textContent = `· ${total} anuncios cargados ·`;
      grid.appendChild(end);
    }
     

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
  $('#marketSearch').oninput = e => {
    state.marketQuery = e.target.value;
    state.marketShown = 2;   
    renderMarket();
  };
  $$('#marketCats .chip').forEach(c => {
    c.onclick = () => {
      $$('#marketCats .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      state.marketFilter = c.dataset.cat;
      state.marketShown = 2;   
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
      // 🛡️ Recolectar IDs pendientes de subir para NO borrarlos
      const pendingIds = new Set();
      try {
        const queue = await DB.getQueue();
        queue.forEach(item => {
          const payload = item.payload || item;
          if (payload && payload.id) pendingIds.add(payload.id);
        });
      } catch (e) {}

      const [postsSnap, routesSnap, marketSnap] = await Promise.all([
        fbDB.ref('publicaciones').once('value'),
        fbDB.ref('rutas_index').once('value'),
        fbDB.ref('marketplace').once('value')
      ]);

      // 🛡️ GUARD por nodo
      const hayPosts = postsSnap.exists();
      const hayRoutes = routesSnap.exists();
      const hayMarket = marketSnap.exists();

      if (!hayPosts && !hayRoutes && !hayMarket) {
        console.warn('[Sync] Firebase no tiene datos remotos. No se borra local por seguridad.');
        return;
      }

      const posts = postsSnap.val() || {};
      const routes = routesSnap.val() || {};
      const market = marketSnap.val() || {};

      const remotePostIds = new Set(Object.values(posts).filter(p => p && p.id).map(p => p.id));
      const remoteRouteIds = new Set(Object.values(routes).filter(r => r && r.id).map(r => r.id));
      const remoteMarketIds = new Set(Object.values(market).filter(m => m && m.id).map(m => m.id));

      const localPosts = await DB.getAll('posts');
      const localRoutes = await DB.getAll('routes');
      const localMarket = await DB.getAll('market');
      const localPostIds = new Set(localPosts.map(p => p.id));
      const localRouteIds = new Set(localRoutes.map(r => r.id));
      const localMarketIds = new Set(localMarket.map(m => m.id));

      for (const p of Object.values(posts)) if (p && p.id) await DB.put('posts', p);
      for (const r of Object.values(routes)) if (r && r.id) await DB.put('routes', r);
      for (const m of Object.values(market)) if (m && m.id) await DB.put('market', m);

      // 🧹 Borrar solo si NO está pendiente de subir
      if (hayPosts) {
        for (const id of localPostIds) {
          if (!remotePostIds.has(id) && !pendingIds.has(id)) await DB.delete('posts', id);
        }
      }
      if (hayRoutes) {
        for (const id of localRouteIds) {
          if (!remoteRouteIds.has(id) && !pendingIds.has(id)) await DB.delete('routes', id);
        }
      }
      if (hayMarket) {
        for (const id of localMarketIds) {
          if (!remoteMarketIds.has(id) && !pendingIds.has(id)) await DB.delete('market', id);
        }
      }

      await loadPosts(); await loadRoutes(); await loadMarket();
      renderFeed(); renderRouteContent(); renderMarket();
    } catch (e) { console.warn('[Sync]', e); }
  }

  // ==================== TRIP SEARCH (MAPA) ====================
    function initTripMap() {
    if (state.tripMap) { state.tripMap.invalidateSize(); return; }
    const el = document.getElementById('tripMap');
    if (!el) return;
    state.tripMap = L.map(el, {       zoomControl: false,       minZoom: 13,     maxZoom: 22, zoomSnap: 0.5, zoomDelta: 0.5     }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.control.zoom({ position: 'bottomleft' }).addTo(state.tripMap);
    // ✨ Registrar el mapa para auto-reparación (sin timers)
    registerMap(state.tripMap);
       
    // 🖥️ Conectar el botón de pantalla completa con este mapa (sin timers)
    bindFullscreenButton('tripMapFsBtn', 'tripMapWrap');
       
      L.tileLayer('https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}@2x.png?key=kXZYdaMbZkD1EevhGXMI', {
  tileSize: 512,
  zoomOffset: -1,
  minZoom: 13,
 maxZoom: 22,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  maxNativeZoom: 20,
  crossOrigin: true,
  attribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
}).addTo(state.tripMap);
       


       state.tripMap.on('click', e => {
      // Solo agregar si el botón addpoint tiene la clase .active
      const addBtn = document.querySelector('#tripToolbar .tb[data-tool="addpoint"]');
      if (!addBtn || !addBtn.classList.contains('active')) return;

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
  const TRIP_DEFAULT_NAMES = ['ESTOY AQUÍ', 'DESTINO', 'PASO POR', 'DESVÍO A', 'LLEGARÉ AQUÍ'];

  function addTripPoint(lat, lng) {
    const idx = state.tripPoints.length;
    const letter = String.fromCharCode(65 + idx); // A, B, C, D, E
    const color = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'][idx] || '#00e5ff';
    const name = TRIP_DEFAULT_NAMES[idx] || ('PUNTO ' + letter);
    state.tripPoints.push({ lat, lng, letter, color, radius: state.tripRadius, name });

             const icon = L.divIcon({
      className: '',
      html: `<div class="marker-${letter.toLowerCase()}" style="background:${color}">
        ${letter}
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

    // 🎯 Mostrar/ocultar los controles según haya puntos o no
    const controlsRow = $('#tripControlsRow');
    if (controlsRow) {
      if (state.tripPoints.length >= 1) {
        controlsRow.classList.remove('hidden');
      } else {
        controlsRow.classList.add('hidden');
      }
    }

    if (!state.tripPoints.length) {
      el.innerHTML = '<div class="empty-trip"> Toca el mapa para agregar ubicaciones y ver las rutas cercanas.</div>';
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
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color}">
              ${pt.letter}
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

     // 📏 Distancia acumulada del viaje: A→B + B→C + C→D + ...
  // Recorre los puntos del viaje en orden y suma las distancias
  // entre cada par consecutivo. Devuelve un string formateado:
  // "450 m", "1.2 km", "12.3 km", etc.
  function formatTripDistance(points) {
    if (!points || points.length < 2) return '—';
    let metros = 0;
    for (let i = 0; i < points.length - 1; i++) {
      metros += haversine(
        points[i].lat, points[i].lng,
        points[i + 1].lat, points[i + 1].lng
      );
    }
    if (metros < 1000) return `${Math.round(metros)} m`;
    return `${(metros / 1000).toFixed(1)} km`;
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
  // ¿La ruta pasa cerca de un punto? (usado por performTripSearch)
  function routeNearPoint(route, point, radius) {
    if (!route) return false;
    const lat = point.lat != null ? point.lat : point[0];
    const lng = point.lng != null ? point.lng : point[1];
    return routeDistanceToPoint(route, lat, lng) <= radius;
  }

   
     // ============================================================
  //  🧠 MOTOR INTELIGENTE DE TRANSBORDOS (v2)
  //  - Detecta intersecciones reales de trazos (ida/vuelta)
  //  - Respeta la dirección del trazo (A → B)
  //  - Coloca el transbordo lo más cerca posible de A
  //  - Tolerancia configurable para paralelas (avenidas doble sentido)
  //  - Indexación espacial (cuadrícula) para O(n) con cientos de rutas
  //  - Máximo 2 transbordos (configurable)
  //  - Sin OSRM, sin servicios externos
  // ============================================================

  const TRIP_COLORS = ['#00e5ff','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#84cc16','#f97316','#14b8a6','#8b5cf6','#eab308'];

  // ─────── CONSTANTES DE CONFIGURACIÓN ───────
  // Tolerancia para considerar que dos trazos se "tocan" aunque no se crucen
  // exactamente (paralelas en avenidas de doble sentido, mismos carriles, etc.)
  const TRANSFER_TOLERANCE_M = 150;
  // Distancia máxima de caminata entre el punto de transbordo y el inicio
  // del siguiente trazo (por si el offset de ida/vuelta los separa).
  const TRANSFER_WALK_MAX_M = 200;
  // Máximo de transbordos permitidos (el HTML ya limita el select a 1 o 2)
  const MAX_TRANSFERS_HARD = 2;
  // Tamaño de celda de la cuadrícula espacial (en grados, ~ 0.005 ≈ 550 m)
  const GRID_CELL_DEG = 0.005;

  let tripRouteLayers = [];
  let tripCurrentHighlight = null;

  function clearTripRouteLayers() {
    tripRouteLayers.forEach(l => { try { state.tripMap.removeLayer(l); } catch(e){} });
    tripRouteLayers = [];
  }

  // ─────── UTILIDADES GEO ───────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  // Convierte un punto [lat,lng] a metros locales (proyección equirectangular).
  // Usamos esto para comparar distancias reales en metros sin recalcular
  // haversine por cada segmento (mucho más rápido).
  function projectToMeters(lat, lng, refLat) {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(refLat * Math.PI / 180);
    return [lng * mPerDegLng, lat * mPerDegLat];
  }

  // ─────── EXTRACCIÓN DE TRAZOS ───────
  // Devuelve TODOS los segmentos de una ruta con metadata de dirección.
  // Un "segmento" es { a:[lat,lng], b:[lat,lng], idx, sentido:'ida'|'vuelta', ruta }
  function getRouteSegments(route) {
    const segs = [];
    const pushSegs = (pts, sentido) => {
      if (!pts || pts.length < 2) return;
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({
          a: pts[i],
          b: pts[i + 1],
          idx: i,
          sentido,
          ruta: route
        });
      }
    };
    // IDA
    const ida = (route.geometriaIda && route.geometriaIda.length > 1)
      ? route.geometriaIda
      : (route.puntos || []);
    pushSegs(ida, 'ida');
    // VUELTA
    const vuelta = (route.geometriaVuelta && route.geometriaVuelta.length > 1)
      ? route.geometriaVuelta
      : (route.puntosVuelta || []);
    pushSegs(vuelta, 'vuelta');
    return segs;
  }

  // ─────── BOUNDING BOX + CUADRÍCULA ESPACIAL ───────
  function bboxOfRoute(route) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    const scan = (pts) => {
      if (!pts) return;
      for (const p of pts) {
        if (p[0] < minLat) minLat = p[0];
        if (p[0] > maxLat) maxLat = p[0];
        if (p[1] < minLng) minLng = p[1];
        if (p[1] > maxLng) maxLng = p[1];
      }
    };
    scan(route.geometriaIda); scan(route.puntos);
    scan(route.geometriaVuelta); scan(route.puntosVuelta);
    if (minLat === Infinity) return null;
    return { minLat, maxLat, minLng, maxLng };
  }

  function bboxIntersects(a, b, marginDeg) {
    const m = marginDeg || 0;
    return !(a.maxLat + m < b.minLat || a.minLat - m > b.maxLat ||
             a.maxLng + m < b.minLng || a.minLng - m > b.maxLng);
  }

  // Índice espacial global (se reconstruye cada vez que cambian las rutas)
  let __routeIndex = null;
  function buildRouteIndex() {
    const idx = {
      routes: [],
      bbox: new Map(),        // routeId → bbox
      grid: new Map(),        // cellKey → [routeId,...]
      segments: new Map()     // routeId → [segments]
    };
    const cellKey = (lat, lng) => {
      const cx = Math.floor(lng / GRID_CELL_DEG);
      const cy = Math.floor(lat / GRID_CELL_DEG);
      return cx + ',' + cy;
    };
    for (const r of state.routes) {
      const bbox = bboxOfRoute(r);
      if (!bbox) continue;
      idx.routes.push(r);
      idx.bbox.set(r.id, bbox);
      const segs = getRouteSegments(r);
      if (!segs.length) continue;
      idx.segments.set(r.id, segs);
      // Insertar en cuadrícula: cada segmento aporta su celda y vecinas
      const insertedCells = new Set();
      for (const s of segs) {
        // Muestreamos algunos puntos del segmento para cubrir toda la línea
        const steps = 3;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const lat = s.a[0] + (s.b[0] - s.a[0]) * t;
          const lng = s.a[1] + (s.b[1] - s.a[1]) * t;
          const key = cellKey(lat, lng);
          if (!insertedCells.has(key)) {
            insertedCells.add(key);
            if (!idx.grid.has(key)) idx.grid.set(key, new Set());
            idx.grid.get(key).add(r.id);
          }
        }
      }
    }
    __routeIndex = idx;
    return idx;
  }

  function getIndex() {
    if (!__routeIndex) return buildRouteIndex();
    // Verificamos rápidamente si cambió el número de rutas (caso barato)
    if (__routeIndex.routes.length !== state.routes.length) {
      return buildRouteIndex();
    }
    return __routeIndex;
  }

  // Rutas candidatas cerca de un punto (usa la cuadrícula espacial)
  function routesNear(lat, lng, radiusMeters) {
    const idx = getIndex();
    const out = new Set();
    const cellDeg = GRID_CELL_DEG;
    const latRadiusDeg = radiusMeters / 111320;
    const lngRadiusDeg = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
    const cells = Math.ceil(Math.max(latRadiusDeg, lngRadiusDeg) / cellDeg) + 1;
    const cx0 = Math.floor(lng / cellDeg);
    const cy0 = Math.floor(lat / cellDeg);
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        const key = (cx0 + dx) + ',' + (cy0 + dy);
        const set = idx.grid.get(key);
        if (set) set.forEach(id => out.add(id));
      }
    }
    // Filtrar por bbox real (más preciso)
    const result = [];
    for (const id of out) {
      const r = idx.routes.find(x => x.id === id);
      if (!r) continue;
      const bb = idx.bbox.get(id);
      if (!bb) continue;
      if (lat < bb.minLat - latRadiusDeg || lat > bb.maxLat + latRadiusDeg) continue;
      if (lng < bb.minLng - lngRadiusDeg || lng > bb.maxLng + lngRadiusDeg) continue;
      result.push(r);
    }
    return result;
  }

  // ─────── DISTANCIA PUNTO → RUTA (más cercana, con dirección opcional) ───────
  // Retorna { dist, point, segIdx, sentido, idx } o null
  // Si requireDir = 'forward' | 'backward' | null, filtra por dirección
  // respecto al punto de referencia `refPoint` (normalmente el destino B).
  // 'forward'  → el segmento avanza hacia refPoint
  // 'backward' → el segmento se aleja de refPoint
  function closestPointOnRoute(route, lat, lng, opts) {
    opts = opts || {};
    const segs = getRouteSegments(route);
    if (!segs.length) return null;

    const refLat = opts.refLat != null ? opts.refLat : lat;
    const pMeters = projectToMeters(lat, lng, refLat);

    let best = null;
    for (const s of segs) {
      // Proyección local: usamos refLat para el eje lng
      const aM = projectToMeters(s.a[0], s.a[1], refLat);
      const bM = projectToMeters(s.b[0], s.b[1], refLat);
      const dx = bM[0] - aM[0], dy = bM[1] - aM[1];
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = ((pMeters[0] - aM[0]) * dx + (pMeters[1] - aM[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const cx = aM[0] + t * dx, cy = aM[1] + t * dy;
      const dist = Math.hypot(pMeters[0] - cx, pMeters[1] - cy);

      // Reconstruir lat/lng aproximado del punto proyectado
      const latP = s.a[0] + (s.b[0] - s.a[0]) * t;
      const lngP = s.a[1] + (s.b[1] - s.a[1]) * t;

      // Si se exige dirección, comprobamos el sentido del segmento
      if (opts.requireDir) {
        const vectorSeg = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
        const vectorToRef = [refLat - latP, opts.refLng != null ? (opts.refLng - lngP) : 0];
        const dot = vectorSeg[0] * vectorToRef[0] + vectorSeg[1] * vectorToRef[1];
        // Si el destino está "hacia adelante" respecto al segmento, el dot > 0
        const avanzandoHaciaRef = dot > 0;
        if (opts.requireDir === 'forward' && !avanzandoHaciaRef) continue;
        if (opts.requireDir === 'backward' && avanzandoHaciaRef) continue;
      }

      if (!best || dist < best.dist) {
        best = {
          dist,
          point: [latP, lngP],
          segIdx: s.idx,
          sentido: s.sentido,
          segStart: s.a,
          segEnd: s.b,
          t
        };
      }
    }
    return best;
  }

  // ─────── DISTANCIA ENTRE DOS TRAZOS (segmento → segmento) ───────
  // Retorna { dist, mid, p1, p2 } con el punto medio entre los dos más cercanos
  function segmentSegmentDistance(s1, s2) {
    // Test rápido bbox de cada segmento
    const s1minLat = Math.min(s1.a[0], s1.b[0]);
    const s1maxLat = Math.max(s1.a[0], s1.b[0]);
    const s1minLng = Math.min(s1.a[1], s1.b[1]);
    const s1maxLng = Math.max(s1.a[1], s1.b[1]);
    const s2minLat = Math.min(s2.a[0], s2.b[0]);
    const s2maxLat = Math.max(s2.a[0], s2.b[0]);
    const s2minLng = Math.min(s2.a[1], s2.b[1]);
    const s2maxLng = Math.max(s2.a[1], s2.b[1]);
    const latOverlap = !(s1maxLat < s2minLat || s1minLat > s2maxLat);
    const lngOverlap = !(s1maxLng < s2minLng || s1minLng > s2maxLng);
    if (!latOverlap || !lngOverlap) return null;

    // Proyectar a metros locales
    const refLat = (s1.a[0] + s1.b[0] + s2.a[0] + s2.b[0]) / 4;
    const a1 = projectToMeters(s1.a[0], s1.a[1], refLat);
    const b1 = projectToMeters(s1.b[0], s1.b[1], refLat);
    const a2 = projectToMeters(s2.a[0], s2.a[1], refLat);
    const b2 = projectToMeters(s2.b[0], s2.b[1], refLat);

    // Distancia entre segmentos (algoritmo clásico)
    const d1 = pointToSegmentDistance(a1, a2, b2);
    const d2 = pointToSegmentDistance(b1, a2, b2);
    const d3 = pointToSegmentDistance(a2, a1, b1);
    const d4 = pointToSegmentDistance(b2, a1, b1);
    const dist = Math.min(d1, d2, d3, d4);

    // Punto medio entre los dos más cercanos (aproximado)
    const midLat = (s1.a[0] + s1.b[0] + s2.a[0] + s2.b[0]) / 4;
    const midLng = (s1.a[1] + s1.b[1] + s2.a[1] + s2.b[1]) / 4;
    return { dist, mid: [midLat, midLng] };
  }


  // ─────── INTERSECCIÓN O PROXIMIDAD ENTRE DOS RUTAS ───────
  // Devuelve { point, dist, sentido } — SOLO si hay un par de segmentos
  // (uno de cada ruta) que:
  //   1) Se tocan o están cerca (≤ TRANSFER_TOLERANCE_M)
  //   2) AMBOS van hacia `towards`
  //   3) Ambos son del MISMO sentido (ida con ida, vuelta con vuelta)
  function findMeetingPoint(r1, r2, towards) {
    const segs1 = getRouteSegments(r1);
    const segs2 = getRouteSegments(r2);
    if (!segs1.length || !segs2.length) return null;

    const refLat = towards[0];
    let best = null;

    for (const s1 of segs1) {
      const s1minLat = Math.min(s1.a[0], s1.b[0]);
      const s1maxLat = Math.max(s1.a[0], s1.b[0]);
      const s1minLng = Math.min(s1.a[1], s1.b[1]);
      const s1maxLng = Math.max(s1.a[1], s1.b[1]);
      const marginLat = TRANSFER_TOLERANCE_M / 111320;
      const marginLng = TRANSFER_TOLERANCE_M / (111320 * Math.cos(refLat * Math.PI / 180));

      for (const s2 of segs2) {


        const s2minLat = Math.min(s2.a[0], s2.b[0]);
        const s2maxLat = Math.max(s2.a[0], s2.b[0]);
        const s2minLng = Math.min(s2.a[1], s2.b[1]);
        const s2maxLng = Math.max(s2.a[1], s2.b[1]);

        if (s1maxLat + marginLat < s2minLat || s1minLat - marginLat > s2maxLat) continue;
        if (s1maxLng + marginLng < s2minLng || s1minLng - marginLng > s2maxLng) continue;

        const d = segmentSegmentDistance(s1, s2);
        if (!d || d.dist > TRANSFER_TOLERANCE_M) continue;

        // Ambos segmentos deben avanzar hacia `towards`
        if (!segmentTowards(s1, towards)) continue;
        if (!segmentTowards(s2, towards)) continue;

        const score = d.dist;
        if (!best || score < best.dist) {
          best = {
            point: d.mid,
            dist: d.dist,
            sentido: s1.sentido,
            seg1: s1,
            seg2: s2
          };
        }
      }
    }
    return best;
  }
  // ¿El segmento s avanza hacia `towards`?
  function segmentTowards(s, towards) {
    const vx = s.b[1] - s.a[1];
    const vy = s.b[0] - s.a[0];
    const wx = towards[1] - s.a[1];
    const wy = towards[0] - s.a[0];
    return (vx * wx + vy * wy) > 0;
  }


     // ─────── DISTANCIA PUNTO → RUTA CON DIRECCIÓN HACIA `towards` ───────
  // Devuelve { dist, point, sentido:'ida'|'vuelta', seg }.
  // El `sentido` indica si el segmento que cumple la dirección hacia
  // `towards` es de IDA o de VUELTA.
  function routeTowardsPoint(route, from, towards) {
    const segs = getRouteSegments(route);
    let best = null;
    for (const s of segs) {
      const refLat = from[0];
      const pM = projectToMeters(from[0], from[1], refLat);
      const aM = projectToMeters(s.a[0], s.a[1], refLat);
      const bM = projectToMeters(s.b[0], s.b[1], refLat);
      const dx = bM[0] - aM[0], dy = bM[1] - aM[1];
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = ((pM[0] - aM[0]) * dx + (pM[1] - aM[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const cx = aM[0] + t * dx, cy = aM[1] + t * dy;
      const dist = Math.hypot(pM[0] - cx, pM[1] - cy);
      const latP = s.a[0] + (s.b[0] - s.a[0]) * t;
      const lngP = s.a[1] + (s.b[1] - s.a[1]) * t;

      if (!segmentTowards(s, towards)) continue;
      if (t > 0.98) continue;

      if (!best || dist < best.dist) {
        best = {
          dist,
          point: [latP, lngP],
          seg: s,
          sentido: s.sentido
        };
      }
    }
    return best;
  }
   

     // ─────── BÚSQUEDA DE CADENAS DE TRANSBORDO (v2 inteligente) ───────
  function findTransferChains(startPoint, endPoint, maxTransfers) {
    maxTransfers = Math.min(MAX_TRANSFERS_HARD, Math.max(1, +maxTransfers || 1));
    const chains = [];

    const A = [startPoint.lat, startPoint.lng];
    const B = [endPoint.lat, endPoint.lng];

    const startRoutes = routesNear(A[0], A[1], startPoint.radius)
      .filter(r => routeDistanceToPoint(r, A[0], A[1]) <= startPoint.radius);

    const endRoutes = routesNear(B[0], B[1], endPoint.radius)
      .filter(r => routeDistanceToPoint(r, B[0], B[1]) <= endPoint.radius);

    if (!startRoutes.length || !endRoutes.length) return chains;

         console.log('[Transbordos] Rutas cerca de A:', startRoutes.length);
    console.log('[Transbordos] Rutas cerca de B:', endRoutes.length);
    startRoutes.forEach(r => console.log('  A-side:', r.nombre, '| ida:', (r.puntos||r.geometriaIda||[]).length, '| vuelta:', (r.puntosVuelta||r.geometriaVuelta||[]).length));
    endRoutes.forEach(r => console.log('  B-side:', r.nombre, '| ida:', (r.puntos||r.geometriaIda||[]).length, '| vuelta:', (r.puntosVuelta||r.geometriaVuelta||[]).length));

    // ─── 1 TRANSBORDO (2 rutas) ───
    if (maxTransfers >= 1) {
      for (const r1 of startRoutes) {
        for (const r2 of endRoutes) {
          if (r1.id === r2.id) continue;

                  // ¿r1 va de A hacia B?
          const dir1 = routeTowardsPoint(r1, A, B);
          if (!dir1) continue;

          // Punto de encuentro
          const meet = findMeetingPoint(r1, r2, B);
          if (!meet) continue;

          const distAtoMeet1 = haversine(A[0], A[1], meet.point[0], meet.point[1]);

          const dir2 = routeTowardsPoint(r2, meet.point, B);
          if (!dir2) continue;

          chains.push({
            type: 'transfer',
            legs: [r1, r2],
            transferPoints: [meet.point],
            transfers: 1,
            totalDist: dir1.dist + meet.dist + dir2.dist,
            firstTransferDistToA: distAtoMeet1
          });
        }
      }
    }

    // ─── 2 TRANSBORDOS (3 rutas) ───
    if (maxTransfers >= 2) {
      for (const r1 of startRoutes) {
        const dir1 = routeTowardsPoint(r1, A, B);
        if (!dir1) continue;

        const candidateIds = new Set();
        const segs1 = getRouteSegments(r1);
        for (const s of segs1) {
          const nearby = routesNear(s.a[0], s.a[1], TRANSFER_TOLERANCE_M + 100);
          nearby.forEach(r => { if (r.id !== r1.id) candidateIds.add(r.id); });
        }

        for (const r2id of candidateIds) {
          const r2 = state.routes.find(x => x.id === r2id);
          if (!r2) continue;
          if (r2.id === r1.id) continue;

          const meet1 = findMeetingPoint(r1, r2, B);
          if (!meet1) continue;

          const dir2 = routeTowardsPoint(r2, meet1.point, B);
          if (!dir2) continue;

          for (const r3 of endRoutes) {
            if (r3.id === r1.id || r3.id === r2.id) continue;

            const meet2 = findMeetingPoint(r2, r3, B);
            if (!meet2) continue;

            const dir3 = routeTowardsPoint(r3, meet2.point, B);
            if (!dir3) continue;

            const distAtoMeet1 = haversine(A[0], A[1], meet1.point[0], meet1.point[1]);

            chains.push({
              type: 'transfer',
              legs: [r1, r2, r3],
              transferPoints: [meet1.point, meet2.point],
              transfers: 2,
              totalDist: dir1.dist + meet1.dist + dir2.dist + meet2.dist + dir3.dist,
              firstTransferDistToA: distAtoMeet1
            });
          }
        }
      }
    }

    // Deduplicar
    const seen = new Set();
    const unique = chains.filter(c => {
      const key = c.legs.map(l => l.id).join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Ordenar: menos transbordos, luego más cerca a A
    unique.sort((a, b) => {
      if (a.transfers !== b.transfers) return a.transfers - b.transfers;
      return a.firstTransferDistToA - b.firstTransferDistToA;
    });

    return unique.slice(0, 30);
  }

   
  // ─────── HELPERS DE DIBUJO (reemplazan los del motor viejo) ───────
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

    // Distancia mínima (m) para considerar que la ida está pegada
    const NO_ARROW_IF_CLOSER_THAN_M = 30;
    // Ángulo máximo (grados) entre segmentos para considerarse "recto"
    const MAX_ANGLE_FOR_ARROW_DEG = 15;
    // Cada cuántos METROS meter una flechita en la vuelta
    const ARROW_EVERY_N_METERS = 900;

    routeList.forEach((item, idx) => {
      const route = item.route || item;
      const coordsIda = getRouteCoords(route);
      const coordsVuelta = getRouteCoordsVuelta(route);
      const color = TRIP_COLORS[idx % TRIP_COLORS.length];
      const isHl = highlightIdx === null || highlightIdx === idx;

      // Offsets iguales a los actuales
      let idaDraw = coordsIda;
      let vueltaDraw = coordsVuelta;
      if (idaDraw.length > 1 && total > 1) {
        const offset = (idx - (total - 1) / 2) * 4;
        idaDraw = offsetPolyline(idaDraw, offset);
      }
      if (vueltaDraw.length > 1 && total > 1) {
        const offset = (idx - (total - 1) / 2) * 4;
        vueltaDraw = offsetPolyline(vueltaDraw, -offset);
      }

      // ─────────── IDA ───────────
      if (idaDraw.length > 1) {
        // Grosor ACTUAL de la ida
        const idaWeight = item.type === 'transfer' ? (isHl ? 5 : 3) : (isHl ? 6 : 4);

        const lineIda = L.polyline(idaDraw, {
          color,
          weight: idaWeight,
          opacity: isHl ? 0.95 : 0.5,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(state.tripMap);
        lineIda.bindTooltip(
          (item.label || route.nombre || 'Ruta') + ' · IDA' +
          ` <span style="color:${color}">●</span>`,
          { sticky: true }
        );
        tripRouteLayers.push(lineIda);

        // 🟢 Círculo inicio IDA: mismo grosor que la línea + puntito blanco
        //    - Anillo del color de la ruta, con radio = idaWeight/2 aprox.
        //    - Puntito blanco al centro.
        const idaStartRing = L.circleMarker(idaDraw[0], {
          radius: idaWeight / 2 + 1,   // mismo ancho visual que la línea
          color: color,                // borde del color de la ruta
          weight: 0,                   // sin borde extra
          fillColor: color,
          fillOpacity: 1
        }).addTo(state.tripMap);
        tripRouteLayers.push(idaStartRing);

        const idaStartDot = L.circleMarker(idaDraw[0], {
          radius: Math.max(2, idaWeight / 4),
          color: '#ffffff',
          weight: 0,
          fillColor: '#ffffff',
          fillOpacity: 1
        }).addTo(state.tripMap);
        idaStartDot.bindTooltip('🟢 Inicio de ida', { sticky: true });
        tripRouteLayers.push(idaStartDot);
      }

      // ─────────── VUELTA (línea delgada + flechitas) ───────────
      if (vueltaDraw.length > 1) {
        // Grosor de la vuelta: DELGADITO
        const vueltaWeight = isHl ? 2.5 : 1.8;

        // 1️⃣ Línea base delgada (opaca, no punteada)
        const lineVuelta = L.polyline(vueltaDraw, {
          color,
          weight: vueltaWeight,
          opacity: isHl ? 0.85 : 0.5,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(state.tripMap);
        lineVuelta.bindTooltip(
          (item.label || route.nombre || 'Ruta') + ' · REGRESO' +
          ` <span style="color:${color}">●</span>`,
          { sticky: true }
        );
        tripRouteLayers.push(lineVuelta);

        // 2️⃣ Flechitas chiquitas tipo Google Maps, sobre el trazo
        //    Se colocan cada ARROW_EVERY_N_METERS metros recorridos,
        //    ignorando curvas, esquinas y tramos pegados a la ida.
        let metrosAcumulados = 0;
        let proximaFlechaEn = ARROW_EVERY_N_METERS; // la 1ª flecha a los 100 m

        for (let i = 1; i < vueltaDraw.length - 1; i++) {
          const pPrev = vueltaDraw[i - 1];
          const p     = vueltaDraw[i];
          const pNext = vueltaDraw[i + 1] || p;

          // 🔵 Sumar los metros del segmento pPrev → p
          const metrosSeg = haversine(pPrev[0], pPrev[1], p[0], p[1]);
          metrosAcumulados += metrosSeg;

          // ¿Ya toca poner flecha?
          if (metrosAcumulados < proximaFlechaEn) continue;
          proximaFlechaEn += ARROW_EVERY_N_METERS;

          // (a) ¿Es recto? (ángulo entre segmento anterior y siguiente)
          const a1 = Math.atan2(p[1] - pPrev[1], p[0] - pPrev[0]);
          const a2 = Math.atan2(pNext[1] - p[1], pNext[0] - p[0]);
          let deltaDeg = Math.abs((a2 - a1) * 180 / Math.PI);
          if (deltaDeg > 180) deltaDeg = 360 - deltaDeg;
          if (deltaDeg > MAX_ANGLE_FOR_ARROW_DEG) continue;

          // (b) ¿Pegada a la ida?
          let minDistToIda = Infinity;
          if (idaDraw.length > 1) {
            const mPerDegLat = 111320;
            const mPerDegLng = 111320 * Math.cos(p[0] * Math.PI / 180);
            const pMeters = [p[0] * mPerDegLat, p[1] * mPerDegLng];
            for (let j = 0; j < idaDraw.length - 1; j++) {
              const segMeters = [
                [idaDraw[j][0] * mPerDegLat,   idaDraw[j][1] * mPerDegLng],
                [idaDraw[j+1][0] * mPerDegLat, idaDraw[j+1][1] * mPerDegLng]
              ];
              const dMeters = pointToSegmentDistance(pMeters, segMeters[0], segMeters[1]);
              if (dMeters < minDistToIda) minDistToIda = dMeters;
              if (minDistToIda < NO_ARROW_IF_CLOSER_THAN_M) break;
            }
          }
          if (minDistToIda < NO_ARROW_IF_CLOSER_THAN_M) continue;

          // (c) Dirección real del trazo
          const segmentAngleDeg = Math.atan2(
            pNext[1] - pPrev[1],   // Δ lng
            pNext[0] - pPrev[0]    // Δ lat
          ) * 180 / Math.PI;

          const angleDeg = segmentAngleDeg - 90;

          // (d) Flechita chevron ">"
          const arrowIcon = L.divIcon({
            className: 'trip-arrow-gmaps',
            html: `
              <svg width="10" height="10" viewBox="0 0 10 10"
                   style="transform: rotate(${angleDeg}deg);
                          transform-origin: 50% 50%;
                          display: block;
                          overflow: visible;">
                <polyline points="2,1 8,5 2,9"
                          fill="none"
                          stroke="${color}"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"/>
              </svg>
            `,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          });

          const arrowMarker = L.marker(p, {
            icon: arrowIcon,
            interactive: false,
            keyboard: false,
            zIndexOffset: 30
          }).addTo(state.tripMap);
          tripRouteLayers.push(arrowMarker);
        }
      }

      // ─────────── Punto de TRANSBORDO ───────────
      if (item.transferPoint) {
        const tp = L.circleMarker(item.transferPoint, {
          radius: 9, color: '#fff', fillColor: color, fillOpacity: 1, weight: 3
        }).addTo(state.tripMap).bindPopup('🔄 Transbordo: ' + (item.label || ''));
        tripRouteLayers.push(tp);
      }
    });
  }
   
  // (routeDistanceToPoint y getRouteAllSegments ya existen más arriba;
  //  los dejamos tal cual para no romper performTripSearch.)

     function performTripSearch() {
    const el = $('#tripResults');
    if (!el) return;
    clearTripRouteLayers();
    if (state.tripPoints.length < 1) { el.innerHTML = ''; return; }

    // 🚀 Asegurar geometrías antes de calcular (async, no bloquea)
    ensureAllGeos().then(() => performTripSearchCore(el));
  }

  async function ensureAllGeos() {
    if (!state.online) return;
    if (!state.tripPoints.length) return;

    // Calcular bbox de interés (A + B con margen = radio máximo + 2 km)
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    state.tripPoints.forEach(p => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });
    const marginDeg = 0.02; // ~2 km
    minLat -= marginDeg; maxLat += marginDeg;
    minLng -= marginDeg; maxLng += marginDeg;

    // Solo pedir geometrías de rutas cuyos puntos tocan el bbox
    const needs = state.routes.filter(r => {
      if (r.geometriaIda && r.geometriaIda.length) return false;
      const pts = [].concat(r.puntos || [], r.puntosVuelta || []);
      if (!pts.length) return true; // sin puntos → sí cargar (raro)
      return pts.some(pt =>
        pt[0] >= minLat && pt[0] <= maxLat && pt[1] >= minLng && pt[1] <= maxLng
      );
    });

    if (!needs.length) return;
    await Promise.all(needs.slice(0, 60).map(r =>   // tope duro: 60 por búsqueda
      loadRouteGeo(r.id).then(geo => { if (geo) Object.assign(r, geo); })
    ));
  }

   
  function performTripSearchCore(el) {
    if (!el) return;
    clearTripRouteLayers();
    if (state.tripPoints.length < 1) { el.innerHTML = ''; return; }

    const maxTransfers = Math.min(MAX_TRANSFERS_HARD, +($('#tripMaxTransfers')?.value || 2));
     
     
     const results = { direct: [], transfers: [] };

    if (state.tripPoints.length === 1) {
      // Rutas que tocan el punto A
      const p = state.tripPoints[0];
      const nearRoutes = routesNear(p.lat, p.lng, p.radius);
      nearRoutes.forEach(r => {
        const d = routeDistanceToPoint(r, p.lat, p.lng);
        if (d <= p.radius) results.direct.push({ route: r, dist: d, type: 'direct' });
      });
      // Ordenar por distancia al punto A
      results.direct.sort((a, b) => a.dist - b.dist);
    } else {
      const start = state.tripPoints[0];
      const end   = state.tripPoints[state.tripPoints.length - 1];

      // ─── 1) RUTAS DIRECTAS: una sola ruta que toca TODOS los puntos ───
      state.routes.forEach(r => {
        const touchesAll = state.tripPoints.every(p => routeNearPoint(r, p, p.radius));
        if (touchesAll) {
          results.direct.push({ route: r, type: 'direct', label: r.nombre });
        }
      });

      // ─── 2) TRANSBORDOS INTELIGENTES ───
      // Solo si el usuario quiere (maxTransfers >= 1) o si no hay directas
      if (!results.direct.length || maxTransfers >= 1) {
        if (state.tripPoints.length === 2) {
          // Motor v2: devuelve cadenas ya ordenadas por transbordos y cercanía a A
          const chains = findTransferChains(start, end, maxTransfers);
          results.transfers = chains.slice(0, 20);
        } else {
          // 3+ puntos: encadenar transbordos entre pares consecutivos
          const pairs = [];
          for (let i = 0; i < state.tripPoints.length - 1; i++) {
            const a = state.tripPoints[i];
            const b = state.tripPoints[i + 1];
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
              type: 'transfer',
              legs: allLegs,
              transferPoints: allTransferPts,
              totalDist: pairs.reduce((s, p) => s + p.totalDist, 0),
              transfers: allLegs.length - 1,
              firstTransferDistToA: pairs[0]?.firstTransferDistToA || 0
            });
          }
        }
      }
    }

    // ─── DIBUJO EN MAPA ───
    if (results.direct.length) {
      drawTripRoutesOnMap(
        results.direct.map(d => ({
          route: d.route,
          label: d.route.nombre,
          type: 'direct'
        })),
        null
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

    // ─── RENDER HTML ───
    let html = '';

    if (results.direct.length) {
      html += `<div class="section-title">✅ RESULTADOS: RUTAS DIRECTAS (${results.direct.length})</div>`;
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
              <div class="rc-sub">${esc(r.route.categoria || 'urbana')} · ${formatTripDistance(state.tripPoints)}</div>
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
      html += `<div class="section-title">🔄 Transbordos inteligentes (${results.transfers.length})</div>`;
      html += results.transfers.map((t, idx) => {
        const colorOffset = results.direct.length;
        const color = TRIP_COLORS[(colorOffset + idx) % TRIP_COLORS.length];

        const chipsHtml = t.legs.map((leg, li) => {
          const legColor = li === 0 ? '#00e5ff' : '#a855f7';
          return `
            <button class="trip-chain-item" type="button" data-trip-focus="${esc(leg.id)}" title="Abrir ruta ${esc(leg.nombre)}">
              <div class="trip-chain-chip" style="background:${legColor};border-color:${legColor};color:#ffffff">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="13" rx="2"/>
                  <line x1="3" y1="11" x2="21" y2="11"/>
                  <circle cx="7.5" cy="18.5" r="1.6"/>
                  <circle cx="16.5" cy="18.5" r="1.6"/>
                  <path d="M7 8h3"/>
                  <path d="M14 8h3"/>
                </svg>
              </div>
              <span class="trip-chain-name">${esc(leg.nombre)}</span>
            </button>`;
        }).join('<span class="trip-chain-sep">›</span>');

        return `
        <div class="result-card transbordo" data-result-idx="${idx}" data-result-type="transfer">
          <div class="rc-head">
            <div style="flex:1">
              <div class="trip-chain">${chipsHtml}</div>
              <div class="rc-sub">${t.transfers} transbordo(s) · Transbordo a ${Math.round(t.firstTransferDistToA)} m de A · ${formatTripDistance(state.tripPoints)}</div>
            </div>
            <span class="badge badge-amber">${t.transfers}T</span>
          </div>
          <div class="trip-result-actions">
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

    // ─── EVENTOS ───
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
        const mapWrap = document.querySelector('#page-trip .map-wrap');
        if (mapWrap) {
          const headerH = 58;
          const rect = mapWrap.getBoundingClientRect();
          const targetY = window.scrollY + rect.top - headerH - 8;
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
        toast('Mostrando trazo de: ' + r.route.nombre);
      };
    });

    el.querySelectorAll('[data-trip-open-direct]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const r = state.routes.find(x => x.id === b.dataset.tripOpenDirect);
        if (r) openRouteDetail(r);
      };
    });

    el.querySelectorAll('[data-trip-show]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const idx = +b.dataset.tripShow;
        const t = results.transfers[idx];
        if (!t) return;
        drawTripRoutesOnMap(t.legs.map((l, li) => ({
          route: l,
          label: l.nombre,
          type: 'transfer',
          transferPoint: li === 0 ? t.transferPoints[0] : (t.transferPoints[li - 1] || null)
        })));
        const allCoords = [];
        t.legs.forEach(l => {
          allCoords.push(...getRouteCoords(l));
          allCoords.push(...getRouteCoordsVuelta(l));
        });
        t.transferPoints.forEach(tp => { if (tp) allCoords.push(tp); });
        if (allCoords.length) {
          try { state.tripMap.fitBounds(L.latLngBounds(allCoords).pad(0.15)); } catch(e){}
        }
        const mapWrap = document.querySelector('#page-trip .map-wrap');
        if (mapWrap) {
          const headerH = 58;
          const rect = mapWrap.getBoundingClientRect();
          const targetY = window.scrollY + rect.top - headerH - 8;
          window.scrollTo({ top: targetY, behavior: 'smooth' });
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
  }
             
 
  $('#tripRadius').oninput = e => {
    state.tripRadius = +e.target.value;
    $('#tripRadiusVal').textContent = e.target.value;
  };
  $('#tripMaxTransfers')?.addEventListener('change', () => {
    if (state.tripPoints.length) performTripSearch();
  });
  $('#btnTripSearch').onclick = performTripSearch;

  // 🎯 Botón Regresar en "Buscar viaje en mapa"
  const tripBackBtn = document.getElementById('tripBackBtn');
  if (tripBackBtn) {
    tripBackBtn.onclick = () => {
      if (state.historyStack.length > 1) {
        state.historyStack.pop();
        history.back();
      } else {
        navigateTo('routes');
      }
    };
  }

  // 🎯 Botón Compartir en "Buscar viaje en mapa"
  const tripShareBtn = document.getElementById('tripShareBtn');
  if (tripShareBtn) {
    tripShareBtn.onclick = async () => {
      const url = location.origin + '/?tab=trip';
      const res = await Publisher.share({
        title: 'Buscar viaje en mapa · Rutas BGD',
        text: 'Encuentra rutas cercanas a tu ubicación en el mapa',
        url
      });
      if (res.method === 'clipboard') toast('Enlace copiado ✓');
    };
  }


     // Toolbar trip
  $$('#tripToolbar .tb').forEach(b => {
    b.onclick = () => {
      const tool = b.dataset.tool;

      // 🛰️ GPS en vivo — toggle independiente
      if (tool === 'locate') {
        toggleLiveGPS(b, toast);
        return;
      }

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
            html: `<div class="marker-${pt.letter.toLowerCase()}" style="background:${pt.color}">
              ${pt.letter}
            </div>`,
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
            $$('#tripToolbar .tb').forEach(x => { if (x.dataset.tool !== 'locate') x.classList.remove('active'); });
            addBtn.classList.add('active');
          }
        }
       
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
          $$('#tripToolbar .tb').forEach(x => { if (x.dataset.tool !== 'locate') x.classList.remove('active'); });
          addBtn.classList.add('active');
        }
      
        return;
      }

      // Cualquier otro botón (addpoint)
      $$('#tripToolbar .tb').forEach(x => {
        if (x.dataset.tool !== 'locate') x.classList.remove('active');
      });
      b.classList.add('active');
      if (tool === 'addpoint') {
        state.userReactivated = true;
      } else {
        state.userReactivated = false;
      }
    };
  });

  // ============================================================
  //  🛰️ GPS EN VIVO — Icono pulsante estilo Google Maps
  // ============================================================

  function buildGpsLiveIcon() {
    return L.divIcon({
      className: 'gps-live-marker',
      html: `
        <div class="gps-live-icon">
          <div class="gps-live-pulse"></div>
          <div class="gps-live-dot"></div>
        </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

   


  function startLiveGPS(btn, toastFn) {
    if (!navigator.geolocation) {
      toastFn('GPS no soportado por el navegador', 'err');
      return;
    }
    if (!state.tripMap) return;

    state.gpsLive.active = true;
    state.gpsLive.firstFix = false;
    state.gpsLive.heading = null;
    state.gpsLive.lastLatLng = null;
    state.gpsLive.autoFollow = true;
    state.gpsLive.__prevPan = null;
    if (btn) btn.classList.add('active');

    state.gpsLive.watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const latlng = [lat, lng];

        // Círculo de precisión
        if (!state.gpsLive.accuracyCircle) {
          state.gpsLive.accuracyCircle = L.circle(latlng, {
            radius: accuracy || 20,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            weight: 1,
            opacity: 0.45,
            interactive: false
          }).addTo(state.tripMap);
        } else {
          state.gpsLive.accuracyCircle.setLatLng(latlng);
          state.gpsLive.accuracyCircle.setRadius(accuracy || 20);
        }

        // Marker
        if (!state.gpsLive.marker) {
          state.gpsLive.marker = L.marker(latlng, {
            icon: buildGpsLiveIcon(),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1000
          }).addTo(state.tripMap);
          // Desactivar auto-follow si el usuario arrastra
          state.tripMap.once('dragstart', () => {
            if (state.gpsLive.active) {
              state.gpsLive.autoFollow = false;
            }
          });
        } else {
          state.gpsLive.marker.setLatLng(latlng);
        }



        // Auto-follow
        if (state.gpsLive.autoFollow) {
          if (!state.gpsLive.firstFix) {
            state.tripMap.setView(latlng, Math.max(state.tripMap.getZoom(), 16), { animate: true });
            state.gpsLive.firstFix = true;
          } else {
            const prev = state.gpsLive.lastLatLng;
            if (prev) {
              const d = haversine(prev[0], prev[1], lat, lng);
              if (d > state.gpsLive.minDistanceToPan) {
                state.tripMap.panTo(latlng, { animate: true, duration: 0.6 });
              }
            } else {
              state.tripMap.panTo(latlng, { animate: true, duration: 0.6 });
            }
          }
        }

        state.gpsLive.lastLatLng = latlng;
      },
      err => {
        let msg = 'Error de GPS';
        if (err.code === 1) msg = 'Permiso de ubicación denegado';
        else if (err.code === 2) msg = 'Ubicación no disponible (revisa tu GPS)';
        else if (err.code === 3) msg = 'Timeout buscando señal GPS';
        toastFn(msg, 'err');
        stopLiveGPS(btn, toastFn, true);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );

    toastFn('GPS activado · Mostrando tu ubicación en vivo');
  }

  function stopLiveGPS(btn, toastFn, silencioso) {
    if (state.gpsLive.watchId != null) {
      try { navigator.geolocation.clearWatch(state.gpsLive.watchId); } catch (e) {}
    }
    if (state.gpsLive.marker && state.tripMap) {
      try { state.tripMap.removeLayer(state.gpsLive.marker); } catch (e) {}
    }
    if (state.gpsLive.accuracyCircle && state.tripMap) {
      try { state.tripMap.removeLayer(state.gpsLive.accuracyCircle); } catch (e) {}
    }
    state.gpsLive.watchId = null;
    state.gpsLive.marker = null;
    state.gpsLive.accuracyCircle = null;
    state.gpsLive.firstFix = false;
    state.gpsLive.heading = null;
    state.gpsLive.lastLatLng = null;
    state.gpsLive.autoFollow = true;
    state.gpsLive.active = false;
    if (btn) btn.classList.remove('active');
    if (!silencioso) toastFn('GPS desactivado');
  }

  function toggleLiveGPS(btn, toastFn) {
    if (state.gpsLive.active) {
      stopLiveGPS(btn, toastFn);
    } else {
      startLiveGPS(btn, toastFn);
    }
  }

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
 //  Cargar las 3 en paralelo (mucho más rápido)
await Promise.all([
  loadPosts(),
  loadRoutes(),
  loadMarket()
]);

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
    // Estado de conexión (ya llama syncFromFirebase internamente si está online)
    updateConn();
  }

  function renderSinglePost(post) {
    const el = $('#postSingle');
    if (!el) return;
    el.innerHTML = renderPostCard(post);
    bindPostEvents(el);
  }

  $('#postBack').onclick = () => {
    if (state.historyStack.length > 1) {
      state.historyStack.pop();
      history.back();
    } else {
      navigateTo('home');
    }
  };
   
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

      async migrateToSplit() {
      if (!state.isAdmin) { toast('Necesitas ser admin primero', 'err'); return; }
      if (!state.online || !fbDB) { toast('Sin conexión', 'err'); return; }
      if (!confirm('¿Migrar todas las rutas a la nueva estructura (índice + geometría separados)?')) return;

      const snap = await fbDB.ref('rutas_colectivos_tgz').once('value');
      const val = snap.val() || {};
      const entries = Object.entries(val);
      if (!entries.length) { toast('No hay rutas para migrar'); return; }

      let done = 0;
      toast(`Migrando ${entries.length} rutas…`);
      for (const [id, r] of entries) {
        if (!r || !r.id) continue;
        const idx = { ...r };
        delete idx.geometriaIda;
        delete idx.geometriaVuelta;
        const geo = {
          id,
          geometriaIda: r.geometriaIda || [],
          geometriaVuelta: r.geometriaVuelta || []
        };
        await Promise.all([
          fbDB.ref('rutas_index/' + id).set(idx).catch(() => {}),
          fbDB.ref('rutas_geo/' + id).set(geo).catch(() => {})
        ]);
        done++;
        if (done % 20 === 0) toast(`Migradas ${done}/${entries.length}`);
      }
      toast(`✅ Migración completa: ${done} rutas`, 'ok');
      await loadRoutes();
    },
     
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
