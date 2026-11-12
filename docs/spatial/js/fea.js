// Whim Spatial Bench: quick stress test.
// Linear elastic analysis on a grid of brick elements laid over the part. The grid lines follow the part's flat
// faces, so plates and box-built parts are meshed exactly; curved or tilted features are approximated by how much
// of each brick they fill. Bricks use incompatible bending modes (Wilson/Taylor), which keeps thin sections from
// reading too stiff. Pure maths: runs in a worker, on the main thread, or in Node.
// Units: metres, newtons, pascals. Strain order: xx, yy, zz, xy, yz, zx.
import { insideLocal, inside, toParent, qRot, qInv, localBBox, featurePlanes, leafBoxes } from "./model.js";

const C8 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const GAUSS = 1 / Math.sqrt(3);

function matmul(A, ar, ac, B, bc) {
  const C = new Float64Array(ar * bc);
  for (let i = 0; i < ar; i++) for (let k = 0; k < ac; k++) { const a = A[i * ac + k]; if (a !== 0) for (let j = 0; j < bc; j++) C[i * bc + j] += a * B[k * bc + j]; }
  return C;
}
function invert(A, n) {
  const M = Float64Array.from(A), I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (p !== c) for (let j = 0; j < n; j++) { let t = M[c * n + j]; M[c * n + j] = M[p * n + j]; M[p * n + j] = t; t = I[c * n + j]; I[c * n + j] = I[p * n + j]; I[p * n + j] = t; }
    const d = M[c * n + c];
    for (let j = 0; j < n; j++) { M[c * n + j] /= d; I[c * n + j] /= d; }
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r * n + c]; if (f !== 0) for (let j = 0; j < n; j++) { M[r * n + j] -= f * M[c * n + j]; I[r * n + j] -= f * I[c * n + j]; } }
  }
  return I;
}

/**
 * Stiffness (24x24) and corner stress matrices (8 x 6x24) of an hx*hy*hz brick with Young's modulus 1.
 * `occ` says how full each of the brick's eight octants is (0 to 1, octant o sits at corner o). Stiffness is
 * integrated octant by octant with that weight, plus a trace everywhere so a nearly empty brick stays well behaved.
 */
