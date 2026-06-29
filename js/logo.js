/* Renders the SciCo-Search wordmark as the exact LaTeX equation used in the Streamlit app
   (boxed red "Search" subscript + bold [1-3,✓] superscript), via KaTeX.
   Any element with class "scico-logo" is filled in; its font-size controls the rendered size.
   Reusable so the sidebar (shell.js) and static pages share one source of truth. */
(function () {
  // Mirrors app4deployment.py: $$\mathbf{SciCo\,}_{\Large\boxed{\color{red}{\text{Search}}}}^{\large\mathbf{[1-3,\checkmark]}}$$
  // (global \Huge dropped so each placement scales by its CSS font-size; brand red instead of plain red).
  const TEX = "\\mathbf{SciCo\\,}_{\\Large\\boxed{\\color{#BA5757}{\\text{Search}}}}^{\\large\\mathbf{[1\\text{-}3,\\checkmark]}}";

  function whenKatex(cb) {
    if (window.katex) return cb();
    let n = 0;
    const t = setInterval(() => {
      if (window.katex || n++ > 75) { clearInterval(t); if (window.katex) cb(); }
    }, 40);
  }

  function render(el) {
    if (!el) return;
    whenKatex(() => {
      try { window.katex.render(TEX, el, { throwOnError: false, displayMode: false }); }
      catch (e) { /* leave any fallback text in place */ }
    });
  }

  function renderAll(root) {
    (root || document).querySelectorAll(".scico-logo").forEach(render);
  }

  window.SciCoLogo = { TEX, render, renderAll };

  if (document.readyState !== "loading") renderAll();
  else document.addEventListener("DOMContentLoaded", () => renderAll());
})();
