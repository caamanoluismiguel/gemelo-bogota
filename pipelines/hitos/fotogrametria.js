'use strict';
// Hitos 3D de fotogrametría: toma un modelo libre (GLB de Sketchfab), lo ubica sobre la huella
// de Catastro, lo recorta, lo reduce y escribe site/hitos/<id>.glb, su procedencia y su entrada
// en el catálogo (sin tocar las de modelar.js).
//
//   cd pipelines/hitos && npm i --no-save meshoptimizer@1.3 sharp@0.35
//   node pipelines/hitos/fotogrametria.js [carpeta para las láminas de control]
//
// Hoy hay uno: la Biblioteca Virgilio Barco («Biblioteca Virgilio Barco» por arielbustamanteg,
// CC BY 4.0, fotogrametría con dron del 5 nov 2016). El GLB original (31 MB) no va al repo:
// se baja a mano a pipelines/hitos/fuentes/ (ver CREDITO.txt allí).
//
// Pasos:
//   1. Ejes: el GLB trae los vértices con «abajo» en +y (Sketchfab lo endereza con nodos que
//      aquí no se usan). Se leen como este = x, norte = z, arriba = -y.
//   2. Ajuste a la huella: se rasteriza a 1 m lo que el modelo levanta más de 3 m sobre el
//      suelo de alrededor y se busca el giro, la escala y el corrimiento que mejor lo ponen sobre
//      las piezas de Catastro con pisos (mayor IoU), primero con pasos gruesos y luego finos.
//   3. Recorte: quedan los triángulos con centro dentro de la huella completa de Catastro (también
//      las piezas solo de sótano, que son las plazas y rampas hundidas) más un borde de 3 m.
//   4. Reducción con meshoptimizer (respeta las costuras de la textura) y una sola textura: las
//      tres de 4096 px del original van lado a lado, reducidas, y lo que el recorte no usa queda
//      de un color plano (pesa casi nada en JPEG).
//   5. y = 0 en el suelo de alrededor (mediana del modelo en una franja de 4 a 12 m por fuera de
//      la huella). Lo hundido (rampas, patios) queda bajo cero.
const fs = require('fs');
const path = require('path');
const H = require('../../site/hitos.js');
const { aMetros, dentro } = require('./catastro-ids');
const { envolvente } = require('./modelar');

const AQUI = __dirname;
const SALIDA = path.join(AQUI, '../../site/hitos');
const CC_BY = { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' };

const VIRGILIO = {
  id: 'virgilio-barco',
  nombre: 'Biblioteca Virgilio Barco',
  fuente: path.join(AQUI, 'fuentes/virgilio-barco/biblioteca_virgilio_barco.glb'),
  sha256: '0627d4d92789e3f4fd82037fe3a83d96dec520d83bd91a49b2ea11a9583d324e',
  autor: 'arielbustamanteg',
  titulo: 'Biblioteca Virgilio Barco',
  url: 'https://sketchfab.com/3d-models/biblioteca-virgilio-barco-fd45e98d7166409daf9cbe53baf31fc5',
  corto: 'https://skfb.ly/VMzv',
  fecha: '2026-11-26',
  triangulos: 10000,     // meta de la reducción
  textura: 1024,         // lado de cada una de las tres texturas en la hoja final
  calidad: 72            // JPEG
};

// ── Lectura y ejes ──────────────────────────────────────────────────────────
function leer(c) {
  const g = H.leerGlb(fs.readFileSync(c.fuente));
  // Partes por textura: [{ pos (e, n, arriba), uv, idx, img }].
  return g.partes.map((p) => {
    const n = p.pos.datos.length / 3, pos = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) { pos[3 * i] = p.pos.datos[3 * i]; pos[3 * i + 1] = p.pos.datos[3 * i + 2]; pos[3 * i + 2] = -p.pos.datos[3 * i + 1]; }
    return { pos, uv: p.uv ? Float32Array.from(p.uv.datos) : null, idx: Uint32Array.from(p.idx.datos), img: p.imagen ? Buffer.from(p.imagen.bytes) : null };
  });
}

