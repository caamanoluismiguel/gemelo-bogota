'use strict';
// Paso 7: geometría de la sombra (site/sombra-geom.js), sin navegador.
// El área se mide pintando la sombra en una rejilla fina en la CPU, con la misma
// cuenta que hace el vértice en la GPU (desplazar()).
const path = require('path');
const { revisar, cierre } = require('./util');
const G = require(path.join(__dirname, '..', 'site', 'sombra-geom.js'));

// Punto dentro de un polígono (par e impar, sirve para anillos con huecos).
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
const caja = (polis) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polis) for (const r of p) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
// Pinta en una rejilla: máscara de la unión de cuadriláteros y de las huellas.
function pintar(quads, huellas, marco, paso) {
  const [x0, y0, x1, y1] = marco;
  const nx = Math.ceil((x1 - x0) / paso), ny = Math.ceil((y1 - y0) / paso);
  const sombra = new Uint8Array(nx * ny), huella = new Uint8Array(nx * ny);
  const qs = quads.map((q) => ({ q: [q], b: caja([[q]]) }));
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * paso;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * paso, k = j * nx + i;
      for (const h of huellas) if (dentro(x, y, h)) { huella[k] = 1; break; }
      for (const { q, b } of qs) {
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (dentro(x, y, q)) { sombra[k] = 1; break; }
      }
    }
  }
  return { sombra, huella, celda: paso * paso, n: nx * ny };
}
function areas(m) {
  let total = 0, fuera = 0;
  for (let k = 0; k < m.n; k++) {
    const s = m.sombra[k] || m.huella[k];
    if (s) total++;
    if (m.sombra[k] && !m.huella[k]) fuera++;
  }
  return { total: total * m.celda, fuera: fuera * m.celda };
}

// 1. Cubo de 3 pisos a 45° de sol, en metros (1 unidad = 1 m).
//    Lado 9 m, alto 9 m (3 pisos de 3 m). A 45° la sombra mide lo mismo que el alto, L = 9 m.
//    Fórmula: sombra fuera de la huella = a·L·(|sen θ| + |cos θ|); con la huella, a² más eso.
const a = 9, mPiso = 3, L = 9;
const cubo = [{ anillos: [[[0, 0], [a, 0], [a, a], [0, a], [0, 0]]], pisos: 3 }];
const geomCubo = G.armar(cubo);
let peor = 0;
for (const az of [0, 30, 45, 90, 135, 200, 247, 300]) {
  const v = G.vectorSombra({ altura: 45, azimut: az });
  const quads = G.desplazar(geomCubo, v, mPiso, 1);
  const marco = caja([cubo[0].anillos, ...quads.map((q) => [q])]);
  const m = pintar(quads, [cubo[0].anillos], [marco[0] - 1, marco[1] - 1, marco[2] + 1, marco[3] + 1], 0.02);
  const ar = areas(m);
  const t = az * Math.PI / 180;
  const formula = a * L * (Math.abs(Math.sin(t)) + Math.abs(Math.cos(t)));
  const e1 = Math.abs(ar.fuera - formula) / formula, e2 = Math.abs(ar.total - (a * a + formula)) / (a * a + formula);
  peor = Math.max(peor, e1, e2);
  revisar(`cubo de 3 pisos, sol a 45° de altura y azimut ${az}°`, e1 < 0.01 && e2 < 0.01,
    `sombra fuera de la huella ${ar.fuera.toFixed(2)} m² contra ${formula.toFixed(2)} m² de la fórmula, error ${(e1 * 100).toFixed(3)} %`);
}

