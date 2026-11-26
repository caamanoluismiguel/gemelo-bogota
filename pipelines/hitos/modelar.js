'use strict';
// Modela en código los hitos sin modelo libre y escribe site/hitos/*.glb, su procedencia y el
// catálogo que lee site/hitos.js.
//
//   node pipelines/hitos/modelar.js
//
// Entradas: huellas-catastro.geojson (huellas de UAECD, CC BY 4.0) y catastro-ids.json (los
// ids de las cajas de Catastro que tapa cada hito, de catastro-ids.js).
//
// Lo que es dato: la huella (Catastro) y los altos que tienen fuente pública (Colpatria 196 m,
// torres de la Catedral 52 m). Lo demás (alto de cornisas, techos, columnas, gradas) es un
// supuesto de forma para que el hito se reconozca; cada modelo lo dice en su procedencia y la
// ventana del mapa lo marca como «supuesto».
const fs = require('fs');
const path = require('path');
const G = require('./geometria');
const { aMetros } = require('./catastro-ids');

const AQUI = __dirname;
const SALIDA = path.join(AQUI, '../../site/hitos');
const FECHA = '2026-11-25';
const BAJO = -6;   // los muros bajan 6 m bajo el suelo: en una ladera nada queda flotando
const CC_BY = { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' };
const CREDITO_HUELLA = 'Huella: UAECD, Catastro Bogotá, Datos Abiertos Bogotá (CC BY 4.0)';

const huellas = JSON.parse(fs.readFileSync(path.join(AQUI, 'huellas-catastro.geojson'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(AQUI, 'catastro-ids.json'), 'utf8'));

function piezas(hito) {
  return huellas.features.filter((f) => f.properties.hito === hito);
}
// Origen del hito: centro de la caja de todas sus huellas.
function origen(fs_) {
  const lons = [], lats = [];
  for (const f of fs_) for (const r of f.geometry.coordinates) for (const [a, b] of r) { lons.push(a); lats.push(b); }
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2].map((x) => Math.round(x * 1e7) / 1e7);
}
const enMetros = (f, m) => f.geometry.coordinates.map((r) => G.limpiar(r.map(([a, b]) => m(a, b))));

// Contorno para tocar el hito en el mapa: envolvente convexa de la planta, en metros.
function envolvente(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

// ── Colores (rgb 0 a 255). Tonos de los materiales, sin texturas ──────────
const C = {
  vidrio: [104, 118, 132], aleta: [214, 211, 203], coronaCol: [196, 196, 190], azotea: [140, 142, 144],
  piedraCat: [214, 204, 182], tejaCat: [150, 104, 86], cupula: [176, 170, 160], piedraBaja: [200, 190, 170],
  piedraCap: [216, 206, 186], techoCap: [204, 192, 172], columna: [222, 217, 204], gradaCap: [176, 170, 160], patio: [170, 166, 158],
  ladrillo: [156, 86, 58], cornisa: [190, 128, 92], grada: [186, 176, 160], contrahuella: [138, 128, 114], arena: [200, 164, 108], cubierta: [132, 78, 56]
};

// ── Torre Colpatria ─────────────────────────────────────────────────────────
// Alto: 196 m (Wikipedia en español, «Torre Colpatria», que cita a SkyscraperPage); azotea y
// mirador a 192 m y helipuerto encima. La planta es la de Catastro: un cuadrado de unos 25 m
// con las esquinas cortadas. Las aletas verticales de concreto claro sobre el vidrio son la
// forma conocida de la fachada; su número y medidas son un supuesto.
function colpatria() {
  const fs_ = piezas('colpatria');
  const o = origen(fs_), m = aMetros(o[0], o[1]);
  const torre = enMetros(fs_.find((f) => f.properties.fid === 153239), m)[0];
  const corona = enMetros(fs_.find((f) => f.properties.fid === 154534), m)[0];
  const M = new G.Malla();
  const CUERPO = 186, AZOTEA = 192, TOPE = 196;
  M.prisma([torre], BAJO, CUERPO, C.vidrio, C.azotea);
  // Aletas: cada 2,6 m en los lados largos, 0,7 m de ancho y 0,5 m hacia afuera.
  const r = G.areaConSigno(torre) > 0 ? torre : torre.slice().reverse();
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 8) continue;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm = [d[1], -d[0]];
    const n = Math.floor((L - 1.4) / 2.6);
    const s0 = (L - (n - 1) * 2.6) / 2;
    for (let k = 0; k < n; k++) {
      const s = s0 + k * 2.6;
      const p = (ds, dn) => [a[0] + d[0] * (s + ds) + nrm[0] * dn, a[1] + d[1] * (s + ds) + nrm[1] * dn];
      M.prisma([[p(-0.35, -0.05), p(0.35, -0.05), p(0.35, 0.5), p(-0.35, 0.5)]], 2, CUERPO + 1, C.aleta, C.aleta);
    }
  }
  // Remate: la planta octogonal de Catastro (la más alta) hasta la azotea, y el helipuerto.
  M.prisma([corona], CUERPO, AZOTEA, C.coronaCol, C.azotea);
  // Sombra: la del remate y la del helipuerto se cuentan desde el suelo, como la del cuerpo.
  M.sombraDe(corona, AZOTEA);
  let cx = 0, cy = 0;
  for (const q of corona) { cx += q[0]; cy += q[1]; }
  cx /= corona.length; cy /= corona.length;
  const H = G.marco([cx, cy], Math.atan2(torre[1][1] - torre[0][1], torre[1][0] - torre[0][0]) * 180 / Math.PI);
  M.caja(H, -5, 5, -5, 5, AZOTEA, TOPE - 0.6, C.coronaCol, C.azotea);
  M.caja(H, -6.5, 6.5, -6.5, 6.5, TOPE - 0.6, TOPE, C.azotea, C.azotea);
  M.sombraDe([H.pt(-5, -5), H.pt(5, -5), H.pt(5, 5), H.pt(-5, 5)], TOPE);
  return {
    id: 'colpatria', nombre: 'Torre Colpatria', origen: o, malla: M, alto: TOPE, fids: [153239, 154534], planta: torre,
    altoTexto: '196 m (Wikipedia, que cita a SkyscraperPage)',
    altos: [{ que: 'Alto', valor: '196 m', tipo: 'de_fuente', de: 'Wikipedia, que cita a SkyscraperPage' },
      { que: 'Cuerpo y remate', valor: '186 m y 192 m', tipo: 'supuesto' }],
    fuentes: [
      { que: 'Huella de la torre y del remate', de: 'UAECD, Catastro Bogotá, construcciones (CONST_V2), fid 153239 y 154534', licencia: 'CC BY 4.0', url: 'https://datosabiertos.bogota.gov.co/' },
      { que: 'Alto total de 196 m, 50 pisos, terminada en 1978', de: 'Wikipedia en español, «Torre Colpatria» (cita a SkyscraperPage)', url: 'https://es.wikipedia.org/wiki/Torre_Colpatria' }
    ],
    supuestos: ['Cuerpo hasta 186 m, remate octogonal hasta 192 m y helipuerto hasta 196 m: el reparto es un supuesto; el total es el dato publicado.',
      'Aletas verticales claras cada 2,6 m sobre fachada de vidrio gris azulado: forma conocida de la fachada, medidas supuestas.',
      'Sin ventanas, pisos ni luces de la fachada.']
  };
}

