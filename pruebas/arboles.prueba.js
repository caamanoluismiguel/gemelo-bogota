'use strict';
// Ronda 7: árboles de la calle (site/arboles.js). Las piezas puras siempre; la tesela real de
// la Calle 72 solo si está mapa-base/salida/arboles-bogota.pmtiles (si no, lo dice y no falla).
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const mvt = require('../site/mvt.js');
const A = require('../site/arboles.js');
const { abrir } = require('./pmtiles-leer');

// Perfil: la copa termina en la altura del censo, para las cuatro formas.
for (const f of [0, 1, 2, 3]) {
  for (const h of [15, 73, 128, 300, 514]) {
    const [tronco, rT, base, alto, rC] = A.perfil(h, f);
    const ok = Math.abs(base + alto - h / 10) < 1e-9 && tronco > 0 && rT > 0 && rC > 0 && alto > 0;
    if (!ok) revisar(`perfil h=${h} f=${f}`, false, JSON.stringify([tronco, rT, base, alto, rC]));
  }
}
revisar('la copa llega a la altura del censo en las 4 formas', true);
const r7 = A.perfil(73, 0);
revisar('copa redonda de 7,3 m: unos 7 m de ancho', r7[4] * 2 > 6 && r7[4] * 2 < 8, (r7[4] * 2).toFixed(2) + ' m');
// Ronda 8: medido en la ortofoto IDECA 2025 (calle 72 con carrera 7), un urapán de 12 m deja
// una copa de 10 a 15 m. La copa 3D debe caer en ese rango.
const r12 = A.perfil(120, 0);
revisar('urapán de 12 m: copa de 10 a 15 m como en la ortofoto', r12[4] * 2 >= 10 && r12[4] * 2 <= 15, (r12[4] * 2).toFixed(2) + ' m');
revisar('copa redonda nunca pasa de 16 m', A.perfil(600, 0)[4] * 2 <= 16);
revisar('la palma tiene tronco largo', A.perfil(120, 1)[0] > 0.7 * 12);
revisar('la conífera es más angosta que la redonda', A.perfil(120, 2)[4] < A.perfil(120, 0)[4]);
revisar('altura sin dato queda en el mínimo de 1,5 m', Math.abs(A.perfil(undefined, 0)[2] + A.perfil(undefined, 0)[3] - 1.5) < 1e-9);

// Tono: fijo por lugar y entre 0 y 1.
const tonos = [];
for (let i = 0; i < 200; i++) tonos.push(A.tono(i * 17, i * 31));
revisar('tono entre 0 y 1', tonos.every((t) => t >= 0 && t <= 1));
revisar('tono fijo por lugar', A.tono(120, 123) === A.tono(120, 123));
revisar('tonos variados', new Set(tonos.map((t) => Math.round(t * 10))).size >= 8);

// Teselas cerca de la cámara: la de la Calle 72 primero, y pocas.
const cerca = A.teselasCerca(-74.0585, 4.6535, 760);
revisar('la tesela de la cámara va primero', cerca[0] === '19286/31919', cerca[0]);
revisar('760 m alrededor: entre 9 y 25 teselas z16', cerca.length >= 9 && cerca.length <= 25, String(cerca.length));
revisar('radio 0: solo una tesela', A.teselasCerca(-74.0585, 4.6535, 0).length === 1);

// Malla: índices dentro del arreglo, tronco y copa.
const m = A.malla();
const nv = m.vertices.length / 4;
revisar('malla con índices válidos', m.indices.every((i) => i < nv), `${nv} vértices, ${m.indices.length / 3} triángulos`);
// Ronda 9: copa en lóbulos. Tope por árbol: 160 triángulos (14.500 árboles en la vista de
// entrada son 2,3 millones de triángulos, de lejos la mitad no llega a pantalla).
revisar('malla de 160 triángulos o menos por árbol', m.indices.length / 3 <= 160, String(m.indices.length / 3));
const partes = new Set(); for (let i = 3; i < m.vertices.length; i += 4) partes.add(m.vertices[i]);
revisar('tronco y ' + A.LOBULOS + ' lóbulos en la copa', A.LOBULOS >= 3 && A.LOBULOS <= 5 && partes.size === A.LOBULOS + 1 && [...partes].every((p) => Number.isInteger(p) && p >= 0 && p <= A.LOBULOS));
const fuenteArb = fs.readFileSync(path.join(__dirname, '..', 'site', 'arboles.js'), 'utf8');
revisar('cada forma arma sus lóbulos distinto (palma, conífera, eucalipto, redonda)', /palma: penacho/.test(fuenteArb) && /conífera: pisos/.test(fuenteArb) && /eucalipto: grumos/.test(fuenteArb) && /redonda: un cuerpo y tres grumos/.test(fuenteArb));
revisar('borde roto fijo por árbol y sin ruido de tiempo', /q \*= 1\.0 \+ 0\.2 \* ruido/.test(fuenteArb) && !/u_tiempo/.test(fuenteArb));
revisar('de lejos queda un solo lóbulo y las manchas se van por píxel', /else rad \*= 1\.0 - lod;/.test(fuenteArb) && /fwidth\(v_q\.x\)/.test(fuenteArb));
const ms = A.mallaSombra();
revisar('mancha de sombra: 8 triángulos', ms.indices.length === 24);

