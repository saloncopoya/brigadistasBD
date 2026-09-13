// functions/api/posts.js — Devuelve el índice de posts desde GitHub
const GH_API = 'https://api.github.com';

export async function onRequest({ env }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const url = `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/share/posts-index.json`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'brigadistas-bd'
      }
    });
    if (!res.ok) return new Response(JSON.stringify({ posts: [], total: 0 }), { headers: cors });
    const j = await res.json();
    const txt = decodeURIComponent(escape(atob(j.content)));
    return new Response(txt, { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
