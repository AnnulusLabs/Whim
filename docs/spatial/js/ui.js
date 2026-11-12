// Whim Spatial Bench: the on-screen controls. Everything here calls into app.js; nothing here owns state.
import * as THREE from "three";
import * as A from "./app.js";
import * as X from "./xr.js";

const { S, M, MATERIALS, ENVS, SCALES } = A;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mm = (v) => String(+(v * 1000).toFixed(2));
const E = new THREE.Euler(), Q = new THREE.Quaternion(), DEG = 180 / Math.PI;
const narrow = () => innerWidth < 820;

// ---------- toasts ----------
function toast({ text, ms }) {
  const box = $("toasts"), el = document.createElement("div"); el.className = "toast"; el.textContent = text;
  while (box.children.length > 2) box.firstChild.remove();
  box.appendChild(el); setTimeout(() => el.remove(), ms);
}

// ---------- menus ----------
const menus = [["b-add", "m-add"], ["b-more", "m-more"]];
function closeMenus(except) { for (const [b, m] of menus) if (m !== except) { $(m).hidden = true; $(b).setAttribute("aria-expanded", "false"); } }
function toggleMenu(b, m) { const open = $(m).hidden; closeMenus(); $(m).hidden = !open; $(b).setAttribute("aria-expanded", String(open)); if (open) $(m).querySelector("button, input, select").focus({ preventScroll: true }); }

