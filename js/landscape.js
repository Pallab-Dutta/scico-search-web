/* Knowledge Landscape: the redesigned Topic Map (developer accounts first; results.html decides who sees it).
   Same topic_map data as the Topic Map (points, clusters, gaps, grid, peaks, query), drawn in the owner's
   reference style (MAZE/hypothesis_landscape_minimal_cutive_static.svg, in the page's own font; as in the video's
   DensityMap.tsx): grey density on paper, grey iso-lines computed here by marching squares on the bilinear
   field, so the lines sit exactly on the shading. Each closed ring belongs to the one cluster whose peak it
   holds (rings holding several peaks belong to none), which links topics and regions both ways.
   Plain JS + inline SVG, no dependencies.

   window.KnowledgeLandscape.render(host, tm, {lookup(point) -> paper|null, onGap(i)}) */
(function () {
  const PAPER = "#fbf7ef", RULE = "#e3e2de", INK = "#0b0b0b", GREY = "#52514e", UNCL = "#a3a29b";
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#7E6BA8", "#C98A3E", "#4C9AA6"];
  const NAMERS = [["", "Auto (Qwen first)"], ["qwen/qwen3.8-27b", "qwen3.8-27b"], ["openai/gpt-oss-20b", "gpt-oss-20b"], ["openai/gpt-oss-120b", "gpt-oss-120b"]];
  const LEVELS = 6, MAXA = 0.62, N = 200, V = 600;          // V: the map's SVG units (square)
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function injectCSS() {
    if (document.getElementById("kl-css")) return;
    const s = document.createElement("style");
    s.id = "kl-css";
    s.textContent = `
.kl{color:${INK};--kl-paper:${PAPER};--kl-rule:${RULE};--kl-grey:${GREY}}
.kl *{box-sizing:border-box}
.kl-h{font-size:1.15rem;margin:16px 0 14px;text-align:center}
.kl-mode{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 0;margin:-6px 0 12px;font-size:.78rem;color:${GREY}}
.kl-mode select{font:inherit;margin-left:8px;padding:2px 4px;border:1.5px solid ${RULE};border-radius:6px;background:#fff}
.kl-mode span{margin-right:8px}
.kl-mode button{font:inherit;color:${GREY};background:#fff;border:1.5px solid ${RULE};padding:3px 12px;cursor:pointer}
.kl-mode button:first-of-type{border-radius:6px 0 0 6px}.kl-mode button:last-of-type{border-radius:0 6px 6px 0;border-left:0}
.kl-mode button[aria-pressed="true"]{background:${INK};border-color:${INK};color:#fff}
.kl-mode .kl-site{margin-left:14px}.kl-mode .kl-site b{color:${INK};font-weight:600}
.kl-mode button.kl-apply{margin-left:10px;border-radius:6px;border:1.5px solid ${INK};color:${INK};font-weight:600}
.kl-mode button.kl-apply:hover{background:${INK};color:#fff}
/* Owner's sketch (v2): legend box | map + topic/gap rows | funnel + detail panel; hovered paper below;
   a clicked group's papers listed under it all. Nothing scrolls inside; nothing shows until it is needed. */
/* Wide screens: the landscape uses up to 1160px of the page (centred on the results column, never past the main
   area: 100cqi = the .main container's width, set in results.html), so the topic/gap rows have room. */
@media(min-width:761px){.kl{width:min(1160px,calc(100cqi - 56px));max-width:none;position:relative;left:50%;transform:translateX(-50%)}}
.kl-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1.2fr) 28px minmax(0,1.05fr);
  grid-template-areas:"legend . . ." "map list conn panel" "paper paper . .";column-gap:0;row-gap:12px;align-items:start}
.kl-map{grid-area:map;position:relative;aspect-ratio:1/1;background:${PAPER};border-radius:8px;width:calc(100% - 14px)}
.kl-map svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:manipulation}
.kl-pt{cursor:pointer;transition:opacity .15s}
.kl-reg path{transition:fill-opacity .2s}
.kl-outer{transition:stroke-width .2s,stroke-opacity .2s}
.kl-gap{cursor:pointer}
.kl-gap .ring,.kl-gap .dia{transform-box:fill-box;transform-origin:center;transition:transform .15s}
.kl-gap:hover .dia{transform:rotate(45deg) scale(1.2)}
.kl-gap.on .ring{animation:klring 1s ease-in-out infinite}
@keyframes klring{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
.kl-gap.on .dia{fill:${INK}}
.kl-q{cursor:pointer}
.kl-q .pinb{transition:transform .15s}
.kl-q.on .pinb{transform:scale(1.3)}
/* The rows are centred on the MAP's centre (placeList in render, via margin-top): a list taller than the map rises
   beside the legend (negative margin, which also keeps the map's row from growing), never above the legend's top. */
.kl-list{grid-area:list;display:flex;flex-direction:column;gap:6px;align-self:start}
.kl-row{flex:0 0 auto;border:1.5px solid ${RULE};border-radius:8px;background:#fff;transition:border-color .15s,background .15s,transform .15s}
.kl-row:hover,.kl-row.on{transform:scale(1.02)}
.kl-row>button{display:flex;align-items:center;gap:9px;width:100%;font:inherit;color:inherit;background:transparent;border:0;padding:8px 10px;cursor:pointer;text-align:left;border-radius:8px}
.kl-row>button:focus-visible{outline:2px solid ${INK};outline-offset:1px}
.kl-row .nm{flex:1;min-width:0;font-size:.9rem;line-height:1.25}
.kl-row .chev{font-family:'Material Symbols Outlined';font-size:20px;color:${GREY};transition:transform .2s;flex:0 0 auto}
.kl-row.on{border-color:var(--col);background:var(--tint)}
.kl-row.on .chev{transform:rotate(-90deg)}
.kl-row.flash{animation:klflash 1.5s ease}
@keyframes klflash{0%,100%{box-shadow:none}22%{box-shadow:0 0 0 3px ${INK}}}
.kl-ring{width:14px;height:14px;border-radius:50%;flex:0 0 14px;border:2.5px solid var(--col);background:var(--tint)}
.kl-body{display:none;padding:2px 12px 10px;font-size:.84rem;line-height:1.45}
.kl-body h4{display:none}
.kl-none{font-size:.8rem;color:${GREY};padding:4px 2px}
.kl-paper{grid-area:paper;border:1.5px solid ${RULE};border-radius:8px;background:${PAPER};padding:9px 12px;font-size:.82rem;line-height:1.4;min-height:78px;visibility:hidden}
.kl-paper.show{visibility:visible}
.kl-paper .t{font-size:.88rem;color:${INK}}
.kl-paper .t a,.kl-panel a,.kl-body a,.kl-plist a{color:${INK};text-decoration:underline;text-decoration-color:${RULE};text-underline-offset:3px}
.kl-paper .t a:hover,.kl-panel a:hover,.kl-body a:hover,.kl-plist a:hover{text-decoration-color:${INK}}
.kl-paper .m,.kl-plist .m{color:${GREY};margin-top:2px}
.kl-cl{display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;margin-top:3px;color:${GREY}}
.kl-cl>span{display:inline-flex;align-items:center;gap:5px}
.kl-dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px;display:inline-block}
.kl-conn{grid-area:conn;position:relative;align-self:stretch}
.kl-conn svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.kl-side{grid-area:panel;min-height:0}
.kl-panel{border:1.5px solid ${INK};border-radius:8px;background:#fff;padding:12px 14px;font-size:.84rem;line-height:1.45;visibility:hidden}
.kl-panel.show{visibility:visible}
.kl-panel h4,.kl-body h4{font-size:1rem;margin:0 0 6px;padding-bottom:6px;border-bottom:1.5px solid ${INK};line-height:1.3}
.kl-panel .kl-sub,.kl-body .kl-sub{color:${GREY};margin:0 0 8px}
.kl-panel .kl-lab,.kl-body .kl-lab{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:${GREY};margin:10px 0 4px}
.kl-grp{display:flex;align-items:baseline;gap:8px;width:100%;font:inherit;color:inherit;text-align:left;background:transparent;border:0;border-bottom:1px dashed ${RULE};padding:5px 4px;cursor:pointer;border-radius:4px;transition:background .15s,transform .15s}
.kl-grp:hover,.kl-grp.on{background:#f3efe6;transform:scale(1.02)}
.kl-grp.on{box-shadow:inset 3px 0 0 var(--col)}
.kl-grp .nm{flex:1}
.kl-grp .n{font-size:.75rem;color:${GREY};white-space:nowrap}
.kl-grp[disabled]{cursor:default;opacity:.55}
.kl-legend{grid-area:legend;display:flex;align-items:stretch;border:1.5px solid ${RULE};border-radius:8px;background:#fff;font-size:.8rem;color:${GREY};width:calc(100% - 14px)}   /* as wide as the map */
.kl-legend>div{padding:8px 12px}
.kl-legend .den{flex:1.3;border-right:1.5px solid ${RULE}}
.kl-legend .qry{flex:1;min-width:0;cursor:default;border-radius:0 7px 7px 0;transition:background .15s}
.kl-legend .qry.on{background:#f1ece1;box-shadow:inset 0 0 0 1.5px ${INK}}
.kl-legend b{display:block;font-weight:600;color:${INK};font-size:.82rem;margin-bottom:5px}
.kl-steps{display:flex;align-items:center;gap:4px}
.kl-steps i{display:inline-block;flex:1;height:11px;border:1px solid ${RULE}}
.kl-legend .ends{display:flex;justify-content:space-between;margin-top:2px}
.kl-legend .q{color:${INK};font-style:italic}
.kl-plist{margin-top:22px;border-top:1.5px solid ${RULE};padding-top:12px}
.kl-plist h3{font-size:1rem;margin:0 0 8px;display:flex;align-items:center;gap:8px}
.kl-plist h3 .x{margin-left:auto;font:inherit;font-size:.8rem;color:${GREY};background:none;border:1px solid ${RULE};border-radius:6px;padding:2px 9px;cursor:pointer}
.kl-plist .it{padding:9px 2px;border-bottom:1px dashed ${RULE};font-size:.85rem;line-height:1.4}
.kl-plist .it .t{font-size:.92rem}
.kl-plist .it.on{background:#f6f3ec}
@media(max-width:760px){
  .kl-grid{grid-template-columns:1fr;grid-template-areas:"legend" "map" "paper" "list";row-gap:12px}
  .kl-map{width:100%}.kl-legend{width:100%}
  .kl-conn,.kl-side{display:none}
  .kl-paper{display:none}.kl-paper.show{display:block}
  .kl-row:hover,.kl-row.on{transform:none}
  .kl-list{margin-top:0!important}
  .kl-row.on .kl-body{display:block}.kl-row.on .chev{transform:rotate(180deg)}
}
@media(prefers-reduced-motion:reduce){.kl-gap.on .ring,.kl-row.flash{animation:none}}`;
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
    // Developer toggle: "new" = topics by contour + sub-areas as the topic's smaller hills (backend subareas);
    // "old" = the Topic Map's own mechanism (topic = nearest density peak; sub-areas = the backend's core /
    // emerging / frontier bands). The UI is the same either way.
    // siteMode: what everyone without the toggle sees (admins set it with "Use for everyone").
    const siteMode = opts.siteMode === "new" ? "new" : "old";
    let mode = opts.mode;
    if (!mode && opts.devToggle) { try { mode = localStorage.getItem("eratost_kl_mode"); } catch (_) {} }
    mode = mode === "new" || mode === "old" ? mode : siteMode;
    const OLD = mode === "old";
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

    // ---- topic membership ----
    // A topic's papers are those INSIDE its outermost own contour. (A topic with no closed contour of its own
    // keeps the backend's assignment.) Every other paper gets a share of each topic: its likelihood under that
    // topic's papers (Gaussian kernel, the backend's bandwidth 0.09), normalised; its colour mixes the topic
    // colours by those shares.
    // inC: the topic whose contour a paper is inside (where it sits on the map). It sets the dot colours and the
    // likelihood shares in both modes; in "new" mode it is also the paper's topic, in "old" the topic is its
    // nearest peak (the Topic Map's rule), so only membership changes between the modes, not the picture.
    const H = 0.09, inC = points.map(p => {
      for (const id in outer) if (inside(outer[id].pts, p.x, p.y)) return +id;
      return outer[p.cluster] || !known.has(p.cluster) ? null : p.cluster;
    });
    const home = OLD ? points.map(p => (known.has(p.cluster) ? p.cluster : null)) : inC;
    const members = {};
    clusters.forEach(c => { members[c.id] = []; });
    points.forEach((p, i) => { if (inC[i] != null) members[inC[i]].push(p); });
    const share = points.map((p, i) => {
      if (inC[i] != null) return { [inC[i]]: 1 };
      const w = {};
      let tot = 0;
      clusters.forEach(c => {
        let v = 0;
        members[c.id].forEach(m => { v += Math.exp(-((m.x - p.x) ** 2 + (m.y - p.y) ** 2) / (2 * H * H)); });
        w[c.id] = v; tot += v;
      });
      if (tot < 1e-9) {                                   // far from every topic's papers: by distance to the peaks
        tot = 0;
        clusters.forEach(c => { const k = peakOf[c.id]; const v = k ? 1 / (1e-4 + (k[0] - p.x) ** 2 + (k[1] - p.y) ** 2) : 0; w[c.id] = v; tot += v; });
      }
      if (!(tot > 0)) return {};
      for (const k in w) w[k] /= tot;
      return w;
    });
    const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const mixColour = w => {
      const ks = Object.keys(w).filter(k => w[k] > 0);
      if (!ks.length) return UNCL;
      const m = [0, 0, 0];
      ks.forEach(k => rgb(colorOf(+k, known)).forEach((v, j) => { m[j] += v * w[k]; }));
      return "#" + m.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
    };
    // affil: the topic a paper counts for. Inside a contour: that topic. Outside every contour: the backend's topic
    // for it (nearest topic peak), the same one its sub-area was built in, so topic and sub-area always agree.
    // (Its colour still mixes the topics by likelihood share.)
    const nearby = {};                                     // outside papers whose largest share is this topic
    clusters.forEach(c => { nearby[c.id] = 0; });
    const affil = share.map((w, i) => {
      if (home[i] != null) return home[i];
      const top = known.has(points[i].cluster) ? String(points[i].cluster) : Object.keys(w).sort((a, b) => w[b] - w[a])[0];
      if (top == null || nearby[top] == null) return null;
      nearby[top]++;
      return +top;
    });

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
      const fill = inC[i] != null ? colorOf(home[i] != null ? home[i] : inC[i], known) : mixColour(share[i]);
      return `<circle class="kl-pt" data-i="${i}" data-c="${home[i] != null ? home[i] : -1}" cx="${(clamp01(p.x) * V).toFixed(1)}" cy="${(clamp01(p.y) * V).toFixed(1)}" r="5" fill="${fill}" fill-opacity="${op}" stroke="${PAPER}" stroke-width="2"><title>${esc(p.title)}</title></circle>`;
    }).join("");
    const gapMarks = gaps.map((g, gi) => {
      const x = clamp01(g.x) * V, y = clamp01(g.y) * V, lab = String(g.label || "Research gap");
      return `<g class="kl-gap" data-g="${gi}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc("Research gap: " + lab)}">` +
        `<circle class="ring" r="17" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 7"/>` +
        `<rect class="dia" x="-7" y="-7" width="14" height="14" transform="rotate(45)" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>` +
        `<circle r="20" fill="transparent"/>` +
        `<title>${esc(lab)}</title></g>`;
    }).join("");
    const q = tm.query || {}, qx = clamp01(q.x != null ? q.x : 0.5) * V, qy = clamp01(q.y != null ? q.y : 0.5) * V;
    const PIN = "M0,0 C-1.5,-5 -9,-10 -9,-18 A9,9 0 1 1 9,-18 C9,-10 1.5,-5 0,0 Z";
    const star = `<g class="kl-q" transform="translate(${qx.toFixed(1)} ${qy.toFixed(1)})"><g class="pinb"><path d="${PIN}" fill="${INK}" stroke="${PAPER}" stroke-width="1.5"/>` +
      `<circle cy="-18" r="3.6" fill="${PAPER}"/></g><title>your query</title></g>`;
    const uid = "kl" + Math.random().toString(36).slice(2, 8);

    const swatches = Array.from({ length: 7 }, (_, i) => `<i style="background:${tint(GREY, (0.05 + (i / 6) * (MAXA - 0.05)).toFixed(3))}"></i>`).join("");
    const themeOf = cid => { const c = clusters.find(x => x.id === cid); return c ? (c.theme || ("Topic " + (c.id + 1))) : "a topic"; };
    const GAPC = GREY;                                       // gaps use grey where topics use their colour
    // Sub-areas come from the backend (engine._sub_areas): each topic's smaller density hills, every paper joined
    // to the hill it shares the most likelihood with, named by the LLM. A paper's "sub" is its sub-area's index in
    // its topic ("cluster"); a topic with one coherent group (or an older map) has none.
    // In "old" mode they are the backend's density bands (engine._threshold_bands): each paper's density among
    // ALL papers (Gaussian, bandwidth 0.09, relative to the densest paper anywhere): core >= 0.60, emerging
    // >= 0.30, else frontier, named by the LLM. subDefs / subOf hide which mechanism is in use.
    const REGNAME = { core: "most-studied", emerging: "emerging", frontier: "least-studied" };
    const pden = OLD ? points.map(p => points.reduce((s, q) => s + Math.exp(-((q.x - p.x) ** 2 + (q.y - p.y) ** 2) / (2 * H * H)), 0)) : [];
    const pmax = Math.max(1e-12, ...pden);
    const regime = i => (pden[i] / pmax >= 0.6 ? "core" : pden[i] / pmax >= 0.3 ? "emerging" : "frontier");
    const subDefs = c => OLD ? (c.bands || []).map(b => ({ label: b.label || b.regime, maturity: REGNAME[b.regime] || "", regime: b.regime }))
                             : (c.subareas || []).map(sa => ({ label: sa.label, maturity: sa.maturity || "" }));
    const subOf = i => {
      const p = points[i];
      if (!OLD) return p.sub != null ? p.sub : null;
      const c = clusters.find(x => x.id === p.cluster), j = c ? (c.bands || []).findIndex(b => b.regime === regime(i)) : -1;
      return j >= 0 ? j : null;
    };
    const subName = i => { const p = points[i], c = clusters.find(x => x.id === p.cluster), j = subOf(i), sa = c && j != null && subDefs(c)[j]; return sa ? sa.label : null; };
    const byScore = idx => idx.slice().sort((a, b) => (points[b].score || 0) - (points[a].score || 0));
    const topicIdx = cid => byScore(points.map((_, i) => i).filter(i => affil[i] === cid));   // inside + just outside
    const gapIdx = gi => byScore((gaps[gi].examples || []).filter(t => idxByTitle.has(t)).map(t => idxByTitle.get(t)));
    const idxByTitle = new Map(points.map((p, i) => [p.title || "", i]));
    // Groups of papers a viewer can highlight (hover) or pin (click): a topic, one of its sub-areas, a gap's nearby work.
    const groups = {};
    clusters.forEach(c => {
      groups["t:" + c.id] = { key: "t:" + c.id, row: "t:" + c.id, col: colorOf(c.id, known), label: themeOf(c.id), idx: null };
      subDefs(c).forEach((sa, si) => {
        groups[`b:${c.id}:${si}`] = { key: `b:${c.id}:${si}`, row: "t:" + c.id, col: colorOf(c.id, known), label: `${themeOf(c.id)} · ${sa.label}`, name: sa.label, maturity: sa.maturity || "", cid: c.id, sub: si, idx: null };
      });
    });
    gaps.forEach((g, gi) => { groups["g:" + gi] = { key: "g:" + gi, row: "g:" + gi, col: GAPC, label: `Near the gap: ${g.label || "research gap"}`, idx: null }; });
    const groupIdx = k => {
      const G = groups[k];
      if (!G) return [];
      if (!G.idx) G.idx = k[0] === "t" ? topicIdx(+k.slice(2)) : k[0] === "g" ? gapIdx(+k.slice(2)) : byScore(points.map((_, i) => i).filter(i => points[i].cluster === G.cid && subOf(i) === G.sub));
      return G.idx;
    };
    // One row per topic, then one per gap ("t:<id>" / "g:<i>").
    const items = clusters.map(c => ({ key: "t:" + c.id, kind: "t", id: c.id, col: colorOf(c.id, known), name: themeOf(c.id) }))
      .concat(gaps.map((g, gi) => ({ key: "g:" + gi, kind: "g", id: gi, col: GAPC, name: String(g.label || "Research gap") })));
    const rowsHTML = items.map(it =>
      `<div class="kl-row" data-k="${it.key}"${it.kind === "g" ? ` id="gapcard-${it.id}"` : ""} style="--col:${it.col};--tint:${tint(it.col, it.kind === "g" ? 0.1 : 0.12)}">` +
      `<button type="button" aria-expanded="false">` +
      (it.kind === "t" ? `<span class="kl-ring"></span>`
        : `<svg width="14" height="14" viewBox="-7 -7 14 14" style="flex:0 0 14px"><rect x="-4.2" y="-4.2" width="8.4" height="8.4" transform="rotate(45)" fill="${PAPER}" stroke="${INK}" stroke-width="2"/></svg>`) +
      `<span class="nm">${esc(it.kind === "g" ? "Gap: " + it.name : it.name)}</span><span class="chev" aria-hidden="true">expand_more</span></button>` +
      `<div class="kl-body"></div></div>`).join("");
    const qText = String(opts.queryText || "").trim();

    const toggle = opts.devToggle ? `<div class="kl-mode" role="group" aria-label="How topics and sub-areas are found (developer)"><span>Sub-areas</span>` +
      `<button type="button" data-m="new" aria-pressed="${!OLD}" title="Topics by contour; sub-areas = each topic's smaller hills">New</button>` +
      `<button type="button" data-m="old" aria-pressed="${OLD}" title="As the Topic Map: topics by nearest peak; sub-areas = core / emerging / frontier density bands">Old</button>` +
      `<span class="kl-site">Everyone sees: <b>${siteMode === "new" ? "New" : "Old"}</b></span>` +
      (mode !== siteMode && opts.onSiteMode ? `<button type="button" class="kl-apply">Use ${OLD ? "Old" : "New"} for everyone</button>` : "") +
      // Compare naming models on this same map: re-run only the names with the chosen model.
      (opts.onRename ? `<span class="kl-site">Names by <b>${esc(tm.named_by || "unknown")}</b>` + (() => {
        const ni = tm.naming_info || {};   // how the names were made: prompt version, abstracts used, rounds
        if (!ni.prompt) return " · older naming (before 2026-11-26)";
        const kw = (ni.keyword_topics || []).length;
        return ` · prompt ${esc(ni.prompt)} · ${ni.abstracts || 0} abstracts` + (ni.rounds > 1 ? ` · ${ni.rounds} rounds` : "") +
          (kw ? ` · <span style="color:#a23f3f">${kw} topic(s) on keyword names</span>` : "") +
          (ni.at ? ` · ${new Date(ni.at * 1000).toLocaleString()}` : "");
      })() + `</span>` +
        `<select class="kl-namer" aria-label="Model for naming">` + NAMERS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("") + `</select>` +
        `<button type="button" class="kl-apply kl-rename">Rename</button>` : "") + `</div>` : "";
    host.innerHTML = `<div class="kl"><h2 class="kl-h">Knowledge Landscape</h2>${toggle}<div class="kl-grid">` +
      `<div class="kl-legend"><div class="den"><b>Knowledge density</b><span class="kl-steps">${swatches}</span><div class="ends"><span>low</span><span>high</span></div></div>` +
      `<div class="qry"><b style="display:flex;align-items:center;gap:6px"><svg width="11" height="15" viewBox="-10 -28 20 29"><path d="${PIN}" fill="${INK}"/><circle cy="-18" r="3.6" fill="${PAPER}"/></svg>your query</b>` +
      `<div class="q">${qText ? esc(qText) : "the pin on the map"}</div></div></div>` +
      `<div class="kl-map"><svg viewBox="-2 -2 ${V + 4} ${V + 4}" role="img" aria-label="Knowledge landscape: ${points.length} papers in ${clusters.length} topics">` +
      `<defs><clipPath id="${uid}"><rect x="0" y="0" width="${V}" height="${V}" rx="6"/></clipPath></defs>` +
      `<g clip-path="url(#${uid})"><rect class="kl-bg" width="${V}" height="${V}" fill="${PAPER}"/>` +
      (grid ? `<image href="${fieldURL(f)}" x="0" y="0" width="${V}" height="${V}" preserveAspectRatio="none" pointer-events="none"/>` : "") +
      `<g stroke="${RULE}" stroke-width="1" pointer-events="none">${gridLines}</g>` +
      `<g pointer-events="none">${regions}${lines}${outers}</g>${dots}${gapMarks}${star}</g>` +
      `<rect width="${V}" height="${V}" rx="6" fill="none" stroke="${RULE}" stroke-width="1.5" pointer-events="none"/></svg></div>` +
      `<div class="kl-list">${rowsHTML}` + (gaps.length ? "" : `<div class="kl-none">No prominent gap between topics: coverage is fairly uniform.</div>`) + `</div>` +
      `<div class="kl-conn"><svg preserveAspectRatio="none"><path/></svg></div>` +
      `<div class="kl-side"><div class="kl-panel"></div></div>` +
      `<div class="kl-paper" aria-live="polite"></div>` +
      `</div><div class="kl-plist" hidden></div></div>`;

    // ---- interactions ----
    const root = host.querySelector(".kl"), svg = root.querySelector(".kl-map svg"), paperBox = root.querySelector(".kl-paper");
    const panel = root.querySelector(".kl-panel"), conn = root.querySelector(".kl-conn"), connPath = conn.querySelector("path");
    const plist = root.querySelector(".kl-plist"), qBox = root.querySelector(".kl-legend .qry"), qPin = svg.querySelector(".kl-q");
    const mobile = () => window.matchMedia && window.matchMedia("(max-width:760px)").matches;
    // hk / pk: hovered / pinned row ("t:<id>" or "g:<i>"); hg / pg: hovered / pinned paper group (a topic,
    // a sub-area "b:<topic>:<band>", or a gap's nearby work); hp / pp: hovered / pinned paper.
    const st = { hk: null, pk: null, hg: null, pg: null, hp: null, pp: null };
    const $$ = sel => Array.from(root.querySelectorAll(sel));
    const active = () => (st.hk != null ? st.hk : st.pk);
    const parse = k => (k == null ? [null, null] : [k[0], +k.slice(2)]);

    function metaOf(i) {
      const p = points[i], d = (opts.lookup && opts.lookup(p)) || {};
      const url = d.link || d.url || (d.doi ? "https://doi.org/" + String(d.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "");
      const title = esc(d.title || p.title || "Untitled");
      const raw = String(d.authors || ""), au = raw.split(/\s*,\s*/).filter(x => x && !/^(\.\.\.|…|et al\.?)$/i.test(x));
      const more = au.length > 3 || /\.\.\.|…|et al/i.test(raw);           // the stored list may already be shortened
      const authors = au.slice(0, 3).join(", ") + (more && au.length ? " et al." : "");
      const meta = [authors, d.year, d.publisher || d.venue].filter(x => x != null && String(x).trim()).map(esc).join(" · ");
      const w = share[i], parts = Object.keys(w).filter(k => w[k] >= 0.1).sort((a, b) => w[b] - w[a]);
      const sn = subName(i) ? " · " + esc(subName(i)) : "";
      const sharesTxt = parts.length > 1 ? `<span>shares: ` + parts.map(k => `<span class="kl-dot" style="background:${colorOf(+k, known)}"></span> ${Math.round(100 * w[k])}%`).join(" · ") + `</span>` : "";
      const where = home[i] != null
        ? `<div class="kl-cl"><span><span class="kl-dot" style="background:${colorOf(home[i], known)}"></span>${esc(themeOf(home[i]))}${sn}</span>` +
          (OLD && inC[i] == null ? `<span>outside the contours</span>${sharesTxt}` : "") + `</div>`
        : affil[i] != null
          ? `<div class="kl-cl"><span>Outside the contour of</span><span><span class="kl-dot" style="background:${colorOf(affil[i], known)}"></span>${esc(themeOf(affil[i]))}${sn}</span>${sharesTxt}</div>`
          : `<div class="kl-cl"><span><span class="kl-dot" style="background:${UNCL}"></span>Not in a named topic</span></div>`;
      return `<div class="t">${url && /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${title}</a>` : title}</div>` +
        (meta ? `<div class="m">${meta}</div>` : "") + where;
    }
    const grpBtn = (k, name) => {
      const n = groupIdx(k).length, G = groups[k];
      return `<button type="button" class="kl-grp" data-g="${k}" style="--col:${G.col}"${n ? "" : " disabled"}><span class="nm">${esc(name)}</span><span class="n">${n} paper${n === 1 ? "" : "s"}</span></button>`;
    };
    function detailHTML(k) {
      const [kind, id] = parse(k);
      if (kind === "t") {
        const c = clusters.find(x => x.id === id), n = members[id].length, nb = nearby[id];
        const subs = subDefs(c).map((sa, si) => grpBtn(`b:${id}:${si}`, sa.label + (sa.maturity ? ` (${sa.maturity})` : ""))).join("");
        return `<h4>${esc(themeOf(id))}</h4><div class="kl-sub">${n} paper${n === 1 ? "" : "s"}${OLD ? " (nearest topic peak)" : " inside its contour"}${nb ? ` · ${nb} nearby` : ""}` +
          (outer[id] ? "" : " · no closed contour of its own") + `</div>` +
          (subs ? `<div class="kl-lab">Sub-areas</div>${subs}` : (!OLD && "subareas" in c ? `<div class="kl-sub" style="margin-top:8px">One coherent group: no distinct sub-areas.</div>` : ""));
      }
      if (kind === "g") {
        const g = gaps[id], bt = (g.between || []).filter(x => known.has(x));
        return `<h4>${esc(g.label || "Research gap")}</h4>` +
          (bt.length === 2 ? `<div class="kl-sub">A low-density valley between <span class="kl-dot" style="background:${colorOf(bt[0], known)}"></span> ${esc(themeOf(bt[0]))} and <span class="kl-dot" style="background:${colorOf(bt[1], known)}"></span> ${esc(themeOf(bt[1]))}.</div>` : `<div class="kl-sub">A low-density valley between studied topics.</div>`) +
          (groupIdx(k).length ? `<div class="kl-lab">Nearby work</div>${grpBtn(k, "Papers nearest the gap")}` : "");
      }
      return "";
    }
    // The funnel from the extended row to the panel, filled with the row's colour (grey for a gap).
    function drawConn(k) {
      const row = k && root.querySelector(`.kl-row[data-k="${k}"]`);
      if (!row || mobile()) { connPath.setAttribute("d", ""); return; }
      const cb = conn.getBoundingClientRect(), rb = row.getBoundingClientRect(), pb = panel.getBoundingClientRect();
      const W = cb.width, H = cb.height, y0 = rb.top - cb.top + 2, y1 = rb.bottom - cb.top - 2, p0 = pb.top - cb.top + 2, p1 = pb.bottom - cb.top - 2;
      conn.querySelector("svg").setAttribute("viewBox", `0 0 ${W} ${H}`);
      connPath.setAttribute("d", `M0,${y0} C${W * 0.6},${y0} ${W * 0.4},${p0} ${W},${p0} L${W},${p1} C${W * 0.4},${p1} ${W * 0.6},${y1} 0,${y1} Z`);
      connPath.setAttribute("fill", tint(parse(k)[0] === "g" ? GAPC : row.style.getPropertyValue("--col").trim(), 0.28));
    }
    function listHTML(k) {                                  // a pinned group's papers, under the whole UI
      const idx = groupIdx(k), G = groups[k];
      return `<h3><span class="kl-dot" style="background:${G.col}"></span>${esc(G.label)} · ${idx.length} paper${idx.length === 1 ? "" : "s"}` +
        `<button type="button" class="x">Clear</button></h3>` + idx.map(i => `<div class="it" data-i="${i}">${metaOf(i)}</div>`).join("");
    }

    let shownKey, shownList;
    function apply() {
      const k = active(), [kind, id] = parse(k), c = kind === "t" ? id : null, g = kind === "g" ? id : null;
      const gk = st.hg != null ? st.hg : st.pg, gset = gk ? new Set(groupIdx(gk)) : null;
      $$(".kl-reg").forEach(r => {
        const on = c != null && +r.dataset.c === c;
        r.querySelectorAll("path").forEach(p => p.setAttribute("fill-opacity", on ? (gk && gk[0] === "b" ? ".22" : ".4") : ".08"));
      });
      $$(".kl-outer").forEach(o => { const on = c != null && +o.dataset.c === c; o.setAttribute("stroke-width", on ? "3.5" : "2"); o.setAttribute("stroke-opacity", on ? "1" : ".75"); });
      $$(".kl-gap").forEach(m => m.classList.toggle("on", g != null && +m.dataset.g === g));
      $$(".kl-row").forEach(r => { const on = r.dataset.k === k; r.classList.toggle("on", on); r.querySelector("button").setAttribute("aria-expanded", on ? "true" : "false"); });
      const pi = st.hp != null ? st.hp : st.pp;
      $$(".kl-pt").forEach(el => {
        const i = +el.dataset.i, big = i === st.hp || i === st.pp;
        let op = "";
        if (gset && gk[0] !== "t") op = gset.has(i) || big ? "" : "0.22";          // a sub-area or a gap's papers
        else if (c != null && !big && +el.dataset.c !== c) op = (0.3 + 0.7 * (+el.dataset.c < 0 ? (share[i][c] || 0) : 0)).toFixed(2);
        el.style.opacity = op;
        const ring = gset && gk[0] !== "t" && gset.has(i);
        el.setAttribute("r", big ? "7" : ring ? "6" : "5");
        el.setAttribute("stroke", big || ring ? INK : PAPER);
        el.setAttribute("stroke-width", i === st.pp ? "2.5" : big ? "1.8" : ring ? "1.4" : "2");
      });
      [st.pp, st.hp].forEach(x => { if (x != null) { const el = svg.querySelector(`.kl-pt[data-i="${x}"]`); if (el) el.parentNode.appendChild(el); } });
      // The hovered (or pinned) paper, only while there is one.
      paperBox.classList.toggle("show", pi != null);
      paperBox.innerHTML = pi == null ? "" : metaOf(pi);
      // The detail panel, only while a row is extended.
      if (k !== shownKey) {
        shownKey = k;
        $$(".kl-body").forEach(b => { b.innerHTML = ""; });
        panel.classList.toggle("show", k != null);
        panel.innerHTML = "";
        if (k != null) {
          const html = detailHTML(k), row = root.querySelector(`.kl-row[data-k="${k}"]`);
          if (mobile()) { if (row) row.querySelector(".kl-body").innerHTML = html; }
          else { panel.style.borderColor = kind === "g" ? INK : row.style.getPropertyValue("--col"); panel.innerHTML = html; }
        }
      }
      $$(".kl-grp").forEach(b => b.classList.toggle("on", b.dataset.g === gk));
      drawConn(k);
      // A pinned group (a clicked topic, sub-area or gap) lists its papers below.
      const lk = st.pg || (st.pk && groups[st.pk] ? st.pk : null);
      if (lk !== shownList) { shownList = lk; plist.hidden = !lk || !groupIdx(lk).length; plist.innerHTML = plist.hidden ? "" : listHTML(lk); }
      plist.querySelectorAll(".it").forEach(e => e.classList.toggle("on", +e.dataset.i === pi));
    }

    // Rows centred on the map's centre (desktop); a list taller than the map may rise beside the legend.
    const listEl = root.querySelector(".kl-list"), mapEl = root.querySelector(".kl-map"), legEl = root.querySelector(".kl-legend");
    function placeList() {
      if (mobile()) { listEl.style.marginTop = ""; return; }
      const rise = mapEl.getBoundingClientRect().top - legEl.getBoundingClientRect().top;   // room beside the legend
      listEl.style.marginTop = Math.round(Math.max(-rise, (mapEl.offsetHeight - listEl.offsetHeight) / 2)) + "px";
    }
    placeList();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected) { placeList(); drawConn(active()); } });

    // Leaving a row, region or marker clears the hover a moment later, so the pointer can cross the funnel
    // into the panel (to use its sub-areas) without the panel closing.
    let leaveT = null;
    const hoverKey = k => { clearTimeout(leaveT); if (st.hk !== k) { st.hk = k; apply(); } };
    const leaveKey = () => { clearTimeout(leaveT); leaveT = setTimeout(() => { if (st.hk != null || st.hg != null) { st.hk = null; st.hg = null; apply(); } }, 220); };
    const pinKey = k => { const off = st.pk === k; st.pk = off ? null : k; st.pg = null; st.hk = st.pk; apply(); };
    const clearAll = () => { st.pk = null; st.pg = null; st.pp = null; st.hk = null; st.hg = null; apply(); };

    const toMap = e => {
      const r = svg.getBoundingClientRect(), s = (V + 4) / r.width;
      return [((e.clientX - r.left) * s - 2) / V, ((e.clientY - r.top) * s - 2) / V];
    };
    const regionAt = (x, y) => { for (const id in outer) if (inside(outer[id].pts, x, y)) return +id; return null; };
    let mapKey = null;                                     // the region/marker the pointer is over on the map
    const qOn = on => { qPin.classList.toggle("on", on); qBox.classList.toggle("on", on); };

    // Papers: hover shows a paper while the pointer is on it; a click pins it (clicking it again keeps it pinned, so a
    // double-click can't release it); a click outside the landscape, on empty map space, or Esc releases it.
    svg.addEventListener("mouseover", e => { const pt = e.target.closest(".kl-pt"); if (pt) { st.hp = +pt.dataset.i; apply(); } });
    svg.addEventListener("mouseout", e => { const pt = e.target.closest(".kl-pt"); if (pt && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".kl-pt") === pt)) { st.hp = null; apply(); } });
    // Regions (hit-test on each topic's outermost own ring), gap markers and the query pin
    svg.addEventListener("mousemove", e => {
      qOn(!!e.target.closest(".kl-q"));
      if (e.target.closest(".kl-pt,.kl-q")) return;
      const m = e.target.closest(".kl-gap");
      let k = null;
      if (m) k = "g:" + m.dataset.g;
      else { const [x, y] = toMap(e), c = regionAt(x, y); if (c != null) k = "t:" + c; }
      svg.style.cursor = k ? "pointer" : "";
      if (k !== mapKey) { mapKey = k; if (k) hoverKey(k); else leaveKey(); }
    });
    svg.addEventListener("mouseleave", () => { mapKey = null; st.hp = null; svg.style.cursor = ""; qOn(false); leaveKey(); apply(); });
    svg.addEventListener("click", e => {
      const pt = e.target.closest(".kl-pt"), m = e.target.closest(".kl-gap");
      if (pt) { const i = +pt.dataset.i; st.pp = i; st.hp = null; apply(); return; }
      if (m) { pinKey("g:" + m.dataset.g); return; }
      if (e.target.closest(".kl-q")) return;
      const [x, y] = toMap(e), c = regionAt(x, y);
      if (c != null) pinKey("t:" + c); else clearAll();
    });
    qBox.addEventListener("mouseenter", () => qOn(true));
    qBox.addEventListener("mouseleave", () => qOn(false));
    $$(".kl-gap").forEach(m => {
      const k = "g:" + m.dataset.g;
      m.addEventListener("focus", () => hoverKey(k));
      m.addEventListener("blur", leaveKey);
      m.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pinKey(k); } });
    });
    // Rows: hover or focus extends; click pins (click again to fold)
    $$(".kl-row").forEach(r => {
      const k = r.dataset.k, b = r.querySelector("button");
      r.addEventListener("mouseenter", () => hoverKey(k));
      r.addEventListener("mouseleave", leaveKey);
      b.addEventListener("focus", () => hoverKey(k));
      b.addEventListener("blur", leaveKey);
      b.addEventListener("click", () => pinKey(k));
    });
    // The panel keeps the row extended while the pointer is on it; its sub-areas highlight their papers.
    const side = root.querySelector(".kl-side");
    [side, conn].forEach(el => { el.addEventListener("mouseenter", () => clearTimeout(leaveT)); el.addEventListener("mouseleave", leaveKey); });
    root.addEventListener("mouseover", e => {
      const b = e.target.closest && e.target.closest(".kl-grp"); if (b && st.hg !== b.dataset.g) { st.hg = b.dataset.g; apply(); }
      const it = e.target.closest && e.target.closest(".kl-plist .it"); if (it && st.hp !== +it.dataset.i) { st.hp = +it.dataset.i; apply(); }
    });
    root.addEventListener("mouseout", e => {
      const b = e.target.closest && e.target.closest(".kl-grp");
      if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) { st.hg = null; apply(); }
      const it = e.target.closest && e.target.closest(".kl-plist .it");
      if (it && !(e.relatedTarget && it.contains(e.relatedTarget))) { st.hp = null; apply(); }
    });
    root.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest(".kl-grp");
      if (b) {                                              // pin a sub-area (or a gap's nearby work) with its topic/gap row
        const gk = b.dataset.g, row = groups[gk].row;
        st.pg = st.pg === gk ? null : gk; st.pk = row; st.hk = row; apply(); return;
      }
      if (e.target.closest && e.target.closest(".kl-plist .x")) { clearAll(); return; }
    });
    const ren = root.querySelector(".kl-mode .kl-rename");
    if (ren) ren.addEventListener("click", async () => {
      const m = root.querySelector(".kl-mode .kl-namer").value;
      ren.disabled = true; ren.textContent = "Renaming…";
      let note = root.querySelector(".kl-mode .kl-rnote");
      if (!note) { note = document.createElement("span"); note.className = "kl-site kl-rnote"; ren.after(note); }
      note.style.color = ""; note.textContent = "";
      try { const t2 = await opts.onRename(m, msg => { note.textContent = msg; }); render(host, t2 || tm, Object.assign({}, opts, { mode })); }
      catch (e) { ren.disabled = false; ren.textContent = "Rename"; note.style.color = "#a23f3f"; note.textContent = "Rename failed: " + ((e && e.message) || "error"); }
    });
    const apply1 = root.querySelector(".kl-mode .kl-apply:not(.kl-rename)");
    if (apply1) apply1.addEventListener("click", async () => {
      if (!window.confirm(`Show every user the ${OLD ? "Old" : "New"} way of finding topics and sub-areas?`)) return;
      apply1.disabled = true; apply1.textContent = "Saving…";
      try { await opts.onSiteMode(mode); render(host, tm, Object.assign({}, opts, { mode, siteMode: mode })); }
      catch (e) { apply1.disabled = false; apply1.textContent = "Could not save, try again"; }
    });
    root.querySelectorAll(".kl-mode button[data-m]").forEach(b => b.addEventListener("click", () => {
      const m = b.dataset.m;
      try { localStorage.setItem("eratost_kl_mode", m); } catch (_) {}
      render(host, tm, Object.assign({}, opts, { mode: m }));
    }));
    // A click anywhere outside the landscape releases what is pinned.
    if (host.__klDoc) document.removeEventListener("click", host.__klDoc);
    host.__klDoc = e => { if (root.isConnected && !root.contains(e.target) && (st.pk != null || st.pg != null || st.pp != null)) clearAll(); };
    document.addEventListener("click", host.__klDoc);
    if (host.__klResize) window.removeEventListener("resize", host.__klResize);
    host.__klResize = () => { if (root.isConnected) { placeList(); shownKey = undefined; apply(); } };
    window.addEventListener("resize", host.__klResize);
    // Esc releases everything too.
    if (host.__klKey) document.removeEventListener("keydown", host.__klKey);
    host.__klKey = e => { if (e.key === "Escape" && root.isConnected) clearAll(); };
    document.addEventListener("keydown", host.__klKey);
    apply();
  }

  // A click on a gap elsewhere extends that gap's row.
  function flashGap(i) {
    const el = document.getElementById("gapcard-" + i);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  window.KnowledgeLandscape = { render, flashGap, contours, COLORS };
})();