// ── Catedral Primada ────────────────────────────────────────────────────────
// Dato: torres de 52 m (Wikipedia en español, «Catedral Primada de Colombia»), fachada
// neoclásica hacia la Plaza de Bolívar (al oeste), dos torres en las esquinas de la fachada.
// Supuestos: alto de la nave, naves laterales, frontón y remate de las torres.
function catedral() {
  const fs_ = piezas('catedral-primada');
  const o = origen(fs_), m = aMetros(o[0], o[1]);
  const pz = (fid) => enMetros(fs_.find((f) => f.properties.fid === fid), m);
  const nave = pz(1688);
  // Marco de la nave: u a lo largo (hacia el oriente, lejos de la plaza), v hacia el norte.
  // El ángulo es el de los muros largos de la huella de Catastro (-31,2°).
  const ang = -31.2;
  // El origen del marco es el centro de la caja girada de la nave.
  const M0 = G.marco([0, 0], ang);
  const uv = nave[0].map((p) => M0.uv(p));
  const u0 = Math.min(...uv.map((q) => q[0])), u1 = Math.max(...uv.map((q) => q[0]));
  // La fachada va en u0; el cuerpo principal de la nave entre v -19,5 y 17,6 m (medido en la
  // huella con el marco centrado en el origen del hito).
  const M = M0;
  const A = new G.Malla();
  // Partes bajas: la huella entera de la nave a 10 m y los anexos de 3 pisos a 9 m.
  A.prisma(nave, BAJO, 10, C.piedraBaja, C.tejaCat);
  for (const fid of [5669, 6561]) A.prisma(pz(fid), BAJO, 9, C.piedraBaja, C.tejaCat);
  const vS = -19.5, vN = 17.6, fa = u0, fb = u0 + 5.8;
  const finNave = Math.min(u1 - 14, 38.3);
  // Naves laterales hasta 18 m.
  A.caja(M, fb, finNave, vS, vN, BAJO, 18, C.piedraCat, C.tejaCat);
  // Nave central: muros hasta 24 m y techo a dos aguas hasta 30 m.
  A.caja(M, fb, finNave - 2, -8, 8, 18, 24, C.piedraCat, C.tejaCat);
  A.dosAguas(M, fb, finNave - 2, -8.4, 8.4, 24, 30, C.tejaCat, C.piedraCat);
  // Cuerpo de la fachada entre las torres, hasta 30 m, con frontón hasta 36 m.
  const tN0 = vN - 8, tS1 = vS - 0.7 + 8;
  A.caja(M, fa, fb + 0.5, tS1, tN0, BAJO, 30, C.piedraCat, C.piedraCat);
  A.dosAguas(M, fa - 0.4, fb + 0.5, tS1, tN0, 30, 36, C.piedraCat, C.piedraCat);
  // Torres de 52 m en las dos esquinas de la fachada (la norte con el reloj).
  for (const [t0, t1] of [[tN0, vN], [vS - 0.7, tS1]]) {
    A.caja(M, fa, fa + 8, t0, t1, BAJO, 34, C.piedraCat, C.piedraCat);
    A.caja(M, fa + 0.7, fa + 7.3, t0 + 0.7, t1 - 0.7, 34, 43, C.piedraCat, C.piedraCat);
    A.caja(M, fa - 0.2, fa + 8.2, t0 - 0.2, t1 + 0.2, 43, 44.2, C.piedraCat, C.cupula);
    const c = M.pt(fa + 4, (t0 + t1) / 2);
    A.columna(c, 3.6, 3.2, 44.2, 46, 8, C.cupula);
    A.columna(c, 3.2, 1.9, 46, 49, 8, C.cupula);
    A.columna(c, 1.9, 0.6, 49, 50.6, 8, C.cupula, true);
    A.columna(c, 0.6, 0.5, 50.6, 52, 6, C.cupula, true);
    // Sombra de la torre con el campanario y la base de la cúpula (lo fino de arriba no cuenta).
    A.sombraDe([M.pt(fa, t0), M.pt(fa + 8, t0), M.pt(fa + 8, t1), M.pt(fa, t1)], 46);
  }
  return {
    id: 'catedral-primada', nombre: 'Catedral Primada de Colombia', origen: o, malla: A, alto: 52, fids: [1688, 5669, 122, 6561], planta: nave[0],
    altoTexto: 'torres de 52 m (Wikipedia); la nave es un supuesto',
    altos: [{ que: 'Torres', valor: '52 m', tipo: 'de_fuente', de: 'Wikipedia' },
      { que: 'Nave', valor: '24 m, techo hasta 30 m', tipo: 'supuesto' }],
    fuentes: [
      { que: 'Huella de la nave y de los anexos', de: 'UAECD, Catastro Bogotá, construcciones (CONST_V2), fid 1688, 5669, 122 y 6561. La Capilla del Sagrario (fid 6007) queda aparte', licencia: 'CC BY 4.0', url: 'https://datosabiertos.bogota.gov.co/' },
      { que: 'Torres de 52 m, fachada neoclásica hacia la Plaza de Bolívar con dos torres', de: 'Wikipedia en español, «Catedral Primada de Colombia»', url: 'https://es.wikipedia.org/wiki/Catedral_Primada_de_Colombia' }
    ],
    supuestos: ['Naves laterales hasta 18 m, nave central hasta 24 m con techo a dos aguas hasta 30 m.',
      'Cuerpo de la fachada hasta 30 m con frontón hasta 36 m.',
      'Torres de 8 × 8 m (la huella de Catastro no las separa); cuerpo hasta 34 m, campanario hasta 43 m y remate redondeado hasta 52 m.',
      'Anexos de 3 pisos a 9 m; el resto de la huella a 10 m.']
  };
}

