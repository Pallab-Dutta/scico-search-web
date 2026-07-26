/* Renders the product wordmark "Eratosthenes" — "Era" in the brand red (the old Search colour),
   "tosthenes" in near-black. Any element with class "scico-logo" is filled in; its CSS font-size
   controls the rendered size. One source of truth shared by the sidebar (shell.js) and static pages.
   (Was the LaTeX "SciCo Search^[1-3,✓]" mark; renamed to the persona name.) */
(function () {
  const ERA_COLOR = "#BA5757";   // brand red — same colour the old "Search" used
  const REST_COLOR = "#141414";  // near-black

  if (!document.getElementById("scico-logo-style")) {
    const st = document.createElement("style");
    st.id = "scico-logo-style";
    st.textContent =
      ".scico-logo{font-weight:700;letter-spacing:-.015em;white-space:nowrap}" +
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
