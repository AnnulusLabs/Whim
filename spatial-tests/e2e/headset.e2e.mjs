// Headset-mode end-to-end test: Whim Spatial Bench driven through an emulated Meta Quest 3 (IWER).
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
// Playwright and IWER are not project dependencies. Install them beside the repo (see ../README.md) or point at them:
//   WHIM_PLAYWRIGHT=/path/to/playwright/index.mjs  WHIM_IWER=/path/to/iwer/build/iwer.min.js  WHIM_E2E_OUT=/where/screenshots/go
const { chromium } = await import(process.env.WHIM_PLAYWRIGHT || 'playwright');
const ROOT = fileURLToPath(new URL('../../docs/spatial', import.meta.url)), OUT = (process.env.WHIM_E2E_OUT || path.join(os.tmpdir(), 'whim-e2e')) + path.sep;
mkdirSync(OUT, { recursive: true });
const IWER = process.env.WHIM_IWER || createRequire(import.meta.url).resolve('iwer/build/iwer.min.js');
const results = []; const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== '' ? '   [' + info + ']' : '')); };
const srv = serve(ROOT, 8940), browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
await ctx.addInitScript({ path: IWER });
await ctx.addInitScript(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); window.xrd = d; });
const pg = await ctx.newPage(), errs = [];
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
await pg.goto('http://localhost:8940/?nosw');
await pg.waitForFunction(() => window.whim && whim.A.kernelReady(), null, { timeout: 40000 });
await pg.evaluate(() => {
  const V = (a) => new whim.THREE.Vector3(...a);
  window.T = {
    frames: (n = 4) => new Promise((res) => { let c = 0; const tick = () => (++c >= n ? res() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    P: (hand) => whim.X.debug.pointers.find((p) => p.source && p.source.handedness === hand),
    place(hand, at, quat = [0, 0, 0, 1]) { const c = xrd.controllers[hand]; c.position.set(...at); c.quaternion.set(...quat); },
    aim(hand, from, at) { const { THREE } = whim, q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(V(from), V(at), V([0, 1, 0]))); T.place(hand, from, [q.x, q.y, q.z, q.w]); },
    down: (hand, id = 'trigger') => xrd.controllers[hand].updateButtonValue(id, 1), up: (hand, id = 'trigger') => xrd.controllers[hand].updateButtonValue(id, 0),
    async click(hand, id = 'trigger') { T.down(hand, id); await T.frames(4); T.up(hand, id); await T.frames(4); },
    // press a button on the bench's front panel by pointing at it from 14 cm out along the panel's normal
    async button(name, hand = 'right') { const at = whim.X.debug.buttonAt(name), n = whim.X.debug.panelNormal(); T.aim(hand, [at[0] + n[0] * 0.14, at[1] + n[1] * 0.14, at[2] + n[2] * 0.14], at); await T.frames(4); await T.click(hand); await T.wait(380); },
    node: (id) => JSON.parse(JSON.stringify(whim.A.byId(id))), nodes: () => JSON.parse(JSON.stringify(whim.S.nodes)),
    world: (id) => whim.X.debug.partAt(id), bench: () => ({ pos: whim.A.benchRoot.position.toArray(), rot: whim.A.benchRoot.rotation.y }),
    up90: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],              // controller pointing straight up, so its ray lands on nothing
  };
});
const ev = (fn, arg) => pg.evaluate(fn, arg), near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- A. going in ----------
const ui = await ev(() => ({ shown: !document.getElementById('b-xr').hidden, text: document.getElementById('b-xr').textContent, ar: whim.X.xr.ar, vr: whim.X.xr.vr, ua: navigator.userAgent.includes('Quest') }));
check('the page offers Enter headset on a Quest', ui.shown && ui.ar && ui.vr && ui.ua, JSON.stringify(ui));
await pg.click('#b-xr'); await pg.waitForFunction(() => whim.X.xr.session && whim.A.renderer.xr.isPresenting, null, { timeout: 15000 }); await ev(() => T.frames(12));
let s = await ev(() => ({ mode: whim.X.xr.mode, bg: whim.A.scene.background, rig: whim.X.debug.rig.visible, bench: T.bench(), head: [xrd.position.x, xrd.position.y, xrd.position.z], src: whim.X.debug.pointers.map((p) => p.source && p.source.handedness + (p.isHand ? ':hand' : ':ctl') + (p.tracked ? ':tracked' : '')), text: document.getElementById('b-xr').textContent,
  board: (() => { const c = whim.X.debug.boardCanvas.getContext('2d').getImageData(0, 0, 1024, 512).data; let n = 0; for (let i = 3; i < c.length; i += 4) if (c[i] > 0) n++; return n; })() }));
check('session starts in passthrough with the bench furniture up', s.mode === 'immersive-ar' && s.bg === null && s.rig && s.board > 100000 && s.text === 'Leave headset', `${s.mode}, board pixels ${s.board}`);
check('bench is put in front of the wearer, top half a metre below the eyes', near(s.bench.pos[0], 0, 1e-6) && near(s.bench.pos[1], s.head[1] - 0.5, 1e-6) && near(s.bench.pos[2], -0.64, 1e-6) && near(s.bench.rot, 0, 1e-6), JSON.stringify(s.bench));
check('both controllers are connected and tracked', s.src.filter((x) => x && x.endsWith(':ctl:tracked')).length === 2, JSON.stringify(s.src));
await pg.screenshot({ path: OUT + 'xr-start.png' });
const B = s.bench.pos;                                   // bench origin in the room; bench rotation is 0 so model = room - B

// ---------- B. take a box off the shelf by pointing, put it down ----------
let before = await ev(() => whim.S.nodes.length);
await ev(async () => { T.aim('right', [-0.3, 1.4, -0.2], whim.X.debug.shelfAt('box')); await T.frames(5); });
s = await ev(() => { const p = T.P('right'); return { o: p.origin.toArray(), hover: p.hoverKey }; });
check('controller pose reaches the app and the ray finds the shelf', near(s.o[0], -0.3, 1e-4) && near(s.o[1], 1.4, 1e-4) && s.hover === 'sbox', JSON.stringify(s));
await ev(async () => { T.down('right'); await T.frames(5); });
s = await ev(() => { const p = T.P('right'), n = whim.S.nodes[whim.S.nodes.length - 1]; return { count: whim.S.nodes.length, hold: p.hold && p.hold.id, fresh: p.hold && p.hold.fresh, kind: n.kind + ':' + n.shape, at: T.world(n.id), active: whim.S.active }; });
check('pressing on the shelf puts a new box in the hand', s.count === before + 1 && s.hold && s.fresh && s.kind === 'prim:box' && near(s.at[0], -0.3, 2e-3) && near(s.at[1], 1.4, 2e-3) && near(s.at[2], -0.2, 2e-3) && s.active === s.hold, JSON.stringify(s));
const box = s.hold;
await ev(async ([B]) => { T.place('right', [B[0] + 0.25, B[1] + 0.1, B[2] + 0.15], T.up90); await T.frames(5); T.up('right'); await T.frames(5); }, [B]);
s = await ev((id) => ({ n: T.node(id), hold: !!T.P('right').hold, undo: whim.A.canUndo() }), box);
check('letting go places it there, squared up and on the millimetre', !s.hold && near(s.n.pos[0], 0.25, 1.01e-3) && near(s.n.pos[1], 0.1, 1.01e-3) && near(s.n.pos[2], 0.15, 1.01e-3) && Math.abs(s.n.quat[3]) > 0.9999 && s.undo, s.n.pos.map((v) => (v * 1000).toFixed(2)).join(', ') + ' mm, quat ' + s.n.quat.map((v) => v.toFixed(3)).join(','));

// ---------- C. stretch with the second hand ----------
let n0 = s.n;
await ev(async ([B, p]) => { T.place('right', [B[0] + p[0], B[1] + p[1], B[2] + p[2]], T.up90); T.place('left', [B[0] + p[0] - 0.12, B[1] + p[1], B[2] + p[2]], T.up90); await T.frames(5); T.down('right'); await T.frames(5); T.down('left'); await T.frames(5); }, [B, n0.pos]);
s = await ev(() => ({ hold: !!T.P('right').hold, far: T.P('right').hold && T.P('right').hold.far, st: T.P('left').stretch && { axis: T.P('left').stretch.axis, sign: T.P('left').stretch.sign } }));
check('holding with one hand and pressing with the other starts a stretch along the line between the hands', s.hold && s.far === false && s.st && s.st.axis === 0 && s.st.sign === -1, JSON.stringify(s));
await ev(async ([B, p]) => { T.place('left', [B[0] + p[0] - 0.17, B[1] + p[1], B[2] + p[2]], T.up90); await T.frames(6); }, [B, n0.pos]);
s = await ev((id) => ({ size: T.node(id).size, label: whim.A.visuals.get(id).label.userData.key }), box);
check('pulling the hands 50 mm apart makes it 50 mm longer, shown live', near(s.size[0], 0.11, 1e-6) && /\[110\]/.test(s.label), (s.size[0] * 1000).toFixed(2) + ' mm; ' + s.label.slice(10, 50));
await ev(async () => { T.up('left'); await T.frames(4); T.up('right'); await T.frames(5); });
s = await ev((id) => T.node(id), box);
check('the side in the holding hand stayed where it was', near(s.size[0], 0.11, 1e-6) && near(s.pos[0] + s.size[0] / 2, n0.pos[0] + 0.03, 1.01e-3) && near(s.size[1], 0.04, 1e-9), `far face at ${((s.pos[0] + s.size[0] / 2) * 1000).toFixed(2)} mm, was ${((n0.pos[0] + 0.03) * 1000).toFixed(2)} mm`);

// ---------- C2. the other hand's ray happens to point at the shelf: still a stretch, not a new shape ----------
before = await ev(() => whim.S.nodes.length);
await ev(async ([B, id]) => { const p = T.node(id).pos, at = [B[0] + p[0], B[1] + p[1], B[2] + p[2]]; T.place('right', at, T.up90); T.aim('left', [at[0] - 0.14, at[1], at[2]], whim.X.debug.shelfAt('cyl')); await T.frames(5); T.down('right'); await T.frames(5); T.down('left'); await T.frames(5); }, [B, box]);
s = await ev(() => ({ count: whim.S.nodes.length, stretch: !!T.P('left').stretch, hover: T.P('left').hoverKey }));
await ev(async () => { T.up('left'); await T.frames(4); T.up('right'); await T.frames(5); });
check('second hand pointing toward the shelf still stretches instead of taking a new shape', s.count === before && s.stretch, JSON.stringify(s));
// ---------- C3. a button pressed while a part is in the other hand: the part is set down where it is, then the button acts ----------
n0 = await ev((id) => T.node(id), box);
await ev(async ([B, p]) => { T.place('right', [B[0] + p[0], B[1] + p[1], B[2] + p[2]], T.up90); await T.frames(5); T.down('right'); await T.frames(5); T.place('right', [B[0] + p[0] + 0.05, B[1] + p[1], B[2] + p[2]], T.up90); await T.frames(5); await T.button('hole', 'left'); }, [B, n0.pos]);
s = await ev((id) => ({ n: T.node(id), hold: !!T.P('right').hold }), box);
await ev(async () => { T.up('right'); await T.frames(5); await T.button('hole', 'left'); });
{ const after = await ev((id) => T.node(id), box);
  check('pressing a button while holding sets the part down first, then acts on it', !s.hold && s.n.hole === true && near(s.n.pos[0], n0.pos[0] + 0.05, 1.01e-3) && after.hole === false && near(after.pos[0], s.n.pos[0], 1e-9), `moved ${((s.n.pos[0] - n0.pos[0]) * 1000).toFixed(1)} mm, hole ${s.n.hole} then ${after.hole}`); }

// ---------- D. grip button: carry and turn; snap squares it to 15 degrees ----------
n0 = await ev((id) => T.node(id), box);
await ev(async ([B, p]) => { const q = new whim.THREE.Quaternion().setFromAxisAngle(new whim.THREE.Vector3(0, 1, 0), 0); T.place('right', [B[0] + p[0], B[1] + p[1], B[2] + p[2]], [q.x, q.y, q.z, q.w]); await T.frames(5); T.down('right', 'squeeze'); await T.frames(5);
  const r = new whim.THREE.Quaternion().setFromAxisAngle(new whim.THREE.Vector3(0, 1, 0), 40 * Math.PI / 180); T.place('right', [B[0] + p[0], B[1] + p[1] + 0.05, B[2] + p[2] - 0.1], [r.x, r.y, r.z, r.w]); await T.frames(6); T.up('right', 'squeeze'); await T.frames(5); }, [B, n0.pos]);
s = await ev((id) => T.node(id), box);
{ const ang = 2 * Math.atan2(s.quat[1], s.quat[3]) * 180 / Math.PI;
  check('grip button carries a part; a 40 degree turn snaps to 45', near(s.pos[2], n0.pos[2] - 0.1, 1.5e-3) && near(s.pos[1], n0.pos[1] + 0.05, 1.5e-3) && near(ang, 45, 0.01) && Math.abs(s.quat[0]) < 1e-6 && Math.abs(s.quat[2]) < 1e-6, `moved to ${s.pos.map((v) => (v * 1000).toFixed(1)).join(', ')} mm, turned ${ang.toFixed(2)} deg`); }

// ---------- E. a tap picks without moving ----------
before = await ev(() => JSON.stringify(whim.S.nodes));
await ev(async ([B]) => { T.aim('right', [B[0] + 0.1, B[1] + 0.35, B[2] + 0.4], [B[0], B[1] + 0.105, B[2] + 0.12]); await T.frames(5); await T.click('right'); }, [B]);
s = await ev(() => ({ active: whim.S.active, same: JSON.stringify(whim.S.nodes) }));
check('a tap from across the bench selects the bracket and moves nothing', s.active === 5 && s.same === before);

// ---------- F. the buttons ----------
await ev(async () => { await T.button('test'); }); await pg.waitForFunction(() => whim.S.test && !whim.S.busy, null, { timeout: 90000 }); await ev(() => T.frames(6));
s = await ev(() => ({ v: whim.S.test.verdict, sf: whim.S.test.safety, cells: whim.S.test.stats.cells, ms: whim.S.test.stats.ms }));
check('Test button runs the stress test on the selected part', s.v === 'Holds' && s.sf > 5, `${s.v}, SF ${s.sf.toFixed(1)}, ${s.cells} bricks in ${s.ms} ms`);
await pg.screenshot({ path: OUT + 'xr-result.png' });
await ev(async (id) => { whim.A.setActive(id); await T.button('hole'); }, box); const h1 = await ev((id) => T.node(id).hole, box);
await ev(async () => { await T.button('hole'); }); const h2 = await ev((id) => T.node(id).hole, box);
check('Hole button toggles the selected shape', h1 === true && h2 === false);
await ev(async () => { await T.button('material'); }); s = await ev((id) => ({ mat: T.node(id).mat, face: whim.X.debug.buttons.find((b) => b.id === 'material').key }), box);
check('Material button steps to the next material and shows its name', s.mat === 5 && /PETG/.test(s.face), s.face);
await ev(async () => { await T.button('axis'); await T.button('plus'); await T.button('plus'); await T.button('minus'); }); s = await ev((id) => ({ size: T.node(id).size, axis: whim.S.axis }), box);
check('Side, + and - change one dimension a millimetre at a time', s.axis === 1 && near(s.size[1], 0.041, 1e-9) && near(s.size[0], 0.11, 1e-9), `axis ${s.axis}, ${s.size.map((v) => (v * 1000).toFixed(1)).join(' x ')}`);
await ev(async () => { await T.button('spin+'); await T.button('spin+'); await T.button('tip-'); }); s = await ev((id) => T.node(id).quat, box);
{ const { x, y, z, w } = { x: s[0], y: s[1], z: s[2], w: s[3] }, spinOnly = 2 * Math.atan2(y, w) * 180 / Math.PI;
  check('Spin and Tip buttons turn the part in 15 degree steps', Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-9 && Math.abs(x) > 0.05, `quat ${s.map((v) => v.toFixed(3)).join(', ')}`); }
await ev(async () => { await T.button('flat'); await T.button('drop'); }); s = await ev((id) => ({ n: T.node(id), low: whim.A.M.aabb(whim.A.byId(id)).min[1] }), box);
check('Flat squares the part up and Drop sets it on the bench', Math.abs(s.n.quat[3]) > 0.999999 && Math.abs(s.low) < 1e-9, `quat w ${s.n.quat[3].toFixed(4)}, lowest point ${(s.low * 1000).toFixed(3)} mm`);
before = await ev(() => whim.S.nodes.length);
await ev(async () => { await T.button('copy'); }); const c1 = await ev(() => whim.S.nodes.length);
await ev(async () => { await T.button('delete'); }); const c2 = await ev(() => whim.S.nodes.length);
await ev(async () => { await T.button('undo'); }); const c3 = await ev(() => whim.S.nodes.length);
await ev(async () => { await T.button('redo'); }); const c4 = await ev(() => whim.S.nodes.length);
check('Copy, Delete, Undo, Redo', c1 === before + 1 && c2 === before && c3 === before + 1 && c4 === before, [before, c1, c2, c3, c4].join(' > '));
await ev(async () => { await T.button('gravity'); await T.button('snap'); await T.button('scale'); }); s = await ev(() => ({ env: whim.S.env, snap: whim.S.snap, scale: whim.S.scale, faces: whim.X.debug.buttons.filter((b) => ['gravity', 'snap', 'scale'].includes(b.id)).map((b) => JSON.parse(b.key).text + '/' + JSON.parse(b.key).sub).join(' ') }));
check('Gravity, Snap and Scale buttons step their settings and relabel', s.env === 'mars' && s.snap === false && s.scale === 2, s.faces);

// ---------- G. at 1:2 scale a shelf shape is the same size in the hand and twice the size in the model ----------
await ev(async ([B]) => { T.aim('left', [-0.2, 1.4, -0.2], whim.X.debug.shelfAt('cyl')); await T.frames(5); T.down('left'); await T.frames(5); T.place('left', [B[0] - 0.3, B[1] + 0.1, B[2] + 0.2], T.up90); await T.frames(5); T.up('left'); await T.frames(5); }, [B]);
s = await ev(() => { const n = whim.S.nodes[whim.S.nodes.length - 1]; return { n: JSON.parse(JSON.stringify(n)), w: T.world(n.id) }; });
check('scale 1:2: shelf cylinder is 80 x 120 mm in the model and sits where the hand left it', s.n.shape === 'cyl' && near(s.n.size[0], 0.08, 1e-9) && near(s.n.size[1], 0.12, 1e-9) && near(s.w[0], B[0] - 0.3, 2e-3) && near(s.w[2], B[2] + 0.2, 2e-3), `size ${s.n.size.map((v) => v * 1000).join(' x ')} mm, room pos ${s.w.map((v) => v.toFixed(3)).join(', ')}`);
const cyl = s.n.id;
await ev(async () => { whim.A.setScale(1); whim.A.setEnv('earth'); whim.A.setSnap(true); await T.frames(4); });

// ---------- H. two boxes pushed together and fused; snap closes a 2 mm gap ----------
s = await ev((id) => T.node(id), box);
await ev(async ([id]) => { whim.A.edit(id, { quat: [0, 0, 0, 1], size: [0.06, 0.04, 0.04], pos: [0.3, 0.02, 0.2] }); await T.frames(3); }, [box]);
await ev(async ([B]) => { T.aim('right', [-0.3, 1.4, -0.2], whim.X.debug.shelfAt('box')); await T.frames(5); T.down('right'); await T.frames(5); T.place('right', [B[0] + 0.3 + 0.062, B[1] + 0.0215, B[2] + 0.2005], T.up90); await T.frames(5); T.up('right'); await T.frames(5); }, [B]);
s = await ev(() => { const n = whim.S.nodes[whim.S.nodes.length - 1]; return { id: n.id, pos: n.pos }; });
check('snap pulls a shape flush against its neighbour and the bench', near(s.pos[0], 0.36, 1e-9) && near(s.pos[1], 0.02, 1e-9) && near(s.pos[2], 0.2, 1.01e-3), s.pos.map((v) => (v * 1000).toFixed(2)).join(', ') + ' mm');
before = await ev(() => whim.S.nodes.length);
await ev(async () => { await T.button('fuse'); }); s = await ev(() => { const n = whim.A.byId(whim.S.active); return { count: whim.S.nodes.length, kind: n.kind, leaves: whim.A.M.countLeaves(n), vol: whim.A.volumeOf(n), id: n.id }; });
check('Fuse button joins the two touching boxes', s.count === before - 1 && s.kind === 'group' && s.leaves === 2 && near(s.vol, 2 * 0.06 * 0.04 * 0.04, 1e-9), `${s.leaves} shapes, ${(s.vol * 1e9).toFixed(0)} mm3`);
const fused = s.id;

// ---------- I. reel a far part in with the thumbstick ----------
await ev(async ([B, id]) => { const w = T.world(id); T.aim('right', [w[0] - 0.05, w[1] + 0.3, w[2] + 0.35], w); await T.frames(5); T.down('right'); await T.frames(5); }, [B, fused]);
s = await ev((id) => ({ far: T.P('right').hold && T.P('right').hold.far, d0: new whim.THREE.Vector3(...T.world(id)).distanceTo(T.P('right').origin) }), fused);
await ev(async () => { xrd.controllers.right.updateAxes('thumbstick', 0, 1); await T.wait(450); xrd.controllers.right.updateAxes('thumbstick', 0, 0); await T.frames(4); });
const d1 = await ev((id) => new whim.THREE.Vector3(...T.world(id)).distanceTo(T.P('right').origin), fused);
check('thumbstick pulls a far-held part toward the hand', s.far === true && d1 < s.d0 - 0.05, `${s.d0.toFixed(3)} m -> ${d1.toFixed(3)} m`);

// ---------- J. drop it in the bin ----------
before = await ev(() => whim.S.nodes.length);
await ev(async () => { const b = whim.X.debug.binAt(), p = T.P('right'), w = T.world(p.hold.id), o = p.origin.toArray(); T.place('right', [o[0] + b[0] - w[0], o[1] + b[1] - w[1], o[2] + b[2] - w[2]], [xrd.controllers.right.quaternion.x, xrd.controllers.right.quaternion.y, xrd.controllers.right.quaternion.z, xrd.controllers.right.quaternion.w]); await T.frames(6); T.up('right'); await T.frames(5); });
s = await ev((id) => ({ count: whim.S.nodes.length, gone: !whim.A.byId(id) }), fused);
check('letting go over the red bin deletes the part', s.count === before - 1 && s.gone);

// ---------- K. move and turn the whole bench by its knob ----------
await ev(async () => { const h = whim.X.debug.handleAt(); T.place('right', [h[0], h[1], h[2] + 0.01]); await T.frames(5); T.down('right'); await T.frames(4); T.place('right', [h[0] + 0.1, h[1] + 0.05, h[2] + 0.03]); await T.frames(6); });
s = await ev(() => T.bench());
check('the knob carries the bench with the hand', near(s.pos[0], B[0] + 0.1, 1e-4) && near(s.pos[1], B[1] + 0.05, 1e-4) && near(s.pos[2], B[2] + 0.02, 1e-4) && near(s.rot, 0, 1e-6), JSON.stringify(s));
await ev(async () => { const c = xrd.controllers.right, q = new whim.THREE.Quaternion().setFromAxisAngle(new whim.THREE.Vector3(0, 1, 0), 30 * Math.PI / 180); c.quaternion.set(q.x, q.y, q.z, q.w); await T.frames(6); });
s = await ev(() => ({ b: T.bench(), handle: whim.X.debug.handleAt(), hand: T.P('right').origin.toArray() }));
check('turning the wrist turns the bench about the hand', near(s.b.rot, (30 - 0.14 * 180 / Math.PI) * Math.PI / 180, 1e-3) && Math.hypot(s.handle[0] - s.hand[0], s.handle[2] - s.hand[2]) < 0.012, `turned ${(s.b.rot * 180 / Math.PI).toFixed(1)} deg, knob ${(Math.hypot(s.handle[0] - s.hand[0], s.handle[2] - s.hand[2]) * 1000).toFixed(1)} mm from the hand`);
await ev(async ([B]) => { T.up('right'); await T.frames(4); whim.A.benchRoot.position.set(...B); whim.A.benchRoot.rotation.set(0, 0, 0); await T.frames(4); }, [B]);

// ---------- L. tracked hands: pinch to carry, fingertip to press ----------
await ev(async () => { T.place('right', [0.3, 1.5, 0.3], T.up90); T.place('left', [-0.3, 1.5, 0.3], T.up90); xrd.primaryInputMode = 'hand'; await T.frames(8); });
s = await ev(() => whim.X.debug.pointers.map((p) => p.source && p.source.handedness + (p.isHand ? ':hand' : ':ctl')));
check('switching to hands is picked up', s.filter((x) => x && x.endsWith(':hand')).length === 2, JSON.stringify(s));
n0 = await ev((id) => T.node(id), cyl);
await ev(async ([id]) => { const w = T.world(id); xrd.hands.right.setPin({ anchor: 'grasp', target: [w[0], w[1], w[2]] }); xrd.hands.left.setPin({ anchor: 'grasp', target: [-0.5, 1.6, 0.4] }); await T.frames(6); xrd.hands.right.updatePinchValue(1); await T.frames(6); }, [cyl]);
s = await ev(() => { const p = T.P('right'); return { hold: p.hold && p.hold.id, frame: p.hold && p.hold.frame, tip: p.hasTip, grab: p.grab.toArray() }; });
check('a pinch inside a part takes hold of it', s.hold === cyl && s.frame === 'pinch' && s.tip, JSON.stringify(s));
await ev(async ([id]) => { const w = T.world(id); xrd.hands.right.setPin({ anchor: 'grasp', target: [w[0] + 0.08, w[1] + 0.03, w[2]] }); await T.frames(8); xrd.hands.right.updatePinchValue(0); await T.frames(6); }, [cyl]);
s = await ev((id) => T.node(id), cyl);
check('the part follows the pinch and is placed on release', near(s.pos[0], n0.pos[0] + 0.08, 2.5e-3) && near(s.pos[1], n0.pos[1] + 0.03, 2.5e-3) && near(s.pos[2], n0.pos[2], 2.5e-3), `moved ${((s.pos[0] - n0.pos[0]) * 1000).toFixed(1)}, ${((s.pos[1] - n0.pos[1]) * 1000).toFixed(1)}, ${((s.pos[2] - n0.pos[2]) * 1000).toFixed(1)} mm`);
before = await ev(() => whim.S.snap);
await ev(async () => { const at = whim.X.debug.buttonAt('snap'), n = whim.X.debug.panelNormal(), pt = (d) => [at[0] + n[0] * d, at[1] + n[1] * d, at[2] + n[2] * d]; xrd.hands.right.setPin({ anchor: 'index-tip', target: pt(0.03) }); await T.frames(6); xrd.hands.right.setPin({ anchor: 'index-tip', target: pt(-0.008) }); await T.frames(6); xrd.hands.right.setPin({ anchor: 'index-tip', target: pt(0.05) }); await T.frames(6); });
s = await ev(() => whim.S.snap);
check('a fingertip pushed through a button presses it', s === !before);
await pg.screenshot({ path: OUT + 'xr-hands.png' });
// hand ray + pinch on the shelf from a distance
before = await ev(() => whim.S.nodes.length);
await ev(async () => { xrd.hands.right.setPin(null); const at = whim.X.debug.shelfAt('sph'), { THREE } = whim, from = [0.15, 1.35, -0.25], q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(...at), new THREE.Vector3(0, 1, 0))); xrd.hands.right.position.set(...from); xrd.hands.right.quaternion.set(q.x, q.y, q.z, q.w); await T.frames(8); });
s = await ev(() => T.P('right').hoverKey);
await ev(async () => { xrd.hands.right.updatePinchValue(1); await T.frames(6); xrd.hands.right.updatePinchValue(0); await T.frames(6); });
const after = await ev(() => ({ count: whim.S.nodes.length, last: whim.S.nodes[whim.S.nodes.length - 1].shape }));
check('pointing a hand at the shelf and pinching makes a sphere', s === 'ssph' && after.count === before + 1 && after.last === 'sph', `hover ${s}`);

