#!/usr/bin/env node
'use strict';
// Historia anual del aire en cada estación de la RMCAB, 2011 a 2025, desde el conjunto del IDEAM
// «Calidad del Aire en Colombia (Promedio Anual)» en datos.gov.co (Socrata kekd-7v7h, CC BY-SA 4.0).
//
// Uso:  node pipelines/aire-historia/armar.js              baja de la API y escribe el JSON
//       node pipelines/aire-historia/armar.js crudo.json   arma desde una descarga ya guardada
//
// Escribe site/datos/aire/historia-estaciones.json (unos 20 KB), con la consulta, la fecha, el
// corte del conjunto y la licencia adentro. Va en su propio archivo: es CC BY-SA y no se mezcla
// con la superficie de la SDA (CC BY). El visor nunca llama a datos.gov.co.
//
// Lo que se toma: PM2,5 y PM10 con tiempo de exposición de 24 h, es decir el promedio del año
// hecho con los promedios diarios, que es como se compara con la norma anual. Su
// representatividad temporal es el porcentaje de días del año con dato válido. Las filas de 1 h
// dan casi lo mismo y no se usan.
//
// Cosas del conjunto que hay que tratar con cuidado:
// 1. Filas repetidas: de 2011 a 2022 cada año viene dos veces, iguales salvo por «83» y «83.0».
//    Se deja una (si alguna vez no coinciden, gana la que tiene más datos y se avisa en consola).
// 2. Estaciones que se movieron: el mismo nombre aparece con coordenadas un poco distintas antes
//    y después de 2020. Si los dos puntos quedan a menos de 100 m es la misma estación con otra
//    medición del punto, y la serie se une. Si quedan más lejos (Fontibón, a 1 km; Móvil 7ma, a
//    1,7 km) el aire que miden es otro y se dejan como dos estaciones, cada una con sus años.
// 3. Nombres con asterisco («KENNEDY*», «TUNAL*»): el conjunto no explica qué significa. Salen en
//    pocas filas de otros contaminantes, en el mismo punto y con el mismo código. Se quita el
//    asterisco para unir por nombre, pero la regla de los 100 m sigue mandando, y el nombre
//    crudo queda guardado en «crudo».
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..', '..');
const SALIDA = path.join(RAIZ, 'site', 'datos', 'aire', 'historia-estaciones.json');
const API = 'https://www.datos.gov.co/resource/kekd-7v7h.json';
const VISTA = 'https://www.datos.gov.co/api/views/kekd-7v7h.json';
const FICHA = 'https://www.datos.gov.co/d/kekd-7v7h';
const UMBRAL_M = 100;
const VARIABLES = { 'PM2.5': 'pm25', PM10: 'pm10' };
const SELECT = 'id_estacion,estaci_n,latitud,longitud,variable,unidades,tiempo_de_exposici_n_horas,a_o,promedio,no_de_datos,representatividad_temporal';
const WHERE = "autoridad_ambiental='SDA' AND variable in('PM2.5','PM10') AND tiempo_de_exposici_n_horas='24'";

