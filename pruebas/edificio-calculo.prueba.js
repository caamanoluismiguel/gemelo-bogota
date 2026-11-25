'use strict';
// Ronda 1 B: escenario «Edificio nuevo» (site/edificio-calculo.js), sin navegador.
// Las cuentas se revisan contra sol.js y contra la geometría de sombra-geom.js (la misma de
// la GPU), con una rejilla fina pintada aparte, como en sombra-geom.prueba.js.
const path = require('path');
const { revisar, cierre } = require('./util');
const C = require(path.join(__dirname, '..', 'site', 'edificio-calculo.js'));
const G = require(path.join(__dirname, '..', 'site', 'sombra-geom.js'));
const SOL = require(path.join(__dirname, '..', 'site', 'sol.js'));

const RAD = Math.PI / 180;
function dentro(x, y, anillos) {
  let d = false;
  for (const r of anillos) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
  }
  return d;
}
// Sombra según sombra-geom: cuadriláteros de las paredes corridos con desplazar() (y de tesela
// hacia abajo, por eso se voltea) más la huella. Un punto está en sombra si cae en alguno.
function sombraGeom(huella, pisos, mPiso, sol) {
  const v = G.vectorSombra(sol);
  if (!v) return null;
  const geom = G.armar([{ anillos: [huella.map(([x, y]) => [x, -y])], pisos }], { quitarCortes: false });
  const quads = G.desplazar(geom, v, mPiso, 1).map((q) => q.map(([x, y]) => [x, -y]));
  return (x, y) => dentro(x, y, [huella]) || quads.some((q) => dentro(x, y, [q]));
}
const cerca = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const sol = (mes, dia, h, m) => SOL.posicion(SOL.desdeBogota(C.ANIO, mes, dia, h, m, 0), C.LAT, C.LON);

// 1. La sombra del volumen (envolvente) es la misma que arma sombra-geom.js, con el sol de sol.js.
const lote = { cx: 0, cy: 0, ancho: 20, fondo: 32, giro: 17 };
const vol = C.volumen(lote, { retroceso: 0, huella: 100 });
let peor = 0;
for (const [mes, dia, h, m] of [[3, 21, 7, 30], [6, 21, 8, 0], [9, 23, 16, 30], [12, 21, 9, 15], [6, 21, 12, 0], [12, 21, 15, 45]]) {
  const s = sol(mes, dia, h, m);
  for (const k of C.M_PISO) {
    const H = C.sombra(vol.pts, 10 * k, s);
    const ref = sombraGeom(vol.pts, 10, k, s);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of H) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    let distintos = 0, total = 0;
    const paso = 0.25;
    for (let y = y0 - 2; y <= y1 + 2; y += paso) for (let x = x0 - 2; x <= x1 + 2; x += paso) {
      const a = C.dentroConvexo(x, y, H), b = ref(x, y);
      if (a || b) total++;
      if (a !== b) distintos++;
    }
    peor = Math.max(peor, distintos / total);
  }
}
revisar('la sombra del edificio nuevo coincide con la de sombra-geom.js (6 momentos, 2,8 y 3,3 m por piso)', peor < 0.01, `peor diferencia ${(peor * 100).toFixed(2)} % del área`);

// 2. El largo de la sombra es el de sombra-geom.largoSombra con el mismo sol.
{
  const s = sol(3, 21, 8, 0);
  const cuad = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  const H = C.sombra(cuad, 12 * 3.3, s);
  const v = G.vectorSombra(s), u = [v[0] / Math.hypot(...v), v[1] / Math.hypot(...v)];
  const lejos = Math.max(...H.map((p) => p[0] * u[0] + p[1] * u[1])) - Math.max(...cuad.map((p) => p[0] * u[0] + p[1] * u[1]));
  const ref = G.largoSombra(s, 12, 3.3);
  revisar('largo de la sombra = largoSombra(sol, 12 pisos, 3,3 m)', cerca(lejos, ref, 1e-9), `${lejos.toFixed(2)} m contra ${ref.toFixed(2)} m`);
}

// 3. A 4,6° N el mediodía casi no da sombra; la mañana y la tarde sí (por eso se cuentan).
{
  let maxMedio = 0, minManana = Infinity;
  for (const m of C.momentosAnio()) {
    const largo = G.largoSombra(m.sol, 1, 1);
    if (m.min > 11.5 * 60 && m.min < 12.5 * 60) maxMedio = Math.max(maxMedio, largo);
    if (m.min > 7 * 60 && m.min < 8 * 60) minManana = Math.min(minManana, largo);
  }
  revisar('al mediodía la sombra mide menos de 0,6 veces el alto todo el año', maxMedio < 0.6, maxMedio.toFixed(2));
  revisar('de 7 a 8 a. m. mide más de 1,5 veces el alto todo el año', minManana > 1.5, minManana.toFixed(2));
}

