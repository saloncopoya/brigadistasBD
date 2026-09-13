export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const allowed = context.env.SITE_DOMAIN
    ? `https://${context.env.SITE_DOMAIN}`
    : "*";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };

  try {
    const { title, slug, description, image, content, secretPass } =
      await context.request.json();

    const ADMIN_PASSWORD = context.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD || secretPass !== ADMIN_PASSWORD) {
      return json({ error: "Contraseña incorrecta" }, 403, corsHeaders);
    }

    if (!title || !slug || !content) {
      return json({ error: "Faltan campos obligatorios" }, 400, corsHeaders);
    }

    const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
    const REPO_OWNER = context.env.REPO_OWNER;
    const REPO_NAME = context.env.REPO_NAME;
    const DOMAIN = context.env.SITE_DOMAIN || "tu-pagina.pages.dev";

    const cleanSlug = slug
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const dateStr = new Date().toISOString().split("T")[0];
    const postPath = `paginas/${cleanSlug}.html`;
    const url = `paginas/${cleanSlug}.html`;

    const escapeHtml = (s = "") =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const postHtmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description || "")}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description || "")}">
  <meta property="og:image" content="${escapeHtml(image || "")}">
  <meta property="og:type" content="article">
  <link rel="canonical" href="https://${DOMAIN}/${url}">
  <link rel="stylesheet" href="../css/style.css">
  <link rel="manifest" href="../manifest.json">
  <meta name="theme-color" content="#0f172a">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="../" class="logo">📝 Mi Blog</a>
      <nav><a href="../">Inicio</a></nav>
    </div>
  </header>
  <main class="container post-container">
    <article class="post">
      <h1>${escapeHtml(title)}</h1>
      <div class="post-meta">
        <time datetime="${dateStr}">${dateStr}</time>
      </div>
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" class="post-cover" loading="lazy">` : ""}
      <div class="post-body">
        ${content}
      </div>
    </article>
    <a href="../" class="back-link">← Volver al inicio</a>
  </main>
  <script src="../js/db.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('../sw.js', { scope: '../' });
    }
  </script>
</body>
</html>`;

    const githubApi = async (path, method = "GET", body = null) => {
      const options = {
        method,
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "User-Agent": "Cloudflare-Pages-Publisher",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
      };
      if (body) options.body = JSON.stringify(body);
      return await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
        options
      );
    };

    const toBase64 = (str) => {
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };

    const fromBase64 = (b64) => {
      const clean = b64.replace(/\n/g, "");
      const bin = atob(clean);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    };

    // 1. Subir HTML del post
    const getPostRes = await githubApi(postPath);
    const postSha = getPostRes.status === 200 ? (await getPostRes.json()).sha : null;

    const putPost = await githubApi(postPath, "PUT", {
      message: `Publish: ${cleanSlug}`,
      content: toBase64(postHtmlContent),
      sha: postSha || undefined,
    });
    if (!putPost.ok) {
      const e = await putPost.json();
      throw new Error(`GitHub post: ${e.message}`);
    }

    // 2. Actualizar posts-index.json
    const indexPath = "paginas/posts-index.json";
    const getIndexRes = await githubApi(indexPath);
    let indexData = [];
    let indexSha = null;

    if (getIndexRes.status === 200) {
      const jsonFile = await getIndexRes.json();
      indexSha = jsonFile.sha;
      try {
        indexData = JSON.parse(fromBase64(jsonFile.content));
      } catch {
        indexData = [];
      }
    }

    indexData = indexData.filter((p) => p.slug !== cleanSlug);
    indexData.unshift({
      title,
      slug: cleanSlug,
      description: description || "",
      image: image || "",
      date: dateStr,
      url,
      content, // guardamos el HTML del cuerpo para cachear offline
    });

    const putIndex = await githubApi(indexPath, "PUT", {
      message: `Update index: ${cleanSlug}`,
      content: toBase64(JSON.stringify(indexData, null, 2)),
      sha: indexSha || undefined,
    });
    if (!putIndex.ok) {
      const e = await putIndex.json();
      throw new Error(`GitHub index: ${e.message}`);
    }

    // 3. Actualizar sitemap.xml
    const sitemapPath = "sitemap.xml";
    const getSitemapRes = await githubApi(sitemapPath);
    let sitemapSha = null;
    let urls = [`https://${DOMAIN}/`];

    if (getSitemapRes.status === 200) {
      const smFile = await getSitemapRes.json();
      sitemapSha = smFile.sha;
      const smContent = fromBase64(smFile.content);
      const matches = smContent.match(/<loc>(.*?)<\/loc>/g) || [];
      urls = matches.map((m) => m.replace(/<\/?loc>/g, ""));
    }

    const newUrl = `https://${DOMAIN}/${url}`;
    urls = urls.filter((u) => u !== newUrl);
    urls.unshift(newUrl);

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${dateStr}</lastmod></url>`).join("\n")}
</urlset>`;

    await githubApi(sitemapPath, "PUT", {
      message: `Update sitemap: ${cleanSlug}`,
      content: toBase64(sitemapXml),
      sha: sitemapSha || undefined,
    });

    return json({ success: true, url: `/${url}` }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}

export async function onRequestOptions(context) {
  const allowed = context.env?.SITE_DOMAIN
    ? `https://${context.env.SITE_DOMAIN}`
    : "*";
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    },
  });
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
