// Whim Spatial Bench: headset mode (WebXR, built around the Quest 3).
// A controller and a tracked hand are the same thing here: a pointer with a ray, a grab point and a press.
// Trigger, grip or pinch on a part holds it. A second press stretches it. The bench carries its own shelf,
// buttons, bin and status board, because the page itself cannot be seen from inside the headset.
import * as THREE from "three";
import * as A from "./app.js";
import * as M from "./model.js";
import { DEFAULT_SIZE, SCALES, ENVS, MATERIALS } from "./data.js";

const { S, renderer, scene, camera, benchRoot, modelGroup, BENCH, COLORS } = A;
const PREF = "whim.spatial.view";
export const xr = { ar: false, vr: false, handheld: false, session: null, mode: null, view: "room", starting: false };
try { if (localStorage.getItem(PREF) === "dark") xr.view = "dark"; } catch (e) { /* storage may be off */ }
export const available = () => (xr.ar || xr.vr) && !xr.handheld;
export function setView(v) { xr.view = v === "dark" ? "dark" : "room"; try { localStorage.setItem(PREF, xr.view); } catch (e) { /* ignore */ } }

/** Ask the browser what it can do. Safe to call anywhere; resolves with the xr object. */
export async function detect() {
  const ua = navigator.userAgent;
  xr.handheld = /Android|iPhone|iPad/i.test(ua) && !/OculusBrowser|Quest|Pico|Wolvic|\bVR\b|\bXR\b/i.test(ua);
  if (!navigator.xr || !navigator.xr.isSessionSupported) return xr;
  const policy = document.featurePolicy || document.permissionsPolicy;                         // a frame that is not allowed XR: do not even ask
  try { if (policy && policy.allowsFeature && !policy.allowsFeature("xr-spatial-tracking")) return xr; } catch (e) { /* ask anyway */ }
  const ok = async (m) => { try { return await navigator.xr.isSessionSupported(m); } catch (e) { return false; } };
  [xr.ar, xr.vr] = await Promise.all([ok("immersive-ar"), ok("immersive-vr")]);
  return xr;
}

const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), m3 = new THREE.Matrix4(), q1 = new THREE.Quaternion();
const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), sc = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- bench furniture that only exists in the headset ----------
const rig = new THREE.Group(); rig.visible = false; benchRoot.add(rig);
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false }), BOX = new THREE.BoxGeometry(1, 1, 1);

// the shelf: one of each thing you can add, along the back edge
const SHELF_Z = -BENCH.d / 2 + 0.06, SHELF_Y = 0.046;
const shelf = [["box", "Box"], ["cyl", "Cylinder"], ["sph", "Sphere"], ["cone", "Cone"], ["wedge", "Wedge"], ["clamp", "Clamp"], ["load", "Weight"]].map(([kind, name], i) => {
  const size = DEFAULT_SIZE[kind], group = new THREE.Group(), fixture = kind === "clamp" || kind === "load";
  group.position.set((i - 3) * 0.135, SHELF_Y + size[1] / 2, SHELF_Z);
  const mesh = new THREE.Mesh(A.unitGeometry(fixture ? "box" : kind), new THREE.MeshStandardMaterial({ color: kind === "clamp" ? COLORS.clamp : kind === "load" ? COLORS.load : 0xcfd8df, roughness: 0.7, transparent: kind === "clamp", opacity: kind === "clamp" ? 0.6 : 1 }));
  mesh.scale.fromArray(size);
  const proxy = new THREE.Mesh(BOX, HIDDEN); proxy.scale.set(0.125, 0.11, 0.11); proxy.userData.shelf = i;
  const tag = A.textSprite(256, 64, 0.128); A.paint(tag, [{ text: name, size: 34 }], { bg: "rgba(13,20,27,.78)", tight: true }); tag.position.set(0, -size[1] / 2 - 0.034, 0.07);
  group.add(mesh, proxy, tag); rig.add(group);
  return { kind, name, group, mesh, proxy, hot: false };
});
{ const plank = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x24323f, roughness: 0.9 })); plank.scale.set(0.98, 0.012, 0.11); plank.position.set(0, SHELF_Y - 0.006, SHELF_Z); rig.add(plank); }