// Superficie de arriba del modelo en una grilla de 1 m (máximo de «arriba» de los vértices).
function superficie(partes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of partes) for (let i = 0; i < p.pos.length; i += 3) { x0 = Math.min(x0, p.pos[i]); x1 = Math.max(x1, p.pos[i]); y0 = Math.min(y0, p.pos[i + 1]); y1 = Math.max(y1, p.pos[i + 1]); }
  const W = Math.ceil(x1 - x0) + 1, Hh = Math.ceil(y1 - y0) + 1, z = new Float32Array(W * Hh).fill(NaN);
  for (const p of partes) for (let i = 0; i < p.pos.length; i += 3) {
    const k = Math.floor(p.pos[i + 1] - y0) * W + Math.floor(p.pos[i] - x0);
    if (!(z[k] >= p.pos[i + 2])) z[k] = p.pos[i + 2];
  }
  return { x0, y0, W, H: Hh, z, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const mediana = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

// ── Ajuste a la huella ──────────────────────────────────────────────────────
// Modelo → mundo: w = s·R(θ)·(m − c) + t, con c el centro del modelo.
function aMundo(a, s, t, c) {
  const co = Math.cos(a), si = Math.sin(a);
  return (x, y) => [s * (co * (x - c[0]) - si * (y - c[1])) + t[0], s * (si * (x - c[0]) + co * (y - c[1])) + t[1]];
}
function ajustar(sup, alzado, huellaPisos) {
  // Mundo: grilla de 1 m alrededor de la huella.
  let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
  for (const an of huellaPisos) for (const r of an) for (const [e, n] of r) { ex0 = Math.min(ex0, e); ex1 = Math.max(ex1, e); ey0 = Math.min(ey0, n); ey1 = Math.max(ey1, n); }
  ex0 -= 40; ey0 -= 40; ex1 += 40; ey1 += 40;
  const celdas = [];
  for (let n = ey0; n < ey1; n++) for (let e = ex0; e < ex1; e++) celdas.push([e + 0.5, n + 0.5, huellaPisos.some((an) => dentro([e + 0.5, n + 0.5], an)) ? 1 : 0]);
  const enHuella = celdas.reduce((s, c) => s + c[2], 0);
  const c = [sup.cx, sup.cy];
  function iou(a, s, t) {
    const co = Math.cos(-a), si = Math.sin(-a);
    let inter = 0, mod = 0;
    for (const [e, n, f] of celdas) {
      const dx = (e - t[0]) / s, dy = (n - t[1]) / s;
      const x = co * dx - si * dy + c[0], y = si * dx + co * dy + c[1];
      const i = Math.floor(x - sup.x0), j = Math.floor(y - sup.y0);
      const m = i >= 0 && j >= 0 && i < sup.W && j < sup.H && alzado[j * sup.W + i] ? 1 : 0;
      mod += m; inter += m & f;
    }
    return inter / (enHuella + mod - inter);
  }
  // Centro de la huella con pisos, para empezar.
  let ce = 0, cn = 0;
  for (const [e, n, f] of celdas) if (f) { ce += e; cn += n; }
  let mejor = { a: 0, s: 1, t: [ce / enHuella, cn / enHuella], v: -1 };
  for (let g = 0; g < 360; g += 3) {
    const a = g * Math.PI / 180;
    for (const dx of [-10, 0, 10]) for (const dy of [-10, 0, 10]) {
      const t = [ce / enHuella + dx, cn / enHuella + dy], v = iou(a, 1, t);
      if (v > mejor.v) mejor = { a, s: 1, t, v };
    }
  }
  // Fino: un parámetro a la vez, pasos que se achican.
  for (const paso of [1, 0.5, 0.25, 0.1, 0.05]) {
    let mejoro = true;
    while (mejoro) {
      mejoro = false;
      for (const [k, d] of [['a', paso * Math.PI / 180], ['s', paso / 100], ['tx', paso], ['ty', paso]]) for (const sg of [-1, 1]) {
        const q = { a: mejor.a, s: mejor.s, t: mejor.t.slice() };
        if (k === 'a') q.a += sg * d; else if (k === 's') q.s += sg * d; else q.t[k === 'tx' ? 0 : 1] += sg * d;
        const v = iou(q.a, q.s, q.t);
        if (v > mejor.v + 1e-6) { mejor = Object.assign(q, { v }); mejoro = true; }
      }
    }
  }
  return Object.assign(mejor, { c, iou: (a, s, t) => iou(a, s, t) });
}

// ── Máscara de la huella con borde, en una grilla de 0,5 m (mundo) ─────────
function mascara(anillosTodos, borde) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const an of anillosTodos) for (const r of an) for (const [e, n] of r) { x0 = Math.min(x0, e); x1 = Math.max(x1, e); y0 = Math.min(y0, n); y1 = Math.max(y1, n); }
  x0 -= borde + 1; y0 -= borde + 1; x1 += borde + 1; y1 += borde + 1;
  const P = 0.5, W = Math.ceil((x1 - x0) / P), Hh = Math.ceil((y1 - y0) / P), m = new Uint8Array(W * Hh);
  const segs = [];
  for (const an of anillosTodos) for (const r of an) for (let i = 0; i < r.length - 1; i++) segs.push([r[i], r[i + 1]]);
  const dSeg = (p, [a, b]) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  };
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const p = [x0 + (i + 0.5) * P, y0 + (j + 0.5) * P];
    if (anillosTodos.some((an) => dentro(p, an))) { m[j * W + i] = 2; continue; }
    if (segs.some((s) => dSeg(p, s) <= borde)) m[j * W + i] = 1;
  }
  return { en: (e, n) => { const i = Math.floor((e - x0) / P), j = Math.floor((n - y0) / P); return i >= 0 && j >= 0 && i < W && j < Hh ? m[j * W + i] : 0; } };
}

