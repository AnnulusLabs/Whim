// Screen-mode end-to-end test of Whim Spatial Bench in headless Chromium.
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
import fs from 'node:fs';
const results = []; const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== '' ? '   [' + info + ']' : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
const launch = () => chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
function watch(pg, errs) { pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); }
const ready = (pg, kernel = true) => pg.waitForFunction((k) => window.whim && whim.S.nodes && document.querySelector('canvas') && (!k || whim.A.kernelReady()), kernel, { timeout: 40000 });
const setField = async (pg, id, v) => { await pg.fill('#' + id, String(v)); await pg.press('#' + id, 'Enter'); };
const st = (pg, fn, arg) => pg.evaluate(fn, arg);
const waitTest = (pg) => pg.waitForFunction(() => whim.S.test && !whim.S.busy, null, { timeout: 90000 });
const menu = async (pg, id) => { await pg.click('#b-more'); await pg.click('#' + id); };
// project a bench-model point to page pixels
const project = (pg, p) => pg.evaluate((p) => { const { A, THREE } = whim; const v = new THREE.Vector3(...p); A.modelGroup.updateMatrixWorld(true); A.modelGroup.localToWorld(v); v.project(A.camera); const r = A.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, p);

function unzip(buf) {                     // stored entries only
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), files = {}; let o = 0;
  while (o + 30 < buf.length && dv.getUint32(o, true) === 0x04034b50) { const size = dv.getUint32(18, true + 0) && dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), el = dv.getUint16(o + 28, true); const name = Buffer.from(buf.subarray(o + 30, o + 30 + nl)).toString(); files[name] = buf.subarray(o + 30 + nl + el, o + 30 + nl + el + size); o += 30 + nl + el + size; }
  return files;
}
function meshStats(xml) {
  const V = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
  const T = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
  const edges = new Map(); let vol = 0, bad = 0;
  for (const [a, b, c] of T) { if (a >= V.length || b >= V.length || c >= V.length) bad++; for (const [i, j] of [[a, b], [b, c], [c, a]]) edges.set(i + '>' + j, (edges.get(i + '>' + j) || 0) + 1);
    const A = V[a], B = V[b], C = V[c]; vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6; }
  let open = 0; for (const [k, n] of edges) { const [i, j] = k.split('>'); if (n !== 1 || edges.get(j + '>' + i) !== 1) open++; }
  const zs = V.map((v) => v[2]);
  return { verts: V.length, tris: T.length, bad, open, vol, zmin: Math.min(...zs), zmax: Math.max(...zs) };
}

