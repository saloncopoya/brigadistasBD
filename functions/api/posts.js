// functions/api/posts.js
// Devuelve el índice de posts (lectura pública)

export async function onRequestGet(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=60',
  };

  try {
    const owner = env.REPO_OWNER;
    const repo = env.REPO_NAME;
    const token = env.GITHUB_TOKEN;

    // Si hay token, leemos desde GitHub (datos frescos)
    if (owner && repo && token) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/paginas/posts-index.json`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'RutasTuxtlaBot',
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const decoded = atob(data.content.replace(/\n/g, ''));
        return new Response(decoded, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fallback: devolver vacío
    return new Response(JSON.stringify({ posts: [], total: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ posts: [], total: 0, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
