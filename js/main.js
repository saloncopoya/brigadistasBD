// js/main.js
// Lee el índice de posts y muestra la portada del blog

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  async function loadPosts() {
    const grid = $('#blog-grid');
    if (!grid) return;

    grid.innerHTML =
      '<div class="loading"><div class="spinner"></div><span>Cargando rutas...</span></div>';

    try {
      // Intentar API primero, luego JSON estático
      let posts = [];
      try {
        const res = await fetch('/api/posts');
        if (res.ok) {
          const data = await res.json();
          posts = data.posts || [];
        }
      } catch (e) {}

      if (!posts.length) {
        try {
          const res = await fetch('/paginas/posts-index.json');
          if (res.ok) {
            const data = await res.json();
            posts = data.posts || [];
          }
        } catch (e) {}
      }

      if (!posts.length) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
            </svg>
            <p>Aún no hay rutas publicadas</p>
            <p style="font-size:13px;margin-top:8px">Agrega rutas desde la app y publícalas</p>
          </div>`;
        return;
      }

      grid.innerHTML = posts
        .map((post) => {
          const img = post.image
            ? `<img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" loading="lazy">`
            : '🚌';

          return `
          <a class="blog-card" href="/${escapeHtml(post.url)}">
            <div class="blog-card-img">${img}</div>
            <div class="blog-card-body">
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.description || 'Ruta de transporte en Tuxtla Gutiérrez')}</p>
              <div class="blog-card-meta">
                <span>🚌 ${escapeHtml(post.tipo || 'ida')}</span>
                <span>📍 ${post.calles || 0} calles</span>
                ${post.tarifa ? `<span>💰 ${escapeHtml(post.tarifa)}</span>` : ''}
              </div>
            </div>
          </a>`;
        })
        .join('');
    } catch (e) {
      console.error(e);
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Error cargando rutas</p></div>`;
    }
  }

  // Filtro de búsqueda en portada
  function setupFilter() {
    const input = $('#blog-filter');
    if (!input) return;

    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('.blog-card').forEach((card) => {
        const text = card.textContent.toLowerCase();
        card.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPosts();
    setupFilter();
  });
})();
