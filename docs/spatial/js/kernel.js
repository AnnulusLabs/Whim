// Whim Spatial Bench: solid geometry through the Manifold kernel (WebAssembly).
// Turns a part tree into one watertight mesh: solid children are joined, hole children are cut out.
// Everything else in the app works without it; if it fails to load, fused parts are shown unmerged.
import { primVolume, qRot } from "./model.js";

let wasm = null, units = null;
export const kernelReady = () => !!wasm;

export async function initKernel(wasmUrl, moduleUrl = "../vendor/manifold.js") {
  const Module = (await import(moduleUrl)).default;
  wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup();
  const { Manifold } = wasm, seg = 72;
  // Faceted circles are sized so their area equals the true circle, and the sphere so its volume is exact:
  // masses computed from the mesh then match the formulas.
  const rCirc = 0.5 * Math.sqrt((2 * Math.PI / seg) / Math.sin(2 * Math.PI / seg));
  const up = (m) => { const r = m.rotate([-90, 0, 0]); m.delete(); return r; };             // kernel's Z axis -> our Y axis
  const raw = Manifold.sphere(0.5, 48), k = Math.cbrt((Math.PI / 6) / raw.volume()), sph = raw.scale(k); raw.delete();
  units = {
    box: Manifold.cube([1, 1, 1], true),
    cyl: up(Manifold.cylinder(1, rCirc, rCirc, seg, true)),
    cone: up(Manifold.cylinder(1, rCirc, 0, seg, true)),
    sph,
    wedge: Manifold.extrude([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]], 1, 0, 0, [1, 1], true),
  };
  return true;
}

function mat4(q, p) {
  const x = qRot(q, [1, 0, 0]), y = qRot(q, [0, 1, 0]), z = qRot(q, [0, 0, 1]);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1];
}

/** Build a node in its own frame (position and rotation not applied). `bin` collects every temporary for deletion. */
function buildLocal(node, bin, scaled = true) {
  const { Manifold } = wasm, keep = (m) => (bin.push(m), m);
  if (node.kind !== "group") return keep(units[node.kind === "prim" ? node.shape : "box"].scale(node.size));
  const solids = [], holes = [];
  for (const c of node.children) (c.hole ? holes : solids).push(keep(buildLocal(c, bin).transform(mat4(c.quat, c.pos))));
  if (!solids.length) return keep(Manifold.cube([0, 0, 0]));
  let r = solids.length > 1 ? keep(Manifold.union(solids)) : solids[0];
  if (holes.length) r = keep(r.subtract(holes.length > 1 ? keep(Manifold.union(holes)) : holes[0]));
  return scaled && node.s !== 1 ? keep(r.scale(node.s)) : r;
}

/** Volume and centre of mass of a closed triangle mesh. */
export function meshProps(positions, index) {
  let v6 = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2], bx = positions[b], by = positions[b + 1], bz = positions[b + 2], qx = positions[c], qy = positions[c + 1], qz = positions[c + 2];
    const d = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    v6 += d; cx += d * (ax + bx + qx); cy += d * (ay + by + qy); cz += d * (az + bz + qz);
  }
  return { volume: v6 / 6, com: v6 ? [cx / (4 * v6), cy / (4 * v6), cz / (4 * v6)] : [0, 0, 0] };
}

/**
 * Mesh of a node in its own frame. Groups are returned at scale 1 (multiply by node.s yourself), so one mesh
 * serves every size of the same group. Returns { positions, index, volume, com, pieces }.
 */
export function meshLocal(node) {
  const bin = [];
  try {
    const m = buildLocal(node, bin, false), g = m.getMesh(), np = g.numProp;
    const positions = new Float32Array((g.vertProperties.length / np) * 3);
    for (let i = 0, o = 0; i < g.vertProperties.length; i += np, o += 3) { positions[o] = g.vertProperties[i]; positions[o + 1] = g.vertProperties[i + 1]; positions[o + 2] = g.vertProperties[i + 2]; }
    const index = Uint32Array.from(g.triVerts), pieces = m.isEmpty() ? 0 : m.decompose();
    const count = pieces ? pieces.length : 0; if (pieces) for (const p of pieces) p.delete();
    return { positions, index, pieces: count, ...meshProps(positions, index) };
  } finally { for (const m of bin) { try { m.delete(); } catch (e) { /* already freed */ } } }
}

/** Analytic volume for primitives, mesh volume for groups. */
export const volumeOf = (node) => (node.kind === "group" ? meshLocal(node).volume * node.s ** 3 : primVolume(node));
