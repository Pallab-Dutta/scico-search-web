/* Renders the product wordmark "Eratosthenes" — "Era" in the brand red (the old Search colour),
   "tosthenes" in near-black. Any element with class "scico-logo" is filled in; its CSS font-size
   controls the size. One source of truth shared by the landing, the sidebar (shell.js) and the app
   pages, so the mark looks IDENTICAL everywhere regardless of each page's body font. */
(function () {
  const ERA_COLOR = "#BA5757";   // brand red — same colour the old "Search" used
  const REST_COLOR = "#141414";  // near-black

  // Load the wordmark font so it renders the same on every page (the app uses a different body font
  // than the landing). Idempotent.
  if (!document.getElementById("scico-logo-font")) {
    const l = document.createElement("link");
    l.id = "scico-logo-font";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@700;800&display=swap";
    (document.head || document.documentElement).appendChild(l);
  }

  if (!document.getElementById("scico-logo-style")) {
    const st = document.createElement("style");
    st.id = "scico-logo-style";
    // Self-contained so it overrides any leftover `.logo` lockup rules (font, weight, padding).
    // Note: no `display` here — the two spans are inline text, and setting display would override
    // each placement's own layout (e.g. .biglogo's centered flex over the search bar).
    st.textContent =
      ".scico-logo{font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-weight:700;" +
        "letter-spacing:-.02em;line-height:1;white-space:nowrap;padding:0}" +
      ".scico-logo .era-a{color:" + ERA_COLOR + "}" +
      ".scico-logo .era-b{color:" + REST_COLOR + "}";
    (document.head || document.documentElement).appendChild(st);
  }

  const HTML = '<span class="era-a">Era</span><span class="era-b">tosthenes</span>';

  function render(el) {
    if (el) el.innerHTML = HTML;
  }

  function renderAll(root) {
    (root || document).querySelectorAll(".scico-logo").forEach(render);
  }

  window.SciCoLogo = { HTML, render, renderAll };

  if (document.readyState !== "loading") renderAll();
  else document.addEventListener("DOMContentLoaded", () => renderAll());
})();
