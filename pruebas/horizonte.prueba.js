'use strict';
// Paso 6: lectura de la rejilla de horizonte HZN2 y velo de los cerros (site/horizonte.js).
// Primero un archivo armado aquí, que siempre corre. Luego, si existe, el archivo real de
// mapa-base/salida/terreno/: mismas horas que horizonte.py, 14 de 16 puntos contra la tabla
// de B y la prueba de aceptación del paso 6 con el sol de site/sol.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { revisar, cierre } = require('./util');
const H = require(path.join(__dirname, '..', 'site', 'horizonte.js'));
const SOL = require(path.join(__dirname, '..', 'site', 'sol.js'));

const RAIZ = path.join(__dirname, '..');
const ARCHIVO = path.join(RAIZ, 'mapa-base', 'salida', 'terreno', 'horizonte-bogota.hzn.gz');
const INFORME = path.join(RAIZ, 'mapa-base', 'salida', 'terreno', 'horizonte.json');
const PUNTOS = path.join(RAIZ, 'mapa-base', 'terreno', 'puntos-referencia.json');

// ── Archivo de juguete con el mismo formato que escribe horizonte.py ──────
const AZ = [60, 65, 70, 240];          // tres seguidas (con delta) y una suelta (sin delta)
function rejillaBytes(r, q, mascara) {
  const nd = AZ.length, [nf, nc] = [r.nf, r.nc];
  const partes = [];
  const cab = Buffer.alloc(8 + 32 + 8 + 4 * nd);
  cab.writeUInt16LE(nc, 0); cab.writeUInt16LE(nf, 2); cab.writeUInt16LE(nd, 4); cab.writeUInt16LE(2 | (mascara ? 4 : 0), 6);
  cab.writeDoubleLE(r.lon0, 8); cab.writeDoubleLE(r.lat0, 16); cab.writeDoubleLE(r.dlon, 24); cab.writeDoubleLE(r.dlat, 32);
  cab.writeFloatLE(0.5, 40); cab.writeFloatLE(-2, 44);
  AZ.forEach((a, i) => cab.writeFloatLE(a, 48 + 4 * i));
  partes.push(cab);
  if (mascara) {
    const m = Buffer.alloc(6); m.writeUInt16LE(mascara.bloque, 0); m.writeUInt16LE(mascara.nbx, 2); m.writeUInt16LE(mascara.nby, 4);
    partes.push(m, Buffer.from(mascara.datos));
  }
  const datos = Buffer.from(q);
  const tam = nf * nc;
  for (let d = nd - 1; d >= 1; d--) {
    if (AZ[d] - AZ[d - 1] !== 5) continue;
    for (let i = 0; i < tam; i++) datos[d * tam + i] = (q[d * tam + i] - q[(d - 1) * tam + i] + 256) & 255;
  }
  partes.push(datos);
  return Buffer.concat(partes);
}
// Gruesa 3 × 3 (paso 0,01°) y fina 4 × 4 (paso 0,005°) con bloques de 2 nodos; solo el bloque
// del noroccidente tiene datos.
const gru = { nc: 3, nf: 3, lon0: -74.1, lat0: 4.7, dlon: 0.01, dlat: 0.01 };
const fin = { nc: 4, nf: 4, lon0: -74.1, lat0: 4.7, dlon: 0.005, dlat: 0.005 };
const qG = new Uint8Array(AZ.length * 9), qF = new Uint8Array(AZ.length * 16);
for (let d = 0; d < AZ.length; d++) {
  for (let i = 0; i < 9; i++) qG[d * 9 + i] = 10 + 4 * d + i;              // 3° + 2°·d + 0,5°·i
  for (let i = 0; i < 16; i++) qF[d * 16 + i] = (250 + 3 * d + i) & 255;   // pasa de 255 y da la vuelta: prueba el módulo
}
const juguete = Buffer.concat([Buffer.from('HZN2'), Buffer.from([2, 0]),
  rejillaBytes(gru, qG), rejillaBytes(fin, qF, { bloque: 2, nbx: 2, nby: 2, datos: [1, 0, 0, 0] })]);