// ---------- the selected shape ----------
let panelShut = true, panelFor = "";
function angles(n) { E.setFromQuaternion(Q.fromArray(n.quat), "YXZ"); return [E.x, E.y, E.z].map((r) => String(+(r * DEG).toFixed(1))); }
function fieldValue(n, k) {
  switch (k) {
    case "sx": return mm(n.size[0]); case "sy": return mm(n.size[1]); case "sz": return mm(n.size[2]);
    case "s": return String(+(n.s * 100).toFixed(1));
    case "px": return mm(n.pos[0]); case "pz": return mm(n.pos[2]); case "lift": return mm(Math.max(0, M.aabb(n).min[1]));
    case "rx": return angles(n)[0]; case "ry": return angles(n)[1]; case "rz": return angles(n)[2];
    case "kg": return String(+n.kg);
  }
  return "";
}
function metaLine(n) {
  if (n.kind === "load") return `${+n.kg} kg pushes ${A.fmtForce(n.kg * A.env().g)} on ${A.env().name}`;
  if (n.kind === "clamp") return `${A.dimsText(n)} · holds what it touches`;
  return n.hole ? `${A.dimsText(n)} · cuts when fused` : `${A.dimsText(n)} · ${A.fmtMass(A.massOf(n))}`;
}
const num = (k, label, step = 1) => `<label>${label}<input type="number" inputmode="decimal" step="${step}" id="f-${k}" data-k="${k}"></label>`;
function buildPanel() {
  const el = $("panel"), n = A.byId(S.active);
  if (!n) { el.hidden = true; panelFor = ""; return; }
  const shape = n.kind === "prim" ? n.shape : n.kind, round = shape === "cyl" || shape === "cone", geo = M.isGeometry(n);
  const key = [n.id, shape, n.hole, n.kind === "group" ? M.countLeaves(n) : 0].join("|");
  if (key !== panelFor) {
    panelFor = key;
    const size = n.kind === "group" ? `<fieldset><legend>Size, percent of how it was fused</legend><div class="row">${num("s", "scale", 5)}</div></fieldset>`
      : `<fieldset><legend>Size, mm</legend><div class="row">${shape === "sph" ? num("sx", "across") : round ? num("sx", "across") + num("sy", "tall") : num("sx", "wide") + num("sy", "tall") + num("sz", "deep")}</div></fieldset>`;
    el.innerHTML = `<div class="p-head"><div class="p-title"><b id="p-name"></b><span id="p-meta"></span></div><button class="btn sm" id="p-toggle" aria-expanded="false" aria-controls="p-body"></button></div>
<div class="p-body" id="p-body">
${n.kind === "load" ? `<fieldset><legend>Weight, kg</legend><div class="row">${num("kg", "mass", 0.5)}</div></fieldset>` : ""}
${size}
<fieldset><legend>Place, mm from the bench centre</legend><div class="row">${num("px", "left-right")}${num("lift", "lift")}${num("pz", "front-back")}</div></fieldset>
<fieldset><legend>Turn, degrees</legend><div class="row">${num("rx", "tip", 15)}${num("ry", "spin", 15)}${num("rz", "roll", 15)}</div></fieldset>
${geo && !n.hole ? `<label class="field" for="f-mat">Material<select id="f-mat" data-k="mat">${MATERIALS.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join("")}</select></label><p class="facts" id="p-facts"></p>` : ""}
${geo ? `<label class="check" for="f-hole"><input type="checkbox" id="f-hole" data-k="hole">Make it a hole</label>` : ""}
<div class="acts">${geo ? `<button class="btn sm" data-act="fuse">Fuse touching</button>` : ""}${n.kind === "group" ? `<button class="btn sm" data-act="break">Break apart</button>` : ""}<button class="btn sm" data-act="flat">Lay flat</button><button class="btn sm" data-act="drop">Drop to bench</button><button class="btn sm" data-act="copy">Copy</button><button class="btn sm danger" data-act="delete">Delete</button></div>
</div>`;
  }
  el.hidden = false; el.classList.toggle("shut", panelShut);
  const t = $("p-toggle"); t.textContent = panelShut ? "Edit" : "Hide"; t.setAttribute("aria-expanded", String(!panelShut));
  fillPanel();
}
function fillPanel() {
  const n = A.byId(S.active); if (!n || $("panel").hidden) return;
  $("p-name").textContent = A.titleOf(n); $("p-meta").textContent = metaLine(n);
  for (const input of $("panel").querySelectorAll("[data-k]")) {
    if (input === document.activeElement && input.type === "number") continue;          // never fight the person typing
    const k = input.dataset.k;
    if (k === "mat") input.value = String(n.mat); else if (k === "hole") input.checked = !!n.hole; else input.value = fieldValue(n, k);
  }
  const facts = $("p-facts");
  if (facts) { const m = MATERIALS[n.mat]; facts.innerHTML = `stiffness ${esc(A.fmtStress(m.E))} · strength ${esc(A.fmtStress(m.S))} (${esc(m.sMeans)}) · ${m.rho} kg/m³${m.note ? `<em>${esc(m.note)}</em>` : ""}`; }
}
function applyField(input) {
  const n = A.byId(S.active), k = input.dataset.k; if (!n) return;
  if (k === "mat") return A.setMaterial(+input.value);
  if (k === "hole") return A.toggleHole();
  const v = parseFloat(input.value), a = "xyz".indexOf(k[1]);
  if (!isFinite(v)) return fillPanel();
  if (k[0] === "s" && k.length === 2) { if (v > 0) { const size = [...n.size]; size[a] = v / 1000; A.edit(n.id, { size }, { axis: a }); } }
  else if (k === "s") { if (v > 0) A.edit(n.id, { s: v / 100 }); }
  else if (k === "kg") { if (v > 0) A.edit(n.id, { kg: v }); }
  else if (k === "px" || k === "pz") { const pos = [...n.pos]; pos[a] = v / 1000; A.edit(n.id, { pos }); }
  else if (k === "lift") { const pos = [...n.pos]; pos[1] += Math.max(0, v) / 1000 - M.aabb(n).min[1]; A.edit(n.id, { pos }); }
  else if (k[0] === "r") { E.setFromQuaternion(Q.fromArray(n.quat), "YXZ"); E[k[1]] = v / DEG; A.edit(n.id, { quat: Q.setFromEuler(E).toArray() }); }
  fillPanel();
}

