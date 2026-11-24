/* Knowledge Landscape: the redesigned Topic Map (developer accounts first; results.html decides who sees it).
   Same topic_map data as the Topic Map (points, clusters, gaps, grid, peaks, query), drawn in the owner's
   reference style (MAZE/hypothesis_landscape_minimal_cutive_static.svg, as in the explainer video's
   DensityMap.tsx): grey density on paper, grey iso-lines computed here by marching squares on the bilinear
   field, so the lines sit exactly on the shading. Each closed ring belongs to the one cluster whose peak it
   holds (rings holding several peaks belong to none), which links topics and regions both ways.
   Plain JS + inline SVG, no dependencies.

   window.KnowledgeLandscape.render(host, tm, {lookup(point) -> paper|null, onGap(i)}) */
(function () {
  const PAPER = "#fbf7ef", RULE = "#e3e2de", INK = "#0b0b0b", GREY = "#52514e", UNCL = "#a3a29b";
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#7E6BA8", "#C98A3E", "#4C9AA6"];
  const LEVELS = 6, MAXA = 0.62, N = 200, V = 600;          // V: the map's SVG units (square)
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function injectCSS() {
    if (document.getElementById("kl-css")) return;
    const s = document.createElement("style");
    s.id = "kl-css";
    s.textContent = `
.kl{font-family:'Cutive Mono','Courier New',monospace;color:${INK};--kl-paper:${PAPER};--kl-rule:${RULE};--kl-grey:${GREY}}
.kl *{box-sizing:border-box}
.kl-grid{display:grid;grid-template-columns:minmax(0,640px) minmax(260px,1fr);gap:28px;align-items:start;margin-top:12px}
.kl-h{font-size:1.35rem;font-weight:400;margin:4px 0 12px;letter-spacing:.01em}
.kl-map{position:relative;width:100%;aspect-ratio:1/1;background:${PAPER};border-radius:8px}
.kl-map svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:manipulation}
.kl-pt{cursor:pointer;transition:opacity .15s}
.kl-pt.dim{opacity:.35}
.kl-reg path{transition:fill-opacity .2s}
.kl-reg.pulse{animation:klpulse .6s ease-in-out 2}
@keyframes klpulse{0%,100%{opacity:1}50%{opacity:.35}}
.kl-outer{transition:stroke-width .2s,stroke-opacity .2s}
.kl-gap{cursor:pointer}
.kl-gap .ring{transform-box:fill-box;transform-origin:center}
.kl-gap.on .ring{animation:klring 1s ease-in-out infinite}
@keyframes klring{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
.kl-gap.on .dia{fill:${INK}}
.kl-gap .glabel{opacity:0;transition:opacity .15s;pointer-events:none;paint-order:stroke;stroke:${PAPER};stroke-width:5px;stroke-linejoin:round}
.kl-gap.on .glabel{opacity:1}
.kl-cbar{margin-top:14px;font-size:.82rem;color:${GREY};display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}
.kl-cbar b{color:${INK};font-weight:400;font-size:.9rem;width:100%}
.kl-steps{display:flex;align-items:center;gap:6px}
.kl-steps i{display:inline-block;width:22px;height:12px;border:1px solid ${RULE}}
.kl-info{margin-top:14px;border:1.5px solid ${RULE};border-radius:6px;background:${PAPER};padding:12px 14px;min-height:92px;font-size:.86rem;line-height:1.45}
.kl-info .hint{color:${GREY}}
.kl-info .t{font-size:.95rem;color:${INK}}
.kl-info .t a{color:${INK};text-decoration:underline;text-decoration-color:${RULE};text-underline-offset:3px}
.kl-info .t a:hover{text-decoration-color:${INK}}
.kl-info .m{color:${GREY};margin-top:4px}
.kl-info .cl{display:flex;align-items:center;gap:7px;margin-top:6px;color:${GREY}}
.kl-dot{width:10px;height:10px;border-radius:50%;flex:0 0 10px}
.kl-side h3{font-size:.8rem;font-weight:400;letter-spacing:.12em;text-transform:uppercase;color:${GREY};margin:4px 0 10px}
.kl-topic{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-left:3px solid transparent;border-radius:6px;padding:9px 10px 9px 12px;margin:0 0 4px;cursor:pointer}
.kl-topic:hover,.kl-topic:focus-visible,.kl-topic.on{background:var(--tint);border-left-color:var(--col);outline:none}
.kl-topic .row{display:flex;align-items:baseline;gap:9px}
.kl-topic .nm{font-size:.95rem;flex:1}
.kl-topic .n{font-size:.75rem;color:${GREY};white-space:nowrap}
.kl-topic .bands{font-size:.75rem;color:${GREY};margin:4px 0 0 19px}
.kl-gaps{margin-top:22px}
.kl-gapcard{border:1.5px dashed ${GREY};border-radius:6px;padding:10px 12px;margin-bottom:8px;background:${PAPER};cursor:pointer;transition:border-color .15s,background .15s}
.kl-gapcard.on{border-color:${INK};background:#f1ece1}
.kl-gapcard.flash{animation:klflash 1.5s ease}
@keyframes klflash{0%,100%{box-shadow:none}22%{box-shadow:0 0 0 3px ${INK}}}
.kl-gapcard .gt{font-size:.9rem;display:flex;gap:8px;align-items:baseline}
.kl-gapcard .gt .d{font-size:.72rem;letter-spacing:.08em;white-space:nowrap}
.kl-gapcard .ex{font-size:.76rem;color:${GREY};margin-top:5px}
.kl-none{font-size:.85rem;color:${GREY}}
@media(max-width:760px){.kl-grid{grid-template-columns:1fr;gap:20px}}
@media(prefers-reduced-motion:reduce){.kl-reg.pulse,.kl-gap.on .ring,.kl-gapcard.flash{animation:none}}`;
    document.head.appendChild(s);
  }

  const colorOf = (cid, known) => (known.has(cid) ? COLORS[((cid % COLORS.length) + COLORS.length) % COLORS.length] : UNCL);
  function tint(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Bilinear sample of grid[row=y][col=x] (values 0..1) at map coords x, y in [0,1] (as drawFieldContour).
  function sampler(grid) {
    const G = grid.length;
    return (x, y) => {
      const gx = clamp01(x) * (G - 1), gy = clamp01(y) * (G - 1);
      const c0 = Math.floor(gx), r0 = Math.floor(gy), c1 = Math.min(G - 1, c0 + 1), r1 = Math.min(G - 1, r0 + 1), fx = gx - c0, fy = gy - r0;
      return (grid[r0][c0] * (1 - fx) + grid[r0][c1] * fx) * (1 - fy) + (grid[r1][c0] * (1 - fx) + grid[r1][c1] * fx) * fy;
    };
  }

  // The density field as an image: paper blended with grey at alpha t * 0.62 (darker = denser).
  function fieldURL(f) {
    const S = 480, cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    const cx = cv.getContext("2d"), img = cx.createImageData(S, S), d = img.data;
    const P = [251, 247, 239], Gc = [82, 81, 78];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = clamp01(f(x / (S - 1), y / (S - 1))) * MAXA, i = (y * S + x) * 4;
      d[i] = P[0] + (Gc[0] - P[0]) * a; d[i + 1] = P[1] + (Gc[1] - P[1]) * a; d[i + 2] = P[2] + (Gc[2] - P[2]) * a; d[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  // Marching squares on an (N+1)^2 sampling of the field, padded by one ring of zeros just outside the map,
  // so every iso-line closes (the padded edge runs outside the frame and is clipped). Returns closed rings.
  function contours(f) {
    const m = N + 3, Vv = new Float32Array(m * m), X = c => (c - 1) / N;
    for (let r = 1; r < m - 1; r++) for (let c = 1; c < m - 1; c++) Vv[r * m + c] = f(X(c), X(r));
    const out = [];
    for (let li = 1; li < LEVELS; li++) {
      const L = li / LEVELS, pts = new Map(), segs = [];
      const pt = (key, ra, ca, rb, cb) => {           // the crossing on the edge (ra,ca)-(rb,cb)
        if (!pts.has(key)) {
          const a = Vv[ra * m + ca], b = Vv[rb * m + cb], t = (L - a) / ((b - a) || 1e-12);
          pts.set(key, [X(ca + (cb - ca) * t), X(ra + (rb - ra) * t)]);
        }
        return key;
      };
      for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) {
        const tl = Vv[r * m + c], tr = Vv[r * m + c + 1], br = Vv[(r + 1) * m + c + 1], bl = Vv[(r + 1) * m + c];
        const k = (tl >= L ? 8 : 0) | (tr >= L ? 4 : 0) | (br >= L ? 2 : 0) | (bl >= L ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const T = () => pt(2 * (r * m + c), r, c, r, c + 1), B = () => pt(2 * ((r + 1) * m + c), r + 1, c, r + 1, c + 1);
        const Lf = () => pt(2 * (r * m + c) + 1, r, c, r + 1, c), R = () => pt(2 * (r * m + c + 1) + 1, r, c + 1, r + 1, c + 1);
        const mid = (tl + tr + br + bl) / 4 >= L;
        switch (k) {
          case 1: case 14: segs.push([Lf(), B()]); break;
          case 2: case 13: segs.push([B(), R()]); break;
          case 3: case 12: segs.push([Lf(), R()]); break;
          case 4: case 11: segs.push([T(), R()]); break;
          case 6: case 9: segs.push([T(), B()]); break;
          case 7: case 8: segs.push([Lf(), T()]); break;
          case 5: if (mid) { segs.push([Lf(), T()]); segs.push([B(), R()]); } else { segs.push([T(), R()]); segs.push([Lf(), B()]); } break;
          case 10: if (mid) { segs.push([T(), R()]); segs.push([Lf(), B()]); } else { segs.push([Lf(), T()]); segs.push([B(), R()]); } break;
        }
      }
      // Chain the segments through their shared edge crossings into rings.
      const at = new Map();
      segs.forEach((s, i) => s.forEach(e => { const l = at.get(e); if (l) l.push(i); else at.set(e, [i]); }));
      const used = new Uint8Array(segs.length);
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const chain = [segs[i][0], segs[i][1]];
        for (;;) {
          const tail = chain[chain.length - 1], nx = (at.get(tail) || []).find(j => !used[j]);
          if (nx == null) break;
          used[nx] = 1;
          chain.push(segs[nx][0] === tail ? segs[nx][1] : segs[nx][0]);
        }
        if (chain.length < 6) continue;
        const closed = chain[0] === chain[chain.length - 1];
        const P = chain.map(e => pts.get(e));
        out.push({ level: li, closed, pts: P.length > 400 ? P.filter((_, j) => j % Math.ceil(P.length / 400) === 0) : P });
      }
    }
    return out;
  }

  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const pathD = (pts, closed) => pts.map(([x, y], i) => (i ? "L" : "M") + (x * V).toFixed(1) + "," + (y * V).toFixed(1)).join("") + (closed ? "Z" : "");

  function render(host, tm, opts) {
    opts = opts || {};
    injectCSS();
    const clusters = tm.clusters || [], gaps = tm.gaps || [], points = tm.points || [];
    const known = new Set(clusters.map(c => c.id));
    const grid = tm.grid && tm.grid.length > 1 ? tm.grid : null;
    const f = grid ? sampler(grid) : () => 0;

    // Each cluster's peak: the backend peak nearest its centroid (each peak used once), else the centroid.
    const peaks = (tm.peaks || []).filter(p => Array.isArray(p) && p.length >= 2).map(p => [+p[0], +p[1]]);
    const peakOf = {}, taken = new Set();
    clusters.forEach(c => {
      const mine = points.filter(p => p.cluster === c.id);
      if (!mine.length) return;
      const cx = mine.reduce((s, p) => s + p.x, 0) / mine.length, cy = mine.reduce((s, p) => s + p.y, 0) / mine.length;
      let best = -1, bd = Infinity;
      peaks.forEach((p, i) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (!taken.has(i) && d < bd) { bd = d; best = i; } });
      if (best >= 0) { taken.add(best); peakOf[c.id] = peaks[best]; } else peakOf[c.id] = [cx, cy];
    });
    const rings = grid ? contours(f) : [];
    rings.forEach(r => {
      const ids = r.closed ? Object.keys(peakOf).map(Number).filter(id => inside(r.pts, peakOf[id][0], peakOf[id][1])) : [];
      r.cluster = ids.length === 1 ? ids[0] : -1;      // a ring around several topics belongs to none
    });
    const outer = {};                                    // the cluster's outermost own ring (hit-test + dashed edge)
    rings.forEach(r => { if (r.cluster >= 0 && (!outer[r.cluster] || r.level < outer[r.cluster].level)) outer[r.cluster] = r; });

    // ---- markup ----
    const gridLines = [1, 2, 3, 4].map(i => { const v = (i / 5) * V; return `<line x1="${v}" y1="0" x2="${v}" y2="${V}"/><line x1="0" y1="${v}" x2="${V}" y2="${v}"/>`; }).join("");
    const regions = clusters.map(c => {
      const own = rings.filter(r => r.cluster === c.id);
      if (!own.length) return "";
      const col = colorOf(c.id, known);
      return `<g class="kl-reg" data-c="${c.id}">` + own.map(r => `<path d="${pathD(r.pts, true)}" fill="${col}" fill-opacity=".08"/>`).join("") + `</g>`;
    }).join("");
    const lines = rings.map(r => `<path d="${pathD(r.pts, r.closed)}" fill="none" stroke="${GREY}" stroke-opacity="${(0.28 + 0.09 * (r.level - 1)).toFixed(2)}" stroke-width="1.5"/>`).join("");
    const outers = Object.keys(outer).map(id => `<path class="kl-outer" data-c="${id}" d="${pathD(outer[id].pts, true)}" fill="none" stroke="${colorOf(+id, known)}" stroke-opacity=".75" stroke-width="2" stroke-dasharray="9 7"/>`).join("");
    const dots = points.map((p, i) => {
      const op = (0.78 + 0.22 * clamp01(p.score || 0)).toFixed(2);
      return `<circle class="kl-pt" data-i="${i}" data-c="${p.cluster}" cx="${(clamp01(p.x) * V).toFixed(1)}" cy="${(clamp01(p.y) * V).toFixed(1)}" r="5" fill="${colorOf(p.cluster, known)}" fill-opacity="${op}" stroke="${PAPER}" stroke-width="2"><title>${esc(p.title)}</title></circle>`;
    }).join("");
    const gapMarks = gaps.map((g, gi) => {
      const x = clamp01(g.x) * V, y = clamp01(g.y) * V, right = x < V / 2, lab = String(g.label || "Research gap");
      // Up to 2 lines, sized to the room on the label's side (Cutive Mono ~7.8 units per char at 13).
      const room = Math.max(10, Math.floor(((right ? V - x : x) - 34) / 7.8)), words = lab.split(/\s+/), ls = [""];
      for (const w of words) {
        const cur = ls[ls.length - 1];
        if (!cur || (cur + " " + w).length <= room) ls[ls.length - 1] = (cur ? cur + " " : "") + w;
        else if (ls.length < 2) ls.push(w);
        else { ls[1] = (ls[1] + " " + w); }
      }
      const lines = ls.map(l => (l.length > room ? l.slice(0, room - 1).trimEnd() + "…" : l));
      return `<g class="kl-gap" data-g="${gi}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc("Research gap: " + lab)}">` +
        `<circle class="ring" r="17" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 7"/>` +
        `<rect class="dia" x="-7" y="-7" width="14" height="14" transform="rotate(45)" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>` +
        `<circle r="20" fill="transparent"/>` +
        `<text class="glabel" x="${right ? 26 : -26}" y="${lines.length > 1 ? -3 : 5}" text-anchor="${right ? "start" : "end"}" font-size="13" fill="${INK}">` +
        lines.map((l, k) => `<tspan x="${right ? 26 : -26}" dy="${k ? 16 : 0}">${esc(l)}</tspan>`).join("") + `</text></g>`;
    }).join("");
    const q = tm.query || {}, qx = clamp01(q.x != null ? q.x : 0.5) * V, qy = clamp01(q.y != null ? q.y : 0.5) * V;
    const star = `<text x="${qx.toFixed(1)}" y="${qy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="20" fill="${INK}" pointer-events="none" style="font-family:system-ui,sans-serif">✦<title>your query</title></text>`;
    const uid = "kl" + Math.random().toString(36).slice(2, 8);

    const swatches = Array.from({ length: 7 }, (_, i) => `<i style="background:${tint(GREY, (0.05 + (i / 6) * (MAXA - 0.05)).toFixed(3))}"></i>`).join("");
    const topics = clusters.map(c => {
      const col = colorOf(c.id, known), bands = (c.bands || []).map(b => `${esc(b.label || b.regime)} (${b.count || 0})`).join(" · ");
      return `<button type="button" class="kl-topic" data-c="${c.id}" style="--col:${col};--tint:${tint(col, 0.1)}"` + (outer[c.id] ? "" : ` title="This topic has no closed contour of its own on the map"`) + `>` +
        `<span class="row"><span class="kl-dot" style="background:${col}"></span><span class="nm">${esc(c.theme || ("Topic " + (c.id + 1)))}</span><span class="n">${c.count} paper${c.count === 1 ? "" : "s"}</span></span>` +
        (bands ? `<div class="bands">${bands}</div>` : "") + `</button>`;
    }).join("");
    const gapCards = gaps.length
      ? gaps.map((g, gi) => {
        const ex = (g.examples || []).filter(Boolean).slice(0, 3).map(esc).join(" · ");
        return `<div class="kl-gapcard" id="gapcard-${gi}" data-g="${gi}"><div class="gt"><span class="d">◇ GAP</span><span>${esc(g.label || "Between two topics")}</span></div>` +
          (ex ? `<div class="ex">Nearby work: ${ex}</div>` : "") + `</div>`;
      }).join("")
      : `<div class="kl-none">No prominent low-density gap between topics: coverage is fairly uniform.</div>`;

    host.innerHTML = `<div class="kl"><div class="kl-grid">` +
      `<div><h2 class="kl-h">2D Knowledge Landscape</h2>` +
      `<div class="kl-map"><svg viewBox="-2 -2 ${V + 4} ${V + 4}" role="img" aria-label="Knowledge landscape: ${points.length} papers in ${clusters.length} topics">` +
      `<defs><clipPath id="${uid}"><rect x="0" y="0" width="${V}" height="${V}" rx="6"/></clipPath></defs>` +
      `<g clip-path="url(#${uid})"><rect class="kl-bg" width="${V}" height="${V}" fill="${PAPER}"/>` +
      (grid ? `<image href="${fieldURL(f)}" x="0" y="0" width="${V}" height="${V}" preserveAspectRatio="none" pointer-events="none"/>` : "") +
      `<g stroke="${RULE}" stroke-width="1" pointer-events="none">${gridLines}</g>` +
      `<g pointer-events="none">${regions}${lines}${outers}</g>${dots}${gapMarks}${star}</g>` +
      `<rect width="${V}" height="${V}" rx="6" fill="none" stroke="${RULE}" stroke-width="1.5" pointer-events="none"/></svg></div>` +
      `<div class="kl-cbar"><b>Knowledge density</b><span class="kl-steps"><span>low</span>${swatches}<span>high</span></span>` +
      `<span class="kl-steps"><svg width="44" height="12" viewBox="0 0 44 12"><path d="M1 6 q 10.5 -7 21 0 t 21 0" fill="none" stroke="${GREY}" stroke-opacity=".7" stroke-width="1.5"/></svg>line = equal density</span>` +
      `<span class="kl-steps"><svg width="14" height="14" viewBox="-7 -7 14 14"><rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill="${PAPER}" stroke="${INK}" stroke-width="2"/></svg>research gap</span>` +
      `<span class="kl-steps"><span style="color:${INK};font-family:system-ui,sans-serif">✦</span>your query</span></div>` +
      `<div class="kl-info" aria-live="polite"></div></div>` +
      `<div class="kl-side"><h3>Topics · ${clusters.length}</h3><div class="kl-topics">${topics}</div>` +
      `<div class="kl-gaps"><h3>Research gaps</h3>${gapCards}</div></div>` +
      `</div></div>`;

    // ---- interactions ----
    const root = host.querySelector(".kl"), svg = root.querySelector("svg"), info = root.querySelector(".kl-info");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const st = { hc: null, pc: null, hp: null, pp: null, hg: null };
    const $$ = sel => Array.from(root.querySelectorAll(sel));
    const themeOf = cid => { const c = clusters.find(x => x.id === cid); return c ? (c.theme || ("Topic " + (c.id + 1))) : null; };
    let lastC = null;

    function showInfo(i) {
      if (i == null) { info.innerHTML = `<span class="hint">Hover or click a paper to see its details.</span>`; return; }
      const p = points[i], d = (opts.lookup && opts.lookup(p)) || {};
      const url = d.link || d.url || (d.doi ? "https://doi.org/" + String(d.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "");
      const title = esc(d.title || p.title || "Untitled");
      const au = String(d.authors || "").split(/\s*,\s*/).filter(Boolean);
      const authors = au.length > 3 ? au.slice(0, 3).join(", ") + " et al." : au.join(", ");
      const meta = [authors, d.year, d.publisher || d.venue].filter(x => x != null && String(x).trim()).map(esc).join(" · ");
      const th = themeOf(p.cluster);
      info.innerHTML = `<div class="t">${url && /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${title}</a>` : title}</div>` +
        (meta ? `<div class="m">${meta}</div>` : "") +
        `<div class="cl"><span class="kl-dot" style="background:${colorOf(p.cluster, known)}"></span>${th ? esc(th) : "Not in a named topic"}</div>`;
    }

    function apply() {
      const c = st.hc != null ? st.hc : st.pc;
      $$(".kl-reg").forEach(g => {
        const on = c != null && +g.dataset.c === c;
        g.querySelectorAll("path").forEach(p => p.setAttribute("fill-opacity", on ? ".4" : ".08"));
        if (on && c !== lastC && !reduce) { g.classList.remove("pulse"); void g.getBBox(); g.classList.add("pulse"); }
        if (!on) g.classList.remove("pulse");
      });
      lastC = c;
      $$(".kl-outer").forEach(o => { const on = c != null && +o.dataset.c === c; o.setAttribute("stroke-width", on ? "3.5" : "2"); o.setAttribute("stroke-opacity", on ? "1" : ".75"); });
      $$(".kl-topic").forEach(b => { b.classList.toggle("on", c != null && +b.dataset.c === c); b.setAttribute("aria-pressed", st.pc != null && +b.dataset.c === st.pc ? "true" : "false"); });
      const pi = st.hp != null ? st.hp : st.pp;
      $$(".kl-pt").forEach(el => {
        const i = +el.dataset.i, big = i === st.hp || i === st.pp;
        el.classList.toggle("dim", c != null && +el.dataset.c !== c && !big);
        el.setAttribute("r", big ? "7" : "5");
        el.setAttribute("stroke", big ? INK : PAPER);
        el.setAttribute("stroke-width", i === st.pp ? "2.5" : big ? "1.8" : "2");
      });
      if (st.pp != null) { const el = svg.querySelector(`.kl-pt[data-i="${st.pp}"]`); if (el) el.parentNode.appendChild(el); }
      if (st.hp != null) { const el = svg.querySelector(`.kl-pt[data-i="${st.hp}"]`); if (el) el.parentNode.appendChild(el); }
      $$(".kl-gap").forEach(g => g.classList.toggle("on", +g.dataset.g === st.hg));
      $$(".kl-gapcard").forEach(g => g.classList.toggle("on", +g.dataset.g === st.hg));
      showInfo(pi);
    }

    const toMap = e => {
      const r = svg.getBoundingClientRect(), s = (V + 4) / r.width;
      return [((e.clientX - r.left) * s - 2) / V, ((e.clientY - r.top) * s - 2) / V];
    };
    const regionAt = (x, y) => { for (const id in outer) if (inside(outer[id].pts, x, y)) return +id; return null; };

    // Papers
    svg.addEventListener("mouseover", e => { const pt = e.target.closest(".kl-pt"); if (pt) { st.hp = +pt.dataset.i; apply(); } });
    svg.addEventListener("mouseout", e => { const pt = e.target.closest(".kl-pt"); if (pt && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".kl-pt") === pt)) { st.hp = null; apply(); } });
    // Regions (hit-test on each topic's outermost own ring)
    svg.addEventListener("mousemove", e => {
      if (e.target.closest(".kl-pt,.kl-gap")) return;
      const [x, y] = toMap(e), c = regionAt(x, y);
      if (c !== st.hc) { st.hc = c; svg.style.cursor = c != null ? "pointer" : ""; apply(); }
    });
    svg.addEventListener("mouseleave", () => { st.hc = null; st.hp = null; svg.style.cursor = ""; apply(); });
    svg.addEventListener("click", e => {
      const pt = e.target.closest(".kl-pt"), g = e.target.closest(".kl-gap");
      if (pt) { const i = +pt.dataset.i; st.pp = st.pp === i ? null : i; st.hp = null; apply(); return; }
      if (g) { if (opts.onGap) opts.onGap(+g.dataset.g); return; }
      const [x, y] = toMap(e), c = regionAt(x, y);
      if (c != null) { st.pc = st.pc === c ? null : c; st.pp = null; }
      else { st.pc = null; st.pp = null; }
      st.hc = c; apply();
    });
    // Gaps (map marker <-> card)
    $$(".kl-gap").forEach(g => {
      const i = +g.dataset.g;
      g.addEventListener("mouseenter", () => { st.hg = i; apply(); });
      g.addEventListener("mouseleave", () => { st.hg = null; apply(); });
      g.addEventListener("focus", () => { st.hg = i; apply(); });
      g.addEventListener("blur", () => { st.hg = null; apply(); });
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (opts.onGap) opts.onGap(i); } });
    });
    $$(".kl-gapcard").forEach(c => {
      const i = +c.dataset.g;
      c.addEventListener("mouseenter", () => { st.hg = i; apply(); });
      c.addEventListener("mouseleave", () => { st.hg = null; apply(); });
    });
    // Topics (focus = hover; click pins)
    $$(".kl-topic").forEach(b => {
      const c = +b.dataset.c;
      b.addEventListener("mouseenter", () => { st.hc = c; apply(); });
      b.addEventListener("mouseleave", () => { st.hc = null; apply(); });
      b.addEventListener("focus", () => { st.hc = c; apply(); });
      b.addEventListener("blur", () => { st.hc = null; apply(); });
      b.addEventListener("click", () => { st.pc = st.pc === c ? null : c; apply(); });
    });
    // Esc unpins everything; the handler goes away with the host's contents.
    if (host.__klKey) document.removeEventListener("keydown", host.__klKey);
    host.__klKey = e => { if (e.key === "Escape" && root.isConnected && (st.pc != null || st.pp != null)) { st.pc = null; st.pp = null; apply(); } };
    document.addEventListener("keydown", host.__klKey);
    apply();
  }

  function flashGap(i) {
    const el = document.getElementById("gapcard-" + i);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  window.KnowledgeLandscape = { render, flashGap, contours, COLORS };
})();
