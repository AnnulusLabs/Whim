// Whim Spatial Bench: the part tree and its geometry maths.
// Pure functions, no DOM and no three.js, so the same code runs on screen, in a worker and in tests.
// Units: metres and kilograms. Quaternions are [x, y, z, w]. Shapes are unit-sized and centred, then scaled by `size`.
//
// A node is one of:
//   prim   { shape: box|cyl|sph|cone|wedge, size:[x,y,z], hole, mat }
//   group  { children:[node...], s: uniform scale, hole, mat }   solid children are joined, hole children are cut out
//   clamp  { size }            holds the part still in a test
//   load   { size, kg }        pushes along its own -Y axis in a test
// every node also has id, kind, pos:[x,y,z] and quat.

export const SHAPES = ["box", "cyl", "sph", "cone", "wedge"];
export const SHAPE_NAMES = { box: "Box", cyl: "Cylinder", sph: "Sphere", cone: "Cone", wedge: "Wedge" };
const UNIT_VOLUME = { box: 1, cyl: Math.PI / 4, sph: Math.PI / 6, cone: Math.PI / 12, wedge: 0.5 };
const UNIT_COM = { box: [0, 0, 0], cyl: [0, 0, 0], sph: [0, 0, 0], cone: [0, -0.25, 0], wedge: [-1 / 6, -1 / 6, 0] };

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export function qRot(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const qNorm = (q) => { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };

export const isGeometry = (n) => n.kind === "prim" || n.kind === "group";
export const clone = (n) => JSON.parse(JSON.stringify(n));

// ---------- point membership ----------
export function shapeInside(shape, x, y, z) {
  switch (shape) {
    case "box": return Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 && Math.abs(z) <= 0.5;
    case "cyl": return Math.abs(y) <= 0.5 && x * x + z * z <= 0.25;
    case "sph": return x * x + y * y + z * z <= 0.25;
    case "cone": { const r = 0.5 * (0.5 - y); return Math.abs(y) <= 0.5 && x * x + z * z <= r * r; }
    case "wedge": return x >= -0.5 && y >= -0.5 && x + y <= 0 && Math.abs(z) <= 0.5;
  }
  return false;
}
/** Point in the node's parent frame -> the node's own rotated frame (real units). */
export const toLocal = (node, p) => qRot(qInv(node.quat), sub(p, node.pos));
export const toParent = (node, q) => add(node.pos, qRot(node.quat, q));

/** Is local point q inside the node? `grow` widens every primitive by that many metres per side. */
export function insideLocal(node, q, grow = 0) {
  if (node.kind === "group") {
    const g = [q[0] / node.s, q[1] / node.s, q[2] / node.s], gg = grow / node.s;
    let solid = false;
    for (const c of node.children) if (!c.hole && insideLocal(c, toLocal(c, g), gg)) { solid = true; break; }
    if (!solid) return false;
    if (grow > 0) return true;                       // grown test is for touching: holes are ignored
    for (const c of node.children) if (c.hole && insideLocal(c, toLocal(c, g))) return false;
    return true;
  }
  const s = node.size, e = 2 * grow;
  return shapeInside(node.kind === "prim" ? node.shape : "box", q[0] / (s[0] + e), q[1] / (s[1] + e), q[2] / (s[2] + e));
}
export const inside = (node, p, grow = 0) => insideLocal(node, toLocal(node, p), grow);

// ---------- extents ----------
/** Bounding box in the node's own rotated frame. Holes do not add extent. */
export function localBBox(node) {
  if (node.kind !== "group") return { min: mulS(node.size, -0.5), max: mulS(node.size, 0.5) };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of node.children) {
    if (c.hole) continue;
    const b = localBBox(c);
    for (let k = 0; k < 8; k++) {
      const p = toParent(c, [k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]]);
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a] * node.s); max[a] = Math.max(max[a], p[a] * node.s); }
    }
  }
  return { min, max };
}
/** Axis-aligned box in the parent frame. */
export function aabb(node) {
  const b = localBBox(node), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const p = toParent(node, [k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]]);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  }
  return { min, max };
}
export const extent = (node) => { const b = localBBox(node); return sub(b.max, b.min); };

