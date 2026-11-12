// Run with: node --test spatial-tests/
import test from "node:test";
import assert from "node:assert/strict";
import { brick, runTest, makeSampler } from "../docs/spatial/js/fea.js";

const AL = { E: 68.9e9, nu: 0.33, rho: 2700, S: 276e6 }, G0 = 9.80665, I4 = [0, 0, 0, 1];
const box = (size, pos = [0, 0, 0], extra = {}) => ({ id: 1, kind: "prim", shape: "box", size, pos, quat: I4, hole: false, mat: 0, ...extra });
const clamp = (size, pos) => ({ id: 90, kind: "clamp", size, pos, quat: I4 });
const load = (kg, size, pos, quat = I4) => ({ id: 91, kind: "load", kg, size, pos, quat });
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: got ${a}, expected ${b} within ${rel * 100}%`);

test("brick: rigid motions cost nothing and constant strain has the exact energy", () => {
  const h = [0.01, 0.004, 0.025], nu = 0.3, { Ke } = brick(...h, nu);
  const X = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((c) => c.map((v, a) => v * h[a]));
  const mul = (u) => { const f = new Float64Array(24); for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) f[i] += Ke[i * 24 + j] * u[j]; return f; };
  const field = (fn) => X.flatMap(fn);
  const scale = Ke[0];
  for (const u of [field(() => [1, 0, 0]), field(() => [0, 1, 0]), field(() => [0, 0, 1]), field(([x, y, z]) => [-y, x, 0]), field(([x, y, z]) => [0, -z, y]), field(([x, y, z]) => [z, 0, -x])])
    for (const f of mul(u)) assert.ok(Math.abs(f) < 1e-9 * scale, "rigid motion produced force");
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) assert.ok(Math.abs(Ke[i * 24 + j] - Ke[j * 24 + i]) < 1e-12 * scale);
  const lam = nu / ((1 + nu) * (1 - 2 * nu)), mu = 0.5 / (1 + nu), V = h[0] * h[1] * h[2];
  const energy = (u) => { const f = mul(u); let e = 0; for (let i = 0; i < 24; i++) e += u[i] * f[i]; return e; };
  near(energy(field(([x]) => [x, 0, 0])), V * (lam + 2 * mu), 1e-10, "uniaxial strain energy");
  near(energy(field(([x, y]) => [y, 0, 0])), V * mu, 1e-10, "shear strain energy");
});

test("pulled bar stretches by F L / (E A)", () => {
  const r = runTest({ part: box([0.2, 0.02, 0.02]), clamps: [clamp([0.01, 0.03, 0.03], [-0.105, 0, 0])],
    loads: [load(1000 / G0, [0.03, 0.01, 0.03], [0.105, 0, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2])], mat: { ...AL, nu: 0 }, selfWeight: false });
  near(r.maxU, 1000 * 0.2 / (AL.E * 4e-4), 1e-6, "elongation");
  near(r.peak, 1000 / 4e-4, 1e-6, "stress");
});

const beam = (opts = {}) => runTest({ part: box([0.15, 0.008, 0.03]), clamps: [clamp([0.01, 0.02, 0.04], [-0.08, 0, 0])],
  loads: [load(20, [0.01, 0.02, 0.04], [0.08, 0, 0])], mat: AL, selfWeight: false, ...opts });
const F = 20 * G0, Iz = 0.03 * 0.008 ** 3 / 12;

test("cantilever: tip deflection and bending stress match beam theory", () => {
  const r = beam();
  near(r.maxU, F * 0.15 ** 3 / (3 * AL.E * Iz), 0.03, "tip deflection");
  const s = makeSampler(r)(0, 0.004, 0, {});
  near(s.vm, F * 0.075 * 0.004 / Iz, 0.04, "stress at mid-span top");
  near(r.peak, F * 0.15 * 0.004 / Iz, 0.12, "reported peak vs root stress");
  assert.equal(r.stats.solver, "direct");
  assert.ok(r.safety > 2.5 && r.safety < 3.6);
});

test("iterative and direct solvers agree", () => {
  const a = beam({ solver: "direct" }), b = beam({ solver: "iterative" });
  near(b.maxU, a.maxU, 1e-4, "deflection"); near(b.peak, a.peak, 1e-3, "peak");
  assert.ok(b.stats.iterations > 0);
});

test("cantilever under its own weight", () => {
  const r = runTest({ part: box([0.15, 0.008, 0.03]), clamps: [clamp([0.01, 0.02, 0.04], [-0.08, 0, 0])], mat: AL });
  const w = AL.rho * G0 * 0.008 * 0.03;
  near(r.maxU, w * 0.15 ** 4 / (8 * AL.E * Iz), 0.03, "self-weight deflection");
  near(r.weight, w * 0.15, 1e-9, "weight");
});

test("lower gravity scales the result", () => {
  const e = beam(), m = beam({ g: 3.721 });
  near(m.maxU / e.maxU, 3.721 / G0, 1e-9, "Mars to Earth ratio");
});

test("a rotated part gives the same answer", () => {
  const q = [0, Math.sin(0.35), 0, Math.cos(0.35)];           // yaw 40 degrees: gravity still along the thin direction
  const rot = (v) => { const c = Math.cos(0.7), s = Math.sin(0.7); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
  const r = runTest({ part: { ...box([0.15, 0.008, 0.03]), quat: q }, clamps: [{ ...clamp([0.01, 0.02, 0.04], rot([-0.08, 0, 0])), quat: q }],
    loads: [{ ...load(20, [0.01, 0.02, 0.04], rot([0.08, 0, 0])), quat: q }], mat: AL, selfWeight: false });
  near(r.maxU, beam().maxU, 1e-6, "deflection");
});

test("round rod cantilever is close to theory despite the stepped grid", () => {
  const rod = { id: 1, kind: "prim", shape: "cyl", size: [0.02, 0.2, 0.02], pos: [0, 0, 0], quat: [0, 0, Math.SQRT1_2, Math.SQRT1_2], hole: false, mat: 0 };  // axis along x
  const r = runTest({ part: rod, clamps: [clamp([0.01, 0.03, 0.03], [-0.105, 0, 0])], loads: [load(5, [0.01, 0.03, 0.03], [0.105, 0, 0])], mat: AL, selfWeight: false, budget: 6000 });
  near(r.maxU, 5 * G0 * 0.2 ** 3 / (3 * AL.E * Math.PI * 0.02 ** 4 / 64), 0.10, "rod deflection");
});

test("fused L-bracket with a bolt hole runs and reports sensible numbers", () => {
  const kid = (shape, size, pos, hole = false) => ({ id: 0, kind: "prim", shape, size, pos, quat: I4, hole, mat: 0 });
  const part = { id: 1, kind: "group", s: 1, hole: false, mat: 0, pos: [0, 0.144, 0], quat: I4, children: [
    kid("box", [0.12, 0.008, 0.06], [0, -0.04, 0]), kid("box", [0.008, 0.08, 0.06], [-0.056, 0.004, 0]),
    kid("wedge", [0.05, 0.05, 0.006], [-0.027, -0.011, 0]), kid("cyl", [0.008, 0.02, 0.008], [0.035, -0.04, 0], true)] };
  const r = runTest({ part, clamps: [clamp([0.02, 0.09, 0.07], [-0.07, 0.148, 0])], loads: [load(5, [0.02, 0.02, 0.04], [0.05, 0.118, 0])], mat: AL });
  assert.ok(r.peak > 1e6 && r.peak < 60e6, `peak ${r.peak}`);
  assert.ok(r.maxU > 1e-6 && r.maxU < 5e-4, `deflection ${r.maxU}`);
  assert.ok(r.stats.cells > 500);
});

test("clear messages when the setup cannot be tested", () => {
  assert.throws(() => runTest({ part: box([0.1, 0.01, 0.01]), mat: AL }), { code: "no-clamp" });
  assert.throws(() => runTest({ part: box([0.1, 0.01, 0.01]), clamps: [clamp([0.01, 0.01, 0.01], [0.3, 0, 0])], mat: AL }), { code: "no-clamp" });
  assert.throws(() => runTest({ part: box([0.1, 0.01, 0.01]), clamps: [clamp([0.3, 0.3, 0.3], [0, 0, 0])], mat: AL }), { code: "all-fixed" });
  const r = runTest({ part: box([0.1, 0.01, 0.01]), clamps: [clamp([0.01, 0.02, 0.02], [-0.055, 0, 0])], loads: [load(1, [0.01, 0.01, 0.01], [0.5, 0, 0])], mat: AL });
  assert.ok(r.warnings.some((w) => w.includes("not touching")));
});
