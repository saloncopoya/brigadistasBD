document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("postsList");
  const banner = document.getElementById("offlineBanner");

  const updateOnline = () => {
    banner.hidden = navigator.onLine;
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();

  async function render(posts) {
    if (!posts.length) {
      container.innerHTML =
        '<p class="muted">Aún no hay publicaciones. Crea la primera desde el <a href="admin.html">panel admin</a>.</p>';
      return;
    }
    container.innerHTML = posts
      .map(
        (post) => `
      <article class="card">
        ${post.image ? `<img src="${post.image}" alt="${post.title}" loading="lazy">` : ""}
        <div class="card-content">
          <h3><a href="/${post.url}">${post.title}</a></h3>
          <small class="muted">${post.date || ""}</small>
          <p>${post.description || ""}</p>
          <a href="/${post.url}" class="read-more">Leer artículo →</a>
        </div>
      </article>`
      )
      .join("");
  }

  // 1) Render desde IndexedDB al instante (offline-first)
  try {
    const local = await BlogCache.getLocalPosts();
    if (local.length) await render(local);
  } catch {}

  // 2) Intenta actualizar desde la red
  try {
    const res = await fetch("paginas/posts-index.json?t=" + Date.now(), {
      cache: "no-store",
    });
    if (res.ok) {
      const posts = await res.json();
      await BlogCache.cachePostsIndex(posts);
      await render(posts);
      // Precarga en background
      BlogCache.precacheAllPosts(posts);
    }
  } catch (e) {
    // Offline: ya mostramos lo local arriba
    const local = await BlogCache.getLocalPosts();
    await render(local);
  }
});