// 2. La sombra va al lado contrario del sol y su largo es alto / tan(altura).
const mañana = G.vectorSombra({ altura: 30, azimut: 90 });
revisar('sol al oriente: la sombra va al occidente', mañana[0] < 0 && Math.abs(mañana[1]) < 1e-9);
const q = G.desplazar(G.armar([{ anillos: [[[0, 0], [1, 0], [1, 1], [0, 1]]], pisos: 2 }]), G.vectorSombra({ altura: 60, azimut: 180 }), 3, 1);
const yPunta = Math.min(...q.flat().map((p) => p[1]));
revisar('sol al sur a 60°: la punta sale 6/tan 60° m hacia el norte (y de tesela baja)', Math.abs(-yPunta - 6 / Math.tan(Math.PI / 3)) < 1e-4, `${(-yPunta).toFixed(4)} m`);
revisar('sol por debajo de 3°: no hay sombra de construcciones', G.vectorSombra({ altura: 2.9, azimut: 90 }) === null);
revisar('largo para la ventana: 7 pisos, 2,5 y 4 m, sol a 45°', Math.abs(G.largoSombra({ altura: 45, azimut: 100 }, 7, 2.5) - 17.5) < 1e-9 && Math.abs(G.largoSombra({ altura: 45, azimut: 100 }, 7, 4) - 28) < 1e-9);

// 3. Construcción cortada por el borde de la tesela = construcción entera.
//    Se arma en lon/lat a zoom 16 en Bogotá. Se corta con el recorte de las teselas
//    vectoriales (borde de 80 unidades, el de tippecanoe) en la tesela de la izquierda y la de la derecha,
//    y en las cuatro de una esquina.
const z = 16, EXT = G.EXTENSION, BORDE = 80; // tippecanoe: 5 px de 256 = 80 unidades
const lonTile = (x) => x / 2 ** z * 360 - 180;
const latTile = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
const tx = Math.floor((-74.07 + 180) / 360 * 2 ** z);
const ty = (() => { const s = Math.sin(4.62 * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z); })();
// Una L con un patio (hueco) que cruza la esquina de cuatro teselas.
const enLL = (ux, uy) => [lonTile(tx + 1 + ux / EXT), latTile(ty + 1 + uy / EXT)];
const exterior = [[-300, -260], [180, -260], [180, -60], [60, -60], [60, 220], [-300, 220]].map(([x, y]) => enLL(x, y));
const patio = [[-220, -180], [-220, -40], [-80, -40], [-80, -180]].map(([x, y]) => enLL(x, y));
const entera = { anillos: [exterior, patio], pisos: 6 };

// Recorte de Sutherland y Hodgman contra un rectángulo, anillo por anillo.
function recortar(anillo, [x0, y0, x1, y1]) {
  let pts = anillo;
  const lados = [[(p) => p[0] >= x0, (p, q) => [x0, p[1] + (q[1] - p[1]) * (x0 - p[0]) / (q[0] - p[0])]],
    [(p) => p[0] <= x1, (p, q) => [x1, p[1] + (q[1] - p[1]) * (x1 - p[0]) / (q[0] - p[0])]],
    [(p) => p[1] >= y0, (p, q) => [p[0] + (q[0] - p[0]) * (y0 - p[1]) / (q[1] - p[1]), y0]],
    [(p) => p[1] <= y1, (p, q) => [p[0] + (q[0] - p[0]) * (y1 - p[1]) / (q[1] - p[1]), y1]]];
  for (const [adentro, cruce] of lados) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (adentro(p)) { out.push(p); if (!adentro(q)) out.push(cruce(p, q)); } else if (adentro(q)) out.push(cruce(p, q));
    }
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}