// ---------- M. coming out, and going back in ----------
await ev(async () => { xrd.primaryInputMode = 'controller'; await T.frames(8); await T.button('exit'); await T.wait(300); });
s = await ev(() => ({ session: !!whim.X.xr.session, presenting: whim.A.renderer.xr.isPresenting, rig: whim.X.debug.rig.visible, bg: whim.A.scene.background && whim.A.scene.background.isColor, bench: T.bench(), cam: whim.A.camera.position.toArray(), fov: whim.A.camera.fov, canvas: [whim.A.renderer.domElement.clientWidth, whim.A.renderer.domElement.clientHeight, innerWidth, innerHeight], text: document.getElementById('b-xr').textContent, held: [...whim.A.visuals.values()].some((v) => v.held) }));
check('Exit button ends the session and the screen view comes back as it was', !s.session && !s.presenting && !s.rig && s.bg && near(s.bench.pos[1], 0.75, 1e-9) && near(s.bench.pos[2], -0.6, 1e-9) && s.fov === 50 && s.canvas[0] === s.canvas[2] && s.canvas[1] === s.canvas[3] && s.text === 'Enter headset' && !s.held, JSON.stringify({ bench: s.bench, fov: s.fov, canvas: s.canvas }));
await pg.waitForTimeout(300); await pg.screenshot({ path: OUT + 'xr-after.png' });
await pg.click('#b-xr'); await pg.waitForFunction(() => whim.X.xr.session && whim.A.renderer.xr.isPresenting, null, { timeout: 15000 }); await ev(() => T.frames(10));
before = await ev(() => whim.S.nodes.length);
await ev(async () => { T.aim('right', [0.2, 1.4, -0.2], whim.X.debug.shelfAt('wedge')); await T.frames(5); T.down('right'); await T.frames(5); T.place('right', [0.1, 1.25, -0.4], T.up90); await T.frames(5); T.up('right'); await T.frames(5); });
s = await ev(() => ({ count: whim.S.nodes.length, last: whim.S.nodes[whim.S.nodes.length - 1].shape, rig: whim.X.debug.rig.visible }));
check('a second session works like the first', s.count === before + 1 && s.last === 'wedge' && s.rig);
await ev(async () => { whim.X.leave(); await T.wait(300); });
// what was built in the headset is still there on the page, and saved
s = await ev(() => ({ n: whim.S.nodes.length, saved: JSON.parse(localStorage.getItem('whim.spatial.v2')).nodes.length, summary: whim.A.summary() }));
check('work done in the headset is on the page and saved on the device', s.n === s.saved && s.n >= 6, s.summary);
check('no errors during the headset run', errs.length === 0, errs.slice(0, 4).join(' | '));
await browser.close(); srv.close();
const failed = results.filter((r) => !r[1]); console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? '  FAILED: ' + failed.map((f) => f[0]).join('; ') : ''));
process.exitCode = failed.length ? 1 : 0;
