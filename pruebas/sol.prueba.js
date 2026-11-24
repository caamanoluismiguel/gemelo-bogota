'use strict';
// Paso 1: site/sol.js contra la tabla de NREL SPA (pruebas/datos/spa-bogota.json, hecha con pvlib).
const path = require('path');
const { revisar, cierre } = require('./util');
const sol = require(path.join(__dirname, '..', 'site', 'sol.js'));
const T = require(path.join(__dirname, 'datos', 'spa-bogota.json'));

const difAng = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// Altura y azimut en 200 momentos.
let maxAlt = 0, maxAz = 0, peorAlt = null, peorAz = null, altMax = 0;
for (const m of T.momentos) {
  const p = sol.posicion(m.ms, m.lat, m.lon);
  const ea = Math.abs(p.altura - m.altura), ez = difAng(p.azimut, m.azimut);
  if (ea > maxAlt) { maxAlt = ea; peorAlt = m; }
  if (ez > maxAz) { maxAz = ez; peorAz = m; }
  altMax = Math.max(altMax, m.altura);
}
revisar('200 momentos en la tabla', T.momentos.length === 200, `${T.momentos.length}`);
revisar('altura a ±0,1°', maxAlt <= 0.1, `error máximo ${maxAlt.toFixed(4)}° con el sol a ${peorAlt.altura.toFixed(1)}°`);
revisar('azimut a ±0,2°', maxAz <= 0.2, `error máximo ${maxAz.toFixed(4)}° con el sol a ${peorAz.altura.toFixed(1)}°; sol más alto de la muestra ${altMax.toFixed(1)}°`);

// Salida, mediodía y puesta en 60 días.
let maxS = 0, maxP = 0, maxM = 0;
for (const d of T.dias) {
  const [y, mo, dd] = d.fecha.split('-').map(Number);
  const r = sol.salidaPuesta(y, mo, dd, 4.6097, -74.0817);
  maxS = Math.max(maxS, Math.abs(r.salida - d.salida) / 1000);
  maxP = Math.max(maxP, Math.abs(r.puesta - d.puesta) / 1000);
  maxM = Math.max(maxM, Math.abs(r.mediodia - d.mediodia) / 1000);
}
revisar(`salida a ±1 min (${T.dias.length} días)`, maxS <= 60, `error máximo ${maxS.toFixed(1)} s`);
revisar(`puesta a ±1 min (${T.dias.length} días)`, maxP <= 60, `error máximo ${maxP.toFixed(1)} s`);
revisar('mediodía solar a ±1 min', maxM <= 60, `error máximo ${maxM.toFixed(1)} s`);

// Días de sol casi en el cenit: el mismo día que SPA.
let iguales = 0;
for (const c of T.cenit) {
  const nuestros = sol.diasCenitales(c.anio, c.lat, -74.0817).map((x) => x.fecha);
  if (nuestros.includes(c.fecha)) iguales++;
  else console.log(`   cenit distinto: ${c.lat} ${c.anio} SPA ${c.fecha}, nuestro ${nuestros.join(', ')}`);
}
revisar('días casi cenitales, mismo día que SPA', iguales === T.cenit.length, `${iguales} de ${T.cenit.length}`);
const dc = sol.diasCenitales(2026, 4.6097, -74.0817);
revisar('dos días casi cenitales al año, uno en marzo/abril y otro en septiembre', dc.length === 2 && /-0[34]-/.test(dc[0].fecha) && /-09-/.test(dc[1].fecha), dc.map((x) => x.fecha).join(', '));

// Hora de Bogotá fija, sin depender de la zona del equipo.
const ms = sol.desdeBogota(2026, 11, 23, 9, 40);
const b = sol.enBogota(ms);
revisar('Bogotá UTC−5: 9:40 a. m. = 14:40 UTC', new Date(ms).toISOString() === '2026-11-23T14:40:00.000Z' && b.hora === 9 && b.minuto === 40);
const zonas = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Europe/Berlin'];
const res = zonas.map((z) => {
  process.env.TZ = z;
  const r = sol.salidaPuesta(2026, 6, 21, 4.6097, -74.0817);
  return [r.salida, r.puesta, sol.posicion(sol.desdeBogota(2026, 6, 21, 7, 0), 4.6097, -74.0817).azimut].join('|');
});
revisar('mismo resultado con la zona del equipo en UTC, Tokio, Los Ángeles y Berlín', new Set(res).size === 1);

cierre('Sol');
