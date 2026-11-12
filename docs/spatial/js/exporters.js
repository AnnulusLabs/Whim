// Whim Spatial Bench: file writers. 3MF for printing (watertight, in millimetres), STL as the fallback,
// and a minimal ZIP writer because 3MF is a ZIP of XML.
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** ZIP archive with stored (uncompressed) entries. files: [{ name, data: Uint8Array | string }] */
export function zipStore(files) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, 0, true); head.setUint16(10, 0, true); head.setUint16(12, 0x21, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(head.buffer), name, data); central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + csize + 22); let o = 0;
  for (const p of [...parts, ...central, new Uint8Array(end.buffer)]) { out.set(p, o); o += p.length; }
  return out;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const num = (v) => (Math.abs(v) < 5e-7 ? "0" : String(+v.toFixed(5)));

/** objects: [{ name, positions: Float32Array in metres (Y up), index: Uint32Array }] -> .3mf bytes (millimetres, Z up). */
export function write3MF(objects, title = "Whim part") {
  let res = "", build = "";
  objects.forEach((o, n) => {
    const v = [], t = [], p = o.positions, ix = o.index;
    for (let i = 0; i < p.length; i += 3) v.push(`<vertex x="${num(p[i] * 1000)}" y="${num(-p[i + 2] * 1000)}" z="${num(p[i + 1] * 1000)}"/>`);
    for (let i = 0; i < ix.length; i += 3) t.push(`<triangle v1="${ix[i]}" v2="${ix[i + 1]}" v3="${ix[i + 2]}"/>`);
    res += `<object id="${n + 1}" type="model" name="${esc(o.name)}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`;
    build += `<item objectid="${n + 1}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(title)}</metadata><metadata name="Application">Whim Spatial Bench</metadata><resources>${res}</resources><build>${build}</build></model>`;
  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: "3D/3dmodel.model", data: model },
  ]);
}

/** Binary STL from triangle soups. soups: [Float32Array of xyz triples in metres, Y up]. Output in millimetres, Z up. */
export function writeSTL(soups) {
  const count = soups.reduce((n, s) => n + s.length / 9, 0), buf = new ArrayBuffer(84 + 50 * count), dv = new DataView(buf);
  enc.encodeInto("Whim Spatial Bench, millimetres", new Uint8Array(buf, 0, 80)); dv.setUint32(80, count, true);
  let o = 84;
  for (const s of soups) for (let i = 0; i < s.length; i += 9) {
    const P = []; for (let v = 0; v < 3; v++) P.push([s[i + 3 * v] * 1000, -s[i + 3 * v + 2] * 1000, s[i + 3 * v + 1] * 1000]);
    const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const len = Math.hypot(...n) || 1; n = n.map((c) => c / len);
    for (const c of n) { dv.setFloat32(o, c, true); o += 4; }
    for (const p of P) for (const c of p) { dv.setFloat32(o, c, true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}