// ---------- mass properties ----------
export const primVolume = (n) => UNIT_VOLUME[n.kind === "prim" ? n.shape : "box"] * n.size[0] * n.size[1] * n.size[2];
export const primCom = (n) => { const c = UNIT_COM[n.shape] || [0, 0, 0]; return [c[0] * n.size[0], c[1] * n.size[1], c[2] * n.size[2]]; };
/**
 * Volume and centre of mass by sampling. Used when the mesh kernel is not available, and to check it.
 * The sample grid lines up with the flat faces of the shapes inside, so parts built from square-on boxes come out
 * exact and only curved or tilted surfaces are approximated.
 */
export function estimateProps(node, n = 40) {
  const b = localBBox(node), planes = node.kind === "group" ? featurePlanes(node) : [[], [], []];
  const lines = [0, 1, 2].map((a) => {
    const lo = b.min[a], hi = b.max[a], eps = 1e-9 * Math.max(1e-9, hi - lo), step = (hi - lo) / n, out = [];
    const cuts = [lo, hi, ...planes[a].filter((v) => v > lo + eps && v < hi - eps)].sort((x, y) => x - y);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const w = cuts[i + 1] - cuts[i]; if (w <= eps) continue;
      const k = Math.max(1, Math.ceil(w / step - 1e-9)); for (let j = 0; j < k; j++) out.push([cuts[i] + (j + 0.5) * w / k, w / k]);
    }
    return out;
  });
  let volume = 0; const c = [0, 0, 0];
  for (const [x, wx] of lines[0]) for (const [y, wy] of lines[1]) for (const [z, wz] of lines[2]) {
    if (!insideLocal(node, [x, y, z])) continue;
    const w = wx * wy * wz; volume += w; c[0] += w * x; c[1] += w * y; c[2] += w * z;
  }
  return { volume, com: volume ? mulS(c, 1 / volume) : [0, 0, 0] };
}

// ---------- contact ----------
const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function obb(node) {
  const b = localBBox(node);
  return { c: toParent(node, mulS(add(b.min, b.max), 0.5)), h: mulS(sub(b.max, b.min), 0.5), q: node.quat };
}
function obbOverlap(A, B, tol) {
  const ax = AX.map((u) => qRot(A.q, u)), bx = AX.map((u) => qRot(B.q, u));
  const R = [[], [], []], AR = [[], [], []];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { R[i][j] = dot(ax[i], bx[j]); AR[i][j] = Math.abs(R[i][j]) + 1e-9; }
  const d = sub(B.c, A.c), t = [dot(d, ax[0]), dot(d, ax[1]), dot(d, ax[2])], a = A.h, b = B.h;
  for (let i = 0; i < 3; i++) if (Math.abs(t[i]) > a[i] + b[0] * AR[i][0] + b[1] * AR[i][1] + b[2] * AR[i][2] + tol) return false;
  for (let j = 0; j < 3; j++) if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > a[0] * AR[0][j] + a[1] * AR[1][j] + a[2] * AR[2][j] + b[j] + tol) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const ra = a[i1] * AR[i2][j] + a[i2] * AR[i1][j], rb = b[j1] * AR[i][j2] + b[j2] * AR[i][j1];
    if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb + tol) return false;
  }
  return true;
}
/** Do two nodes overlap or come within `tol` metres of each other? Box test first, then a point sample of the shared region. */
export function touching(a, b, tol = 5e-4, n = 12) {
  if (!obbOverlap(obb(a), obb(b), tol)) return false;
  const A = aabb(a), B = aabb(b), lo = [], hi = [];
  for (let k = 0; k < 3; k++) { lo[k] = Math.max(A.min[k], B.min[k]) - tol; hi[k] = Math.min(A.max[k], B.max[k]) + tol; if (hi[k] < lo[k]) return false; }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p = [lo[0] + (i + 0.5) * (hi[0] - lo[0]) / n, lo[1] + (j + 0.5) * (hi[1] - lo[1]) / n, lo[2] + (k + 0.5) * (hi[2] - lo[2]) / n];
    if (inside(a, p, tol) && inside(b, p, tol)) return true;
  }
  return false;
}
/** Everything that touches `start`, directly or through other parts. Returns the cluster as a list of nodes. */
export function touchingCluster(start, nodes, tol) {
  const pool = nodes.filter((n) => isGeometry(n) && n !== start), cluster = [start], queue = [start];
  while (queue.length) {
    const cur = queue.pop();
    for (let i = pool.length - 1; i >= 0; i--) if (touching(cur, pool[i], tol)) { cluster.push(pool[i]); queue.push(pool[i]); pool.splice(i, 1); }
  }
  return cluster;
}