// ---------- the test result ----------
let resultOpen = false;
function showResult(t) {
  const el = $("result"); if (!t) { el.hidden = true; return; }
  const sf = isFinite(t.safety) ? `safety factor ${t.safety.toFixed(t.safety < 10 ? 1 : 0)}` : "no load on it";
  el.innerHTML = `<div class="verdict ${t.level}"><b>${esc(t.verdict)}</b><span>${sf}</span></div>
<dl>
<dt>Peak stress</dt><dd>${esc(A.fmtStress(t.peak))} <small>of ${esc(A.fmtStress(t.strength))} ${esc(t.sMeans)}</small></dd>
<dt>Bends</dt><dd>${esc(A.fmtLen(t.maxU))} <small>drawn ×${Math.round(t.exaggeration)}</small></dd>
<dt>Load</dt><dd>${esc(A.fmtForce(t.applied))} <small>+ ${esc(A.fmtForce(t.weight))} own weight, ${esc(ENVS[t.env].name)}</small></dd>
<dt>Material</dt><dd>${esc(t.material)}</dd>
</dl>
<div class="ramp"><i></i><span>relaxed</span><span>peak</span></div>
<p class="fine">Quick straight-line estimate on ${t.stats.cells.toLocaleString("en-US")} bricks. Treat sharp inside corners and knife edges as rough. ${t.notes.map(esc).join(" ")} Material figures are typical handbook values.${t.note ? " " + esc(t.note) : ""}${t.warnings.map((w) => `<b>${esc(w)}</b>`).join("")}</p>
<div class="split"><label class="check" for="r-bend"><input type="checkbox" id="r-bend"${A.showBending ? " checked" : ""}>Show bending</label><span class="grow"></span><button class="btn sm" id="r-more" aria-expanded="${resultOpen}">${resultOpen ? "Less" : "Details"}</button><button class="btn sm" id="r-clear">Clear</button></div>`;
  el.hidden = false; el.classList.toggle("open", resultOpen);
}

// ---------- small things ----------
function refreshBar() {
  $("summary").textContent = S.busy ? "Testing…" : A.summary();
  $("b-undo").disabled = !A.canUndo(); $("b-redo").disabled = !A.canRedo();
  $("b-test").disabled = S.busy; $("b-test").textContent = S.busy ? "Testing…" : "Test";
  $("o-snap").checked = S.snap; $("o-scale").value = String(S.scale); $("o-env").value = S.env;
}
function refreshXR() {
  const b = $("b-xr"); b.hidden = !X.available(); b.textContent = X.xr.session ? "Leave headset" : "Enter headset";
  $("o-view-row").hidden = !(X.available() && X.xr.ar && X.xr.vr); $("o-view").value = X.xr.view;
}
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); A.toast(done); }
  catch (e) { $("copybox").value = text; $("copyrow").hidden = false; $("help").hidden = false; $("copybox").focus(); $("copybox").select(); }
}
const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
function onKey(ev) {
  if (ev.key === "Escape") { if (!$("help").hidden) $("help").hidden = true; else if (!$("m-add").hidden || !$("m-more").hidden) closeMenus(); else A.setActive(null); return; }
  if (typing(document.activeElement) || !$("help").hidden) return;
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase(), n = A.byId(S.active), step = 0.001 * S.scale * (ev.shiftKey ? 10 : 1);
  const move = (dx, dy, dz) => { if (!n) return; A.edit(n.id, { pos: [n.pos[0] + dx, n.pos[1] + dy, n.pos[2] + dz] }); };
  if (mod && k === "z") { ev.shiftKey ? A.redo() : A.undo(); }
  else if (mod && k === "y") A.redo();
  else if (mod && k === "d") A.duplicate();
  else if (mod) return;
  else if (k === "delete" || k === "backspace") { if (n) A.remove(); }
  else if (k === "home" || k === "0") A.fitView();
  else if (k === "h") A.toggleHole(); else if (k === "f") A.fuse(); else if (k === "b") A.breakApart(); else if (k === "t") A.runTest();
  else if (k === "arrowleft") move(-step, 0, 0); else if (k === "arrowright") move(step, 0, 0);
  else if (k === "arrowup") move(0, 0, -step); else if (k === "arrowdown") move(0, 0, step);
  else if (k === "pageup") move(0, step, 0); else if (k === "pagedown") move(0, -step, 0);
  else if (k === "[" || k === "]") { if (n) { E.setFromQuaternion(Q.fromArray(n.quat), "YXZ"); E.y += (k === "[" ? 1 : -1) * Math.PI / 12; A.edit(n.id, { quat: Q.setFromEuler(E).toArray() }); } }
  else return;
  ev.preventDefault();
}