// ── Textura: rasteriza los triángulos en la hoja para saber qué píxeles se usan ──
function usados(T, uv, idx, dil) {
  const m = new Uint8Array(T * T);
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map((k) => [uv[2 * idx[t + k]] * T, uv[2 * idx[t + k] + 1] * T]);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs)) - dil), i1 = Math.min(T - 1, Math.ceil(Math.max(...xs)) + dil);
    const j0 = Math.max(0, Math.floor(Math.min(...ys)) - dil), j1 = Math.min(T - 1, Math.ceil(Math.max(...ys)) + dil);
    // Caja del triángulo con borde: barato y de sobra para triángulos de pocos píxeles; los
    // grandes se prueban por dentro con el borde.
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if ((i1 - i0) * (j1 - j0) > 64 && Math.abs(area) > 1e-9) {
        const x = i + 0.5, y = j + 0.5;
        const w0 = ((p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y)) / area;
        const w1 = ((p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y)) / area;
        const w2 = 1 - w0 - w1, tol = dil / Math.sqrt(Math.abs(area));
        if (w0 < -tol || w1 < -tol || w2 < -tol) continue;
      }
      m[j * T + i] = 1;
    }
  }
  return m;
}

function escribirGlb(pos, uv, idx, jpg, asset, extras) {
  const nv = pos.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  const pad4 = (x) => (x + 3) & ~3;
  const partes = [pos, uv, idx, jpg];
  const offs = []; let o = 0;
  for (const p of partes) { offs.push(o); o = pad4(o + p.byteLength); }
  const bin = new Uint8Array(o);
  partes.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offs[i]));
  const json = {
    asset: Object.assign({ version: '2.0', generator: 'Bogotwin pipelines/hitos/fotogrametria.js' }, asset),
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: extras.nombre }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ name: 'fotogrametría', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 3, mimeType: 'image/jpeg' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[1], byteLength: uv.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: idx.byteLength, target: 34963 },
      { buffer: 0, byteOffset: offs[3], byteLength: jpg.byteLength }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, normalized: true, count: nv, type: 'VEC2' },
      { bufferView: 2, componentType: nv > 65535 ? 5125 : 5123, count: idx.length, type: 'SCALAR' }
    ],
    extras: extras.extras
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const b0 = 20 + js.length;
  out.writeUInt32LE(bin.length, b0); out.writeUInt32LE(0x004e4942, b0 + 4); Buffer.from(bin).copy(out, b0 + 8);
  return out;
}

