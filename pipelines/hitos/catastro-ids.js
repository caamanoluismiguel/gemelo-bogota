'use strict';
// Ids de las cajas de Catastro que tapa cada hito 3D (site/hitos.js las oculta por id).
//
// Los ids los pone tippecanoe al armar las teselas: cambian si se rehacen las teselas. Por eso
// salen de aquí, del archivo publicado, y no se escriben a mano. Después de cada release de
// teselas: node pipelines/hitos/catastro-ids.js [carpeta de salida] [catastro-lejos.pmtiles]
// y luego node pipelines/hitos/modelar.js (escribe el catálogo con los ids nuevos).
//
// Qué se oculta:
//   z16 (construcciones, cada edificio): el que tiene su centro dentro de la huella del hito.
//   z12 a z15 (huellas unidas por manzana): solo la unión que el hito cubre casi entera (80 %
//   o más de su área). Si la unión trae vecinos, se queda: es mejor una caja de más bajo el
//   modelo que un hueco en la manzana de al lado.
const fs = require('fs');
const path = require('path');
const { abrir } = require('../../pruebas/pmtiles-leer');

const RAD = Math.PI / 180;

// ── Lector de MVT con ids (site/mvt.js no devuelve el id) ──────────────────
function lector(buf) {
  let p = 0;
  const vi = () => { let v = 0, m = 1, b; do { b = buf[p++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  return { vi, get p() { return p; }, set p(x) { p = x; } };
}
function campos(buf) {
  const r = lector(buf), out = [];
  while (r.p < buf.length) {
    const k = r.vi(), f = Math.floor(k / 8), w = k & 7;
    if (w === 0) out.push([f, r.vi()]);
    else if (w === 2) { const n = r.vi(); out.push([f, buf.subarray(r.p, r.p + n)]); r.p += n; }
    else if (w === 5) { out.push([f, buf.readFloatLE ? buf.readFloatLE(r.p) : 0]); r.p += 4; }
    else if (w === 1) { out.push([f, buf.readDoubleLE ? buf.readDoubleLE(r.p) : 0]); r.p += 8; }
    else throw new Error('tipo de campo ' + w);
  }
  return out;
}
function empacados(buf) { const r = lector(buf), v = []; while (r.p < buf.length) v.push(r.vi()); return v; }
const zz = (n) => (n >>> 1) ^ -(n & 1);

// Objetos de una capa: { id, props, anillos (en unidades de tesela), ext }.
function objetosConId(bytes, nombre) {
  const out = [];
  for (const [f, capa] of campos(bytes)) {
    if (f !== 3) continue;
    const cs = campos(capa);
    const nom = cs.find((c) => c[0] === 1);
    if (!nom || Buffer.from(nom[1]).toString() !== nombre) continue;
    const ext = (cs.find((c) => c[0] === 5) || [0, 4096])[1];
    const claves = cs.filter((c) => c[0] === 3).map((c) => Buffer.from(c[1]).toString());
    const valores = cs.filter((c) => c[0] === 4).map((c) => { const v = campos(c[1])[0]; return v[1] instanceof Uint8Array ? Buffer.from(v[1]).toString() : v[1]; });
    for (const [g, ob] of cs) {
      if (g !== 2) continue;
      let id = null, tags = [], geo = [];
      for (const [h, v] of campos(ob)) {
        if (h === 1) id = v; else if (h === 2) tags = empacados(v); else if (h === 4) geo = empacados(v);
      }
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[claves[tags[i]]] = valores[tags[i + 1]];
      const anillos = [];
      let x = 0, y = 0, i = 0, a = null;
      while (i < geo.length) {
        const cmd = geo[i] & 7, n = geo[i] >> 3; i++;
        if (cmd === 7) { if (a) anillos.push(a); a = null; continue; }
        for (let j = 0; j < n; j++) {
          x += zz(geo[i++]); y += zz(geo[i++]);
          if (cmd === 1) { if (a) anillos.push(a); a = [[x, y]]; } else a.push([x, y]);
        }
      }
      if (a && a.length) anillos.push(a);
      out.push({ id, props, anillos, ext });
    }
  }
  return out;
}

// ── Geometría plana en metros alrededor de un origen ──────────────────────
function aMetros(lon0, lat0) {
  const k = 6378137 * RAD;
  return (lon, lat) => [(lon - lon0) * k * Math.cos(lat0 * RAD), (lat - lat0) * k];
}
function dentro(pt, anillos) {
  let d = false;
  for (const r of anillos) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d;
    }
  }
  return d;
}
const enAlguno = (pt, polis) => polis.some((a) => dentro(pt, a));

function teselaALonLat(z, x, y, ext) {
  const n = 2 ** z;
  return ([u, v]) => {
    const lon = (x + u / ext) / n * 360 - 180;
    const t = Math.PI - 2 * Math.PI * (y + v / ext) / n;
    return [lon, Math.atan(Math.sinh(t)) / RAD];
  };
}
function teselaDe(lon, lat, z) {
  const n = 2 ** z;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n)];
}

