// js/publisher.js — Subida a Cloudinary y publicación vía Cloudflare Function
const CLOUD_NAME = 'davovja1g';
const UPLOAD_PRESET = 'sinfirmaupload';

/**
 * Sube un archivo (imagen o video) a Cloudinary sin firma.
 * @returns {Promise<string>} URL segura del recurso
 */
export async function uploadToCloudinary(file, onProgress) {
  if (!file) throw new Error('No file');
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (j.secure_url) resolve(j.secure_url);
        else reject(new Error(j.error?.message || 'Upload failed'));
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

/**
 * Publica (crea o actualiza) un recurso: post, ruta o market.
 * Llama a /api/publish que sube el HTML SEO a GitHub.
 * @param {'p'|'r'|'m'} type - p=post, r=ruta, m=market
 * @param {object} data - { id, title, description, content, image, extra }
 * @param {string} password - ADMIN_PASSWORD
 */
export async function publishResource(type, data, password) {
  const payload = {
    type,
    slug: data.id,
    title: data.title,
    description: data.description || '',
    content: data.content || '',
    image: data.image || '',
    extra: data.extra || {},
    password
  };
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || 'Error publicando');
  return json; // { ok, url, canonical }
}

/**
 * Elimina un recurso del repo (borra HTML, actualiza index y sitemap).
 */
export async function unpublishResource(type, slug, password) {
  const res = await fetch('/api/publish', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, slug, password })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || 'Error eliminando');
  return json;
}
