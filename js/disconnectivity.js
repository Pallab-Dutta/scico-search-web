/* Semantic structure of a result set, two renderings of the SAME object (work in progress).
   Pure client-side: numbers the backend already produced, no model, no network.

   Single-linkage clustering IS the minimum spanning tree, so we offer two VIEWS of one tree:

     • Disconnectivity ("dg")  — the canonical FREE-ENERGY landscape, plotted horizontally, built
         exactly like a protein-folding PES. Horizontal position (x) = FREE ENERGY F = −ln p
         (Boltzmann inversion, k_BT=1) on ONE axis for minima AND saddles. A LEAF (paper) sits at
         its OWN well depth F_i = −ln(density) — dense, well-populated semantic regions are deep,
         stable wells (right); isolated outliers are shallow, up near the root (left). A JUNCTION
         (research gap) sits at the barrier F = −ln(cos-sim of its merge edge), raised so no barrier
         lies below the wells it separates. Deepest well = 0 (right); root = largest F (left).
         Leaves = papers (green), branch junctions = research gaps (red). Server sends per-node `fe`
         + per-paper `energy`; payloads without them fall back to the legacy leaves-at-0 dendrogram.

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
     shortcut). For paper k we measure two things:
        – total gap-closing  = Σ over pairs of the barrier increase (pipeline._loo_from_dist). An
          aggregate over O(n²) pairs, so it is NOT a barrier height and routinely exceeds any single
          barrier — it ranks papers by how much structure they hold together (the "Impact" score).
        – BARRIER REDUCTION  = the LARGEST single barrier INCREASE that removing k causes across the
          full field (pipeline._barrier_reduction), plus the PAIR of works whose barrier rises most =
          the gap k closes between them. Same units as a gap node; ranks/colors the gap-closers.
     When "Highlight gap-closers" is on, a gap-closer leaves its base row and is drawn as a green node
     BETWEEN the two works it bridges — midway between their rows, at the barrier it closes (their merge
     height) — with a green arm to each work, i.e. a fork whose two children are those works. The red
     disconnectivity tree of the remaining papers is kept around them. A redundant/pendant paper
     reduces nothing and stays a base minimum.
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
  let FEV = false;      // free-energy DG view active: axis is already -ln p (energy), so never re-log it.
  let REDUCE_FE = false; // gap-closer barriers measured on the free-energy surface (nats), not cosine.
  let AZ = -35, EL = 28; // 3D view angles in degrees (turn about the vertical; tilt: 0 = side, 90 = top)
  let ENSURING = false;  // 3D view is waiting for the page to build the Topic Map positions
  // Optional textbook styles (off by default; the exact views stay the reference):
  let LEVELLED = false;  // flat view drawn disconnectionDPS-style: energy in steps, basins lumped per step
  let METRIC = false;    // 3D view drawn as a metric disconnectivity graph: vertical posts per basin
  let NLEV = 40;         // number of energy levels for both styles
  let MINB = 1;          // hide branches holding fewer papers than this (both styles); 1 = show all
  let LOGLV = true;      // textbook styles: compressed (log) energy axis, so the many small barriers near
                         // the bottom are not squashed under one tall barrier. Tick labels stay true.
  let OVERLAY = false; // "Highlight gap-closers": tint/size papers by their bridge score (both views).

  // Smallest positive barrier in the current map — the reference for the positive log ("dex") scale.
  let BMIN = 0;
  // Display a barrier / gap magnitude honoring the Log-scale toggle. Barrier heights are POSITIVE, so
  // rather than log10(distance) (which is negative for distances < 1) the log view shows the raw
  // distance PLUS "dex" = log10(barrier / BMIN) >= 0 — decades above the smallest barrier in the whole
  // picture (gap nodes AND gap-closer reduction barriers), so gaps and gap-closers share one scale and
  // never go negative. Linear view shows just the raw distance.
  const fmtBar = v => {
    v = +v || 0;
    if (!(LOG && !FEV && v > 0)) return v.toFixed(3);   // FEV: already an energy axis — no dex
    const dex = (BMIN > 0) ? Math.log10(v / BMIN) : 0;
    return `${v.toFixed(3)} · ${dex.toFixed(2)} dex`;
  };

  const isLeaf = n => n.leaf || (!n.children && n.paper);
  const kids = n => n.children || [];
  function leafNodes(n) { const out = []; (function g(m) { isLeaf(m) ? out.push(m) : kids(m).forEach(g); })(n); return out; }
  function leafPapers(n) { return leafNodes(n).map(m => m.paper || m); }

  // The red gap-node that JOINS two papers = their lowest common ancestor (its height is their
  // cophenetic / minimax barrier). Post-order: the deepest internal node whose subtree first holds
  // BOTH papers is the LCA. Null if they are not both present. A gap-closer is drawn AS this node.
  function lcaNode(root, pa, pb) {
    let found = null;
    (function rec(n) {                                   // returns how many of {pa,pb} live under n
      if (isLeaf(n)) { const p = n.paper || n; return (p === pa || p === pb) ? 1 : 0; }
      let cnt = 0;
      for (const c of kids(n)) cnt += rec(c);
      if (cnt >= 2 && !found) found = n;                 // first (deepest) node holding both = the LCA
      return cnt;
    })(root);
    return found;
  }

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
      // `fe` = Boltzmann-inverted FREE ENERGY (k_BT=1) on every node — leaf minima at their own well
      // depth, junctions raised to the barrier that separates their basins. Present on free-energy
      // payloads; absent (undefined) on older ones, which then render the legacy leaves-at-0 way.
      const hydrate = node => node.leaf
        ? { leaf: true, paper: papers[node.i], fe: node.fe }
        : { leaf: false, height: node.height, fe: node.fe, col: node.col, children: (node.children || []).map(hydrate) };
      const root = hydrate(d.tree);
      const edges = (d.edges || []).map(e => ({ a: papers[e.a], b: papers[e.b], w: e.w }));
      let loo = null, reduce = null;
      if (Array.isArray(d.loo) && d.loo.length === papers.length) {
        loo = new Map(); papers.forEach((p, i) => loo.set(p, d.loo[i]));
      }
      // reduce[i] = gap-closing ability: the LARGEST single barrier that removing paper i reopens across
      // the full field = how much it reduced the barrier. Same units as gap-node barriers. See
      // _barrier_reduction in pipeline.py. Fall back to the older CAUSAL `held` (temporal) field for
      // payloads captured before `reduce` existed.
      const rsrc = (Array.isArray(d.reduce) && d.reduce.length === papers.length) ? d.reduce
                 : (Array.isArray(d.held) && d.held.length === papers.length) ? d.held : null;
      if (rsrc) { reduce = new Map(); papers.forEach((p, i) => reduce.set(p, rsrc[i])); }
      // reduce_pair[i] = the two papers (index pair) whose barrier a gap-closer holds shut = the gap it
      // closes BETWEEN. Hydrate to paper objects so the tooltip can name them. Absent on `held`-only
      // (pre-reduce_pair) payloads -> no pair line, which is fine.
      let reducePair = null;
      if (Array.isArray(d.reduce_pair) && d.reduce_pair.length === papers.length) {
        reducePair = new Map();
        papers.forEach((p, i) => {
          const pr = d.reduce_pair[i];
          if (pr && pr.length === 2 && papers[pr[0]] && papers[pr[1]] && pr[0] !== pr[1])
            reducePair.set(p, { a: papers[pr[0]], b: papers[pr[1]] });
        });
      }
      // Per-paper free energy F_i = -ln p_i (KDE density), keyed by paper object; deepest well = 0.
      let energy = null;
      if (Array.isArray(d.energy) && d.energy.length === papers.length) {
        energy = new Map(); papers.forEach((p, i) => energy.set(p, d.energy[i]));
      }
      const hasFE = (typeof root.fe === "number") && energy != null;
      // reduce_units "fe": the gap a paper closes is measured on the drawn free-energy surface (nats),
      // the same units as the axis; older payloads measured it in cosine distance.
      const reduceFE = d.reduce_units === "fe";
      // Knowledge-map positions for the 3D view: the Topic Map's 2D point for each paper. Both lists are
      // the session's papers in the same order, so match by index and confirm by title (title lookup as
      // a fallback). Null until the Topic Map exists.
      const tm = session.topic_map, pts = tm && Array.isArray(tm.points) ? tm.points : null;
      let pos = null;
      if (pts && pts.length) {
        pos = new Map();
        const byTitle = new Map();
        pts.forEach(q => { if (!byTitle.has(q.title)) byTitle.set(q.title, q); });
        papers.forEach((p, i) => {
          const q = (pts[i] && pts[i].title === p.title) ? pts[i] : byTitle.get(p.title);
          if (q) pos.set(p, { x: +q.x, y: +q.y });
        });
      }
      return { root, edges, loo, reduce, reducePair, energy, hasFE, reduceFE, papers, pos, grid: tm && tm.grid };
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
      let gapPair = "";
      if (m.reduce > 0) {
        // How much this paper REDUCES the barrier: the largest single gap it holds shut (removing it
        // reopens by this much), same units as a gap node; the total gap-closing is the full-set SUM
        // over pairs (a larger scale).
        bridge = `gap-closer · holds a barrier of ${REDUCE_FE ? (+m.reduce).toFixed(2) + " (−ln p)" : fmtBar(m.reduce)} shut (removing it reopens this gap)`
               + (m.total > 0 ? ` · total gap-closing ${(+m.total).toFixed(2)}` : "");
        // Name the two works this paper bridges — the endpoints of the pass it holds shut = the gap
        // it closes BETWEEN. (Absent on legacy/held-only payloads.)
        if (m.pair) gapPair = `closes the gap between “${esc(trunc(m.pair.a.title, 40))}” and “${esc(trunc(m.pair.b.title, 40))}”` +
          (m.hl ? " (highlighted)" : "");
      } else if (m.overlayKind === "betweenness" && m.overlay > 0) {
        bridge = `connector · routes ${m.overlay} paper-pairs`;
      } else if (m.total > 0) {
        // Contributes to closing gaps overall, but did not singularly open a new gap in its era.
        bridge = `gap-closer · total gap-closing ${(+m.total).toFixed(2)} (sum over pairs — not a single barrier)`;
      }
      // Free-energy well depth (Boltzmann-inverted density): 0 = deepest, most stable / well-populated
      // region; larger = shallower, more isolated, nearer the root.
      const depth = (m.fe != null)
        ? `free energy ${fmtBar(m.fe)} · ${m.fe <= 1e-6 ? "deepest, most stable well" : "well depth above the deepest"}`
        : "";
      return `<b>${esc(p.title)}</b>` +
        (meta ? `<div class="dg-sub">${esc(meta)}</div>` : "") +
        (score ? `<div class="dg-sub">${esc(score)}</div>` : "") +
        (depth ? `<div class="dg-sub">${esc(depth)}</div>` : "") +
        (bridge ? `<div class="dg-sub">${esc(bridge)}</div>` : "") +
        (gapPair ? `<div class="dg-sub">${gapPair}</div>` : "");
    }
    const reps = m.papers.slice().sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
    const list = reps.slice(0, 4).map(p => `<li>${esc(trunc(p.title, 42))}</li>`).join("");
    if (m.type === "basin")                                 // a lumped branch end in the levelled styles
      return `<b>Basin of ${reps.length} papers</b>` +
        `<div class="dg-sub">deepest well ${(+m.depth).toFixed(2)} · merges below ${(+m.level).toFixed(2)}</div>` +
        `<ul class="dg-list">${list}${reps.length > 4 ? `<li>+${reps.length - 4} more…</li>` : ""}</ul>`;
    const head = m.split
      ? `barrier ${fmtBar(m.barrier)} · splits ${m.split[0]} ↔ ${m.split[1]} papers`
      : `barrier ${fmtBar(m.barrier)} · ${reps.length} papers below`;
    return `<b>${esc(m.title)}</b>` +
      `<div class="dg-sub">${head}</div>` +
      `<ul class="dg-list">${list}${reps.length > 4 ? `<li>+${reps.length - 4} more…</li>` : ""}</ul>`;
  }

  /* ---- View A: canonical disconnectivity graph (vertical: energy up the Y-axis, root at top) ---- */
  function buildDG(model, W, scores) {
    const tree = model.root;
    const leaves = leafNodes(tree);
    // FREE-ENERGY landscape (default): every node has a Boltzmann-inverted energy `fe` (leaf = its own
    // well depth, junction = the barrier separating its basins), all on one axis — a true protein-PES
    // disconnectivity graph. `val(n)` is a node's position on that axis; a paper's is its leaf fe.
    // Without `fe` (legacy payloads) we fall back to the old dendrogram: leaves at 0, junctions at the
    // cosine merge height.
    const FE = model.hasFE;
    const val = n => FE ? (n.fe || 0) : (isLeaf(n) ? 0 : (n.height || 0));
    // NOTE: in this VERTICAL view the "seat gap-closers between two works" overlay is disabled; the
    // "Highlight gap-closers" checkbox now only recolours the dots (paperStyle) by bridge score.

    // VERTICAL disconnectivity graph (classical, PELE-style symmetric): energy runs UP the Y-axis (root
    // at the top, deepest well at the bottom); leaves take evenly-spaced columns and every junction is
    // CENTRED over its children, so a balanced minimax tree draws as a balanced fan. Many papers -> the
    // shell scrolls horizontally.
    const left = 60, top = 30, colW = 42, energyH = 470, botLabel = 150, STEM = 14, rightPad = 34;
    const nCols = Math.max(1, leaves.length);
    const DW = left + nCols * colW + rightPad;         // total width (>= viewport -> horizontal scroll)
    const H = top + energyH + botLabel;
    const bottomY = top + energyH;
    const maxH = (function m(n) { return Math.max(val(n), ...kids(n).map(m)); })(tree) || 1;
    let hmin = Infinity;
    (function mn(n) { const v = val(n); if (v > 0) hmin = Math.min(hmin, v); kids(n).forEach(mn); })(tree);
    if (!isFinite(hmin)) hmin = maxH;
    const ref = (BMIN > 0 && BMIN <= hmin) ? BMIN : hmin;
    const LMARGIN = 0.05, lspan = (Math.log(maxH) - Math.log(ref)) || 1;
    const useLog = LOG && !FE;                          // free energy is ALREADY a log(prob) axis: don't re-log it
    const clampH = h => Math.max(ref, Math.min(h, maxH));
    const frac = useLog ? (e => e <= 0 ? 0 : (LMARGIN + (1 - LMARGIN) * (Math.log(clampH(e)) - Math.log(ref)) / lspan))
                        : (e => Math.min(e, maxH) / maxH);
    const yAt = e => top + (1 - frac(e)) * energyH;     // higher energy -> higher up (toward the root)

    // Layout: leaves take successive evenly-spaced columns (in-order, so subtrees stay contiguous and
    // lines never cross); a junction is placed at the MEAN x of its children — centred above them — and
    // at its own free-energy height. This is the classical symmetric disconnectivity-graph layout.
    let li = 0;
    (function lay(n, parent) {
      n._parent = parent || null;                          // for tracing a paper up to a junction on hover
      if (isLeaf(n)) { n._x = left + colW * (li++) + colW / 2; n._y = yAt(val(n)); return n._x; }
      const xs = kids(n).map(c => lay(c, n));
      n._x = xs.reduce((a, b) => a + b, 0) / xs.length;
      n._y = yAt(val(n));
      return n._x;
    })(tree, null);

    // De-collision: on a chained (caterpillar) tree two spine junctions can land at nearly the same
    // point. Nudge overlapping dots apart HORIZONTALLY only (energy/y is exact and never moved), so the
    // centred layout stays put except where dots would actually touch.
    const nodesAll = [];
    (function collect(n) { nodesAll.push(n); kids(n).forEach(collect); })(tree);
    const minSep = 15;
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < nodesAll.length; i++) for (let j = i + 1; j < nodesAll.length; j++) {
        const a = nodesAll[i], b = nodesAll[j], dy = Math.abs(a._y - b._y);
        if (dy >= minSep) continue;
        const needX = Math.sqrt(minSep * minSep - dy * dy), dx = b._x - a._x;
        if (Math.abs(dx) >= needX) continue;
        const shove = (needX - Math.abs(dx)) / 2 + 0.25, dir = dx >= 0 ? 1 : -1;
        a._x -= dir * shove; b._x += dir * shove; moved = true;
      }
      if (!moved) break;
    }

    let branches = "", dots = "", labels = "", guides = "", uid = 0;
    const meta = {};

    // GREEN minima at their own depths, RED transition-state nodes at real barriers, ANGLED branches:
    // each child rises straight along its column then a short diagonal converges into the junction (a Y
    // fork), and every junction is centred over its children (PELE-style symmetric layout). A
    // zero-barrier merge (junction pinned onto a minimum's level) draws its lines but gets no red dot.
    (function walk(n) {
      const id = "d" + (uid++);
      if (isLeaf(n)) {
        const p = n.paper || n, st = paperStyle(p, scores);
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x.toFixed(1)}" cy="${n._y.toFixed(1)}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>`;
        n._id = id;
        meta[id] = { type: "paper", node: n, paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0, fe: (FE && model.energy) ? model.energy.get(p) : null };
        guides += `<line x1="${n._x.toFixed(1)}" y1="${(n._y + 6).toFixed(1)}" x2="${n._x.toFixed(1)}" y2="${bottomY.toFixed(1)}" stroke="#e8e8e8" stroke-width="1"/>`;
        labels += `<text transform="translate(${n._x.toFixed(1)} ${(bottomY + 8).toFixed(1)}) rotate(90)" font-size="10" fill="#555">${esc(trunc(p.title, 22))}</text>`;
        return { x: n._x, y: n._y };
      }
      const cps = kids(n).map(walk).filter(Boolean);
      if (cps.length <= 1) return cps[0] || null;
      cps.forEach(a => {
        const dy = a.y - n._y;                             // child sits BELOW the (higher-energy) junction
        const sy = n._y + (dy > 4 ? Math.min(STEM, dy * 0.6) : dy);
        branches += `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${a.x.toFixed(1)} ${sy.toFixed(1)} L${n._x.toFixed(1)} ${n._y.toFixed(1)}" stroke="#111" stroke-width="1.5" fill="none"/>`;
      });
      // Red node only at a REAL transition state (strictly above both sub-basins); a zero-barrier merge
      // is just a corner within one basin, not a saddle, so it gets no dot.
      if (val(n) > Math.max(...kids(n).map(c => val(c))) + 1e-4) {
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x.toFixed(1)}" cy="${n._y.toFixed(1)}" r="5" fill="#d64545" stroke="#fff" stroke-width="1.2"/>`;
        meta[id] = { type: "gap", title: n.gap || n.concept || "Research gap", barrier: val(n), papers: leafPapers(n) };
      }
      return { x: n._x, y: n._y };
    })(tree);
    // Root stub above the top junction.
    branches += `<path d="M${tree._x.toFixed(1)} ${tree._y.toFixed(1)} V${(tree._y - 16).toFixed(1)}" stroke="#111" stroke-width="1.5" fill="none"/>`;

    // HOVER STORY for each gap-closer: the two papers it bridges, traced up their branches to the
    // junction where they meet (the barrier it holds shut). Drawn on hover by wireTooltip.
    const leafOf = new Map();
    leaves.forEach(l => leafOf.set(l.paper || l, l));
    const climb = (leaf, stop) => {                        // same angled shape as the drawn branches
      let d = "", c = leaf;
      while (c && c !== stop && c._parent) {
        const n = c._parent, dy = c._y - n._y, sy = n._y + (dy > 4 ? Math.min(STEM, dy * 0.6) : dy);
        d += `M${c._x.toFixed(1)} ${c._y.toFixed(1)} L${c._x.toFixed(1)} ${sy.toFixed(1)} L${n._x.toFixed(1)} ${n._y.toFixed(1)} `;
        c = n;
      }
      return d;
    };
    Object.values(meta).forEach(m => {
      if (m.type !== "paper" || !m.pair) return;
      const la = leafOf.get(m.pair.a), lb = leafOf.get(m.pair.b);
      if (!la || !lb) return;
      const j = lcaNode(tree, m.pair.a, m.pair.b);
      if (!j) return;
      const lab = l => ({ x: l._x, y: l._y, title: (l.paper || l).title });
      m.hl = { path: climb(la, j) + climb(lb, j), a: lab(la), b: lab(lb), self: lab(m.node), j: { x: j._x, y: j._y }, bottomY };
    });

    // Vertical energy axis (0 = deepest well at the bottom, root at the top).
    const ax = left - 16;
    const axis =
      `<line x1="${ax}" y1="${top}" x2="${ax}" y2="${bottomY}" stroke="#bbb" stroke-width="1"/>` +
      `<line x1="${ax - 4}" y1="${bottomY}" x2="${ax + 4}" y2="${bottomY}" stroke="#bbb"/>` +
      `<line x1="${ax - 4}" y1="${top}" x2="${ax + 4}" y2="${top}" stroke="#bbb"/>` +
      `<text x="${ax - 6}" y="${bottomY + 3}" text-anchor="end" font-size="10" fill="#888">0</text>` +
      `<text x="${ax - 6}" y="${top + 3}" text-anchor="end" font-size="10" fill="#888">${useLog && BMIN > 0 ? Math.log10(maxH / BMIN).toFixed(2) + " dex" : maxH.toFixed(2)}</text>` +
      `<text transform="translate(14 ${(top + energyH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="10" fill="#888">${FE ? "free energy  −ln p  ↑ (less stable / higher barrier)" : "barrier ↑ (larger gap)"}</text>`;

    return { inner: `<g class="dg-base">` + guides + branches + axis + dots + labels + `</g><g class="dg-hl" pointer-events="none"></g>`, H, meta, W: DW };
  }

  /* ---- Levelled tree (disconnectionDPS / metric-DG convention), built from the exact tree ----
     The energy axis is cut into NLEV evenly spaced levels. At each level, papers whose connecting
     barrier lies below it form one superbasin (one node). A superbasin's node at level k links to its
     sub-basins at level k-1; a branch with no sub-basins below drops to its deepest paper's own energy.
     Branches holding fewer than MINB papers are hidden. Same barriers as the exact tree; only drawn
     in steps, as the classic programs do. */
  function levelTree(model) {
    const fe = n => n.fe || 0, cache = new Map();
    const L = n => { if (!cache.has(n)) cache.set(n, leafNodes(n)); return cache.get(n); };
    let emin = Infinity;
    L(model.root).forEach(l => { emin = Math.min(emin, fe(l)); });
    const emax = fe(model.root), span = (emax - emin) || 1;
    // Axis transform: compressed = log(1 + (e - emin)/s), s = 1% of the range; linear otherwise. Levels are
    // evenly spaced in the transformed axis; frac(e) is a height in [0, 1] on that axis.
    const sc = Math.max(1e-4, 0.01 * span);
    const T = e => LOGLV ? Math.log(1 + Math.max(0, e - emin) / sc) : Math.max(0, e - emin);
    const Ti = t => LOGLV ? emin + sc * (Math.exp(t) - 1) : emin + t;
    const tmax = T(emax) || 1, stepT = tmax * 1.0001 / Math.max(1, NLEV - 1);   // top level just above the root
    const E = k => Ti(k * stepT);
    const frac = e => T(e) / tmax, at = f => Ti(f * tmax);
    const cut = (n, e) => fe(n) < e ? [n] : isLeaf(n) ? [] : kids(n).flatMap(c => cut(c, e));
    const make = (b, k) => {
      const lv = L(b), low = lv.reduce((a, c) => fe(c) < fe(a) ? c : a);
      const nd = { b, k, e: E(k), size: lv.length, low, papers: lv.map(l => l.paper || l), kids: [] };
      if (k > 0) {
        const subs = cut(b, E(k - 1)), inSub = new Set();
        subs.forEach(c => L(c).forEach(l => inSub.add(l)));
        // A minimum lying between this level and the one below is its own branch, ending at its own
        // energy (as disconnectionDPS draws it), not lumped into a basin.
        const feet = MINB > 1 ? [] : lv.filter(l => !inSub.has(l)).map(l =>
          ({ b: l, k: k - 1, e: fe(l), size: 1, low: l, papers: [l.paper || l], kids: [], foot: true }));
        nd.kids = subs.filter(c => L(c).length >= MINB).map(c => make(c, k - 1)).concat(feet);
      }
      return nd;
    };
    return { top: make(model.root, NLEV - 1), E, emin, emax, frac, at };
  }
  // Meta for a levelled node: a single paper reads like a paper; a lumped end reads as a basin.
  function levelMeta(model, nd) {
    if (nd.size === 1) {
      const p = nd.papers[0];
      return { type: "paper", paper: p, overlay: 0, overlayKind: "", reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0, fe: model.energy ? model.energy.get(p) : null };
    }
    return { type: "basin", papers: nd.papers, depth: nd.low.fe || 0, level: nd.e };
  }

  // Gap-closer hover story for the levelled styles: each bridged paper's branch end, traced up the
  // levelled tree to the level where their branches meet. pt(n) = a node's drawn point; dotPt(n) = its
  // branch end. Skipped when both papers sit in the same lumped end (no barrier separates them there).
  function levelHL(lt, meta, pt, dotPt) {
    const endOf = new Map();
    (function par(n, p) {
      n._par = p;
      if (!n.kids.length) n.papers.forEach(q => endOf.set(q, n));
      n.kids.forEach(c => par(c, n));
    })(lt.top, null);
    const seg = (u, v) => `M${u.x.toFixed(1)} ${u.y.toFixed(1)} L${v.x.toFixed(1)} ${v.y.toFixed(1)} `;
    Object.values(meta).forEach(m => {
      if (m.type !== "paper" || !m.pair) return;
      const na = endOf.get(m.pair.a), nb = endOf.get(m.pair.b), ns = endOf.get(m.paper);
      if (!na || !nb || na === nb) return;
      const anc = new Set();
      for (let c = na; c; c = c._par) anc.add(c);
      let j = nb;
      while (j && !anc.has(j)) j = j._par;
      if (!j) return;
      const climb = n => { let d = seg(dotPt(n), pt(n)), c = n; while (c !== j && c._par) { d += seg(pt(c), pt(c._par)); c = c._par; } return d; };
      const lab = (n, p) => { const q = dotPt(n); return { x: q.x, y: q.y, title: p.title }; };
      m.hl = { path: climb(na) + climb(nb), a: lab(na, m.pair.a), b: lab(nb, m.pair.b), self: ns ? lab(ns, m.paper) : null, j: pt(j), near: true };
    });
  }

  /* Textbook flat view: disconnectionDPS layout. A branch is as wide as the number of branch ends under
     it; at every split the deepest sub-basin goes in the centre and the others alternate right and left,
     so the global minimum runs down the middle. Straight lines join consecutive levels. */
  function buildLevels(model, W, scores) {
    const lt = levelTree(model), fe = n => n.fe || 0;
    const width = n => n._w || (n._w = n.kids.length ? n.kids.reduce((a, c) => a + width(c), 0) : 1);
    const slots = width(lt.top);
    const left = 60, top = 30, energyH = 500, H = top + energyH + 40, rightPad = 30;
    const colW = Math.max(7, Math.min(64, (W - left - rightPad) / slots));
    const DW = Math.max(W, left + slots * colW + rightPad);
    const x00 = Math.max(0, (DW - left - rightPad - slots * colW) / 2);   // centre a narrow tree
    const yAt = e => top + (1 - lt.frac(e)) * energyH;
    (function arrange(n, x0) {
      const ks = n.kids.slice().sort((a, b) => fe(a.low) - fe(b.low)), ord = [];
      ks.forEach((c, i) => (i === 0 || i % 2) ? ord.push(c) : ord.unshift(c));
      let x = x0;
      ord.forEach(c => { arrange(c, x); x += c._w; });
      n.kids = ord;
      n._x = ord.length ? ord.reduce((a, c) => a + c._x, 0) / ord.length : left + x00 + (x0 + 0.5) * colW;
    })(lt.top, 0);

    let lines = "", dots = "", uid = 0;
    const meta = {};
    const ln = (x1, y1, x2, y2) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#1e2a31" stroke-width="1.3" stroke-linecap="round"/>`;
    (function walk(n, runTop) {                             // runTop: where the current straight run began
      if (n.kids.length === 1 && n.kids[0]._x === n._x) { walk(n.kids[0], runTop); return; }
      const y = yAt(n.e);
      if (runTop !== y) lines += ln(n._x, runTop, n._x, y);
      n.kids.forEach(c => { lines += ln(n._x, y, c._x, yAt(c.e)); walk(c, yAt(c.e)); });
      if (!n.kids.length) {                                 // branch end: drop to its deepest paper's own energy
        const yb = yAt(fe(n.low)), id = "v" + (uid++);
        lines += `<line x1="${n._x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${n._x.toFixed(1)}" y2="${yb.toFixed(1)}" stroke="#1e2a31" stroke-width="1.3" stroke-linecap="round"/>`;
        const st = n.size === 1 ? paperStyle(n.papers[0], scores) : null;     // gap-closer tint when highlighted
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x.toFixed(1)}" cy="${yb.toFixed(1)}" r="${st ? Math.max(3, st.r - 1.5).toFixed(1) : 4}" fill="${st ? st.fill : "#6e7a82"}" stroke="#fff" stroke-width="1"/>`;
        meta[id] = levelMeta(model, n);
      } else if (n.kids.length > 1) {                       // a split: the barrier between these sub-basins
        const id = "v" + (uid++);
        dots += `<circle class="dg-node" data-id="${id}" cx="${n._x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="transparent"/>`;
        meta[id] = { type: "gap", title: "Barrier", barrier: n.e, papers: n.papers, split: n.kids.length === 2 ? [n.kids[0].size, n.kids[1].size] : null };
      }
    })(lt.top, yAt(lt.top.e));
    lines += `<line x1="${lt.top._x.toFixed(1)}" y1="${yAt(lt.top.e).toFixed(1)}" x2="${lt.top._x.toFixed(1)}" y2="${(yAt(lt.top.e) - 14).toFixed(1)}" stroke="#1e2a31" stroke-width="1.3"/>`;
    levelHL(lt, meta, n => ({ x: n._x, y: yAt(n.e) }), n => ({ x: n._x, y: yAt(n.low.fe || 0) }));
    const ax = left - 16, bottomY = top + energyH;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = top + (1 - f) * energyH;
      return `<line x1="${ax - 4}" y1="${y.toFixed(1)}" x2="${ax}" y2="${y.toFixed(1)}" stroke="#bbb"/>` +
        `<text x="${ax - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${lt.at(f).toFixed(2)}</text>`;
    }).join("");
    const axis = `<line x1="${ax}" y1="${top}" x2="${ax}" y2="${bottomY}" stroke="#bbb"/>` + ticks +
      `<text transform="translate(12 ${(top + energyH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="10" fill="#888">free energy −ln p ↑ (${NLEV} levels${LOGLV ? ", compressed axis" : ""})</text>`;
    const hint = `<text x="${left}" y="${H - 12}" font-size="10.5" fill="#999">Textbook style: energy in ${NLEV} steps${LOGLV ? " on a compressed axis" : ""}${MINB > 1 ? `, branches under ${MINB} papers hidden` : ""} · grey ends = papers with no barrier between them · exact view: untick “Levelled”</text>`;
    return { inner: `<g class="dg-base">` + axis + lines + dots + hint + `</g><g class="dg-hl" pointer-events="none"></g>`, H, meta, W: DW };
  }

  /* ---- View C: the same tree in 3D, standing on the knowledge map ----
     X, Y = each paper's position on the Topic Map; Z = free energy. Every connection and height is the
     disconnectivity tree's own. A junction (transition state) stands where its col lies: on the map
     line between the two papers whose chord carries it, the same fraction of the way along.
     Side view (tilt 0) reads like the flat graph; top view (tilt 90) is the knowledge map. */
  const R3 = Math.PI / 180;
  function fieldColour(t) {                                // same cream -> slate -> red map as the Topic Map
    t = Math.max(0, Math.min(1, t));
    const A = [251, 250, 248], B = [132, 151, 176], C = [186, 87, 87];
    const [a, b, f] = t < 0.5 ? [A, B, t / 0.5] : [B, C, (t - 0.5) / 0.5];
    return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(",") + ")";
  }
  function buildDG3(model, W, scores) {
    const tree = model.root, papers = model.papers || [], pos = model.pos;
    const H = 600, ZH = 0.8;
    let fmax = 0;
    (function m(n) { fmax = Math.max(fmax, n.fe || 0); kids(n).forEach(m); })(tree);
    fmax = fmax || 1;
    const P0 = i => (papers[i] && pos.get(papers[i])) || null;

    // World coordinates: map x,y in [0,1] (y runs down the screen on the Topic Map) -> a centred floor;
    // z = free energy scaled to ZH. Post-order, so a junction without a col can fall back on its children.
    (function place(n, parent) {
      n._parent = parent || null;
      kids(n).forEach(c => place(c, n));
      let x, y;
      if (isLeaf(n)) {
        const q = pos.get(n.paper || n);
        x = q ? q.x : 0.5; y = q ? q.y : 0.5;
      } else if (n.col && P0(n.col[0]) && P0(n.col[1])) {
        const qa = P0(n.col[0]), qb = P0(n.col[1]), t = +n.col[2] || 0;
        x = qa.x + (qb.x - qa.x) * t; y = qa.y + (qb.y - qa.y) * t;
      } else {
        const cs = kids(n);
        x = cs.reduce((a, c) => a + c._mx, 0) / cs.length; y = cs.reduce((a, c) => a + c._my, 0) / cs.length;
      }
      n._mx = x; n._my = y;
      n._w = [x - 0.5, 0.5 - y, (n.fe || 0) / fmax * ZH];
    })(tree, null);

    // Orthographic camera: turn by AZ about the vertical, then tilt by EL.
    const ca = Math.cos(AZ * R3), sa = Math.sin(AZ * R3), ce = Math.cos(EL * R3), se = Math.sin(EL * R3);
    const S = Math.min(W, H) * 0.6;
    const rot = w => { const x1 = w[0] * ca - w[1] * sa, y1 = w[0] * sa + w[1] * ca; return [x1, w[2] * ce + y1 * se, y1 * ce - w[2] * se]; };
    const c0 = rot([0, 0, ZH / 2]);
    const P = w => { const r = rot(w); return { x: W / 2 + S * (r[0] - c0[0]), y: H / 2 - S * (r[1] - c0[1]), d: r[2] }; };
    const xy = q => q.x.toFixed(1) + " " + q.y.toFixed(1);

    // Floor: the Topic Map's density field, the map border, and each paper's shadow on it.
    let floor = "";
    const grid = model.grid;
    if (grid && grid.length > 1) {
      const G = grid.length, step = Math.max(1, Math.ceil(G / 28));
      for (let r = 0; r < G - 1; r += step) for (let c = 0; c < G - 1; c += step) {
        const r1 = Math.min(G - 1, r + step), c1 = Math.min(G - 1, c + step);
        const v = (grid[r][c] + grid[r][c1] + grid[r1][c] + grid[r1][c1]) / 4;
        if (v < 0.03) continue;
        const pts = [[c, r], [c1, r], [c1, r1], [c, r1]].map(([cc, rr]) => P([cc / (G - 1) - 0.5, 0.5 - rr / (G - 1), 0]));
        const col = fieldColour(v);
        floor += `<polygon points="${pts.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" ")}" fill="${col}" stroke="${col}" stroke-width=".6" fill-opacity=".7" stroke-opacity=".7"/>`;
      }
    }
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => P([a, b, 0]));
    floor += `<polygon points="${corners.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" ")}" fill="none" stroke="#c9cfd3" stroke-width="1"/>`;

    const lines = [], dots = [], meta = {};
    let uid = 0;
    const leaves = leafNodes(tree);
    leaves.forEach(l => {                                  // shadow on the map + a faint drop line up to the well
      const top = P(l._w), sh = P([l._w[0], l._w[1], 0]);
      if (METRIC) { floor += `<circle cx="${sh.x.toFixed(1)}" cy="${sh.y.toFixed(1)}" r="2.2" fill="#8e989e"/>`; return; }
      floor += `<line x1="${sh.x.toFixed(1)}" y1="${sh.y.toFixed(1)}" x2="${top.x.toFixed(1)}" y2="${top.y.toFixed(1)}" stroke="#cdd3d7" stroke-width="1" stroke-dasharray="2 3"/>` +
               `<circle cx="${sh.x.toFixed(1)}" cy="${sh.y.toFixed(1)}" r="2.2" fill="#8e989e"/>`;
    });

    // METRIC style (optional): the levelled tree, each superbasin a vertical post standing at its deepest
    // paper's map position (Smeeton, Oakley & Wales' metric disconnectivity graph). Same barriers, drawn
    // in NLEV steps; the exact tree below stays the default.
    if (METRIC) {
      const lt = levelTree(model), z = e => lt.frac(e || 0) * ZH;
      const seg = (u, v, wdt) => lines.push({ d: (u.d + v.d) / 2, svg: `<line x1="${u.x.toFixed(1)}" y1="${u.y.toFixed(1)}" x2="${v.x.toFixed(1)}" y2="${v.y.toFixed(1)}" stroke="#1e2a31" stroke-width="${wdt}" stroke-linecap="round"/>` });
      const place3 = n => { const q0 = pos.get(n.low.paper || n.low) || { x: 0.5, y: 0.5 }; n._w3 = [q0.x - 0.5, 0.5 - q0.y, z(n.e)]; return P(n._w3); };
      (function walk(n, runTop) {                           // runTop: top of the current vertical post run
        const q = place3(n);
        if (n.kids.length === 1 && n.kids[0].low === n.low) { walk(n.kids[0], runTop || q); return; }
        if (runTop && (runTop.x !== q.x || runTop.y !== q.y)) seg(runTop, q, 1.3 + Math.min(1.7, n.size / 25));
        n.kids.forEach(c => { const cq = place3(c); seg(q, cq, 1.3 + Math.min(1.7, c.size / 25)); walk(c, cq); });
        const id = "t" + (uid++);
        if (!n.kids.length) {                               // branch end: drop to the deepest paper's own energy
          const b = P([n._w3[0], n._w3[1], z(n.low.fe)]);
          seg(q, b, 1.3);
          const st = n.size === 1 ? paperStyle(n.papers[0], scores) : null;
          dots.push({ d: b.d, svg: `<circle class="dg-node" data-id="${id}" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${st ? Math.max(3.5, st.r - 1).toFixed(1) : 4.5}" fill="${st ? st.fill : "#6e7a82"}" stroke="#fff" stroke-width="1"/>` });
          meta[id] = levelMeta(model, n);
        } else if (n.kids.length > 1) {
          dots.push({ d: q.d, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4" fill="#d64545" stroke="#fff" stroke-width="1"/>` });
          meta[id] = { type: "gap", title: "Barrier", barrier: n.e, papers: n.papers, split: n.kids.length === 2 ? [n.kids[0].size, n.kids[1].size] : null };
        }
      })(lt.top, null);
      const t0 = P(lt.top._w3), t1 = P([lt.top._w3[0], lt.top._w3[1], lt.top._w3[2] + 0.05]);
      seg(t0, t1, 1.3);
      levelHL(lt, meta, n => P(n._w3), n => P([n._w3[0], n._w3[1], z(n.low.fe)]));
    }

    // Branches (each child to its junction) and nodes, painted far to near.
    if (!METRIC) (function walk(n) {
      const id = "t" + (uid++), q = P(n._w);
      if (isLeaf(n)) {
        const p = n.paper || n, st = paperStyle(p, scores);
        n._id = id;
        dots.push({ d: q.d, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>` });
        meta[id] = { type: "paper", node: n, paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0, fe: model.energy ? model.energy.get(p) : null };
        return;
      }
      kids(n).forEach(c => {
        walk(c);
        const a = P(c._w);
        lines.push({ d: (a.d + q.d) / 2, svg: `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="#1e2a31" stroke-width="1.4" stroke-linecap="round"/>` });
      });
      if ((n.fe || 0) > Math.max(...kids(n).map(c => c.fe || 0)) + 1e-4) {
        dots.push({ d: q.d, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="5" fill="#d64545" stroke="#fff" stroke-width="1.2"/>` });
        meta[id] = { type: "gap", title: n.gap || n.concept || "Research gap", barrier: n.fe || 0, papers: leafPapers(n) };
      }
    })(tree);
    const rootTop = P([tree._w[0], tree._w[1], tree._w[2] + 0.05]), rootQ = P(tree._w);
    if (!METRIC) lines.push({ d: rootQ.d, svg: `<line x1="${rootQ.x.toFixed(1)}" y1="${rootQ.y.toFixed(1)}" x2="${rootTop.x.toFixed(1)}" y2="${rootTop.y.toFixed(1)}" stroke="#1e2a31" stroke-width="1.4"/>` });
    const paint = arr => arr.sort((u, v) => v.d - u.d).map(o => o.svg).join("");

    // Energy axis on one corner of the floor (hidden from straight above, where it collapses to a point).
    const a0 = P([-0.5, 0.5, 0]), a1 = P([-0.5, 0.5, ZH]);
    const axis = EL > 80 ? "" : `<line x1="${a0.x.toFixed(1)}" y1="${a0.y.toFixed(1)}" x2="${a1.x.toFixed(1)}" y2="${a1.y.toFixed(1)}" stroke="#9aa3a8" stroke-width="1"/>` +
      `<text x="${(a0.x - 6).toFixed(1)}" y="${(a0.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">0</text>` +
      `<text x="${(a1.x - 6).toFixed(1)}" y="${(a1.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${fmax.toFixed(2)}</text>` +
      `<text x="${(a1.x + 6).toFixed(1)}" y="${(a1.y - 6).toFixed(1)}" font-size="10" fill="#888">free energy −ln p ↑</text>`;
    const hint = `<text x="12" y="${H - 12}" font-size="10.5" fill="#999">Drag to rotate · floor = Topic Map density · ${METRIC ? `metric style: ${NLEV} energy steps${LOGLV ? " on a compressed axis" : ""}, posts at each basin's deepest paper` : "heights exact; map distances between far regions are approximate"}</text>`;

    // Hover story for each gap-closer, as in the flat view: its bridged pair traced up to their junction.
    const leafOf = new Map();
    leaves.forEach(l => leafOf.set(l.paper || l, l));
    const climb = (leaf, stop) => {
      let d = "", c = leaf;
      while (c && c !== stop && c._parent) { d += `M${xy(P(c._w))} L${xy(P(c._parent._w))} `; c = c._parent; }
      return d;
    };
    Object.values(meta).forEach(m => {
      if (m.type !== "paper" || !m.pair || !m.node) return;   // (the metric style has no exact path to trace)
      const la = leafOf.get(m.pair.a), lb = leafOf.get(m.pair.b), j = la && lb && lcaNode(tree, m.pair.a, m.pair.b);
      if (!j) return;
      const lab = l => { const q = P(l._w); return { x: q.x, y: q.y, title: (l.paper || l).title }; };
      const jq = P(j._w);
      m.hl = { path: climb(la, j) + climb(lb, j), a: lab(la), b: lab(lb), self: lab(m.node), j: { x: jq.x, y: jq.y }, near: true };
    });

    return { inner: `<g class="dg-base">` + floor + axis + paint(lines) + paint(dots) + hint + `</g><g class="dg-hl" pointer-events="none"></g>`, H, meta, W, is3d: true };
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
      meta[id] = { type: "paper", paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0 };
    });
    const hint = `<text x="12" y="${H - 12}" font-size="10" fill="#999">edge length ∝ ${LOG ? "log " : ""}gap magnitude · long / thick edge = larger gap</text>`;

    return { inner: lines + gapdots + ndots + labels + hint, H, meta, W };
  }

  /* ---- Gap-closer story on hover: dim the graph, trace the bridged pair up to their junction ---- */
  function showGap(mountEl, m) {
    const base = mountEl.querySelector(".dg-base"), layer = mountEl.querySelector(".dg-hl");
    if (!base || !layer) return;
    if (!m || !m.hl) { base.style.opacity = ""; layer.innerHTML = ""; return; }
    const h = m.hl, RED = "#d64545", INK = "#1e2a31";
    const ring = (q, col) => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="9" fill="none" stroke="${col}" stroke-width="2.5"/>` +
      `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4.5" fill="${col}"/>`;
    const title = (q, col) => h.near
      ? `<text x="${(q.x + 11).toFixed(1)}" y="${(q.y - 9).toFixed(1)}" font-size="11" font-weight="700" fill="${col}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(trunc(q.title, 40))}</text>`
      : `<text transform="translate(${q.x.toFixed(1)} ${(h.bottomY + 8).toFixed(1)}) rotate(90)" font-size="10.5" font-weight="700" fill="${col}">${esc(trunc(q.title, 22))}</text>`;
    base.style.opacity = ".22";
    layer.innerHTML =
      `<path d="${h.path}" stroke="${RED}" stroke-width="3" fill="none" stroke-linejoin="round"/>` +
      `<circle cx="${h.j.x.toFixed(1)}" cy="${h.j.y.toFixed(1)}" r="7" fill="${RED}" stroke="#fff" stroke-width="1.5"/>` +
      ring(h.a, RED) + ring(h.b, RED) + (h.self ? ring(h.self, INK) : "") +
      title(h.a, RED) + title(h.b, RED) + (h.self ? title(h.self, INK) : "");
  }

  /* ---- Shared shell: toolbar, svg wrapper, tooltip ---- */
  function wireTooltip(mountEl, meta) {
    mountEl.querySelectorAll(".dg-tip").forEach(t => t.remove());
    const tip = document.createElement("div");
    tip.className = "dg-tip";
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
      el.addEventListener("mouseenter", () => { tipBody.innerHTML = tipHTML(meta[el.dataset.id]); tip.style.display = "block"; el.setAttribute("r", (+baseR + 2).toFixed(1)); showGap(mountEl, meta[el.dataset.id]); });
      el.addEventListener("mouseleave", () => { tip.style.display = "none"; el.setAttribute("r", baseR); showGap(mountEl, null); });
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

    // Free-energy DG view: the axis IS the energy (−ln p), so the Log toggle is inert here (re-logging
    // an energy axis collapses the barriers). It stays live for MST, whose axis is cosine distance.
    if (MODE === "3d" && !model.hasFE) MODE = "dg";        // 3D needs the free-energy payload
    FEV = !!(model.hasFE && (MODE === "dg" || MODE === "3d"));
    REDUCE_FE = !!model.reduceFE;

    // Log ("dex") reference = the smallest positive barrier in the picture. Gap-closers now lift ONTO
    // real red junctions (LCA node heights ⊆ these edge weights), so the tree's own gaps are the whole
    // scale — every dex = log10(barrier / BMIN) is >= 0, and axis + tooltips share one reference.
    // In the free-energy landscape the axis IS the node energies, so the dex reference is the smallest
    // positive free energy in the picture (leaves + junctions); otherwise it's the smallest edge barrier.
    if (model.hasFE) {
      const fes = [];
      (function g(n) { if (typeof n.fe === "number" && n.fe > 0) fes.push(n.fe); (n.children || []).forEach(g); })(model.root);
      BMIN = fes.length ? Math.min(...fes) : 0;
    } else {
      const bw = (model.edges || []).map(e => e.w).filter(w => w > 0);
      BMIN = bw.length ? Math.min(...bw) : 0;
    }

    const W = Math.max(mountEl.clientWidth || 820, 360);
    // Prefer the server's faithful barrier-reduction scores; fall back to client betweenness (fixtures /
    // legacy sessions). Same {raw, norm, kind} shape either way, so both views render identically.
    // Highlight/rank by how much each paper reduces the barrier when the field has any gap-closers, so
    // the emphasised papers are exactly the ones whose tooltip shows a "holds a barrier of …" reading;
    // fall back to the total gap-closing sum, then to pure-topology betweenness (fixtures / legacy).
    const hasReduce = model.reduce && [...model.reduce.values()].some(v => v > 0);
    const scores = hasReduce ? looScores(model.reduce)
                 : (model.loo && model.loo.size) ? looScores(model.loo)
                 : bridgeScore(model);
    const need3dMap = MODE === "3d" && !(model.pos && model.pos.size);
    const built = need3dMap ? null : MODE === "mst" ? buildMST(model, W, scores) : MODE === "3d" ? buildDG3(model, W, scores)
                : (LEVELLED && model.hasFE) ? buildLevels(model, W, scores) : buildDG(model, W, scores);

    const radio = (v, lbl) =>
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">` +
      `<input type="radio" name="dgmode" class="dg-mode" value="${v}"${MODE === v ? " checked" : ""}/>${lbl}</label>`;
    const tools =
      `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:8px;` +
      `font:12px system-ui,sans-serif;color:#555">` +
      `<span style="display:inline-flex;gap:10px;align-items:center">View: ${radio("dg", "Disconnectivity")} ${radio("mst", "MST")}${model.hasFE ? " " + radio("3d", "3D on the map") : ""}</span>` +
      (MODE === "3d" ? `<span style="display:inline-flex;gap:6px">` +
        [["side", "Side"], ["top", "Top"], ["reset", "Reset"]].map(([k, l]) =>
          `<button type="button" class="dg-cam" data-cam="${k}" style="font:inherit;border:1px solid #ddd;background:#fff;border-radius:6px;padding:2px 9px;cursor:pointer">${l}</button>`).join("") +
        `</span>` : "") +
      `<label style="cursor:${FEV ? "default" : "pointer"};display:inline-flex;align-items:center;gap:6px;user-select:none${FEV ? ";opacity:.45" : ""}" title="${FEV ? "The free-energy axis is already −ln p; log scaling applies to the MST view." : ""}">` +
      `<input type="checkbox" class="dg-log"${LOG ? " checked" : ""}${FEV ? " disabled" : ""}/> ${FEV ? "Log scale (n/a — energy axis)" : "Log scale (compress large gaps)"}</label>` +
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none">` +
      `<input type="checkbox" class="dg-overlay"${OVERLAY ? " checked" : ""}/> Highlight gap-closers</label>` +
      (model.hasFE && MODE !== "mst" ? styleControls() : "") +
      `</div>`;

    // 3D needs each paper's knowledge-map position. Without a Topic Map yet, ask the page to build it
    // (free), show the loader meanwhile, and redraw when it arrives.
    if (need3dMap) {
      const wait = window.EratostLoader ? EratostLoader.block("Placing the papers on the knowledge map…", { gradient: true }) : "Placing the papers on the knowledge map…";
      mountEl.innerHTML = tools + `<div class="dg-3d-wait">${wait}</div>`;
      wireToolbar(session, mountEl);
      if (typeof window.dgEnsureMap !== "function") {
        mountEl.querySelector(".dg-3d-wait").textContent = "Open the Topic Map tab once, then come back to see the 3D view.";
      } else if (!ENSURING) {
        ENSURING = true;
        window.dgEnsureMap().then(s2 => {
          ENSURING = false;
          if (s2 && _last && _last.mountEl === mountEl) { _last.session = s2; draw(s2, mountEl); }
        }).catch(() => {
          ENSURING = false;
          const w = mountEl.querySelector(".dg-3d-wait");
          if (w) w.textContent = "Could not place the papers on the map. Open the Topic Map tab, then try again.";
        });
      }
      return;
    }

    // Draw at the layout's natural width (which may exceed the viewport) and let the shell scroll
    // horizontally, so a wide energy axis never has to squeeze nodes on top of each other.
    const DW = built.W || W;
    mountEl.innerHTML = tools +
      `<div style="overflow-x:auto;overflow-y:hidden;max-width:100%">` +
      `<svg class="dg-svg" viewBox="0 0 ${DW} ${built.H}" width="${DW}" height="${built.H}" preserveAspectRatio="xMinYMin meet" ` +
      `style="font-family:system-ui,sans-serif;display:block${built.is3d ? ";cursor:grab;touch-action:none;user-select:none" : ""}">` + built.inner + `</svg></div>`;

    wireToolbar(session, mountEl);
    wireTooltip(mountEl, built.meta);
    if (built.is3d) wire3D(mountEl, model, scores, W);
  }

  // Optional textbook styles: "Levelled" (flat view) and "Metric posts" (3D), with level count and pruning.
  function styleControls() {
    const box = (cls, on, label, title) =>
      `<label title="${title}" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none">` +
      `<input type="checkbox" class="${cls}"${on ? " checked" : ""}/> ${label}</label>`;
    const sel = (cls, cur, opts, label) =>
      `<label style="display:inline-flex;align-items:center;gap:5px">${label}<select class="${cls}" style="font:inherit">` +
      opts.map(([v, t]) => `<option value="${v}"${+v === cur ? " selected" : ""}>${t}</option>`).join("") + `</select></label>`;
    const on = MODE === "3d" ? METRIC : LEVELLED;
    return (MODE === "3d"
        ? box("dg-metric", METRIC, "Metric posts", "Metric disconnectivity graph: energy in steps, each basin a vertical post at its deepest paper")
        : box("dg-levels", LEVELLED, "Levelled (textbook)", "disconnectionDPS style: energy in steps, basins lumped per step")) +
      (on ? sel("dg-axis", LOGLV ? 1 : 0, [[1, "compressed"], [0, "linear"]], "axis") +
            sel("dg-nlev", NLEV, [[20, "20"], [40, "40"], [60, "60"], [100, "100"]], "levels") +
            sel("dg-minb", MINB, [[1, "all"], [2, "≥ 2"], [3, "≥ 3"], [5, "≥ 5"]], "branches with papers") : "");
  }

  function wireToolbar(session, mountEl) {
    const hook = (cls, fn) => { const el = mountEl.querySelector("." + cls); if (el) el.addEventListener("change", () => { fn(el); draw(session, mountEl); }); };
    hook("dg-levels", el => { LEVELLED = el.checked; });
    hook("dg-metric", el => { METRIC = el.checked; });
    hook("dg-nlev", el => { NLEV = +el.value; });
    hook("dg-minb", el => { MINB = +el.value; });
    hook("dg-axis", el => { LOGLV = el.value === "1"; });
    mountEl.querySelectorAll(".dg-mode").forEach(r =>
      r.addEventListener("change", () => { if (r.checked) { MODE = r.value; draw(session, mountEl); } }));
    const chk = mountEl.querySelector(".dg-log");
    if (chk) chk.addEventListener("change", () => { LOG = chk.checked; draw(session, mountEl); });
    const ovr = mountEl.querySelector(".dg-overlay");
    if (ovr) ovr.addEventListener("change", () => { OVERLAY = ovr.checked; draw(session, mountEl); });
  }

  // 3D: drag to turn (left/right) and tilt (up/down); Side, Top and Reset set the camera. Only the
  // picture is redrawn while dragging, so the drag keeps its grip.
  function wire3D(mountEl, model, scores, W) {
    const svg = mountEl.querySelector("svg.dg-svg");
    if (!svg) return;
    let queued = false;
    const redraw = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const b = buildDG3(model, W, scores);
        svg.innerHTML = b.inner;
        wireTooltip(mountEl, b.meta);
      });
    };
    let drag = null;
    svg.addEventListener("pointerdown", e => {
      drag = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
      svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", e => {
      if (!drag) return;
      AZ += (e.clientX - drag.x) * 0.45;
      EL = Math.max(0, Math.min(90, EL + (e.clientY - drag.y) * 0.35));
      drag = { x: e.clientX, y: e.clientY };
      redraw();
    });
    const end = () => { drag = null; svg.style.cursor = "grab"; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    mountEl.querySelectorAll(".dg-cam").forEach(btn => btn.addEventListener("click", () => {
      const k = btn.dataset.cam;
      if (k === "side") EL = 0; else if (k === "top") { EL = 90; AZ = 0; } else { AZ = -35; EL = 28; }
      redraw();
    }));
  }

  let _last = null;
  function renderDisconnectivity(session, mountEl) { _last = { session, mountEl }; draw(session, mountEl); }
  if (!window.__dgResize) {
    window.__dgResize = true;
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (_last) draw(_last.session, _last.mountEl); }, 120); });
  }
  window.renderDisconnectivity = renderDisconnectivity;
})();
