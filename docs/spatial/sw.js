// Whim Spatial Bench: offline copy. Fresh from the network when there is one, from this device when there is not.
const CACHE = "whim-spatial-0.2.0";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "js/main.js", "js/app.js", "js/ui.js", "js/xr.js", "js/model.js", "js/data.js", "js/kernel.js", "js/exporters.js", "js/fea.js", "js/fea-worker.js",
  "vendor/three.module.min.js", "vendor/OrbitControls.js", "vendor/BufferGeometryUtils.js", "vendor/manifold.js", "vendor/manifold.wasm"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("whim-spatial-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow network")), 5000))]);
      if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const kept = await cache.match(req, { ignoreSearch: true });
      if (kept) return kept;
      if (req.mode === "navigate") { const page = await cache.match("index.html"); if (page) return page; }
      throw err;
    }
  })());
});
