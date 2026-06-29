/* Renders the SciCo-Search wordmark as the exact LaTeX equation used in the Streamlit app
   (boxed red "Search" subscript + bold [1-3,✓] superscript), via KaTeX.
   Any element with class "scico-logo" is filled in; its font-size controls the rendered size.
   Reusable so the sidebar (shell.js) and static pages share one source of truth. */
(function () {
  // Based on app4deployment.py's $$\mathbf{SciCo\,}_{\boxed{\color{red}{\text{Search}}}}^{\mathbf{[1-3,\checkmark]}}$$
  // "SciCo" reads largest; the boxed "Search" subscript + [1-3,✓] superscript render at natural
  // (smaller) script size. No global size command, so each placement scales by its element's CSS
  // font-size; brand red. The scripts are wrapped in \htmlClass so their size can be tuned via the
  // --logo-sub / --logo-sup CSS variables below (handy for trial-and-error in DevTools).
  const TEX = "\\mathbf{SciCo\\,}_{\\htmlClass{logo-sub}{\\boxed{\\color{#BA5757}{\\text{Search}}}}}^{\\htmlClass{logo-sup}{\\mathbf{[1\\text{-}3,\\checkmark]}}}";

  // Size knobs for the sub/superscript (em = relative to their natural script size; 1em = unchanged).
  // Tweak live in DevTools by editing these vars on the .scico-logo element, then tell me the values.
  const SUB_SIZE = "1em";   // boxed "Search" subscript
  const SUP_SIZE = "1em";   // [1-3,✓] superscript
  if (!document.getElementById("scico-logo-style")) {
    const st = document.createElement("style");
    st.id = "scico-logo-style";
    st.textContent =
      ".scico-logo{--logo-sub:" + SUB_SIZE + ";--logo-sup:" + SUP_SIZE + "}" +
      ".scico-logo .logo-sub{font-size:var(--logo-sub)}" +
      ".scico-logo .logo-sup{font-size:var(--logo-sup)}";
    (document.head || document.documentElement).appendChild(st);
  }

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
      try { window.katex.render(TEX, el, { throwOnError: false, displayMode: false, trust: true, strict: false }); }
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
