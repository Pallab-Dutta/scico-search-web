/* Renders the product wordmark "Eratosthenes" as on the homepage logo: Cutive Mono (Benjamin's
   typeface), "Eratos" in the shadow colour and "thenes" in the Earth's day-side grey, as if the
   logo's shadow had fallen on the first half of the name. Any element with class "scico-logo" is
   filled in; its CSS font-size controls the size. One source of truth shared by the sidebar
   (shell.js) and the app pages, so the mark looks IDENTICAL everywhere regardless of each page's
   body font. */
(function () {
  const SHADE = "#1E2A31";   // shadow colour (the still arrow)
  const LIT = "#D1D1D1";     // the Earth's day side

  // Load the wordmark font so it renders the same on every page. Idempotent.
  if (!document.getElementById("scico-logo-font")) {
    const l = document.createElement("link");
    l.id = "scico-logo-font";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap";
    (document.head || document.documentElement).appendChild(l);
  }

  if (!document.getElementById("scico-logo-style")) {
    const st = document.createElement("style");
    st.id = "scico-logo-style";
    // Self-contained so it overrides any leftover `.logo` lockup rules (font, weight, padding).
    // Note: no `display` here — the two spans are inline text, and setting display would override
    // each placement's own layout (e.g. .biglogo's centered flex over the search bar).
    st.textContent =
      ".scico-logo{font-family:'Cutive Mono',monospace;font-weight:700;" +
        "letter-spacing:0;line-height:1;white-space:nowrap;padding:0}" +
      ".scico-logo .era-a{color:" + SHADE + "}" +
      ".scico-logo .era-b{color:" + LIT + "}";
    (document.head || document.documentElement).appendChild(st);
  }

  const HTML = '<span class="era-a">Eratos</span><span class="era-b">thenes</span>';

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