export function brick(hx, hy, hz, nu, occ = null) {
  const lam = nu / ((1 + nu) * (1 - 2 * nu)), mu = 0.5 / (1 + nu);
  const D = new Float64Array(36);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i * 6 + j] = lam + (i === j ? 2 * mu : 0);
  D[21] = D[28] = D[35] = mu;
  const inv = [2 / hx, 2 / hy, 2 / hz], w0 = hx * hy * hz / 64; let w = w0;
  const B = new Float64Array(144), G = new Float64Array(54);
  const cols = (M, n, c, dx, dy, dz) => {
    M[c] = dx; M[3 * n + c] = dy; M[5 * n + c] = dz;
    M[n + c + 1] = dy; M[3 * n + c + 1] = dx; M[4 * n + c + 1] = dz;
    M[2 * n + c + 2] = dz; M[4 * n + c + 2] = dy; M[5 * n + c + 2] = dx;
  };
  const at = (xi, eta, zeta) => {
    B.fill(0); G.fill(0);
    for (let a = 0; a < 8; a++) {
      const sx = 2 * C8[a][0] - 1, sy = 2 * C8[a][1] - 1, sz = 2 * C8[a][2] - 1;
      cols(B, 24, 3 * a, sx * (1 + sy * eta) * (1 + sz * zeta) / 8 * inv[0], (1 + sx * xi) * sy * (1 + sz * zeta) / 8 * inv[1], (1 + sx * xi) * (1 + sy * eta) * sz / 8 * inv[2]);
    }
    cols(G, 9, 0, -2 * xi * inv[0], 0, 0); cols(G, 9, 3, 0, -2 * eta * inv[1], 0); cols(G, 9, 6, 0, 0, -2 * zeta * inv[2]);
  };
  const addAtB = (K, A, ac, Bm, bc) => { for (let r = 0; r < 6; r++) for (let i = 0; i < ac; i++) { const a = A[r * ac + i] * w; if (a !== 0) for (let j = 0; j < bc; j++) K[i * bc + j] += a * Bm[r * bc + j]; } };
  const Kuu = new Float64Array(576), Kua = new Float64Array(216), Kaa = new Float64Array(81);
  for (let o = 0; o < 8; o++) {
    w = w0 * Math.max(occ ? occ[o] : 1, 1e-4);
    for (let p = 0; p < 8; p++) {
      at(0.5 * (2 * C8[o][0] - 1 + (2 * C8[p][0] - 1) * GAUSS), 0.5 * (2 * C8[o][1] - 1 + (2 * C8[p][1] - 1) * GAUSS), 0.5 * (2 * C8[o][2] - 1 + (2 * C8[p][2] - 1) * GAUSS));
      const DB = matmul(D, 6, 6, B, 24), DG = matmul(D, 6, 6, G, 9);
      addAtB(Kuu, B, 24, DB, 24); addAtB(Kua, B, 24, DG, 9); addAtB(Kaa, G, 9, DG, 9);
    }
  }
  const Kau = new Float64Array(216);
  for (let i = 0; i < 24; i++) for (let j = 0; j < 9; j++) Kau[j * 24 + i] = Kua[i * 9 + j];
  const T = matmul(invert(Kaa, 9), 9, 9, Kau, 24);          // internal modes = -T u
  const KT = matmul(Kua, 24, 9, T, 24), Ke = new Float64Array(576);
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) Ke[i * 24 + j] = 0.5 * (Kuu[i * 24 + j] - KT[i * 24 + j] + Kuu[j * 24 + i] - KT[j * 24 + i]);
  const S = new Float64Array(8 * 144);
  for (let c = 0; c < 8; c++) {
    at(2 * C8[c][0] - 1, 2 * C8[c][1] - 1, 2 * C8[c][2] - 1);
    const GT = matmul(G, 6, 9, T, 24), E = new Float64Array(144);
    for (let i = 0; i < 144; i++) E[i] = B[i] - GT[i];
    S.set(matmul(D, 6, 6, E, 24), c * 144);
  }
  return { Ke, S };
}

// ---------- grid ----------
function breakpoints(lo, hi, planes) {
  const eps = 1e-6 * (hi - lo) + 1e-9, pts = [lo];
  for (const p of planes.filter((v) => v > lo + eps && v < hi - eps).sort((a, b) => a - b)) if (p - pts[pts.length - 1] > eps) pts.push(p);
  pts.push(hi); return pts;
}
function planGrid(box, planes, budget) {
  const pts = [0, 1, 2].map((a) => breakpoints(box.min[a], box.max[a], planes[a]));
  const lens = () => pts.map((p) => p.slice(1).map((v, i) => v - p[i]));
  const cells = (h, minSub) => lens().map((L) => L.reduce((n, len) => n + Math.max(minSub, Math.ceil(len / h - 1e-9)), 0));
  const total = (c) => c[0] * c[1] * c[2];
  while (total(cells(Infinity, 1)) > budget) {            // too many faces to honour: merge the closest pair
    const a = [0, 1, 2].reduce((m, k) => (pts[k].length > pts[m].length ? k : m), 0);
    if (pts[a].length <= 2) break;
    let best = 1, gap = Infinity;
    for (let i = 1; i < pts[a].length - 1; i++) { const g = Math.min(pts[a][i] - pts[a][i - 1], pts[a][i + 1] - pts[a][i]); if (g < gap) { gap = g; best = i; } }
    pts[a].splice(best, 1);
  }
  const minSub = total(cells(Infinity, 2)) <= budget * 0.6 ? 2 : 1;
  let lo = 0, hi = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  for (let it = 0; it < 40; it++) { const mid = 0.5 * (lo + hi); if (total(cells(mid, minSub)) <= budget) hi = mid; else lo = mid; }
  return pts.map((p) => {
    const out = [p[0]];
    for (let i = 1; i < p.length; i++) { const m = Math.max(minSub, Math.ceil((p[i] - p[i - 1]) / hi - 1e-9)); for (let t = 1; t <= m; t++) out.push(p[i - 1] + (p[i] - p[i - 1]) * t / m); }
    return Float64Array.from(out);
  });
}

