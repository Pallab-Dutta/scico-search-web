/* Eratosthenes loading mark, drawn from the logo (Eratost-01.svg).
   The ring is the Earth, the teal arrow is the fixed query vector, and the orange arrow is the
   paper vector that sweeps around it (vector search). A soft shadow, offset as if lit from the
   top left, turns with the orange arrow.

   EratostLoader.svg(cls)        -> the animated <svg> markup
   EratostLoader.block(label)    -> large centred loader with a caption (search page)
   EratostLoader.inline()        -> small loader that sits in a line of text
   Respects prefers-reduced-motion (the arrow pulses instead of turning). */
(function () {
  const TEAL = "#0C5455", ORANGE = "#D77B4B", RING = "#BDC6C9";
  const PERIOD = 2400;   // ms per turn; keep in step with the era-turn duration below

  if (!document.getElementById("eratost-loader-style")) {
    const st = document.createElement("style");
    st.id = "eratost-loader-style";
    st.textContent =
      ".era-ld{display:block;overflow:visible}" +
      ".era-ld .era-turn{transform-box:view-box;transform-origin:306px 396px;" +
        "animation:era-turn 2.4s cubic-bezier(.55,.06,.35,.98) infinite}" +
      ".era-ld .era-shadow{opacity:.28}" +
      "@keyframes era-turn{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" +
      "@keyframes era-pulse{0%,100%{opacity:1}50%{opacity:.45}}" +
      "@media (prefers-reduced-motion:reduce){.era-ld .era-turn{animation:era-pulse 1.8s ease-in-out infinite}}" +
      ".era-ld-block{display:flex;flex-direction:column;align-items:center;padding:26px 0 18px}" +
      ".era-ld-block .era-ld{width:168px;height:168px}" +
      ".era-ld-label{margin-top:14px;font-size:.95rem;font-weight:600;color:var(--muted,#6B7280);text-align:center}" +
      ".era-ld-inline{display:inline-block;width:1.9em;height:1.9em;margin:-.3em -.15em;vertical-align:-.55em;flex:0 0 auto}";
    (document.head || document.documentElement).appendChild(st);
  }

  let n = 0;
  // The arrow as drawn in the logo, pointing up-right at 45 degrees from the hub (306, 396).
  const arrow = c =>
    '<line x1="306" y1="396" x2="490.9" y2="211.1" stroke="' + c + '" stroke-width="10" stroke-linecap="round"/>' +
    '<polygon fill="' + c + '" points="500.8,229.4 511.2,190.8 472.6,201.2"/>';

  function svg(cls) {
    const id = "era-blur-" + (++n);
    // Start mid-turn in step with a shared clock, so a status line that is redrawn on every
    // progress message keeps turning smoothly instead of snapping back to the start.
    const sync = ' style="animation-delay:-' + Math.round(performance.now() % PERIOD) + 'ms"';
    // viewBox is wide enough for the arrow tip (radius about 290) to sweep a full circle.
    return '<svg class="era-ld ' + (cls || "") + '" viewBox="6 96 600 600" role="img" aria-label="Loading">' +
      '<defs><filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feGaussianBlur stdDeviation="7"/></filter></defs>' +
      '<circle cx="306" cy="396" r="181.6" fill="#fff" stroke="' + RING + '" stroke-width="20"/>' +
      '<line x1="306" y1="396" x2="567.4" y2="396" stroke="' + TEAL + '" stroke-width="10" stroke-linecap="round"/>' +
      '<polygon fill="' + TEAL + '" points="561.6,415.9 596.2,396 561.6,376.1"/>' +
      // Shadow: offset down-right in screen space, turning in step with the arrow.
      '<g transform="translate(14 18)"><g class="era-turn"' + sync + '><g class="era-shadow" filter="url(#' + id + ')">' +
        arrow("#3a3f44") + '</g></g></g>' +
      '<g class="era-turn"' + sync + '>' + arrow(ORANGE) + '</g>' +
      '<circle cx="306" cy="396" r="43.7" fill="' + ORANGE + '"/>' +
      '</svg>';
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

  window.EratostLoader = {
    svg,
    block: label => '<div class="era-ld-block" role="status">' + svg() +
      (label ? '<div class="era-ld-label">' + esc(label) + '</div>' : "") + '</div>',
    inline: () => '<span class="era-ld-inline">' + svg() + '</span>',
  };
})();