async function procesar(c, lamina) {
  const { MeshoptSimplifier: S } = require('meshoptimizer');
  const sharp = require('sharp');
  await S.ready;
  const crypto = require('crypto');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(c.fuente)).digest('hex');
  if (sha !== c.sha256) throw new Error('El GLB de ' + c.id + ' no es el descargado (sha256 distinto)');

  // Huella de Catastro: todas las piezas (recorte) y las que tienen pisos (ajuste, sombra).
  const huellas = JSON.parse(fs.readFileSync(path.join(AQUI, 'huellas-catastro.geojson'), 'utf8')).features.filter((f) => f.properties.hito === c.id);
  const lons = [], lats = [];
  for (const f of huellas) for (const r of f.geometry.coordinates) for (const [a, b] of r) { lons.push(a); lats.push(b); }
  const o = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2].map((x) => Math.round(x * 1e7) / 1e7);
  const m = aMetros(o[0], o[1]);
  const anillos = (f) => f.geometry.coordinates.map((r) => r.map(([a, b]) => m(a, b)));
  const todas = huellas.map(anillos);
  const conPisos = huellas.filter((f) => f.properties.pisos >= 1);

  // 1 y 2. Ejes, suelo del modelo y ajuste.
  const partes = leer(c).filter((p) => p.uv && p.img);
  const sup = superficie(partes);
  const anillo = [];
  for (let j = 0; j < sup.H; j++) for (let i = 0; i < sup.W; i++) {
    const r = Math.hypot(i + sup.x0 - sup.cx, j + sup.y0 - sup.cy);
    if (r > 80 && r < 95) anillo.push(sup.z[j * sup.W + i]);
  }
  const sueloLejos = mediana(anillo);
  const alzado = new Uint8Array(sup.W * sup.H);
  for (let k = 0; k < alzado.length; k++) alzado[k] = sup.z[k] - sueloLejos > 3 ? 1 : 0;
  const aj = ajustar(sup, alzado, conPisos.map(anillos));
  const aW = aMundo(aj.a, aj.s, aj.t, aj.c);

  // 3. Recorte (centro del triángulo dentro de la huella más 3 m) y paso al mundo.
  const mk = mascara(todas, 3);
  const imgs = [];
  const P = [], UV = [], I = [];
  partes.forEach((p, k) => {
    let im = imgs.findIndex((b) => b.equals(p.img));
    if (im < 0) { imgs.push(p.img); im = imgs.length - 1; }
    const nuevo = new Map();
    for (let t = 0; t < p.idx.length; t += 3) {
      let ce = 0, cn = 0;
      for (let q = 0; q < 3; q++) { const v = p.idx[t + q]; ce += p.pos[3 * v] / 3; cn += p.pos[3 * v + 1] / 3; }
      const [we, wn] = aW(ce, cn);
      if (!mk.en(we, wn)) continue;
      for (let q = 0; q < 3; q++) {
        const v = p.idx[t + q];
        let j = nuevo.get(v);
        if (j === undefined) {
          j = P.length / 3; nuevo.set(v, j);
          const [e, n] = aW(p.pos[3 * v], p.pos[3 * v + 1]);
          P.push(e, n, p.pos[3 * v + 2] * aj.s);
          UV.push(p.uv[2 * v], p.uv[2 * v + 1], im);
        }
        I.push(j);
      }
    }
  });
  // 5. Suelo de alrededor: superficie de arriba del modelo en la franja de 4 a 12 m por fuera.
  const franja = mascara(todas, 12), cerca = mascara(todas, 4);
  const enFranja = [];
  for (let j = 0; j < sup.H; j++) for (let i = 0; i < sup.W; i++) {
    const z = sup.z[j * sup.W + i];
    if (!Number.isFinite(z)) continue;
    const [e, n] = aW(i + sup.x0 + 0.5, j + sup.y0 + 0.5);
    if (franja.en(e, n) && !cerca.en(e, n)) enFranja.push(z * aj.s);
  }
  const suelo = mediana(enFranja);
  for (let i = 2; i < P.length; i += 3) P[i] -= suelo;
  const recortados = I.length / 3;

  // 4. Reducción. Posiciones (e, n, arriba) en float32 y uv con la hoja de cada uno.
  const pos = new Float32Array(P), idx0 = new Uint32Array(I);
  // Las costuras entre trozos del modelo frenan la reducción; «Permissive» deja cruzarlas
  // cuidando las uv (y mucho la hoja, para no mezclar texturas).
  const atr = new Float32Array(UV.map((x, k) => (k % 3 === 2 ? x * 10 : x)));
  const [idxS, err] = S.simplifyWithAttributes(idx0, pos, 3, atr, 3, [4, 4, 40], null, Math.min(idx0.length, c.triangulos * 3), 0.2, ['Permissive']);
  const [remap, nv] = S.compactMesh(idxS);
  const posF = new Float32Array(nv * 3), uvF = new Uint16Array(nv * 2), hojaDe = new Uint8Array(nv);
  for (let v = 0; v < remap.length; v++) {
    const j = remap[v];
    if (j === 0xffffffff || j === undefined) continue;
    // glTF: x este, y arriba, z sur (giro de determinante 1: el sentido se conserva).
    posF[3 * j] = Math.round(pos[3 * v] * 1000) / 1000;
    posF[3 * j + 1] = Math.round(pos[3 * v + 2] * 1000) / 1000;
    posF[3 * j + 2] = Math.round(-pos[3 * v + 1] * 1000) / 1000;
    const h = UV[3 * v + 2];
    uvF[2 * j] = Math.round(Math.min(1, Math.max(0, (h + UV[3 * v]) / imgs.length)) * 65535);
    uvF[2 * j + 1] = Math.round(Math.min(1, Math.max(0, UV[3 * v + 1])) * 65535);
    hojaDe[j] = h;
  }
  const idxF = nv > 65535 ? Uint32Array.from(idxS) : Uint16Array.from(idxS);

  // Hoja de textura: las texturas lado a lado; lo que no se usa, de un color plano.
  const T = c.textura;
  const tiras = [];
  for (let h = 0; h < imgs.length; h++) {
    const uvH = [], idxH = [];
    for (let t = 0; t < idxF.length; t += 3) if (hojaDe[idxF[t]] === h) for (let q = 0; q < 3; q++) idxH.push(idxF[t + q]);
    for (let j = 0; j < nv; j++) uvH.push(uvF[2 * j] / 65535 * imgs.length - h, uvF[2 * j + 1] / 65535);
    const usa = usados(T, uvH, idxH, 3);
    const { data } = await sharp(imgs[h]).resize(T, T, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < T * T; k++) if (usa[k]) { r += data[3 * k]; g += data[3 * k + 1]; b += data[3 * k + 2]; n++; }
    for (let k = 0; k < T * T; k++) if (!usa[k]) { data[3 * k] = r / n; data[3 * k + 1] = g / n; data[3 * k + 2] = b / n; }
    tiras.push({ input: data, raw: { width: T, height: T, channels: 3 }, left: h * T, top: 0 });
  }
  const jpg = await sharp({ create: { width: T * imgs.length, height: T, channels: 3, background: '#808080' } })
    .composite(tiras).jpeg({ quality: c.calidad, mozjpeg: true }).toBuffer();
  if (lamina) fs.writeFileSync(path.join(lamina, c.id + '-textura.jpg'), jpg);

  const asset = { copyright: '"' + c.titulo + '" por ' + c.autor + ' (' + c.corto + '), CC BY 4.0. Recortado, reducido y ubicado por Bogotwin' };
  const glb = escribirGlb(posF, uvF, idxF, jpg, asset, { nombre: c.id, extras: { licencia: 'CC BY 4.0', autor: c.autor, fuente: c.url, procedencia: c.id + '.procedencia.json' } });

  // Alto, sombra y contorno.
  let alto = 0;
  for (let i = 1; i < posF.length; i += 3) alto = Math.max(alto, posF[i]);
  let bajo = Infinity;
  for (let i = 1; i < posF.length; i += 3) bajo = Math.min(bajo, posF[i]);
  const sombra = [];
  for (const f of conPisos) {
    const an = anillos(f), alturas = [];
    for (let i = 0; i < posF.length; i += 3) if (dentro([posF[i], -posF[i + 2]], an)) alturas.push(posF[i + 1]);
    alturas.sort((p, q) => p - q);
    const a = alturas.length ? alturas[Math.floor(alturas.length * 0.95)] : 0;
    if (a > 1) sombra.push({ anillo: aliviar(an[0], 0.3).map(([e, n]) => [Math.round(e * 10) / 10, Math.round(n * 10) / 10]), alto: Math.round(a * 10) / 10, fid: f.properties.fid });
  }
  const contorno = aliviar(envolvente(todas.flatMap((an) => an[0])), 0.3);

  // Desajuste con la huella: distancia de cada vértice del borde de Catastro al borde de lo
  // que el modelo levanta (rejilla de 1 m), en metros.
  const lev = (e, n) => {
    const co = Math.cos(-aj.a), si = Math.sin(-aj.a), dx = (e - aj.t[0]) / aj.s, dy = (n - aj.t[1]) / aj.s;
    const x = co * dx - si * dy + aj.c[0], y = si * dx + co * dy + aj.c[1];
    const i = Math.floor(x - sup.x0), j = Math.floor(y - sup.y0);
    return i >= 0 && j >= 0 && i < sup.W && j < sup.H && alzado[j * sup.W + i] === 1;
  };
  const dists = [];
  for (const f of conPisos) for (const r of anillos(f)) for (const [e, n] of r) {
    let d = 0;
    for (; d < 15; d += 0.5) {
      let cambio = false;
      for (let g = 0; g < 16 && !cambio; g++) { const a = g * Math.PI / 8; if (lev(e + d * Math.cos(a), n + d * Math.sin(a)) !== lev(e, n) || d === 0) cambio = d > 0 && lev(e + d * Math.cos(a), n + d * Math.sin(a)) !== lev(e, n); }
      if (cambio) break;
    }
    dists.push(d);
  }
  dists.sort((p, q) => p - q);
  const ajuste = {
    giro_grados: Math.round(aj.a * 180 / Math.PI * 100) / 100, escala: Math.round(aj.s * 10000) / 10000, iou: Math.round(aj.v * 1000) / 1000,
    borde_mediana_m: dists[Math.floor(dists.length / 2)], borde_p90_m: dists[Math.floor(dists.length * 0.9)],
    iou_giro_mas_menos_1: [Math.round(aj.iou(aj.a - Math.PI / 180, aj.s, aj.t) * 1000) / 1000, Math.round(aj.iou(aj.a + Math.PI / 180, aj.s, aj.t) * 1000) / 1000],
    iou_escala_1: Math.round(aj.iou(aj.a, 1, aj.t) * 1000) / 1000
  };
  return { o, glb, nv, triangulos: idxF.length / 3, recortados, original: partes.reduce((s, p) => s + p.idx.length / 3, 0), error: err, alto, bajo, sombra, contorno, ajuste, suelo, sueloLejos, jpg: jpg.length, T, hojas: imgs.length };
}