/**
 * How full each octant of each brick is: 8 sample points per octant, 64 per brick.
 * Bricks that lie clear of every shape, or wholly inside one square-on box with no hole near, are settled without sampling.
 */
function occupancy(part, xs, ys, zs, boxes) {
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1, ncell = nx * ny * nz;
  const fill = new Float32Array(ncell), occ = new Uint8Array(8 * ncell), SUB = [0.125, 0.375];
  const eps = 1e-9 * Math.max(xs[nx] - xs[0], ys[ny] - ys[0], zs[nz] - zs[0]);
  let partial = 0, nactive = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + nx * (j + ny * k), lo = [xs[i], ys[j], zs[k]], hi = [xs[i + 1], ys[j + 1], zs[k + 1]];
    let may = false, within = false, cut = false;
    for (const b of boxes) {
      if (b.min[0] >= hi[0] - eps || b.max[0] <= lo[0] + eps || b.min[1] >= hi[1] - eps || b.max[1] <= lo[1] + eps || b.min[2] >= hi[2] - eps || b.max[2] <= lo[2] + eps) continue;
      if (!b.adds) { cut = true; continue; }
      may = true;
      if (b.exact && b.min[0] <= lo[0] + eps && b.max[0] >= hi[0] - eps && b.min[1] <= lo[1] + eps && b.max[1] >= hi[1] - eps && b.min[2] <= lo[2] + eps && b.max[2] >= hi[2] - eps) within = true;
    }
    if (!may) continue;
    if (within && !cut) { occ.fill(8, 8 * c, 8 * c + 8); fill[c] = 1; nactive++; continue; }
    const hx = hi[0] - lo[0], hy = hi[1] - lo[1], hz = hi[2] - lo[2]; let n = 0;
    for (let o = 0; o < 8; o++) {
      let m = 0;
      for (let s = 0; s < 8; s++) if (insideLocal(part, [lo[0] + (SUB[C8[s][0]] + 0.5 * C8[o][0]) * hx, lo[1] + (SUB[C8[s][1]] + 0.5 * C8[o][1]) * hy, lo[2] + (SUB[C8[s][2]] + 0.5 * C8[o][2]) * hz])) m++;
      occ[8 * c + o] = m; n += m;
    }
    if (n >= 2) { fill[c] = n / 64; nactive++; if (n < 64) partial++; } else occ.fill(0, 8 * c, 8 * c + 8);
  }
  return { fill, occ, partial, nactive };
}

class TestError extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * Run a static test on one part.
 * part: prim or group node. clamps, loads: nodes in the same frame as the part.
 * mat: { E, nu, rho, S } in SI. g: gravity in m/s2 (acts along -Y of the frame the part sits in).
 */