const srv = serve(ROOT, 8930), browser = await launch();
try {
  // ---------- 1. first run on a desktop-sized screen ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }), pg = await ctx.newPage(), errs = []; watch(pg, errs);
  await pg.goto('http://localhost:8930/?nosw'); await ready(pg); await pg.waitForTimeout(400);
  let s = await st(pg, () => ({ kinds: whim.S.nodes.map((n) => n.kind), vol: whim.A.volumeOf(whim.S.nodes[0]), summary: whim.A.summary(), active: whim.S.active, panel: !document.getElementById('panel').hidden, xr: !document.getElementById('b-xr').hidden }));
  const volExample = (120 * 8 * 60 + 8 * 80 * 60 + 0.5 * 50 * 50 * 6 - Math.PI * 16 * 8) * 1e-9;
  check('first run shows the example: fused bracket, clamp, weight', s.kinds.join() === 'group,clamp,load', s.summary);
  check('bracket volume matches hand calculation', near(s.vol, volExample, 5e-4), (s.vol * 1e9).toFixed(1) + ' vs ' + (volExample * 1e9).toFixed(1) + ' mm3');
  check('selection panel is open, headset button hidden on a desktop without XR', s.panel && !s.xr);
  await pg.click('#b-test'); await waitTest(pg); await pg.waitForTimeout(300);
  let t = await st(pg, () => ({ ...whim.S.test, card: !document.getElementById('result').hidden, cardText: document.getElementById('result').innerText.replace(/\s+/g, ' ').slice(0, 220) }));
  check('example test runs and the bracket holds 5 kg', t.verdict === 'Holds' && t.peak > 1.5e6 && t.peak < 2e7 && t.card, `peak ${(t.peak / 1e6).toFixed(2)} MPa, SF ${t.safety.toFixed(1)}, bends ${(t.maxU * 1000).toFixed(4)} mm, ${t.stats.cells} bricks, ${t.stats.solver}, ${t.stats.ms} ms`);
  console.log('      card: ' + t.cardText);
  await pg.screenshot({ path: OUT + 'desk-result.png' });
  // Mars: lighter load, same mass
  await pg.click('#b-more'); await pg.selectOption('#o-env', 'mars'); await pg.keyboard.press('Escape');
  s = await st(pg, () => ({ env: whim.S.env, test: whim.S.test, label: whim.A.visuals.get(7).label.userData.key }));
  check('changing gravity clears the old result and relabels the weight', s.env === 'mars' && s.test === null && /18\.6 N/.test(s.label), s.label.slice(0, 60));
  await pg.click('#b-test'); await waitTest(pg);
  const tm = await st(pg, () => whim.S.test);
  check('Mars test: stress scales with gravity', near(tm.peak / t.peak, 3.721 / 9.80665, 0.02), (tm.peak / t.peak).toFixed(4) + ' vs ' + (3.721 / 9.80665).toFixed(4));
  await pg.click('#b-more'); await pg.selectOption('#o-env', 'earth'); await pg.keyboard.press('Escape');

  // ---------- 2. cantilever against beam theory, built through the controls ----------
  await menu(pg, 'a-clear');
  check('clear bench empties it', (await st(pg, () => whim.S.nodes.length)) === 0);
  await pg.click('#b-add'); await pg.click('[data-add=box]');
  await setField(pg, 'f-sx', 150); await setField(pg, 'f-sy', 8); await setField(pg, 'f-sz', 30);
  await setField(pg, 'f-px', 0); await setField(pg, 'f-pz', 0); await setField(pg, 'f-lift', 100); await pg.selectOption('#f-mat', '0');
  const beam = await st(pg, () => whim.S.active);
  await pg.click('#b-add'); await pg.click('[data-add=clamp]');
  await setField(pg, 'f-sx', 20); await setField(pg, 'f-sy', 40); await setField(pg, 'f-sz', 40); await setField(pg, 'f-px', -85); await setField(pg, 'f-pz', 0); await setField(pg, 'f-lift', 84);
  await pg.click('#b-add'); await pg.click('[data-add=load]');
  await setField(pg, 'f-kg', 20); await setField(pg, 'f-sx', 10); await setField(pg, 'f-sy', 20); await setField(pg, 'f-sz', 30); await setField(pg, 'f-px', 70); await setField(pg, 'f-pz', 0); await setField(pg, 'f-lift', 108);
  s = await st(pg, () => whim.S.nodes.map((n) => ({ k: n.kind, pos: n.pos.map((v) => +(v * 1000).toFixed(3)), size: n.size.map((v) => +(v * 1000).toFixed(3)), kg: n.kg })));
  check('typed sizes and places land exactly', JSON.stringify(s) === JSON.stringify([{ k: 'prim', pos: [0, 104, 0], size: [150, 8, 30] }, { k: 'clamp', pos: [-85, 104, 0], size: [20, 40, 40] }, { k: 'load', pos: [70, 118, 0], size: [10, 20, 30], kg: 20 }]), JSON.stringify(s));
  await st(pg, (id) => whim.A.setActive(id), beam); await pg.click('#b-test'); await waitTest(pg); await pg.waitForTimeout(200);
  t = await st(pg, () => whim.S.test);
  { const P = 20 * 9.80665, E = 68.9e9, I = 0.03 * 0.008 ** 3 / 12, a = 0.145, L = 0.15, d = P * a * a * (3 * L - a) / (6 * E * I), sig = P * a * 0.004 / I;
    check('cantilever deflection within 5% of beam theory', near(t.maxU, d, 0.05), `${(t.maxU * 1000).toFixed(3)} mm vs ${(d * 1000).toFixed(3)} mm (${((t.maxU / d - 1) * 100).toFixed(1)}%)`);
    check('cantilever peak stress within 8% of beam theory', near(t.peak, sig, 0.08), `${(t.peak / 1e6).toFixed(1)} MPa vs ${(sig / 1e6).toFixed(1)} MPa (${((t.peak / sig - 1) * 100).toFixed(1)}%)`);
    check('verdict follows safety factor', t.verdict === (t.safety >= 2 ? 'Holds' : t.safety >= 1 ? 'Near its limit' : 'Too weak'), `${t.verdict}, SF ${t.safety.toFixed(2)}, ${t.stats.cells} bricks, ${t.stats.ms} ms`); }
  await pg.keyboard.press('Home'); await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + 'desk-cantilever.png' });
  // sealed record
  const rec = await st(pg, async () => { const r = await whim.A.record(); return { hash: r.hash, sf: r.body.test.safety_factor, parts: r.body.parts.length, mass: r.body.parts[0].mass_kg }; });
  check('sealed record carries the test and a SHA-256 seal', /^sha256:[0-9a-f]{64}$/.test(rec.hash) && rec.parts === 3 && near(rec.mass, 0.15 * 0.008 * 0.03 * 2700, 1e-3), `${rec.hash.slice(0, 20)}…, mass ${rec.mass} kg`);

  // ---------- 3. fuse, hole, undo, redo, break apart ----------
  await menu(pg, 'a-clear');
  await pg.click('#b-add'); await pg.click('[data-add=box]'); await setField(pg, 'f-px', 0); await setField(pg, 'f-pz', 0); const boxA = await st(pg, () => whim.S.active);
  await pg.click('#b-add'); await pg.click('[data-add=box]'); await setField(pg, 'f-px', 60); await setField(pg, 'f-pz', 0);
  await pg.click('[data-act=fuse]');
  s = await st(pg, () => ({ n: whim.S.nodes.length, kind: whim.S.nodes[0].kind, vol: whim.A.volumeOf(whim.S.nodes[0]), ext: whim.A.M.extent(whim.S.nodes[0]) }));
  check('two touching boxes fuse into one part with the summed volume', s.n === 1 && s.kind === 'group' && near(s.vol, 2 * 0.06 * 0.04 * 0.04, 1e-5) && near(s.ext[0], 0.12, 1e-6), (s.vol * 1e9).toFixed(1) + ' mm3');
  await pg.click('#b-add'); await pg.click('[data-add=cyl]'); await setField(pg, 'f-sx', 20); await setField(pg, 'f-sy', 60); await setField(pg, 'f-px', 0); await setField(pg, 'f-pz', 0); await setField(pg, 'f-lift', 0);
  await pg.check('#f-hole'); await pg.click('[data-act=fuse]');
  const volHole = 2 * 60 * 40 * 40 - Math.PI * 100 * 40;
  s = await st(pg, () => ({ n: whim.S.nodes.length, vol: whim.A.volumeOf(whim.S.nodes[0]), leaves: whim.A.M.countLeaves(whim.S.nodes[0]) }));
  check('a hole cuts its exact volume when fused', s.n === 1 && s.leaves === 3 && near(s.vol * 1e9, volHole, 3e-4), (s.vol * 1e9).toFixed(1) + ' vs ' + volHole.toFixed(1) + ' mm3');
  await pg.click('#b-undo'); const afterUndo = await st(pg, () => whim.S.nodes.map((n) => n.kind + (n.hole ? ':hole' : '')).join());
  await pg.click('#b-redo'); const afterRedo = await st(pg, () => whim.S.nodes.map((n) => n.kind).join());
  check('undo and redo step through the fuse', afterUndo === 'group,prim:hole' && afterRedo === 'group', afterUndo + ' -> ' + afterRedo);
  await pg.screenshot({ path: OUT + 'desk-hole.png' });

  // ---------- 4. export ----------
  let [dl] = await Promise.all([pg.waitForEvent('download'), menu(pg, 'a-3mf')]); await dl.saveAs(OUT + 'part.3mf');
  const files = unzip(fs.readFileSync(OUT + 'part.3mf')), ms = meshStats(Buffer.from(files['3D/3dmodel.model']).toString());
  check('3MF is a valid package with one watertight solid of the right volume', Object.keys(files).length === 3 && ms.bad === 0 && ms.open === 0 && near(ms.vol, volHole, 3e-4) && near(ms.zmax - ms.zmin, 40, 1e-4) && Math.abs(ms.zmin) < 1e-3, `${ms.verts} verts, ${ms.tris} tris, open edges ${ms.open}, ${ms.vol.toFixed(1)} mm3, z ${ms.zmin.toFixed(2)}..${ms.zmax.toFixed(2)} mm`);
  [dl] = await Promise.all([pg.waitForEvent('download'), menu(pg, 'a-stl')]); await dl.saveAs(OUT + 'part.stl');
  const stl = fs.readFileSync(OUT + 'part.stl');
  check('STL is binary with the same triangles', stl.length === 84 + 50 * ms.tris && stl.readUInt32LE(80) === ms.tris, stl.length + ' bytes');
  [dl] = await Promise.all([pg.waitForEvent('download'), menu(pg, 'a-save')]); await dl.saveAs(OUT + 'bench.json');
  await pg.click('[data-act=break]');
  s = await st(pg, () => whim.S.nodes.map((n) => n.kind + (n.hole ? ':hole' : '')).join());
  check('break apart gives back the pieces', s === 'group,prim:hole', s);
  await pg.setInputFiles('#file', OUT + 'bench.json'); await pg.waitForTimeout(300);
  s = await st(pg, () => ({ kinds: whim.S.nodes.map((n) => n.kind).join(), vol: whim.A.volumeOf(whim.S.nodes[0]) }));
  check('a saved bench file opens again', s.kinds === 'group' && near(s.vol * 1e9, volHole, 3e-4));

  // ---------- 5. mouse: slide, stretch by a dot, tap empty space ----------
  await menu(pg, 'a-clear'); await pg.click('#b-add'); await pg.click('[data-add=box]'); await setField(pg, 'f-px', 0); await setField(pg, 'f-pz', 0); await pg.keyboard.press('Home'); await pg.waitForTimeout(400);
  let n0 = await st(pg, () => JSON.parse(JSON.stringify(whim.S.nodes[0])));
  let a = await project(pg, [0.012, 0.04, 0.01]), b = await project(pg, [0.062, 0.04, 0.03]);      // on the top face (off the dot), the plane the drag rides on
  await pg.mouse.move(a[0], a[1]); await pg.mouse.down(); await pg.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await pg.mouse.move(b[0], b[1], { steps: 4 }); await pg.mouse.up();
  let n1 = await st(pg, () => JSON.parse(JSON.stringify(whim.S.nodes[0])));
  check('dragging a shape slides it along the bench and snaps to millimetres', Math.abs(n1.pos[0] - 0.05) < 0.0015 && Math.abs(n1.pos[2] - 0.02) < 0.0015 && Math.abs(n1.pos[1] - n0.pos[1]) < 1e-9 && Math.abs(n1.pos[0] * 1000 - Math.round(n1.pos[0] * 1000)) < 1e-6, n1.pos.map((v) => (v * 1000).toFixed(2)).join(', ') + ' mm');
  // stretch from the +x dot: the -x face must stay put
  { const g = await st(pg, () => { const { A, THREE } = whim, w = A.gripWorld(1), m = A.modelGroup.worldToLocal(new THREE.Vector3(...w)); return [m.x, m.y, m.z]; }); a = await project(pg, g); b = await project(pg, [g[0] + 0.04, g[1], g[2]]); }
  await pg.mouse.move(a[0], a[1]); await pg.mouse.down(); await pg.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await pg.mouse.move(b[0], b[1], { steps: 4 }); await pg.mouse.up();
  let n2 = await st(pg, () => JSON.parse(JSON.stringify(whim.S.nodes[0])));
  check('dragging a dot stretches from that side only', Math.abs(n2.size[0] - 0.1) < 0.003 && Math.abs((n2.pos[0] - n2.size[0] / 2) - (n1.pos[0] - 0.03)) < 1e-9 && n2.size[1] === n1.size[1], `width ${(n2.size[0] * 1000).toFixed(1)} mm, far face moved ${(((n2.pos[0] - n2.size[0] / 2) - (n1.pos[0] - 0.03)) * 1000).toFixed(4)} mm`);
  // lift switch
  await pg.click('#b-lift'); a = await project(pg, [n2.pos[0] + 0.02, 0.04, n2.pos[2] + 0.01]); await pg.mouse.move(a[0], a[1]); await pg.mouse.down(); await pg.mouse.move(a[0], a[1] - 40, { steps: 5 }); await pg.mouse.move(a[0], a[1] - 80, { steps: 5 }); await pg.mouse.up(); await pg.click('#b-lift');
  let n3 = await st(pg, () => JSON.parse(JSON.stringify(whim.S.nodes[0])));
  check('with Lift on, dragging raises the shape straight up', n3.pos[1] > n2.pos[1] + 0.01 && Math.abs(n3.pos[0] - n2.pos[0]) < 1e-9 && Math.abs(n3.pos[2] - n2.pos[2]) < 1e-9, `raised ${((n3.pos[1] - n2.pos[1]) * 1000).toFixed(1)} mm`);
  await pg.mouse.click(40, 400); check('tapping empty space lets go of the selection', (await st(pg, () => whim.S.active)) === null);
  await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z');
  n1 = await st(pg, () => whim.S.nodes[0].size[0]); check('keyboard undo works', Math.abs(n1 - 0.06) < 1e-9);

  // ---------- 6. it is all still there after a reload ----------
  const before = await st(pg, () => JSON.stringify(whim.S.nodes)); await pg.reload(); await ready(pg);
  check('work survives a reload', (await st(pg, () => JSON.stringify(whim.S.nodes))) === before);
  // a file that is not a bench is refused and the bench is left alone; a damaged saved bench falls back to the example
  await st(pg, () => whim.A.openFile('{"nodes":[{"id":1,"kind":"prim","shape":"blob","size":[1,1,1],"pos":[0,0,0],"quat":[0,0,0,1],"mat":0}]}')); await pg.waitForTimeout(100);
  s = await st(pg, () => ({ same: JSON.stringify(whim.S.nodes), said: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ') }));
  check('a file this version cannot read is refused with a reason', s.same === before && /not a Whim bench/.test(s.said), s.said.slice(0, 90));
  await st(pg, () => localStorage.setItem('whim.spatial.v2', '{"v":2,"nodes":[{"id":1,"kind":"prim","shape":"box","size":[0,1,1],"pos":[0,0,"x"],"quat":[0,0,0,1],"mat":0}]}')); await pg.reload(); await ready(pg);
  check('a damaged saved bench is set aside and the example loads', (await st(pg, () => whim.S.nodes.map((n) => n.kind).join())) === 'group,clamp,load');
  check('no errors on the desktop run', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ---------- 7. phone-sized screen with touch ----------
  const pctx = await browser.newContext({ viewport: { width: 384, height: 832 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }), ph = await pctx.newPage(), perrs = []; watch(ph, perrs);
  await ph.goto('http://localhost:8930/?nosw'); await ready(ph); await ph.waitForTimeout(500);
  let lay = await st(ph, () => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { w: innerWidth, h: innerHeight, tools: r('tools'), panel: r('panel'), top: r('top'), scroll: document.documentElement.scrollWidth, shut: document.getElementById('panel').classList.contains('shut') }; });
  check('phone: toolbar and collapsed panel fit a 384 px screen with no sideways scroll', lay.tools[0] >= 0 && lay.tools[2] <= lay.w && lay.panel[2] <= lay.w && lay.scroll <= lay.w && lay.shut && lay.panel[3] <= lay.tools[1], JSON.stringify(lay));
  await ph.screenshot({ path: OUT + 'phone-start.png' });
  await ph.tap('#b-test'); await waitTest(ph); await ph.waitForTimeout(300); await ph.screenshot({ path: OUT + 'phone-result.png' });
  lay = await st(ph, () => { const a = document.getElementById('result').getBoundingClientRect(), b = document.getElementById('panel').getBoundingClientRect(); return { r: [a.top, a.bottom], p: [b.top, b.bottom], h: innerHeight }; });
  check('phone: result card and panel do not overlap', lay.r[1] <= lay.p[0], JSON.stringify(lay));
  await ph.tap('#p-toggle'); await ph.waitForTimeout(200); await ph.screenshot({ path: OUT + 'phone-panel.png' });
  await ph.tap('#p-toggle'); await ph.tap('#b-more'); await ph.waitForTimeout(200); await ph.screenshot({ path: OUT + 'phone-more.png' });
  lay = await st(ph, () => { const b = document.getElementById('m-more').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; });
  check('phone: More menu fits on screen', lay[0] >= 0 && lay[1] >= 0 && lay[2] <= lay[4] && lay[3] <= lay[5], lay.map(Math.round).join(','));
  await ph.keyboard.press('Escape');
  // finger drag (synthetic touch pointer): slide the weight 20 mm along x
  const w0 = await st(ph, () => [...whim.S.nodes[2].pos]); a = await project(ph, [w0[0], w0[1] + 0.01, w0[2]]); b = await project(ph, [w0[0] + 0.02, w0[1] + 0.01, w0[2]]);          // top face of the weight
  { const cdp = await pctx.newCDPSession(ph), touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', a[0], a[1]); for (let i = 1; i <= 8; i++) { await touch('touchMove', a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8); await ph.waitForTimeout(16); } await touch('touchEnd'); await ph.waitForTimeout(100); }
  const w1 = await st(ph, () => ({ pos: [...whim.S.nodes[2].pos], active: whim.S.active }));
  check('phone: a finger drag slides a shape', w1.active === 7 && Math.abs(w1.pos[0] - w0[0] - 0.02) < 0.002, `moved ${((w1.pos[0] - w0[0]) * 1000).toFixed(1)} mm`);
  check('no errors on the phone run', perrs.length === 0, perrs.slice(0, 3).join(' | '));
  await pctx.close();
} finally { srv.close(); }

// ---------- 8. shape engine blocked: everything else must still work ----------
{ const srv2 = serve(ROOT, 8931, { block: ['manifold.wasm'] }), ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } }), pg = await ctx.newPage(), errs = []; watch(pg, errs);
  await pg.goto('http://localhost:8931/?nosw'); await ready(pg, false); await pg.waitForFunction(() => document.querySelector('.toast'), null, { timeout: 20000 }).catch(() => {});
  const said = await st(pg, () => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
  const s = await st(pg, () => ({ kernel: whim.A.kernelReady(), vol: whim.A.volumeOf(whim.S.nodes[0]), meshes: whim.A.visuals.get(5).pick.length }));
  check('without the shape engine: says so, shows the pieces unmerged, estimates volume', !s.kernel && /shape engine/.test(said) && s.meshes === 4 && near(s.vol, 1.030979e-4, 0.005), `${(s.vol * 1e9).toFixed(0)} mm3, ${s.meshes} meshes`);
  await pg.click('#b-test'); await waitTest(pg); const t = await st(pg, () => whim.S.test);
  check('without the shape engine: the stress test still runs', t.verdict === 'Holds' && t.peak > 1e6, `peak ${(t.peak / 1e6).toFixed(2)} MPa`);
  await pg.screenshot({ path: OUT + 'nokernel.png' });
  await ctx.close(); srv2.close(); }

// ---------- 9. offline after one visit ----------
{ const srv3 = serve(ROOT, 8932), ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } }), pg = await ctx.newPage(), errs = []; watch(pg, errs);
  await pg.goto('http://localhost:8932/'); await ready(pg);
  await pg.evaluate(() => navigator.serviceWorker.ready); await pg.waitForFunction(async () => { const c = await caches.open('whim-spatial-0.2.0'); return (await c.keys()).length >= 20; }, null, { timeout: 30000 });
  srv3.close(); await ctx.setOffline(true); await pg.reload(); await ready(pg);
  await pg.click('#b-test'); await waitTest(pg); const t = await st(pg, () => ({ v: whim.S.test.verdict, k: whim.A.kernelReady() }));
  check('offline: reloads from this device, shape engine and test included', t.v === 'Holds' && t.k, errs.slice(0, 2).join(' | '));
  await ctx.close(); }

