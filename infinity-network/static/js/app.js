(function () {
  "use strict";

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  window.InfinityUI = {
    toast(title, detail, variant) {
      const container = document.getElementById("toastContainer");
      if (!container) return;
      const el = document.createElement("div");
      el.className = "toast show border-0 mb-2";
      el.style.backgroundColor = "#111827";
      el.style.border = "1px solid rgba(148,163,184,0.25)";
      el.style.color = "#F8FAFC";

      const body = document.createElement("div");
      body.className = "toast-body d-flex align-items-start justify-content-between gap-2";

      const textWrap = document.createElement("div");
      const strong = document.createElement("div");
      strong.className = "fw-semibold small";
      if (variant === "error") strong.classList.add("text-danger");
      else if (variant === "success") strong.classList.add("text-success");
      else strong.classList.add("text-info");
      strong.textContent = title;
      textWrap.appendChild(strong);

      if (detail) {
        const sub = document.createElement("div");
        sub.className = "small text-muted-custom mt-1";
        sub.textContent = detail;
        textWrap.appendChild(sub);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "btn-close btn-close-white btn-sm";
      closeBtn.addEventListener("click", () => el.remove());

      body.appendChild(textWrap);
      body.appendChild(closeBtn);
      el.appendChild(body);
      container.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    },

    async apiFetch(url, options) {
      const opts = options || {};
      const method = (opts.method || "GET").toUpperCase();
      const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (csrfToken && method !== "GET" && method !== "HEAD") {
        headers["X-CSRF-Token"] = csrfToken;
      }
      const start = performance.now();
      const res = await fetch(url, {
        method,
        headers,
        credentials: "same-origin",
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = { ok: false };
      }
      return { ok: res.ok, status: res.status, latencyMs, data };
    },

    formatUptime(seconds) {
      const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      return `${h}:${m}:${s}`;
    },
  };

  // Mobile sidebar toggle
  const openBtn = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("appSidebar");
  if (openBtn && sidebar) {
    openBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
  }
})();