export function runTest({ part, clamps = [], loads = [], mat, g = 9.80665, budget = 5000, selfWeight = true, solver = "auto", minReal = 1.5 }) {
  const t0 = Date.now(), warnings = [], notes = [];
  const box = localBBox(part);
  // The budget counts bricks that hold material, so a part that fills little of its bounding box (a bracket, a frame)
  // gets a finer grid for the same work. Plan, count, and re-plan until the count lands near the budget.
  const planes = featurePlanes(part, [...clamps, ...loads]), boxes = leafBoxes(part);
  let total = budget, xs, ys, zs, G;
  for (let pass = 0; pass < 4; pass++) {
    [xs, ys, zs] = planGrid(box, planes, total); G = occupancy(part, xs, ys, zs, boxes);
    if (!G.nactive) break;
    const next = Math.min(80000, Math.max(budget, total * budget / G.nactive));
    if (pass === 3 || (G.nactive <= 1.12 * budget && (G.nactive >= 0.8 * budget || next <= total * 1.05))) break;
    total = next;
  }
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1, mx = nx + 1, my = ny + 1, mz = nz + 1;
  const ncell = nx * ny * nz, nnode = mx * my * mz;
  const cellOf = (i, j, k) => i + nx * (j + ny * k), nodeOf = (i, j, k) => i + mx * (j + my * k);
  const OFF = C8.map((c) => c[0] + mx * (c[1] + my * c[2]));

  const { fill, occ, partial } = G;
  const pos = (n) => { const i = n % mx, j = ((n - i) / mx) % my, k = (n - i - mx * j) / (mx * my); return [xs[i], ys[j], zs[k]]; };
  const minCell = Math.min(...[xs, ys, zs].map((a) => { let m = Infinity; for (let i = 1; i < a.length; i++) m = Math.min(m, a[i] - a[i - 1]); return m; }));
  const tol = Math.max(1e-6, 0.02 * minCell);

  // nodes that belong to the part
  const active = new Uint8Array(nnode);
  const markActive = () => { active.fill(0); for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (fill[cellOf(i, j, k)] > 0) { const b = nodeOf(i, j, k); for (let a = 0; a < 8; a++) active[b + OFF[a]] = 1; } };
  markActive();

  // clamps hold nodes still
  const fixed = new Uint8Array(nnode);
  for (let n = 0; n < nnode; n++) if (active[n]) { const p = toParent(part, pos(n)); for (const c of clamps) if (inside(c, p, tol)) { fixed[n] = 1; break; } }

  // keep only material that is joined, face to face, to something clamped
  const seen = new Uint8Array(ncell), stack = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = cellOf(i, j, k); if (!(fill[c] > 0)) continue;
    const b = nodeOf(i, j, k); for (let a = 0; a < 8; a++) if (fixed[b + OFF[a]]) { seen[c] = 1; stack.push(i, j, k); break; }
  }
  if (!stack.length) throw new TestError("no-clamp", clamps.length ? "The clamp is not touching the part. Move it so it overlaps the part." : "Add a clamp so the part has something holding it.");
  while (stack.length) {
    const k = stack.pop(), j = stack.pop(), i = stack.pop();
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const id = cellOf(a, b, c); if (seen[id] || !(fill[id] > 0)) continue; seen[id] = 1; stack.push(a, b, c);
    }
  }
  let dropped = 0; for (let c = 0; c < ncell; c++) if (fill[c] > 0 && !seen[c]) { fill[c] = 0; dropped++; }
  if (dropped) { warnings.push("Some of the shape is not joined to the clamped part at this grid size and was left out."); markActive(); for (let n = 0; n < nnode; n++) if (!active[n]) fixed[n] = 0; }

  // three clamped points that are not in a line, or the part can still swing
  { const f = []; for (let n = 0; n < nnode && f.length < 4000; n++) if (fixed[n]) f.push(pos(n));
    let ok = false;
    if (f.length >= 3) { const a = f[0]; let b = null; for (const p of f) { if (!b) { if (Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) > 1e-9) b = p; continue; }
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
      if (Math.hypot(cx, cy, cz) > 1e-9 * Math.hypot(...u) * Math.hypot(...v) + 1e-18) { ok = true; break; } } }
    if (!ok) throw new TestError("clamp-small", "The clamp only grips a point or an edge, so the part could still swing. Make the clamp cover more of the part."); }

  // each node's share of the part's volume: used to spread weights evenly and for the part's own weight
  const lump = new Float64Array(nnode); let volume = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = cellOf(i, j, k); if (!(fill[c] > 0)) continue;
    const v = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]) * (zs[k + 1] - zs[k]) / 8, b = nodeOf(i, j, k);
    for (let a = 0; a < 8; a++) { const f = v * occ[8 * c + a] / 8; lump[b + OFF[a]] += f; volume += f; }
  }
  // forces: weights push on the nodes they touch, and the part's own weight acts everywhere
  const F = new Float64Array(3 * nnode), loaded = new Uint8Array(nnode);
  const down = qRot(qInv(part.quat), [0, -1, 0]), weight = mat.rho * g * volume;
  let applied = 0;
  for (const L of loads) {
    const hit = []; let share = 0;
    for (let n = 0; n < nnode; n++) if (active[n] && !fixed[n] && inside(L, toParent(part, pos(n)), tol)) { hit.push(n); share += lump[n]; }
    if (!hit.length) { warnings.push("A weight is not touching the part, so it was ignored."); continue; }
    const dir = qRot(qInv(part.quat), qRot(L.quat, [0, -1, 0])), f = L.kg * g / share;
    for (const n of hit) { F[3 * n] += dir[0] * f * lump[n]; F[3 * n + 1] += dir[1] * f * lump[n]; F[3 * n + 2] += dir[2] * f * lump[n]; loaded[n] = 1; }
    applied += L.kg * g;
  }
  if (selfWeight) for (let n = 0; n < nnode; n++) if (lump[n] > 0) { const w = mat.rho * g * lump[n]; F[3 * n] += down[0] * w; F[3 * n + 1] += down[1] * w; F[3 * n + 2] += down[2] * w; }

  // equations: number along the longest direction first to keep the matrix narrow
  const order = [0, 1, 2].sort((a, b) => [mx, my, mz][b] - [mx, my, mz][a]), dims = [mx, my, mz];
  const eq = new Int32Array(3 * nnode).fill(-1); let neq = 0; const ijk = [0, 0, 0];
  for (let a = 0; a < dims[order[0]]; a++) for (let b = 0; b < dims[order[1]]; b++) for (let c = 0; c < dims[order[2]]; c++) {
    ijk[order[0]] = a; ijk[order[1]] = b; ijk[order[2]] = c;
    const n = nodeOf(ijk[0], ijk[1], ijk[2]); if (active[n] && !fixed[n]) { eq[3 * n] = neq++; eq[3 * n + 1] = neq++; eq[3 * n + 2] = neq++; }
  }
  if (!neq) throw new TestError("all-fixed", "The clamp covers the whole part, so there is nothing left to test. Make the clamp smaller.");

  // one stiffness matrix per distinct brick size
  const sizeId = (arr) => { const ids = new Int32Array(arr.length - 1), seenLen = []; for (let i = 0; i < ids.length; i++) { const len = arr[i + 1] - arr[i]; let id = seenLen.findIndex((v) => Math.abs(v - len) <= 1e-9 * len); if (id < 0) { id = seenLen.length; seenLen.push(len); } ids[i] = id; } return { ids, lens: seenLen }; };
  const ax = sizeId(xs), ay = sizeId(ys), az = sizeId(zs), bricks = new Map();
  const cells = [], cellK = [], cellEq = [];
  let band = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = cellOf(i, j, k); if (!(fill[c] > 0)) continue;
    const o8 = occ.subarray(8 * c, 8 * c + 8), full = fill[c] === 1;
    const key = (ax.ids[i] * ay.lens.length + ay.ids[j]) * az.lens.length + az.ids[k] + (full ? "" : ":" + o8.join(""));
    if (!bricks.has(key)) bricks.set(key, brick(ax.lens[ax.ids[i]], ay.lens[ay.ids[j]], az.lens[az.ids[k]], mat.nu, full ? null : Array.from(o8, (v) => v / 8)));
    const b = nodeOf(i, j, k); let lo = Infinity, hi = -1;
    for (let a = 0; a < 8; a++) for (let d = 0; d < 3; d++) { const e = eq[3 * (b + OFF[a]) + d]; cellEq.push(e); if (e >= 0) { if (e < lo) lo = e; if (e > hi) hi = e; } }
    if (hi >= 0) band = Math.max(band, hi - lo);
    cells.push(c); cellK.push(bricks.get(key));
  }
  const ncells = cells.length, EQ = Int32Array.from(cellEq);
  const rhs = new Float64Array(neq); for (let d = 0; d < 3 * nnode; d++) if (eq[d] >= 0) rhs[eq[d]] = F[d];
  let fnorm = 0; for (let i = 0; i < neq; i++) fnorm += rhs[i] * rhs[i]; fnorm = Math.sqrt(fnorm);
  const x = new Float64Array(neq); let iters = 0, used = "none";
  if (fnorm > 0) {
    // Small or narrow problems go straight to the direct solver. Otherwise the iterative one gets the first go, for
    // about half the time the direct solve would take: chunky and open parts settle quickly, thin ones may not, and
    // those are handed to the direct solver if it fits in memory.
    const cost = neq * band * band, fits = neq * (band + 1) <= 1.5e7 && cost <= 2.5e10, hard = Math.min(20000, 4 * neq);
    const equiv = cost / (576 * ncells);                  // the direct solve costs about this many iterative steps
    const direct = () => { try { solveBanded(neq, band, ncells, cells, cellK, mat.E, EQ, rhs, x); used = "direct"; return true; } catch (e) { if (e instanceof RangeError) return false; throw e; } };
    if (solver === "direct" || (solver === "auto" && (cost < 6e8 || (fits && equiv < 1500)))) { if (!direct()) throw new TestError("too-big", "This part is too detailed to test on this device."); }
    else {
      used = "iterative";
      const first = solver === "auto" && fits ? Math.min(hard, Math.max(200, Math.round(0.5 * equiv))) : hard;
      let done = solvePCG(neq, ncells, cells, cellK, mat.E, EQ, rhs, x, first);
      iters = Math.abs(done);
      if (done < 0 && solver === "auto" && fits && direct()) iters = 0;
      else if (done < 0) {
        if (first < hard) { done = solvePCG(neq, ncells, cells, cellK, mat.E, EQ, rhs, x, hard - first); iters += Math.abs(done); }
        if (done < 0) warnings.push("The solver stopped before it fully settled. Treat the numbers as rough.");
      }
    }
  } else warnings.push("Nothing is pushing on the part. Add a weight, or it only carries itself.");

  // displacements, then stress at brick corners averaged onto nodes
  const u = new Float32Array(3 * nnode); for (let d = 0; d < 3 * nnode; d++) if (eq[d] >= 0) u[d] = x[eq[d]];
  const sig = new Float64Array(6 * nnode), wsum = new Float32Array(nnode), real = new Float32Array(nnode), ue = new Float64Array(24);
  for (let e = 0; e < ncells; e++) {
    const c = cells[e], i = c % nx, j = ((c - i) / nx) % ny, k = (c - i - nx * j) / (nx * ny), b = nodeOf(i, j, k), S = cellK[e].S;
    for (let p = 0; p < 24; p++) { const q = EQ[e * 24 + p]; ue[p] = q >= 0 ? x[q] : 0; }
    for (let a = 0; a < 8; a++) { const n = b + OFF[a], f = occ[8 * c + a] / 8 + 1e-3; wsum[n] += f; real[n] += occ[8 * c + a] / 8;
      for (let r = 0; r < 6; r++) { let s = 0; const o = a * 144 + r * 24; for (let p = 0; p < 24; p++) s += S[o + p] * ue[p]; sig[6 * n + r] += f * mat.E * s; } }
  }
  const vm = new Float32Array(nnode);
  let peak = 0, peakAt = -1, peakAll = 0, maxU = 0, maxUAt = -1;
  for (let n = 0; n < nnode; n++) {
    if (!active[n]) continue;
    const w = wsum[n] || 1, a = sig[6 * n] / w, b = sig[6 * n + 1] / w, c = sig[6 * n + 2] / w, d = sig[6 * n + 3] / w, e = sig[6 * n + 4] / w, f = sig[6 * n + 5] / w;
    const v = Math.sqrt(0.5 * ((a - b) * (a - b) + (b - c) * (b - c) + (c - a) * (c - a)) + 3 * (d * d + e * e + f * f));
    vm[n] = v; if (real[n] < minReal) continue;             // a grid point with too little material around it (a knife edge, a sliver) says nothing about the part
    if (v > peakAll) peakAll = v;
    if (!fixed[n] && !loaded[n] && v > peak) { peak = v; peakAt = n; }
    const m = Math.hypot(u[3 * n], u[3 * n + 1], u[3 * n + 2]); if (m > maxU) { maxU = m; maxUAt = n; }
  }
  if (peakAt < 0) { peak = peakAll; }
  // Grid points that sit outside the real surface (in a brick the part only clips) take the value of their solid
  // neighbours, so slivers and knife edges do not paint false hot spots.
  { const sum = new Float32Array(nnode), cnt = new Uint16Array(nnode);
    for (let e = 0; e < ncells; e++) {
      const c = cells[e], i = c % nx, j = ((c - i) / nx) % ny, k = (c - i - nx * j) / (nx * ny), b = nodeOf(i, j, k); let m = 0, q = 0;
      for (let a = 0; a < 8; a++) if (real[b + OFF[a]] >= minReal) { m += vm[b + OFF[a]]; q++; }
      if (q && q < 8) for (let a = 0; a < 8; a++) if (real[b + OFF[a]] < minReal) { sum[b + OFF[a]] += m / q; cnt[b + OFF[a]]++; }
    }
    for (let n = 0; n < nnode; n++) if (active[n] && real[n] < minReal) vm[n] = cnt[n] ? sum[n] / cnt[n] : Math.min(vm[n], peak); }
  if (!isFinite(peak) || !isFinite(maxU)) throw new TestError("unstable", "The part is not held firmly enough to test. Clamp more of it.");
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  if (maxU > 0.2 * Math.max(...size)) warnings.push("It bends a long way for its size. This quick test assumes small bending, so treat the numbers as rough.");
  if (partial > 0.02 * ncells) notes.push("Curved and tilted surfaces are stepped by the grid.");
  return { xs, ys, zs, nx, ny, nz, fill, active, fixed, loaded, u, vm, volume,
    peak, peakAt: peakAt >= 0 ? pos(peakAt) : null, peakAll, maxU, maxUAt: maxUAt >= 0 ? pos(maxUAt) : null,
    safety: peak > 0 ? mat.S / peak : Infinity, strength: mat.S, applied, weight, g, warnings, notes,
    stats: { cells: ncells, equations: neq, band, solver: used, iterations: iters, ms: Date.now() - t0, grid: [nx, ny, nz] } };
}