// 4. Rectángulo del lote a partir de una huella girada, retroceso y huella.
{
  const pts = C.esquinas({ cx: 3, cy: -4, ancho: 18, fondo: 27, giro: 31 });
  const extra = [[3 + 2, -4 + 1]]; // un punto adentro no cambia nada
  const r = C.rectanguloMinimo(pts.concat(extra));
  const ok = cerca(r.cx, 3, 1e-6) && cerca(r.cy, -4, 1e-6) && cerca(r.ancho * r.fondo, 18 * 27, 1e-6) && Math.abs(r.giro) <= 45;
  revisar('rectángulo mínimo de una huella girada 31°: mismo centro y área, giro entre −45° y 45°', ok, `${r.ancho.toFixed(2)} × ${r.fondo.toFixed(2)} m, giro ${r.giro.toFixed(1)}°`);
  const v = C.volumen({ cx: 0, cy: 0, ancho: 20, fondo: 30, giro: 0 }, { retroceso: 3, huella: 50 });
  revisar('retroceso 3 m y huella 50 %: área = 50 % de 14 × 24 m', cerca(v.area, 0.5 * 14 * 24, 1e-9), `${v.area.toFixed(1)} m²`);
  revisar('esquinas en sentido antihorario', (() => { let a = 0; const p = v.pts; for (let i = 0; i < 4; i++) a += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1]; return a > 0; })());
}

// 5. Campo abierto (sin vecinos ni árboles): las horas·m² son la suma de las sombras del año,
//    contadas aparte con una rejilla de 1 m y la geometría de sombra-geom.js.
const loteR = { cx: 0, cy: 0, ancho: 18, fondo: 24, giro: 0 };
const esq = C.esquinas(loteR);
const volR = C.volumen(loteR, { retroceso: 2, huella: 100 });
const vacio = C.armarRejilla({ construcciones: [], arboles: [], lote: esq });
const mVacio = C.metricas(vacio, volR.pts, 8, {});
{
  let ref = 0;
  const radio = C.RADIO;
  const lista = C.momentosAnio().filter((_, i) => i % 9 === 0); // muestra para que la prueba sea rápida
  let parcial = 0;
  const sub = C.armarRejilla({ construcciones: [], arboles: [], lote: esq });
  // La misma cuenta con el módulo, solo en esos momentos: se arma una lista a mano.
  for (const m of lista) {
    const en = sombraGeom(volR.pts, 8, 3.3, m.sol);
    const H = C.sombra(volR.pts, 8 * 3.3, m.sol);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of H) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    let a = 0;
    for (let y = Math.floor(y0) + 0.5; y < y1; y += 1) for (let x = Math.floor(x0) + 0.5; x < x1; x += 1) {
      if (x * x + y * y > radio * radio || C.dentroConvexo(x, y, esq)) continue;
      if (en(x, y)) a++;
    }
    ref += a * m.horas;
    // Celdas de 3 m del módulo para el mismo momento.
    let b = 0;
    for (let j = 0; j < sub.n; j++) for (let i = 0; i < sub.n; i++) {
      const x = (i - sub.c) * sub.celda, y = (j - sub.c) * sub.celda, k = j * sub.n + i;
      if ((i - sub.c) ** 2 + (j - sub.c) ** 2 > (radio / sub.celda) ** 2 || sub.lote[k]) continue;
      if (C.dentroConvexo(x, y, H)) b++;
    }
    parcial += b * 9 * m.horas;
  }
  revisar('campo abierto: celdas de 3 m contra rejilla de 1 m con sombra-geom.js (muestra del año)', cerca(parcial, ref, 0.05), `${Math.round(parcial)} contra ${Math.round(ref)} h·m²`);
  const max = mVacio.combos.find((c) => c.mPiso === 3.3 && !c.arboles).horasM2;
  revisar('campo abierto: la franja va de 2,8 a 3,3 m por piso y sin árboles no cambia nada',
    mVacio.horasM2[0] < mVacio.horasM2[1] && max === mVacio.horasM2[1] && mVacio.combos[0].horasM2 === mVacio.combos[2].horasM2,
    mVacio.horasM2.map(Math.round).join(' a '));
}

// 6. Vecinos y árboles que ya dan sombra hoy: el edificio nuevo quita menos sol, nunca más.
{
  const vecinos = [];
  for (const x of [-60, -35, 35, 60]) for (const y of [-60, -30, 30, 60]) vecinos.push({ anillos: [[[x, y], [x + 15, y], [x + 15, y + 15], [x, y + 15]]], pisos: 6 });
  const arboles = [];
  for (let y = -80; y <= 80; y += 8) arboles.push({ x: -22, y, h: 12, r: 4 });
  const R = C.armarRejilla({ construcciones: vecinos, arboles, lote: esq });
  const m = C.metricas(R, volR.pts, 8, {});
  const sin = mVacio.combos, con = m.combos;
  revisar('con vecinos, cada combinación quita menos sol que en campo abierto', con.every((c, i) => c.horasM2 < sin[i].horasM2),
    con.map((c) => Math.round(c.horasM2)).join(', '));
  revisar('con copa cerrada se pierde menos que sin copa (mismo alto de piso)', con[2].horasM2 < con[0].horasM2 && con[3].horasM2 < con[1].horasM2);
}

