'use strict';
// Geometría para modelar los hitos en código: malla con caras planas, muros, tapas con
// huecos, cajas giradas, techos a dos aguas, columnas y escritura a GLB (glTF 2.0 binario).
//
// Coordenadas de trabajo: e (este) y n (norte) en metros desde el origen del hito, y arriba en
// metros desde el suelo. El GLB sale en el eje de glTF: x = este, y = arriba, z = sur.

// ── Polígonos ───────────────────────────────────────────────────────────────
const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a; };
// Positivo = contrario a las agujas del reloj (este a la derecha, norte arriba).
const areaConSigno = (r) => area2(r) / 2;
const sinCierre = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice());
const cruz = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// Quita puntos repetidos y los que caen en línea recta con sus vecinos (menos de tol m).
function limpiar(r, tol) {
  tol = tol == null ? 0.02 : tol;
  let p = sinCierre(r).filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-4);
  let cambio = true;
  while (cambio && p.length > 3) {
    cambio = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 1e-6 || Math.abs(cruz(a, b, c)) / L < tol) { p.splice(i, 1); cambio = true; break; }
    }
  }
  return p;
}

// Douglas-Peucker sobre un anillo cerrado (se parte en los dos puntos más lejanos entre sí).
function simplificar(r, tol) {
  const p = sinCierre(r);
  if (p.length < 8) return p;
  let ia = 0, ib = 0, d = -1;
  for (let i = 0; i < p.length; i++) { const q = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (q > d) { d = q; ib = i; } }
  d = -1;
  for (let i = 0; i < p.length; i++) { const q = Math.hypot(p[i][0] - p[ib][0], p[i][1] - p[ib][1]); if (q > d) { d = q; ia = i; } }
  const [i0, i1] = ia < ib ? [ia, ib] : [ib, ia];
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let k = 0, m = -1;
    for (let i = 1; i < pts.length - 1; i++) { const q = Math.abs(cruz(a, b, pts[i])) / L; if (q > m) { m = q; k = i; } }
    if (m <= tol) return [a, b];
    const izq = dp(pts.slice(0, k + 1)), der = dp(pts.slice(k));
    return izq.slice(0, -1).concat(der);
  };
  const t1 = dp(p.slice(i0, i1 + 1)), t2 = dp(p.slice(i1).concat(p.slice(0, i0 + 1)));
  return t1.slice(0, -1).concat(t2.slice(0, -1));
}

function seCruzan(a, b, c, d) {
  const d1 = cruz(c, d, a), d2 = cruz(c, d, b), d3 = cruz(a, b, c), d4 = cruz(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const igual = (a, b) => a[0] === b[0] && a[1] === b[1];

// Une los huecos al contorno con un puente cada uno (el contorno queda como un solo anillo).
function unirHuecos(exterior, huecos) {
  let poli = exterior.slice();
  const resto = huecos.map((h) => h.slice()).sort((a, b) => Math.max(...b.map((q) => q[0])) - Math.max(...a.map((q) => q[0])));
  while (resto.length) {
    const h = resto.shift();
    let im = 0;
    for (let i = 1; i < h.length; i++) if (h[i][0] > h[im][0]) im = i;
    const M = h[im];
    const lados = [];
    for (let i = 0; i < poli.length; i++) lados.push([poli[i], poli[(i + 1) % poli.length]]);
    for (const o of resto) for (let i = 0; i < o.length; i++) lados.push([o[i], o[(i + 1) % o.length]]);
    for (let i = 0; i < h.length; i++) lados.push([h[i], h[(i + 1) % h.length]]);
    const candidatos = poli.map((P, i) => ({ P, i, d: Math.hypot(P[0] - M[0], P[1] - M[1]) })).sort((a, b) => a.d - b.d);
    let elegido = null;
    for (const c of candidatos) {
      if (lados.some(([a, b]) => !igual(a, c.P) && !igual(b, c.P) && !igual(a, M) && !igual(b, M) && seCruzan(M, c.P, a, b))) continue;
      elegido = c; break;
    }
    if (!elegido) throw new Error('no se pudo unir un hueco');
    const giro = h.slice(im).concat(h.slice(0, im));
    poli = poli.slice(0, elegido.i + 1).concat(giro, [M.slice(), elegido.P.slice()], poli.slice(elegido.i + 1));
  }
  return poli;
}

function dentroTri(p, a, b, c) {
  return cruz(a, b, p) >= 0 && cruz(b, c, p) >= 0 && cruz(c, a, p) >= 0;
}

// Triángulos (índices al arreglo de puntos que devuelve) de un polígono con huecos.
// anillos: [exterior, ...huecos], cada uno sin el punto de cierre.
function triangular(anillos) {
  const ext = anillos[0].slice();
  if (areaConSigno(ext) < 0) ext.reverse();
  const huecos = anillos.slice(1).map((h) => (areaConSigno(h) > 0 ? h.slice().reverse() : h.slice()));
  const pts = huecos.length ? unirHuecos(ext, huecos) : ext;
  const idx = pts.map((_, i) => i), tris = [];
  let guardia = 0;
  while (idx.length > 3 && guardia++ < 100000) {
    let hecho = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      const cr = cruz(a, b, c);
      if (cr <= 1e-9) continue;
      let vacia = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j];
        if (igual(p, a) || igual(p, b) || igual(p, c)) continue;
        if (dentroTri(p, a, b, c)) { vacia = false; break; }
      }
      if (!vacia) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      hecho = true;
      break;
    }
    if (!hecho) {
      // Queda algo degenerado (puntos en línea): se corta la oreja menos mala.
      let k = 0, mejor = -Infinity;
      for (let q = 0; q < idx.length; q++) {
        const cr = cruz(pts[idx[(q + idx.length - 1) % idx.length]], pts[idx[q]], pts[idx[(q + 1) % idx.length]]);
        if (cr > mejor) { mejor = cr; k = q; }
      }
      if (mejor > 1e-9) tris.push([idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]]);
      idx.splice(k, 1);
    }
  }
  if (idx.length === 3 && cruz(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-9) tris.push(idx.slice());
  return { pts, tris };
}