// ---------- 10. inside a sandboxed preview frame ----------
for (const [label, csp] of [['plain', null], ['with a policy that blocks WebAssembly', "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline'"]]) {
  const page = fs.readFileSync(ROOT + '/index.html', 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">' + (csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''));
  const srv4 = serve(ROOT, 8933, { cors: true, extra: { '/framed.html': Buffer.from(page), '/wrap.html': Buffer.from('<!DOCTYPE html><body style="margin:0"><iframe src="/framed.html" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh"></iframe>') } });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } }), pg = await ctx.newPage(), errs = []; watch(pg, errs);
  await pg.goto('http://localhost:8933/wrap.html'); const fr = pg.frames().find((f) => f.url().includes('framed'));
  await fr.waitForFunction(() => window.whim && whim.S.nodes.length && document.querySelector('canvas'), null, { timeout: 40000 }); await pg.waitForTimeout(2500);
  const s = await fr.evaluate(() => ({ embed: whim.A.EMBED, kernel: whim.A.kernelReady(), n: whim.S.nodes.length, stl: document.getElementById('a-stl').hidden }));
  await fr.click('#b-test'); await fr.waitForFunction(() => whim.S.test && !whim.S.busy, null, { timeout: 90000 }); const v = await fr.evaluate(() => whim.S.test.verdict);
  check(`preview frame (${label}): starts, knows it is framed, and the test runs`, s.embed && s.n === 3 && s.stl && v === 'Holds' && (csp ? !s.kernel : s.kernel), `kernel ${s.kernel}; ` + errs.filter((e) => !/Content Security Policy|wasm|WebAssembly|kernel/i.test(e)).slice(0, 2).join(' | '));
  await pg.screenshot({ path: OUT + 'framed-' + (csp ? 'csp' : 'plain') + '.png' });
  await ctx.close(); srv4.close();
}
await browser.close();
const failed = results.filter((r) => !r[1]); console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? '  FAILED: ' + failed.map((f) => f[0]).join('; ') : ''));
process.exitCode = failed.length ? 1 : 0;
