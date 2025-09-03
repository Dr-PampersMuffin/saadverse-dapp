import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ---- Simple on-screen error surface ----
function showFatal(msg: string) {
  const bar = document.createElement("div");
  bar.style.position = "fixed";
  bar.style.left = "0";
  bar.style.right = "0";
  bar.style.top = "0";
  bar.style.zIndex = "999999";
  bar.style.padding = "10px 14px";
  bar.style.background = "rgba(200,0,0,0.9)";
  bar.style.color = "#fff";
  bar.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  bar.style.fontSize = "14px";
  bar.style.whiteSpace = "pre-wrap";
  bar.textContent = "Runtime error: " + msg;
  document.body.appendChild(bar);
}

window.addEventListener("error", (e) => {
  if (e?.error?.message) showFatal(e.error.message);
  else showFatal(String(e?.message ?? e));
});
window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  const reason = (e && (e as any).reason) ? (e as any).reason : e;
  showFatal(typeof reason === "object" && reason?.message ? reason.message : String(reason));
});

function boot() {
  try {
    // ---- Background image with BASE_URL-safe path ----
    const bgUrl = new URL("/assets/General backgroud.png", import.meta.env.BASE_URL).toString();

    const html = document.documentElement;
    const body = document.body;

    html.style.background = `url("${bgUrl}") center / cover fixed no-repeat`;
    html.style.backgroundColor = "transparent";
    body.style.background = "transparent";

    // soft dark overlay for readability
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    body.prepend(overlay);

    const rootEl = document.getElementById("root");
    if (!rootEl) {
      showFatal('#root not found in index.html');
      return;
    }
    rootEl.style.position = "relative";
    rootEl.style.zIndex = "1";
    rootEl.style.background = "transparent";

    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err: any) {
    showFatal(err?.message || String(err));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