function solveBanded(n, b, ncells, cells, cellK, E, EQ, rhs, x) {
  const w = b + 1, A = new Float64Array(n * w);                 // row i holds columns i-b..i
  for (let e = 0; e < ncells; e++) {
    const Ke = cellK[e].Ke, f = E, o = e * 24;
    for (let p = 0; p < 24; p++) { const i = EQ[o + p]; if (i < 0) continue; const row = i * w + b - i;
      for (let q = 0; q < 24; q++) { const j = EQ[o + q]; if (j >= 0 && j <= i) A[row + j] += f * Ke[p * 24 + q]; } }
  }
  let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, A[i * w + b]);
  for (let i = 0; i < n; i++) {
    const ri = i * w + b - i, j0 = Math.max(0, i - b);
    for (let j = j0; j <= i; j++) {
      const rj = j * w + b - j, k0 = Math.max(j0, j - b); let s = A[ri + j];
      for (let k = k0; k < j; k++) s -= A[ri + k] * A[rj + k];
      if (j < i) A[ri + j] = s / A[rj + j];
      else { if (!(s > 1e-12 * scale)) throw new TestError("unstable", "The part is not held firmly enough to test. Clamp more of it."); A[ri + i] = Math.sqrt(s); }
    }
  }
  for (let i = 0; i < n; i++) { const ri = i * w + b - i; let s = rhs[i]; for (let k = Math.max(0, i - b); k < i; k++) s -= A[ri + k] * x[k]; x[i] = s / A[ri + i]; }
  for (let i = n - 1; i >= 0; i--) { const xi = x[i] / A[i * w + b]; x[i] = xi; const ri = i * w + b - i; for (let k = Math.max(0, i - b); k < i; k++) x[k] -= A[ri + k] * xi; }
}