// the buttons: three rows on a sloped panel along the front edge, like the lip of a console
const BW = 0.062, BH = 0.042, PX = 0.068, PY = 0.048;
const panel = new THREE.Group(); panel.position.set(0, -0.06, BENCH.d / 2 + 0.064); panel.rotation.x = -Math.PI / 4; rig.add(panel);
{ const plate = new THREE.Mesh(new THREE.PlaneGeometry(8 * PX + 0.014, 3 * PY + 0.014), new THREE.MeshBasicMaterial({ color: 0x0b1117, transparent: true, opacity: 0.88 })); plate.position.z = -0.004; panel.add(plate); }
const buttons = ["undo", "redo", "copy", "delete", "hole", "fuse", "break", "test",
  "material", "axis", "minus", "plus", "scale", "gravity", "snap", "exit",
  "spin-", "spin+", "tip-", "tip+", "roll-", "roll+", "flat", "drop"].map((id, i) => {
  const canvas = Object.assign(document.createElement("canvas"), { width: 248, height: 168 }), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(((i % 8) - 3.5) * PX, (1 - Math.floor(i / 8)) * PY, 0); mesh.userData.button = i; panel.add(mesh);
  return { id, mesh, canvas, tex, key: "", x: mesh.position.x, y: mesh.position.y, hot: false, flash: 0, last: 0 };
});
const usingHands = () => pointers.some((p) => p.isHand);
function face(b) {
  const n = A.byId(S.active);
  switch (b.id) {
    case "undo": return { text: "Undo" }; case "redo": return { text: "Redo" }; case "copy": return { text: "Copy" }; case "delete": return { text: "Delete" };
    case "hole": return { text: "Hole", on: !!(n && n.hole) };
    case "fuse": return { text: "Fuse" }; case "break": return { text: "Break" };
    case "test": return { text: S.busy ? "Testing" : "Test", hero: true };
    case "material": return { text: n && M.isGeometry(n) ? MATERIALS[n.mat].short : "Material", sub: n && M.isGeometry(n) ? "material" : "" };
    case "axis": return { text: "Side", sub: n && n.kind !== "group" ? ["width", "height", "depth"][S.axis] : "next" };
    case "minus": return { text: "−", sub: n && n.kind === "load" ? "weight" : `${S.scale} mm` };
    case "plus": return { text: "+", sub: n && n.kind === "load" ? "weight" : `${S.scale} mm` };
    case "scale": return { text: `1:${S.scale}`, sub: "scale" };
    case "gravity": return { text: ENVS[S.env].name, sub: "gravity" };
    case "snap": return { text: "Snap", sub: S.snap ? "on" : "off", on: S.snap };
    case "flat": return { text: "Flat", sub: "square up" };
    case "drop": return { text: "Drop", sub: "to bench" };
    case "exit": return { text: "Exit" };
    default: return { text: { s: "Spin", t: "Tip", r: "Roll" }[b.id[0]] + (b.id.endsWith("+") ? " +" : " \u2212"), sub: "15\u00b0" };
  }
}
function paintButton(b) {
  const f = face(b), key = JSON.stringify(f); if (key === b.key) return; b.key = key;
  const g = b.canvas.getContext("2d"), w = b.canvas.width, h = b.canvas.height;
  g.clearRect(0, 0, w, h); g.fillStyle = f.hero ? "#0f6f78" : f.on ? "#1b5660" : "#22303c"; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 22); g.fill();
  g.strokeStyle = f.hero || f.on ? "#39d0d8" : "#3d5468"; g.lineWidth = 6; g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#eef4f8"; g.font = `700 ${f.sub ? 54 : 58}px system-ui, "Segoe UI", Roboto, sans-serif`; g.fillText(f.text, w / 2, f.sub ? h * 0.4 : h / 2, w - 26);
  if (f.sub) { g.fillStyle = "#a9bac8"; g.font = `500 30px system-ui, "Segoe UI", Roboto, sans-serif`; g.fillText(f.sub, w / 2, h * 0.76, w - 26); }
  b.tex.needsUpdate = true;
}
const paintButtons = () => buttons.forEach(paintButton);

// the bin: let go of a part over it to delete the part
const BIN = { c: new THREE.Vector3(0.43, -0.07, BENCH.d / 2 + 0.1), half: 0.085 };
const binFill = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: COLORS.fail, transparent: true, opacity: 0.14, depthWrite: false }));
{
  const g = new THREE.Group(); g.position.copy(BIN.c); binFill.scale.setScalar(BIN.half * 2);
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: COLORS.fail })); wire.scale.setScalar(BIN.half * 2);
  const tag = A.textSprite(256, 64, 0.1); A.paint(tag, [{ text: "Bin", size: 34, color: "#ffb0b0" }], { bg: "rgba(13,20,27,.78)" }); tag.position.set(0, BIN.half + 0.035, 0);
  g.add(binFill, wire, tag); rig.add(g);
}
function overBin(world) { t3.copy(world); benchRoot.worldToLocal(t3).sub(BIN.c); const r = BIN.half + 0.03; return Math.abs(t3.x) < r && Math.abs(t3.y) < r && Math.abs(t3.z) < r; }

// the handle: grab it to move, turn or raise the whole bench
const handle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshStandardMaterial({ color: 0xa9bac8, roughness: 0.45 }));
handle.position.set(-0.43, -0.06, BENCH.d / 2 + 0.07); rig.add(handle);
const handleProxy = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), HIDDEN); handleProxy.userData.handle = true; handle.add(handleProxy);
{ const tag = A.textSprite(320, 64, 0.125); A.paint(tag, [{ text: "Move bench", size: 32 }], { bg: "rgba(13,20,27,.78)" }); tag.position.set(0, 0.055, 0); handle.add(tag); }

