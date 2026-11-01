/* Eratosthenes loading mark, drawn from the logo (Eratost-01.svg) as his experiment.
   The ring is the Earth. Each arrow is a stick standing out of it. Sunlight (not drawn) arrives as parallel rays
   from a fixed direction (the logo's 45 degrees), and each stick casts a shadow along the Earth's
   surface. The teal stick (the query vector) stands still, like Alexandria, with a fixed shadow.
   The orange stick (a paper vector) sweeps round: its shadow vanishes when the sun is straight
   overhead (Syene, the logo's own pose), lengthens towards the horizon, and disappears on the night
   side.

   EratostLoader.svg(cls)        -> the <svg> markup (animated by one shared clock)
   EratostLoader.block(label)    -> large centred loader with a caption (search page)
   EratostLoader.inline()        -> small loader that sits in a line of text
   Pass { area: true } to any of them for the second version: the space each stick shades (between
   the stick, the sunray grazing its tip and the ground) is drawn as a fading shadow, and the Earth's
   night half is shaded, as in classic drawings of the experiment.
   Pass { fade: true } for the third version: ground shadows only, with each shadow's colour set by
   the sun's angle from overhead: darkest when the stick points at the sun, fading to the night-side
   grey as the stick turns perpendicular to the rays, just before it crosses into the night.
   Pass { gradient: true } for the fourth version: the same law applied point by point along each
   shadow, so a shadow is darkest at its stick and lightens towards its far end (which is always
   further from the sun), reaching the night-side grey at the day/night line.
   With prefers-reduced-motion the orange stick stays put and gently pulses. */
