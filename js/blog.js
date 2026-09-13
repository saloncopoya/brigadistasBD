// js/blog.js
// Mejoras para páginas de post individual

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // Compartir en redes
    const shareBtn = document.getElementById('btn-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const data = {
          title: document.title,
          text: document.querySelector('meta[name="description"]')?.content || '',
          url: window.location.href,
        };

        if (navigator.share) {
          try {
            await navigator.share(data);
          } catch (e) {}
        } else {
          await navigator.clipboard.writeText(window.location.href);
          alert('Enlace copiado al portapapeles');
        }
      });
    }

    // Lazy load de imágenes
    document.querySelectorAll('img[data-src]').forEach((img) => {
      img.src = img.dataset.src;
    });
  });
})();