// the board: everything the page would have told you, readable from where you stand
const boardCanvas = Object.assign(document.createElement("canvas"), { width: 1024, height: 600 }), boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 4;
const board = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66 * 600 / 1024), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true }));
board.position.set(0, 0.41, -BENCH.d / 2 - 0.03); board.rotation.x = -0.12; rig.add(board);
let note = null, boardKey = "", boardAt = 0;
const FONT = `system-ui, "Segoe UI", Roboto, sans-serif`;
function wrap(g, text, maxW) { const out = []; let line = ""; for (const word of String(text).split(/\s+/)) { const t = line ? line + " " + word : word; if (line && g.measureText(t).width > maxW) { out.push(line); line = word; } else line = t; } if (line) out.push(line); return out; }
function boardLines() {
  const n = A.byId(S.active), t = S.test, hands = usingHands(), L = [];
  L.push({ text: `${A.summary()}  ·  ${ENVS[S.env].name} gravity  ·  scale 1:${S.scale}  ·  snap ${S.snap ? "on" : "off"}`, size: 28, color: "#8fa2b1" });
  if (!n) L.push({ text: "Nothing selected", size: 34, color: "#8fa2b1" });
  else if (n.kind === "load") L.push({ text: `Weight  ·  ${+n.kg} kg  ·  pushes ${A.fmtForce(n.kg * ENVS[S.env].g)} down its arrow`, size: 34 });
  else if (n.kind === "clamp") L.push({ text: `Clamp  ·  ${A.dimsText(n)}  ·  holds what it touches`, size: 34 });
  else L.push({ text: `${A.titleOf(n)}  ·  ${A.dimsText(n)}${n.hole ? "" : `  ·  ${MATERIALS[n.mat].short}  ·  ${A.fmtMass(A.massOf(n))}`}`, size: 34 });
  L.push({ rule: true });
  if (S.busy) L.push({ text: "Running the test…", size: 44, weight: 700, color: "#39d0d8" });
  else if (t) {
    const col = { pass: "#5ad18a", warn: "#ffb454", fail: "#ff6b6b" }[t.level];
    L.push({ text: t.verdict.toUpperCase() + (isFinite(t.safety) ? `  ·  safety factor ${t.safety.toFixed(t.safety < 10 ? 1 : 0)}` : "  ·  no load on it"), size: 46, weight: 800, color: col });
    L.push({ text: `Peak stress ${A.fmtStress(t.peak)} of ${A.fmtStress(t.strength)} (${t.sMeans}), ${t.material}`, size: 30 });
    L.push({ text: `Bends ${A.fmtLen(t.maxU)} at most, drawn ×${Math.round(t.exaggeration)}  ·  load ${A.fmtForce(t.applied)} + own weight ${A.fmtForce(t.weight)}`, size: 30 });
    L.push({ text: `Quick straight-line estimate on ${t.stats.cells.toLocaleString("en-US")} bricks. ${t.warnings[0] || t.notes[0] || "Red is the most stressed spot."}`, size: 26, color: "#8fa2b1", wrap: true });
  } else {
    L.push({ text: `Point at a shape on the back shelf and ${hands ? "pinch" : "pull the trigger"}. It appears in your hand.`, size: 29, wrap: true });
    L.push({ text: hands ? "A pinch carries a part. Spin, Tip and Roll turn it. Pinch with the other hand and pull apart to stretch." : "Trigger carries a part. Grip carries and turns it. Press with the other hand and pull apart to stretch.", size: 29, wrap: true });
    L.push({ text: "Push shapes together and press Fuse. A Hole cuts when fused. The red bin deletes.", size: 29, wrap: true });
    L.push({ text: "Add a Clamp and a Weight, then press Test.", size: 29, wrap: true });
  }
  if (note) L.push({ note: note.text });
  return L;
}
function paintBoard(force = false) {
  const now = performance.now(); if (note && now > note.until) note = null;
  if (!force && now - boardAt < 90) return;
  const L = boardLines(), key = JSON.stringify(L); if (key === boardKey) return; boardKey = key; boardAt = now;
  const g = boardCanvas.getContext("2d"), W = boardCanvas.width, H = boardCanvas.height, pad = 34;
  g.clearRect(0, 0, W, H); g.fillStyle = "rgba(11,17,23,.9)"; g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill(); g.strokeStyle = "#2b3b49"; g.lineWidth = 4; g.stroke();
  g.textAlign = "left"; g.textBaseline = "alphabetic"; let y = 30;
  for (const l of L) {
    if (l.rule) { y += 14; g.fillStyle = "#2b3b49"; g.fillRect(pad, y, W - 2 * pad, 3); y += 12; continue; }
    if (l.note) continue;
    g.font = `${l.weight || 500} ${l.size}px ${FONT}`; g.fillStyle = l.color || "#e6edf2";
    for (const row of l.wrap ? wrap(g, l.text, W - 2 * pad) : [l.text]) { y += l.size * 1.28; g.fillText(row, pad, y, W - 2 * pad); }
  }
  const n = L.find((l) => l.note);
  if (n) {
    g.font = `600 30px ${FONT}`; const rows = wrap(g, n.note, W - 2 * pad - 36).slice(0, 3), h = rows.length * 38 + 30, top = H - h - 18;
    g.fillStyle = "#12313a"; g.beginPath(); g.roundRect(pad - 10, top, W - 2 * pad + 20, h, 16); g.fill(); g.strokeStyle = "#39d0d8"; g.lineWidth = 3; g.stroke();
    g.fillStyle = "#eef4f8"; rows.forEach((r, i) => g.fillText(r, pad + 8, top + 42 + i * 38, W - 2 * pad - 16));
  }
  boardTex.needsUpdate = true;
}