function escribir(c, r) {
  fs.writeFileSync(path.join(SALIDA, c.id + '.glb'), r.glb);
  const ids = JSON.parse(fs.readFileSync(path.join(AQUI, 'catastro-ids.json'), 'utf8'));
  const oc = ids.hitos[c.id] || {};
  const altoTxt = Math.round(r.alto * 10) / 10;
  const fidList = r.sombra.map((s) => s.fid);
  const procedencia = {
    hito: c.nombre, archivo: c.id + '.glb', fecha: c.fecha,
    autor: c.autor + ' (fotogrametría con dron del 5 nov 2016, publicada en Sketchfab)',
    licencia: CC_BY,
    atribucion: '«' + c.titulo + '» por ' + c.autor + ' (' + c.url + '), CC BY 4.0. Recortado, reducido y ubicado por Bogotwin',
    tipo: 'fotogrametría (medido por el autor; la ubicación es un ajuste nuestro a la huella de Catastro)',
    fuentes: [
      { que: 'Modelo 3D con textura (434.700 triángulos, textura de 4096 px)', de: c.autor + ', Sketchfab, «' + c.titulo + '»', licencia: 'CC BY 4.0', url: c.url },
      { que: 'Huella para ubicar, recortar y esconder las cajas', de: 'UAECD, Catastro Bogotá, construcciones (CONST_V2), fid ' + huellasFids(c.id).join(', '), licencia: 'CC BY 4.0', url: 'https://datosabiertos.bogota.gov.co/' }
    ],
    supuestos: [
      'El modelo no trae coordenadas: lo ubicamos girándolo, escalándolo y corriéndolo hasta que lo que levanta más de 3 m cae sobre las piezas de Catastro con pisos (ver «ajuste»).',
      'El suelo (y = 0) es la mediana del modelo en una franja de 4 a 12 m por fuera de la huella; las rampas y patios hundidos quedan bajo cero y el relieve del mapa los tapa.',
      'Es la biblioteca de noviembre de 2016: lo que cambió después no está.'
    ],
    referencias_visuales: 'Ninguna foto aparte: la textura es la de la fotogrametría del autor, reducida.',
    cambios: 'Recortado a la huella de Catastro más 3 m (quedan ' + r.recortados + ' de ' + r.original + ' triángulos; fuera el parque alrededor y una pieza sin textura de 378), reducido con meshoptimizer a ' + r.triangulos + ' triángulos, sin normales (el visor las calcula), las tres texturas de 4096 px reducidas a ' + r.T + ' px y unidas en una hoja JPEG; lo que el recorte no usa va de un color plano. Ejes pasados a x este, y arriba, z sur, en metros.',
    ajuste: r.ajuste,
    origen: { lon: r.o[0], lat: r.o[1], ejes: 'x este, y arriba, z sur, en metros; y = 0 en el suelo' },
    triangulos: r.triangulos, vertices: r.nv, bytes: r.glb.length
  };
  fs.writeFileSync(path.join(SALIDA, c.id + '.procedencia.json'), JSON.stringify(procedencia, null, 1) + '\n');
  const entrada = {
    id: c.id, nombre: c.nombre, lon: r.o[0], lat: r.o[1], glb: 'hitos/' + c.id + '.glb', bytes: r.glb.length,
    triangulos: r.triangulos, alto: altoTxt, altoTexto: altoTxt + ' m sobre el suelo de alrededor (fotogrametría de 2016)',
    altos: [{ que: 'Alto', valor: String(altoTxt).replace('.', ',') + ' m', tipo: 'de_fuente', de: 'fotogrametría de ' + c.autor + ', 2016' }],
    tipo: 'fotogrametria',
    fuente: '«' + c.titulo + '» por ' + c.autor + ', en Sketchfab',
    autor: c.autor,
    licencia: CC_BY,
    procedencia: 'hitos/' + c.id + '.procedencia.json',
    contorno: r.contorno,
    ocultar: { cerca: oc.cerca || [], lejos: oc.lejos || [], osm: oc.osm || [] },
    sombra: r.sombra.map(({ anillo, alto }) => ({ anillo, alto }))
  };
  void fidList;
  // Al catálogo, sin tocar los demás hitos.
  const cf = path.join(SALIDA, 'catalogo.json');
  const cat = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const i = cat.hitos.findIndex((h) => h.id === c.id);
  if (i >= 0) cat.hitos[i] = entrada; else cat.hitos.push(entrada);
  fs.writeFileSync(cf, JSON.stringify(cat, null, 1) + '\n');
  return entrada;
}
// Douglas-Peucker: las piezas curvas de Catastro traen cientos de vértices; a 0,3 m sobran.
function aliviar(r, tol) {
  if (r.length < 4) return r;
  const d = (p, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  };
  const guardar = new Uint8Array(r.length); guardar[0] = guardar[r.length - 1] = 1;
  const pila = [[0, r.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    let k = -1, m = tol;
    for (let q = i + 1; q < j; q++) { const v = d(r[q], r[i], r[j]); if (v > m) { m = v; k = q; } }
    if (k > 0) { guardar[k] = 1; pila.push([i, k], [k, j]); }
  }
  return r.filter((_, i) => guardar[i]);
}
function huellasFids(id) {
  return JSON.parse(fs.readFileSync(path.join(AQUI, 'huellas-catastro.geojson'), 'utf8')).features.filter((f) => f.properties.hito === id).map((f) => f.properties.fid);
}

if (require.main === module) {
  (async () => {
    const c = VIRGILIO;
    const r = await procesar(c, process.argv[2] || null);
    const e = escribir(c, r);
    console.log(c.id, r.triangulos, 'triángulos,', r.nv, 'vértices,', r.glb.length, 'bytes (textura', r.jpg, 'bytes),', 'alto', e.alto, 'm, bajo', r.bajo.toFixed(1), 'm');
    console.log('recorte', r.recortados, 'de', r.original, '· error de la reducción', r.error.toFixed(4), '· suelo', r.suelo.toFixed(2), '(lejos', r.sueloLejos.toFixed(2) + ')');
    console.log('ajuste', JSON.stringify(r.ajuste));
  })().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { VIRGILIO, leer, superficie, ajustar, aMundo, mediana, procesar };
