// Whim Spatial Bench: reference data and the starter scene.
// Material values are typical handbook figures. They are a starting point: the mill certificate or the maker's
// datasheet for your actual stock is the number to design to.
import { makeGroup } from "./model.js";

export const MATERIALS = [
  { name: "Aluminum 6061-T6", short: "Aluminum", E: 68.9e9, nu: 0.33, rho: 2700, S: 276e6, sMeans: "yield", color: 0xb9c4cc, metal: true },
  { name: "Steel A36", short: "Steel", E: 200e9, nu: 0.29, rho: 7850, S: 250e6, sMeans: "yield", color: 0x7d8791, metal: true },
  { name: "Stainless 304", short: "Stainless", E: 193e9, nu: 0.29, rho: 8000, S: 215e6, sMeans: "yield", color: 0xa7b1b8, metal: true },
  { name: "Titanium Grade 5", short: "Titanium", E: 113.8e9, nu: 0.34, rho: 4430, S: 880e6, sMeans: "yield", color: 0x8f8d99, metal: true },
  { name: "PLA, printed", short: "PLA", E: 3.3e9, nu: 0.36, rho: 1240, S: 50e6, sMeans: "tensile along layers", color: 0x6ea8ff, note: "Across layers expect about half this strength." },
  { name: "PETG, printed", short: "PETG", E: 2.0e9, nu: 0.38, rho: 1270, S: 48e6, sMeans: "tensile along layers", color: 0x59c2a8, note: "Across layers expect about half this strength." },
  { name: "ASA, printed", short: "ASA", E: 2.0e9, nu: 0.35, rho: 1070, S: 42e6, sMeans: "tensile along layers", color: 0xffb454, note: "Across layers expect about half this strength." },
  { name: "ABS, printed", short: "ABS", E: 2.2e9, nu: 0.35, rho: 1040, S: 40e6, sMeans: "tensile along layers", color: 0xe7e2d2, note: "Across layers expect about half this strength." },
  { name: "Polycarbonate", short: "Polycarb", E: 2.3e9, nu: 0.37, rho: 1200, S: 62e6, sMeans: "tensile yield", color: 0xcfe6ee },
  { name: "Douglas-fir, along grain", short: "Fir", E: 13.4e9, nu: 0.3, rho: 480, S: 85e6, sMeans: "bending rupture", color: 0xc99a5b, note: "Wood is far weaker across the grain. This test treats it as uniform." },
  { name: "Polyimide film", short: "Polyimide", E: 2.5e9, nu: 0.34, rho: 1420, S: 231e6, sMeans: "tensile", color: 0xd98a2b },
  { name: "HDPE", short: "HDPE", E: 0.9e9, nu: 0.42, rho: 950, S: 26e6, sMeans: "tensile yield", color: 0xeef0ea },
];
export const ENVS = { earth: { name: "Earth", g: 9.80665 }, mars: { name: "Mars", g: 3.721 }, moon: { name: "Moon", g: 1.62 } };
export const SCALES = [1, 2, 5, 10, 20, 50];
export const KG_STEPS = [0.1, 0.2, 0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000];
export const DEFAULT_SIZE = { box: [0.06, 0.04, 0.04], cyl: [0.04, 0.06, 0.04], sph: [0.05, 0.05, 0.05], cone: [0.04, 0.06, 0.04], wedge: [0.05, 0.05, 0.03], clamp: [0.03, 0.06, 0.06], load: [0.03, 0.03, 0.03] };

/** First-run scene: a wall bracket with a bolt hole, clamped by its upright, carrying 5 kg. Ready to test. */
export function exampleNodes() {
  // A shelf bracket on a post: the post is the clamp, standing on the bench a little toward the front, within easy reach.
  const I = [0, 0, 0, 1], lift = 0.1, z = 0.1, p = (id, shape, size, pos, hole = false) => ({ id, kind: "prim", shape, size, pos, quat: I, hole, mat: 0 });
  const bracket = makeGroup(5, [
    p(1, "box", [0.12, 0.008, 0.06], [0, lift + 0.004, z]),
    p(2, "box", [0.008, 0.08, 0.06], [-0.056, lift + 0.048, z]),
    p(3, "wedge", [0.05, 0.05, 0.006], [-0.027, lift + 0.033, z]),
    p(4, "cyl", [0.008, 0.02, 0.008], [0.02, lift + 0.004, z], true)], 0);
  return { nextId: 8, active: 5, nodes: [bracket,
    { id: 6, kind: "clamp", size: [0.02, lift + 0.094, 0.07], pos: [-0.07, (lift + 0.094) / 2, z], quat: I },
    { id: 7, kind: "load", kg: 5, size: [0.02, 0.02, 0.04], pos: [0.05, lift + 0.018, z], quat: I }] };
}
