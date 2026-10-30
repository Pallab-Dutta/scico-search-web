/* Homepage: the hero logo's sunlight casts real shadows across the page.
   Sunlight arrives as parallel rays from the loader's sun direction. The Earth blocks a band as
   wide as itself, and each stick (arrow) blocks a strip: the stick swept along the rays, away from
   the sun. All of it is one shape, faded once, so overlaps never darken twice. The fade runs along
   the rays from the level of the still arrow's tip: full strength there, then thinning out until
   it melts into the background. The Earth's own face is never shaded.
   The name under the logo is drawn in the day-side grey; the letters the shadow falls on take the
   shadow colour (a dark copy of the name, clipped to the shadow).
   Needs loader.js, an element #heroMark holding EratostLoader.svg(...), and a .hero .wordmark with a
   .wm-dark copy inside. */
(function () {
  const L = window.EratostLoader;
  if (!L || !L.sun) return;

  const DARKNESS = 0.30;   // shadow strength at its darkest
  const FADE = 0.25;       // distance over which it fades out, as a share of the screen diagonal
  const SHADE = "#1E2A31";
  const VB_X = 6, VB_Y = 96, VB = 600, CX = 306, CY = 396, R_SURF = 191.6, R_TIP = 290.2;
  const rad = d => d * Math.PI / 180, f = n => n.toFixed(1);
  const NS = "http://www.w3.org/2000/svg";

  let stops = "";
  for (let i = 0; i <= 10; i++)   // eases out, so there is no visible line where it ends
    stops += '<stop offset="' + i / 10 + '" stop-color="#fff" stop-opacity="' + Math.pow(1 - i / 10, 2.2).toFixed(3) + '"/>';

  const svg = document.createElementNS(NS, "svg");
  svg.id = "sunShadow";
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<defs><linearGradient id="ssFade" gradientUnits="userSpaceOnUse">' + stops + '</linearGradient>' +
    '<mask id="ssMask" maskUnits="userSpaceOnUse"><rect fill="url(#ssFade)"/><circle fill="#000"/></mask></defs>' +
    '<g mask="url(#ssMask)" opacity="' + DARKNESS + '"><path fill="' + SHADE + '"/><path fill="' + SHADE + '"/><path fill="' + SHADE + '"/></g>';
  const grad = svg.querySelector("linearGradient"), rect = svg.querySelector("rect"),
    disc = svg.querySelector("circle"), paths = svg.querySelectorAll("path");

  const pathOf = pts => pts.length ? "M" + pts.map(p => f(p[0]) + " " + f(p[1])).join("L") + "Z" : "";
  // Same winding for every polygon, so their union clips the name cleanly.
  function ring(pts, ox, oy) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) pts = pts.slice().reverse();
    return "M" + pts.map(p => f(p[0] - ox) + " " + f(p[1] - oy)).join("L") + "Z";
  }

  function frame() {
    requestAnimationFrame(frame);
    const mark = document.querySelector("#heroMark .era-ld");
    if (!mark) return;
    const r = mark.getBoundingClientRect(), k = r.width / VB;
    const hx = r.left + (CX - VB_X) * k, hy = r.top + (CY - VB_Y) * k;
    const W = innerWidth, H = innerHeight, far = 3 * (W + H + Math.abs(hy));
    const sun = L.sun(), dx = -Math.cos(rad(sun)), dy = Math.sin(rad(sun));   // the way shadows fall

    const polys = [];
    const R = R_SURF * k, px = -dy * R, py = dx * R;                          // the Earth's band
    polys.push([[hx + px, hy + py], [hx + px + far * dx, hy + py + far * dy], [hx - px + far * dx, hy - py + far * dy], [hx - px, hy - py]]);
    [L.still(), L.angle()].forEach(th => {                                     // each stick's strip
      const ux = Math.cos(rad(th)), uy = -Math.sin(rad(th));
      if (Math.abs(ux * dy - uy * dx) < 1e-3) { polys.push([]); return; }      // along the rays: none
      const bx = hx + ux * R_SURF * k, by = hy + uy * R_SURF * k, tx = hx + ux * R_TIP * k, ty = hy + uy * R_TIP * k;
      polys.push([[bx, by], [tx, ty], [tx + far * dx, ty + far * dy], [bx + far * dx, by + far * dy]]);
    });
    polys.forEach((p, i) => paths[i].setAttribute("d", pathOf(p)));

    rect.setAttribute("width", W); rect.setAttribute("height", H);
    disc.setAttribute("cx", hx); disc.setAttribute("cy", hy); disc.setAttribute("r", R);
    const len = FADE * Math.hypot(W, H), b0 = -R_TIP * k;
    grad.setAttribute("x1", hx + dx * b0); grad.setAttribute("y1", hy + dy * b0);
    grad.setAttribute("x2", hx + dx * (b0 + len)); grad.setAttribute("y2", hy + dy * (b0 + len));

    const dark = document.querySelector(".hero .wordmark .wm-dark");
    if (dark) {
      const w = dark.parentNode.getBoundingClientRect(), live = polys.filter(p => p.length);
      dark.style.clipPath = "path('" + live.map(p => ring(p, w.left, w.top)).join(" ") + "')";
    }
  }

  function start() {
    document.body.appendChild(svg);
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