(async () => {
  const crudo = await H.descomprimir(zlib.gzipSync(juguete));
  revisar('gzip: descomprime a los mismos bytes', Buffer.compare(Buffer.from(crudo), juguete) === 0);
  const sinGzip = await H.descomprimir(juguete);
  revisar('sin gzip: pasa tal cual (servidor que ya descomprimió)', sinGzip.length === juguete.length);
  const rj = H.leer(crudo);
  revisar('dos rejillas, gruesa primero', rj.length === 2 && rj[0].nc === 3 && rj[1].nc === 4 && !rj[0].mascara && !!rj[1].mascara);
  const g = rj[0];
  revisar('delta deshecho en la gruesa', [0, 1, 2, 3].every((d) => g.H[d * 9 + 4] === (10 + 4 * d + 4) * 0.5 - 2));
  revisar('delta con vuelta de 255 en la fina', [0, 1, 2, 3].every((d) => Math.abs(rj[1].H[d * 16 + 15] - (((250 + 3 * d + 15) & 255) * 0.5 - 2)) < 1e-6));
  let error = '';
  try { H.leer(juguete.subarray(0, juguete.length - 3)); } catch (e) { error = e.message; }
  revisar('archivo cortado: error, no basura', /cortado|más/.test(error), error);
  try { H.leer(Buffer.concat([juguete, Buffer.from([0])])); error = ''; } catch (e) { error = e.message; }
  revisar('bytes de más: error', /más/.test(error), error);

  // Consulta: dentro del bloque con datos usa la fina; fuera, la gruesa interpolada.
  const enFina = H.consultar(rj, -74.0975, 4.6975);
  revisar('punto en el bloque con datos usa la fina', enFina && enFina.fina, enFina && String(enFina.hz[0]));
  const esperadoF = ((250 + 0 + 0) * 0.5 - 2 + (251 * 0.5 - 2) + (254 * 0.5 - 2) + (255 * 0.5 - 2)) / 4;
  revisar('bilineal en la fina', Math.abs(enFina.hz[0] - esperadoF) < 1e-4, `${enFina.hz[0]} vs ${esperadoF}`);
  const enGruesa = H.consultar(rj, -74.0825, 4.6825);
  revisar('punto fuera de los bloques usa la gruesa', enGruesa && !enGruesa.fina);
  revisar('fuera de la rejilla: null', H.consultar(rj, -75, 4) === null);
  revisar('azimut como numpy.interp', H.enAzimut([60, 65], [2, 4], 62.5) === 3 && H.enAzimut([60, 65], [2, 4], 10) === 2 && H.enAzimut([60, 65], [2, 4], 99) === 4);

  // Campo y velo: con el sol por debajo del horizonte, sombra; muy por encima, nada.
  const campo = H.armarCampo(rj);
  revisar('campo a la resolución fina', campo.nc === 4 && campo.nf === 4 && campo.H.length === 4 * 16);
  revisar('esquinas medio paso por fuera', Math.abs(campo.esquinas[0][0] - (-74.1025)) < 1e-9 && Math.abs(campo.esquinas[2][1] - (4.7 - 3.5 * 0.005)) < 1e-9);
  const bajo = H.alfas(campo, { alturaGeometrica: -0.1, azimut: 62 });
  revisar('sol bajo el horizonte local: velo completo', bajo.alfa.every((a) => a === 255));
  const alto = H.alfas(campo, { alturaGeometrica: 80, azimut: 62 });
  revisar('sol alto: sin velo', alto.alfa.every((a) => a === 0) && alto.enSombra === 0);
  const noche = H.alfas(campo, { alturaGeometrica: -5, azimut: 62 });
  revisar('de noche el velo no se pinta', noche.alfa.every((a) => a === 0));
  revisar('borde suave de medio grado', H.sombraEn(10, 10 - H.SEMI_DISCO) === 0.5 && H.sombraEn(10, 10.5) === 0 && H.sombraEn(10, 9) === 1);

  // ── Archivo real ─────────────────────────────────────────────────────────
  if (!fs.existsSync(ARCHIVO) || !fs.existsSync(INFORME)) {
    console.log('SALTA  archivo real: falta mapa-base/salida/terreno/horizonte-bogota.hzn.gz (make terreno)');
    return cierre('Horizonte');
  }
  const gz = fs.readFileSync(ARCHIVO);
  const informe = JSON.parse(fs.readFileSync(INFORME, 'utf8'));
  const puntos = JSON.parse(fs.readFileSync(PUNTOS, 'utf8'));
  revisar('peso ≤ 220 KB (aprobado en panel/terreno-arreglos.md)', gz.length <= 220000, `${gz.length} bytes`);
  const real = H.leer(await H.descomprimir(gz));
  const [rg, rf] = real;
  revisar('gruesa 52 × 81 y fina 256 × 401, 26 direcciones',
    rg.nc === informe.gruesa.nodos[0] && rg.nf === informe.gruesa.nodos[1] && rf.nc === informe.fina.nodos[0] && rf.nf === informe.fina.nodos[1] && rf.nd === 26);
  revisar('bloques finos con datos como dice el informe', rf.mascara.reduce((s, v) => s + v, 0) === informe.fina.bloques_con_datos);

  const hm = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let pasan = 0, difMax = 0, rejillaIgual = true;
  for (const p of puntos.puntos) {
    const q = H.consultar(real, p.lon, p.lat);
    const ref = informe.prueba_16_puntos.detalle.find((d) => d.lugar === p.lugar);
    if (!q || !ref) { revisar(`punto ${p.lugar} en la rejilla`, false); continue; }
    if ((ref.rejilla_usada === 'fina') !== q.fina) rejillaIgual = false;
    let ok = true;
    for (const [fecha, doy] of Object.entries(puntos.fechas)) {
      const m = H.llegada(q, p.lon, p.lat, doy);
      // horizonte.py redondea a minuto: el mismo cálculo cae a medio minuto o menos.
      difMax = Math.max(difMax, Math.abs(m - hm(ref.fechas[fecha].rejilla)));
      if (Math.abs(m - hm(p.b[fecha])) > 5) ok = false;
    }
    if (ok) pasan++;
  }
  revisar('cada punto usa la misma rejilla que horizonte.py', rejillaIgual);
  revisar('mismas horas que horizonte.py (±0,5 min)', difMax <= 0.5 + 1e-9, `máx ${difMax.toFixed(2)} min`);
  revisar('primer sol a ±5 min de B en 14 de 16 o más', pasan >= 14, `${pasan} de 16`);

  const campoReal = H.armarCampo(real);
  revisar('ningún nodo con sombra de cerro por encima de SOL_BAJO',
    campoReal.maximo + 0.5 * 0.5 - H.SEMI_DISCO < H.SOL_BAJO, `horizonte máx ${campoReal.maximo}°, SOL_BAJO ${H.SOL_BAJO}°`);

  // Aceptación del paso 6 con el sol del sitio: a las 6:30 a. m. el velo cubre el borde
  // oriental y a las 8 a. m. ya no queda en Chapinero (la parte urbana, al occidente de la 7).
  const nodo = (alfa, lon, lat) => alfa[Math.round((rf.lat0 - lat) / rf.dlat) * rf.nc + Math.round((lon - rf.lon0) / rf.dlon)];
  const BORDE_ORIENTAL = [['Chorro de Quevedo', -74.0697, 4.5966], ['Parque Nacional', -74.0645, 4.6245]];
  for (const [mes, dia] of [[12, 21], [3, 20], [6, 21]]) {
    const s630 = SOL.posicion(SOL.desdeBogota(2026, mes, dia, 6, 30), 4.6097, -74.0817);
    const a630 = H.alfas(campoReal, s630).alfa;
    revisar(`${dia}/${mes} 6:30 a. m.: velo sobre el borde oriental`, BORDE_ORIENTAL.every(([, lon, lat]) => nodo(a630, lon, lat) === 255));
    const s8 = SOL.posicion(SOL.desdeBogota(2026, mes, dia, 8, 0), 4.6097, -74.0817);
    const a8 = H.alfas(campoReal, s8).alfa;
    let maxC = 0;
    for (let lon = -74.072; lon <= -74.058; lon += 0.0005) for (let lat = 4.63; lat <= 4.67; lat += 0.0005) maxC = Math.max(maxC, nodo(a8, lon, lat));
    revisar(`${dia}/${mes} 8:00 a. m.: sin velo en Chapinero`, maxC === 0, `alfa máx ${maxC}`);
  }
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 20; k++) H.alfas(campoReal, { alturaGeometrica: 5 + k, azimut: 70 + k });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  revisar('pintar el velo cuesta milisegundos', ms < 20, `${ms.toFixed(1)} ms`);
  cierre('Horizonte');
})().catch((e) => { revisar('sin excepción', false, e.stack); cierre('Horizonte'); });
