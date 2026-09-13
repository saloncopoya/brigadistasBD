// js/publisher.js
// Conecta el formulario admin con /api/publish

(function () {
  'use strict';

  const API_URL = '/api/publish';

  const $ = (s) => document.querySelector(s);

  // Genera slug a partir del título
  function slugify(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);
  }

  window.Publisher = {
    slugify,

    async publish(formData) {
      const btn = $('#btn-publish');
      const originalText = btn ? btn.textContent : '';

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Publicando...';
      }

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Error ${res.status}`);
        }

        return data;
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
    },

    async uploadImage(file) {
      // Sube imagen a Cloudinary (o devuelve base64 si falla)
      const CLOUD_NAME = 'dxjgyqcby';
      const UPLOAD_PRESET = 'sinfirmaupload';

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', UPLOAD_PRESET);

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
          { method: 'POST', body: fd }
        );

        if (!res.ok) throw new Error('upload');

        const data = await res.json();
        return data.secure_url;
      } catch (e) {
        // Fallback: base64
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsDataURL(file);
        });
      }
    },
  };
})();
