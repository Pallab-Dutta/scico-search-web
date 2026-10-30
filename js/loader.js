/* Eratosthenes loading mark, drawn from the logo (Eratost-01.svg) as his experiment.
   The ring is the Earth. Each arrow is a stick standing out of it. Sunlight arrives as parallel rays
   from a fixed direction (the logo's 45 degrees), and each stick casts a shadow along the Earth's
   surface. The teal stick (the query vector) stands still, like Alexandria, with a fixed shadow.
   The orange stick (a paper vector) sweeps round: its shadow vanishes when the sun is straight
   overhead (Syene, the logo's own pose), lengthens towards the horizon, and disappears on the night
   side.

   EratostLoader.svg(cls)        -> the <svg> markup (animated by one shared clock)
   EratostLoader.block(label)    -> large centred loader with a caption (search page)
   EratostLoader.inline()        -> small loader that sits in a line of text
   With prefers-reduced-motion the orange stick stays put and gently pulses. */
(function () {
  const TEAL = "#0C5455", ORANGE = "#D77B4B", RING = "#BDC6C9", NIGHT = "#A2ACB0";
  const SHADE = "#1E2A31", SUNRAY = "#E0A030";
  const CX = 306, CY = 396;          // hub
  const R_RING = 181.6;              // ring centre line (stroke 20)
  const R_SURF = R_RING + 10;        // outer surface, where the sticks stand
  const R_TIP = 290.2;               // arrow tip distance from the hub (both arrows)
  const SUN = 45;                    // direction of the sun, degrees anticlockwise from the teal arrow
  const POSE = 45;                   // orange arrow angle in the logo
  const PERIOD = 3600;               // ms per turn

  const rad = d => d * Math.PI / 180, deg = x => x * 180 / Math.PI;
  const pt = (r, a) => [CX + r * Math.cos(rad(a)), CY - r * Math.sin(rad(a))];   // screen y points down
  const f = n => n.toFixed(1);

  // Shadow of a stick at angle th: [start, end] angles on the surface, or null when it has none.
  function shadow(th) {
    const c = Math.cos(rad(th - SUN));                     // cosine of the sun's angle from overhead
    if (c <= 0) return null;                               // night side
    const d = ((th - SUN) % 360 + 540) % 360 - 180;
    if (Math.abs(d) < 0.05) return null;                   // sun overhead
    const disc = R_TIP * R_TIP * c * c - (R_TIP * R_TIP - R_SURF * R_SURF);
    if (disc < 0) return [th, SUN + Math.sign(d) * 90];    // tip's ray misses the Earth: up to the terminator
    // The ray through the tip, travelling away from the sun, first meets the surface here.
    const t = R_TIP * c - Math.sqrt(disc);
    const ux = Math.cos(rad(th)), uy = Math.sin(rad(th)), vx = Math.cos(rad(SUN)), vy = Math.sin(rad(SUN));
    return [th, deg(Math.atan2(R_TIP * uy - t * vy, R_TIP * ux - t * vx))];
  }
  // Arc along the ring from angle a to b (the shorter way round).
  function arc(a, b) {
    const d = ((b - a) % 360 + 540) % 360 - 180;
    const [x1, y1] = pt(R_RING, a), [x2, y2] = pt(R_RING, a + d);
    return "M" + f(x1) + " " + f(y1) + "A" + R_RING + " " + R_RING + " 0 0 " + (d < 0 ? 1 : 0) + " " + f(x2) + " " + f(y2);
  }
  const shadowPath = th => { const s = shadow(th); return s ? arc(s[0], s[1]) : ""; };
  // Night half of the ring, as two quarter arcs (a single 180 degree arc is ambiguous in SVG).
  const nightPath = () => arc(SUN + 90, SUN + 180) + arc(SUN + 180, SUN + 270).replace("M", " M");

  if (!document.getElementById("eratost-loader-style")) {
    const st = document.createElement("style");
    st.id = "eratost-loader-style";
    st.textContent =
      ".era-ld{display:block;overflow:visible}" +
      ".era-ld .era-sh{fill:none;stroke:" + SHADE + ";stroke-width:20}" +
      "@keyframes era-pulse{0%,100%{opacity:1}50%{opacity:.45}}" +
      "@media (prefers-reduced-motion:reduce){.era-ld .era-orange{animation:era-pulse 1.8s ease-in-out infinite}}" +
      ".era-ld-block{display:flex;flex-direction:column;align-items:center;padding:26px 0 18px}" +
      ".era-ld-block .era-ld{width:168px;height:168px}" +
      ".era-ld-label{margin-top:14px;font-size:.95rem;font-weight:600;color:var(--muted,#6B7280);text-align:center}" +
      ".era-ld-inline{display:inline-block;width:1.9em;height:1.9em;margin:-.3em -.15em;vertical-align:-.55em;flex:0 0 auto}" +
      ".era-ld-inline .era-rays{display:none}";
    (document.head || document.documentElement).appendChild(st);
  }

  // Faint parallel sunrays on the day side, heading towards the Earth.
  function rays() {
    const wx = -Math.sin(rad(SUN)), wy = Math.cos(rad(SUN)), vx = Math.cos(rad(SUN)), vy = Math.sin(rad(SUN));
    let s = "";
    for (const o of [-150, -75, 75, 150]) {
      const near = Math.sqrt(R_SURF * R_SURF - o * o) + 8, far = 268;
      const p = r => [CX + o * wx + r * vx, CY - (o * wy + r * vy)];
      const [x1, y1] = p(far), [x2, y2] = p(near);
      s += '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>';
    }
    return '<g class="era-rays" stroke="' + SUNRAY + '" stroke-width="7" stroke-linecap="round" ' +
      'stroke-dasharray="6 14" opacity=".85">' + s + '</g>';
  }

  const arrow = c =>   // as drawn in the logo, at 45 degrees
    '<line x1="306" y1="396" x2="490.9" y2="211.1" stroke="' + c + '" stroke-width="10" stroke-linecap="round"/>' +
    '<polygon fill="' + c + '" points="500.8,229.4 511.2,190.8 472.6,201.2"/>';

  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => !!(mq && mq.matches);

  // One clock for every loader on the page, so a status line that is redrawn on each progress
  // message keeps turning smoothly. Clockwise, slowing briefly at the logo pose (sun overhead).
  function angleAt(now) {
    if (reduced()) return POSE;
    const x = (now % PERIOD) / PERIOD;
    const e = 0.75 * (0.5 - 0.5 * Math.cos(Math.PI * x)) + 0.25 * x;
    return POSE - 360 * e;
  }

  function svg(cls) {
    start();
    const th = angleAt(performance.now());
    return '<svg class="era-ld ' + (cls || "") + '" viewBox="6 96 600 600" role="img" aria-label="Loading">' +
      rays() +
      '<circle cx="306" cy="396" r="181.6" fill="#fff" stroke="' + RING + '" stroke-width="20"/>' +
      '<path d="' + nightPath() + '" fill="none" stroke="' + NIGHT + '" stroke-width="20"/>' +
      '<path class="era-sh" d="' + shadowPath(0) + '"/>' +
      '<path class="era-sh era-sh-o" d="' + shadowPath(th) + '"/>' +
      '<line x1="306" y1="396" x2="567.4" y2="396" stroke="' + TEAL + '" stroke-width="10" stroke-linecap="round"/>' +
      '<polygon fill="' + TEAL + '" points="561.6,415.9 596.2,396 561.6,376.1"/>' +
      '<g class="era-orange" transform="rotate(' + f(POSE - th) + ' 306 396)">' + arrow(ORANGE) + '</g>' +
      '<circle cx="306" cy="396" r="43.7" fill="' + ORANGE + '"/>' +
      '</svg>';
  }

  const live = document.getElementsByClassName("era-ld");
  let running = false, idleSince = 0;
  function frame(now) {
    if (!live.length) {
      if (!idleSince) idleSince = now;
      if (now - idleSince > 2000) { running = false; return; }   // no loaders left: stop until the next one
    } else {
      idleSince = 0;
      const th = angleAt(now), tr = "rotate(" + f(POSE - th) + " 306 396)", d = shadowPath(th);
      for (const el of live) {
        const o = el.querySelector(".era-orange"), s = el.querySelector(".era-sh-o");
        if (o) o.setAttribute("transform", tr);
        if (s) s.setAttribute("d", d);
      }
    }
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || typeof requestAnimationFrame !== "function") return;
    running = true; idleSince = 0;
    requestAnimationFrame(frame);
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
