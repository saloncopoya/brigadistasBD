/* ==========================================================================
   POSTS.JS — API de lectura del índice de posts (con CORS)
   ========================================================================== */

export async function onRequest(context) {
  const { env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=300, s-maxage=600'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  const {
    GITHUB_TOKEN, REPO_OWNER, REPO_NAME
  } = env;

  if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    return new Response(JSON.stringify({ posts: [], total: 0, error: 'Sin config' }), { headers });
  }

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/share/posts-index.json?ref=main`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'brigadistasbd-posts',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ posts: [], total: 0 }), { headers });
    }

    const json = await res.json();
    const decoded = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
    const data = JSON.parse(decoded);

    return new Response(JSON.stringify(data), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ posts: [], total: 0, error: err.message }), { headers });
  }
}