// Nombres de presentación. Lo que no está aquí sale en nombre propio con la regla general.
const NOMBRES = {
  'C. ALTO RENDIMIENTO': 'Centro de Alto Rendimiento',
  'CARVAJAL - SEVILLANA': 'Carvajal-Sevillana',
  'CIUDAD BOLIVAR': 'Ciudad Bolívar',
  'MINAMBIENTE': 'MinAmbiente',
  'MÓVIL 7MA': 'Móvil Séptima'
};
const MENORES = new Set(['de', 'del', 'la', 'el', 'y']);
function nombrePropio(crudo) {
  const base = limpiarNombre(crudo).base;
  if (NOMBRES[base]) return NOMBRES[base];
  return base.toLowerCase().split(/\s+/).map((w, i) => (i && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
function limpiarNombre(crudo) {
  const t = String(crudo || '').trim().replace(/\s+/g, ' ');
  return { base: t.replace(/\*+$/, '').trim(), asterisco: /\*$/.test(t) };
}

// Distancia en metros sobre la esfera (haversine, radio medio).
function distanciaM(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Filas crudas de la API a filas limpias, con números de verdad.
function leerFila(r) {
  const v = VARIABLES[r.variable];
  if (!v) return null;
  const lat = Number(r.latitud), lon = Number(r.longitud), anio = Number(r.a_o), prom = Number(r.promedio);
  if (![lat, lon, anio, prom].every(Number.isFinite)) return null;
  const rep = Number(r.representatividad_temporal);
  return { id: String(r.id_estacion), crudo: String(r.estaci_n).trim(), lat, lon, v, anio, prom,
    datos: Number(r.no_de_datos) || 0, rep: Number.isFinite(rep) ? rep : null };
}

// Agrupa las filas en estaciones: mismo nombre (sin asterisco) y puntos a menos de umbral metros.
// Es enlace simple: un punto entra al grupo si queda cerca de cualquiera de sus puntos.
function unirEstaciones(filas, umbral = UMBRAL_M) {
  const porNombre = new Map();
  for (const f of filas) {
    const k = limpiarNombre(f.crudo).base;
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(f);
  }
  const grupos = [];
  for (const [base, fs_] of porNombre) {
    const puntos = [];
    for (const f of fs_) {
      const clave = f.lat + ',' + f.lon;
      let p = puntos.find((q) => q.clave === clave);
      if (!p) puntos.push(p = { clave, lat: f.lat, lon: f.lon, filas: [] });
      p.filas.push(f);
    }
    const deEste = [];
    for (const p of puntos) {
      const cerca = deEste.filter((g) => g.puntos.some((q) => distanciaM(p, q) <= umbral));
      if (!cerca.length) { deEste.push({ base, puntos: [p] }); continue; }
      // Si el punto une dos grupos, se funden.
      const g = cerca[0];
      g.puntos.push(p);
      for (const otro of cerca.slice(1)) { g.puntos.push(...otro.puntos); deEste.splice(deEste.indexOf(otro), 1); }
    }
    grupos.push(...deEste);
  }
  return grupos;
}

// Una fila por variable y año. Las repetidas idénticas se cuentan; si difieren gana la de más datos.
function serieDe(filas, v, anios) {
  const porAnio = new Map();
  let choques = 0;
  for (const f of filas.filter((x) => x.v === v)) {
    const y = porAnio.get(f.anio);
    if (!y) { porAnio.set(f.anio, f); continue; }
    if (y.prom !== f.prom || y.rep !== f.rep) { choques++; if (f.datos > y.datos) porAnio.set(f.anio, f); }
  }
  const serie = anios.map((a) => {
    const f = porAnio.get(a);
    return f ? [Math.round(f.prom * 10) / 10, f.rep == null ? null : Math.round(f.rep)] : null;
  });
  return { serie, choques };
}

const anioDe = (filas, fn) => fn(...filas.map((f) => f.anio));

function armar(crudas, meta) {
  const filas = crudas.map(leerFila).filter(Boolean);
  const anios = [];
  for (let a = Math.min(...filas.map((f) => f.anio)); a <= Math.max(...filas.map((f) => f.anio)); a++) anios.push(a);
  const ultimo = anios[anios.length - 1];
  const grupos = unirEstaciones(filas);
  const cuantosPorNombre = {};
  for (const g of grupos) cuantosPorNombre[g.base] = (cuantosPorNombre[g.base] || 0) + 1;
  let choques = 0;
  const estaciones = grupos.map((g) => {
    const todas = g.puntos.flatMap((p) => p.filas);
    // El punto de la estación es el de su año más reciente.
    const reciente = g.puntos.slice().sort((a, b) => anioDe(b.filas, Math.max) - anioDe(a.filas, Math.max))[0];
    const desde = anioDe(todas, Math.min), hasta = anioDe(todas, Math.max);
    let n = nombrePropio(g.base);
    if (cuantosPorNombre[g.base] > 1) n += desde === hasta ? ` (${desde})` : hasta === ultimo ? ` (desde ${desde})` : ` (${desde} a ${hasta})`;
    const e = { id: [...new Set(todas.map((f) => f.id))].join(','), n, crudo: [...new Set(todas.map((f) => f.crudo))].join(' | '),
      lon: Math.round(reciente.lon * 1e6) / 1e6, lat: Math.round(reciente.lat * 1e6) / 1e6, desde, hasta };
    for (const v of Object.values(VARIABLES)) {
      const s = serieDe(todas, v, anios);
      choques += s.choques;
      e[v] = s.serie.some(Boolean) ? s.serie : null;
    }
    if (g.puntos.length > 1) {
      const d = Math.max(...g.puntos.flatMap((p) => g.puntos.map((q) => distanciaM(p, q))));
      e.nota = `El punto de la estación cambia un poco en el conjunto (${Math.round(d)} m entre los dos). Es la misma estación y la serie va unida.`;
    }
    if (cuantosPorNombre[g.base] > 1) {
      const otros = grupos.filter((o) => o !== g && o.base === g.base);
      const d = Math.min(...otros.flatMap((o) => o.puntos.map((q) => distanciaM(reciente, q))));
      e.nota = (e.nota ? e.nota + " " : "") + `Hay otra estación con el mismo nombre a ${(d / 1000).toFixed(1).replace('.', ',')} km. Mide el aire de otro lugar, así que la mostramos aparte.`;
    }
    return e;
  }).sort((a, b) => a.n.localeCompare(b.n, 'es'));
  if (choques) console.warn(`Aviso: ${choques} años con dos filas distintas; quedó la de más datos.`);
  return {
    fuente: {
      nombre: 'Calidad del Aire en Colombia (Promedio Anual)',
      productor: 'Instituto de Hidrología, Meteorología y Estudios Ambientales (IDEAM), con datos de la Red de Monitoreo de Calidad del Aire de Bogotá (RMCAB) de la SDA',
      ficha: FICHA,
      consulta: meta.consulta,
      licencia: { nombre: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' },
      licencia_ficha: meta.licenciaFicha || null,
      corte: meta.corte || null,
      bajado: meta.bajado,
      sha256_crudo: meta.sha,
      metodo: 'Promedio anual con exposición de 24 h (promedio de los promedios diarios). «rep» es la representatividad temporal en %: por debajo de 75 el año tiene pocos días medidos y su promedio pesa menos.'
    },
    anios,
    variables: { pm25: { etiqueta: 'PM2,5', oms: 5, norma: 25 }, pm10: { etiqueta: 'PM10', oms: 15, norma: 50 } },
    formato: 'Cada serie va alineada con «anios»: [promedio en µg/m³, representatividad en %] o null si ese año no hay dato.',
    estaciones
  };
}

async function main() {
  const arg = process.argv[2];
  const params = new URLSearchParams({ $select: SELECT, $where: WHERE, $limit: '50000', $order: 'id_estacion,variable,a_o' });
  const consulta = API + '?' + params.toString();
  let texto, licenciaFicha = null, corte = null;
  if (arg) texto = fs.readFileSync(arg, 'utf8');
  else {
    const r = await fetch(consulta);
    if (!r.ok) throw new Error('La API respondió ' + r.status);
    texto = await r.text();
  }
  try {
    const v = await (await fetch(VISTA)).json();
    licenciaFicha = v.license && v.license.name || null;
    if (v.rowsUpdatedAt) corte = new Date(v.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
  } catch (e) { console.warn('No se pudo leer la ficha del conjunto:', e.message); }
  if (licenciaFicha && !/Share Alike 4\.0/i.test(licenciaFicha)) throw new Error('La licencia de la ficha cambió: ' + licenciaFicha);
  const sha = crypto.createHash('sha256').update(texto).digest('hex');
  const salida = armar(JSON.parse(texto), { consulta, licenciaFicha, corte, sha, bajado: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  fs.writeFileSync(SALIDA, JSON.stringify(salida) + '\n');
  console.log(`${salida.estaciones.length} estaciones, ${salida.anios[0]} a ${salida.anios[salida.anios.length - 1]}, ${fs.statSync(SALIDA).size} bytes en ${path.relative(RAIZ, SALIDA)}`);
}

module.exports = { distanciaM, limpiarNombre, nombrePropio, leerFila, unirEstaciones, serieDe, armar, UMBRAL_M };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