// ── Marco girado (u a lo largo, v de lado) para cajas y techos ────────────
function marco(origen, grados) {
  const a = grados * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
  return {
    pt: (s, t) => [origen[0] + u[0] * s + v[0] * t, origen[1] + u[1] * s + v[1] * t],
    uv: (p) => [(p[0] - origen[0]) * u[0] + (p[1] - origen[1]) * u[1], (p[0] - origen[0]) * v[0] + (p[1] - origen[1]) * v[1]]
  };
}

// ── Malla ───────────────────────────────────────────────────────────────────
class Malla {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  get triangulos() { return this.pos.length / 9; }
  // a, b, c: [e, n, arriba]. Normal plana calculada; color [r, g, b] de 0 a 255.
  tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); }
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  // Muro de p0 a p1 (planta) entre y0 e y1. El anillo exterior va contrario a las agujas del
  // reloj: la cara mira hacia afuera (a la derecha del recorrido).
  muro(p0, p1, y0, y1, color) {
    this.quad([p0[0], p0[1], y0], [p1[0], p1[1], y0], [p1[0], p1[1], y1], [p0[0], p0[1], y1], color);
  }
  muros(anillo, y0, y1, color, huecoAdentro) {
    let r = anillo.slice();
    const ccw = areaConSigno(r) > 0;
    if (huecoAdentro ? ccw : !ccw) r.reverse();
    for (let i = 0; i < r.length; i++) this.muro(r[i], r[(i + 1) % r.length], y0, y1, color);
  }
  tapa(anillos, y, color) {
    const { pts, tris } = triangular(anillos);
    for (const [i, j, k] of tris) this.tri([pts[i][0], pts[i][1], y], [pts[j][0], pts[j][1], y], [pts[k][0], pts[k][1], y], color);
  }
  // Prisma: muros de todos los anillos y tapa arriba. anillos: [exterior, ...huecos].
  prisma(anillos, y0, y1, colorMuro, colorTecho) {
    this.muros(anillos[0], y0, y1, colorMuro, false);
    for (const h of anillos.slice(1)) this.muros(h, y0, y1, colorMuro, true);
    this.tapa(anillos, y1, colorTecho || colorMuro);
  }
  // Caja en un marco girado: s de s0 a s1, t de t0 a t1.
  caja(M, s0, s1, t0, t1, y0, y1, colorMuro, colorTecho) {
    this.prisma([[M.pt(s0, t0), M.pt(s1, t0), M.pt(s1, t1), M.pt(s0, t1)]], y0, y1, colorMuro, colorTecho);
  }
  // Techo a dos aguas con la cumbrera a lo largo de s; aleros en los dos extremos de s.
  dosAguas(M, s0, s1, t0, t1, y0, y1, colorTecho, colorMuro) {
    const tm = (t0 + t1) / 2;
    const P = (s, t, y) => { const q = M.pt(s, t); return [q[0], q[1], y]; };
    this.quad(P(s0, t0, y0), P(s1, t0, y0), P(s1, tm, y1), P(s0, tm, y1), colorTecho);
    this.quad(P(s1, t1, y0), P(s0, t1, y0), P(s0, tm, y1), P(s1, tm, y1), colorTecho);
    this.tri(P(s0, t1, y0), P(s0, t0, y0), P(s0, tm, y1), colorMuro || colorTecho);
    this.tri(P(s1, t0, y0), P(s1, t1, y0), P(s1, tm, y1), colorMuro || colorTecho);
  }
  // Columna o cuerpo de n lados (radios r0 abajo y r1 arriba; r1 = 0 da una pirámide).
  columna(c, r0, r1, y0, y1, n, color, conTapa) {
    const p = (r, k, y) => [c[0] + r * Math.cos(2 * Math.PI * (k + 0.5) / n), c[1] + r * Math.sin(2 * Math.PI * (k + 0.5) / n), y];
    for (let k = 0; k < n; k++) {
      if (r1 > 0) this.quad(p(r0, k, y0), p(r0, k + 1, y0), p(r1, k + 1, y1), p(r1, k, y1), color);
      else this.tri(p(r0, k, y0), p(r0, k + 1, y0), [c[0], c[1], y1], color);
    }
    if (conTapa && r1 > 0) for (let k = 1; k < n - 1; k++) this.tri(p(r1, 0, y1), p(r1, k, y1), p(r1, k + 1, y1), color);
  }
  caja3d() {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], this.pos[i + k]); b[3 + k] = Math.max(b[3 + k], this.pos[i + k]); }
    return b;
  }
}

