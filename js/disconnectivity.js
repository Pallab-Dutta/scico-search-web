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
    if (!(LOG && v > 0)) return v.toFixed(3);
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
        : { leaf: false, height: node.height, fe: node.fe, children: (node.children || []).map(hydrate) };
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
      return { root, edges, loo, reduce, reducePair, energy, hasFE };
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
        bridge = `gap-closer · holds a barrier of ${fmtBar(m.reduce)} shut (removing it reopens this gap)`
               + (m.total > 0 ? ` · total gap-closing ${(+m.total).toFixed(2)}` : "");
        // Name the two works this paper bridges — the endpoints of the pass it holds shut = the gap
        // it closes BETWEEN. (Absent on legacy/held-only payloads.)
        if (m.pair) gapPair = `closes the gap between “${esc(trunc(m.pair.a.title, 40))}” and “${esc(trunc(m.pair.b.title, 40))}”`;
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
    // FREE-ENERGY landscape (default): every node has a Boltzmann-inverted energy `fe` (leaf = its own
    // well depth, junction = the barrier separating its basins), all on one axis — a true protein-PES
    // disconnectivity graph. `val(n)` is a node's position on that axis; a paper's is its leaf fe.
    // Without `fe` (legacy payloads) we fall back to the old dendrogram: leaves at 0, junctions at the
    // cosine merge height.
    const FE = model.hasFE;
    const val = n => FE ? (n.fe || 0) : (isLeaf(n) ? 0 : (n.height || 0));
    const feX = p => xAt(model.energy.get(p) || 0);   // a paper's x from its free energy (xAt below)

    // ── Seat gap-closers BETWEEN the two works they bridge ─────────────────────────────────────
    // When "Highlight gap-closers" is on, a bridge paper leaves the base row and is drawn as a green
    // node BETWEEN its two bridged works — vertically at the midpoint of their two rows, horizontally
    // at the barrier it closes (their merge height) — with an arm reaching directly to each work. The
    // red-gap tree of the remaining papers is kept around them. To stay clean, a closer is seated ONLY
    // when BOTH its works remain base leaves: strongest-reducing closers claim first, and the two works
    // they bridge are pinned as base leaves, so no closer is drawn hanging off another. Off → none.
    const seatOf = new Map();      // paper -> { a, b, height } : the two works it bridges + merge barrier
    if (OVERLAY && model.reduce && model.reducePair) {
      const cand = leaves.map(lf => lf.paper || lf)
        .filter(p => (model.reduce.get(p) || 0) > 0 && model.reducePair.get(p))
        .sort((x, y) => (model.reduce.get(y) || 0) - (model.reduce.get(x) || 0));
      const pinned = new Set();    // works claimed by an already-seated closer -> must stay base leaves
      const takenJ = new Set();    // junctions already occupied -> one closer per junction (strongest wins)
      cand.forEach(p => {
        if (pinned.has(p)) return;                       // p is someone's base work; keep it a base leaf
        const pr = model.reducePair.get(p);
        const a = pr.a, b = pr.b;
        if (a === p || b === p || a === b) return;
        if (seatOf.has(a) || seatOf.has(b)) return;      // a work is itself seated -> would nest; skip
        const J = lcaNode(tree, a, b);
        if (!J || isLeaf(J) || takenJ.has(J)) return;    // junction already holds a (stronger) closer
        seatOf.set(p, { a, b, height: val(J) });
        pinned.add(a); pinned.add(b); takenJ.add(J);
      });
    }
    const seated = p => seatOf.has(p);

    const left = 34, right = 264, top = 24, rowH = 26, axisPad = 40;
    const nRows = Math.max(1, leaves.reduce((k, lf) => k + (seated(lf.paper || lf) ? 0 : 1), 0));
    const H = top * 2 + Math.max(1, nRows - 1) * rowH + axisPad;
    const innerW = W - left - right;
    const maxH = (function m(n) { return Math.max(val(n), ...kids(n).map(m)); })(tree) || 1;
    const leafX = left + innerW;                      // energy 0 = deepest well (minima column, right)
    let hmin = Infinity;
    (function mn(n) { const v = val(n); if (v > 0) hmin = Math.min(hmin, v); kids(n).forEach(mn); })(tree);
    if (!isFinite(hmin)) hmin = maxH;
    // One reference for the whole barrier axis: the smallest positive barrier in the picture (= BMIN).
    // Gap-closers are drawn AS real junction nodes (their heights are edge weights already in BMIN), so
    // they share the tree's own scale and the dex readout, never past the root. Clamped to [ref, maxH].
    const ref = (BMIN > 0 && BMIN <= hmin) ? BMIN : hmin;
    const LMARGIN = 0.05, lspan = (Math.log(maxH) - Math.log(ref)) || 1;
    const clampH = h => Math.max(ref, Math.min(h, maxH));
    const xLin = h => leafX - (Math.min(h, maxH) / maxH) * innerW;
    const xLog = h => h <= 0 ? leafX
      : leafX - (LMARGIN + (1 - LMARGIN) * (Math.log(clampH(h)) - Math.log(ref)) / lspan) * innerW;
    const xAt = LOG ? xLog : xLin;                    // larger barrier -> further left
    const axisY = H - 22;

    // Rows: only NON-seated leaves (base minima) take a row; a seated closer is drawn between its works.
    let r = 0;
    const rowY = new Map();                             // base paper -> its row y (for the closer arms)
    leaves.forEach(lf => {
      const p = lf.paper || lf;
      lf._x = FE ? xAt(val(lf)) : leafX;                 // FE: leaf sits at its own well depth
      if (seated(p)) { lf._y = top; } else { lf._y = top + (r++) * rowH; rowY.set(p, lf._y); }
    });

    // Layout: each internal node's y = midpoint of its VISIBLE descendants' rows (seated leaves add no
    // row, so a junction centres between the base works on either side). x = its barrier column.
    (function lay(n) {
      if (isLeaf(n)) return seated(n.paper || n) ? null : { y: n._y };
      const cs = kids(n).map(lay).filter(Boolean);
      n._x = xAt(val(n));
      const ys = cs.map(c => c.y);
      n._y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : top;
      return { y: n._y };
    })(tree);

    let branches = "", dots = "", labels = "", uid = 0;
    const meta = {};
    const paperDot = (id, p, x, y) => {
      const st = paperStyle(p, scores);
      dots += `<circle class="dg-node" data-id="${id}" cx="${(+x).toFixed(1)}" cy="${(+y).toFixed(1)}" r="${st.r.toFixed(1)}" fill="${st.fill}" stroke="#fff" stroke-width="1.2"/>`;
      labels += `<text x="${(+x + 10).toFixed(1)}" y="${(+y + 3.5).toFixed(1)}" font-size="11" fill="#333">${esc(trunc(p.title, 38))}</text>`;
      meta[id] = { type: "paper", paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0, fe: (FE && model.energy) ? model.energy.get(p) : null };
    };

    // Base tree: the disconnectivity graph over the non-seated papers. A seated closer leaves the tree
    // (returns null) and the trivial merge where it attached collapses, so the remaining red gaps stay
    // connected. walk returns the attach point {x,y} for the parent, or null if the subtree is empty.
    (function walk(n) {
      const id = "d" + (uid++);
      if (isLeaf(n)) {
        const p = n.paper || n;
        if (seated(p)) return null;                      // drawn as a bridge, not as a base pendant
        paperDot(id, p, n._x, n._y);                     // minimum, at its own free energy (well depth)
        return { x: n._x, y: n._y };
      }
      const arms = kids(n).map(walk).filter(Boolean);    // visible child attach points
      if (arms.length <= 1) return arms[0] || null;      // trivial merge (a seated child) collapses
      const ys = arms.map(a => a.y);
      branches += `<path d="M${n._x} ${Math.min(...ys)} V${Math.max(...ys)}" stroke="#111" stroke-width="1.5" fill="none"/>`;
      arms.forEach(a => { branches += `<path d="M${a.x} ${a.y} H${n._x}" stroke="#111" stroke-width="1.5" fill="none"/>`; });
      dots += `<circle class="dg-node" data-id="${id}" cx="${n._x.toFixed(1)}" cy="${n._y.toFixed(1)}" r="5" fill="#d64545" stroke="#fff" stroke-width="1.2"/>`;
      meta[id] = { type: "gap", title: n.gap || n.concept || "Research gap", barrier: val(n), papers: leafPapers(n) };
      return { x: n._x, y: n._y };
    })(tree);

    // Gap-closers: each is drawn BETWEEN its two bridged works — a green node at the merge barrier,
    // midway between the works' rows, with a green arm reaching to each work. This is exactly a fork
    // whose two children are the works it settles the gap for.
    seatOf.forEach((info, p) => {
      const ya = rowY.get(info.a), yb = rowY.get(info.b);
      if (ya == null || yb == null) return;              // safety: both works must be base leaves
      const x = xAt(info.height), y = (ya + yb) / 2, id = "d" + (uid++);
      const xa = FE ? feX(info.a) : leafX, xb = FE ? feX(info.b) : leafX;   // each work at its own depth
      branches += `<path d="M${x.toFixed(1)} ${Math.min(ya, yb)} V${Math.max(ya, yb)}" stroke="#2e9e5b" stroke-width="1.5" fill="none"/>`;
      branches += `<path d="M${xa.toFixed(1)} ${ya} H${x.toFixed(1)}" stroke="#2e9e5b" stroke-width="1.5" fill="none"/>`;
      branches += `<path d="M${xb.toFixed(1)} ${yb} H${x.toFixed(1)}" stroke="#2e9e5b" stroke-width="1.5" fill="none"/>`;
      paperDot(id, p, x, y);                             // green closer node + label + tooltip
    });

    const axis =
      `<line x1="${left}" y1="${axisY}" x2="${leafX}" y2="${axisY}" stroke="#bbb" stroke-width="1"/>` +
      `<line x1="${leafX}" y1="${axisY - 4}" x2="${leafX}" y2="${axisY + 4}" stroke="#bbb"/>` +
      `<line x1="${left}" y1="${axisY - 4}" x2="${left}" y2="${axisY + 4}" stroke="#bbb"/>` +
      `<text x="${leafX}" y="${axisY + 16}" text-anchor="end" font-size="10" fill="#888">0</text>` +
      `<text x="${left}" y="${axisY + 16}" text-anchor="start" font-size="10" fill="#888">${LOG && BMIN > 0 ? Math.log10(maxH / BMIN).toFixed(2) + " dex" : maxH.toFixed(2)}</text>` +
      `<text x="${(left + leafX) / 2}" y="${axisY + 16}" text-anchor="middle" font-size="10" fill="#888">${FE ? `← free energy  −ln p  (${LOG ? "log" : "linear"}, k_BT=1)` : `← barrier (${LOG ? "log" : "linear"} gap magnitude)`}</text>`;

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
      meta[id] = { type: "paper", paper: p, overlay: st.raw, overlayKind: st.kind, reduce: (model.reduce && model.reduce.get(p)) || 0, pair: (model.reducePair && model.reducePair.get(p)) || null, total: (model.loo && model.loo.get(p)) || 0 };
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
