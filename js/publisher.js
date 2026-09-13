document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('publishForm');
  const statusMsg = document.getElementById('statusMessage');
  const submitBtn = document.getElementById('submitBtn');

  // Generar Slug automáticamente al escribir el título
  document.getElementById('title').addEventListener('input', (e) => {
    const slugInput = document.getElementById('slug');
    slugInput.value = e.target.value
      .toLowerCase()
      .trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    statusMsg.className = '';
    statusMsg.innerText = 'Publicando... Guardando en GitHub y actualizando Cloudflare...';

    const payload = {
      secretPass: document.getElementById('secretPass').value,
      title: document.getElementById('title').value,
      slug: document.getElementById('slug').value,
      description: document.getElementById('description').value,
      image: document.getElementById('image').value,
      content: document.getElementById('content').value
    };

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();

      if (response.ok && resData.success) {
        statusMsg.className = 'success';
        statusMsg.innerHTML = `¡Post publicado exitosamente! <br> <a href="${resData.url}" target="_blank">Ver publicación</a>`;
        form.reset();
      } else {
        throw new Error(resData.error || 'Error al publicar');
      }
    } catch (err) {
      statusMsg.className = 'error';
      statusMsg.innerText = 'Error: ' + err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
});