// ── GLB ─────────────────────────────────────────────────────────────────────
// Una malla, un primitivo: POSITION y NORMAL en float32, COLOR_0 en bytes normalizados (rgba),
// índices de 16 o 32 bits. Vértices compartidos solo si son iguales en todo (caras planas).
function aGlb(malla, extras) {
  const mapa = new Map(), P = [], N = [], C = [], I = [];
  const n = malla.pos.length / 3;
  for (let i = 0; i < n; i++) {
    // glTF: x este, y arriba, z sur. Posición a 1 mm; normal a 1e-4.
    const x = Math.round(malla.pos[3 * i] * 1000) / 1000, y = Math.round(malla.pos[3 * i + 2] * 1000) / 1000, z = Math.round(-malla.pos[3 * i + 1] * 1000) / 1000;
    const nx = Math.round(malla.nor[3 * i] * 1e4) / 1e4, ny = Math.round(malla.nor[3 * i + 2] * 1e4) / 1e4, nz = Math.round(-malla.nor[3 * i + 1] * 1e4) / 1e4;
    const c = malla.col.slice(3 * i, 3 * i + 3);
    const k = [x, y, z, nx, ny, nz, c[0], c[1], c[2]].join(',');
    let j = mapa.get(k);
    if (j === undefined) { j = P.length / 3; mapa.set(k, j); P.push(x, y, z); N.push(nx, ny, nz); C.push(c[0], c[1], c[2], 255); }
    I.push(j);
  }
  // (este, norte, arriba) → (x, y, z) = (este, arriba, sur) es un giro (determinante 1): el
  // sentido de cada triángulo se conserva y la cara sigue mirando afuera.
  const nv = P.length / 3;
  const pos = new Float32Array(P), nor = new Float32Array(N), col = new Uint8Array(C);
  const idx = nv > 65535 ? new Uint32Array(I) : new Uint16Array(I);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  const pad4 = (x) => (x + 3) & ~3;
  const partes = [pos, nor, col, idx];
  const offs = []; let o = 0;
  for (const p of partes) { offs.push(o); o = pad4(o + p.byteLength); }
  const bin = new Uint8Array(o);
  partes.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offs[i]));
  const json = {
    asset: Object.assign({ version: '2.0', generator: 'Bogotwin pipelines/hitos/modelar.js' }, extras && extras.asset),
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: (extras && extras.nombre) || 'hito' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ name: 'color de vértice', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[1], byteLength: nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: col.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[3], byteLength: idx.byteLength, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: nv, type: 'VEC4' },
      { bufferView: 3, componentType: nv > 65535 ? 5125 : 5123, count: I.length, type: 'SCALAR' }
    ]
  };
  if (extras && extras.extras) json.extras = extras.extras;
  let js = Buffer.from(JSON.stringify(json));
  const jsPad = pad4(js.length);
  js = Buffer.concat([js, Buffer.alloc(jsPad - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const b0 = 20 + js.length;
  out.writeUInt32LE(bin.length, b0); out.writeUInt32LE(0x004e4942, b0 + 4); Buffer.from(bin).copy(out, b0 + 8);
  return { glb: out, vertices: nv, triangulos: I.length / 3, min, max };
}

module.exports = { Malla, aGlb, triangular, unirHuecos, limpiar, simplificar, marco, areaConSigno, sinCierre };