/** Conjugate gradients from the current x. Returns the step count, negative if it stopped before settling. */
function solvePCG(n, ncells, cells, cellK, E, EQ, rhs, x, limit) {
  const diag = new Float64Array(n), ue = new Float64Array(24);
  for (let e = 0; e < ncells; e++) { const Ke = cellK[e].Ke; for (let p = 0; p < 24; p++) { const i = EQ[e * 24 + p]; if (i >= 0) diag[i] += E * Ke[p * 25]; } }
  const apply = (v, out) => {
    out.fill(0);
    for (let e = 0; e < ncells; e++) {
      const Ke = cellK[e].Ke, o = e * 24;
      for (let p = 0; p < 24; p++) { const i = EQ[o + p]; ue[p] = i >= 0 ? v[i] : 0; }
      for (let p = 0; p < 24; p++) { const i = EQ[o + p]; if (i < 0) continue; let s = 0; const r = p * 24; for (let q = 0; q < 24; q++) s += Ke[r + q] * ue[q]; out[i] += E * s; }
    }
  };
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  apply(x, Ap);
  let rz = 0, r0 = 0, rr = 0;
  for (let i = 0; i < n; i++) { r[i] = rhs[i] - Ap[i]; z[i] = r[i] / diag[i]; p[i] = z[i]; rz += r[i] * z[i]; rr += r[i] * r[i]; r0 += rhs[i] * rhs[i]; }
  if (rr <= 1e-16 * r0) return 0;
  for (let it = 1; it <= limit; it++) {
    apply(p, Ap); let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(pAp > 0)) throw new TestError("unstable", "The part is not held firmly enough to test. Clamp more of it.");
    const alpha = rz / pAp; rr = 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rr += r[i] * r[i]; }
    if (rr <= 1e-16 * r0) return it;
    let rzn = 0; for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rzn += r[i] * z[i]; }
    const beta = rzn / rz; rz = rzn; for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return -limit;
}