// ---------- pointers ----------
const JOINT_GEO = new THREE.SphereGeometry(1, 10, 8), JOINT_MAT = new THREE.MeshStandardMaterial({ color: 0xd7e3ea, roughness: 0.6 });
const pointers = [0, 1].map((i) => {
  const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), hand = renderer.xr.getHand(i);
  scene.add(ray, grip, hand);
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3)), new THREE.LineBasicMaterial({ color: 0x9fe8ee, transparent: true, opacity: 0.7 }));
  line.frustumCulled = false; ray.add(line);
  const dot = new THREE.Mesh(JOINT_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })); dot.scale.setScalar(0.005); dot.renderOrder = 30; dot.visible = false; scene.add(dot);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0x9db0bf, roughness: 0.5 })); stub.rotation.x = Math.PI / 2; stub.position.z = 0.03; grip.add(stub);
  const p = { i, ray, grip, hand, line, dot, stub, source: null, isHand: false, tracked: false, pinchOK: false, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), grab: new THREE.Vector3(), tip: new THREE.Vector3(), hasTip: false,
    wristQ: new THREE.Quaternion(), hold: null, stretch: null, bench: null, hoverKey: "", pokeZ: null, queue: [] };
  // Presses arrive just before the frame's poses do, so they wait in a queue and are handled once the hand is where it really is.
  ray.addEventListener("connected", (e) => { p.source = e.data || null; p.isHand = !!(e.data && e.data.hand); boardKey = ""; });
  ray.addEventListener("disconnected", () => { p.queue.length = 0; letGo(p); p.source = null; p.isHand = false; p.tracked = false; });
  ray.addEventListener("selectstart", () => p.queue.push(["press", "select"])); ray.addEventListener("selectend", () => p.queue.push(["release", "select"]));
  ray.addEventListener("squeezestart", () => p.queue.push(["press", "squeeze"])); ray.addEventListener("squeezeend", () => p.queue.push(["release", "squeeze"]));
  return p;
});
// In passthrough you can see your own hands and controllers, so only the two pinching fingertips are marked.
const shows = (joint) => xr.mode !== "immersive-ar" || joint === "index-finger-tip" || joint === "thumb-tip";
function dress() { for (const p of pointers) { p.stub.visible = xr.mode !== "immersive-ar"; for (const name in p.hand.joints) { const d = p.hand.joints[name].userData.dot; if (d) d.visible = shows(name); } } }
function pulse(p, strength, ms) {
  try { const a = p.source && p.source.gamepad && p.source.gamepad.hapticActuators; if (a && a[0] && a[0].pulse) { const r = a[0].pulse(strength, ms); if (r && r.catch) r.catch(() => {}); } } catch (e) { /* no haptics on this input */ }
}
function readPointer(p) {
  p.tracked = !!p.source && p.ray.visible; p.hasTip = false; p.pinchOK = false;
  if (!p.tracked) return;
  p.ray.updateMatrixWorld(true); p.origin.setFromMatrixPosition(p.ray.matrixWorld); p.dir.set(0, 0, -1).transformDirection(p.ray.matrixWorld); p.grab.copy(p.origin);
  if (!p.isHand) return;
  const j = p.hand.joints, tip = j["index-finger-tip"], thumb = j["thumb-tip"], wrist = j["wrist"];
  for (const name in j) { const o = j[name]; if (!o.userData.dot) { const d = new THREE.Mesh(JOINT_GEO, JOINT_MAT); d.scale.setScalar(name.endsWith("tip") ? 0.007 : 0.0055); d.visible = shows(name); o.add(d); o.userData.dot = d; } }
  if (tip && thumb && tip.visible && thumb.visible) {
    p.tip.copy(tip.position); p.hasTip = true; p.grab.copy(tip.position).add(thumb.position).multiplyScalar(0.5); p.pinchOK = true;
    if (wrist && wrist.visible) p.wristQ.copy(wrist.quaternion); else p.wristQ.setFromRotationMatrix(p.ray.matrixWorld);
  }
}
/** Where the hand is as a rigid frame, so a held part can ride on it. */
function frameOf(p, h, out) { return h.frame === "pinch" ? out.compose(p.grab, p.wristQ, ONE) : out.copy(p.ray.matrixWorld); }

