/* ============================================================
   MAIN.JS - Blog portada (versión mínima, no toca la app)
   ============================================================ */

(function () {
  'use strict';

  // Este archivo solo actúa si estamos en la portada del blog
  // (no interfiere con la app principal)

  function init() {
    // Si existe el grid del blog fuera de la app, cargar posts
    var blogGrid = document.getElementById('blog-grid-standalone');
    if (blogGrid && typeof loadBlogStandalone === 'function') {
      loadBlogStandalone();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
