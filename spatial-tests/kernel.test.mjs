import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { initKernel, meshLocal, volumeOf } from "../docs/spatial/js/kernel.js";
import { write3MF, writeSTL, zipStore, crc32 } from "../docs/spatial/js/exporters.js";
import { estimateProps, primCom, touching, touchingCluster, makeGroup, explodeGroup, inside, aabb, featurePlanes } from "../docs/spatial/js/model.js";

const I4 = [0, 0, 0, 1];
const prim = (shape, size, pos = [0, 0, 0], hole = false, quat = I4) => ({ id: 0, kind: "prim", shape, size, pos, quat, hole, mat: 0 });
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-15, `${msg}: got ${a}, expected ${b}`);
await initKernel();

test("primitive meshes have the exact volume and centre of mass", () => {
  for (const [shape, v] of [["box", 1], ["cyl", Math.PI / 4], ["sph", Math.PI / 6], ["cone", Math.PI / 12], ["wedge", 0.5]]) {
    const n = prim(shape, [0.04, 0.1, 0.06]), m = meshLocal(n);
    near(m.volume, v * 0.04 * 0.1 * 0.06, 2e-6, shape + " volume");
    const c = primCom(n); for (let a = 0; a < 3; a++) assert.ok(Math.abs(m.com[a] - c[a]) < 2e-6, `${shape} centre ${m.com} vs ${c}`);
    near(estimateProps(n, 60).volume, m.volume, 0.02, shape + " sampled volume");
  }
});

test("touching boxes fuse into one piece; a hole removes exactly its volume", () => {
  const a = prim("box", [0.1, 0.02, 0.05]), b = prim("box", [0.02, 0.08, 0.05], [-0.04, 0.05, 0]);   // b stands on a, faces touching
  const hole = prim("cyl", [0.01, 0.04, 0.01], [0.03, 0, 0], true);
  assert.ok(touching(a, b) && touching(a, hole) && !touching(b, hole));
  assert.ok(!touching(a, prim("box", [0.01, 0.01, 0.01], [0.2, 0, 0])));
  assert.ok(!touching(prim("box", [0.02, 0.02, 0.02]), prim("sph", [0.02, 0.02, 0.02], [0.0195, 0.0195, 0.0195])), "sphere near a corner is not touching");
  const far = prim("box", [0.01, 0.01, 0.01], [0.3, 0, 0]);
  assert.equal(touchingCluster(a, [a, b, hole, far]).length, 3);
  const g = makeGroup(7, [a, b, hole], 0), m = meshLocal(g);
  assert.equal(m.pieces, 1);
  near(m.volume, 0.1 * 0.02 * 0.05 + 0.02 * 0.08 * 0.05 - Math.PI * 0.005 ** 2 * 0.02, 1e-5, "bracket volume");
  near(estimateProps(g, 80).volume, m.volume, 0.02, "sampled volume");
  assert.ok(inside(g, [0, 0, 0]) && !inside(g, [0.03, 0, 0]) && inside(g, [-0.04, 0.08, 0]));
  const big = { ...g, s: 2 }; near(volumeOf(big), 8 * m.volume, 1e-9, "scaled group");
  const back = explodeGroup({ ...g, pos: [1, 2, 3] });
  assert.deepEqual(back.map((n) => n.pos.map((v) => +v.toFixed(9))), [a, b, hole].map((n) => [n.pos[0] - g.pos[0] + 1, n.pos[1] - g.pos[1] + 2, n.pos[2] - g.pos[2] + 3].map((v) => +v.toFixed(9))));
  const planes = featurePlanes(g); assert.ok(planes[1].some((y) => Math.abs(y - (0.01 - g.pos[1])) < 1e-9), "plate top face is a grid plane");
  const bb = aabb(g); near(bb.max[1] - bb.min[1], 0.1, 1e-9, "height");
});

test("3MF and STL files are well formed", () => {
  const g = makeGroup(7, [prim("box", [0.1, 0.02, 0.05]), prim("cyl", [0.01, 0.04, 0.01], [0.03, 0, 0], true)], 0), m = meshLocal(g);
  const bytes = write3MF([{ name: "plate <1>", positions: m.positions, index: m.index }]);
  const dir = mkdtempSync(path.join(tmpdir(), "whim-")), file = path.join(dir, "part.3mf"); writeFileSync(file, bytes);
  assert.match(execFileSync("unzip", ["-t", file]).toString(), /No errors detected/);
  const xml = execFileSync("unzip", ["-p", file, "3D/3dmodel.model"]).toString();
  assert.equal((xml.match(/<vertex /g) || []).length, m.positions.length / 3);
  assert.equal((xml.match(/<triangle /g) || []).length, m.index.length / 3);
  assert.ok(xml.includes('unit="millimeter"') && xml.includes("plate &lt;1&gt;"));
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(zipStore([{ name: "a.txt", data: "hi" }]).length, 30 + 5 + 2 + 46 + 5 + 22);
  const soup = new Float32Array(m.index.length * 3); m.index.forEach((v, i) => soup.set(m.positions.subarray(3 * v, 3 * v + 3), 3 * i));
  const stl = writeSTL([soup]); assert.equal(stl.length, 84 + 50 * (m.index.length / 3));
  const dv = new DataView(stl.buffer); let vol = 0;
  for (let t = 0; t < m.index.length / 3; t++) { const o = 84 + 50 * t + 12, P = [0, 1, 2].map((v) => [0, 1, 2].map((c) => dv.getFloat32(o + 12 * v + 4 * c, true)));
    vol += P[0][0] * (P[1][1] * P[2][2] - P[1][2] * P[2][1]) - P[0][1] * (P[1][0] * P[2][2] - P[1][2] * P[2][0]) + P[0][2] * (P[1][0] * P[2][1] - P[1][1] * P[2][0]); }
  near(vol / 6, m.volume * 1e9, 1e-5, "STL volume in cubic millimetres");
});