// ---------- what is under a pointer ----------
const caster = new THREE.Raycaster(); caster.far = 6;
const fixedTargets = [...buttons.map((b) => b.mesh), ...shelf.map((s) => s.proxy), handleProxy];
function probe(p) {
  const g = p.grab;
  // 1. within reach of the hand itself
  t1.copy(g); panel.worldToLocal(t1);
  if (Math.abs(t1.z) < 0.03) for (const b of buttons) if (Math.abs(t1.x - b.x) < BW / 2 && Math.abs(t1.y - b.y) < BH / 2) return { type: "button", b, key: "b" + b.id };
  if (handle.getWorldPosition(t1).distanceTo(g) < 0.07) return { type: "handle", key: "h" };
  let item = null, best = 0.08; for (const s of shelf) { const d = s.group.getWorldPosition(t1).distanceTo(g); if (d < best) { best = d; item = s; } }
  if (item) return { type: "shelf", item, key: "s" + item.kind };
  t1.copy(g); modelGroup.worldToLocal(t1); const mp = [t1.x, t1.y, t1.z]; let near = null;
  for (const n of S.nodes) if (M.inside(n, mp, 0.012 * S.scale)) { const v = A.visuals.get(n.id); if (v && (!near || v.rad < near.rad)) near = v; }
  if (near) return { type: "part", id: near.node.id, far: false, key: "p" + near.node.id };
  // 2. whatever the ray lands on
  caster.set(p.origin, p.dir);
  const hit = caster.intersectObjects(fixedTargets.concat(A.pickMeshes()), false)[0]; if (!hit) return null;
  const u = hit.object.userData, at = { dist: hit.distance, point: hit.point };
  if (u.button !== undefined) return { type: "button", b: buttons[u.button], key: "b" + buttons[u.button].id, ...at };
  if (u.shelf !== undefined) return { type: "shelf", item: shelf[u.shelf], key: "s" + shelf[u.shelf].kind, ...at };
  if (u.handle) return { type: "handle", key: "h", ...at };
  if (u.id !== undefined && A.visuals.has(u.id)) return { type: "part", id: u.id, far: hit.distance > 0.15, key: "p" + u.id, ...at };
  return null;
}

/** What a press would act on. While the other hand holds a part, a press is a stretch unless it is on a button or right at something. */
function aimed(p) { const h = probe(p); return h && h.dist !== undefined && h.type !== "button" && pointers[1 - p.i].hold ? null : h; }

// ---------- press and release ----------
function onPress(p, kind) {
  if (!xr.session || p.hold || p.stretch || p.bench || !p.tracked) return;
  const other = pointers[1 - p.i], hit = aimed(p);
  if (hit && hit.type === "button") return pressButton(hit.b, p);
  if (hit && hit.type === "handle") { p.bench = { kind, h0: p.grab.clone(), yaw0: heading(p), p0: benchRoot.position.clone(), r0: benchRoot.rotation.y, turn: 0 }; pulse(p, 0.4, 25); return; }
  if (hit && hit.type === "shelf") {
    t1.copy(p.grab); modelGroup.worldToLocal(t1);
    const n = A.spawn(hit.item.kind, [t1.x, t1.y, t1.z], { hold: true });
    startHold(p, n.id, kind, false).fresh = true; pulse(p, 0.6, 30); return;
  }
  if (hit && hit.type === "part" && !(other.hold && other.hold.id === hit.id)) { A.setActive(hit.id); startHold(p, hit.id, kind, hit.far); pulse(p, 0.35, 20); return; }
  if (other.hold) { startStretch(p, other, kind); pulse(p, 0.35, 20); return; }
  A.setActive(null);
}
function onRelease(p, kind) {
  if (p.bench && p.bench.kind === kind) { p.bench = null; return; }
  if (p.stretch && p.stretch.kind === kind) return endStretch(p);
  if (p.hold && p.hold.kind === kind) endHold(p);
}
function letGo(p) { p.bench = null; if (p.stretch) endStretch(p); if (p.hold) endHold(p); }