// Parte del objeto (en m) que cae dentro de la huella: muestreo en una rejilla de 1 m o más fina.
function partoDentro(anillosM, huellaM) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of anillosM) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const paso = Math.max(0.5, Math.min(2, Math.sqrt((x1 - x0) * (y1 - y0)) / 60));
  let tot = 0, den = 0;
  for (let x = x0 + paso / 2; x < x1; x += paso) for (let y = y0 + paso / 2; y < y1; y += paso) {
    if (!dentro([x, y], anillosM)) continue;
    tot++; if (enAlguno([x, y], huellaM)) den++;
  }
  return tot ? den / tot : 0;
}

// Ids que tapa la huella (lista de polígonos en lon/lat) en una zoom de un archivo.
// modo 'centro': el centro del objeto dentro; modo 'cubre': 80 % del objeto dentro.
function idsBajo(pm, z, huella, modo, minimo) {
  const lons = huella.flat(3).filter((_, i) => i % 2 === 0), lats = huella.flat(3).filter((_, i) => i % 2 === 1);
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2, lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const m = aMetros(lon0, lat0);
  const huellaM = huella.map((p) => p.map((r) => r.map(([a, b]) => m(a, b))));
  const xs = huellaM.flat(2).map((q) => q[0]), ys = huellaM.flat(2).map((q) => q[1]);
  const cajaH = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [xa, ya] = teselaDe(Math.min(...lons), Math.max(...lats), z), [xb, yb] = teselaDe(Math.max(...lons), Math.min(...lats), z);
  const ids = new Set(), sinId = [];
  for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
    const b = pm.tesela(z, x, y);
    if (!b) continue;
    const ll = (o) => teselaALonLat(z, x, y, o.ext);
    for (const o of objetosConId(b, 'construcciones')) {
      const f = ll(o);
      const am = o.anillos.map((r) => r.map((q) => m(...f(q))));
      // Lejos de la huella (sin cruce de cajas): ni se mira.
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const r of am) for (const [px, py] of r) { bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); }
      if (bx1 < cajaH[0] || bx0 > cajaH[2] || by1 < cajaH[1] || by0 > cajaH[3]) continue;
      let ok;
      if (modo === 'centro') {
        let sx = 0, sy = 0, n = 0;
        for (const [px, py] of am[0]) { sx += px; sy += py; n++; }
        ok = enAlguno([sx / n, sy / n], huellaM) && partoDentro(am, huellaM) >= 0.5;
      } else ok = partoDentro(am, huellaM) >= (minimo || 0.8);
      if (!ok) continue;
      if (o.id == null) sinId.push(o.props); else ids.add(o.id);
    }
  }
  return { ids: [...ids].sort((a, b) => a - b), sinId: sinId.length };
}

function huellasPorHito(geojson) {
  const h = {};
  for (const f of geojson.features) (h[f.properties.hito] = h[f.properties.hito] || []).push(f.geometry.coordinates);
  return h;
}

module.exports = { objetosConId, idsBajo, huellasPorHito, dentro, aMetros, teselaDe };

if (require.main === module) {
  const salida = process.argv[2] || path.join(__dirname, '../../mapa-base/salida');
  const lejos = process.argv[3] || path.join(salida, 'catastro-lejos-bogota.pmtiles');
  const H = huellasPorHito(JSON.parse(fs.readFileSync(path.join(__dirname, 'huellas-catastro.geojson'))));
  const pisos = abrir(path.join(salida, 'catastro-pisos-bogota.pmtiles'));
  const pmL = fs.existsSync(lejos) ? abrir(lejos) : null;
  const out = { _nota: 'Ids de tippecanoe de las teselas de Catastro publicadas. Se rehacen con este script en cada release de teselas.', hitos: {} };
  for (const [hito, huella] of Object.entries(H)) {
    const r = { z16: idsBajo(pisos, 16, huella, 'centro').ids };
    for (const z of [14, 15]) r['z' + z] = idsBajo(pisos, z, huella, 'cubre').ids;
    if (pmL) for (const z of [12, 13]) r['z' + z] = idsBajo(pmL, z, huella, 'cubre').ids;
    out.hitos[hito] = r;
    console.log(hito, JSON.stringify(r));
  }
  out.teselas = {};
  const hash = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  out.teselas['catastro-pisos-bogota.pmtiles'] = hash(path.join(salida, 'catastro-pisos-bogota.pmtiles'));
  if (pmL) out.teselas['catastro-lejos-bogota.pmtiles'] = hash(lejos);
  fs.writeFileSync(path.join(__dirname, 'catastro-ids.json'), JSON.stringify(out, null, 1) + '\n');
}