// ── Capitolio Nacional ──────────────────────────────────────────────────────
// Dato: fachada norte hacia la Plaza de Bolívar con una columnata jónica (Wikipedia en español,
// «Capitolio Nacional de Colombia»), cuatro patios, piedra. La huella de Catastro deja abierto
// el patio de la fachada, entre las dos alas: ahí va la columnata. Altos: supuestos.
function capitolio() {
  const fs_ = piezas('capitolio');
  const o = origen(fs_), m = aMetros(o[0], o[1]);
  const A = new G.Malla();
  const ALTO = { 3: 21, 2: 17, 0: 4 };
  for (const f of fs_) A.prisma(enMetros(f, m), BAJO, ALTO[f.properties.pisos], f.properties.pisos === 0 ? C.patio : C.piedraCap, f.properties.pisos === 0 ? C.patio : C.techoCap);
  // Marco: a hacia la plaza (59°), b a lo largo de la fachada. Origen en el mismo punto que se
  // usó para medir la huella (lon -74.0766, lat 4.5973), pasado al origen del hito.
  const base = m(-74.0766, 4.5973);
  const M = G.marco(base, 59);
  // Columnata: 6 columnas de frente por 3 de fondo, entre las alas (b de -25 a 0 m).
  const b0 = -25, b1 = 0, filas = [40.6, 37.2, 33.8];
  A.caja(M, 32.2, 42.3, b0, b1, BAJO, 1.2, C.piedraCap, C.gradaCap);
  for (const a of filas) {
    for (let k = 0; k < 6; k++) {
      const c = M.pt(a, b0 + (b1 - b0) * (k + 0.5) / 6);
      A.columna(c, 0.95, 0.95, 1.2, 1.8, 8, C.columna);
      A.columna(c, 0.7, 0.6, 1.8, 14.2, 10, C.columna);
      A.columna(c, 0.95, 0.95, 14.2, 14.8, 8, C.columna, true);
    }
    A.caja(M, a - 1, a + 1, b0, b1, 14.8, 17, C.piedraCap, C.techoCap);
  }
  // Viga de amarre a lo largo, sobre la columnata (cierra el marco contra las alas).
  for (const b of [b0 + 0.6, b1 - 0.6]) A.caja(M, 32.6, 41.6, b - 0.6, b + 0.6, 14.8, 17, C.piedraCap, C.techoCap);
  return {
    id: 'capitolio', nombre: 'Capitolio Nacional', origen: o, malla: A, alto: 21, fids: fs_.map((f) => f.properties.fid), planta: fs_.flatMap((f) => enMetros(f, m)[0]),
    altoTexto: 'alas a 17 m y cuerpo central a 21 m (supuesto)',
    altos: [{ que: 'Alto', valor: 'alas a 17 m, cuerpo central a 21 m', tipo: 'supuesto' }],
    fuentes: [
      { que: 'Huella de las alas, el cuerpo central y los patios', de: 'UAECD, Catastro Bogotá, construcciones (CONST_V2), fid ' + fs_.map((f) => f.properties.fid).join(', '), licencia: 'CC BY 4.0', url: 'https://datosabiertos.bogota.gov.co/' },
      { que: 'Fachada hacia la Plaza de Bolívar con columnata jónica, cuatro patios, piedra', de: 'Wikipedia en español, «Capitolio Nacional de Colombia»', url: 'https://es.wikipedia.org/wiki/Capitolio_Nacional_de_Colombia' }
    ],
    supuestos: ['Alas de 2 pisos a 17 m y cuerpo central de 3 pisos a 21 m (pisos de Catastro; alto por piso supuesto).',
      'Columnata de 6 × 3 columnas de 13 m con su viga hasta 17 m, en el patio abierto de la fachada.',
      'Las piezas de 0 pisos de Catastro (patios interiores) a 4 m.', 'Techos planos, sin balaustradas ni cornisas.']
  };
}