function startHold(p, id, kind, far) {
  const v = A.visuals.get(id), n = A.byId(id);
  // Trigger or pinch carries a part and leaves its angle alone, so it lands as square as it left. The grip button carries and turns.
  const h = { id, v, kind, far, turn: kind === "squeeze", frame: p.isHand && !far && p.pinchOK ? "pinch" : "ray", offset: new THREE.Matrix4(), shift: new THREE.Vector3(), pos0: [...n.pos], quat0: [...n.quat], fresh: false, changed: false, t0: performance.now(), g0: p.grab.clone(), d0: p.dir.clone() };
  benchRoot.updateMatrixWorld(true);
  h.offset.copy(frameOf(p, h, m1)).invert().multiply(v.root.matrixWorld);
  v.held = true; p.hold = h; return h;
}
function doHold(p, dt) {
  const h = p.hold, v = A.visuals.get(h.id), n = A.byId(h.id);
  if (!v || v !== h.v || !n) { p.hold = null; return; }                      // undone or deleted while in the hand
  if (!p.tracked || (h.frame === "pinch" && !p.pinchOK)) return;              // tracking dropped: the part waits where it is
  if (h.far && p.source && p.source.gamepad) {                               // thumbstick reels a far part in and out
    const ax = p.source.gamepad.axes, y = ax.length >= 4 ? ax[3] : ax.length >= 2 ? ax[1] : 0;
    if (Math.abs(y) > 0.2 && (y < 0 || h.offset.elements[14] < -0.1)) h.offset.premultiply(m1.makeTranslation(0, 0, y * dt * 0.9));
  }
  m2.multiplyMatrices(frameOf(p, h, m1), h.offset);
  if (h.shift.lengthSq() > 0) m2.multiply(m3.makeTranslation(h.shift.x, h.shift.y, h.shift.z));
  m3.copy(modelGroup.matrixWorld).invert().multiply(m2).decompose(v.root.position, q1, sc);
  if (h.turn) v.root.quaternion.fromArray(S.snap ? A.squareUp(q1.toArray()) : q1.toArray()); else v.root.quaternion.fromArray(h.quat0);     // with snap on, turning clicks through 15 degree steps as you go
  n.pos = v.root.position.toArray(); n.quat = v.root.quaternion.toArray();    // kept live so the other hand can find it
}
function endHold(p) {
  const h = p.hold, other = pointers[1 - p.i];
  if (other.stretch && other.stretch.owner === p) endStretch(other);
  p.hold = null;
  const v = A.visuals.get(h.id), n = A.byId(h.id); if (!v || v !== h.v || !n) return;
  v.held = false;
  if (overBin(v.root.getWorldPosition(t2)) || overBin(p.grab)) { A.remove(h.id); pulse(p, 0.9, 70); return; }
  const dp = Math.hypot(n.pos[0] - h.pos0[0], n.pos[1] - h.pos0[1], n.pos[2] - h.pos0[2]), dq = 2 * Math.acos(Math.min(1, Math.abs(M.dot(n.quat, h.quat0) + n.quat[3] * h.quat0[3])));
  // A tap picks the part and leaves it where it was: either the part barely moved, or the press was quick and the hand
  // itself hardly moved (a part far down a ray swings a long way on a small twitch).
  const quick = performance.now() - h.t0 < 250 && p.grab.distanceTo(h.g0) < 0.02 && p.dir.angleTo(h.d0) < 0.14;
  if (!h.fresh && !h.changed && (quick || (dp < 0.002 * S.scale && dq < 0.035))) { n.pos = h.pos0; n.quat = h.quat0; A.syncVisual(v); return; }
  A.placed(h.id); pulse(p, 0.3, 20);
}

function startStretch(p, owner, kind) {
  const h = owner.hold, n = A.byId(h.id); if (!n) return;
  const d = t1.copy(p.grab).sub(owner.grab); let axis = 0, best = -1, sign = 1;
  h.v.root.updateWorldMatrix(true, false);
  for (let a = 0; a < 3; a++) { const c = d.dot(t2.setFromMatrixColumn(h.v.root.matrixWorld, a).normalize()); if (Math.abs(c) > best) { best = Math.abs(c); axis = a; sign = c < 0 ? -1 : 1; } }
  p.stretch = { owner, id: h.id, kind, axis, sign, L0: best, D0: Math.max(0.01, d.length()), size0: n.size ? [...n.size] : null, s0: n.s, shift0: h.shift.clone() };
  if (n.kind !== "group" && S.axis !== axis) { S.axis = axis; A.syncVisual(h.v); A.emit("active", S.active); }
}
function doStretch(p) {
  const st = p.stretch, h = st.owner.hold, n = A.byId(st.id);
  if (!h || h.id !== st.id || !n) { p.stretch = null; return; }
  if (!p.tracked || !st.owner.tracked) return;
  const d = t1.copy(p.grab).sub(st.owner.grab);
  if (n.kind === "group") A.edit(st.id, { s: st.s0 * clamp(d.length() / st.D0, 0.05, 20) }, { final: false });
  else {
    const step = 0.001 * S.scale, L = Math.abs(d.dot(t2.setFromMatrixColumn(h.v.root.matrixWorld, st.axis).normalize()));
    let v = st.size0[st.axis] + (L - st.L0) * S.scale; if (S.snap) v = Math.round(v / step) * step; v = Math.max(step, v);
    const size = [...st.size0]; size[st.axis] = v;
    A.edit(st.id, { size }, { final: false, axis: st.axis });
    h.shift.copy(st.shift0).setComponent(st.axis, st.shift0.getComponent(st.axis) + st.sign * (v - st.size0[st.axis]) / 2);   // the held side stays put
  }
  h.changed = true;
}
function endStretch(p) {
  const st = p.stretch; p.stretch = null; const h = st.owner.hold; if (!h || h.id !== st.id) return;
  h.offset.multiply(m1.makeTranslation(h.shift.x, h.shift.y, h.shift.z)); h.shift.set(0, 0, 0);
}

/** Compass heading of a pointer, or null when it points too steeply up or down to say. */
function heading(p) { return Math.hypot(p.dir.x, p.dir.z) < 0.35 ? null : Math.atan2(-p.dir.x, -p.dir.z); }
function moveBench(p) {
  const b = p.bench; if (!p.tracked) return;
  const now = heading(p);
  if (now !== null && b.yaw0 !== null) { let d = now - b.yaw0; d = Math.atan2(Math.sin(d), Math.cos(d)); b.turn = Math.sign(d) * Math.max(0, Math.abs(d) - 0.14); }   // small wrist wobble does not turn it
  else if (now !== null) b.yaw0 = now;
  const c = Math.cos(b.turn), s = Math.sin(b.turn), x = b.p0.x - b.h0.x, z = b.p0.z - b.h0.z;
  benchRoot.position.set(p.grab.x + x * c + z * s, clamp(b.p0.y + p.grab.y - b.h0.y, 0.3, 1.7), p.grab.z - x * s + z * c);
  benchRoot.rotation.set(0, b.r0 + b.turn, 0);
}

