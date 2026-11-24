'use strict';
// Lee una tesela z/x/y de un archivo PMTiles v3 local, sin dependencias (solo para pruebas).
// Especificación: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
const fs = require('fs');
const zlib = require('zlib');

function idDeTesela(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
  }
  return acc + d;
}

function varints(buf) {
  let p = 0;
  return () => { let v = 0, m = 1, b; do { b = buf[p++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
}

function directorio(buf) {
  const v = varints(buf);
  const n = v();
  const e = Array.from({ length: n }, () => ({}));
  let id = 0;
  for (const x of e) { id += v(); x.id = id; }
  for (const x of e) x.run = v();
  for (const x of e) x.len = v();
  for (let i = 0; i < n; i++) { const o = v(); e[i].off = o === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : o - 1; }
  return e;
}

function abrir(ruta) {
  const fd = fs.openSync(ruta, 'r');
  const leer = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
  const h = leer(0, 127);
  const u = (o) => Number(h.readBigUInt64LE(o));
  const cab = { rootOff: u(8), rootLen: u(16), metaOff: u(24), metaLen: u(32), leafOff: u(40), dataOff: u(56),
    icomp: h[97], tcomp: h[98], minz: h[100], maxz: h[101] };
  const des = (b, c) => (c === 2 ? zlib.gunzipSync(b) : b);
  const raiz = directorio(des(leer(cab.rootOff, cab.rootLen), cab.icomp));
  function buscar(dir, id) {
    let lo = 0, hi = dir.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (dir[m].id < id) lo = m + 1; else if (dir[m].id > id) hi = m - 1; else return dir[m];
    }
    if (hi >= 0) { const e = dir[hi]; if (e.run === 0 || id - e.id < e.run) return e; }
    return null;
  }
  function tesela(z, x, y) {
    const id = idDeTesela(z, x, y);
    let dir = raiz;
    for (let prof = 0; prof < 4; prof++) {
      const e = buscar(dir, id);
      if (!e) return null;
      if (e.run > 0) return des(leer(cab.dataOff + e.off, e.len), cab.tcomp);
      dir = directorio(des(leer(cab.leafOff + e.off, e.len), cab.icomp));
    }
    return null;
  }
  const metadatos = JSON.parse(des(leer(cab.metaOff, cab.metaLen), cab.icomp).toString('utf8'));
  return { cab, tesela, metadatos, cerrar: () => fs.closeSync(fd) };
}

module.exports = { abrir, idDeTesela };