// ── Plaza de toros La Santamaría ───────────────────────────────────────────
// Dato: ruedo y anillo de la huella de Catastro (el hueco es el ruedo), plaza de ladrillo
// neomudéjar inaugurada en 1931 (Wikipedia en español, «Plaza de toros de Santamaría»).
// Supuestos: muro exterior de 15 m, graderío de 1,6 a 12 m, galería alta de 12 a 15 m.
function santamaria() {
  const fs_ = piezas('santamaria');
  const o = origen(fs_), m = aMetros(o[0], o[1]);
  const [ext0, ruedo0] = fs_[0].geometry.coordinates.map((r) => r.map(([a, b]) => m(a, b)));
  const ext = G.limpiar(G.simplificar(ext0, 0.25), 0.05);
  let ruedo = G.limpiar(G.simplificar(ruedo0, 0.2), 0.03);
  if (G.areaConSigno(ruedo) < 0) ruedo = ruedo.slice().reverse();
  let cx = 0, cy = 0;
  for (const q of ruedo) { cx += q[0]; cy += q[1]; }
  cx /= ruedo.length; cy /= ruedo.length;
  // Hasta dónde llega el graderío: la menor distancia radial del ruedo al muro exterior, menos
  // 4 m de galería y muro.
  const rayo = (p) => {
    const d = [p[0] - cx, p[1] - cy], L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
    let mejor = Infinity;
    for (let i = 0; i < ext.length; i++) {
      const a = ext[i], b = ext[(i + 1) % ext.length];
      const e = [b[0] - a[0], b[1] - a[1]], den = u[0] * e[1] - u[1] * e[0];
      if (Math.abs(den) < 1e-9) continue;
      const w = [a[0] - cx, a[1] - cy];
      const t = (w[0] * e[1] - w[1] * e[0]) / den, s = (w[0] * u[1] - w[1] * u[0]) / den;
      if (t > 0 && s >= 0 && s <= 1) mejor = Math.min(mejor, t);
    }
    return { L, u, hasta: mejor };
  };
  let ancho = Infinity;
  for (const p of ruedo) { const r = rayo(p); ancho = Math.min(ancho, r.hasta - r.L - 4); }
  ancho = Math.max(6, ancho);
  const anillo = (k) => ruedo.map((p) => { const d = [p[0] - cx, p[1] - cy], L = Math.hypot(d[0], d[1]); return [cx + d[0] / L * (L + k), cy + d[1] / L * (L + k)]; });
  const A = new G.Malla();
  const BARRERA = 1.6, ALTO_GRADA = 12, GALERIA = 15, PASOS = 9;
  // La plaza está en ladera (unos 15 m de desnivel de oeste a este en el relieve del mapa): el
  // suelo del modelo es el ruedo («sueloEn»). Va a lo más alto entre el relieve del ruedo y el
  // del contorno menos 3 m, así del lado alto (oriente) el muro asoma al menos 12 m y el relieve
  // no se lo come. El muro exterior baja 22 m: es el faldón que cubre el lado bajo.
  const FONDO = -22, BAJO_CONTORNO = -3;
  // Sombra: el anillo entero hasta la cornisa.
  A.sombraDe(ext, GALERIA);
  // Muro exterior de ladrillo con una cornisa clara en lo alto, y cubierta de la galería.
  A.muros(ext, FONDO, GALERIA - 1.5, C.ladrillo, false);
  A.muros(ext, GALERIA - 1.5, GALERIA, C.cornisa, false);
  const borde = anillo(ancho);
  A.tapa([ext, borde], GALERIA, C.cubierta);
  // Muro de la galería hacia el ruedo (de lo alto del graderío a la cubierta).
  A.muros(borde, ALTO_GRADA, GALERIA, C.ladrillo, true);
  // Ruedo de arena y la barrera.
  A.tapa([ruedo], 0.2, C.arena);
  A.muros(ruedo, 0, BARRERA, C.ladrillo, true);
  // Graderío en escalones (huella y contrahuella), del ruedo a la galería.
  for (let k = 0; k < PASOS; k++) {
    const r0 = anillo(ancho * k / PASOS), r1 = anillo(ancho * (k + 1) / PASOS);
    const y0 = BARRERA + (ALTO_GRADA - BARRERA) * k / PASOS, y1 = BARRERA + (ALTO_GRADA - BARRERA) * (k + 1) / PASOS;
    for (let i = 0; i < r0.length; i++) {
      const j = (i + 1) % r0.length;
      // Contrahuella en r0 (mira al ruedo) y huella de r0 a r1 a la altura y1.
      A.quad([r0[j][0], r0[j][1], y0], [r0[i][0], r0[i][1], y0], [r0[i][0], r0[i][1], y1], [r0[j][0], r0[j][1], y1], C.contrahuella);
      A.quad([r0[i][0], r0[i][1], y1], [r1[i][0], r1[i][1], y1], [r1[j][0], r1[j][1], y1], [r0[j][0], r0[j][1], y1], C.grada);
    }
  }
  return {
    id: 'santamaria', nombre: 'Plaza de toros La Santamaría', origen: o, malla: A, alto: GALERIA, fids: [179966], planta: ext,
    sueloEn: [[cx, cy]].concat(ruedo.filter((_, i) => i % Math.ceil(ruedo.length / 12) === 0)).map(([e, n]) => [Math.round(e * 10) / 10, Math.round(n * 10) / 10])
      .concat(ext.filter((_, i) => i % Math.ceil(ext.length / 16) === 0).map(([e, n]) => [Math.round(e * 10) / 10, Math.round(n * 10) / 10, BAJO_CONTORNO])),
    altoTexto: 'muro exterior de 15 m (supuesto)',
    altos: [{ que: 'Alto', valor: 'muro exterior de 15 m', tipo: 'supuesto' }],
    fuentes: [
      { que: 'Huella del anillo y del ruedo (el hueco de la huella)', de: 'UAECD, Catastro Bogotá, construcciones (CONST_V2), fid 179966', licencia: 'CC BY 4.0', url: 'https://datosabiertos.bogota.gov.co/' },
      { que: 'Plaza de ladrillo de estilo neomudéjar, inaugurada en 1931', de: 'Wikipedia en español, «Plaza de toros de Santamaría»', url: 'https://es.wikipedia.org/wiki/Plaza_de_toros_de_Santamar%C3%ADa' }
    ],
    supuestos: ['Muro exterior de 15 m de ladrillo con cornisa clara; sin los arcos de herradura.',
      'Barrera de 1,6 m y graderío de 9 escalones hasta 12 m; galería cubierta de 12 a 15 m.',
      'El anexo de la huella va a la misma altura del anillo.',
      'El ruedo es plano y va a lo más alto entre el relieve del ruedo y el del contorno menos 3 m; el relieve del mapa no conoce la excavación de la plaza.']
  };
}