function pressButton(b, p) {
  const now = performance.now(); if (now - b.last < 350) return; b.last = now; b.flash = now + 170;
  for (const q of pointers) { if (q.stretch) endStretch(q); if (q.hold) endHold(q); }       // anything in a hand is set down first, so the button acts on it where it is
  pulse(p, 0.5, 30);
  switch (b.id) {
    case "undo": A.undo(); break; case "redo": A.redo(); break;
    case "copy": A.duplicate(); break;
    case "delete": if (A.byId(S.active)) A.remove(); else A.toast("Pick something to delete first."); break;
    case "hole": A.toggleHole(); break; case "fuse": A.fuse(); break; case "break": A.breakApart(); break;
    case "test": A.runTest(); break;
    case "material": A.cycleMaterial(1); break;
    case "axis": if (A.byId(S.active)) A.cycleAxis(); else A.toast("Pick a shape first."); break;
    case "minus": A.nudge(-1); break; case "plus": A.nudge(1); break;
    case "scale": A.setScale(SCALES[(SCALES.indexOf(S.scale) + 1) % SCALES.length]); break;
    case "gravity": { const k = Object.keys(ENVS); A.setEnv(k[(k.indexOf(S.env) + 1) % k.length]); break; }
    case "snap": A.setSnap(!S.snap); break;
    case "flat": A.layFlat(); break; case "drop": A.dropToBench(); break;
    case "exit": leave(); break;
    default: A.turn({ t: 0, s: 1, r: 2 }[b.id[0]], b.id.endsWith("+") ? 15 : -15);
  }
}
/** A fingertip pushed through a button presses it, no pinch needed. */
function poke(p) {
  if (!p.tracked || !p.isHand || !p.hasTip || p.hold || p.stretch || p.bench) { p.pokeZ = null; return; }
  t1.copy(p.tip); panel.worldToLocal(t1);
  if (p.pokeZ !== null && p.pokeZ > 0.006 && t1.z <= 0.006 && t1.z > -0.03) { const b = buttons.find((k) => Math.abs(t1.x - k.x) < BW / 2 && Math.abs(t1.y - k.y) < BH / 2); if (b) pressButton(b, p); }
  p.pokeZ = t1.z;
}

// ---------- every frame ----------
const hotParts = new Set(); let lastTime = 0, needPlace = 0, saved = null;
function hover() {
  for (const b of buttons) b.hot = false; for (const s of shelf) s.hot = false; let handleHot = false, binHot = false; const hot = new Set();
  for (const p of pointers) {
    const idle = p.tracked && !p.hold && !p.stretch && !p.bench, h = idle ? aimed(p) : null;
    p.line.visible = idle; p.line.scale.z = h && h.dist !== undefined ? h.dist : 0.8;
    p.dot.visible = !!(h && h.point); if (p.dot.visible) p.dot.position.copy(h.point);
    if (h) { if (h.type === "button") h.b.hot = true; else if (h.type === "shelf") h.item.hot = true; else if (h.type === "handle") handleHot = true; else hot.add(h.id); }
    const key = h ? h.key : ""; if (key !== p.hoverKey) { p.hoverKey = key; if (h && h.type !== "part") pulse(p, 0.12, 8); }
    if (p.bench) handleHot = true;
    if (p.hold && A.visuals.has(p.hold.id) && (overBin(p.grab) || overBin(p.hold.v.root.getWorldPosition(t2)))) binHot = true;
  }
  const now = performance.now();
  for (const b of buttons) { const k = now < b.flash ? 1.9 : b.hot ? 1.3 : 1; b.mesh.material.color.setScalar(k); b.mesh.position.z = now < b.flash ? -0.003 : 0; }
  for (const s of shelf) s.mesh.scale.fromArray(DEFAULT_SIZE[s.kind]).multiplyScalar(s.hot ? 1.18 : 1);
  handle.material.emissive.setHex(handleHot ? 0x1c6a70 : 0x000000); binFill.material.opacity = binHot ? 0.45 : 0.14;
  for (const id of hotParts) if (!hot.has(id)) { hotParts.delete(id); const v = A.visuals.get(id); if (v) { v.hot = false; A.syncVisual(v); } }
  for (const id of hot) if (!hotParts.has(id)) { hotParts.add(id); const v = A.visuals.get(id); if (v) { v.hot = true; if (v.edges && id !== S.active) v.edges.material.color.setHex(0xffffff); } }
}
function placeBench() {
  const cams = renderer.xr.getCamera().cameras; if (!cams || !cams.length) { if (++needPlace > 240) needPlace = 0; return; }
  const c = cams[0]; if (c.position.lengthSq() === 0 && ++needPlace < 40) return;                 // the first pose has not arrived yet
  t1.copy(c.position); if (cams[1]) t1.add(cams[1].position).multiplyScalar(0.5);
  t2.set(0, 0, -1).applyQuaternion(c.quaternion); t2.y = 0; if (t2.lengthSq() < 0.05) t2.set(0, 0, -1); t2.normalize();
  const eye = t1.y > 0.4 ? t1.y : 1.5;                                                            // bench top sits about half a metre below the eyes, seated or standing
  benchRoot.position.set(t1.x + t2.x * 0.64, clamp(eye - 0.5, 0.55, 1.15), t1.z + t2.z * 0.64);
  benchRoot.rotation.set(0, Math.atan2(-t2.x, -t2.z), 0); needPlace = 0;
}
A.onFrame((time) => {
  if (!renderer.xr.isPresenting || !xr.session) return;
  const dt = Math.min(0.1, Math.max(0, (time - lastTime) / 1000)); lastTime = time;
  if (needPlace) placeBench();
  for (const p of pointers) readPointer(p);
  for (const p of pointers) while (p.queue.length) { const [what, kind] = p.queue.shift(); if (what === "press") onPress(p, kind); else onRelease(p, kind); }
  for (const p of pointers) if (p.bench) moveBench(p);
  benchRoot.updateMatrixWorld(true);
  for (const p of pointers) if (p.stretch) doStretch(p);
  for (const p of pointers) if (p.hold) doHold(p, dt);
  for (const p of pointers) poke(p);
  hover(); paintBoard();
});
for (const ev of ["change", "active", "test", "busy"]) A.on(ev, () => { if (xr.session) { paintButtons(); paintBoard(true); } });
A.on("toast", ({ text, ms }) => { note = { text, until: performance.now() + ms }; if (xr.session) paintBoard(true); });