export function initUI() {
  $("o-scale").innerHTML = SCALES.map((s) => `<option value="${s}">1:${s}${s === 1 ? " (life size)" : ""}</option>`).join("");
  $("o-env").innerHTML = Object.entries(ENVS).map(([k, e]) => `<option value="${k}">${e.name}, ${e.g.toFixed(2)} m/s²</option>`).join("");
  if (A.EMBED) { $("a-3mf").firstChild.textContent = "Export for printing"; $("a-3mf").querySelector("small").textContent = "zip with 3MF and STL"; $("a-stl").hidden = true; }
  panelShut = narrow();

  for (const [b, m] of menus) $(b).addEventListener("click", (ev) => { ev.stopPropagation(); toggleMenu(b, m); });
  document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest(".menu, #tools")) closeMenus(); if (!$("help").hidden && !ev.target.closest("#help, .menu")) $("help").hidden = true; });
  $("m-add").addEventListener("click", (ev) => { const b = ev.target.closest("[data-add]"); if (!b) return; closeMenus(); A.spawn(b.dataset.add); });
  $("b-undo").addEventListener("click", A.undo); $("b-redo").addEventListener("click", A.redo);
  $("b-test").addEventListener("click", () => { closeMenus(); A.runTest(); });
  $("b-lift").addEventListener("click", () => { A.pointerOpt.lift = !A.pointerOpt.lift; $("b-lift").setAttribute("aria-pressed", String(A.pointerOpt.lift)); A.toast(A.pointerOpt.lift ? "Lift is on: dragging a shape raises and lowers it." : "Lift is off: dragging a shape slides it along the bench.", 2600); });
  $("b-xr").addEventListener("click", () => (X.xr.session ? X.leave() : X.enter()));

  $("o-snap").addEventListener("change", (ev) => A.setSnap(ev.target.checked));
  $("o-scale").addEventListener("change", (ev) => A.setScale(+ev.target.value));
  $("o-env").addEventListener("change", (ev) => A.setEnv(ev.target.value));
  $("o-view").addEventListener("change", (ev) => X.setView(ev.target.value));
  const act = (id, fn) => $(id).addEventListener("click", () => { closeMenus(); fn(); });
  act("a-3mf", () => A.exportModel("3mf")); act("a-stl", () => A.exportModel("stl")); act("a-save", () => A.saveFile());
  act("a-open", () => $("file").click());
  act("a-record", async () => { const r = await A.record(); copyText(JSON.stringify({ ...r.body, seal: r.hash }, null, 1), "Record copied. The seal changes if any number in it is edited."); });
  act("a-example", () => { A.loadExample(); A.toast("The example bracket is back. Press Test to see it carry 5 kg."); });
  act("a-clear", () => { A.clearBench(); A.toast("Bench cleared. Undo brings it back."); });
  act("a-fit", () => A.fitView());
  act("a-help", () => { $("copyrow").hidden = true; $("help").hidden = false; $("help-x").focus(); });
  $("help-x").addEventListener("click", () => { $("help").hidden = true; });
  $("file").addEventListener("change", async (ev) => { const f = ev.target.files[0]; ev.target.value = ""; if (f) A.openFile(await f.text()); });

  $("panel").addEventListener("change", (ev) => { if (ev.target.dataset.k) applyField(ev.target); });
  $("panel").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.dataset.k) ev.target.blur(); });
  $("panel").addEventListener("click", (ev) => {
    if (ev.target.closest("#p-toggle")) { panelShut = !panelShut; return buildPanel(); }
    const b = ev.target.closest("[data-act]"); if (!b) return;
    ({ fuse: A.fuse, break: A.breakApart, copy: A.duplicate, delete: A.remove, flat: A.layFlat, drop: A.dropToBench })[b.dataset.act]();
  });
  $("result").addEventListener("click", (ev) => {
    if (ev.target.closest("#r-clear")) A.clearTest();
    else if (ev.target.closest("#r-more")) { resultOpen = !resultOpen; showResult(S.test); }
  });
  $("result").addEventListener("change", (ev) => { if (ev.target.id === "r-bend") A.setBending(ev.target.checked); });
  addEventListener("keydown", onKey);
  addEventListener("resize", () => { if (!narrow()) panelShut = false; buildPanel(); });

  A.on("toast", toast);
  A.on("active", () => { buildPanel(); refreshBar(); });
  A.on("change", () => { buildPanel(); refreshBar(); });
  A.on("live", fillPanel);
  A.on("busy", refreshBar);
  A.on("test", showResult);
  A.on("xr", refreshXR);
  A.on("ready", () => { refreshBar(); buildPanel(); });
  refreshBar(); refreshXR();
}
export { refreshXR };