// ---------- grouping ----------
/** Join nodes into one group. Children keep their place; the group's origin is the centre of the solids. */
export function makeGroup(id, members, mat) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of members) { if (m.hole) continue; const b = aabb(m); for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a]); max[a] = Math.max(max[a], b.max[a]); } }
  const pos = mulS(add(min, max), 0.5);
  return { id, kind: "group", hole: false, mat, s: 1, pos, quat: [0, 0, 0, 1],
    children: members.map((m) => ({ ...clone(m), pos: sub(m.pos, pos) })) };
}
/** The reverse: a group's children as free nodes in the group's parent frame. */
export function explodeGroup(g) {
  return g.children.map((c) => {
    const n = clone(c);
    n.pos = add(g.pos, qRot(g.quat, mulS(c.pos, g.s))); n.quat = qNorm(qMul(g.quat, c.quat));
    if (n.kind === "group") n.s *= g.s; else n.size = mulS(n.size, g.s);
    return n;
  });
}
export const countLeaves = (n) => (n.kind === "group" ? n.children.reduce((a, c) => a + countLeaves(c), 0) : 1);

// ---------- feature planes, for building analysis grids that line up with flat faces ----------
function isAxisAligned(q) {
  for (const u of AX) { const v = qRot(q, u); if (Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) < 0.99999) return false; }
  return true;
}
/**
 * Every shape inside a node, with its bounding box in the node's own frame.
 * adds: it contributes material (no hole flag on it, nor on any group between it and the node).
 * exact: it is a square-on box, so its bounding box is the shape itself.
 */
export function leafBoxes(root) {
  const out = [];
  const walk = (node, p, q, s, adds) => {                 // p,q,s map node-local -> root-local
    if (node.kind === "group") { for (const c of node.children) walk(c, add(p, qRot(q, mulS(c.pos, s * node.s))), qMul(q, c.quat), s * node.s, adds && !c.hole); return; }
    const h = [0, 0, 0];
    for (let a = 0; a < 3; a++) { const e = [0, 0, 0]; e[a] = 0.5 * s * node.size[a]; const v = qRot(q, e); for (let k = 0; k < 3; k++) h[k] += Math.abs(v[k]); }
    out.push({ min: sub(p, h), max: add(p, h), adds, exact: (node.kind !== "prim" || node.shape === "box") && isAxisAligned(q) });
  };
  if (root.kind === "group") for (const c of root.children) walk(c, mulS(c.pos, root.s), c.quat, root.s, !c.hole);
  else out.push({ min: mulS(root.size, -0.5), max: mulS(root.size, 0.5), adds: true, exact: root.kind !== "prim" || root.shape === "box" });
  return out;
}
/** Coordinates of flat faces of every axis-aligned leaf, in `root`'s local frame: {0:[x...], 1:[y...], 2:[z...]}. */
export function featurePlanes(root, extra = []) {
  const planes = [[], [], []];
  const walk = (node, p, q, s) => {                       // p,q,s map node-local -> root-local
    if (node.kind === "group") { for (const c of node.children) walk(c, add(p, qRot(q, mulS(c.pos, s * node.s))), qMul(q, c.quat), s * node.s); return; }
    if (!isAxisAligned(q)) return;
    const h = qRot(q, mulS(node.size, 0.5 * s)).map(Math.abs);
    for (let a = 0; a < 3; a++) planes[a].push(p[a] - h[a], p[a] + h[a]);
  };
  if (root.kind === "group") for (const c of root.children) walk(c, mulS(c.pos, root.s), c.quat, root.s);
  for (const e of extra) walk(e, toLocal(root, e.pos), qMul(qInv(root.quat), e.quat), 1);
  return planes;
}
