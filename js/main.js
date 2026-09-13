/* ==========================================================================
   MAIN.JS — Script de portada del blog (opcional, la lógica principal
   vive en app.js). Proporciona utilidades para páginas de índice.
   ========================================================================== */
(function (global) {
  'use strict';

  // Cargar índice de posts y renderizar tarjetas simples
  async function renderBlogIndex(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let posts = [];
    try {
      const data = await Publisher.fetchIndex();
      posts = (data.posts || []).filter(p => p.tipo === 'post' || !p.tipo);
    } catch (e) {
      try { posts = await DB.getAll('posts'); } catch (e2) {}
    }

    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (!posts.length) {
      el.innerHTML = '<div class="empty"><p>Sin publicaciones</p></div>';
      return;
    }

    el.innerHTML = posts.map(p => `
      <a class="post-card" href="/share/post/${p.slug || p.id}.html" style="text-decoration:none;color:inherit">
        ${p.media ? `<img class="post-media" src="${p.media}" alt="${p.title || ''}" loading="lazy">` : ''}
        <div style="padding:14px">
          <h3 style="font-size:15px;font-weight:800;margin-bottom:6px">${p.title || 'Publicación'}</h3>
          <p style="font-size:13px;color:var(--text-2);line-height:1.5">${(p.content || '').slice(0, 120)}</p>
        </div>
      </a>`).join('');
  }

  global.Blog = { renderBlogIndex };

})(window);