// ── Salida ──────────────────────────────────────────────────────────────────
function escribir(h) {
  const asset = { copyright: 'Bogotwin. ' + CREDITO_HUELLA + '. Licencia CC BY 4.0' };
  const r = G.aGlb(h.malla, { nombre: h.id, asset, extras: { licencia: 'CC BY 4.0', procedencia: h.id + '.procedencia.json' } });
  fs.writeFileSync(path.join(SALIDA, h.id + '.glb'), r.glb);
  const procedencia = {
    hito: h.nombre, archivo: h.id + '.glb', fecha: FECHA, autor: 'Bogotwin (modelado en código: pipelines/hitos/modelar.js)',
    licencia: CC_BY, atribucion: 'Bogotwin, a partir de la huella de UAECD, Catastro Bogotá (CC BY 4.0)',
    tipo: 'modelado a partir de huella y altura (supuesto ilustrativo, no medido)',
    fuentes: h.fuentes, supuestos: h.supuestos,
    referencias_visuales: 'Fotos de Wikimedia Commons, solo para mirar la forma; ninguna foto va dentro del modelo.',
    cambios: 'Huella simplificada (puntos en línea recta quitados) y extruida; formas sencillas sin texturas, color por vértice.',
    origen: { lon: h.origen[0], lat: h.origen[1], ejes: 'x este, y arriba, z sur, en metros; y = 0 en el suelo' },
    triangulos: r.triangulos, vertices: r.vertices, bytes: r.glb.length
  };
  fs.writeFileSync(path.join(SALIDA, h.id + '.procedencia.json'), JSON.stringify(procedencia, null, 1) + '\n');
  const oc = ids.hitos[h.id] || {};
  return {
    id: h.id, nombre: h.nombre, lon: h.origen[0], lat: h.origen[1], glb: 'hitos/' + h.id + '.glb', bytes: r.glb.length,
    triangulos: r.triangulos, alto: h.alto, altoTexto: h.altoTexto, altos: h.altos, tipo: 'modelado',
    fuente: 'Bogotwin, con la huella de UAECD, Catastro Bogotá',
    licencia: CC_BY,
    procedencia: 'hitos/' + h.id + '.procedencia.json',
    contorno: envolvente(h.planta),
    ...(h.sueloEn ? { sueloEn: h.sueloEn } : {}),
    // Lo que tapa el modelo (catastro-ids.js): cajas de Catastro de cerca (z16) y de lejos
    // (z14 y z15), y partes de OSM por su id_osm.
    ocultar: { cerca: oc.cerca || [], lejos: oc.lejos || [], osm: oc.osm || [] },
    // Piezas que hacen sombra en el mapa (sombras-capa.js): anillo en metros desde lon/lat y alto.
    sombra: h.malla.sombra
  };
}

if (require.main === module) {
  fs.mkdirSync(SALIDA, { recursive: true });
  const hitos = [colpatria(), catedral(), santamaria(), capitolio()].map(escribir);
  const catalogo = {
    _nota: 'Hitos 3D del mapa (site/hitos.js). Lo escribe pipelines/hitos/modelar.js; los ids de «ocultar» son de las teselas publicadas del release indicado y se rehacen con catastro-ids.js.',
    teselas: ids.teselas,
    hitos
  };
  fs.writeFileSync(path.join(SALIDA, 'catalogo.json'), JSON.stringify(catalogo, null, 1) + '\n');
  for (const h of hitos) console.log(h.id.padEnd(18), String(h.triangulos).padStart(6), 'triángulos', String(h.bytes).padStart(8), 'bytes');
}

module.exports = { colpatria, catedral, capitolio, santamaria, envolvente };