// ---------- going in and coming out ----------
export async function enter() {
  if (xr.session || xr.starting) return;
  if (!available()) { A.toast("This browser has no headset mode. Open this page in the Quest browser."); return; }
  const mode = xr.ar && (xr.view !== "dark" || !xr.vr) ? "immersive-ar" : "immersive-vr";
  xr.starting = true; let session = null;
  try {
    session = await navigator.xr.requestSession(mode, { requiredFeatures: ["local-floor"], optionalFeatures: ["hand-tracking"] });
    saved = { bg: scene.background, floor: A.floor.visible, cam: camera.position.clone(), target: A.orbit.target.clone(), fov: camera.fov, pos: benchRoot.position.clone(), rot: benchRoot.rotation.y };
    let over = false; session.addEventListener("end", () => { over = true; });
    session.addEventListener("end", onEnd);
    renderer.xr.setReferenceSpaceType("local-floor");
    await renderer.xr.setSession(session);
    if (over) return;                                    // it was closed again before it finished opening
    xr.session = session; xr.mode = mode;
    if (mode === "immersive-ar") { scene.background = null; A.floor.visible = false; }
    rig.visible = true; needPlace = 1; lastTime = performance.now(); boardKey = ""; for (const b of buttons) b.key = "";
    dress(); A.refreshAll(); paintButtons(); paintBoard(true); A.emit("xr", true);
  } catch (e) {
    console.warn("headset start failed", e);
    if (session) { try { await session.end(); } catch (err) { /* already ended */ } }
    A.toast("The headset view could not start: " + (e && e.message ? e.message : e), 7000);
  } finally { xr.starting = false; }
}
export function leave() { if (xr.session) xr.session.end().catch(() => {}); }
function onEnd() {
  for (const p of pointers) { p.queue.length = 0; letGo(p); p.dot.visible = false; p.hoverKey = ""; p.pokeZ = null; }
  for (const id of hotParts) { const v = A.visuals.get(id); if (v) { v.hot = false; A.syncVisual(v); } } hotParts.clear();
  xr.session = null; xr.mode = null; rig.visible = false; needPlace = 0;
  if (saved) {
    scene.background = saved.bg; A.floor.visible = saved.floor; benchRoot.position.copy(saved.pos); benchRoot.rotation.set(0, saved.rot, 0);
    camera.fov = saved.fov; camera.zoom = 1; camera.position.copy(saved.cam); A.orbit.target.copy(saved.target); camera.updateProjectionMatrix(); A.orbit.update(); saved = null;
  }
  setTimeout(() => { dispatchEvent(new Event("resize")); A.refreshAll(); }, 60);
  A.emit("xr", false);
}

/** For tests and for the curious: where things are, in world coordinates. */
export const debug = {
  pointers, shelf, buttons, rig, board, boardCanvas, handle,
  world: (o) => o.getWorldPosition(new THREE.Vector3()).toArray(),
  shelfAt: (kind) => shelf.find((s) => s.kind === kind).group.getWorldPosition(new THREE.Vector3()).toArray(),
  buttonAt: (id) => buttons.find((b) => b.id === id).mesh.getWorldPosition(new THREE.Vector3()).toArray(),
  binAt: () => benchRoot.localToWorld(BIN.c.clone()).toArray(),
  handleAt: () => handle.getWorldPosition(new THREE.Vector3()).toArray(),
  partAt: (id) => { const v = A.visuals.get(id); return v ? v.root.getWorldPosition(new THREE.Vector3()).toArray() : null; },
  panelNormal: () => new THREE.Vector3(0, 0, 1).transformDirection(panel.matrixWorld).toArray(),
};
