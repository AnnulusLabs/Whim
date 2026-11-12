// Tiny static server for tests. opts.block: array of substrings to 404; opts.cors: add ACAO for sandboxed-frame tests.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
export function serve(root, port, opts = {}) {
  const log = [];
  const srv = http.createServer((q, r) => {
    let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
    log.push(u);
    if ((opts.block || []).some((b) => u.includes(b))) { r.writeHead(404); r.end(); return; }
    const extra = opts.extra && opts.extra[u];
    const f = extra ? null : path.join(root, u);
    const send = (b, ext) => { r.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(opts.cors ? { 'Access-Control-Allow-Origin': '*' } : {}) }); r.end(b); };
    if (extra) return send(extra, path.extname(u));
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } send(b, path.extname(f)); });
  }).listen(port);
  return { srv, log, opts, close: () => srv.close() };
}