// Sol: al norte en el azimut 0, arriba a 90°.
const s0 = A.haciaSol(0, 0), s90 = A.haciaSol(90, 0), sE = A.haciaSol(0, 90);
revisar('hacia el sol: norte, arriba y este', Math.abs(s0[1] - 1) < 1e-9 && Math.abs(s90[2] - 1) < 1e-9 && Math.abs(sE[0] - 1) < 1e-9);

// mvt.leerCapa sigue leyendo solo polígonos si no se pide otra cosa.
revisar('leerCapa sin tipo no devuelve puntos', (() => {
  // Tesela mínima a mano: capa "a", extensión 4096, un punto en (10, 20).
  const geom = [9, 20, 40];                          // MoveTo 1, zigzag(10)=20, zigzag(20)=40
  const feat = [0x18, 1, 0x22, geom.length, ...geom]; // type=1 (punto), geometry
  const capa = [0x78, 2, 0x0a, 1, 0x61, 0x12, feat.length, ...feat, 0x28, 0x80, 0x20];
  const bytes = new Uint8Array([0x1a, capa.length, ...capa]);
  const poli = mvt.leerCapa(bytes, 'a');
  const pts = mvt.leerCapa(bytes, 'a', 1);
  return poli && poli.objetos.length === 0 && pts && pts.objetos.length === 1 && pts.objetos[0].anillos[0][0][0] === 10 && pts.objetos[0].anillos[0][0][1] === 20;
})());

const ARCHIVO = path.join(__dirname, '..', 'mapa-base', 'salida', 'arboles-bogota.pmtiles');
if (!fs.existsSync(ARCHIVO)) {
  console.log('SALTA  no está ' + ARCHIVO);
} else {
  const pm = abrir(ARCHIVO);
  const bytes = pm.tesela(16, 19286, 31919);  // Calle 72 con carrera 7
  revisar('la tesela 16/19286/31919 existe', !!bytes && bytes.length > 1000, bytes ? bytes.length + ' bytes' : '');
  const capa = mvt.leerCapa(bytes, 'arboles', 1);
  revisar('trae la capa arboles con puntos', !!capa && capa.objetos.length > 300, capa ? capa.objetos.length + ' árboles' : '');
  const hs = capa.objetos.map((o) => o.propiedades.h);
  revisar('alturas entre 1,5 y 60 m (h en decímetros)', hs.every((h) => Number.isInteger(h) && h >= 15 && h <= 600), `${Math.min(...hs)} a ${Math.max(...hs)}`);
  revisar('formas 0 a 3', capa.objetos.every((o) => [0, 1, 2, 3].includes(o.propiedades.f)));
  const fuera = capa.objetos.filter((o) => { const [x, y] = o.anillos[0][0]; return x < 0 || y < 0 || x > capa.extension || y > capa.extension; });
  revisar('sin margen: cada árbol cae dentro de su tesela', fuera.length === 0, fuera.length + ' fuera');
  const v = A.instancias(capa.objetos);
  revisar('un registro de 10 números por árbol', v.length === capa.objetos.length * A.ZANCADA);
  revisar('la tesela del extremo no existe (fuera de Bogotá)', pm.tesela(16, 0, 0) == null);
  pm.cerrar();
}

// Ronda 8: los árboles llegan más lejos y la tesela se pide antes de que se vean.
const fuenteA = fs.readFileSync(path.join(__dirname, '..', 'site', 'arboles.js'), 'utf8');
const op = /radio: (\d+), desvanecer: \[(\d+), (\d+)\], maxTeselas: (\d+)/.exec(fuenteA);
revisar('desvanecer de 560 a 960 m y radio que lo cubre', !!op && +op[2] === 560 && +op[3] === 960 && +op[1] >= +op[3], op ? op.slice(1).join(' ') : 'sin opciones');
const nTes = op ? A.teselasCerca(-74.0585, 4.6535, +op[1]).length : 0;
revisar('las teselas del radio caben en maxTeselas', !!op && nTes <= +op[4], `${nTes} de ${op && op[4]}`);
cierre('Árboles');
