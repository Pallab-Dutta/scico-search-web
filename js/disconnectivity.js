/* Semantic structure of a result set, two renderings of the SAME object (work in progress).
   Pure client-side: numbers the backend already produced, no model, no network.

   Single-linkage clustering IS the minimum spanning tree, so we offer two VIEWS of one tree:

     • Disconnectivity ("dg")  — the canonical energy-landscape rendering, plotted horizontally.
         Horizontal position (x) = barrier / gap magnitude = the merge distance (1 - cosine sim)
         at which two sub-basins first join. Minima at barrier 0 (right); root at the largest
         barrier (left). Leaves = papers (green), branch junctions = research gaps (red).

     • MST ("mst") — the same tree drawn as a graph (force-directed). EVERY paper is a node, so a
         paper that bridges two clusters sits geometrically between them. Edges = links; edge
         LENGTH and THICKNESS ∝ gap magnitude. The gap now lives on the EDGE (red midpoint marker)
         rather than on a node.

   Both views share: LOG toggle (compress large gaps) and one tooltip machinery. The two axes of
   choice are deliberately separate — VIEW (layout) vs. future OVERLAY (annotation, e.g. a per-paper
   bridge/gap-closing score) — so an overlay can later be added to BOTH modes without a mode blowup.

   Data note: the LIVE API strips per-paper `embedding`, so on real sessions the tree + faithful
   leave-one-out gap-closer scores are computed SERVER-SIDE (pipeline.build_disconnectivity, via the
   /sessions/{id}/disconnectivity job) and arrive as `session.disconnectivity`. getModel() hydrates
   that. Fixtures that still carry toy embeddings fall back to building the tree client-side.

   ── THEORY (barriers & gap-closers) ───────────────────────────────────────────────────────────
   • Distance between two papers = 1 − cosine(embeddings) ∈ [0, 2].
   • BARRIER between papers i,j = their cophenetic / minimax distance = the largest edge on the MST
     path i→j = the height at which i and j first merge under single-linkage. It is the lowest "pass"
     you must cross to get from one to the other. A gap node's height IS this barrier.
   • Removing a paper can only RAISE these minimax barriers (never lower them — you can only lose a
     shortcut). For paper k we measure two things (pipeline._loo_from_dist):
        – total gap-closing  = Σ over pairs of the barrier increase. An aggregate over O(n²) pairs,
          so it is NOT a barrier height and routinely exceeds any single barrier — it ranks papers by
          how much structure they hold together (this is also the per-paper "Impact" score).
        – HELD barrier       = CAUSAL. Restrict to papers published UP TO k's year and take the
          largest barrier INCREASE that removing k causes there — the gap k actually closed given the
          literature of its time (0 if the year is unknown or k has < 3 predecessors). Same units as a
          gap node. The TREE stays the full current field; only this per-paper score is time-limited.
   • LOG scale: barriers are positive but cluster near 0, so log spreads them. Since log10(distance<1)
     is negative, the readout uses "dex" = log10(barrier / tightest-gap) ≥ 0 — decades above the
     smallest gap — which is exactly what the log axis positions by, and stays positive. */
