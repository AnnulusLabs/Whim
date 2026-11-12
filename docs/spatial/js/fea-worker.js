// Runs the stress test off the main thread so the view never freezes.
import { runTest } from "./fea.js";
self.onmessage = (e) => {
  try {
    const r = runTest(e.data);
    self.postMessage({ ok: true, r }, [r.u.buffer, r.vm.buffer, r.fill.buffer, r.active.buffer, r.fixed.buffer, r.loaded.buffer]);
  } catch (err) { self.postMessage({ ok: false, error: err.message || String(err), code: err.code || null }); }
};
