#!/usr/bin/env node
// Whim self-hosted server. Replaces the Cloudflare worker: serves the built app and
// stores shared sheets as files. Node standard library only.
//
//   WHIM_DIST   built app directory          (default ../dist)
//   WHIM_DATA   where shared sheets are kept (default ./data)
//   WHIM_HOST   listen address               (default 127.0.0.1)
//   WHIM_PORT   listen port                  (default 8787)
import http from "node:http";
import { createHash, randomInt } from "node:crypto";
import { promises as fs, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.WHIM_DIST ?? path.join(here, "..", "dist"));
const DATA = path.resolve(process.env.WHIM_DATA ?? path.join(here, "data"));
const HOST = process.env.WHIM_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WHIM_PORT ?? 8787);

const SAVE = "/documents/save/", GET = "/documents/get/";
const DOC = /^\/[a-zA-Z0-9]{22}$/, CHECKPOINT = /^\/temp-checkpoint-[a-f0-9-]{36}$/, ID = /^[a-zA-Z0-9]{22}$/;
const MAX = 2_000_000;                       // same sheet size limit as upstream
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src 'self' data:;";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".py": "text/x-python; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".whl": "application/zip", ".zip": "application/zip", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
  ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".tar": "application/x-tar", ".data": "application/octet-stream" };

export const sheetHash = (data) => createHash("sha512").update(` ${data}math`).digest("hex");   // matches src/database/utility.ts
const newId = () => Array.from({ length: 22 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const file = (id) => path.join(DATA, `${id}.json`);

async function readEntry(id) {
  if (!ID.test(id)) return null;
  try { return JSON.parse(await fs.readFile(file(id), "utf8")); } catch { return null; }
}
async function writeEntry(id, entry) {
  const tmp = `${file(id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entry));
  await fs.rename(tmp, file(id));
}

// Library sheets ship with the app under fixed ids and are rewritten on every start.
export function loadLibrary(dir = path.join(here, "library")) {
  mkdirSync(DATA, { recursive: true });
  let n = 0;
  if (!existsSync(dir)) return n;
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const { id, title, sheet } = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    if (!ID.test(id)) throw new Error(`${name}: id must be 22 letters or digits`);
    const data = JSON.stringify(sheet);
    writeFileSync(file(id), JSON.stringify({ title, data, dataHash: sheetHash(data), creation: "library", history: [], library: true }));
    n++;
  }
  return n;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function save(req, res, url) {
  const requestHash = url.pathname.slice(SAVE.length);
  let body;
  try { body = JSON.parse(await readBody(req, MAX * 4 + 100_000)); } catch (e) { return send(res, e.status ?? 400, e.status === 413 ? "Sheet too large." : "Bad request."); }
  const data = body?.document;
  if (typeof data !== "string" || !Array.isArray(body.history)) return send(res, 400, "Bad request.");
  if (data.length > MAX) return send(res, 413, "Sheet too large for database, reduce size of images in documentation cells.");
  const dataHash = sheetHash(data);
  if (dataHash !== requestHash) return send(res, 404, "Document could not be saved.");
  const origin = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
  const history = body.history;
  const prev = history[0]?.hash;
  if (prev && prev !== "file" && (await readEntry(prev))?.data === data) {     // unchanged: reuse the id
    return send(res, 200, JSON.stringify({ url: `${origin}/${prev}`, hash: prev, history }), { "Content-Type": "application/json" });
  }
  let id = newId();
  for (let i = 0; i < 5 && existsSync(file(id)); i++) id = newId();
  if (existsSync(file(id))) return send(res, 404, "Sheet id collision, save unsuccessful. Try to save your document again.");
  const creation = new Date().toISOString();
  history.unshift({ url: `${origin}/${id}`, hash: id, creation });
  await writeEntry(id, { title: String(body.title ?? ""), data, dataHash, creation, history });   // no IP address is stored
  send(res, 200, JSON.stringify({ url: `${origin}/${id}`, hash: id, history }), { "Content-Type": "application/json" });
}

async function get(res, url) {
  const entry = await readEntry(url.pathname.slice(GET.length));
  if (!entry) return send(res, 404, "Document not found");
  send(res, 200, JSON.stringify({ data: entry.data, history: entry.history }), { "Content-Type": "application/json", "X-Robots-Tag": "noindex" });
}

async function asset(req, res, pathname, isPage) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.join(DIST, rel);
  if (!full.startsWith(DIST + path.sep) && full !== DIST) return send(res, 403, "Forbidden");
  let stat;
  try { stat = await fs.stat(full); } catch { return send(res, 404, "Not found"); }
  if (stat.isDirectory()) return send(res, 404, "Not found");
  const type = MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  const headers = { "Content-Type": type, "Content-Length": stat.size,
    "Cache-Control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" };
  if (type.startsWith("text/html") && rel !== "/iframe_test.html") headers["Content-Security-Policy"] = CSP;
  if (isPage) headers["X-Robots-Tag"] = "noindex";
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(full).pipe(res);
}

export function createServer() {
  mkdirSync(DATA, { recursive: true });
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;
      if (p.startsWith(SAVE) && req.method === "POST") return await save(req, res, url);
      if (p.startsWith(GET) && req.method === "GET") return await get(res, url);
      if (p.startsWith("/docgen/")) return send(res, 501, "Document export is not set up on this server.");
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      if (DOC.test(p) || CHECKPOINT.test(p) || p === "/open_file") return await asset(req, res, "/index.html", true);
      return await asset(req, res, p, false);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, "Server error");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = loadLibrary();
  createServer().listen(PORT, HOST, () => console.log(`Whim on http://${HOST}:${PORT}  app=${DIST}  data=${DATA}  library sheets=${n}`));
}
