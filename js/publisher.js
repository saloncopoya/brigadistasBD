document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("publishForm");
  const statusMsg = document.getElementById("statusMessage");
  const submitBtn = document.getElementById("submitBtn");

  const setStatus = (text, type) => {
    statusMsg.hidden = false;
    statusMsg.className = "status " + (type || "");
    statusMsg.innerHTML = text;
  };

  document.getElementById("title").addEventListener("input", (e) => {
    document.getElementById("slug").value = e.target.value
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    setStatus("Publicando… guardando en GitHub y actualizando Cloudflare.", "info");

    const payload = {
      secretPass: document.getElementById("secretPass").value,
      title: document.getElementById("title").value,
      slug: document.getElementById("slug").value,
      description: document.getElementById("description").value,
      image: document.getElementById("image").value,
      content: document.getElementById("content").value,
    };

    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await response.json().catch(() => ({}));

      if (response.ok && resData.success) {
        setStatus(
          `¡Post publicado exitosamente! <a href="${resData.url}" target="_blank" rel="noopener">Ver publicación</a>`,
          "success"
        );
        form.reset();
      } else {
        throw new Error(resData.error || "Error al publicar");
      }
    } catch (err) {
      setStatus("Error: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
});
