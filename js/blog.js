/* ==========================================================================
   BLOG.JS — Mejoras para páginas individuales de posts (compartir, lazy)
   ========================================================================== */
(function (global) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // Botón compartir si existe
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const res = await Publisher.share({
          title: document.title,
          text: (document.querySelector('meta[name="description"]') || {}).content || '',
          url: location.href
        });
        if (res.method === 'clipboard') alert('Enlace copiado al portapapeles');
      });
    }

    // Lazy loading para imágenes
    document.querySelectorAll('img[data-src]').forEach(img => {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            io.unobserve(img);
          }
        });
      });
      io.observe(img);
    });
  });

})(window);
