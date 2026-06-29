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

  // Size/position knobs for the sub/superscript. *_SIZE is em relative to natural script size
  // (1em = unchanged). *_Y is a vertical nudge (negative raises, positive lowers) to re-center a
  // script after resizing — KaTeX fixes the baseline at the original size, so shrinking drops it.
  // Tweak live in DevTools by editing these vars on the .scico-logo element, then tell me the values.
  const SUB_SIZE = "0.65em";  // boxed "Search" subscript
  const SUB_Y    = "0em";     // raise/lower "Search" (try negatives like -0.12em to raise)
  const SUP_SIZE = "1em";     // [1-3,✓] superscript
  const SUP_Y    = "0em";     // raise/lower [1-3,✓]
  if (!document.getElementById("scico-logo-style")) {
    const st = document.createElement("style");
    st.id = "scico-logo-style";
    st.textContent =
      ".scico-logo{--logo-sub:" + SUB_SIZE + ";--logo-sub-y:" + SUB_Y +
        ";--logo-sup:" + SUP_SIZE + ";--logo-sup-y:" + SUP_Y + "}" +
      ".scico-logo .logo-sub{font-size:var(--logo-sub);position:relative;top:var(--logo-sub-y,0em)}" +
      ".scico-logo .logo-sup{font-size:var(--logo-sup);position:relative;top:var(--logo-sup-y,0em)}";
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