(function () {
  let TEAL = "#1E2A31", ORANGE = "#BA5757", HUB = "#BA5757";   // can be changed with configure()
  let RING = "#D1D1D1", NIGHT = "#6E7A82", SHADE = "#1E2A31";   // can be changed with configure()
  const CX = 306, CY = 396;          // hub
  const R_RING = 181.6;              // ring centre line (stroke 20)
  const R_SURF = R_RING + 10;        // outer surface, where the sticks stand
  const R_TIP = 290.2;               // arrow tip distance from the hub (both arrows)
  let SUN = 58;                      // direction of the sun, degrees anticlockwise from pointing right
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
  // Shadow colour for a stick at angle th: SHADE when it points at the sun, NIGHT at 90 degrees.
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  let DARK = hex(SHADE), LIGHT = hex(NIGHT);
  function shadeAt(th) {
    const k = Math.min(1, Math.abs(((th - SUN) % 360 + 540) % 360 - 180) / 90);
    return "rgb(" + DARK.map((v, i) => Math.round(v + (LIGHT[i] - v) * k)).join(",") + ")";
  }
  // Gradient that colours any point on the ring by its own sun angle (the law above). It runs along
  // the sun direction from the sub-solar point (0 degrees) to the hub's level (90 degrees); stops
  // every 10 degrees keep it true to the law, which is linear in angle, not in distance.
  function lawGradient(id) {
    const vx = Math.cos(rad(SUN)), vy = Math.sin(rad(SUN));
    let stops = "";
    for (let a = 0; a <= 90; a += 10)
      stops += '<stop offset="' + (1 - Math.cos(rad(a))).toFixed(4) + '" stop-color="' + shadeAt(SUN + a) + '"/>';
    return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + f(CX + R_SURF * vx) + '" y1="' + f(CY - R_SURF * vy) +
      '" x2="' + CX + '" y2="' + CY + '">' + stops + '</linearGradient>';
  }
  const shadowPath = th => { const s = shadow(th); return s ? arc(s[0], s[1]) : ""; };
  // The region a stick shades, outside the Earth: stick, the ray through its tip, and the ground.
  // When that ray misses the Earth, the region runs off into space between it and the ray that
  // grazes the Earth at the day/night line.
  const surfTo = (a, b) => {           // arc along the surface from angle a to angle b
    const d = ((b - a) % 360 + 540) % 360 - 180, [x, y] = pt(R_SURF, b);
    return "A" + f(R_SURF) + " " + f(R_SURF) + " 0 0 " + (d < 0 ? 1 : 0) + " " + f(x) + " " + f(y);
  };
  function area(th) {
    const s = shadow(th);
    if (!s) return "";
    const [px, py] = pt(R_SURF, th), [tx, ty] = pt(R_TIP, th), [ex, ey] = pt(R_SURF, s[1]);
    let d = "M" + f(px) + " " + f(py) + "L" + f(tx) + " " + f(ty);
    if (Math.abs(((s[1] - SUN) % 360 + 540) % 360 - 180) < 89.99) {
      d += "L" + f(ex) + " " + f(ey);                                // the ray lands on the ground
    } else {
      const far = 520, dx = -far * Math.cos(rad(SUN)), dy = far * Math.sin(rad(SUN));
      d += "L" + f(tx + dx) + " " + f(ty + dy) + "L" + f(ex + dx) + " " + f(ey + dy) + "L" + f(ex) + " " + f(ey);
    }
    return d + surfTo(s[1], th) + "Z";
  }
  const nightDisc = () => {
    const [x1, y1] = pt(R_RING, SUN + 90), [x2, y2] = pt(R_RING, SUN + 270);
    return "M" + f(x1) + " " + f(y1) + "A" + R_RING + " " + R_RING + " 0 0 0 " + f(x2) + " " + f(y2) + "Z";
  };

  // Night half of the ring, as two quarter arcs (a single 180 degree arc is ambiguous in SVG).
  const nightPath = () => arc(SUN + 90, SUN + 180) + arc(SUN + 180, SUN + 270).replace("M", " M");

  if (!document.getElementById("eratost-loader-style")) {
    const st = document.createElement("style");
    st.id = "eratost-loader-style";
    st.textContent =
      ".era-ld,.era-mark{display:block;overflow:hidden}" +
      ".era-ld.era-ld-cast{overflow:visible}" +                // large loader: its shadow fades past the box, no edge
      ".era-ld .era-sh,.era-mark .era-sh{fill:none;stroke:" + SHADE + ";stroke-width:20}" +
      "@keyframes era-pulse{0%,100%{opacity:1}50%{opacity:.45}}" +
      "@media (prefers-reduced-motion:reduce){.era-ld .era-orange{animation:era-pulse 1.8s ease-in-out infinite}}" +
      ".era-ld-block{display:flex;flex-direction:column;align-items:center;padding:26px 0 18px}" +
      ".era-ld-block .era-ld{width:168px;height:168px}" +
      ".era-ld-label{margin-top:14px;font-size:.95rem;font-weight:600;color:var(--muted,#6B7280);text-align:center}" +
      ".era-ld-inline{display:inline-block;width:1.9em;height:1.9em;margin:-.3em -.15em;vertical-align:-.55em;flex:0 0 auto}";
    (document.head || document.documentElement).appendChild(st);
  }

  const arrow = c =>   // as drawn in the logo, at 45 degrees
    '<line x1="306" y1="396" x2="490.9" y2="211.1" stroke="' + c + '" stroke-width="10" stroke-linecap="round"/>' +
    '<polygon fill="' + c + '" points="500.8,229.4 511.2,190.8 472.6,201.2"/>';

  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => !!(mq && mq.matches);

  // One clock for every loader on the page, so a status line that is redrawn on each progress
  // message keeps turning smoothly. Clockwise, slowing briefly where it points at the sun.
  let STILL = 58;          // still arrow angle: pointing at the sun, so it casts no shadow
  let fixedAngle = null;   // set by configure({ angle }) to hold the orange arrow still
  function spinAt(now) {
    if (reduced()) return SUN;
    const x = (now % PERIOD) / PERIOD;
    const e = 0.75 * (0.5 - 0.5 * Math.cos(Math.PI * x)) + 0.25 * x;
    return SUN - 360 * e;          // slowest when it points at the sun, wherever the sun is
  }

  // Once papers arrive, the orange arrow stops spinning and settles at an angle set by the best
  // score so far: 1 lines it up with the teal arrow, 0 puts it opposite (180 degrees clockwise).
  // A better paper later makes it glide closer; weaker ones change nothing.
  const SETTLE_MS = 700;   // time constant of the glide
  let best = null, cur = POSE, last = 0, entering = false;
  const wrap = d => ((d % 360) + 540) % 360 - 180;
  const targetFor = r => STILL - (1 - r) * 180;
  function angleAt(now) {
    if (fixedAngle !== null) cur = fixedAngle;
    else if (best === null) cur = spinAt(now);
    else if (reduced()) cur = targetFor(best);
    else {
      const dt = Math.min(200, Math.max(0, now - last));
      let diff = wrap(targetFor(best) - cur);
      if (entering) {                   // first settle: keep turning clockwise, as it was spinning
        if (diff > 0) diff -= 360;
        if (diff > -1) entering = false;
      }
      cur += diff * (1 - Math.exp(-dt / SETTLE_MS));
    }
    last = now;
    return cur;
  }
  // score(r): offer a paper's score (0..1); the arrow follows the best one seen.
  // score(null): forget the scores and spin again (call it when a new search starts).
  function score(r) {
    if (r === null || r === undefined) { best = null; return; }
    r = Math.max(0, Math.min(1, +r));
    if (isNaN(r)) return;
    if (best === null) { last = performance.now(); entering = true; }
    if (best === null || r > best) best = r;
    start();
  }

  let n = 0;
  // CAST SHADOW (large loaders), as on the homepage: sunlight from SUN, the Earth blocks a band as wide as
  // itself and each stick a strip (the stick swept along the rays, away from the sun). One solid shape faded
  // once through a mask (so overlaps never darken twice), from just behind the Earth's centre outwards, drawn
  // under the Earth so the Earth's face stays clear. The rotating stick's strip turns with it.
  const CAST_FAR = 900, CAST_FROM = 40, CAST_TO = 560;   // fade span along the rays (from the Earth's centre)
  const castDir = () => [-Math.cos(rad(SUN)), Math.sin(rad(SUN))];          // screen axes (y down)
  const poly = pts => "M" + pts.map(q => f(q[0]) + " " + f(q[1])).join("L") + "Z";
  function castBand() {
    const [dx, dy] = castDir(), px = -dy * R_SURF, py = dx * R_SURF, F = CAST_FAR;
    return poly([[CX + px, CY + py], [CX + px + F * dx, CY + py + F * dy], [CX - px + F * dx, CY - py + F * dy], [CX - px, CY - py]]);
  }
  function castStrip(th) {
    const [dx, dy] = castDir(), ux = Math.cos(rad(th)), uy = -Math.sin(rad(th)), F = CAST_FAR;
    if (Math.abs(ux * dy - uy * dx) < 1e-3) return "";                       // along the rays: no shadow
    const b = [CX + ux * R_SURF, CY + uy * R_SURF], t = [CX + ux * R_TIP, CY + uy * R_TIP];
    return poly([b, t, [t[0] + F * dx, t[1] + F * dy], [b[0] + F * dx, b[1] + F * dy]]);
  }
  function castLayer(id, th) {
    const [dx, dy] = castDir(), s0 = CAST_FROM, s1 = CAST_TO;   // nearly gone where it meets the box edge
    let stops = "";
    for (let i = 0; i <= 8; i++) stops += '<stop offset="' + (i / 8) + '" stop-color="#fff" stop-opacity="' + Math.pow(1 - i / 8, 2).toFixed(3) + '"/>';
    return '<defs><linearGradient id="' + id + 'g" gradientUnits="userSpaceOnUse" x1="' + f(CX + dx * s0) + '" y1="' + f(CY + dy * s0) +
        '" x2="' + f(CX + dx * s1) + '" y2="' + f(CY + dy * s1) + '">' + stops + '</linearGradient>' +
      '<mask id="' + id + 'm" maskUnits="userSpaceOnUse" x="-900" y="-900" width="2400" height="2400"><rect x="-900" y="-900" width="2400" height="2400" fill="url(#' + id + 'g)"/></mask></defs>' +
      '<g class="era-cast" mask="url(#' + id + 'm)" opacity=".34">' +
        '<path d="' + castBand() + '" fill="' + SHADE + '"/>' +
        '<path d="' + castStrip(STILL) + '" fill="' + SHADE + '"/>' +
        '<path class="era-cast-o" d="' + castStrip(th) + '" fill="' + SHADE + '"/></g>';
  }

  function svg(cls, opts) {
    const still = !!(opts && opts.still);   // a static mark (logo): drawn once, never animated
    if (!still) start();
    const th = still ? +opts.angle || 0 : angleAt(performance.now()), withArea = !!(opts && opts.area), fade = !!(opts && opts.fade),
      grad = !!(opts && opts.gradient), g = "era-fade-" + (++n), lg = "era-law-" + n;
    // Shade is darkest at the ground and fades with height, so long shadows dissolve before the edge.
    const shade = !withArea ? "" :
      '<defs><radialGradient id="' + g + '" gradientUnits="userSpaceOnUse" cx="306" cy="396" r="300">' +
        '<stop offset=".6" stop-color="' + SHADE + '" stop-opacity=".32"/>' +
        '<stop offset=".8" stop-color="' + SHADE + '" stop-opacity=".16"/>' +
        '<stop offset=".98" stop-color="' + SHADE + '" stop-opacity="0"/></radialGradient></defs>';
    const areas = !withArea ? "" :
      '<path d="' + area(STILL) + '" fill="url(#' + g + ')"/>' +
      '<path class="era-ar-o" d="' + area(th) + '" fill="url(#' + g + ')"/>';
    return '<svg class="' + (still ? "era-mark " : "era-ld ") + ((opts && opts.cast) ? "era-ld-cast " : "") + (cls || "") + '" viewBox="6 96 600 600" role="img" aria-label="' +
      (still ? "Eratosthenes" : "Loading") + '">' +
      shade + areas + ((opts && opts.cast) ? castLayer("era-cast-" + n, th) : "") +
      '<circle cx="306" cy="396" r="181.6" fill="#fff" stroke="' + RING + '" stroke-width="20"/>' +
      (withArea ? '<path d="' + nightDisc() + '" fill="' + SHADE + '" fill-opacity=".09"/>' : "") +
      '<path d="' + nightPath() + '" fill="none" stroke="' + NIGHT + '" stroke-width="20"/>' +
      (grad ? '<defs>' + lawGradient(lg) + '</defs>' : "") +
      '<path class="era-sh" d="' + shadowPath(STILL) + '"' + (fade ? ' style="stroke:' + shadeAt(STILL) + '"' : "") +
        (grad ? ' style="stroke:url(#' + lg + ')"' : "") + '/>' +
      '<path class="era-sh era-sh-o' + (fade ? " era-fade" : "") + '" d="' + shadowPath(th) + '"' +
        (fade ? ' style="stroke:' + shadeAt(th) + '"' : "") + (grad ? ' style="stroke:url(#' + lg + ')"' : "") + '/>' +
      '<g transform="rotate(' + f(-STILL) + ' 306 396)">' +
        '<line x1="306" y1="396" x2="567.4" y2="396" stroke="' + TEAL + '" stroke-width="10" stroke-linecap="round"/>' +
        '<polygon fill="' + TEAL + '" points="561.6,415.9 596.2,396 561.6,376.1"/></g>' +
      '<g class="era-orange" transform="rotate(' + f(POSE - th) + ' 306 396)">' + arrow(ORANGE) + '</g>' +
      '<circle cx="306" cy="396" r="43.7" fill="' + HUB + '"/>' +
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
      let ar = null, col = null, cs = null;
      for (const el of live) {
        const o = el.querySelector(".era-orange"), s = el.querySelector(".era-sh-o"), a = el.querySelector(".era-ar-o");
        const c = el.querySelector(".era-cast-o");
        if (c) c.setAttribute("d", cs !== null ? cs : (cs = castStrip(th)));
        if (o) o.setAttribute("transform", tr);
        if (s) { s.setAttribute("d", d); if (s.classList.contains("era-fade")) s.style.stroke = col || (col = shadeAt(th)); }
        if (a) a.setAttribute("d", ar || (ar = area(th)));
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

  // For tuning only: change the colours, turn the still teal arrow ({ still }), or hold the orange
  // arrow at an angle ({ angle }; null lets it turn). Angles are degrees anticlockwise from
  // pointing right; the logo has teal at 0 and orange at 45, with the sun at 45 (the loader keeps
  // teal at 45, pointing at the sun). Loaders created
  // afterwards use the new colours.
  function configure(o) {
    if (o.ring) RING = o.ring;
    if (o.night) NIGHT = o.night;
    if (o.shade) SHADE = o.shade;
    if (o.still_color) TEAL = o.still_color;
    if (o.moving_color) ORANGE = o.moving_color;
    if (o.hub) HUB = o.hub;
    DARK = hex(SHADE); LIGHT = hex(NIGHT);
    if ("sun" in o) SUN = +o.sun || 0;   // turns the sunlight (pass still too, to keep that arrow on the rays)
    if ("still" in o) STILL = +o.still || 0;
    if ("angle" in o) fixedAngle = o.angle === null ? null : +o.angle;
    start();
  }

  window.EratostLoader = {
    svg,
    configure,
    score,
    best: () => best,
    sun: () => SUN,       // sunlight direction, degrees
    still: () => STILL,   // still arrow angle
    angle: () => cur,     // rotating arrow angle right now
    // Large loader: with the cast shadow by default (pass { cast: false } for none).
    block: (label, opts) => '<div class="era-ld-block" role="status">' + svg("", Object.assign({ cast: true }, opts)) +
      (label ? '<div class="era-ld-label">' + esc(label) + '</div>' : "") + '</div>',
    inline: opts => '<span class="era-ld-inline">' + svg("", opts) + '</span>',
    // The logo, standing still. The rotating arrow sits where a 0.75 score puts it, which is the
    // pose of the original drawing (Eratost-01.svg), turned so the still arrow points at the sun.
    mark: (cls, opts) => svg(cls, Object.assign({ gradient: true, angle: STILL - 45 }, opts, { still: true })),
  };
})();