(function () {
  const cos = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  };
  const esc = s => String(s == null ? "" : s)
    .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const trunc = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  // Single-linkage hierarchy from embeddings. Returns {root, edges}: the merge tree (leaf = paper,
  // branch height = barrier) AND the N-1 MST edges (each merge's argmin paper pair + its weight).
  function buildTree(papers) {
    const pts = papers.filter(p => Array.isArray(p.embedding));
    if (pts.length < 2) return null;
    let clusters = pts.map((p) => ({ leaf: true, paper: p, members: [p], height: 0 }));
    const pairDist = (A, B) => {
      let mn = Infinity, pa = null, pb = null;
      for (const i of A.members) for (const j of B.members) {
        const dd = 1 - cos(i.embedding, j.embedding);
        if (dd < mn) { mn = dd; pa = i; pb = j; }
      }
      return { d: mn, a: pa, b: pb };
    };
    const edges = [];
    while (clusters.length > 1) {
      let bi = 0, bj = 1, bd = Infinity, ea = null, eb = null;
      for (let i = 0; i < clusters.length; i++)
        for (let j = i + 1; j < clusters.length; j++) {
          const r = pairDist(clusters[i], clusters[j]);
          if (r.d < bd) { bd = r.d; bi = i; bj = j; ea = r.a; eb = r.b; }
        }
      edges.push({ a: ea, b: eb, w: bd });          // the MST edge for this merge
      const a = clusters[bi], b = clusters[bj];
      clusters = clusters.filter((_, k) => k !== bi && k !== bj)
        .concat([{ leaf: false, height: bd, children: [a, b], members: a.members.concat(b.members) }]);
    }
    return { root: clusters[0], edges };
  }

  let LOG = true;      // barrier axis / edge length scale: true = log(gap) (compact), false = linear.
  let MODE = "dg";     // "dg" = disconnectivity, "mst" = minimum spanning tree graph.
  let OVERLAY = false; // "Highlight gap-closers": tint/size papers by their bridge score (both views).

  // Smallest positive barrier in the current map — the reference for the positive log ("dex") scale.
  let BMIN = 0;
  // Display a barrier / gap magnitude honoring the Log-scale toggle. Barrier heights are POSITIVE, so
  // rather than log10(distance) (which is negative for distances < 1) the log view shows the raw
  // distance PLUS "dex" = log10(barrier / BMIN) >= 0 — decades above the smallest barrier in the whole
  // picture (gap nodes AND gap-closer held barriers), so gaps and gap-closers share one scale and
  // never go negative. Linear view shows just the raw distance.
  const fmtBar = v => {
    v = +v || 0;
    if (!(LOG && v > 0)) return v.toFixed(3);
    const dex = (BMIN > 0) ? Math.log10(v / BMIN) : 0;
    return `${v.toFixed(3)} · ${dex.toFixed(2)} dex`;
  };

  const isLeaf = n => n.leaf || (!n.children && n.paper);
  const kids = n => n.children || [];
  function leafNodes(n) { const out = []; (function g(m) { isLeaf(m) ? out.push(m) : kids(m).forEach(g); })(n); return out; }
  function leafPapers(n) { return leafNodes(n).map(m => m.paper || m); }

  // Fallback edges when a server tree arrives WITHOUT embeddings: one edge per internal node, joining
  // a representative leaf of each child, weight = the node's barrier. Yields a valid spanning tree.
  function deriveEdges(root) {
    const edges = [];
    (function walk(n) {
      if (isLeaf(n)) return leafPapers(n)[0];
      const reps = kids(n).map(walk);
      for (let i = 1; i < reps.length; i++) edges.push({ a: reps[0], b: reps[i], w: n.height || 0 });
      return reps[0];
    })(root);
    return edges;
  }

  function getModel(session) {
    const d = session.disconnectivity;
    // Server contract (live path): {tree, papers, edges (index pairs), loo, betweenness}. JSON can't
    // carry object refs, so hydrate index-based nodes/edges back into paper-object form and key the
    // faithful leave-one-out scores by paper object.
    if (d && d.tree) {
      const papers = d.papers || [];
      const hydrate = node => node.leaf
        ? { leaf: true, paper: papers[node.i] }
        : { leaf: false, height: node.height, children: (node.children || []).map(hydrate) };
      const root = hydrate(d.tree);
      const edges = (d.edges || []).map(e => ({ a: papers[e.a], b: papers[e.b], w: e.w }));
      let loo = null, held = null;
      if (Array.isArray(d.loo) && d.loo.length === papers.length) {
        loo = new Map(); papers.forEach((p, i) => loo.set(p, d.loo[i]));
      }
      // held[i] = CAUSAL gap-closing barrier: the largest barrier INCREASE a paper caused among only
      // the papers that existed up to its own publication year. Same units as gap-node barriers.
      // See _temporal_held in pipeline.py.
      if (Array.isArray(d.held) && d.held.length === papers.length) {
        held = new Map(); papers.forEach((p, i) => held.set(p, d.held[i]));
      }
      return { root, edges, loo, held };
    }
    // Legacy server tree (root node only, no wrapper) — keep working.
    if (d && (d.children || d.leaf)) return { root: d, edges: d.edges || deriveEdges(d) };
    // Fixture / dev path: build client-side from per-paper embeddings.
    const papers = ((session.publications && session.publications.papers) || []);
    return buildTree(papers);   // {root, edges} or null
  }

  // Normalize server leave-one-out scores into the same {raw, norm, kind} shape as bridgeScore.
  function looScores(looMap) {
    let mx = 0; looMap.forEach(v => { if (v > mx) mx = v; });
    const out = new Map();
    looMap.forEach((v, p) => out.set(p, { raw: v, norm: mx > 0 ? v / mx : 0, kind: "loo" }));
    return out;
  }

  /* ---- Overlay: per-paper bridge / gap-closing score (annotation, not a layout) ----
     Graph BETWEENNESS on the MST: for a paper v, how many paper-pairs' unique tree-paths route
     through it. In a tree this is exactly ((N-1)^2 - Σ sᵢ²)/2, where sᵢ are the component sizes
     when v is removed. Pendant papers score 0; connectors that hold sub-basins together score high.
     Pure topology -> needs no embeddings, so it also works on a server-provided tree (deriveEdges).

     This is the CLIENT FALLBACK. The faithful leave-one-out score (remove each paper, re-cluster,
     measure how much the barriers it held shut RISE) needs embeddings + N re-clusterings, so it runs
     SERVER-SIDE (pipeline.build_disconnectivity) and arrives as `session.disconnectivity.loo`. When
     present, draw() uses that (looScores); betweenness here covers fixtures / legacy sessions. */
  function bridgeScore(model) {
    const papers = leafPapers(model.root);
    const idx = new Map(papers.map((p, i) => [p, i]));
    const N = papers.length;
    const adj = papers.map(() => []);
    model.edges.forEach(e => { if (idx.has(e.a) && idx.has(e.b)) { adj[idx.get(e.a)].push(idx.get(e.b)); adj[idx.get(e.b)].push(idx.get(e.a)); } });
    const scores = new Map();
    let maxRaw = 0;
    for (let v = 0; v < N; v++) {
      const seen = new Set([v]);
      let sumSq = 0;
      for (const nb of adj[v]) {
        if (seen.has(nb)) continue;
        let size = 0; const st = [nb]; seen.add(nb);
        while (st.length) { const u = st.pop(); size++; for (const w of adj[u]) if (!seen.has(w)) { seen.add(w); st.push(w); } }
        sumSq += size * size;
      }
      const raw = ((N - 1) * (N - 1) - sumSq) / 2;
      scores.set(papers[v], { raw, norm: 0, kind: "betweenness" });
      if (raw > maxRaw) maxRaw = raw;
    }
    if (maxRaw > 0) scores.forEach(s => { s.norm = s.raw / maxRaw; });
    return scores;
  }

  // Green (ordinary paper) -> amber (strong connector) ramp for the overlay.
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const g = [46, 158, 91], a = [240, 165, 0];
    const c = g.map((v, i) => Math.round(v + (a[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  // Fill + radius for a paper dot, honoring the overlay flag. Shared by both views.
  function paperStyle(p, scores) {
    const sc = (scores && scores.get(p)) || { norm: 0, raw: 0, kind: "betweenness" };
    return { fill: OVERLAY ? ramp(sc.norm) : "#2e9e5b", r: OVERLAY ? (5 + 3 * sc.norm) : 5, raw: sc.raw, kind: sc.kind };
  }

  function tipHTML(m) {
    if (m.type === "paper") {
      const p = m.paper;
      const meta = [p.authors, p.year].filter(Boolean).join(" · ");
      const score = (p.ai_score != null) ? `relevance ${(+p.ai_score).toFixed(2)}` : "";
      let bridge = "";
      if (m.held > 0) {
        // Causal barrier this paper closed among the work that existed up to its year (same units as
        // a gap node); the total gap-closing is the full-set SUM over pairs (a larger scale).
        bridge = `gap-closer · closed a barrier of ${fmtBar(m.held)} vs. work up to its year`
               + (m.total > 0 ? ` · total gap-closing ${(+m.total).toFixed(2)}` : "");
      } else if (m.overlayKind === "betweenness" && m.overlay > 0) {
        bridge = `connector · routes ${m.overlay} paper-pairs`;
      } else if (m.total > 0) {
        // Contributes to closing gaps overall, but did not singularly open a new gap in its era.
        bridge = `gap-closer · total gap-closing ${(+m.total).toFixed(2)} (sum over pairs — not a single barrier)`;
      }
      return `<b>${esc(p.title)}</b>` +
        (meta ? `<div class="dg-sub">${esc(meta)}</div>` : "") +
        (score ? `<div class="dg-sub">${esc(score)}</div>` : "") +
        (bridge ? `<div class="dg-sub">${esc(bridge)}</div>` : "");
    }
    const reps = m.papers.slice().sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
    const list = reps.slice(0, 4).map(p => `<li>${esc(trunc(p.title, 42))}</li>`).join("");
    const head = m.split
      ? `barrier ${fmtBar(m.barrier)} · splits ${m.split[0]} ↔ ${m.split[1]} papers`
      : `barrier ${fmtBar(m.barrier)} · ${reps.length} papers below`;
    return `<b>${esc(m.title)}</b>` +
      `<div class="dg-sub">${head}</div>` +
      `<ul class="dg-list">${list}${reps.length > 4 ? `<li>+${reps.length - 4} more…</li>` : ""}</ul>`;
  }

  /* ---- View A: canonical disconnectivity graph (horizontal) ---- */
  function buildDG(model, W, scores) {
    const tree = model.root;
    const leaves = leafNodes(tree);

    const left = 34, right = 264, top = 24, rowH = 26, axisPad = 40;
    const H = top * 2 + Math.max(1, leaves.length - 1) * rowH + axisPad;
    const innerW = W - left - right;
    const maxH = (function m(n) { return isLeaf(n) ? 0 : Math.max(n.height || 0, ...kids(n).map(m)); })(tree) || 1;
    const leafX = left + innerW;                      // barrier 0 (minima column, right)
    let hmin = Infinity;
    (function mn(n) { if (!isLeaf(n)) { if ((n.height || 0) > 0) hmin = Math.min(hmin, n.height); kids(n).forEach(mn); } })(tree);
    if (!isFinite(hmin)) hmin = maxH;
    const LMARGIN = 0.05, lspan = (Math.log(maxH) - Math.log(hmin)) || 1;
    const xLin = h => leafX - (h / maxH) * innerW;
    const xLog = h => h <= 0 ? leafX
      : leafX - (LMARGIN + (1 - LMARGIN) * (Math.log(h) - Math.log(hmin)) / lspan) * innerW;
    const xAt = LOG ? xLog : xLin;                    // larger barrier -> further left
    const axisY = H - 22;

    leaves.forEach((lf, i) => { lf._x = leafX; lf._y = top + i * rowH; });
    (function lay(n) {
      if (isLeaf(n)) return { y: n._y };
      const c = kids(n).map(lay);
      n._x = xAt(n.height || 0);
      const ys = c.map(p => p.y);
      n._y = (Math.min(...ys) + Math.max(...ys)) / 2;
      return { y: n._y };
    })(tree);

    let branches = "", dots = "", labels = "", uid = 0;
    const meta = {};
    (function walk(n) {
      const id = "d" + (uid++);
      if (!isLeaf(n)) {
        const c = kids(n), ys = c.map(k => k._y);
        branches += `<path d="M${n._x} ${Math.min(...ys)} V${Math.max(...ys)}" stroke="#111" stroke-width="1.5" fill="none"/>`;
        c.forEach(k => { branches += `<path d="M${k._x} ${k._y} H${n._x}" stroke="#111" stroke-width="1.5" fill="none"/>`; walk(k); });
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x}" cy="${n._y}" r="5" fill="#d64545" stroke="#fff" stroke-width="1.2"/>`;
        meta[id] = { type: "gap", title: n.gap || n.concept || "Research gap", barrier: n.height || 0, papers: leafPapers(n) };
      } else {
        const p = n.paper || n;
        const st = paperStyle(p, scores);
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x}" cy="${n._y}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>`;
        labels += `<text x="${n._x + 10}" y="${n._y + 3.5}" font-size="11" fill="#333">${esc(trunc(p.title, 38))}</text>`;
        meta[id] = { type: "paper", paper: p, overlay: st.raw, overlayKind: st.kind, held: (model.held && model.held.get(p)) || 0, total: (model.loo && model.loo.get(p)) || 0 };
      }
    })(tree);

    const axis =
      `<line x1="${left}" y1="${axisY}" x2="${leafX}" y2="${axisY}" stroke="#bbb" stroke-width="1"/>` +
      `<line x1="${leafX}" y1="${axisY - 4}" x2="${leafX}" y2="${axisY + 4}" stroke="#bbb"/>` +
      `<line x1="${left}" y1="${axisY - 4}" x2="${left}" y2="${axisY + 4}" stroke="#bbb"/>` +
      `<text x="${leafX}" y="${axisY + 16}" text-anchor="end" font-size="10" fill="#888">0</text>` +
      `<text x="${left}" y="${axisY + 16}" text-anchor="start" font-size="10" fill="#888">${LOG && BMIN > 0 ? Math.log10(maxH / BMIN).toFixed(2) + " dex" : maxH.toFixed(2)}</text>` +
      `<text x="${(left + leafX) / 2}" y="${axisY + 16}" text-anchor="middle" font-size="10" fill="#888">← barrier (${LOG ? "log" : "linear"} gap magnitude)</text>`;

    return { inner: branches + axis + dots + labels, H, meta };
  }

  /* ---- View B: minimum spanning tree graph (force-directed) ---- */
  // Deterministic spring layout in unit space (seeded on a circle -> reproducible, no jitter on
  // redraw). Rest length per edge ∝ gap magnitude, so bigger gaps push their papers further apart.
  function layoutForce(nodes, edges, idx, restLen) {
    const N = nodes.length;
    nodes.forEach((n, i) => { const a = 2 * Math.PI * i / N; n._lx = Math.cos(a) * 2; n._ly = Math.sin(a) * 2; });
    const REP = 2.0, KS = 0.6, ITERS = 500, MAXD = 0.4;
    for (let it = 0; it < ITERS; it++) {
      const cool = 1 - it / ITERS;
      const fx = new Array(N).fill(0), fy = new Array(N).fill(0);
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {   // repulsion (all pairs)
        let dx = nodes[i]._lx - nodes[j]._lx, dy = nodes[i]._ly - nodes[j]._ly;
        let d = Math.hypot(dx, dy) || 0.001; const f = REP / (d * d);
        dx /= d; dy /= d; fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
      }
      for (const e of edges) {                                        // springs toward rest length
        const u = idx.get(e.a), v = idx.get(e.b);
        let dx = nodes[u]._lx - nodes[v]._lx, dy = nodes[u]._ly - nodes[v]._ly;
        let d = Math.hypot(dx, dy) || 0.001; const f = KS * (d - restLen(e.w));
        dx /= d; dy /= d; fx[u] -= dx * f; fy[u] -= dy * f; fx[v] += dx * f; fy[v] += dy * f;
      }
      for (let i = 0; i < N; i++) {
        let mvx = fx[i] * 0.1 * cool, mvy = fy[i] * 0.1 * cool;
        const m = Math.hypot(mvx, mvy); if (m > MAXD) { mvx = mvx / m * MAXD; mvy = mvy / m * MAXD; }
        nodes[i]._lx += mvx; nodes[i]._ly += mvy;
      }
    }
  }

  function buildMST(model, W, scores) {
    const nodes = leafNodes(model.root);
    const idx = new Map(nodes.map((n, i) => [n.paper || n, i]));
    const edges = model.edges.filter(e => idx.has(e.a) && idx.has(e.b));
    const H = Math.max(420, Math.min(Math.round(W * 0.6), 620));

    const ws = edges.map(e => e.w).filter(w => w > 0);
    const wmax = ws.length ? Math.max(...ws) : 1, wmin = ws.length ? Math.min(...ws) : 1;
    const t01 = w => {
      if (!(w > 0)) return 0;
      const t = LOG ? (Math.log(w) - Math.log(wmin)) / ((Math.log(wmax) - Math.log(wmin)) || 1)
        : (w - wmin) / ((wmax - wmin) || 1);
      return Math.max(0, Math.min(1, t));
    };
    const restLen = w => 1 + 3 * t01(w);

    layoutForce(nodes.map(n => n.paper || n), edges, idx, restLen);
    const pos = nodes.map(n => n.paper || n);   // objects carrying _lx/_ly

    // Rescale unit-space layout into the viewport (leave room for labels).
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    pos.forEach(n => { minx = Math.min(minx, n._lx); maxx = Math.max(maxx, n._lx); miny = Math.min(miny, n._ly); maxy = Math.max(maxy, n._ly); });
    const padL = 60, padR = 120, padT = 28, padB = 40;
    const bw = (maxx - minx) || 1, bh = (maxy - miny) || 1;
    const s = Math.min((W - padL - padR) / bw, (H - padT - padB) / bh);
    const offx = padL + ((W - padL - padR) - bw * s) / 2, offy = padT + ((H - padT - padB) - bh * s) / 2;
    pos.forEach(n => { n._x = offx + (n._lx - minx) * s; n._y = offy + (n._ly - miny) * s; });

    // Adjacency for the "which side does this edge separate" cut.
    const adj = pos.map(() => []);
    edges.forEach((e, ei) => { adj[idx.get(e.a)].push([idx.get(e.b), ei]); adj[idx.get(e.b)].push([idx.get(e.a), ei]); });
    const sideOf = ei => {
      const start = idx.get(edges[ei].a), seen = new Set([start]), st = [start];
      while (st.length) { const u = st.pop(); for (const [v, e2] of adj[u]) { if (e2 !== ei && !seen.has(v)) { seen.add(v); st.push(v); } } }
      return seen;
    };

    let lines = "", gapdots = "", ndots = "", labels = "", uid = 0;
    const meta = {};
    edges.forEach((e, ei) => {
      const a = pos[idx.get(e.a)], b = pos[idx.get(e.b)];
      const wpx = (1 + 2 * t01(e.w)).toFixed(2);
      lines += `<line x1="${a._x.toFixed(1)}" y1="${a._y.toFixed(1)}" x2="${b._x.toFixed(1)}" y2="${b._y.toFixed(1)}" stroke="#111" stroke-width="${wpx}" stroke-linecap="round"/>`;
      const mx = ((a._x + b._x) / 2).toFixed(1), my = ((a._y + b._y) / 2).toFixed(1), r = (2 + 3 * t01(e.w)).toFixed(1);
      const id = "g" + (uid++);
      gapdots += `<circle class="dg-node" data-id="${id}" cx="${mx}" cy="${my}" r="${r}" fill="#d64545" stroke="#fff" stroke-width="1"/>`;
      const sideA = sideOf(ei);
      const smaller = sideA.size <= pos.length - sideA.size
        ? [...sideA] : pos.map((_, i) => i).filter(i => !sideA.has(i));
      meta[id] = {
        type: "gap", title: "Research gap", barrier: e.w,
        split: [sideA.size, pos.length - sideA.size],
        papers: smaller.map(i => pos[i])
      };
    });
    pos.forEach(p => {
      const id = "n" + (uid++);
      const st = paperStyle(p, scores);
      ndots += `<circle class="dg-node" data-id="${id}" cx="${p._x.toFixed(1)}" cy="${p._y.toFixed(1)}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>`;
      labels += `<text x="${(p._x + 8).toFixed(1)}" y="${(p._y + 3).toFixed(1)}" font-size="9" fill="#666">${esc(trunc(p.title, 16))}</text>`;
      meta[id] = { type: "paper", paper: p, overlay: st.raw, overlayKind: st.kind, held: (model.held && model.held.get(p)) || 0, total: (model.loo && model.loo.get(p)) || 0 };
    });
    const hint = `<text x="12" y="${H - 12}" font-size="10" fill="#999">edge length ∝ ${LOG ? "log " : ""}gap magnitude · long / thick edge = larger gap</text>`;

    return { inner: lines + gapdots + ndots + labels + hint, H, meta };
  }

  /* ---- Shared shell: toolbar, svg wrapper, tooltip ---- */
  function wireTooltip(mountEl, meta) {
    const tip = document.createElement("div");
    tip.style.cssText = "position:absolute;display:none;max-width:260px;background:#151515;color:#fff;" +
      "padding:8px 10px;border-radius:7px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.28);" +
      "pointer-events:none;z-index:20";
    tip.innerHTML = "<style>.dg-sub{opacity:.75;font-size:11px;margin-top:2px}" +
      ".dg-list{margin:6px 0 0;padding-left:16px}.dg-list li{margin:1px 0}</style>";
    const tipBody = document.createElement("div");
    tip.appendChild(tipBody);
    mountEl.appendChild(tip);

    mountEl.querySelectorAll(".dg-node").forEach(el => {
      el.style.cursor = "pointer";
      const baseR = el.getAttribute("r");
      el.addEventListener("mouseenter", () => { tipBody.innerHTML = tipHTML(meta[el.dataset.id]); tip.style.display = "block"; el.setAttribute("r", (+baseR + 2).toFixed(1)); });
      el.addEventListener("mouseleave", () => { tip.style.display = "none"; el.setAttribute("r", baseR); });
      el.addEventListener("mousemove", e => {
        const r = mountEl.getBoundingClientRect();
        let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
        if (x + tip.offsetWidth > r.width) x = e.clientX - r.left - tip.offsetWidth - 14;
        tip.style.left = Math.max(0, x) + "px";
        tip.style.top = Math.max(0, y) + "px";
      });
    });
  }

  function draw(session, mountEl) {
    const model = getModel(session);
    mountEl.style.position = "relative";
    if (!model) { mountEl.innerHTML = '<p style="color:#888">Need ≥2 papers with embeddings to draw the tree.</p>'; return; }

    // Log ("dex") reference = the smallest positive barrier ANYWHERE in the picture — gap-node
    // barriers AND gap-closer held barriers — so every dex = log10(barrier / BMIN) is >= 0, and the
    // axis label and the gap-closer tooltips use one identical formula/reference.
    const bw = (model.edges || []).map(e => e.w).filter(w => w > 0);
    const hv = model.held ? [...model.held.values()].filter(v => v > 0) : [];
    const allBar = bw.concat(hv);
    BMIN = allBar.length ? Math.min(...allBar) : 0;

    const W = Math.max(mountEl.clientWidth || 820, 360);
    // Prefer the server's faithful leave-one-out scores; fall back to client betweenness (fixtures /
    // legacy sessions). Same {raw, norm, kind} shape either way, so both views render identically.
    // Highlight/rank by the causal held barrier when the field has any era-bridges, so the emphasised
    // papers are exactly the ones whose tooltip shows a "closed a barrier of …" reading; fall back to
    // the total gap-closing sum, then to pure-topology betweenness (fixtures / legacy sessions).
    const hasHeld = model.held && [...model.held.values()].some(v => v > 0);
    const scores = hasHeld ? looScores(model.held)
                 : (model.loo && model.loo.size) ? looScores(model.loo)
                 : bridgeScore(model);
    const built = MODE === "mst" ? buildMST(model, W, scores) : buildDG(model, W, scores);

    const radio = (v, lbl) =>
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">` +
      `<input type="radio" name="dgmode" class="dg-mode" value="${v}"${MODE === v ? " checked" : ""}/>${lbl}</label>`;
    const tools =
      `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:8px;` +
      `font:12px system-ui,sans-serif;color:#555">` +
      `<span style="display:inline-flex;gap:10px;align-items:center">View: ${radio("dg", "Disconnectivity")} ${radio("mst", "MST")}</span>` +
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none">` +
      `<input type="checkbox" class="dg-log"${LOG ? " checked" : ""}/> Log scale (compress large gaps)</label>` +
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none">` +
      `<input type="checkbox" class="dg-overlay"${OVERLAY ? " checked" : ""}/> Highlight gap-closers</label>` +
      `</div>`;

    mountEl.innerHTML = tools +
      `<svg viewBox="0 0 ${W} ${built.H}" width="100%" height="${built.H}" preserveAspectRatio="xMinYMin meet" ` +
      `style="font-family:system-ui,sans-serif;display:block;max-width:100%">` + built.inner + `</svg>`;

    mountEl.querySelectorAll(".dg-mode").forEach(r =>
      r.addEventListener("change", () => { if (r.checked) { MODE = r.value; draw(session, mountEl); } }));
    const chk = mountEl.querySelector(".dg-log");
    if (chk) chk.addEventListener("change", () => { LOG = chk.checked; draw(session, mountEl); });
    const ovr = mountEl.querySelector(".dg-overlay");
    if (ovr) ovr.addEventListener("change", () => { OVERLAY = ovr.checked; draw(session, mountEl); });

    wireTooltip(mountEl, built.meta);
  }

  let _last = null;
  function renderDisconnectivity(session, mountEl) { _last = { session, mountEl }; draw(session, mountEl); }
  if (!window.__dgResize) {
    window.__dgResize = true;
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (_last) draw(_last.session, _last.mountEl); }, 120); });
  }
  window.renderDisconnectivity = renderDisconnectivity;
})();