// 7. El patio: un muro alto al oriente ya le quita el sol de la mañana; el edificio nuevo no le quita nada.
{
  const P = [-40, 0];
  const R0 = C.armarRejilla({ construcciones: [], arboles: [], lote: esq });
  const libre = C.metricas(R0, volR.pts, 12, { patio: P }).patio;
  const muro = [{ anillos: [[[-34, -30], [-31, -30], [-31, 30], [-34, 30]]], pisos: 20 }];
  const R1 = C.armarRejilla({ construcciones: muro, arboles: [], lote: esq });
  const tapado = C.metricas(R1, volR.pts, 12, { patio: P }).patio;
  revisar('patio libre al occidente: pierde sol de 7 a 10 a. m.', libre.minutosDia[1] > 0, libre.minutosDia.map((v) => v.toFixed(1)).join(' a ') + ' min por día');
  revisar('con un muro de 20 pisos al oriente del patio: no pierde nada (ya no tenía sol)', tapado.minutosDia[1] === 0 && tapado.diasRecreo[1] === 0);
  revisar('días de recreo sin sol ≤ días que hoy tiene sol en el recreo ≤ 365',
    libre.diasRecreo[1] <= libre.diasRecreoHoy[1] && libre.diasRecreoHoy[1] <= 365);

  // Minutos de la mañana contados aparte, día por día, con sol.js y sombra-geom.js.
  let ref = [0, 0];
  for (let mes = 1; mes <= 12; mes++) {
    for (let d = 1; d <= [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]; d++) {
      for (let t = 7 * 60 + 2.5; t < 10 * 60; t += 5) {
        const s = SOL.posicion(SOL.desdeBogota(C.ANIO, mes, d, 0, 0, 0) + t * 60000, C.LAT, C.LON);
        C.M_PISO.forEach((k, q) => { const en = sombraGeom(volR.pts, 12, k, s); if (en && en(P[0], P[1])) ref[q] += 5; });
      }
    }
  }
  ref = ref.map((v) => v / 365);
  revisar('minutos perdidos por día en el patio = conteo aparte con sol.js y sombra-geom.js',
    cerca(libre.minutosDia[0], ref[0], 0.01) && cerca(libre.minutosDia[1], ref[1], 0.01),
    `${libre.minutosDia.map((v) => v.toFixed(2)).join(' a ')} contra ${ref.map((v) => v.toFixed(2)).join(' a ')}`);
}

// 8. Más pisos, más sombra (la cifra sube con la palanca).
{
  const R0 = C.armarRejilla({ construcciones: [], arboles: [], lote: esq });
  const a = C.metricas(R0, volR.pts, 4, {}).horasM2[1], b = C.metricas(R0, volR.pts, 16, {}).horasM2[1];
  revisar('16 pisos quitan más sol que 4', b > a, `${Math.round(a)} y ${Math.round(b)} h·m²`);
}

// 9. Escenario en la URL: ida y vuelta, y nada raro entra.
{
  const e = { lon: -74.054321, lat: 4.671234, ancho: 22.5, fondo: 31, giro: -12.3, pisos: 14, retroceso: 3.5, huella: 70, patio: [-74.0549, 4.6713] };
  const s = C.escribirEscenario(e);
  const v = C.leerEscenario(s);
  revisar('escenario: ida y vuelta por la URL', v && v.lon === e.lon && v.lat === e.lat && v.pisos === 14 && v.huella === 70 && v.retroceso === 3.5 && v.patio[0] === e.patio[0], s);
  revisar('escenario: la URL se vuelve a escribir igual', C.escribirEscenario(v) === s);
  revisar('escenario: texto raro se rechaza', C.leerEscenario('<script>') === null && C.leerEscenario('1,2,3') === null && C.leerEscenario('') === null);
  revisar('escenario: fuera de Bogotá se rechaza', C.leerEscenario('-3.7,40.4,20,20,0,10,0,100') === null);
  const ac = C.leerEscenario('-74.05,4.67,500,2,0,900,99,5');
  revisar('escenario: palancas fuera de rango se acotan', ac && ac.pisos === 60 && ac.retroceso === 15 && ac.huella === 30 && ac.ancho === 120 && ac.fondo === 6);
}

cierre('Edificio nuevo: el sol que les quita a los vecinos');
