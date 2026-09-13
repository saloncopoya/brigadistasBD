// js/blog.js — Se incluye en cada página /share/p/*.html generada por /api/publish
// Añade botón compartir, lazy loading y ajustes interactivos.

(function enhanceBlog() {
  // Botón compartir flotante
  const btn = document.createElement('button');
  btn.textContent = '🔗 Compartir';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999;padding:12px 18px;border-radius:24px;background:#00e5ff;color:#001820;font-weight:800;border:none;box-shadow:0 4px 16px rgba(0,229,255,.4);cursor:pointer';
  btn.addEventListener('click', async () => {
    const url = location.href;
    const title = document.title;
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch(_){} }
    window.open(`https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`, '_blank');
  });
  document.body.appendChild(btn);

  // Lazy loading por atributo
  document.querySelectorAll('img:not([loading])').forEach(img => img.loading = 'lazy');
})();
