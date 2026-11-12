// Whim Spatial Bench: scene, parts, editing, stress test display, files.
// The model (S.nodes) is plain data in real metres. Everything drawn is derived from it.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import * as M from "./model.js";
import { MATERIALS, ENVS, SCALES, KG_STEPS, DEFAULT_SIZE, exampleNodes } from "./data.js";
import { initKernel, kernelReady, meshLocal } from "./kernel.js";
import { makeSampler } from "./fea.js";
import { write3MF, writeSTL, zipStore } from "./exporters.js";

export const VERSION = "0.2.0";
export const BENCH = { w: 1.2, d: 0.7, y: 0.75, z: -0.6 };
export const COLORS = { accent: 0x39d0d8, edge: 0x0d141a, hole: 0xff5d73, clamp: 0xff7a59, load: 0xffd166, pass: 0x5ad18a, warn: 0xffb454, fail: 0xff6b6b };
const STORE = "whim.spatial.v2";
export const EMBED = (() => { try { return self !== top; } catch (e) { return true; } })();   // inside a preview frame: no downloads, no headset
const SMALL = matchMedia("(pointer: coarse)").matches || /OculusBrowser|Quest|Android|iPhone|iPad/i.test(navigator.userAgent);

export const S = { nodes: [], nextId: 1, scale: 1, env: "earth", snap: true, active: null, axis: 0, test: null, busy: false, lastMat: 4 };
const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
export const emit = (ev, data) => { for (const fn of listeners[ev] || []) fn(data); };
export const toast = (text, ms = 4000) => emit("toast", { text, ms });
export const byId = (id) => S.nodes.find((n) => n.id === id) || null;
export const env = () => ENVS[S.env];

// ---------- three.js stage ----------
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
export const scene = new THREE.Scene();
export const BG = new THREE.Color(0x101820);
scene.background = BG;
export const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 40);
camera.position.set(0.62, 1.42, 0.42);
export const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, BENCH.y + 0.08, BENCH.z); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.62; orbit.minDistance = 0.15; orbit.maxDistance = 6; orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(1.2, 3, 2); scene.add(sun);
export const floor = new THREE.GridHelper(8, 16, 0x2b3a47, 0x1b2630); scene.add(floor);

export const benchRoot = new THREE.Group(); benchRoot.position.set(0, BENCH.y, BENCH.z); scene.add(benchRoot);
export const modelGroup = new THREE.Group(); benchRoot.add(modelGroup);
export const labelGroup = new THREE.Group(); benchRoot.add(labelGroup);
{
  const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w, 0.018, BENCH.d), new THREE.MeshStandardMaterial({ color: 0x1b2733, transparent: true, opacity: 0.86, roughness: 0.9 }));
  top.position.y = -0.0095; benchRoot.add(top);
  const fine = [], bold = [];
  for (let i = 0; i <= 12; i++) { const x = -BENCH.w / 2 + i * 0.1; (i % 5 === 1 ? bold : fine).push(x, 0, -BENCH.d / 2, x, 0, BENCH.d / 2); }
  for (let j = 0; j <= 7; j++) { const z = -BENCH.d / 2 + j * 0.1; (j === 0 || j === 7 ? bold : fine).push(-BENCH.w / 2, 0, z, BENCH.w / 2, 0, z); }
  const lines = (pts, color) => new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color }));
  benchRoot.add(lines(fine, 0x355066), lines(bold, 0x5f89a8));
}