const sol = { altura: 38, azimut: 112 }; // media mañana
const v = G.vectorSombra(sol);
const lat = G.latitudTesela(z, ty);
const um = G.unidadesPorMetro(z, lat);
// Todo se compara en el marco de la tesela de arriba a la izquierda (tx, ty).
const llevar = (quads, dx, dy) => quads.map((qq) => qq.map(([x, y]) => [x + dx * EXT, y + dy * EXT]));
// La entera no viene de una tesela: no tiene bordes de corte que quitar.
const gEntera = G.armar([entera], { lonlat: { z, x: tx, y: ty }, quitarCortes: false });
const huellaEntera = [[exterior, patio].map((r) => r.map((p) => G.aTesela(p[0], p[1], z, tx, ty)))];
for (const [mp, quitar] of [[2.5, true], [4.0, true], [2.5, false]]) {
  const qEntera = G.desplazar(gEntera, v, mp, um);
  const qPedazos = [], huellasPedazos = [];
  let pedazos = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    // La tesela vectorial trae sus coordenadas recortadas a [−80, 4096 + 80].
    const anillos = [exterior, patio].map((r) => recortar(r.map((p) => G.aTesela(p[0], p[1], z, tx + dx, ty + dy)), [-BORDE, -BORDE, EXT + BORDE, EXT + BORDE])).filter((r) => r.length >= 3);
    if (!anillos.length) continue;
    pedazos++;
    const g = G.armar([{ anillos, pisos: 6 }], quitar ? { borde: BORDE } : { quitarCortes: false });
    const umT = G.unidadesPorMetro(z, G.latitudTesela(z, ty + dy));
    // Cada tesela usa su propio u_unidades_m; para comparar en un solo marco se usa el de la entera.
    // Todas caen en la misma fila de teselas o en la de abajo: a zoom 16 el factor cambia menos
    // de 1 en 100.000 entre las dos. Para comparar en un solo marco se usa el de arriba.
    revisar(`u_unidades_m casi igual en la tesela (${dx}, ${dy})`, Math.abs(umT - um) / um < 1e-4);
    qPedazos.push(...llevar(G.desplazar(g, v, mp, um), dx, dy));
    huellasPedazos.push(llevar(anillos, dx, dy));
  }
  const marco = caja([...qEntera.map((qq) => [qq]), ...huellaEntera]);
  const paso = (marco[2] - marco[0]) / 700;
  // La rejilla se corre un poco para que ninguna fila caiga justo sobre un borde recto
  // (ahí el par e impar desempata distinto según el pedazo y cuenta una fila entera).
  const r = [marco[0] - 2 + paso * 0.3137, marco[1] - 2 + paso * 0.2718, marco[2] + 2, marco[3] + 2];
  const mE = pintar(qEntera, huellaEntera, r, paso);
  const mP = pintar(qPedazos, huellasPedazos, r, paso);
  let difTotal = 0, difFuera = 0, nE = 0;
  for (let k = 0; k < mE.n; k++) {
    const e = !!(mE.sombra[k] || mE.huella[k]), p = !!(mP.sombra[k] || mP.huella[k]);
    if (e) nE++;
    if (e !== p) difTotal++;
    const ef = !!(mE.sombra[k] && !mE.huella[k]), pf = !!(mP.sombra[k] && !mE.huella[k]);
    if (ef !== pf) difFuera++;
  }
  const igual = difTotal / nE < 0.001 && difFuera / nE < 0.001;
  if (quitar) {
    revisar(`cortada en ${pedazos} teselas = entera, ${mp} m por piso`, pedazos === 4 && igual,
      `celdas distintas: ${difTotal} con la huella y ${difFuera} fuera de ella, de ${nE} con sombra`);
  } else {
    // Control: si no se quitan los bordes del corte, el patio cortado pinta sombra falsa.
    revisar('control: sin quitar los bordes del corte, el patio sale con sombra de más', !igual,
      `${difFuera} celdas de más`);
  }
}

// 4. Datos para la GPU: 4 vértices y 6 índices por borde, zancada 5, centroide por construcción.
const g1 = G.armar(cubo);
revisar('cubo: 4 bordes, 16 vértices, 24 índices, zancada 5', g1.vertices.length === 16 * 5 && g1.indices.length === 24 && g1.zancada === 5);
revisar('centroide del cubo en (4,5, 4,5)', Math.abs(g1.centroides[0][0] - 4.5) < 1e-9 && Math.abs(g1.centroides[0][1] - 4.5) < 1e-9);
revisar('la elevación del plano viaja en cada vértice', G.armar([{ anillos: cubo[0].anillos, pisos: 3, elevacion: 2612.3 }]).vertices[4] === Math.fround(2612.3));

cierre('Geometría de sombra');
