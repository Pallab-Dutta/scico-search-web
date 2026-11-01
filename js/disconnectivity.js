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
  let GC_ALT = false;    // gap-closer scoring: false = route + time (default), true = original + time
  let ADMIN = false;     // admins/developers get every view and control; everyone else a fixed setup
  let RES = 1;           // admin density: 1 / 0.75 / 0.5 = KDE bandwidth multiplier; "knn3" / "knn5" / "knn8" =
                         // kNN field in the intrinsic dimension with k neighbours. 1 = the standard landscape.
  let SIG = false;       // admin, kNN field: keep only barriers larger than 1.65x their combined error
  let FLOOR_BRIGHT = true; // 3D: keep the map floor unfaded while something is highlighted
  let FLOOR_HD = false;  // admin, 3D: colour the floor by the SAME high-dimensional free energy as the heights
                         // (interpolated between papers) instead of the Topic Map's own 2D density
  let REC = null;        // drone tool: when set, buildDG3 also records its scene in world coordinates
  let SURFACE = false;   // admin, 3D on the 2D-map landscape: draw the free-energy surface itself
  let SURF_ALPHA = 0.35; // its opacity (0..1), adjustable live
  let DRAG3D = false;    // 3D view is being turned: draw the surface on its coarse mesh
  const XY = 1;          // 3D view: x, y stretch of the map against the energy axis (1 = none)
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
    let d = session.disconnectivity;
    // Admin resolution variant: same papers, its own landscape (tree, energies, scores, gaps).
    const variants = session.disconnectivity_res || {};
    if (RES !== 1 && d && variants[String(RES)]) d = Object.assign({}, d, variants[String(RES)]);
    const hasAlt = !!(d && d.alt && d.alt.tree);
    // "Original + time" scoring (selectable): its own tree and gap-closers, same papers and energies.
    if (GC_ALT && hasAlt) d = Object.assign({}, d, d.alt);
    // Server contract (live path): {tree, papers, edges (index pairs), loo, betweenness}. JSON can't
    // carry object refs, so hydrate index-based nodes/edges back into paper-object form and key the
    // faithful leave-one-out scores by paper object.
    if (d && d.tree) {
      const papers = d.papers || [];
      // `fe` = Boltzmann-inverted FREE ENERGY (k_BT=1) on every node — leaf minima at their own well
      // depth, junctions raised to the barrier that separates their basins. Present on free-energy
      // payloads; absent (undefined) on older ones, which then render the legacy leaves-at-0 way.
      const hydrate = node => node.leaf
        ? { leaf: true, paper: papers[node.i], fe: node.fe, i: node.i }
        : { leaf: false, height: node.height, fe: node.fe, col: node.col, children: (node.children || []).map(hydrate) };
      const root = hydrate(d.tree);
      // Significance (kNN field, admin toggle): a barrier smaller than 1.65x its combined error is not a
      // barrier (Density Peak Advanced's test); post-order, so a merged junction sits at its higher child.
      const sigOn = SIG && Array.isArray(d.sigma) && typeof d.chord_sigma === "number";
      if (sigOn) (function prune(n) {
        if (n.leaf) return d.sigma[n.i] || d.chord_sigma;
        const sk = n.children.map(prune);
        let top = 0;
        n.children.forEach((c, q) => { if (c.fe > n.children[top].fe) top = q; });
        if (n.fe - n.children[top].fe < 1.65 * Math.hypot(d.chord_sigma, sk[top])) n.fe = n.children[top].fe;
        return d.chord_sigma;
      })(root);
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
      // RESEARCH GAPS = the gaps the Topic Map detected (its density valleys), as the backend placed them in
      // this landscape: the two papers each lies between (flank), the barrier there, and what a paper
      // placed at the gap would close. In 3D each stands at its exact Topic Map position.
      const rgaps = (Array.isArray(d.tm_gaps) ? d.tm_gaps : []).map((g, i) => {
        const A = papers[g.flank && g.flank[0]], B = papers[g.flank && g.flank[1]];
        if (!A || !B) return null;
        const cp = g.close_pair && papers[g.close_pair[0]] && papers[g.close_pair[1]] ? { a: papers[g.close_pair[0]], b: papers[g.close_pair[1]] } : null;
        // the highlight traces the pair whose barrier falls most if the gap is targeted (the flanking
        // pair when nothing would fall)
        return { type: "rgap", id: "rg" + i, flank: { a: A, b: B }, pair: cp || { a: A, b: B }, close: cp, name: g.label || null,
                 at: { x: +g.x, y: +g.y }, fe: +g.fe || 0, barrier: +g.barrier || 0,
                 closeMax: +g.close_max || 0, closeTotal: +g.close_total || 0,
                 closeBefore: +g.close_before || 0, closeAfter: +g.close_after || 0 };
      }).filter(Boolean).sort((u, v) => v.closeTotal - u.closeTotal);
      rgaps.forEach((r, i) => { r.num = i + 1; });
      const tmKnown = typeof d.tm_sig === "string" && d.tm_sig !== "0|";   // the Topic Map had gaps
      const estInfo = d.estimator === "knn" ? { d: d.intrinsic_dim, k: d.knn_k, kstar: d.kstar_median, sigma: d.chord_sigma } : null;
      return { root, edges, loo, reduce, reducePair, energy, hasFE, reduceFE, papers, pos, grid: tm && tm.grid, surface: d.fe_surface || null, hasAlt, rgaps, estInfo,
               estKind: d.estimator || "kde", tmKnown, hasTopic: !!(tm && Array.isArray(tm.points)) };
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
    if (m.type === "rgap")
      return `<b>Research gap G${m.num}${m.name ? ": " + esc(m.name) : ""}</b>` +
        `<div class="dg-sub">found on the Topic Map · lies between “${esc(trunc(m.flank.a.title, 40))}” and “${esc(trunc(m.flank.b.title, 40))}”${m.close ? "" : " (highlighted)"} · barrier ${(+m.barrier).toFixed(2)}</div>` +
        (m.close ? `<div class="dg-sub">if targeted: a paper here would lower the barrier between “${esc(trunc(m.close.a.title, 40))}” and “${esc(trunc(m.close.b.title, 40))}” the most (highlighted), from ${(+m.closeBefore).toFixed(2)} to ${(+m.closeAfter).toFixed(2)} · total fall across the field ${(+m.closeTotal).toFixed(1)}</div>`
                 : `<div class="dg-sub">if targeted: no barrier would fall. ${noFallWhy(m)}</div>`);
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
    (model.rgaps || []).forEach(r => { meta[r.id] = r; });   // research gaps trace their two basins
    Object.values(meta).forEach(m => {
      if ((m.type !== "paper" && m.type !== "rgap") || !m.pair) return;
      const la = leafOf.get(m.pair.a), lb = leafOf.get(m.pair.b);
      if (!la || !lb) return;
      const j = lcaNode(tree, m.pair.a, m.pair.b);
      if (!j) return;
      const lab = l => ({ x: l._x, y: l._y, title: (l.paper || l).title });
      m.hl = { path: climb(la, j) + climb(lb, j), a: lab(la), b: lab(lb), self: m.node ? lab(m.node) : null, j: { x: j._x, y: j._y }, bottomY };
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
  function levelHL(lt, meta, pt, dotPt, rgaps) {
    (rgaps || []).forEach(r => { meta[r.id] = r; });
    const endOf = new Map();
    (function par(n, p) {
      n._par = p;
      if (!n.kids.length) n.papers.forEach(q => endOf.set(q, n));
      n.kids.forEach(c => par(c, n));
    })(lt.top, null);
    const seg = (u, v) => `M${u.x.toFixed(1)} ${u.y.toFixed(1)} L${v.x.toFixed(1)} ${v.y.toFixed(1)} `;
    Object.values(meta).forEach(m => {
      if ((m.type !== "paper" && m.type !== "rgap") || !m.pair) return;
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
    levelHL(lt, meta, n => ({ x: n._x, y: yAt(n.e) }), n => ({ x: n._x, y: yAt(n.low.fe || 0) }), model.rgaps);
    const ax = left - 16, bottomY = top + energyH;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = top + (1 - f) * energyH;
      return `<line x1="${ax - 4}" y1="${y.toFixed(1)}" x2="${ax}" y2="${y.toFixed(1)}" stroke="#bbb"/>` +
        `<text x="${ax - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${lt.at(f).toFixed(2)}</text>`;
    }).join("");
    const axis = `<line x1="${ax}" y1="${top}" x2="${ax}" y2="${bottomY}" stroke="#bbb"/>` + ticks +
      `<text transform="translate(12 ${(top + energyH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="10" fill="#888">free energy −ln p ↑ (${NLEV} levels${LOGLV ? ", compressed axis" : ""})</text>`;
    const hint = `<text x="${left}" y="${H - 12}" font-size="10.5" fill="#999">Textbook style: energy in ${NLEV} steps${LOGLV ? " on a compressed axis" : ""}${MINB > 1 ? `, branches under ${MINB} papers hidden` : ""} · grey ends = papers with no barrier between them${ADMIN ? " · exact view: untick “Levelled”" : ""}</text>`;
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
  // Floor from the SAME free energy as the heights: on a G x G grid over the map, a Gaussian-weighted
  // average of nearby papers' well depths (bandwidth = median nearest-neighbour distance on the map),
  // turned into the floor's 0..1 "dense" scale (deepest well = 1). Where no paper is near, the
  // coverage weight fades the value to 0: the high-dimensional surface is empty there too.
  const HDF = new WeakMap();
  function hdFloor(model) {
    if (HDF.has(model)) return HDF.get(model);
    const g = hdFloor0(model);
    HDF.set(model, g);
    return g;
  }
  function hdFloor0(model) {
    const pts = [];
    (model.papers || []).forEach(p => {
      const q = model.pos && model.pos.get(p), f = model.energy && model.energy.get(p);
      if (q && typeof f === "number") pts.push([q.x, q.y, f]);
    });
    if (pts.length < 2) return model.grid;
    const nn = pts.map((a, i) => Math.min(...pts.map((b, j) => i === j ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1]))));
    const sorted = nn.slice().sort((a, b) => a - b), bw = Math.max(0.03, sorted[Math.floor(sorted.length / 2)]);
    const fs = pts.map(p => p[2]), fmin = Math.min(...fs), fmax = Math.max(...fs), span = (fmax - fmin) || 1;
    const G = 40, out = [];
    for (let r = 0; r < G; r++) {
      const y = r / (G - 1), row = [];
      for (let c = 0; c < G; c++) {
        const x = c / (G - 1);
        let ws = 0, wf = 0;
        pts.forEach(([px, py, f]) => { const w = Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * bw * bw)); ws += w; wf += w * f; });
        const t = ws > 1e-9 ? 1 - (wf / ws - fmin) / span : 0;          // deep well -> 1, shallow -> 0
        row.push(Math.max(0, Math.min(1, t * Math.min(1, ws))));        // fade out away from every paper
      }
      out.push(row);
    }
    return out;
  }

  // Bicubic (Catmull-Rom) upsampling of a square grid, f times finer; cached per grid.
  const UPS = new WeakMap();
  function upsampled(g, f) {
    if (f <= 1) return g;
    let c = UPS.get(g);
    if (!c) UPS.set(g, c = {});
    if (c[f]) return c[f];
    const G = g.length, M = (G - 1) * f + 1, out = [];
    const at = (r, cc) => +g[Math.max(0, Math.min(G - 1, r))][Math.max(0, Math.min(G - 1, cc))] || 0;
    const cub = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    for (let i = 0; i < M; i++) {
      const y = i / f, r = Math.min(G - 2, Math.floor(y)), ty = y - r, row = new Float64Array(M);
      for (let j = 0; j < M; j++) {
        const x = j / f, cc = Math.min(G - 2, Math.floor(x)), tx = x - cc;
        const col = q => cub(at(r + q, cc - 1), at(r + q, cc), at(r + q, cc + 1), at(r + q, cc + 2), tx);
        row[j] = cub(col(-1), col(0), col(1), col(2), ty);
      }
      out.push(row);
    }
    return (c[f] = out);
  }
  // The floor density as an image (4x finer than its grid, bicubic), cached per grid.
  const FLOORIMG = new WeakMap();
  function floorImage(grid) {
    let fi = FLOORIMG.get(grid);
    if (fi) return fi;
    const U = upsampled(grid, 4), M = U.length;
    const cv = document.createElement("canvas");
    cv.width = M; cv.height = M;
    const cx = cv.getContext("2d"), img = cx.createImageData(M, M);
    for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
      const v = Math.max(0, Math.min(1, U[r][c])), m = fieldColour(v).match(/\d+/g).map(Number), o = (r * M + c) * 4;
      img.data[o] = m[0]; img.data[o + 1] = m[1]; img.data[o + 2] = m[2];
      img.data[o + 3] = Math.round(255 * Math.max(0, Math.min(1, (v - 0.02) / 0.05)));   // empty map stays clear
    }
    cx.putImageData(img, 0, 0);
    fi = { url: cv.toDataURL("image/png"), M };
    FLOORIMG.set(grid, fi);
    return fi;
  }
  // The ENDLESS LANDSCAPE of the 2D-map density (map2d): F(x) = -ln p(x) - (deepest well), with the same
  // Gaussian density (bandwidth DENSITY_BW = 0.09 on the Topic Map) the backend reads the wells and cols
  // from, so it matches fe_surface and the tree exactly, but on a grid reaching R map units past the map
  // on every side (fine over the papers, coarser outward). Far from every paper F grows without bound, so
  // it is levelled off smoothly into a high plain a little above the top barrier: a soft minimum with
  // cap = 1.3 x top (changes F below the top barrier by < 0.2 %). Heights follow this view's energy axis.
  function landAxis(R) {
    const a = [], h = 1 / 80;
    for (let v = -0.15; v <= 1.15 + 1e-9; v += h) a.push(+v.toFixed(5));
    let st = h, lo = a[0], hi = a[a.length - 1];
    while (lo > -R) { st *= 1.22; lo = Math.max(-R, lo - st); a.unshift(lo); }
    st = h;
    while (hi < 1 + R) { st *= 1.22; hi = Math.min(1 + R, hi + st); a.push(hi); }
    return a;
  }
  const LANDF = new WeakMap();
  function landF(model, R) {                              // raw -ln p - (deepest well) on the grid; cached
    const sf = model.surface;
    let c = LANDF.get(sf);
    if (!c) LANDF.set(sf, c = {});
    if (c[R]) return c[R];
    const pts = [];
    (model.papers || []).forEach(p => { const q = model.pos && model.pos.get(p); if (q) pts.push([q.x, q.y]); });
    const bw = +(sf && sf.bw) || 0.09, inv = 1 / (2 * bw * bw);
    const nlp = (x, y) => {                              // -ln sum_i exp(-|x - x_i|^2 / 2h^2)
      let m = -Infinity;
      const v = pts.map(([px, py]) => { const e = -((x - px) ** 2 + (y - py) ** 2) * inv; if (e > m) m = e; return e; });
      let s = 0;
      v.forEach(e => { s += Math.exp(e - m); });
      return -(m + Math.log(s));
    };
    const fmin = Math.min(...pts.map(([x, y]) => nlp(x, y)));
    const xs = landAxis(R), ys = xs;
    const F = ys.map(y => xs.map(x => nlp(x, y) - fmin));
    return (c[R] = { xs, ys, F });
  }
  function landscape(model, zOfFe, top, ZH, R, plain) {
    const L = landF(model, R), cap = 1.3 * top, sm = 0.08 * top || 0.01, zTop = zOfFe(top);
    const soft = e => { const m = Math.min(e, cap); return m - sm * Math.log(Math.exp(-(e - m) / sm) + Math.exp(-(cap - m) / sm)); };
    let zmax = 0;
    const z = [], t = [], sc = [];
    L.F.forEach(row => {
      const zr = [], tr = [], sr = [];
      row.forEach(e => {
        const h = soft(Math.max(0, e)), zz = h <= top ? zOfFe(h) : zTop + (h - top) / top * ZH;
        zr.push(+zz.toFixed(5));
        tr.push(+((plain ? 0.14 : 0) + (plain ? 0.86 : 1) * Math.max(0, 1 - h / top)).toFixed(4));   // plain: light slate, not white
        sr.push((top - Math.max(0, e)) / top);           // > 0 below the top barrier (kept when cut)
        if (zz > zmax) zmax = zz;
      });
      z.push(zr); t.push(tr); sc.push(sr);
    });
    return plain ? { xs: L.xs, ys: L.ys, z, t, zmax } : { xs: L.xs, ys: L.ys, z, t, zmax, s: sc };
  }

  const LIGHT3 = (() => { const v = [-0.45, 0.35, 0.82], l = Math.hypot(...v); return v.map(x => x / l); })();
  function shadeRGB(t, k) {                               // the field colour at t, lit by factor k
    const m = fieldColour(t).match(/\d+/g).map(Number);
    return "rgb(" + m.map(x => Math.min(255, Math.round(x * k))).join(",") + ")";
  }

  // Contour lines (marching squares) of a G x G field in [0, 1]^2 (row = y), at fixed levels; cached per
  // field. Returns segments [x1, y1, x2, y2] in map coordinates.
  const CONTOURS = new WeakMap();
  function contourSegs(grid) {
    if (CONTOURS.has(grid)) return CONTOURS.get(grid);
    const G = grid.length, segs = [], levels = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9], k = 1 / (G - 1);
    for (let r = 0; r < G - 1; r++) for (let c = 0; c < G - 1; c++) {
      const v = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]];
      const P4 = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      levels.forEach(L => {
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = e, b = (e + 1) % 4;
          if ((v[a] < L) !== (v[b] < L)) {
            const t = (L - v[a]) / (v[b] - v[a]);
            pts.push([(P4[a][0] + t * (P4[b][0] - P4[a][0])) * k, (P4[a][1] + t * (P4[b][1] - P4[a][1])) * k]);
          }
        }
        if (pts.length >= 2) segs.push([...pts[0], ...pts[1]]);
        if (pts.length === 4) segs.push([...pts[2], ...pts[3]]);
      });
    }
    CONTOURS.set(grid, segs);
    return segs;
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
    // The map is drawn XY times wider than it is deep in energy (x, y stretched; heights unchanged).
    const P = w => { const r = rot([w[0] * XY, w[1] * XY, w[2]]); return { x: W / 2 + S * (r[0] - c0[0]), y: H / 2 - S * (r[1] - c0[1]), d: r[2], w }; };
    const xy = q => q.x.toFixed(1) + " " + q.y.toFixed(1);
    const flo = [];                                       // drone tool: floor-level marks (paper shadows)

    // Floor: the Topic Map's density field, the map border, and each paper's shadow on it.
    let floor = "";
    const grid = FLOOR_HD ? hdFloor(model) : model.grid;
    if (grid && grid.length > 1) {
      // The floor is a flat plane and this camera is orthographic, so the plane maps to the screen by an
      // affine transform: draw the density as ONE smoothly interpolated image instead of tiles.
      const fi = floorImage(grid), h = 0.5 / (fi.M - 1);
      const O = P([-0.5 - h, 0.5 + h, 0]), Ux = P([0.5 + h, 0.5 + h, 0]), Vy = P([-0.5 - h, -0.5 - h, 0]), n = 100;
      floor += `<image href="${fi.url}" x="0" y="0" width="${n}" height="${n}" preserveAspectRatio="none" opacity=".7" ` +
        `transform="matrix(${((Ux.x - O.x) / n).toFixed(4)} ${((Ux.y - O.y) / n).toFixed(4)} ${((Vy.x - O.x) / n).toFixed(4)} ${((Vy.y - O.y) / n).toFixed(4)} ${O.x.toFixed(2)} ${O.y.toFixed(2)})"/>`;
    }
    if (grid && grid.length > 1)                          // contour lines of the floor's field
      floor += contourSegs(grid).map(([x1, y1, x2, y2]) => {
        const u = P([x1 - 0.5, 0.5 - y1, 0]), v = P([x2 - 0.5, 0.5 - y2, 0]);
        return `<line x1="${u.x.toFixed(1)}" y1="${u.y.toFixed(1)}" x2="${v.x.toFixed(1)}" y2="${v.y.toFixed(1)}" stroke="#55626a" stroke-opacity=".55" stroke-width=".8"/>`;
      }).join("");
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => P([a, b, 0]));
    floor += `<polygon points="${corners.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" ")}" fill="none" stroke="#c9cfd3" stroke-width="1"/>`;

    const lines = [], dots = [], meta = {};
    let uid = 0;
    const leaves = leafNodes(tree);
    leaves.forEach(l => {                                  // shadow on the map + a faint drop line up to the well
      const top = P(l._w), sh = P([l._w[0], l._w[1], 0]);
      flo.push({ k: "dot", p: [l._w[0], l._w[1], 0], r: 2.2, fill: "#8e989e" });
      if (!METRIC) flo.push({ k: "line", a: [l._w[0], l._w[1], 0], b: l._w, c: "#cdd3d7", w: 1, dash: [2, 3] });
      if (METRIC) { floor += `<circle cx="${sh.x.toFixed(1)}" cy="${sh.y.toFixed(1)}" r="2.2" fill="#8e989e"/>`; return; }
      floor += `<line x1="${sh.x.toFixed(1)}" y1="${sh.y.toFixed(1)}" x2="${top.x.toFixed(1)}" y2="${top.y.toFixed(1)}" stroke="#cdd3d7" stroke-width="1" stroke-dasharray="2 3"/>` +
               `<circle cx="${sh.x.toFixed(1)}" cy="${sh.y.toFixed(1)}" r="2.2" fill="#8e989e"/>`;
    });

    // METRIC style (optional): the levelled tree, each superbasin a vertical post standing at its deepest
    // paper's map position (Smeeton, Oakley & Wales' metric disconnectivity graph). Same barriers, drawn
    // in NLEV steps; the exact tree below stays the default.
    let zOfFe = e => (e || 0) / fmax * ZH;                // height of an energy on this view's axis
    if (METRIC) {
      const lt = levelTree(model), z = e => lt.frac(e || 0) * ZH;
      zOfFe = z;
      const seg = (u, v, wdt) => lines.push({ d: (u.d + v.d) / 2, g: { k: "line", a: u.w, b: v.w, c: "#1e2a31", w: wdt }, svg: `<line x1="${u.x.toFixed(1)}" y1="${u.y.toFixed(1)}" x2="${v.x.toFixed(1)}" y2="${v.y.toFixed(1)}" stroke="#1e2a31" stroke-width="${wdt}" stroke-linecap="round"/>` });
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
          dots.push({ d: b.d, g: { k: "dot", p: b.w, r: st ? Math.max(3.5, st.r - 1) : 4.5, fill: st ? st.fill : "#6e7a82", stroke: "#fff", sw: 1 },
            svg: `<circle class="dg-node" data-id="${id}" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${st ? Math.max(3.5, st.r - 1).toFixed(1) : 4.5}" fill="${st ? st.fill : "#6e7a82"}" stroke="#fff" stroke-width="1"/>` });
          meta[id] = levelMeta(model, n);
        } else if (n.kids.length > 1) {
          dots.push({ d: q.d, g: { k: "dot", p: q.w, r: 4, fill: "#d64545", stroke: "#fff", sw: 1 }, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4" fill="#d64545" stroke="#fff" stroke-width="1"/>` });
          meta[id] = { type: "gap", title: "Barrier", barrier: n.e, papers: n.papers, split: n.kids.length === 2 ? [n.kids[0].size, n.kids[1].size] : null };
        }
      })(lt.top, null);
      const t0 = P(lt.top._w3), t1 = P([lt.top._w3[0], lt.top._w3[1], lt.top._w3[2] + 0.05]);
      seg(t0, t1, 1.3);
      levelHL(lt, meta, n => P(n._w3), n => P([n._w3[0], n._w3[1], z(n.low.fe)]), model.rgaps);
    }

    // The free-energy SURFACE (admin, 2D-map landscape): the same -ln p the wells and cols are read off,
    // at the heights of this view's axis, cut off above the top barrier. Interpolated to a finer mesh
    // (bicubic; the coarse mesh while dragging), softly lit, and drawn as ONE translucent sheet so no
    // seams or mesh lines show. Tree parts the sheet hides are drawn under it, the rest on top.
    const sf = model.surface;
    let surfSheet = "", hasSurf = false, surfH = null, land = null;
    const glOn = !!(window.Drone && window.Drone.glSurface);
    if (SURFACE && sf && Array.isArray(sf.z) && sf.z.length > 1 && glOn) {
      // Smooth-shaded with WebGL in this view's own (orthographic) projection and laid in as one image;
      // cut exactly where it reaches the top barrier (per pixel), as before.
      land = landscape(model, zOfFe, fmax, ZH, 0);
      const o3 = P([0, 0, 0]), ex = P([1, 0, 0]), ey = P([0, 1, 0]), ez = P([0, 0, 1]);
      const lin = key => [ex[key] - o3[key], ey[key] - o3[key], ez[key] - o3[key], o3[key]];
      const Lx = lin("x"), Ly = lin("y"), Ld = lin("d");
      const xs = land.xs, ds = [];
      [xs[0] - 0.5, xs[xs.length - 1] - 0.5].forEach(x => [0.5 - xs[0], 0.5 - xs[xs.length - 1]].forEach(y => [0, land.zmax].forEach(z =>
        ds.push(Ld[0] * x + Ld[1] * y + Ld[2] * z + Ld[3]))));
      const dmin = Math.min(...ds) - 0.01, dmax = Math.max(...ds) + 0.01, dk = 2 / (dmax - dmin);
      const dpr = DRAG3D ? 1 : Math.min(2, window.devicePixelRatio || 1);
      // screen (x, y, d) -> clip: X = 2x/W - 1, Y = 1 - 2y/H, Z = 2(d - dmin)/(dmax - dmin) - 1
      const row = (L, a, b) => [L[0] * a, L[1] * a, L[2] * a, L[3] * a + b];
      const RX = row(Lx, 2 / W, -1), RY = row(Ly, -2 / H, 1), RZ = row(Ld, dk, -1 - dmin * dk);
      const M = [RX[0], RY[0], RZ[0], 0, RX[1], RY[1], RZ[1], 0, RX[2], RY[2], RZ[2], 0, RX[3], RY[3], RZ[3], 1];
      const cv = window.Drone.glSurface(land, M, Math.round(W * dpr), Math.round(H * dpr), { k: XY, cut: true });
      if (cv) {
        hasSurf = true;
        surfSheet = `<image href="${cv.toDataURL("image/png")}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" style="opacity:var(--dg-sa)" pointer-events="none"/>`;
      }
    }
    if (!hasSurf && SURFACE && sf && Array.isArray(sf.z) && sf.z.length > 1) {   // no WebGL: the SVG mesh
      hasSurf = true;
      const top = fmax, U = upsampled(sf.z, DRAG3D ? 1 : 2), M = U.length, k = 1 / (M - 1);
      const E = U.map(row => Array.from(row, e => Math.min(top, Math.max(0, e))));
      const Zw = E.map(row => row.map(e => zOfFe(e)));
      const Q = Zw.map((row, r) => row.map((z, c) => P([c * k - 0.5, 0.5 - r * k, z])));
      const tiles = [];
      for (let r = 0; r < M - 1; r++) for (let c = 0; c < M - 1; c++) {
        const cr = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]], uv = cr.map(([i, j]) => U[i][j]);
        if (Math.min(...uv) >= top) continue;               // wholly above the top barrier
        let q4 = cr.map(([i, j]) => Q[i][j]);
        if (Math.max(...uv) > top) {                        // rim cell: cut exactly where the surface reaches the top
          q4 = [];
          for (let e = 0; e < 4; e++) {
            const [i0, j0] = cr[e], [i1, j1] = cr[(e + 1) % 4], u0 = uv[e], u1 = uv[(e + 1) % 4];
            if (u0 < top) q4.push(Q[i0][j0]);
            if ((u0 < top) !== (u1 < top)) {
              const f = (top - u0) / (u1 - u0), ii = i0 + (i1 - i0) * f, jj = j0 + (j1 - j0) * f;
              q4.push(P([jj * k - 0.5, 0.5 - ii * k, zOfFe(top)]));
            }
          }
        }
        const z00 = Zw[r][c], z01 = Zw[r][c + 1], z10 = Zw[r + 1][c], z11 = Zw[r + 1][c + 1];
        const dzx = ((z01 - z00) + (z11 - z10)) / 2 / (k * XY), dzy = -((z10 - z00) + (z11 - z01)) / 2 / (k * XY);
        const nl = Math.hypot(dzx, dzy, 1), lit = Math.max(0, (-dzx * LIGHT3[0] - dzy * LIGHT3[1] + LIGHT3[2]) / nl);
        const e = (E[r][c] + E[r][c + 1] + E[r + 1][c + 1] + E[r + 1][c]) / 4;
        const col = shadeRGB(1 - e / top, 0.8 + 0.28 * lit);
        tiles.push({ d: q4.reduce((t, q) => t + q.d, 0) / q4.length,
          svg: `<polygon points="${q4.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" ")}" fill="${col}" stroke="${col}" stroke-width=".7"/>` });
      }
      surfSheet = `<g style="opacity:var(--dg-sa)" pointer-events="none">` + tiles.sort((a, b) => b.d - a.d).map(o => o.svg).join("") + `</g>`;
      const G = sf.z.length;                              // surface heights (coarse grid) for the hiding test
      surfH = { G, z: sf.z.map(row => row.map(e => (+e || 0) >= top ? null : zOfFe(Math.max(0, +e || 0)))) };
    }

    // Branches (each child to its junction) and nodes, painted far to near.
    if (!METRIC) (function walk(n) {
      const id = "t" + (uid++), q = P(n._w);
      if (isLeaf(n)) {
        const p = n.paper || n, st = paperStyle(p, scores);
        n._id = id;
        dots.push({ d: q.d, g: { k: "dot", p: q.w, r: st.r, fill: st.fill, stroke: "#fff", sw: 1.2 }, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>` });
        meta[id] = { type: "paper", node: n, paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0, fe: model.energy ? model.energy.get(p) : null };
        return;
      }
      kids(n).forEach(c => {
        walk(c);
        const a = P(c._w);
        lines.push({ d: (a.d + q.d) / 2, g: { k: "line", a: a.w, b: q.w, c: "#1e2a31", w: 1.4 }, svg: `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="#1e2a31" stroke-width="1.4" stroke-linecap="round"/>` });
      });
      if ((n.fe || 0) > Math.max(...kids(n).map(c => c.fe || 0)) + 1e-4) {
        dots.push({ d: q.d, g: { k: "dot", p: q.w, r: 5, fill: "#d64545", stroke: "#fff", sw: 1.2 }, svg: `<circle class="dg-node" data-id="${id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="5" fill="#d64545" stroke="#fff" stroke-width="1.2"/>` });
        meta[id] = { type: "gap", title: n.gap || n.concept || "Research gap", barrier: n.fe || 0, papers: leafPapers(n) };
      }
    })(tree);
    const rootTop = P([tree._w[0], tree._w[1], tree._w[2] + 0.05]), rootQ = P(tree._w);
    if (!METRIC) lines.push({ d: rootQ.d, g: { k: "line", a: rootQ.w, b: rootTop.w, c: "#1e2a31", w: 1.4 }, svg: `<line x1="${rootQ.x.toFixed(1)}" y1="${rootQ.y.toFixed(1)}" x2="${rootTop.x.toFixed(1)}" y2="${rootTop.y.toFixed(1)}" stroke="#1e2a31" stroke-width="1.4"/>` });
    const paint = arr => arr.sort((u, v) => v.d - u.d).map(o => o.svg).join("");

    // Energy axis on one corner of the floor (hidden from straight above, where it collapses to a point).
    const a0 = P([-0.5, 0.5, 0]), a1 = P([-0.5, 0.5, ZH]);
    const axis = EL > 80 ? "" : `<line x1="${a0.x.toFixed(1)}" y1="${a0.y.toFixed(1)}" x2="${a1.x.toFixed(1)}" y2="${a1.y.toFixed(1)}" stroke="#9aa3a8" stroke-width="1"/>` +
      `<text x="${(a0.x - 6).toFixed(1)}" y="${(a0.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">0</text>` +
      `<text x="${(a1.x - 6).toFixed(1)}" y="${(a1.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${fmax.toFixed(2)}</text>` +
      `<text x="${(a1.x + 6).toFixed(1)}" y="${(a1.y - 6).toFixed(1)}" font-size="10" fill="#888">free energy −ln p ↑</text>`;
    const hint = `<text x="12" y="${H - 12}" font-size="10.5" fill="#999">Drag to rotate · floor = ${FLOOR_HD ? "free energy of the heights, interpolated between papers" : "Topic Map density"} · ${METRIC ? `metric style: ${NLEV} energy steps${LOGLV ? " on a compressed axis" : ""}, posts at each basin's deepest paper` : model.estKind === "map2d" ? "landscape of the 2D map itself: heights and floor are one surface" : "heights exact; map distances between far regions are approximate"}${hasSurf ? " · surface = −ln p of the 2D map" : ""}</text>`;

    // Hover story for each gap-closer, as in the flat view: its bridged pair traced up to their junction.
    const leafOf = new Map();
    leaves.forEach(l => leafOf.set(l.paper || l, l));
    const climb = (leaf, stop) => {
      let d = "", c = leaf;
      while (c && c !== stop && c._parent) { d += `M${xy(P(c._w))} L${xy(P(c._parent._w))} `; c = c._parent; }
      return d;
    };
    if (!METRIC) (model.rgaps || []).forEach(r => { meta[r.id] = r; });
    Object.values(meta).forEach(m => {
      if (METRIC) return;                                     // the metric style traced its own paths above
      if (!((m.type === "paper" && m.node) || m.type === "rgap") || !m.pair) return;
      const la = leafOf.get(m.pair.a), lb = leafOf.get(m.pair.b), j = la && lb && lcaNode(tree, m.pair.a, m.pair.b);
      if (!j) return;
      const lab = l => { const q = P(l._w); return { x: q.x, y: q.y, title: (l.paper || l).title }; };
      const jq = P(j._w);
      m.hl = { path: climb(la, j) + climb(lb, j), a: lab(la), b: lab(lb), self: m.node ? lab(m.node) : null, j: { x: jq.x, y: jq.y, w: jq.w }, near: true };
    });
    // Research gaps stand at their exact Topic Map position, at the height of the barrier they sit in,
    // with a dashed link to the tree junction where their two papers meet.
    Object.values(meta).forEach(m => {
      if (m.type !== "rgap" || !m.hl || !m.at) return;
      const q = P([m.at.x - 0.5, 0.5 - m.at.y, zOfFe(m.fe)]);
      if (REC) flo.push({ k: "gap", p: q.w, j: m.hl.j.w || null, label: "G" + m.num });
      m.hl.junction = { x: m.hl.j.x, y: m.hl.j.y };
      m.hl.link = { x1: m.hl.j.x, y1: m.hl.j.y, x2: q.x, y2: q.y };
      m.hl.j = { x: q.x, y: q.y };
    });
    // Projection onto the map plane, drawn when highlighted: from each highlighted paper (and the gap)
    // straight down to its own spot on the Topic Map.
    const floorOf = q => q ? P([q.x - 0.5, 0.5 - q.y, 0]) : null;
    Object.values(meta).forEach(m => {
      if (!m.hl) return;
      const drops = [];
      const add = (top, mq) => { const f = floorOf(mq); if (top && f) drops.push({ x1: top.x, y1: top.y, x2: f.x, y2: f.y }); };
      if (m.pair) { add(m.hl.a, pos.get(m.pair.a)); add(m.hl.b, pos.get(m.pair.b)); }
      if (m.hl.self && m.paper) add(m.hl.self, pos.get(m.paper));
      if (m.type === "rgap" && m.at) add(m.hl.j, m.at);
      m.hl.drops = drops;
    });

    if (REC) {                                             // drone tool: the whole scene in world coordinates
      const ZS = sf && Array.isArray(sf.z) && sf.z.length > 1 ? sf.z : null;
      REC.scene = {
        v: 1, ZH, top: zOfFe(fmax),
        floor: grid && grid.length > 1 ? grid : null,
        contours: grid && grid.length > 1 ? contourSegs(grid) : [],
        surface: ZS ? landscape(model, zOfFe, fmax, ZH, 6, true) : null,   // endless plain, 6 map widths out
        flat: flo.filter(o => o.k !== "gap"),
        prims: [...lines, ...dots].map(o => o.g).filter(Boolean).concat(flo.filter(o => o.k === "gap")),
      };
    }
    // The floor sits outside the layer that fades on highlight when FLOOR_BRIGHT is on, so the map stays clear.
    // With the surface on, everything is painted together in depth order (nodes win ties: they sit on it).
    let body = paint(lines) + paint(dots);
    if (hasSurf) {
      // Hidden = the line of sight from the point toward the viewer passes under the surface.
      const vx = -XY * sa * ce, vy = -XY * ca * ce, vz = se, vl = Math.hypot(vx, vy, vz) || 1;
      const hAt = (x, y) => {
        if (!surfH) return null;
        const G = surfH.G, mx = x + 0.5, my = 0.5 - y;
        if (mx < 0 || mx > 1 || my < 0 || my > 1) return null;
        const c = mx * (G - 1), r = my * (G - 1), c0 = Math.min(G - 2, Math.floor(c)), r0 = Math.min(G - 2, Math.floor(r)), fc = c - c0, fr = r - r0;
        const a = surfH.z[r0][c0], b = surfH.z[r0][c0 + 1], cc = surfH.z[r0 + 1][c0], dd = surfH.z[r0 + 1][c0 + 1];
        if (a == null || b == null || cc == null || dd == null) return null;
        return (a * (1 - fc) + b * fc) * (1 - fr) + (cc * (1 - fc) + dd * fc) * fr;
      };
      const zCap = ZH, reach = land ? 0.65 : 0.5;
      const hz0 = land ? ((x, y) => window.Drone.surfaceZ({ surface: { xs: land.xs, ys: land.ys, z: land.s } }, x, y) < 0 ? null
                                  : window.Drone.surfaceZ({ surface: land }, x, y)) : hAt;
      const hidden = w => {
        for (let i = 1; i <= 90; i++) {
          const t = i * 0.025, x = w[0] + vx / vl * t / XY, y = w[1] + vy / vl * t / XY, z = w[2] + vz / vl * t;
          if (z > zCap + 0.01 || Math.abs(x) > reach || Math.abs(y) > reach) return false;
          const hz = hz0(x, y);
          if (hz != null && z < hz - 0.004) return true;
        }
        return false;
      };
      const mid = g => g.k === "line" ? [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, (g.a[2] + g.b[2]) / 2] : g.p;
      const behind = [], front = [];
      [...lines, ...dots.map(o => ({ d: o.d - 1e-3, svg: o.svg, g: o.g }))].forEach(o => (o.g && hidden(mid(o.g)) ? behind : front).push(o));
      body = `<g style="--dg-sa:${SURF_ALPHA}">` + paint(behind) + surfSheet + paint(front) + `</g>`;
    }
    return { inner: (FLOOR_BRIGHT ? floor + `<g class="dg-base">` : `<g class="dg-base">` + floor) + axis + body + hint + `</g><g class="dg-hl" pointer-events="none"></g>`, H, meta, W, is3d: true };
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

  /* ---- Research-gap markers: a gold "G#" on each gap's junction, wherever the view drew it ---- */
  function addGapMarkers(built) {
    if (!built) return built;
    const gm = Object.values(built.meta).filter(m => m.type === "rgap" && m.hl && m.hl.j);
    if (!gm.length) return built;
    const shared = new Map();                             // gaps meeting at the same junction fan out
    gm.forEach(m => {
      // Flat views: lift the node just above the junction where its two papers' branches meet, joined to
      // it by a dashed line (3D already stands it at its Topic Map position, linked the same way).
      if (!m.hl.link) {
        const key = m.hl.j.x.toFixed(0) + "," + m.hl.j.y.toFixed(0), k = shared.get(key) || 0;
        shared.set(key, k + 1);
        const jx = m.hl.j.x, jy = m.hl.j.y, gx = jx + 18 + 24 * k, gy = Math.max(12, jy - 28);
        m.hl.junction = { x: jx, y: jy };
        m.hl.link = { x1: jx, y1: jy, x2: gx, y2: gy };
        m.hl.j = { x: gx, y: gy };
      }
    });
    const svg = gm.map(m => {
      const x = m.hl.j.x.toFixed(1), y = m.hl.j.y.toFixed(1), L = m.hl.link;
      return `<line x1="${L.x1.toFixed(1)}" y1="${L.y1.toFixed(1)}" x2="${L.x2.toFixed(1)}" y2="${L.y2.toFixed(1)}" stroke="#9c6b00" stroke-width="1.4" stroke-dasharray="4 3"/>` +
        `<circle cx="${L.x1.toFixed(1)}" cy="${L.y1.toFixed(1)}" r="2.6" fill="#9c6b00"/>` +
        `<circle class="dg-node" data-id="${m.id}" cx="${x}" cy="${y}" r="9" fill="#f2c94c" stroke="#9c6b00" stroke-width="1.5"/>` +
        `<text x="${x}" y="${(m.hl.j.y + 3.3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#5a3d00" pointer-events="none">G${m.num}</text>`;
    }).join("");
    built.inner = built.inner.replace('</g><g class="dg-hl"', svg + '</g><g class="dg-hl"');
    return built;
  }

  // Why targeting a gap would lower nothing: with no barrier there, the two sides already meet in this
  // landscape (the Topic Map's empty strip is not a pass here); otherwise every route across the gap
  // already crosses a lower pass somewhere else.
  function noFallWhy(r) {
    return (+r.barrier || 0) < 0.005
      ? "In this landscape its two sides already meet with no pass between them, so the empty strip on the Topic Map is not a barrier here."
      : "Every route across it already runs over a lower pass elsewhere.";
  }

  // The list of research gaps under the graph: the Topic Map's gaps, ranked by what targeting each would do.
  function gapPanel(model) {
    const rg = model.rgaps || [];
    const box = inner => `<div class="dg-gaps" style="margin-top:12px;font:12px/1.45 system-ui,sans-serif;color:#333">` +
      `<div style="font-weight:700;margin-bottom:2px">Research gaps <span style="font-weight:400;color:#888">· found on the Topic Map · ranked by impact if targeted · hover to highlight</span></div>` + inner + `</div>`;
    if (!rg.length)
      return model.hasTopic ? box(`<div style="color:#888">The Topic Map found no research gaps for this search.</div>`) : "";
    const row = r =>
      `<div class="dg-gap-row" data-id="${r.id}" style="display:flex;gap:9px;align-items:flex-start;padding:6px 8px;border-top:1px solid #eee;cursor:default">` +
      `<span style="flex:0 0 auto;background:#f2c94c;color:#5a3d00;border:1px solid #9c6b00;border-radius:999px;font-weight:700;font-size:10px;padding:1px 6px">G${r.num}</span>` +
      `<span style="flex:1;min-width:0"><b>${esc(r.name || "Research gap")}</b>` +
      `<span style="display:block;color:#666;margin-top:2px">between “${esc(trunc(r.flank.a.title, 34))}” and “${esc(trunc(r.flank.b.title, 34))}” · barrier ${r.barrier.toFixed(2)}` +
      (r.close ? ` · if targeted, joins “${esc(trunc(r.close.a.title, 30))}” ↔ “${esc(trunc(r.close.b.title, 30))}” most: barrier ${r.closeBefore.toFixed(2)} → ${r.closeAfter.toFixed(2)} · total fall ${r.closeTotal.toFixed(1)}`
               : ` · if targeted, no barrier would fall. ${noFallWhy(r)}`) +
      `</span></span></div>`;
    return box(`<div style="color:#888;margin-bottom:4px">Each gap lies between two papers, one on each side. Targeting it = a new paper at its location: shown (and highlighted) are the two papers, one on each side, whose barrier it would lower the most, and the total fall of barriers across the field (same energy units as the graph).</div>` +
      rg.map(row).join(""));
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
    const f1 = n => n.toFixed(1);
    const drops = (h.drops || []).map(d =>                 // 3D: highlighted points projected onto the map
      `<line x1="${f1(d.x1)}" y1="${f1(d.y1)}" x2="${f1(d.x2)}" y2="${f1(d.y2)}" stroke="${RED}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
      `<circle cx="${f1(d.x2)}" cy="${f1(d.y2)}" r="4" fill="none" stroke="${RED}" stroke-width="1.6"/>`).join("");
    const isGap = m.type === "rgap";
    layer.innerHTML = drops +
      `<path d="${h.path}" stroke="${RED}" stroke-width="3" fill="none" stroke-linejoin="round"/>` +
      (h.link ? `<line x1="${f1(h.link.x1)}" y1="${f1(h.link.y1)}" x2="${f1(h.link.x2)}" y2="${f1(h.link.y2)}" stroke="${RED}" stroke-width="2" stroke-dasharray="5 4"/>` : "") +
      (h.junction ? `<circle cx="${f1(h.junction.x)}" cy="${f1(h.junction.y)}" r="6" fill="${RED}" stroke="#fff" stroke-width="1.5"/>` : "") +
      (isGap ? `<circle cx="${f1(h.j.x)}" cy="${f1(h.j.y)}" r="11" fill="#f2c94c" stroke="${RED}" stroke-width="2.5"/>` +
               `<text x="${f1(h.j.x)}" y="${f1(h.j.y + 3.4)}" text-anchor="middle" font-size="9" font-weight="700" fill="#5a3d00">G${m.num}</text>`
             : `<circle cx="${f1(h.j.x)}" cy="${f1(h.j.y)}" r="7" fill="${RED}" stroke="#fff" stroke-width="1.5"/>`) +
      ring(h.a, RED) + ring(h.b, RED) + (h.self ? ring(h.self, INK) : "") +
      title(h.a, RED) + title(h.b, RED) + (h.self ? title(h.self, INK) : "");
  }

  /* ---- Shared shell: toolbar, svg wrapper, tooltip ---- */
  // Details appear in a box BELOW the figure (never over it). Hover shows a node's details and highlight;
  // a click PINS them (click again, or on empty space, to release). The pin survives 3D rotation and
  // switching between views when the same paper or research gap is still there.
  const INFO_HINT = "Hover a paper, barrier or G-node for details · click to keep it highlighted (click again to release)";
  function pinMatches(pin, m) {
    if (!pin || !m) return false;
    if (pin.kind === "paper") return m.type === "paper" && m.paper === pin.paper;
    return m.id === pin.id;
  }
  function wireTooltip(mountEl, meta) {
    const info = mountEl.querySelector(".dg-info");
    const pinned = () => { const pin = mountEl.__dgPin; return pin ? Object.values(meta).find(m => pinMatches(pin, m)) || null : null; };
    const show = m => {
      if (info) info.innerHTML = m ? tipHTML(m) : `<span style="color:#888">${INFO_HINT}</span>`;
      showGap(mountEl, m);
    };
    const setPin = m => {
      mountEl.__dgPin = !m ? null : m.type === "paper" ? { kind: "paper", paper: m.paper } : { kind: "id", id: m.id };
      if (info) info.style.borderColor = m ? "#d64545" : "#e6e6e6";
      show(m);
    };
    mountEl.__dgShow = m => show(m || pinned());
    mountEl.__dgPinToggle = m => setPin(pinMatches(mountEl.__dgPin, m) ? null : m);
    const still = pinned();
    if (!still && mountEl.__dgPin) mountEl.__dgPin = null;
    if (info) info.style.borderColor = still ? "#d64545" : "#e6e6e6";
    show(still);

    mountEl.querySelectorAll(".dg-node").forEach(el => {
      el.style.cursor = "pointer";
      const baseR = el.getAttribute("r"), m = meta[el.dataset.id];
      el.addEventListener("mouseenter", () => { el.setAttribute("r", (+baseR + 2).toFixed(1)); show(m); });
      el.addEventListener("mouseleave", () => { el.setAttribute("r", baseR); show(pinned()); });
      el.addEventListener("click", e => { e.stopPropagation(); if (mountEl.__dgDragged) return; mountEl.__dgPinToggle(m); });
    });
    const svg = mountEl.querySelector("svg.dg-svg");
    if (svg && !svg.__dgClick) {                          // click on empty space releases the pin
      svg.__dgClick = true;
      svg.addEventListener("click", () => { if (mountEl.__dgDragged) { mountEl.__dgDragged = false; return; } setPin(null); });
    }
  }

  // Everyone except admins: original + time gap-closers, the Levelled textbook graph at 100 levels,
  // the metric 3D view, and no MST.
  // Everyone except admins (user decision 2026-11-03): density from the 2D Topic Map, original + time
  // gap-closers, all branches, a linear energy axis, 100 levels; the flat view Levelled (textbook) and
  // the 3D view in metric posts; "Highlight gap-closers" starts ticked (they may untick it). No MST.
  let USER_INIT = false;
  function userSetup() {
    if (ADMIN) return;
    GC_ALT = true; LEVELLED = true; METRIC = true; NLEV = 100; MINB = 1; LOGLV = false; RES = "map2d"; SIG = false;
    if (!USER_INIT) { OVERLAY = true; USER_INIT = true; }
    if (MODE === "mst") MODE = "dg";
  }
  // A density variant must be (re)built when missing, or built before the current version or against
  // another set of Topic Map gaps.
  const tmSigOf = tm => { const g = (tm && tm.gaps) || []; return g.length + "|" + g.map(x => String(x.label || "")).join("|"); };
  function variantStale(session) {
    const v = (session.disconnectivity_res || {})[String(RES)];
    return !v || (v.dg_version || 1) < 10 || v.tm_sig !== tmSigOf(session.topic_map) ||
      (ADMIN && RES === "map2d" && !("fe_surface" in v));   // admin surface needs a graph built with it
  }

  function draw(session, mountEl) {
    userSetup();
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
    const needRes = RES !== 1 && variantStale(session);
    const built = (need3dMap || needRes) ? null : addGapMarkers(MODE === "mst" ? buildMST(model, W, scores) : MODE === "3d" ? buildDG3(model, W, scores)
                : (LEVELLED && model.hasFE) ? buildLevels(model, W, scores) : buildDG(model, W, scores));

    const radio = (v, lbl) =>
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">` +
      `<input type="radio" name="dgmode" class="dg-mode" value="${v}"${MODE === v ? " checked" : ""}/>${lbl}</label>`;
    const tools =
      `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:8px;` +
      `font:12px system-ui,sans-serif;color:#555">` +
      `<span style="display:inline-flex;gap:10px;align-items:center">View: ${radio("dg", "Disconnectivity")}${ADMIN ? " " + radio("mst", "MST") : ""}${model.hasFE ? " " + radio("3d", "3D on the map") : ""}</span>` +
      (MODE === "3d" && ADMIN ? `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;user-select:none" title="Colour the floor by the same high-dimensional free energy as the heights (interpolated between the papers' map positions) instead of the Topic Map's 2D density."><input type="checkbox" class="dg-floorhd"${FLOOR_HD ? " checked" : ""}/> floor: same free energy as heights</label>` : "") +
      (MODE === "3d" && ADMIN ? `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;user-select:none${model.surface ? "" : ";opacity:.5"}" title="${model.surface ? "Draw the free-energy surface itself (−ln p of the 2D map), cut off above the top barrier. Wells and cols are points of this surface, so the tree's nodes sit on it." : "Only for density: 2D map. The other landscapes live in the full embedding space, which has no surface over the map."}"><input type="checkbox" class="dg-surface"${SURFACE && model.surface ? " checked" : ""}${model.surface ? "" : " disabled"}/> 3D surface</label>` +
        (SURFACE && model.surface ? `<label style="display:inline-flex;align-items:center;gap:5px;user-select:none" title="Opacity of the surface">opacity <input type="range" class="dg-surf-alpha" min="0.05" max="1" step="0.05" value="${SURF_ALPHA}" style="width:90px"/></label>` : "") : "") +
      (MODE === "3d" ? `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;user-select:none" title="Keep the map (floor, contours, paper shadows) unfaded while a paper or gap is highlighted."><input type="checkbox" class="dg-floorbright"${FLOOR_BRIGHT ? " checked" : ""}/> keep the map bright when highlighting</label>` : "") +
      (MODE === "3d" ? `<span style="display:inline-flex;gap:6px">` +
        [["side", "Side"], ["top", "Top"], ["reset", "Reset"]].map(([k, l]) =>
          `<button type="button" class="dg-cam" data-cam="${k}" style="font:inherit;border:1px solid #ddd;background:#fff;border-radius:6px;padding:2px 9px;cursor:pointer">${l}</button>`).join("") +
        (ADMIN && window.Drone ? `<button type="button" class="dg-drone" title="Plan a drone flythrough of this 3D view and download it as a video flight file (developer tool)" style="font:inherit;border:1px solid #ba5757;color:#ba5757;background:#fff;border-radius:6px;padding:2px 9px;cursor:pointer">Drone video…</button>` : "") +
        `</span>` : "") +
      (ADMIN ? `<label style="cursor:${FEV ? "default" : "pointer"};display:inline-flex;align-items:center;gap:6px;user-select:none${FEV ? ";opacity:.45" : ""}" title="${FEV ? "The free-energy axis is already −ln p; log scaling applies to the MST view." : ""}">` +
      `<input type="checkbox" class="dg-log"${LOG ? " checked" : ""}${FEV ? " disabled" : ""}/> ${FEV ? "Log scale (n/a — energy axis)" : "Log scale (compress large gaps)"}</label>` : "") +
      `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none">` +
      `<input type="checkbox" class="dg-overlay"${OVERLAY ? " checked" : ""}/> Highlight gap-closers</label>` +
      (ADMIN && model.hasFE && MODE !== "mst" ? styleControls() : "") +
      (ADMIN && model.hasFE ? `<label title="Density estimate behind the landscape. KDE: Gaussian kernels (bandwidth x 1, 0.75, 0.5). kNN field: k-nearest-neighbour density in the data's intrinsic dimension (TwoNN), with error bars. Each setting is built once per session and cached." style="display:inline-flex;align-items:center;gap:5px">density` +
        `<select class="dg-res" style="font:inherit">` + [[1, "KDE 1× (standard)"], [0.75, "KDE 0.75×"], [0.5, "KDE 0.5×"], ["knn3", "kNN field, k = 3"], ["knn5", "kNN field, k = 5"], ["knn8", "kNN field, k = 8"], ["map2d", "2D map (Topic Map density)"]]
          .map(([v, t]) => `<option value="${v}"${String(v) === String(RES) ? " selected" : ""}>${t}</option>`).join("") + `</select></label>` +
        (model.estInfo ? `<span title="TwoNN intrinsic dimension; k used for the field; DADApy's adaptive k* (median, alpha 0.05) for reference; error of each ln density">intrinsic dim ${(+model.estInfo.d).toFixed(1)} · k ${model.estInfo.k} · ref k* ${model.estInfo.kstar} · σ ${(+model.estInfo.sigma).toFixed(2)}</span>` +
          `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;user-select:none" title="Keep only barriers larger than 1.65 times their combined error (Density Peak Advanced test); research gaps within the error are hidden."><input type="checkbox" class="dg-sig"${SIG ? " checked" : ""}/> significant barriers only</label>` : "") : "") +
      (ADMIN && model.hasAlt ? `<label title="Route + time: a paper only closes gaps whose route runs through it, between works published by its year. Original + time: the earlier scoring (its own tree) with the same time rule." style="display:inline-flex;align-items:center;gap:5px">gap-closers` +
        `<select class="dg-gcalt" style="font:inherit"><option value="0"${GC_ALT ? "" : " selected"}>route + time</option><option value="1"${GC_ALT ? " selected" : ""}>original + time</option></select></label>` : "") +
      `</div>`;

    // Admin resolution not built yet: build it (cached on the session), show the loader, then redraw.
    if (needRes) {
      const wait = window.EratostLoader ? EratostLoader.block(!ADMIN ? "Building the research-gap landscape…" : RES === "map2d" ? "Building the landscape of the 2D map…" : String(RES).startsWith("knn") ? `Building the kNN density field (k = ${String(RES).slice(3)})…` : `Building the landscape at ${RES}× resolution…`, { gradient: true }) : "Building…";
      mountEl.innerHTML = tools + `<div class="dg-3d-wait">${wait}</div>`;
      wireToolbar(session, mountEl);
      if (typeof window.dgEnsureRes === "function" && !ENSURING) {
        ENSURING = true;
        window.dgEnsureRes(RES).then(s2 => {
          ENSURING = false;
          if (s2 && _last && _last.mountEl === mountEl) { _last.session = s2; draw(s2, mountEl); }
        }).catch(e => {
          ENSURING = false; RES = 1;
          const w = mountEl.querySelector(".dg-3d-wait");
          if (w) w.textContent = "Could not build that resolution (" + ((e && (e.message || e.code)) || "error") + ").";
        });
      }
      return;
    }

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
      `style="font-family:system-ui,sans-serif;display:block${built.is3d ? ";cursor:grab;touch-action:none;user-select:none" : ""}">` + built.inner + `</svg></div>` +
      `<div class="dg-info" style="margin-top:8px;min-height:56px;border:1px solid #e6e6e6;border-radius:8px;padding:8px 11px;` +
      `background:#fbfbfa;font:12px/1.45 system-ui,sans-serif;color:#222"></div>` +
      `<style>.dg-info .dg-sub{color:#555;font-size:11.5px;margin-top:2px}.dg-info .dg-list{margin:5px 0 0;padding-left:16px}.dg-info .dg-list li{margin:1px 0}</style>` +
      (MODE !== "mst" ? gapPanel(model) : "");

    wireToolbar(session, mountEl);
    const droneBtn = mountEl.querySelector(".dg-drone");
    if (droneBtn) droneBtn.addEventListener("click", () => {
      // Record the 3D view exactly as it is set up now (style, axis, levels, surface, gaps) in world units.
      REC = {};
      try { buildDG3(model, W, scores); } finally { var scene = REC.scene; REC = null; }
      if (!scene) return;
      window.Drone.openEditor(scene, { sessionId: session.session_id || session.id || "", title: session.base_query || "" });
    });
    wireTooltip(mountEl, built.meta);
    if (built.is3d) wire3D(mountEl, model, scores, W);
    mountEl.querySelectorAll(".dg-gap-row").forEach(row => {
      const r = (model.rgaps || []).find(x => x.id === row.dataset.id);
      row.style.cursor = "pointer";
      row.addEventListener("mouseenter", () => { row.style.background = "#fbf4dc"; mountEl.__dgShow(r); });
      row.addEventListener("mouseleave", () => { row.style.background = ""; mountEl.__dgShow(null); });
      row.addEventListener("click", () => mountEl.__dgPinToggle(r));
    });
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
    hook("dg-gcalt", el => { GC_ALT = el.value === "1"; });
    hook("dg-res", el => { RES = (el.value.startsWith("knn") || el.value === "map2d") ? el.value : +el.value; });
    hook("dg-sig", el => { SIG = el.checked; });
    hook("dg-floorhd", el => { FLOOR_HD = el.checked; });
    hook("dg-floorbright", el => { FLOOR_BRIGHT = el.checked; });
    hook("dg-surface", el => { SURFACE = el.checked; });
    const sa = mountEl.querySelector(".dg-surf-alpha");    // live: only the CSS variable changes
    if (sa) sa.addEventListener("input", () => {
      SURF_ALPHA = +sa.value;
      mountEl.querySelectorAll("svg.dg-svg g[style*='--dg-sa']").forEach(g => g.style.setProperty("--dg-sa", SURF_ALPHA));
    });
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
        const b = addGapMarkers(buildDG3(model, W, scores));
        svg.innerHTML = b.inner;
        wireTooltip(mountEl, b.meta);
      });
    };
    let drag = null;
    svg.addEventListener("pointerdown", e => {
      drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
      mountEl.__dgDragged = false;
      svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", e => {
      if (!drag) return;
      AZ += (e.clientX - drag.x) * 0.45;
      EL = Math.max(0, Math.min(90, EL + (e.clientY - drag.y) * 0.35));
      const moved = drag.moved + Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      if (moved > 4 && !mountEl.__dgDragged) {             // a rotation, not a click: now hold the pointer
        mountEl.__dgDragged = true;
        DRAG3D = true;                                    // lighter surface mesh while turning
        try { svg.setPointerCapture(drag.id); } catch (_) {}
      }
      drag = { x: e.clientX, y: e.clientY, moved, id: drag.id };
      redraw();
    });
    const end = () => { drag = null; svg.style.cursor = "grab"; if (DRAG3D) { DRAG3D = false; redraw(); } };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    mountEl.querySelectorAll(".dg-cam").forEach(btn => btn.addEventListener("click", () => {
      const k = btn.dataset.cam;
      if (k === "side") EL = 0; else if (k === "top") { EL = 90; AZ = 0; } else { AZ = -35; EL = 28; }
      redraw();
    }));
  }

  let _last = null;
  function renderDisconnectivity(session, mountEl, opts) {
    if (opts && "admin" in opts) ADMIN = !!opts.admin;
    _last = { session, mountEl };
    draw(session, mountEl);
  }
  // The page learns whether the viewer is an admin after /me answers; redraw if that changes the setup.
  window.dgSetAdmin = function (admin) {
    if (!!admin === ADMIN) return;
    ADMIN = !!admin;
    if (_last) draw(_last.session, _last.mountEl);
  };
  if (!window.__dgResize) {
    window.__dgResize = true;
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (_last) draw(_last.session, _last.mountEl); }, 120); });
  }
  window.renderDisconnectivity = renderDisconnectivity;
})();