// ---------- text sprites ----------
export function textSprite(pxW, pxH, worldW) {
  const canvas = document.createElement("canvas"); canvas.width = pxW; canvas.height = pxH;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(worldW, worldW * pxH / pxW, 1); s.renderOrder = 20; s.userData = { canvas, key: "" };
  return s;
}
/** Paint lines of text onto a sprite. lines: [{ text, size, color, weight }] or a string. */
export function paint(sprite, lines, { border = null, bg = "rgba(13,20,27,.88)", align = "center", pad = 22, tight = false } = {}) {
  if (typeof lines === "string") lines = [{ text: lines }];
  const key = JSON.stringify([lines, border, bg]); if (sprite.userData.key === key) return; sprite.userData.key = key;
  const c = sprite.userData.canvas, g = c.getContext("2d"), fontOf = (l) => `${l.weight || 600} ${l.size || 34}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  g.clearRect(0, 0, c.width, c.height);
  let plate = c.width - 6;                                           // a tight plate hugs the text, so neighbouring labels overlap less
  if (tight) { let w = 0; for (const l of lines) { g.font = fontOf(l); w = Math.max(w, g.measureText(l.text).width); } plate = Math.min(plate, w + 2 * pad); }
  g.fillStyle = bg; g.beginPath(); g.roundRect((c.width - plate) / 2, 3, plate, c.height - 6, 16); g.fill();
  if (border) { g.strokeStyle = border; g.lineWidth = 5; g.stroke(); }
  const total = lines.reduce((h, l) => h + (l.size || 34) * 1.3, 0); let y = (c.height - total) / 2;
  for (const l of lines) {
    const size = l.size || 34; g.font = fontOf(l); g.fillStyle = l.color || "#e8eef3";
    g.textAlign = align; g.textBaseline = "middle"; g.fillText(l.text, align === "center" ? c.width / 2 : pad, y + size * 0.65, c.width - 2 * pad); y += size * 1.3;
  }
  sprite.material.map.needsUpdate = true;
}
const caption = textSprite(512, 64, 0.26); caption.position.set(-BENCH.w / 2 + 0.14, 0.03, BENCH.d / 2 - 0.02); benchRoot.add(caption);

// ---------- formatting ----------
export const fmtMass = (kg) => (kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : kg >= 1 ? `${kg.toFixed(2)} kg` : kg >= 0.1 ? `${(kg * 1000).toFixed(0)} g` : `${+(kg * 1000).toFixed(1)} g`);
export const fmtForce = (N) => (N >= 1000 ? `${(N / 1000).toFixed(2)} kN` : `${+N.toPrecision(3)} N`);
export const fmtStress = (Pa) => (Pa >= 1e9 ? `${(Pa / 1e9).toFixed(2)} GPa` : Pa >= 1e6 ? `${+(Pa / 1e6).toPrecision(3)} MPa` : `${+(Pa / 1e3).toPrecision(3)} kPa`);
export const fmtLen = (m) => (m >= 1 ? `${m.toFixed(2)} m` : m >= 1e-3 ? `${+(m * 1000).toPrecision(3)} mm` : `${+(m * 1e6).toPrecision(2)} µm`);
export function dimsText(n, mark = -1) {
  const e = n.kind === "group" ? M.extent(n) : n.size, big = Math.max(...e) >= 1;
  const f = (v, hit) => { const t = big ? v.toFixed(2) : String(+(v * 1000).toFixed(1)); return hit ? `[${t}]` : t; };
  const round = n.kind === "prim" && (n.shape === "cyl" || n.shape === "cone"), ball = n.kind === "prim" && n.shape === "sph";
  const body = ball ? `⌀${f(e[0], mark >= 0)}` : round ? `⌀${f(e[0], mark === 0 || mark === 2)} × ${f(e[1], mark === 1)}` : `${f(e[0], mark === 0)} × ${f(e[1], mark === 1)} × ${f(e[2], mark === 2)}`;
  return `${body} ${big ? "m" : "mm"}`;
}
export function titleOf(n) {
  if (n.kind === "clamp") return "Clamp"; if (n.kind === "load") return "Weight";
  const base = n.kind === "group" ? `Fused part (${M.countLeaves(n)} shapes)` : M.SHAPE_NAMES[n.shape];
  return n.hole ? `${base}, hole` : base;
}

// ---------- geometry for drawing ----------
function wedgeGeometry() {
  const A = [-0.5, -0.5], B = [0.5, -0.5], C = [-0.5, 0.5], f = 0.5, b = -0.5, p = [];
  const tri = (...v) => { for (const q of v) p.push(...q); };
  tri([...A, f], [...B, f], [...C, f]); tri([...A, b], [...C, b], [...B, b]);
  tri([...A, b], [...B, b], [...B, f]); tri([...A, b], [...B, f], [...A, f]);
  tri([...A, b], [...A, f], [...C, f]); tri([...A, b], [...C, f], [...C, b]);
  tri([...B, b], [...C, b], [...C, f]); tri([...B, b], [...C, f], [...B, f]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
}
const UNIT = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 48), sph: new THREE.SphereGeometry(0.5, 40, 24), cone: new THREE.ConeGeometry(0.5, 1, 48), wedge: wedgeGeometry() };
const UNIT_EDGES = Object.fromEntries(Object.entries(UNIT).map(([k, g]) => [k, new THREE.EdgesGeometry(g, 30)]));
export const unitGeometry = (shape) => UNIT[shape] || UNIT.box;

// ---------- fused shapes ----------
// With the mesh kernel a fused part is an exact watertight solid. Without it (WebAssembly blocked, say) the part is
// still drawn and tested: the shapes' own surfaces are cut into small triangles and only those lying on the outside
// of the result are kept. That skin is fine for looking and for showing stress, but not for export.
let kernelState = "loading";                                        // "loading" | "ready" | "failed"
const groupCache = new Map(), estimateCache = new Map(), SOUP = {};
const soupOf = (shape) => (SOUP[shape] ||= UNIT[shape].index ? UNIT[shape].toNonIndexed() : UNIT[shape]);
/** Every surface triangle of every shape in a part, in the part's own frame: 9 position numbers then 9 normal numbers each. */
function leafSoup(part) {
  const tris = [], nm = new THREE.Matrix3(), a = new THREE.Vector3(), I3 = new THREE.Vector3(1, 1, 1);
  const emit = (shape, mat) => {
    const g = soupOf(shape), P = g.getAttribute("position").array, N = g.getAttribute("normal").array; nm.getNormalMatrix(mat);
    for (let i = 0; i < P.length; i += 9) {
      const t = new Array(18);
      for (let c = 0; c < 3; c++) {
        a.set(P[i + 3 * c], P[i + 3 * c + 1], P[i + 3 * c + 2]).applyMatrix4(mat); t[3 * c] = a.x; t[3 * c + 1] = a.y; t[3 * c + 2] = a.z;
        a.set(N[i + 3 * c], N[i + 3 * c + 1], N[i + 3 * c + 2]).applyMatrix3(nm).normalize(); t[9 + 3 * c] = a.x; t[10 + 3 * c] = a.y; t[11 + 3 * c] = a.z;
      }
      tris.push(t);
    }
  };
  const walk = (node, toRoot) => {
    for (const c of node.children) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...c.pos), new THREE.Quaternion(...c.quat), I3).premultiply(new THREE.Matrix4().makeScale(node.s, node.s, node.s)).premultiply(toRoot);
      if (c.kind === "group") walk(c, m); else emit(c.shape, m.multiply(new THREE.Matrix4().makeScale(...c.size)));
    }
  };
  if (part.kind === "group") walk(part, new THREE.Matrix4()); else emit(part.kind === "prim" ? part.shape : "box", new THREE.Matrix4().makeScale(...part.size));
  return tris;
}
/** Split triangles at their longest edge until none is longer than `target`, or `cap` triangles is reached. Neighbours split alike, so no cracks. */
function subdivide(tris, target, cap) {
  const t2 = target * target, stack = tris.slice(), done = [];
  while (stack.length) {
    const t = stack.pop(); let worst = 0, e = -1;
    for (let a = 0; a < 3; a++) { const b = (a + 1) % 3, d = (t[3 * a] - t[3 * b]) ** 2 + (t[3 * a + 1] - t[3 * b + 1]) ** 2 + (t[3 * a + 2] - t[3 * b + 2]) ** 2; if (d > worst) { worst = d; e = a; } }
    if (worst <= t2 || done.length + stack.length >= cap) { done.push(t); continue; }
    const a = e, b = (e + 1) % 3, c = (e + 2) % 3, mid = [], mn = [];
    for (let q = 0; q < 3; q++) { mid.push(0.5 * (t[3 * a + q] + t[3 * b + q])); mn.push(t[9 + 3 * a + q] + t[9 + 3 * b + q]); }
    const L = Math.hypot(mn[0], mn[1], mn[2]) || 1, pt = (i) => [t[3 * i], t[3 * i + 1], t[3 * i + 2]], nr = (i) => [t[9 + 3 * i], t[10 + 3 * i], t[11 + 3 * i]], m3 = mn.map((x) => x / L);
    stack.push([...pt(a), ...mid, ...pt(c), ...nr(a), ...m3, ...nr(c)], [...mid, ...pt(b), ...pt(c), ...m3, ...nr(b), ...nr(c)]);
  }
  return done;
}
/** Keep the triangles with the part on one side and open space on the other. Walls of holes are turned to face the open side. */
function outerSkin(part, tris, eps) {
  const out = [];
  for (const t of tris) {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], wx = t[6] - t[0], wy = t[7] - t[1], wz = t[8] - t[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz); if (!(L > 0)) continue;
    nx *= eps / L; ny *= eps / L; nz *= eps / L;
    const cx = (t[0] + t[3] + t[6]) / 3, cy = (t[1] + t[4] + t[7]) / 3, cz = (t[2] + t[5] + t[8]) / 3;
    const front = M.insideLocal(part, [cx + nx, cy + ny, cz + nz]), back = M.insideLocal(part, [cx - nx, cy - ny, cz - nz]);
    if (front === back) continue;                                   // buried inside the part, or in open space
    if (front) { for (const o of [0, 9]) for (let q = 0; q < 3; q++) { const tmp = t[o + 3 + q]; t[o + 3 + q] = t[o + 6 + q]; t[o + 6 + q] = tmp; } for (let q = 9; q < 18; q++) t[q] = -t[q]; }
    out.push(t);
  }
  return out;
}
function soupGeometry(tris) {
  const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => { for (let q = 0; q < 9; q++) { pos[9 * i + q] = t[q]; nor[9 * i + q] = t[9 + q]; } });
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); return g;
}
function exactGroup(n) {
  const m = meshLocal(n);
  let geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3)); geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo = toCreasedNormals(geo, 0.5);
  return { geometry: geo, edges: new THREE.EdgesGeometry(geo, 28), volume: m.volume, com: m.com, pieces: m.pieces, raw: m, rough: false };
}
function roughGroup(n) {
  const unit = { ...n, s: 1 }, size = Math.max(...M.extent(unit)), est = M.estimateProps(unit, 36);
  const skin = outerSkin(unit, subdivide(leafSoup(unit), size / 44, SMALL ? 14000 : 30000), Math.max(1e-7, 2e-4 * size));
  return { geometry: soupGeometry(skin), edges: null, volume: est.volume, com: est.com, pieces: 1, raw: null, rough: true };
}
/** The drawable form of a fused part at scale 1, made once per set of shapes. Null while the kernel is still loading. */
function groupMesh(n) {
  if (kernelState === "loading") return null;
  const key = JSON.stringify(n.children), hit = groupCache.get(key);
  if (hit !== undefined && !(hit && hit.rough && kernelState === "ready")) return hit;
  let made = null;
  try { made = kernelState === "ready" ? exactGroup(n) : roughGroup(n); }
  catch (e) { console.warn("fuse failed, drawing it approximately", e); try { made = roughGroup(n); } catch (e2) { console.warn(e2); } }
  groupCache.set(key, made); return made;
}
export function volumeOf(n) {
  if (n.kind === "prim") return M.primVolume(n);
  if (n.kind !== "group") return 0;
  const g = groupMesh(n); if (g) return g.volume * n.s ** 3;
  const key = JSON.stringify(n.children); if (!estimateCache.has(key)) estimateCache.set(key, M.estimateProps({ ...n, s: 1 }, 36).volume);
  return estimateCache.get(key) * n.s ** 3;
}
export const massOf = (n) => (M.isGeometry(n) && !n.hole ? volumeOf(n) * MATERIALS[n.mat].rho : 0);

function bodyMaterial(n, matIndex = n.mat) {
  if (n.kind === "clamp") return new THREE.MeshStandardMaterial({ color: COLORS.clamp, transparent: true, opacity: 0.5, roughness: 0.8, depthWrite: false });
  if (n.kind === "load") return new THREE.MeshStandardMaterial({ color: COLORS.load, roughness: 0.55 });
  if (n.hole) return new THREE.MeshStandardMaterial({ color: COLORS.hole, transparent: true, opacity: 0.3, roughness: 0.9, depthWrite: false });
  const m = MATERIALS[matIndex];
  return new THREE.MeshStandardMaterial({ color: m.color, roughness: m.metal ? 0.42 : 0.78, metalness: m.metal ? 0.25 : 0 });
}

// ---------- visuals: one per top-level node ----------
export const visuals = new Map();
function assembly(n, top, picks) {
  const grp = new THREE.Group();
  for (const c of n.children) {
    let o;
    if (c.kind === "group") { o = assembly(c, top, picks); o.scale.setScalar(c.s); }
    else { o = new THREE.Mesh(UNIT[c.shape], bodyMaterial(c.hole || top.hole ? { ...c, hole: true } : c, top.mat)); o.scale.fromArray(c.size); picks.push(o); }
    o.position.fromArray(c.pos); o.quaternion.fromArray(c.quat); grp.add(o);
  }
  return grp;
}
/** Free what a drawing holds on the graphics card. Shape geometry is shared between drawings, so only materials go unless asked. */
function shed(obj, geometry = false) { if (obj) obj.traverse((o) => { if (o.material) o.material.dispose(); if (geometry && o.geometry) o.geometry.dispose(); }); }
function buildVisual(v) {
  const n = v.node;
  if (v.body) { shed(v.body); v.root.remove(v.body); }
  if (v.arrow) { shed(v.arrow, true); v.root.remove(v.arrow); v.arrow = null; }
  v.pick = []; v.edges = null;
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edge });
  if (n.kind === "group") {
    const g = groupMesh(n);
    if (g) { v.body = new THREE.Mesh(g.geometry, bodyMaterial(n)); if (g.edges) { v.edges = new THREE.LineSegments(g.edges, edgeMat); v.body.add(v.edges); } v.pick = [v.body]; }
    else v.body = assembly(n, n, v.pick);
  } else {
    const shape = n.kind === "prim" ? n.shape : "box";
    v.body = new THREE.Mesh(UNIT[shape], bodyMaterial(n)); v.edges = new THREE.LineSegments(UNIT_EDGES[shape], edgeMat); v.body.add(v.edges); v.pick = [v.body];
    if (n.kind === "load") {
      v.arrow = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.load });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), mat), head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 16), mat);
      head.rotation.x = Math.PI; v.arrow.add(shaft, head); v.arrow.userData = { shaft, head }; v.root.add(v.arrow);
    }
  }
  for (const m of v.pick) m.userData.id = n.id;
  v.root.add(v.body); pickCache = null;
  syncVisual(v);
}
/** Cheap refresh after a size, colour or text change. Position is left alone while a hand is holding the part. */
export function syncVisual(v) {
  const n = v.node;
  if (!v.held) { v.root.position.fromArray(n.pos); v.root.quaternion.fromArray(n.quat); v.root.scale.set(1, 1, 1); }
  if (n.kind === "group") v.body.scale.setScalar(n.s); else v.body.scale.fromArray(n.size);
  if (v.arrow) {
    // the arrow stands on the weight and points the way it pushes: along the weight's own down
    const w = Math.max(0.0025 * S.scale, Math.min(n.size[0], n.size[2]) * 0.2), tip = w * 3, len = Math.max(0.5 * n.size[1], 0.014 * S.scale), { shaft, head } = v.arrow.userData;
    head.scale.set(w * 2.6, tip, w * 2.6); head.position.y = n.size[1] / 2 + tip / 2; shaft.scale.set(w, len, w); shaft.position.y = n.size[1] / 2 + tip + len / 2;
    v.arrowTop = tip + len;
  }
  const ext = M.extent(n); v.rad = 0.5 * Math.hypot(ext[0], ext[1], ext[2]) + (v.arrow ? v.arrowTop : 0);
  v.top = v.held ? v.rad : M.aabb(n).max[1] - n.pos[1] + (v.arrow ? v.arrowTop * Math.max(0, M.qRot(n.quat, [0, 1, 0])[1]) : 0);
  const active = n.id === S.active;
  if (v.edges) v.edges.material.color.setHex(active ? COLORS.accent : n.hole ? COLORS.hole : COLORS.edge);
  for (const m of v.pick) if (m.material.emissive) m.material.emissive.setHex(active && !n.hole && n.kind !== "clamp" ? 0x0b2a30 : 0x000000);
  paint(v.label, labelText(n), { border: active ? "#39d0d8" : null, tight: true });
}
function labelText(n) {
  const mark = n.id === S.active && n.kind !== "group" && renderer.xr.isPresenting ? S.axis : -1;      // in the headset, brackets show which side the - and + buttons change
  if (n.kind === "clamp") return `Clamp · ${dimsText(n, mark)}`;
  if (n.kind === "load") return `${+n.kg} kg · ${fmtForce(n.kg * env().g)}`;
  if (n.hole) return `Hole · ${dimsText(n, mark)}`;
  return `${dimsText(n, mark)} · ${fmtMass(massOf(n))}`;
}
function makeVisual(n) {
  const v = { node: n, root: new THREE.Group(), body: null, edges: null, arrow: null, pick: [], held: false, hot: false, rad: 0, top: 0, label: textSprite(640, 84, 0.2) };
  labelGroup.add(v.label); modelGroup.add(v.root); visuals.set(n.id, v); buildVisual(v); return v;
}
function killVisual(v) { shed(v.body); shed(v.arrow, true); modelGroup.remove(v.root); labelGroup.remove(v.label); v.label.material.map.dispose(); v.label.material.dispose(); visuals.delete(v.node.id); pickCache = null; }
let pickCache = null;
export const pickMeshes = () => (pickCache ||= [...visuals.values()].flatMap((v) => v.pick));
export const refreshAll = () => { for (const v of visuals.values()) syncVisual(v); };

// ---------- model edits ----------
function addNode(n) { S.nodes.push(n); return makeVisual(n); }
function dropNode(n) { const v = visuals.get(n.id); if (v) killVisual(v); S.nodes.splice(S.nodes.indexOf(n), 1); if (S.active === n.id) S.active = null; }
export function setActive(id) {
  if (S.active === id) return; S.active = id; const n = byId(id);
  if (n && n.kind === "group") S.axis = 0;
  refreshAll(); emit("active", id);
}

const hist = []; let hp = -1, lastKey = "";
const snapshot = () => JSON.stringify({ nodes: S.nodes, nextId: S.nextId, scale: S.scale, env: S.env, active: S.active });
const stateKey = () => JSON.stringify([S.nodes, S.scale, S.env]);
function pushHistory() { hist.length = hp + 1; hist.push(snapshot()); if (hist.length > 120) hist.shift(); hp = hist.length - 1; lastKey = stateKey(); }
/** Record the bench as it is now: one undo step (none if nothing changed), saved on this device, any test result cleared. */
export function commit() { clearTest(); if (stateKey() !== lastKey) pushHistory(); pruneCache(); save(); emit("change"); }
/** Fused shapes are kept ready-made by what they are built from. Drop the ones nothing on the bench uses any more. */
function pruneCache() {
  if (groupCache.size <= 16 && estimateCache.size <= 64) return;
  const live = new Set(S.nodes.filter((n) => n.kind === "group").map((n) => JSON.stringify(n.children)));
  for (const [key, g] of groupCache) if (!live.has(key)) { if (g) { g.geometry.dispose(); if (g.edges) g.edges.dispose(); } groupCache.delete(key); }
  for (const key of estimateCache.keys()) if (!live.has(key)) estimateCache.delete(key);
}
function restore(json, keepHistory = true) {
  const d = JSON.parse(json);
  clearTest(); for (const v of [...visuals.values()]) killVisual(v);
  S.nodes = []; S.nextId = d.nextId; S.scale = SCALES.includes(d.scale) ? d.scale : 1; S.env = ENVS[d.env] ? d.env : "earth"; S.active = null; applyScale();
  for (const n of d.nodes) addNode(n);
  S.active = byId(d.active) ? d.active : null; refreshAll(); lastKey = stateKey();
  if (!keepHistory) { hist.length = 0; hp = -1; pushHistory(); }
  save(); emit("change"); emit("active", S.active);
}
export const undo = () => { if (hp > 0) restore(hist[--hp]); else toast("Nothing to undo"); };
export const redo = () => { if (hp < hist.length - 1) restore(hist[++hp]); else toast("Nothing to redo"); };
export const canUndo = () => hp > 0, canRedo = () => hp < hist.length - 1;

function save() { try { localStorage.setItem(STORE, JSON.stringify({ v: 2, nodes: S.nodes, nextId: S.nextId, scale: S.scale, env: S.env, snap: S.snap, lastMat: S.lastMat })); } catch (e) { /* storage may be unavailable */ } }
function applyScale() { modelGroup.scale.setScalar(1 / S.scale); paint(caption, [{ text: `1 square = ${fmtLen(0.1 * S.scale)}   scale 1:${S.scale}`, size: 26, color: "#93a4b3" }], { bg: "rgba(13,20,27,.6)", tight: true }); }

const tq = new THREE.Quaternion(), te = new THREE.Euler();
function normSize(n, axis) {
  if (n.kind !== "prim") return;
  if (n.shape === "sph") { const v = n.size[axis]; n.size = [v, v, v]; }
  else if (n.shape === "cyl" || n.shape === "cone") { if (axis === 2) n.size[0] = n.size[2]; else n.size[2] = n.size[0]; }
}
/** Tidy a part after it is let go: square it up, round its size, pull it flush to its neighbours, keep it on the bench. */
export function snapNode(n) {
  const s = S.scale;
  if (S.snap) {
    n.quat = squareUp(n.quat);
    const g = 0.001 * s;
    if (n.kind !== "group") n.size = n.size.map((v) => Math.max(g, Math.round(v / g) * g));
    const A = M.aabb(n), others = S.nodes.filter((o) => o !== n).map(M.aabb), reach = 0.004 * s, lap = 0.006 * s;
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3; let best = null;
      const consider = (d) => { if (Math.abs(d) <= reach && (best === null || Math.abs(d) < Math.abs(best))) best = d; };
      if (a === 1) consider(-A.min[1]);
      for (const B of others) {
        if (A.min[b] > B.max[b] + lap || A.max[b] < B.min[b] - lap || A.min[c] > B.max[c] + lap || A.max[c] < B.min[c] - lap) continue;
        consider(B.max[a] - A.min[a]); consider(B.min[a] - A.max[a]); consider(B.min[a] - A.min[a]); consider(B.max[a] - A.max[a]);
      }
      const d = best !== null ? best : Math.round(A.min[a] / g) * g - A.min[a];
      n.pos[a] += d; A.min[a] += d; A.max[a] += d;
    }
  }
  const low = M.aabb(n).min[1]; if (low < 0) n.pos[1] -= low;
}
/** Read a part's place back from where its drawing ended up (after a hand let go of it), tidy it, and record the change. */
export function placed(id) {
  const n = byId(id), v = visuals.get(id); if (!n || !v) return;
  n.pos = v.root.position.toArray(); n.quat = M.qNorm(v.root.quaternion.toArray());
  snapNode(n); syncVisual(v); commit();
}
/** A clear patch of bench for a new shape: front row first, working back. */
function freeSpot(size) {
  const s = S.scale, boxes = S.nodes.map(M.aabb), gap = 0.008 * s;
  for (let k = 0; k < 40; k++) {
    const x = ((k % 8) - 3.5) * 0.13 * s, z = (0.2 - Math.floor(k / 8) * 0.12) * s;
    const clear = boxes.every((b) => x + size[0] / 2 + gap < b.min[0] || x - size[0] / 2 - gap > b.max[0] || z + size[2] / 2 + gap < b.min[2] || z - size[2] / 2 - gap > b.max[2] || b.min[1] > size[1] + gap);
    if (clear) return [x, size[1] / 2, z];
  }
  return [0, size[1] / 2 + Math.max(0, ...boxes.map((b) => b.max[1])), 0];
}
const reId = (n) => { n.id = S.nextId++; if (n.kind === "group") n.children.forEach(reId); return n; };

export function spawn(kind, at = null, { hold = false } = {}) {
  const s = S.scale, size = DEFAULT_SIZE[kind].map((v) => v * s);
  const base = { id: S.nextId++, size, quat: [0, 0, 0, 1], pos: at ? [...at] : freeSpot(size) };
  const n = kind === "clamp" ? { ...base, kind: "clamp" } : kind === "load" ? { ...base, kind: "load", kg: 5 } : { ...base, kind: "prim", shape: kind, hole: false, mat: S.lastMat };
  addNode(n); setActive(n.id);
  if (!hold) { snapNode(n); syncVisual(visuals.get(n.id)); commit(); }
  return n;
}
export function remove(id = S.active) { const n = byId(id); if (!n) return; dropNode(n); commit(); emit("active", S.active); }
export function duplicate(id = S.active) {
  const n = byId(id); if (!n) return toast("Pick something to copy first.");
  const c = reId(M.clone(n)), b = M.aabb(n); c.pos[0] += b.max[0] - b.min[0] + 0.01 * S.scale;
  addNode(c); snapNode(c); syncVisual(visuals.get(c.id)); setActive(c.id); commit(); return c;
}
export function toggleHole(id = S.active) {
  const n = byId(id); if (!n || !M.isGeometry(n)) return toast("Pick a shape first. Clamps and weights cannot be holes.");
  n.hole = !n.hole; buildVisual(visuals.get(id)); commit(); emit("active", S.active);
  toast(n.hole ? "This shape is now a hole. Push it into a solid shape, then Fuse to cut." : "This shape is solid again.");
}
export function setMaterial(i, id = S.active) {
  const n = byId(id); if (!n || !M.isGeometry(n)) return toast("Pick a shape first.");
  n.mat = S.lastMat = ((i % MATERIALS.length) + MATERIALS.length) % MATERIALS.length; buildVisual(visuals.get(id)); commit(); emit("active", S.active);
}
export const cycleMaterial = (dir = 1) => { const n = byId(S.active); if (n && M.isGeometry(n)) setMaterial(n.mat + dir); else toast("Pick a shape first."); };
export function fuse(id = S.active) {
  const start = byId(id); if (!start || !M.isGeometry(start)) return toast("Pick a shape first, then Fuse joins it to everything it touches.");
  const cluster = M.touchingCluster(start, S.nodes, 0.0006 * S.scale);
  if (cluster.length < 2) return toast("Nothing is touching this shape. Move shapes together, then Fuse.");
  const solids = cluster.filter((n) => !n.hole); if (!solids.length) return toast("A hole needs a solid shape to cut. Push it into one, then Fuse.");
  const members = S.nodes.filter((n) => cluster.includes(n)), g = M.makeGroup(S.nextId++, members, (start.hole ? solids[0] : start).mat);
  { const gm = groupMesh(g); if (gm && !(gm.volume > 1e-18)) return toast("Those holes would remove the whole shape."); }
  for (const n of members) dropNode(n);
  addNode(g); setActive(g.id); commit(); toast(`Fused ${members.length} shapes into one part.`); return g;
}
export function breakApart(id = S.active) {
  const g = byId(id); if (!g || g.kind !== "group") return toast("Only a fused part can be broken apart.");
  const kids = M.explodeGroup(g).map(reId); dropNode(g); for (const k of kids) addNode(k);
  setActive(kids[0].id); commit(); toast(`Broke the part back into ${kids.length} shapes.`);
}
/** Apply typed-in values. patch may hold size, pos, quat, kg, s. */
export function edit(id, patch, { final = true, axis = -1 } = {}) {
  const n = byId(id), v = visuals.get(id); if (!n) return;
  Object.assign(n, patch); if (axis >= 0) normSize(n, axis);
  const low = M.aabb(n).min[1]; if (low < 0) n.pos[1] -= low;
  syncVisual(v); if (final) commit(); else { clearTest(); emit("live"); }
}
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
/** Turn the selected thing about a bench axis (0 tip, 1 spin, 2 roll) through its own centre. */
export function turn(axis, deg) {
  const n = byId(S.active); if (!n) return toast("Pick something to turn first.");
  const q = new THREE.Quaternion().setFromAxisAngle(AXES[axis], THREE.MathUtils.degToRad(deg)).multiply(tq.fromArray(n.quat));
  edit(n.id, { quat: M.qNorm(q.toArray()) });
}
export function layFlat() { const n = byId(S.active); if (!n) return toast("Pick something first."); edit(n.id, { quat: [0, 0, 0, 1] }); }
export function dropToBench() { const n = byId(S.active); if (!n) return toast("Pick something first."); edit(n.id, { pos: [n.pos[0], n.pos[1] - M.aabb(n).min[1], n.pos[2]] }); }
/** The nearest square-on rotation: every angle a multiple of 15 degrees. */
export function squareUp(quat) {
  te.setFromQuaternion(tq.fromArray(quat), "YXZ"); const st = Math.PI / 12, r = (a) => Math.round(a / st) * st;
  return tq.setFromEuler(te.set(r(te.x), r(te.y), r(te.z), "YXZ")).toArray();
}
export function cycleAxis() { S.axis = (S.axis + 1) % 3; refreshAll(); emit("active", S.active); }
/** Step the selected dimension by one millimetre (at 1:1), or a weight to its next size. */
export function nudge(dir) {
  const n = byId(S.active); if (!n) return toast("Pick something first.");
  if (n.kind === "load") { let i = KG_STEPS.findIndex((k) => k >= n.kg - 1e-9); if (i < 0) i = KG_STEPS.length - 1; n.kg = KG_STEPS[Math.max(0, Math.min(KG_STEPS.length - 1, i + dir))]; }
  else if (n.kind === "group") { const e = M.extent(n)[S.axis], step = 0.001 * S.scale; if (e + dir * step <= step) return; n.s *= (e + dir * step) / e; }
  else { const step = 0.001 * S.scale; n.size[S.axis] = Math.max(step, Math.round((n.size[S.axis] + dir * step) / step) * step); normSize(n, S.axis); }
  const low = M.aabb(n).min[1]; if (low < 0) n.pos[1] -= low;
  syncVisual(visuals.get(n.id)); commit();
}
export function setScale(s) { S.scale = s; applyScale(); refreshAll(); commit(); }
export function setEnv(e) { S.env = e; refreshAll(); commit(); }
export function setSnap(on) { S.snap = on; save(); emit("change"); }
export function clearBench() { for (const n of [...S.nodes]) dropNode(n); commit(); emit("active", null); }
export function loadExample() { restore(JSON.stringify({ ...exampleNodes(), scale: 1, env: S.env }), true); pushHistory(); fitView(); }

// ---------- stress test ----------
let resultObj = null; const phase = { value: 0 };
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RAMP = [[0.17, 0.25, 0.75], [0.12, 0.72, 0.79], [0.22, 0.76, 0.45], [0.95, 0.83, 0.24], [0.9, 0.28, 0.3]].map((c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));
export const RAMP_CSS = ["#2b40bf", "#1fb8c9", "#38c273", "#f2d43d", "#e6474d"];
function ramp(t, out) { t = Math.min(1, Math.max(0, t)) * 4; const i = Math.min(3, Math.floor(t)); return out.copy(RAMP[i]).lerp(RAMP[i + 1], t - i); }

export function clearTest() {
  if (resultObj) { const v = visuals.get(resultObj.id); resultObj.group.removeFromParent(); resultObj.mesh.geometry.dispose(); resultObj.mesh.material.dispose(); if (v) v.body.visible = true; resultObj = null; }
  if (S.test) { S.test = null; emit("test", null); }
}
function testTarget() {
  const solids = S.nodes.filter((n) => M.isGeometry(n) && !n.hole), a = byId(S.active);
  if (a && solids.includes(a)) return a;
  if (solids.length === 1) return solids[0];
  const clamps = S.nodes.filter((n) => n.kind === "clamp"), held = solids.filter((p) => clamps.some((c) => M.touching(p, c, 0.0006 * S.scale)));
  return held.length === 1 ? held[0] : null;
}
function feaRun(payload) {
  return new Promise((resolve, reject) => {
    const direct = () => import("./fea.js").then((m) => { try { resolve(m.runTest(payload)); } catch (e) { reject(e); } }, reject);
    let w; try { w = new Worker(new URL("./fea-worker.js", import.meta.url), { type: "module" }); } catch (e) { return direct(); }
    let settled = false;
    w.onmessage = (ev) => { settled = true; w.terminate(); if (ev.data.ok) resolve(ev.data.r); else reject(Object.assign(new Error(ev.data.error), { code: ev.data.code })); };
    w.onerror = (ev) => { ev.preventDefault?.(); if (!settled) { w.terminate(); direct(); } };
    w.postMessage(payload);
  });
}
export async function runTest() {
  if (S.busy) return;
  const part = testTarget();
  if (!part) return toast(S.nodes.some((n) => M.isGeometry(n) && !n.hole) ? "Pick the part you want to test first." : "Add a shape to test first.");
  const m = MATERIALS[part.mat];
  clearTest(); S.busy = true; emit("busy", true);
  const asked = stateKey();
  try {
    const r = await feaRun({ part: M.clone(part), clamps: S.nodes.filter((n) => n.kind === "clamp").map(M.clone), loads: S.nodes.filter((n) => n.kind === "load").map(M.clone),
      mat: { E: m.E, nu: m.nu, rho: m.rho, S: m.S }, g: env().g, budget: SMALL || renderer.xr.isPresenting ? 2500 : 5000 });
    if (stateKey() !== asked || !byId(part.id)) toast("The bench changed while the test ran. Press Test again.");
    else showResult(byId(part.id), r);
  } catch (e) { if (!e.code) console.error(e); toast(e.code ? e.message : "The test could not run: " + e.message, 7000); }
  finally { S.busy = false; emit("busy", false); }
}
function showResult(part, r) {
  const v = visuals.get(part.id), g = part.kind === "group" ? groupMesh(part) : null;
  let src = part.kind === "group" ? (g ? g.geometry.clone().scale(part.s, part.s, part.s) : null) : UNIT[part.shape].clone().scale(part.size[0], part.size[1], part.size[2]);
  const size = M.extent(part), maxDim = Math.max(...size), k = r.maxU > 0 ? Math.max(1, 0.07 * maxDim / r.maxU) : 0;
  const group = new THREE.Group(); let mesh = null;
  if (src) {
    if (src.index) src = src.toNonIndexed();
    const P = src.getAttribute("position").array, N = src.getAttribute("normal").array, cap = SMALL ? 14000 : 36000;
    const cell = (a) => { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, a[i] - a[i - 1]); return m; };
    const target = Math.max(maxDim / 70, 0.6 * Math.min(cell(r.xs), cell(r.ys), cell(r.zs)));
    const tris = []; for (let i = 0; i < P.length; i += 9) tris.push([P[i], P[i + 1], P[i + 2], P[i + 3], P[i + 4], P[i + 5], P[i + 6], P[i + 7], P[i + 8], N[i], N[i + 1], N[i + 2], N[i + 3], N[i + 4], N[i + 5], N[i + 6], N[i + 7], N[i + 8]]);
    const done = subdivide(tris, target, cap);
    const nv = done.length * 3, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), disp = new Float32Array(nv * 3);
    const sample = makeSampler(r), out = {}, color = new THREE.Color(), top = r.peak || r.peakAll || 1;
    done.forEach((t, ti) => { for (let c = 0; c < 3; c++) { const o = (ti * 3 + c) * 3; pos[o] = t[3 * c]; pos[o + 1] = t[3 * c + 1]; pos[o + 2] = t[3 * c + 2]; nor[o] = t[9 + 3 * c]; nor[o + 1] = t[10 + 3 * c]; nor[o + 2] = t[11 + 3 * c];
      sample(pos[o], pos[o + 1], pos[o + 2], out); ramp(out.vm / top, color); col[o] = color.r; col[o + 1] = color.g; col[o + 2] = color.b; disp[o] = out.ux; disp[o + 1] = out.uy; disp[o + 2] = out.uz; } });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setAttribute("disp", new THREE.BufferAttribute(disp, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uPhase = phase; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 disp;\nuniform float uPhase;").replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += disp * uPhase;"); };
    mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.userData.id = part.id; group.add(mesh);
    if (r.peakAt) { const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.012 * maxDim, 0.0015 * S.scale), 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })); dot.position.fromArray(r.peakAt); dot.renderOrder = 15; group.add(dot); }
    v.root.add(group); v.body.visible = false;
    resultObj = { id: part.id, group, mesh, k };
  }
  const m = MATERIALS[part.mat], sf = r.safety;
  S.test = { id: part.id, peak: r.peak, strength: r.strength, sMeans: m.sMeans, safety: sf, maxU: r.maxU, env: S.env, material: m.name, note: m.note || null, applied: r.applied, weight: r.weight,
    warnings: r.warnings, notes: r.notes || [], stats: r.stats, exaggeration: k, level: sf >= 2 ? "pass" : sf >= 1 ? "warn" : "fail", verdict: sf >= 2 ? "Holds" : sf >= 1 ? "Near its limit" : "Too weak" };
  emit("test", S.test);
}
export let showBending = true;
export const setBending = (on) => { showBending = on; };

// ---------- files ----------
function solidMeshes() {
  const out = [];
  for (const n of S.nodes) {
    if (!M.isGeometry(n) || n.hole) continue;
    const m = n.kind === "group" ? groupMesh(n)?.raw : meshLocal(n); if (!m) continue;
    const s = n.kind === "group" ? n.s : 1, p = new Float32Array(m.positions.length);
    for (let i = 0; i < p.length; i += 3) { const q = M.toParent(n, [m.positions[i] * s, m.positions[i + 1] * s, m.positions[i + 2] * s]); p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2]; }
    out.push({ name: `${titleOf(n)}, ${MATERIALS[n.mat].name}`, positions: p, index: m.index });
  }
  return out;
}
export let lastDownload = null;
/** Hand a file to the person. Inside a preview frame this goes through the host's save prompt. Resolves true if it went out. */
export async function download(name, data, type) {
  lastDownload = { name, bytes: data.length ?? data.size ?? 0, data };
  if (EMBED) {
    let saver = null; try { saver = window.claude && window.claude.use ? await window.claude.use("downloads") : null; } catch (e) { /* not offered here */ }
    if (!saver) { toast("This preview cannot save files. Open the full page to export.", 6000); return false; }
    try { await saver.save({ filename: name, data }); return true; }
    catch (e) { if (!e || e.code !== "declined") toast("The file was not saved" + (e && e.message ? ": " + e.message : "."), 6000); return false; }
  }
  const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
  return true;
}
const soup = (o) => { const s = new Float32Array(o.index.length * 3); o.index.forEach((v, i) => s.set(o.positions.subarray(3 * v, 3 * v + 3), 3 * i)); return s; };
export async function exportModel(kind) {
  if (!kernelReady()) return toast(EMBED ? "Export works from the full page. This preview has no shape engine." : "Exporting needs the shape engine, which did not start in this browser.", 6000);
  const objs = solidMeshes(); if (!objs.length) return toast("There is nothing solid on the bench to export.");
  if (objs.length < S.nodes.filter((n) => M.isGeometry(n) && !n.hole).length) toast("A fused part could not be made watertight and was left out of the file.", 7000);
  let ok;
  // A preview frame only passes common file types, so both formats travel together in one zip there.
  if (EMBED) ok = await download("whim-part.zip", zipStore([{ name: "whim-part.3mf", data: write3MF(objs) }, { name: "whim-part.stl", data: writeSTL(objs.map(soup)) }]), "application/zip");
  else if (kind === "3mf") ok = await download("whim-part.3mf", write3MF(objs), "model/3mf");
  else ok = await download("whim-part.stl", writeSTL(objs.map(soup)), "model/stl");
  if (ok) toast(`Saved ${objs.length} part${objs.length > 1 ? "s" : ""} in millimetres, bench top as the print bed.`);
}
export const benchJSON = () => JSON.stringify({ app: "whim-spatial", v: 2, nodes: S.nodes, nextId: S.nextId, scale: S.scale, env: S.env });
export const saveFile = () => download("whim-bench.json", benchJSON(), "application/json");
/** Is this a part this version can draw and test? Checked before anything from a file or from storage replaces the bench. */
function validNode(n, top = true) {
  const vec = (a, k) => Array.isArray(a) && a.length === k && a.every((v) => typeof v === "number" && isFinite(v));
  if (!n || typeof n !== "object" || typeof n.id !== "number" || !vec(n.pos, 3) || !vec(n.quat, 4)) return false;
  if (n.kind === "group") return typeof n.s === "number" && n.s > 0 && !!MATERIALS[n.mat] && Array.isArray(n.children) && n.children.length > 0 && n.children.every((c) => M.isGeometry(c) && validNode(c, false));
  if (!vec(n.size, 3) || !n.size.every((v) => v > 0)) return false;
  if (n.kind === "prim") return M.SHAPES.includes(n.shape) && !!MATERIALS[n.mat];
  return top && (n.kind === "clamp" || (n.kind === "load" && typeof n.kg === "number" && n.kg > 0));
}
const topId = (nodes) => nodes.reduce((m, n) => Math.max(m, n.id, n.kind === "group" ? topId(n.children) : 0), 0);
/** A bench from a file or from storage, checked and made safe to restore. Throws with a plain reason if it cannot be used. */
function checked(d) {
  if (!d || !Array.isArray(d.nodes)) throw new Error("it has no parts list");
  if (!d.nodes.every((n) => validNode(n))) throw new Error("it holds a part this version cannot read");
  return JSON.stringify({ nodes: d.nodes, nextId: Math.max(+d.nextId || 0, topId(d.nodes) + 1), scale: d.scale, env: d.env, active: null });
}
export function openFile(text) {
  let json; try { json = checked(JSON.parse(text)); } catch (e) { return toast("That file is not a Whim bench: " + e.message, 6000); }
  restore(json); pushHistory(); fitView(); toast("Bench loaded.");
}
/** A sealed record of what is on the bench and the last test: plain data plus a fingerprint. */
export async function record() {
  const mmv = (a) => a.map((v) => +(v * 1000).toFixed(3));
  const clean = (n) => ({ kind: n.kind, ...(n.shape ? { shape: n.shape } : {}), ...(n.size ? { size_mm: mmv(n.size) } : {}), position_mm: mmv(n.pos), rotation_quat: n.quat.map((v) => +v.toFixed(6)),
    ...(n.hole ? { hole: true } : {}), ...(n.kind === "load" ? { kg: n.kg } : {}), ...(n.kind === "group" ? { scale: n.s, children: n.children.map(clean) } : {}),
    ...(M.isGeometry(n) && !n.hole ? { material: MATERIALS[n.mat].name, density_kg_m3: MATERIALS[n.mat].rho, mass_kg: +massOf(n).toFixed(5) } : {}) });
  const t = S.test, body = { app: `whim-spatial ${VERSION}`, when: new Date().toISOString(), gravity: { place: env().name, m_s2: env().g }, view_scale: `1:${S.scale}`, parts: S.nodes.map(clean),
    test: t ? { verdict: t.verdict, safety_factor: +t.safety.toFixed(3), peak_stress_MPa: +(t.peak / 1e6).toFixed(3), strength_MPa: t.strength / 1e6, strength_means: t.sMeans, material: t.material,
      max_deflection_mm: +(t.maxU * 1000).toFixed(4), applied_N: +t.applied.toFixed(3), own_weight_N: +t.weight.toFixed(3), grid: t.stats.grid, solver: t.stats.solver, warnings: t.warnings,
      method: "linear elastic, brick grid, small deflection, uniform material" } : null };
  const canon = (o) => (Array.isArray(o) ? `[${o.map(canon).join(",")}]` : o && typeof o === "object" ? `{${Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",")}}` : JSON.stringify(o));
  let hash; try { hash = "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon(body))))].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch (e) { hash = "unsealed"; }
  return { body, hash };
}

// ---------- screen pointer: tap to pick, drag to slide, Shift-drag (or the Lift switch) to raise, drag a dot to stretch ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hitPt = new THREE.Vector3(), tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), inv = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
export const pointerOpt = { lift: false };
let drag = null, emptyDown = null;

// Six dots on the selected shape. Dragging one moves that face and leaves the opposite face where it is.
const grips = new THREE.Group(); grips.visible = false;
const gripDots = [];
{
  const geo = new THREE.SphereGeometry(1, 16, 12), dotMat = new THREE.MeshBasicMaterial({ color: COLORS.accent, depthTest: false, transparent: true }), rimMat = new THREE.MeshBasicMaterial({ color: 0x0d141a, depthTest: false, transparent: true }), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (let k = 0; k < 6; k++) {
    const g = new THREE.Group(), rim = new THREE.Mesh(geo, rimMat), dot = new THREE.Mesh(geo, dotMat), hit = new THREE.Mesh(geo, hitMat);
    rim.scale.setScalar(1.4); rim.renderOrder = 24; dot.renderOrder = 25; hit.scale.setScalar(2.2); hit.userData.grip = k;
    g.add(rim, dot, hit); grips.add(g); gripDots.push({ g, hit, axis: k >> 1, sign: k & 1 ? 1 : -1 });
  }
}
const boxCentre = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
function placeGrips() {
  const n = byId(S.active), v = n && visuals.get(n.id), show = !!v && !v.held && !renderer.xr.isPresenting;
  grips.visible = show; if (!show) return;
  if (grips.parent !== v.root) v.root.add(grips);
  const b = M.localBBox(n), c = boxCentre(b), r = Math.max(0.0015, v.root.getWorldPosition(tv).distanceTo(camera.position) * 0.0072) * S.scale;
  // the dots float just clear of each face, so the faces themselves stay free for grabbing the shape
  for (const d of gripDots) { const p = [...c]; p[d.axis] = (d.sign > 0 ? b.max[d.axis] : b.min[d.axis]) + d.sign * 2 * r; d.g.position.fromArray(p); d.g.scale.setScalar(r); }
}
/** World position of stretch dot k (0..5: -x +x -y +y -z +z), or null when the dots are hidden. */
export const gripWorld = (k) => (grips.visible ? gripDots[k].g.getWorldPosition(new THREE.Vector3()).toArray() : null);
/** How far along a line (from F, direction u, bench coordinates) the pointer's ray passes closest. Null when they run parallel. */
function axisParam(F, u) {
  inv.copy(modelGroup.matrixWorld).invert();
  const o = tv.copy(ray.ray.origin).applyMatrix4(inv).toArray(), d = tv2.copy(ray.ray.direction).transformDirection(inv).toArray();
  const w = M.sub(F, o), b = M.dot(u, d), den = 1 - b * b;
  return den < 1e-5 ? null : (b * M.dot(d, w) - M.dot(u, w)) / den;
}
function screenRay(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function onDown(ev) {
  if (renderer.xr.isPresenting || ev.button > 0) return;
  if (drag) return;                                                     // a second finger while dragging: ignore it
  if (emptyDown && emptyDown.pointer !== ev.pointerId) { emptyDown = null; return; }      // a second finger on empty space: leave both to the camera
  emptyDown = null;
  screenRay(ev);
  const grab = (d) => { drag = { ...d, pointer: ev.pointerId, moved: false, x: ev.clientX, y: ev.clientY }; orbit.enabled = false; try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) { /* pointer already gone */ } };
  const g = grips.visible ? ray.intersectObjects(gripDots.map((d) => d.hit), false)[0] : null;
  if (g) {
    const n = byId(S.active), d = gripDots[g.object.userData.grip], b = M.localBBox(n), fixed = boxCentre(b), e = [0, 0, 0];
    fixed[d.axis] = d.sign > 0 ? b.min[d.axis] : b.max[d.axis]; e[d.axis] = d.sign;
    const u = M.qRot(n.quat, e), F = M.toParent(n, fixed), L0 = b.max[d.axis] - b.min[d.axis], t0 = axisParam(F, u);
    return grab({ type: "grip", id: n.id, axis: d.axis, u, F, fixed, L0, off: t0 === null ? 0 : t0 - L0, s0: n.s, size0: n.size ? [...n.size] : null });
  }
  const hit = ray.intersectObjects(pickMeshes(), false)[0];
  if (!hit) { emptyDown = { x: ev.clientX, y: ev.clientY, pointer: ev.pointerId }; return; }
  const id = hit.object.userData.id, v = visuals.get(id); if (!v) return;
  setActive(id);
  const lift = ev.shiftKey || pointerOpt.lift;
  if (lift) { camera.getWorldDirection(tv); tv.y = 0; if (tv.lengthSq() < 1e-6) tv.set(0, 0, -1); plane.setFromNormalAndCoplanarPoint(tv.normalize(), hit.point); } else plane.setFromNormalAndCoplanarPoint(UP, hit.point);
  grab({ type: "move", id, lift, start: hit.point.clone(), origin: v.root.getWorldPosition(new THREE.Vector3()) });
}
function onMove(ev) {
  if (emptyDown && ev.pointerId === emptyDown.pointer && Math.hypot(ev.clientX - emptyDown.x, ev.clientY - emptyDown.y) > 5) emptyDown = null;
  if (!drag || ev.pointerId !== drag.pointer) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return;
  const n = byId(drag.id), v = visuals.get(drag.id); if (!n || !v) { drag = null; orbit.enabled = true; return; }
  screenRay(ev);
  if (drag.type === "grip") {
    const u = drag.u, step = 0.001 * S.scale; let L = axisParam(drag.F, u); if (L === null) return;
    L -= drag.off; if (S.snap) L = Math.round(L / step) * step; L = Math.max(step, L);      // the face follows the pointer by as much as the pointer has moved
    if (n.kind === "group") { const k = L / drag.L0; n.s = drag.s0 * k; n.pos = M.sub(drag.F, M.qRot(n.quat, M.mulS(drag.fixed, k))); }
    else { n.size = [...drag.size0]; n.size[drag.axis] = L; normSize(n, drag.axis); n.pos = M.add(drag.F, M.mulS(u, L / 2)); }
  } else {
    if (!ray.ray.intersectPlane(plane, hitPt) || hitPt.distanceTo(drag.start) > 30) return;
    tv.copy(drag.origin).add(hitPt).sub(drag.start);
    if (drag.lift) { tv.x = drag.origin.x; tv.z = drag.origin.z; }
    modelGroup.worldToLocal(tv); n.pos = tv.toArray();
  }
  if (!drag.moved) { drag.moved = true; clearTest(); }
  const low = M.aabb(n).min[1]; if (low < 0) n.pos[1] -= low;
  syncVisual(v); emit("live");
}
function onUp(ev) {
  if (emptyDown && ev.pointerId === emptyDown.pointer) { emptyDown = null; if (ev.type === "pointerup") setActive(null); }
  if (!drag || ev.pointerId !== drag.pointer) return;
  const d = drag; drag = null; orbit.enabled = true;
  const n = byId(d.id); if (!d.moved || !n) return;
  if (d.type === "move") snapNode(n);
  syncVisual(visuals.get(d.id)); commit();
}

// ---------- frame loop ----------
const frameHooks = []; export const onFrame = (fn) => frameHooks.push(fn);
const wp = new THREE.Vector3();
function frame(time, xrFrame) {
  benchRoot.updateMatrixWorld(true);
  for (const fn of frameHooks) fn(time, xrFrame);
  const presenting = renderer.xr.isPresenting, perPx = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, renderer.domElement.clientHeight);
  const plate = (at, px) => (presenting ? 0.026 : Math.max(0.003, at.distanceTo(camera.position) * perPx * px));     // readable on a screen, a fixed real size in the headset
  for (const v of visuals.values()) {
    // on a screen every part is labelled; in the headset only what you picked, are pointing at, or are holding, plus the weights
    v.label.visible = !presenting || v.node.id === S.active || v.hot || v.held || v.node.kind === "load";
    const h = plate(v.root.getWorldPosition(wp), 34); v.label.scale.set(h * 640 / 84, h, 1);
    labelGroup.worldToLocal(wp); v.label.position.set(wp.x, wp.y + v.top / S.scale + h * 0.8, wp.z);
  }
  { const h = plate(caption.getWorldPosition(wp), 26); caption.scale.set(h * 8, h, 1); }
  placeGrips();
  phase.value = resultObj && showBending ? resultObj.k * (still ? 1 : 0.5 - 0.5 * Math.cos(time / 380)) : 0;
  if (!renderer.xr.isPresenting) orbit.update();
  renderer.render(scene, camera);
}
function resize() { const w = innerWidth, h = innerHeight; if (renderer.xr.isPresenting || !w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }

/** Swing the camera in or out so everything on the bench fills the view. */
export function fitView() {
  const box = new THREE.Box3();
  for (const n of S.nodes) { const b = M.aabb(n); box.expandByPoint(tv.fromArray(b.min).divideScalar(S.scale)); box.expandByPoint(tv.fromArray(b.max).divideScalar(S.scale)); }
  if (box.isEmpty()) box.setFromCenterAndSize(tv.set(0, 0.06, 0), tv2.set(0.5, 0.12, 0.4));
  const c = benchRoot.localToWorld(box.getCenter(new THREE.Vector3())), r = Math.max(0.09, box.getSize(tv).length() / 2);
  const half = THREE.MathUtils.degToRad(camera.fov / 2), fit = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
  const dir = tv2.copy(camera.position).sub(orbit.target).normalize();
  orbit.target.copy(c); camera.position.copy(c).addScaledVector(dir, 1.45 * r / Math.sin(fit)); orbit.update();
}
export function summary() {
  const solids = S.nodes.filter((n) => M.isGeometry(n) && !n.hole), kg = solids.reduce((a, n) => a + massOf(n), 0);
  return solids.length ? `${solids.length} part${solids.length > 1 ? "s" : ""} · ${fmtMass(kg)}` : "Empty bench";
}
export { kernelReady, MATERIALS, ENVS, SCALES, M };

export async function init(container) {
  container.appendChild(renderer.domElement); resize(); addEventListener("resize", resize);
  const el = renderer.domElement; el.addEventListener("pointerdown", onDown); el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
  let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { /* ignore */ }
  let json = null; if (saved) { try { json = checked(saved); } catch (e) { console.warn("saved bench not used:", e.message); } }
  if (json) { S.snap = saved.snap !== false; if (MATERIALS[saved.lastMat]) S.lastMat = saved.lastMat; restore(json, false); }
  else restore(JSON.stringify({ ...exampleNodes(), scale: 1, env: "earth" }), false);
  fitView(); renderer.setAnimationLoop(frame);
  try { if (window.WHIM_NO_KERNEL) throw new Error("the mesh kernel is not part of this copy"); await initKernel(); kernelState = "ready"; }
  catch (e) {
    kernelState = "failed"; console.warn("mesh kernel not running:", e && e.message ? e.message : e);
    if (!EMBED) toast("The shape engine could not start in this browser. Fused parts are drawn approximately and export is off.", 8000);       // a preview frame says so with a standing note instead
  }
  for (const v of visuals.values()) if (v.node.kind === "group") buildVisual(v);
  emit("change"); emit("ready");
}
