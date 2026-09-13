export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const { title, slug, description, image, content, secretPass } = await context.request.json();

    // 1. Verificar contraseña de administrador
    const ADMIN_PASSWORD = context.env.ADMIN_PASSWORD;
    if (secretPass !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
    const REPO_OWNER = context.env.REPO_OWNER;
    const REPO_NAME = context.env.REPO_NAME;
    const DOMAIN = context.env.SITE_DOMAIN || "tu-pagina.pages.dev";

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    const dateStr = new Date().toISOString().split('T')[0];
    const postPath = `paginas/${cleanSlug}.html`;

    // 2. Generar plantilla HTML individual con SEO
    const postHtmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:type" content="article">
  <link rel="canonical" href="https://${DOMAIN}/paginas/${cleanSlug}">
  <link rel="stylesheet" href="../css/style.css">
  <link rel="manifest" href="../manifest.json">
</head>
<body>
  <header>
    <h1><a href="../">Mi Blog</a></h1>
  </header>
  <main class="post-container">
    <article>
      <h1>${title}</h1>
      <div class="post-meta">Publicado el: <time>${dateStr}</time></div>
      ${image ? `<img src="${image}" alt="${title}" class="post-cover">` : ''}
      <div class="post-body">
        ${content}
      </div>
    </article>
  </main>
  <footer>
    <p><a href="../">← Volver al inicio</a></p>
  </footer>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('../sw.js');
    }
  </script>
</body>
</html>`;

    // Función auxiliar para llamar a la API de GitHub
    const githubApi = async (path, method = 'GET', body = null) => {
      const options = {
        method,
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "User-Agent": "Cloudflare-Pages-Publisher",
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        }
      };
      if (body) options.body = JSON.stringify(body);
      return await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, options);
    };

    // Helper para encode Base64 UTF-8 seguro
    const toBase64 = (str) => {
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };

    // 3. Subir el archivo HTML del Post
    let getPostRes = await githubApi(postPath);
    let postSha = getPostRes.status === 200 ? (await getPostRes.json()).sha : null;

    await githubApi(postPath, 'PUT', {
      message: `Publish post: ${cleanSlug}`,
      content: toBase64(postHtmlContent),
      sha: postSha || undefined
    });

    // 4. Actualizar paginas/posts-index.json
    const indexPath = "paginas/posts-index.json";
    let getIndexRes = await githubApi(indexPath);
    let indexData = [];
    let indexSha = null;

    if (getIndexRes.status === 200) {
      const jsonFile = await getIndexRes.json();
      indexSha = jsonFile.sha;
      const decodedContent = new TextDecoder().decode(Uint8Array.from(atob(jsonFile.content.replace(/\n/g, '')), c => c.charCodeAt(0)));
      indexData = JSON.parse(decodedContent);
    }

    // Filtrar si ya existe y agregar al inicio
    indexData = indexData.filter(p => p.slug !== cleanSlug);
    indexData.unshift({
      title,
      slug: cleanSlug,
      description,
      image,
      date: dateStr,
      url: `paginas/${cleanSlug}`
    });

    await githubApi(indexPath, 'PUT', {
      message: `Update posts index for ${cleanSlug}`,
      content: toBase64(JSON.stringify(indexData, null, 2)),
      sha: indexSha || undefined
    });

    return new Response(JSON.stringify({ success: true, url: `/paginas/${cleanSlug}` }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
  });
}