/** Look up stress and movement at any point of the part: returns (x, y, z, out) => out {vm, ux, uy, uz}. */
export function makeSampler(r) {
  const { xs, ys, zs, nx, ny, nz, fill, u, vm } = r, mx = nx + 1, my = ny + 1;
  const find = (a, v) => { let lo = 0, hi = a.length - 2; if (v <= a[0]) return 0; if (v >= a[a.length - 1]) return hi; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const c01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  return (x, y, z, out) => {
    let i = find(xs, x), j = find(ys, y), k = find(zs, z);
    if (!(fill[i + nx * (j + ny * k)] > 0)) {
      let best = Infinity, bi = -1, bj = 0, bk = 0;
      for (let rad = 1; rad <= 4 && bi < 0; rad++) for (let c = Math.max(0, k - rad); c <= Math.min(nz - 1, k + rad); c++) for (let b = Math.max(0, j - rad); b <= Math.min(ny - 1, j + rad); b++) for (let a = Math.max(0, i - rad); a <= Math.min(nx - 1, i + rad); a++) {
        if (!(fill[a + nx * (b + ny * c)] > 0)) continue;
        const dx = Math.max(xs[a] - x, 0, x - xs[a + 1]), dy = Math.max(ys[b] - y, 0, y - ys[b + 1]), dz = Math.max(zs[c] - z, 0, z - zs[c + 1]), d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; bi = a; bj = b; bk = c; }
      }
      if (bi < 0) { out.vm = 0; out.ux = out.uy = out.uz = 0; return out; }
      i = bi; j = bj; k = bk;
    }
    const tx = c01((x - xs[i]) / (xs[i + 1] - xs[i])), ty = c01((y - ys[j]) / (ys[j + 1] - ys[j])), tz = c01((z - zs[k]) / (zs[k + 1] - zs[k]));
    let v = 0, ux = 0, uy = 0, uz = 0;
    for (let a = 0; a < 8; a++) {
      const w = (C8[a][0] ? tx : 1 - tx) * (C8[a][1] ? ty : 1 - ty) * (C8[a][2] ? tz : 1 - tz), n = i + C8[a][0] + mx * (j + C8[a][1] + my * (k + C8[a][2]));
      v += w * vm[n]; ux += w * u[3 * n]; uy += w * u[3 * n + 1]; uz += w * u[3 * n + 2];
    }
    out.vm = v; out.ux = ux; out.uy = uy; out.uz = uz; return out;
  };
}
