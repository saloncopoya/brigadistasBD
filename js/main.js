document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('postsList');

  try {
    const res = await fetch('paginas/posts-index.json?nocache=' + new Date().getTime());
    if (!res.ok) throw new Error("No se pudo cargar el índice de posts.");
    
    const posts = await res.json();
    
    if (posts.length === 0) {
      container.innerHTML = '<p>Aún no hay publicaciones creadas.</p>';
      return;
    }

    container.innerHTML = posts.map(post => `
      <article class="card">
        ${post.image ? `<img src="${post.image}" alt="${post.title}">` : ''}
        <div class="card-content">
          <h3><a href="${post.url}">${post.title}</a></h3>
          <small>${post.date}</small>
          <p>${post.description}</p>
          <a href="${post.url}" class="read-more">Leer artículo →</a>
        </div>
      </article>
    `).join('');

  } catch (err) {
    container.innerHTML = '<p>Bienvenido. Publica tu primer artículo desde el panel <a href="admin.html">Admin</a>.</p>';
  }
});
