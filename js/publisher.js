/* ==========================================================================
   PUBLISHER.JS — Cliente para publicar en GitHub vía Cloudflare Function
   y subir archivos a Cloudinary. Con fallback a base64 offline.
   ========================================================================== */
(function (global) {
  'use strict';

  const API_BASE = '/api';
  const CLOUDINARY = {
    cloudName: 'davovja1g',
    uploadPreset: 'sinfirmaupload',
    apiKey: '688569119694815'
  };

  // ---------- Utilidades ----------
  function slugify(text, dia, mes) {
    const base = String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()
      .replace(/\s+/g, '')
      .slice(0, 60);
    if (dia != null && mes != null) return `${base}${dia}${mes}`;
    const d = new Date();
    return `${base}${d.getDate()}${d.getMonth() + 1}`;
  }

  // ---------- Subida a Cloudinary ----------
  async function uploadToCloudinary(file, onProgress) {
    if (!file) throw new Error('No hay archivo');
    if (!navigator.onLine) throw new Error('Sin conexión. Guardado como base64.');

    const isVideo = file.type.startsWith('video/');
    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${isVideo ? 'video' : 'image'}/upload`;

    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', CLOUDINARY.uploadPreset);
    form.append('api_key', CLOUDINARY.apiKey);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.secure_url) {
            resolve(res.secure_url);
          } else {
            reject(new Error(res.error?.message || 'Error de Cloudinary'));
          }
        } catch (e) { reject(new Error('Respuesta inválida de Cloudinary')); }
      };
      xhr.onerror = () => reject(new Error('Error de red al subir'));
      xhr.send(form);
    });
  }

  // Fallback: convertir archivo a base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- Publicar en GitHub vía API ----------
  async function publish(payload) {
    // payload: { tipo, slug, title, content, image, password, extra }
    try {
      const res = await fetch(`${API_BASE}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      // Cachear el índice localmente
      if (data.index) {
        try { await DB.setMeta('posts_index', data.index); } catch (e) {}
      }
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message || 'Error de red' };
    }
  }

  // ---------- Leer índice de posts ----------
  async function fetchIndex() {
    try {
      // Intentar red primero
      if (navigator.onLine) {
        const res = await fetch(`${API_BASE}/posts`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          try { await DB.setMeta('posts_index', data); } catch (e) {}
          return data;
        }
      }
    } catch (e) { /* fallback local */ }
    // Fallback: IndexedDB
    try {
      const cached = await DB.getMeta('posts_index');
      if (cached) return cached;
    } catch (e) {}
    return { posts: [], total: 0, updatedAt: null };
  }

  // ---------- Compartir ----------
  async function share({ title, text, url }) {
    url = url || location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return { ok: true, method: 'native' };
      } catch (e) {
        if (e.name === 'AbortError') return { ok: false, method: 'cancelled' };
      }
    }
    // Fallback: copiar al portapapeles
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, method: 'clipboard' };
    } catch (e) {
      return { ok: false, method: 'failed' };
    }
  }

  function shareWhatsApp(url, text) {
    const u = `https://wa.me/?text=${encodeURIComponent((text || '') + ' ' + url)}`;
    window.open(u, '_blank', 'noopener');
  }

  function shareFacebook(url) {
    const u = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(u, '_blank', 'noopener');
  }

  // ---------- API pública ----------
  global.Publisher = {
    slugify,
    uploadToCloudinary,
    fileToBase64,
    publish,
    fetchIndex,
    share,
    shareWhatsApp,
    shareFacebook,
    CLOUDINARY
  };

})(window);
