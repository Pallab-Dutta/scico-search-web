/* Drone flythrough for the Gap Graph's 3D landscape (developer tool).

   Drone.openEditor(scene, opts) opens a full-screen editor: fly a free camera through the scene, drop
   keyframes, set each leg's duration, easing and hover time, preview it live, then download a FLIGHT FILE:
   one self-contained HTML page (this module + the scene + the path) that plays anywhere, records a WebM in
   the browser, and renders exact frames (?frame=N) for a full-quality MP4 with Chrome + ffmpeg.

   The scene comes from the 3D view itself (disconnectivity.js records it in world coordinates): x, y = the
   Topic Map (centred, -0.5..0.5), z = height on the view's free-energy axis (0..ZH). This module is written
   as one factory function so the flight file can carry its own copy (Drone.src). */
(function factory(root) {
  "use strict";
  const D = {};
  D.src = "(" + factory.toString() + ")(window);";

  /* ---------------- small vector helpers ---------------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- camera path ----------------
     keys: [{ pos, tgt, dur, ease, hold }]
       pos / tgt: camera position and the point it looks at (world units);
       hold: seconds the drone hovers AT this key before leaving; dur: seconds to fly to the next key;
       ease: how it flies that leg -- "smooth" (slow out, slow in), "linear" (constant speed),
             "in" (speeds up), "out" (slows down).
     Positions and targets each follow a centripetal Catmull-Rom curve through the keys (smooth, no loops
     or overshoot), at even speed along the curve before easing. */
  const EASE = { linear: t => t, smooth: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t) };
  D.EASES = [["smooth", "smooth (slow out, slow in)"], ["linear", "constant speed"], ["in", "speed up"], ["out", "slow down"]];

  function crPoint(p0, p1, p2, p3, u) {                    // centripetal Catmull-Rom (alpha 0.5), u in [0, 1]
    const tj = (a, b) => Math.max(1e-4, Math.sqrt(len(sub(b, a))));
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    const t = t1 + (t2 - t1) * u;
    const L = (a, b, ta, tb) => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
    const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  }
  function curve(pts, i, u, straight) {                    // point on the leg from key i to key i + 1
    if (straight) return add(mul(pts[i], 1 - u), mul(pts[i + 1], u));   // a straight line between the two keys
    const n = pts.length, P = k => pts[clamp(k, 0, n - 1)];
    const p0 = i - 1 < 0 ? sub(mul(P(0), 2), P(1)) : P(i - 1);          // mirrored end points
    const p3 = i + 2 > n - 1 ? sub(mul(P(n - 1), 2), P(n - 2)) : P(i + 2);
    return crPoint(p0, P(i), P(i + 1), p3, u);
  }
  // Prepare a path: per leg, an arc-length table so a leg is flown at even speed before its easing.
  D.prepare = function (keys) {
    const ks = (keys || []).filter(k => k && k.pos && k.tgt);
    const pos = ks.map(k => k.pos), tgt = ks.map(k => k.tgt);
    const legs = [];
    let T = 0;
    for (let i = 0; i < ks.length; i++) {
      const hold = Math.max(0, +ks[i].hold || 0);
      legs.push({ kind: "hold", i, t0: T, t1: T + hold });
      T += hold;
      if (i < ks.length - 1) {
        const dur = Math.max(0.05, +ks[i].dur || 0);
        const M = 48, acc = [0];
        const straight = ks[i].shape !== "curve";
        let prev = curve(pos, i, 0, straight);
        for (let m = 1; m <= M; m++) { const q = curve(pos, i, m / M, straight); acc.push(acc[m - 1] + len(sub(q, prev))); prev = q; }
        legs.push({ kind: "fly", i, t0: T, t1: T + dur, ease: EASE[ks[i].ease] || EASE.smooth, acc, total: acc[M], straight });
        T += dur;
      }
    }
    return { keys: ks, pos, tgt, legs, duration: T };
  };
  D.camAt = function (path, t) {                           // -> { pos, tgt } at time t (seconds)
    const ks = path.keys;
    if (!ks.length) return null;
    if (ks.length === 1) return { pos: ks[0].pos, tgt: ks[0].tgt };
    t = clamp(t, 0, path.duration);
    let leg = path.legs[path.legs.length - 1];
    for (const l of path.legs) if (t <= l.t1) { leg = l; break; }
    if (leg.kind === "hold") return { pos: ks[leg.i].pos, tgt: ks[leg.i].tgt };
    const e = leg.ease(clamp((t - leg.t0) / ((leg.t1 - leg.t0) || 1), 0, 1));
    let u = e;
    if (leg.total > 1e-6) {                               // even speed along the curve
      const want = e * leg.total, a = leg.acc, M = a.length - 1;
      let lo = 0, hi = M;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] < want) lo = mid; else hi = mid; }
      u = (lo + (want - a[lo]) / ((a[hi] - a[lo]) || 1)) / M;
    }
    return { pos: curve(path.pos, leg.i, u, leg.straight), tgt: curve(path.tgt, leg.i, e, leg.straight) };
  };

  // Height of the drawn surface under (x, y), or 0 off the map / where the surface is not drawn.
  // Height of the landscape under world point (x, y). The landscape is a grid over map coordinates
  // (xs across, ys down, not evenly spaced: fine over the papers, coarser toward the far plain).
  function seek(a, v) {                                   // index i with a[i] <= v <= a[i + 1]
    let lo = 0, hi = a.length - 1;
    if (v <= a[0]) return [0, 0];
    if (v >= a[hi]) return [hi - 1, 1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; }
    return [lo, (v - a[lo]) / ((a[lo + 1] - a[lo]) || 1)];
  }
  D.surfaceZ = function (scene, x, y) {
    const S = scene.surface;
    if (!S || !S.xs) return 0;
    const [c, fc] = seek(S.xs, x + 0.5), [r, fr] = seek(S.ys, 0.5 - y);
    const bl = Z => (Z[r][c] * (1 - fc) + Z[r][c + 1] * fc) * (1 - fr) + (Z[r + 1][c] * (1 - fc) + Z[r + 1][c + 1] * fc) * fr;
    if (S.s && bl(S.s) < 0) return 0;                     // above the top barrier: the surface is cut away there
    return bl(S.z);
  };

  /* ---------------- WebGL landscape ----------------
     The free-energy landscape drawn as smooth-shaded triangles (colour interpolated across every pixel,
     real depth buffer), into a shared offscreen WebGL canvas. M maps world (x, y, z) to clip space
     (column-major 4 x 4); the caller lays the canvas onto its picture at the surface opacity.
     surf = { xs, ys, z, t }: map coordinates, world heights, colour value (0 high plain .. 1 deep well).
     o = { k: x, y stretch, fade: map units over which the far edge fades out (0 = none), R: reach }. */
  let GL = null;
  function glInit() {
    if (GL) return GL.ok ? GL : null;
    GL = { ok: false };
    try {
      const cv = document.createElement("canvas");
      const gl = cv.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true, alpha: true });
      if (!gl) return null;
      const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
      const pg = gl.createProgram();
      gl.attachShader(pg, sh(gl.VERTEX_SHADER, "attribute vec3 p;attribute vec4 c;uniform mat4 M;varying vec4 v;varying float dd;void main(){v=c;gl_Position=M*vec4(p,1.0);dd=gl_Position.w;}"));
      gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, "precision mediump float;uniform vec2 fog;uniform float cut;uniform float am;varying vec4 v;varying float dd;void main(){float a=v.a;if(cut>0.5){if(a<0.5)discard;a=1.0;}float f=clamp((dd-fog.x)/(fog.y-fog.x),0.0,1.0);gl_FragColor=vec4(v.rgb,a*am*(1.0-f*f*(3.0-2.0*f)));}"));
      gl.linkProgram(pg);
      if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) return null;
      Object.assign(GL, { ok: true, cv, gl, pg, aP: gl.getAttribLocation(pg, "p"), aC: gl.getAttribLocation(pg, "c"), uM: gl.getUniformLocation(pg, "M"), uF: gl.getUniformLocation(pg, "fog"), uCut: gl.getUniformLocation(pg, "cut"), uA: gl.getUniformLocation(pg, "am"), bufs: new WeakMap() });
      return GL;
    } catch (_) { return null; }
  }
  const LIGHTV = norm([-0.45, 0.35, 0.82]);
  const MESH = new WeakMap();
  // cut: drop the part above the top barrier (surf.s = (top - F) / top per vertex; the rim is where it
  // crosses 0, interpolated per pixel). The fill and the wireframe share this.
  function meshOf(surf, k, fade, cut) {                    // triangles + wireframe, lit per-vertex colours; cached
    const key = k + "|" + fade + "|" + (cut ? 1 : 0);
    let cache = MESH.get(surf);
    if (!cache) MESH.set(surf, cache = {});
    if (cache[key]) return cache[key];
    const xs = surf.xs, ys = surf.ys, Z = surf.z, T = surf.t, nx = xs.length, ny = ys.length;
    const R0 = Math.max(-xs[0], xs[nx - 1] - 1, -ys[0], ys[ny - 1] - 1);
    const vx = new Float32Array(nx * ny * 3), vc = new Float32Array(nx * ny * 4), va = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c, z = Z[r][c];
      vx[i * 3] = xs[c] - 0.5; vx[i * 3 + 1] = 0.5 - ys[r]; vx[i * 3 + 2] = z;
      const c0 = Math.max(0, c - 1), c1 = Math.min(nx - 1, c + 1), r0 = Math.max(0, r - 1), r1 = Math.min(ny - 1, r + 1);
      const dzx = (Z[r][c1] - Z[r][c0]) / (((xs[c1] - xs[c0]) || 1) * k), dzy = -(Z[r1][c] - Z[r0][c]) / (((ys[r1] - ys[r0]) || 1) * k);
      const nl = Math.hypot(dzx, dzy, 1), lit = Math.max(0, (-dzx * LIGHTV[0] - dzy * LIGHTV[1] + LIGHTV[2]) / nl);
      const sh = 0.8 + 0.28 * lit, col = rgbOf(T[r][c]);
      const out = Math.max(0, -xs[c], xs[c] - 1, -ys[r], ys[r] - 1);
      const a = cut && surf.s ? 0.5 + 0.5 * clamp(surf.s[r][c], -1, 1) : (fade > 0 ? clamp(1 - (out - (R0 - fade)) / fade, 0, 1) : 1);
      va[i] = a;
      vc[i * 4] = Math.min(1, col[0] * sh / 255); vc[i * 4 + 1] = Math.min(1, col[1] * sh / 255); vc[i * 4 + 2] = Math.min(1, col[2] * sh / 255); vc[i * 4 + 3] = a;
    }
    const nt = (nx - 1) * (ny - 1) * 6, P = new Float32Array(nt * 3), C = new Float32Array(nt * 4);
    let o = 0;
    const put = i => { P.set(vx.subarray(i * 3, i * 3 + 3), o * 3); C.set(vc.subarray(i * 4, i * 4 + 4), o * 4); o++; };
    for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
      put(a); put(b); put(e); put(a); put(e); put(d);
    }
    // Wireframe: every second grid line each way, as line segments.
    const segs = [];
    for (let r = 0; r < ny; r += 2) for (let c = 0; c < nx - 1; c++) segs.push(r * nx + c, r * nx + c + 1);
    for (let c = 0; c < nx; c += 2) for (let r = 0; r < ny - 1; r++) segs.push(r * nx + c, (r + 1) * nx + c);
    const LP = new Float32Array(segs.length * 3), LC = new Float32Array(segs.length * 4);
    segs.forEach((i, q) => {
      LP.set(vx.subarray(i * 3, i * 3 + 3), q * 3);
      LC[q * 4] = 0.30; LC[q * 4 + 1] = 0.35; LC[q * 4 + 2] = 0.39; LC[q * 4 + 3] = va[i];
    });
    return (cache[key] = { P, C, n: nt, LP, LC, ln: segs.length });
  }
  // o = { k, fade, fog: [start, end], cut (bool), wire (bool) }
  D.glSurface = function (surf, M, W, H, o) {
    o = o || {};
    const G = glInit();
    if (!G || !surf || !surf.xs) return null;
    const gl = G.gl, mesh = meshOf(surf, o.k || 1, o.fade || 0, !!o.cut);
    if (G.cv.width !== W || G.cv.height !== H) { G.cv.width = W; G.cv.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(G.pg);
    let b = G.bufs.get(mesh);
    if (!b) {
      b = { p: gl.createBuffer(), c: gl.createBuffer(), lp: gl.createBuffer(), lc: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, b.p); gl.bufferData(gl.ARRAY_BUFFER, mesh.P, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.c); gl.bufferData(gl.ARRAY_BUFFER, mesh.C, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.lp); gl.bufferData(gl.ARRAY_BUFFER, mesh.LP, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.lc); gl.bufferData(gl.ARRAY_BUFFER, mesh.LC, gl.STATIC_DRAW);
      G.bufs.set(mesh, b);
    }
    gl.uniformMatrix4fv(G.uM, false, new Float32Array(M));
    const fg = o.fog || [1e8, 2e8];                       // distance haze: fades out between these depths
    gl.uniform2f(G.uF, fg[0], fg[1]);
    gl.uniform1f(G.uCut, o.cut ? 1 : 0);
    const bind = (pb, cb) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.enableVertexAttribArray(G.aP); gl.vertexAttribPointer(G.aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.enableVertexAttribArray(G.aC); gl.vertexAttribPointer(G.aC, 4, gl.FLOAT, false, 0, 0);
    };
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);   // the wireframe sits just on top of the fill
    gl.uniform1f(G.uA, 1);
    bind(b.p, b.c);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (o.wire) {
      gl.uniform1f(G.uA, 1);
      bind(b.lp, b.lc);
      gl.drawArrays(gl.LINES, 0, mesh.ln);
    }
    return G.cv;
  };
  // Clip-space matrix of the drone's perspective camera (with the x, y spread k).
  D.persp = function (cam, W, H, fov, k) {
    const C = D.camera(cam, W, H, fov), n = 0.01, fa = 60, A = (fa + n) / (fa - n), B = -2 * fa * n / (fa - n);
    const row = (v, s) => [v[0] * k * s, v[1] * k * s, v[2] * s, -dot(v, cam.pos) * s];
    const rx = row(C.r, 2 * C.F / W), ry = row(C.u, 2 * C.F / H), rw = row(C.f, 1);
    const rz = [rw[0] * A, rw[1] * A, rw[2] * A, rw[3] * A + B];
    return [rx[0], ry[0], rz[0], rw[0], rx[1], ry[1], rz[1], rw[1], rx[2], ry[2], rz[2], rw[2], rx[3], ry[3], rz[3], rw[3]];
  };

  /* ---------------- renderer (canvas 2D) ----------------
     o: { W, H, fov (deg), lod (1 full, 2 preview), alpha (surface opacity), surface (bool), path (optional
     preview of the flight: {pts, keys}) }. Painter's algorithm: the floor first, then the surface, tree,
     nodes and gap markers sorted far to near. Sizes are tuned for 1080p and scale with the frame. */
  function fieldColour(t) {
    t = clamp(t, 0, 1);
    const A = [251, 250, 248], B = [132, 151, 176], C = [186, 87, 87];
    const [a, b, f] = t < 0.5 ? [A, B, t / 0.5] : [B, C, (t - 0.5) / 0.5];
    return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(",") + ")";
  }
  const COLCACHE = new Map();
  const colOf = t => { const k = Math.round(clamp(t, 0, 1) * 200); let c = COLCACHE.get(k); if (!c) { c = fieldColour(k / 200); COLCACHE.set(k, c); } return c; };

  D.camera = function (cam, W, H, fov) {
    const f = norm(sub(cam.tgt, cam.pos));
    let r = cross(f, [0, 0, 1]);
    if (len(r) < 1e-6) r = [1, 0, 0];
    r = norm(r);
    const u = cross(r, f), F = (H / 2) / Math.tan((fov || 50) * Math.PI / 360);
    return { pos: cam.pos, f, r, u, F, W, H,
      proj(w) { const p = sub(w, cam.pos), z = dot(p, f); return [W / 2 + F * dot(p, r) / Math.max(z, 1e-3), H / 2 - F * dot(p, u) / Math.max(z, 1e-3), z]; } };
  }

  const NEAR = 0.03;

  // Smooth versions of the surface and floor: the grids upsampled f times with bicubic (Catmull-Rom)
  // interpolation, cached per scene. Where the surface is not drawn (above the top barrier) it is
  // treated as the top itself, so the cut-off edge stays where the 3D view puts it.
  const SMOOTH = new WeakMap();
  function cubic(p0, p1, p2, p3, t) {
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  function upsample(g, f) {
    const G = g.length, M = (G - 1) * f + 1, out = [];
    const at = (r, c) => g[clamp(r, 0, G - 1)][clamp(c, 0, G - 1)];
    for (let i = 0; i < M; i++) {
      const y = i / f, r = Math.floor(Math.min(y, G - 2)), ty = y - r, row = new Float32Array(M);
      for (let j = 0; j < M; j++) {
        const x = j / f, c = Math.floor(Math.min(x, G - 2)), tx = x - c;
        const col = k => cubic(at(r + k, c - 1), at(r + k, c), at(r + k, c + 1), at(r + k, c + 2), tx);
        row[j] = cubic(col(-1), col(0), col(1), col(2), ty);
      }
      out.push(row);
    }
    return out;
  }
  function smoothOf(scene, f) {
    let c = SMOOTH.get(scene);
    if (!c) SMOOTH.set(scene, c = {});
    if (c[f]) return c[f];
    const out = {};
    if (scene.floor) out.floor = upsample(scene.floor, f);
    return (c[f] = out);
  }
  function rgbOf(t) {
    t = clamp(t, 0, 1);
    const A = [251, 250, 248], B = [132, 151, 176], C = [186, 87, 87];
    const [a, b, f] = t < 0.5 ? [A, B, t / 0.5] : [B, C, (t - 0.5) / 0.5];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  // Offscreen layers: a sheet is drawn opaque (so neighbouring tiles leave no seams) and then laid onto
  // the frame at its opacity.
  const LAYERS = new WeakMap();
  function layerFor(ctx, W, H) {
    let L = LAYERS.get(ctx);
    if (!L) {
      const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
      L = { cv, ctx: cv.getContext("2d") };
      LAYERS.set(ctx, L);
    }
    if (L.cv.width !== W || L.cv.height !== H) { L.cv.width = W; L.cv.height = H; }
    L.ctx.setTransform(1, 0, 0, 1, 0, 0);
    L.ctx.clearRect(0, 0, W, H);
    return L;
  }

  // o: { W, H, fov, lod (1 full, 2 preview), alpha, surface, bg, spread (x, y stretch), path }.
  D.render = function (ctx, scene, cam, o) {
    const W = o.W, H = o.H, C = D.camera(cam, W, H, o.fov), s = H / 1080, lod = o.lod || 1;
    const k = o.spread || 1, f = lod > 1 ? 1 : 3;
    const pr = w => C.proj([w[0] * k, w[1] * k, w[2]]);
    const sm = smoothOf(scene, f);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = o.bg || "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const quad = (c, q, fill) => {
      c.beginPath(); c.moveTo(q[0][0], q[0][1]); c.lineTo(q[1][0], q[1][1]); c.lineTo(q[2][0], q[2][1]); c.lineTo(q[3][0], q[3][1]); c.closePath();
      c.fillStyle = fill; c.fill(); c.strokeStyle = fill; c.lineWidth = 1; c.stroke();   // same-colour edge closes seams
    };
    const sheet = (grid, zOf, colour, keep) => {          // projected, depth-sorted opaque tiles of one grid
      const M = grid.length, step = 1 / (M - 1), P = [];
      for (let r = 0; r < M; r++) {
        const row = [];
        for (let c = 0; c < M; c++) row.push(pr([c * step - 0.5, 0.5 - r * step, zOf(r, c)]));
        P.push(row);
      }
      const tiles = [];
      for (let r = 0; r < M - 1; r++) for (let c = 0; c < M - 1; c++) {
        if (!keep(r, c)) continue;
        const q = [P[r][c], P[r][c + 1], P[r + 1][c + 1], P[r + 1][c]];
        if (q[0][2] < NEAR || q[1][2] < NEAR || q[2][2] < NEAR || q[3][2] < NEAR) continue;
        tiles.push({ d: (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4, q, r, c });
      }
      tiles.sort((a, b) => b.d - a.d);
      const L = layerFor(ctx, W, H);
      for (const tl of tiles) quad(L.ctx, tl.q, colour(tl.r, tl.c));
      return L.cv;
    };

    // Floor: the Topic Map density as one smooth sheet, its contours, the border, paper shadows.
    if (sm.floor) {
      const g = sm.floor;
      const v4 = (r, c) => (g[r][c] + g[r][c + 1] + g[r + 1][c] + g[r + 1][c + 1]) / 4;
      const cv = sheet(g, () => 0, (r, c) => { const [R, G, B] = rgbOf(v4(r, c)); return `rgb(${R | 0},${G | 0},${B | 0})`; }, (r, c) => v4(r, c) >= 0.03);
      ctx.globalAlpha = 0.7; ctx.drawImage(cv, 0, 0); ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#55626a"; ctx.lineWidth = 0.8 * s * 1.3;
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of scene.contours || []) {
        const a = pr([x1 - 0.5, 0.5 - y1, 0]), b = pr([x2 - 0.5, 0.5 - y2, 0]);
        if (a[2] < NEAR || b[2] < NEAR) continue;
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const bd = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => pr([a, b, 0]));
    if (bd.every(p => p[2] > NEAR)) {
      ctx.beginPath(); bd.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
      ctx.strokeStyle = "#c9cfd3"; ctx.lineWidth = 1.2 * s; ctx.stroke();
    }
    for (const m of scene.flat || []) drawPrim(ctx, m, pr, s, 1);

    // Tree, nodes and gap markers, far to near.
    const items = [];
    for (const m of scene.prims || []) {
      if (m.k === "line") {
        const a = pr(m.a), b = pr(m.b);
        if (a[2] < NEAR || b[2] < NEAR) continue;
        items.push({ d: (a[2] + b[2]) / 2, m, a, b, w: [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2] });
      } else {
        const p = pr(m.p);
        if (p[2] < NEAR) continue;
        items.push({ d: p[2] - 1e-3, m, p, j: m.j ? pr(m.j) : null, w: m.p });
      }
    }
    items.sort((a, b) => b.d - a.d);

    // The surface: one smooth, softly lit sheet. What it hides (seen through it) is drawn first and tinted
    // by the sheet; what stands in front of it is drawn on top. A point is hidden when the line of sight
    // to it passes under the surface.
    const S = scene.surface, showS = S && S.xs && o.surface !== false && (o.alpha == null || o.alpha > 0);
    let front = items;
    if (showS) {
      const zmax = S.zmax || 2;
      const hid = w => {                                  // the line of sight passes under the landscape
        const cp = cam.pos, n = 32;
        for (let i = 1; i < n; i++) {
          const t = i / n * 0.97, x = (cp[0] + (w[0] * k - cp[0]) * t) / k, y = (cp[1] + (w[1] * k - cp[1]) * t) / k, z = cp[2] + (w[2] - cp[2]) * t;
          if (z > zmax + 0.01) continue;
          if (z < D.surfaceZ(scene, x, y) - 0.004) return true;
        }
        return false;
      };
      const behind = [];
      front = [];
      for (const it of items) (hid(it.w) ? behind : front).push(it);
      for (const it of behind) drawPrim(ctx, it.m, pr, s, 0, it);
      const gcv = D.glSurface(S, D.persp(cam, W, H, o.fov, k), W, H, { k, fade: 0, cut: !!S.s, wire: !!o.wire });
      if (gcv) {
        ctx.globalAlpha = o.alpha == null ? 0.35 : o.alpha;
        ctx.drawImage(gcv, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
    for (const it of front) drawPrim(ctx, it.m, pr, s, 0, it);

    if (o.path && o.path.pts && o.path.pts.length > 1) {   // the flight path, while editing (in drone space)
      const pp = w => C.proj(w);
      const pts = o.path.pts.map(pp);
      ctx.strokeStyle = "#ba5757"; ctx.lineWidth = 2.2 * s; ctx.setLineDash([8 * s, 6 * s]);
      ctx.beginPath();
      for (let i = 0; i < pts.length - 1; i++)
        if (pts[i][2] > NEAR && pts[i + 1][2] > NEAR) { ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); }
      ctx.stroke(); ctx.setLineDash([]);
      (o.path.keys || []).forEach((kp, i) => {
        const p = pp(kp); if (p[2] <= NEAR) return;
        const R = 11 * s;
        ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
        ctx.fillStyle = o.path.sel === i ? "#ba5757" : "#1e2a31"; ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(11 * s)}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p[0], p[1] + 0.5);
      });
    }
    ctx.globalAlpha = 1;
  };
  function drawPrim(ctx, m, pr, s, flat, it) {
    if (m.k === "line") {
      const a = it ? it.a : pr(m.a), b = it ? it.b : pr(m.b);
      if (a[2] < NEAR || b[2] < NEAR) return;
      ctx.strokeStyle = m.c; ctx.lineWidth = (m.w || 1) * s * (flat ? 1 : 1.5);
      if (m.dash) ctx.setLineDash(m.dash.map(x => x * s * 1.5));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if (m.dash) ctx.setLineDash([]);
    } else if (m.k === "dot") {
      const p = it ? it.p : pr(m.p);
      if (p[2] < NEAR) return;
      const R = m.r * s * (flat ? 1.3 : clamp(2.2 / p[2], 1.3, 3.2));
      ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
      ctx.fillStyle = m.fill; ctx.fill();
      if (m.stroke) { ctx.strokeStyle = m.stroke; ctx.lineWidth = (m.sw || 1) * s; ctx.stroke(); }
    } else if (m.k === "gap") {
      const p = it ? it.p : pr(m.p), j = it ? it.j : (m.j ? pr(m.j) : null);
      if (p[2] < NEAR) return;
      if (j && j[2] > NEAR) {
        ctx.strokeStyle = "#9c6b00"; ctx.lineWidth = 1.6 * s; ctx.setLineDash([5 * s, 4 * s]);
        ctx.beginPath(); ctx.moveTo(j[0], j[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); ctx.setLineDash([]);
      }
      const R = 13 * s * clamp(2.2 / p[2], 1, 2.6);
      ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
      ctx.fillStyle = "#f2c94c"; ctx.fill(); ctx.strokeStyle = "#9c6b00"; ctx.lineWidth = 1.6 * s; ctx.stroke();
      ctx.fillStyle = "#5a3d00"; ctx.font = `700 ${Math.round(R * 0.85)}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(m.label || "G", p[0], p[1] + 0.5);
    }
  }

  // The camera at time t, kept above the surface when asked (so a path never dives into a ridge).
  // The drone at time t: exactly the planned path (it flies through the see-through surface).
  D.frameCam = function (scene, path, t) {
    const c = D.camAt(path, t);
    if (!c) return null;
    const pos = c.pos.slice();
    pos[2] = Math.max(pos[2], 0.01);
    return { pos, tgt: c.tgt };
  };

  /* ---------------- flight file ---------------- */
  // flight = { scene, keys, settings: { W, H, fps, fov, alpha, surface, bg, spread, wire }, title }
  D.flightHTML = function (flight) {
    const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const data = JSON.stringify(flight, (k, v) => typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(flight.title || "Eratost flight")}</title>
<style>html,body{margin:0;background:#11161a;color:#e8ecef;font:13px/1.45 system-ui,sans-serif}
#stage{display:flex;justify-content:center;align-items:center;height:calc(100vh - 118px)}
canvas{background:#fff;max-width:100%;max-height:100%;box-shadow:0 6px 30px rgba(0,0,0,.4)}
#bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px}
#bar button{font:inherit;background:#68829e;color:#fff;border:0;border-radius:7px;padding:6px 12px;cursor:pointer}
#bar button:disabled{opacity:.5;cursor:wait}#t{flex:1;min-width:160px}
details{padding:0 16px 10px;color:#aab4bb}code,pre{background:#1d252b;border-radius:6px;padding:2px 5px;color:#e8ecef}pre{padding:10px;overflow:auto}
body.frame{background:#fff}body.frame #stage{height:auto;display:block}body.frame #bar,body.frame details{display:none}body.frame canvas{box-shadow:none;display:block}</style>
</head><body><div id="stage"><canvas id="c"></canvas></div>
<div id="bar"><button id="play">▶ Play</button><input id="t" type="range" min="0" step="0.001" value="0"/><span id="time"></span>
<button id="rec">● Record WebM</button><span id="msg"></span></div>
<details><summary>Render a full-quality MP4 (frame by frame)</summary>
<p>Open this file with <code>?frame=N</code> to get frame N at full size. With Chrome and ffmpeg installed (bash, WSL or Git Bash):</p>
<pre id="cmd"></pre></details>
<script>${D.src}<\/script>
<script>window.FLIGHT = ${data};
Drone.player(document.getElementById("c"), FLIGHT);<\/script></body></html>`;
  };

  // Player inside the flight file: exact frames for ?frame=N, otherwise an interactive player.
  D.player = function (canvas, F) {
    const st = F.settings, path = D.prepare(F.keys), fps = st.fps || 30;
    const N = Math.max(1, Math.round(path.duration * fps) + 1);
    const ctx = canvas.getContext("2d");
    canvas.width = st.W; canvas.height = st.H;
    const opt = lod => ({ W: st.W, H: st.H, fov: st.fov, lod, alpha: st.alpha, surface: st.surface, bg: st.bg, spread: st.spread || 1, wire: !!st.wire });
    const draw = (t, lod) => { const c = D.frameCam(F.scene, path, t); if (c) D.render(ctx, F.scene, c, opt(lod)); };
    const q = new URLSearchParams(location.search), fr = q.get("frame");
    if (fr != null) {                                      // exact frame for the MP4 script
      document.body.classList.add("frame");
      canvas.style.width = st.W + "px"; canvas.style.height = st.H + "px";
      draw(clamp(+fr, 0, N - 1) / fps, 1);
      document.title = "frame " + fr;
      return;
    }
    const $ = id => document.getElementById(id);
    const slider = $("t"), time = $("time"), play = $("play"), rec = $("rec"), msg = $("msg");
    slider.max = path.duration;
    const fmt = t => t.toFixed(1) + " s / " + path.duration.toFixed(1) + " s";
    let t = 0, playing = false, last = 0, idle = null;
    const show = (lod) => { draw(t, lod); slider.value = t; time.textContent = fmt(t); };
    const tick = now => {
      if (!playing) return;
      t += (now - last) / 1000; last = now;
      if (t >= path.duration) { t = path.duration; playing = false; play.textContent = "▶ Play"; show(1); return; }
      show(2);
      requestAnimationFrame(tick);
    };
    play.onclick = () => {
      if (playing) { playing = false; play.textContent = "▶ Play"; show(1); return; }
      if (t >= path.duration) t = 0;
      playing = true; play.textContent = "❚❚ Pause"; last = performance.now(); requestAnimationFrame(tick);
    };
    slider.oninput = () => { t = +slider.value; playing = false; play.textContent = "▶ Play"; show(2); clearTimeout(idle); idle = setTimeout(() => show(1), 160); };
    rec.onclick = async () => {                            // real-time capture at full quality
      if (!window.MediaRecorder || !canvas.captureStream) { msg.textContent = "This browser cannot record; use the MP4 script below."; return; }
      playing = false; rec.disabled = play.disabled = true;
      const stream = canvas.captureStream(0), track = stream.getVideoTracks()[0];
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(m => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(st.W * st.H * fps * 0.12) });
      const chunks = [];
      mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      const done = new Promise(r => mr.onstop = r);
      mr.start();
      const t0 = performance.now();
      let slow = 0;
      for (let i = 0; i < N; i++) {
        const due = t0 + i * 1000 / fps;
        const wait = due - performance.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait)); else if (wait < -1000 / fps) slow++;
        t = i / fps; draw(t, 1); track.requestFrame && track.requestFrame();
        if (i % 10 === 0) { slider.value = t; time.textContent = fmt(t); msg.textContent = "Recording… " + Math.round(100 * i / N) + "%"; }
      }
      mr.stop(); await done;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      a.download = (F.title || "flight").replace(/[^\w-]+/g, "_").slice(0, 60) + ".webm";
      a.click();
      msg.textContent = slow > N * 0.05 ? "Saved. This machine could not keep up, so some motion may stutter: use the MP4 script for a perfect video." : "Saved.";
      rec.disabled = play.disabled = false;
    };
    const name = "flight.html";
    $("cmd").textContent =
`mkdir -p frames
for i in $(seq 0 ${N - 1}); do
  "<path to chrome>" --headless=old --hide-scrollbars --window-size=${st.W},${st.H} \\
    --screenshot="frames/f$(printf %05d $i).png" "file:///<full path to>/${name}?frame=$i"
done
ffmpeg -framerate ${fps} -i frames/f%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart flight.mp4
# ${N} frames, ${path.duration.toFixed(1)} s at ${fps} fps, ${st.W}x${st.H}`;
    const fit = () => { const r = Math.min((innerWidth - 32) / st.W, (innerHeight - 140) / st.H, 1); canvas.style.width = st.W * r + "px"; canvas.style.height = st.H * r + "px"; };
    addEventListener("resize", fit); fit();
    show(1);
  };

  /* ---------------- editor ---------------- */
  const SIZES = [[1920, 1080, "1080p (16:9)"], [1280, 720, "720p (16:9)"], [3840, 2160, "4K (16:9)"], [1080, 1920, "vertical 1080×1920 (Reels / Shorts)"], [1080, 1080, "square 1080×1080"]];
  D.openEditor = function (scene, opts) {
    opts = opts || {};
    const storeKey = "eratost_drone:" + (opts.sessionId || "default");
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (_) { saved = null; }
    const st = Object.assign({ W: 1920, H: 1080, fps: 30, fov: 52, alpha: 0.35, surface: !!scene.surface, bg: "#ffffff", spread: 1, wire: true, newDur: 3, newEase: "smooth" },
                             (saved && saved.settings) || {});
    let keys = (saved && Array.isArray(saved.keys)) ? saved.keys : [];
    let sel = -1;
    const save = () => { try { localStorage.setItem(storeKey, JSON.stringify({ keys, settings: st })); } catch (_) {} };

    // Free camera: position + yaw / pitch (degrees). Starts on a wide view of the whole landscape.
    const cam = { pos: [1.35, -1.35, 1.05], yaw: 135, pitch: -24 };
    const dirOf = (yaw, pitch) => { const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180; return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)]; };
    const LOOK = 0.8;                                      // look-at distance stored with each key
    const camNow = () => ({ pos: cam.pos.slice(), tgt: add(cam.pos, mul(dirOf(cam.yaw, cam.pitch), LOOK)) });
    const setCam = k => {
      cam.pos = k.pos.slice();
      const d = norm(sub(k.tgt, k.pos));
      cam.yaw = Math.atan2(d[1], d[0]) * 180 / Math.PI;
      cam.pitch = Math.asin(clamp(d[2], -1, 1)) * 180 / Math.PI;
    };
    {                                                      // aim the start view at the landscape's middle
      const d = norm(sub([0, 0, (scene.top || 0.8) * 0.4], cam.pos));
      cam.yaw = Math.atan2(d[1], d[0]) * 180 / Math.PI; cam.pitch = Math.asin(d[2]) * 180 / Math.PI;
    }

    const el = document.createElement("div");
    el.className = "drone-ui";
    el.innerHTML = `<style>
.drone-ui{position:fixed;inset:0;z-index:9999;background:#f4f5f6;display:flex;font:12.5px/1.45 system-ui,sans-serif;color:#1e2a31}
.drone-ui .dv{flex:1;min-width:0;display:flex;flex-direction:column;padding:14px;gap:8px}
.drone-ui .dv-wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.drone-ui canvas{background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.12);border-radius:4px;cursor:grab;outline:none}
.drone-ui canvas:focus{box-shadow:0 0 0 2px #68829e,0 2px 14px rgba(0,0,0,.12)}
.drone-ui .dv-tl{display:flex;gap:10px;align-items:center}
.drone-ui .dv-tl input[type=range]{flex:1}
.drone-ui .dp{width:360px;flex:0 0 360px;background:#fff;border-left:1px solid #e3e6e8;overflow:auto;padding:14px 14px 30px;display:flex;flex-direction:column;gap:12px}
.drone-ui h3{margin:0;font-size:15px}.drone-ui h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
.drone-ui button{font:inherit;border:1px solid #d5dade;background:#fff;border-radius:7px;padding:5px 10px;cursor:pointer;color:#1e2a31}
.drone-ui button:hover{border-color:#68829e;color:#68829e}
.drone-ui button.pri{background:#68829e;border-color:#68829e;color:#fff}.drone-ui button.pri:hover{background:#586f87;color:#fff}
.drone-ui .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.drone-ui .muted{color:#6b7280}
.drone-ui .keys{display:flex;flex-direction:column;gap:6px}
.drone-ui .key{border:1px solid #e3e6e8;border-radius:8px;padding:7px 8px;display:flex;flex-direction:column;gap:5px}
.drone-ui .key.sel{border-color:#ba5757;background:#fbf2f2}
.drone-ui .key .kn{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#1e2a31;color:#fff;align-items:center;justify-content:center;font-weight:700;font-size:11px}
.drone-ui .key.sel .kn{background:#ba5757}
.drone-ui .key input[type=number]{width:58px;font:inherit}.drone-ui select{font:inherit}
.drone-ui .key .mini button{padding:2px 7px;font-size:11.5px}
.drone-ui kbd{background:#eef0f2;border:1px solid #d5dade;border-bottom-width:2px;border-radius:4px;padding:0 4px;font:11px ui-monospace,monospace}
</style>
<div class="dv"><div class="row"><h3>Drone video</h3><span class="muted">${(opts.title || "").replace(/[<>&]/g, "")}</span><span style="flex:1"></span><button class="x-close">Close</button></div>
<div class="dv-wrap"><canvas tabindex="0"></canvas></div>
<div class="dv-tl"><button class="pri x-play">▶ Preview</button><input type="range" class="x-t" min="0" step="0.01" value="0"/><span class="x-time muted"></span></div>
<div class="muted">Fly: drag to look around · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>E</kbd>/<kbd>Q</kbd> up/down · wheel forward/back · hold <kbd>Shift</kbd> to go faster. Click the picture first so it takes the keys.</div></div>
<div class="dp">
<div><h4>Keyframes</h4><div class="row"><button class="pri x-add">+ Add keyframe here</button><button class="x-path">Hide path</button></div>
<div class="muted" style="margin-top:4px">Each keyframe is where the drone is and what it looks at. It flies a smooth curve through them in order. Per keyframe: <b>hover</b> = seconds it stays there, <b>fly</b> = seconds to reach the next one (longer = slower), <b>easing</b> = how it speeds up or slows down on that leg, <b>straight line / smooth curve</b> = the leg's shape (a curve bends smoothly through the neighbouring keyframes).</div></div>
<div class="keys"></div>
<div><h4>New keyframes get</h4><div class="row">fly <input type="number" class="x-ndur" min="0.2" step="0.5" style="width:58px"/> s <select class="x-nease"></select></div></div>
<div><h4>Look</h4>
<div class="row">surface <input type="checkbox" class="x-surf"/> opacity <input type="range" class="x-alpha" min="0" max="1" step="0.05" style="width:110px"/> <label><input type="checkbox" class="x-wire"/> wireframe</label></div>
<div class="row">lens (field of view) <input type="range" class="x-fov" min="25" max="95" step="1" style="width:110px"/> <span class="x-fovv"></span></div>
<div class="row" title="Stretch the landscape sideways (x, y) without changing its heights. Set it before placing keyframes: they live in the stretched space.">spread X,Y <input type="range" class="x-spread" min="1" max="2.5" step="0.05" style="width:110px"/> <span class="x-spreadv"></span></div>
</div>
<div><h4>Video</h4><div class="row"><select class="x-size"></select> <select class="x-fps"><option value="30">30 fps</option><option value="60">60 fps</option><option value="24">24 fps</option></select></div></div>
<div><h4>Export</h4><div class="row"><button class="pri x-dl">Download flight file</button></div>
<div class="muted" style="margin-top:4px">One HTML file with this landscape and path. Open it in any browser to play it or record a WebM. For a full-quality MP4, its "Render a full-quality MP4" box gives the Chrome + ffmpeg commands.</div>
<div class="row" style="margin-top:6px"><button class="x-savep">Save path (.json)</button><button class="x-loadp">Load path…</button><input type="file" class="x-file" accept=".json,application/json" style="display:none"/><button class="x-clear">Clear all</button></div></div>
</div>`;
    document.body.appendChild(el);
    const $ = c => el.querySelector("." + c);
    const canvas = el.querySelector("canvas"), ctx = canvas.getContext("2d");
    const slider = $("x-t"), timeEl = $("x-time"), playBtn = $("x-play");
    $("x-nease").innerHTML = D.EASES.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    $("x-size").innerHTML = SIZES.map(([w, h, t]) => `<option value="${w}x${h}">${t}</option>`).join("");

    let path = D.prepare(keys), showPath = true, playing = false, t = 0, last = 0, dirty = true, fast = false;
    const pressed = new Set();
    let pathPts = [];
    const rebuild = () => {
      path = D.prepare(keys);
      pathPts = [];
      if (path.keys.length > 1) for (let i = 0; i <= 200; i++) { const c = D.frameCam(scene, path, path.duration * i / 200); if (c) pathPts.push(c.pos); }
      slider.max = Math.max(0.01, path.duration);
      if (t > path.duration) t = path.duration;
      save(); dirty = true;
    };

    // Canvas size: the video's aspect, fitted into the view (preview resolution, not the export size).
    const size = () => {
      const wrap = el.querySelector(".dv-wrap"), bw = wrap.clientWidth, bh = wrap.clientHeight;
      const r = Math.min(bw / st.W, bh / st.H), cw = Math.max(200, Math.floor(st.W * r)), ch = Math.max(120, Math.floor(st.H * r));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      dirty = true;
    };
    const fmt = x => x.toFixed(1) + " s / " + path.duration.toFixed(1) + " s";
    const draw = lod => {
      const c = playing || (!showPathNow()) ? D.frameCam(scene, path, t) : camNow();
      if (!c) return;
      D.render(ctx, scene, c, { W: canvas.width, H: canvas.height, fov: st.fov, lod, alpha: st.alpha, surface: st.surface, bg: st.bg, spread: st.spread, wire: st.wire,
        path: !playing && showPath && !scrubView ? { pts: pathPts, keys: path.keys.map(k => k.pos), sel } : null });
      timeEl.textContent = fmt(t);
      slider.value = t;
    };
    let scrubView = false;                                 // after scrubbing, show the drone's own view
    const showPathNow = () => !scrubView;

    // Main loop: fly with the keys held, play the preview, redraw only when something changed.
    let lastFrame = performance.now(), idleSince = 0, hiq = true;
    const loop = now => {
      if (!el.isConnected) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      let moved = false;
      if (pressed.size && !playing) {
        const sp = (fast ? 1.2 : 0.4) * dt, f = dirOf(cam.yaw, cam.pitch), fl = norm([f[0], f[1], 0]), rt = [fl[1], -fl[0], 0];
        if (pressed.has("w")) cam.pos = add(cam.pos, mul(f, sp));
        if (pressed.has("s")) cam.pos = add(cam.pos, mul(f, -sp));
        if (pressed.has("d")) cam.pos = add(cam.pos, mul(rt, sp));
        if (pressed.has("a")) cam.pos = add(cam.pos, mul(rt, -sp));
        if (pressed.has("e")) cam.pos[2] += sp;
        if (pressed.has("q")) cam.pos[2] = Math.max(0.01, cam.pos[2] - sp);
        moved = true; scrubView = false;
      }
      if (playing) {
        t += dt;
        if (t >= path.duration) { t = path.duration; playing = false; playBtn.textContent = "▶ Preview"; dirty = true; hiq = false; }
        draw(2); hiq = false; idleSince = now;
      } else if (moved || dirty) {
        draw(2); dirty = false; hiq = false; idleSince = now;
      } else if (!hiq && now - idleSince > 140) { draw(1); hiq = true; }
      requestAnimationFrame(loop);
    };

    // Look around by dragging; wheel moves forward / back.
    let drag = null;
    canvas.addEventListener("pointerdown", e => { canvas.focus(); drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
    canvas.addEventListener("pointermove", e => {
      if (!drag || playing) return;
      cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.25;
      cam.pitch = clamp(drag.pitch - (e.clientY - drag.y) * 0.25, -89, 89);
      scrubView = false; dirty = true;
    });
    const end = () => { drag = null; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", e => { e.preventDefault(); if (playing) return; cam.pos = add(cam.pos, mul(dirOf(cam.yaw, cam.pitch), -e.deltaY * 0.0006)); scrubView = false; dirty = true; }, { passive: false });
    const onKey = down => e => {
      if (!el.isConnected) return;
      const tag = (e.target && e.target.tagName) || "";
      if (/INPUT|SELECT|TEXTAREA/.test(tag) && e.target.type !== "range" && e.target.type !== "checkbox") return;
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      if (down && k === "escape") { close(); return; }
      if ("wasdqe".includes(k) && k.length === 1) { e.preventDefault(); if (down) pressed.add(k); else pressed.delete(k); }
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    const blur = () => pressed.clear();
    window.addEventListener("blur", blur);
    window.addEventListener("resize", size);
    const close = () => {
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur); window.removeEventListener("resize", size);
      el.remove();
    };
    $("x-close").onclick = close;

    // Keyframe list.
    const keysEl = $("keys"), fmtP = p => p.map(v => v.toFixed(2)).join(", ");
    const renderKeys = () => {
      keysEl.innerHTML = keys.length ? keys.map((k, i) => `<div class="key${i === sel ? " sel" : ""}" data-i="${i}">
        <div class="row"><span class="kn">${i + 1}</span><span class="muted" title="position">at (${fmtP(k.pos)})</span></div>
        <div class="row">hover <input type="number" min="0" step="0.5" value="${+k.hold || 0}" data-f="hold"/> s
          ${i < keys.length - 1 ? `· fly <input type="number" min="0.2" step="0.5" value="${+k.dur || 3}" data-f="dur"/> s
          <select data-f="ease">${D.EASES.map(([v, tt]) => `<option value="${v}"${(k.ease || "smooth") === v ? " selected" : ""}>${tt}</option>`).join("")}</select>
          <select data-f="shape" title="How the drone travels to the next keyframe"><option value="straight"${k.shape !== "curve" ? " selected" : ""}>straight line</option><option value="curve"${k.shape === "curve" ? " selected" : ""}>smooth curve</option></select>` : `<span class="muted">· last keyframe</span>`}</div>
        <div class="row mini"><button data-a="go">Go to</button><button data-a="set" title="Move this keyframe to where the camera is now">Set to view</button>
          <button data-a="up" title="Earlier">↑</button><button data-a="down" title="Later">↓</button><button data-a="ins" title="Insert a new keyframe after this one, at the current view">+ after</button><button data-a="del">Delete</button></div></div>`).join("")
        : `<div class="muted">No keyframes yet. Fly to where the video should start and click "Add keyframe here".</div>`;
    };
    keysEl.addEventListener("change", e => {
      const box = e.target.closest(".key"); if (!box) return;
      const k = keys[+box.dataset.i], f = e.target.dataset.f;
      if (!k || !f) return;
      k[f] = f === "ease" || f === "shape" ? e.target.value : Math.max(f === "dur" ? 0.2 : 0, +e.target.value || 0);
      rebuild();
    });
    keysEl.addEventListener("click", e => {
      const b = e.target.closest("button"), box = e.target.closest(".key");
      if (!box) return;
      const i = +box.dataset.i;
      sel = i;
      if (b) {
        const a = b.dataset.a;
        if (a === "go") { setCam(keys[i]); scrubView = false; t = keyTime(i); }
        if (a === "set") { const c = camNow(); keys[i].pos = c.pos; keys[i].tgt = c.tgt; }
        if (a === "up" && i > 0) { [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]]; sel = i - 1; }
        if (a === "down" && i < keys.length - 1) { [keys[i + 1], keys[i]] = [keys[i], keys[i + 1]]; sel = i + 1; }
        if (a === "ins") { const c = camNow(); keys.splice(i + 1, 0, { pos: c.pos, tgt: c.tgt, dur: st.newDur, ease: st.newEase, hold: 0 }); sel = i + 1; }
        if (a === "del") { keys.splice(i, 1); sel = Math.min(sel, keys.length - 1); }
        rebuild();
      }
      renderKeys(); dirty = true;
    });
    const keyTime = i => { const l = path.legs.find(x => x.kind === "hold" && x.i === i); return l ? l.t0 : 0; };

    $("x-add").onclick = () => {
      const c = camNow();
      keys.push({ pos: c.pos, tgt: c.tgt, dur: st.newDur, ease: st.newEase, hold: 0 });
      sel = keys.length - 1; rebuild(); renderKeys(); canvas.focus();
    };
    $("x-path").onclick = () => { showPath = !showPath; $("x-path").textContent = showPath ? "Hide path" : "Show path"; dirty = true; };
    playBtn.onclick = () => {
      if (path.keys.length < 2) { timeEl.textContent = "Add at least two keyframes."; return; }
      if (playing) { playing = false; playBtn.textContent = "▶ Preview"; scrubView = true; dirty = true; hiq = false; return; }
      if (t >= path.duration - 1e-3) t = 0;
      playing = true; playBtn.textContent = "❚❚ Pause";
    };
    slider.addEventListener("input", () => { t = +slider.value; playing = false; playBtn.textContent = "▶ Preview"; scrubView = true; dirty = true; hiq = false; });

    // Settings.
    const bind = (cls, get, set, ev) => { const x = $(cls); get(x); x.addEventListener(ev || "change", () => { set(x); save(); dirty = true; hiq = false; }); };
    bind("x-ndur", x => x.value = st.newDur, x => st.newDur = Math.max(0.2, +x.value || 3));
    bind("x-nease", x => x.value = st.newEase, x => st.newEase = x.value);
    bind("x-surf", x => { x.checked = st.surface; x.disabled = !scene.surface; }, x => st.surface = x.checked);
    bind("x-alpha", x => x.value = st.alpha, x => st.alpha = +x.value, "input");
    bind("x-wire", x => x.checked = !!st.wire, x => st.wire = x.checked);
    bind("x-fov", x => { x.value = st.fov; $("x-fovv").textContent = st.fov + "°"; }, x => { st.fov = +x.value; $("x-fovv").textContent = st.fov + "°"; }, "input");
    bind("x-spread", x => { x.value = st.spread; $("x-spreadv").textContent = (+st.spread).toFixed(2) + "×"; }, x => { st.spread = +x.value; $("x-spreadv").textContent = st.spread.toFixed(2) + "×"; }, "input");
    bind("x-size", x => x.value = st.W + "x" + st.H, x => { const [w, h] = x.value.split("x").map(Number); st.W = w; st.H = h; size(); });
    bind("x-fps", x => x.value = String(st.fps), x => st.fps = +x.value);

    // Export / import.
    const download = (name, text, type) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    const base = () => ("eratost_" + (opts.title || "flight")).replace(/[^\w-]+/g, "_").slice(0, 60);
    $("x-dl").onclick = () => {
      if (path.keys.length < 2) { timeEl.textContent = "Add at least two keyframes first."; return; }
      const settings = { W: st.W, H: st.H, fps: st.fps, fov: st.fov, alpha: st.alpha, surface: st.surface, bg: st.bg, spread: st.spread, wire: !!st.wire };
      download(base() + "_flight.html", D.flightHTML({ title: "Eratost · " + (opts.title || "flight"), scene, keys, settings }), "text/html");
    };
    $("x-savep").onclick = () => download(base() + "_path.json", JSON.stringify({ keys, settings: st }, null, 1), "application/json");
    $("x-loadp").onclick = () => $("x-file").click();
    $("x-file").onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (Array.isArray(j.keys)) keys = j.keys;
        if (j.settings) Object.assign(st, j.settings);
        sel = -1; rebuild(); renderKeys(); size();
      } catch (_) { timeEl.textContent = "That file is not a saved path."; }
      e.target.value = "";
    };
    $("x-clear").onclick = () => { if (keys.length && !confirm("Remove all keyframes?")) return; keys = []; sel = -1; rebuild(); renderKeys(); };

    renderKeys(); rebuild(); size();
    requestAnimationFrame(t0 => { lastFrame = t0; requestAnimationFrame(loop); });
    canvas.focus();
    return { close };
  };

  root.Drone = D;
})(window);
