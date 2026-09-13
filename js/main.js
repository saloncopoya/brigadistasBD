// js/main.js — Carga el índice de posts desde /api/posts y renderiza en la portada del blog
// Se usa si quieres una portada distinta a la PWA. En este proyecto la portada
// es la PWA (index.html), así que este script queda como utilidad opcional.

(async function loadPostsIndex() {
  try {
    const res = await fetch('/share/posts-index.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    const posts = data.posts || [];
    const container = document.getElementById('blogIndex');
    if (!container) return; // solo se usa en páginas de blog estático
    container.innerHTML = posts.map(p => `
      <article class="blog-card">
        <a href="${p.url}">
          ${p.image ? `<img src="${p.image}" alt="${p.title}" loading="lazy"/>` : ''}
          <h3>${p.title}</h3>
          <p>${p.description || ''}</p>
        </a>
      </article>`).join('');
  } catch (e) {
    console.warn('main.js blog index:', e);
  }
})();
