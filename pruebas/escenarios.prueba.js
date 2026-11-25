'use strict';
// «¿Qué pasa si…?»: las cuentas puras de escenarios-modelo.js con los datos reales del sitio, que
// mapa.js baje la herramienta solo al abrir «Probar» y que el texto nunca venda un escenario como
// dato ni como pronóstico. Sin navegador. Ver docs/escenarios.md.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const json = (r) => JSON.parse(leer(r));
const M = require('../site/escenarios-modelo.js');
const SOL = require('../site/sol.js');
const ARB = require('../site/arboles.js');
const caja = { window: {} };
vm.createContext(caja);
vm.runInContext(leer('site/aire-anual-datos.js'), caja);
vm.runInContext(leer('site/vivo-datos.js'), caja);
const D = caja.window.Bogotwin.aireAnualDatos;
const V = caja.window.Bogotwin.vivo;
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

// ── 1. Aire de un día malo ────────────────────────────────────────────────
revisar('umbrales con respaldo: OMS 15 y norma de 24 h 37', M.UMBRALES.oms.valor === 15 && M.UMBRALES.norma.valor === 37);
revisar('el umbral es de dos posiciones, no continuo', Object.keys(M.UMBRALES).length === 2);

const pm = json('site/datos/aire/pm25-anual-2025.geojson');
const media = M.mediaPonderada(pm);
revisar('promedio de 2025 pesado por área, entre la franja más limpia y la más sucia', media > 11 && media < 29.9, media);
revisar('promedio de 2025 pesado por área: 13,1 µg/m³', cerca(media, 13.12, 0.05), media.toFixed(3));
revisar('área de franjas igual a la de aire-anual-datos.js', pm.features.every((f) => cerca(M.areaKm2(f.geometry), D.areaKm2(f.geometry), 1e-6)));

const leerLugares = (r) => json(r).features.filter((f) => f.geometry && f.geometry.type === 'Point').map((f) => {
  const fr = D.franjaEn(pm, f.geometry.coordinates[0], f.geometry.coordinates[1]);
  return { anual: fr ? fr.properties.pm25 : null };
});
const colegios = leerLugares('site/datos/aire/colegios-sed.geojson');
const salud = leerLugares('site/datos/aire/salud-red-publica.geojson');
revisar('2176 colegios y 116 sedes de salud', colegios.length === 2176 && salud.length === 116, `${colegios.length} ${salud.length}`);

const c0 = M.contar(colegios, media, media, 15);
revisar('contar: sobre + bajo + sin valor = total', c0.sobre + c0.bajo + c0.sinValor === c0.total);
revisar('los que caen fuera del área de la SDA no se cuentan como limpios', c0.sinValor === 49, c0.sinValor);
revisar('con el promedio de 2025, ningún colegio pasa la norma de 24 h', M.contar(colegios, media, media, 37).sobre === 0);
revisar('con 50 µg/m³ todos los colegios con valor pasan la norma', M.contar(colegios, 50, media, 37).bajo === 0);
let sube = true, antes = -1;
for (let P = M.PM_MIN; P <= M.PM_MAX; P++) { const s = M.contar(colegios, P, media, 15).sobre; if (s < antes) sube = false; antes = s; }
revisar('más PM2,5 nunca baja la cuenta de colegios sobre el umbral', sube);

const q = M.quiebres(colegios, media, 15);
revisar('quiebre: justo antes del primero no pasa ninguno', M.contar(colegios, q.primero - 0.01, media, 15).sobre === 0);
revisar('quiebre: justo después del primero pasa al menos uno', M.contar(colegios, q.primero + 0.01, media, 15).sobre > 0);
revisar('quiebre: después del último pasan todos los que tienen valor', M.contar(colegios, q.todos + 0.01, media, 15).bajo === 0);
revisar('quiebre con la norma más arriba que con la OMS', M.quiebres(colegios, media, 37).primero > q.primero);
revisar('pmEnLugar sin valor anual devuelve null', M.pmEnLugar(null, 20, media) === null && M.pmEnLugar(12, 20, 0) === null);

const vals = pm.features.map((f) => f.properties.pm25);
const vis = M.visibilidadKm(V, 37, media, Math.min(...vals), Math.max(...vals));
revisar('visibilidad: la misma cuenta de la bruma (vivo-datos.js)', cerca(vis.ciudad, V.visibilidad(37) / 1000, 1e-9));
revisar('visibilidad: la zona más sucia ve menos que la más limpia', vis.peor < vis.ciudad && vis.ciudad < vis.mejor, JSON.stringify(vis));
revisar('claseDia: 15 limpio, 15,01 sobre la OMS, 37,01 sobre la norma', M.claseDia(15) === 0 && M.claseDia(15.01) === 1 && M.claseDia(37) === 1 && M.claseDia(37.01) === 2);

// ── 2. Árboles en una calle ───────────────────────────────────────────────
for (const h of [6, 7, 12, 20, 30]) {
  const c = M.copa(h), p = ARB.perfil(h * 10, 0);
  revisar(`copa de ${h} m igual a arboles.js (copa redonda)`, cerca(c.tronco, p[0], 1e-9) && cerca(c.copaAlto, p[3], 1e-9) && cerca(c.rCopa, p[4], 1e-9));
}
revisar('un árbol de 2 m no tiene copa más ancha que la mitad de su alto', M.copa(2).rCopa <= 1);
revisar('crecimiento: 2 m al sembrar y nunca pasa la altura adulta', M.alturaA('medio', 0, 'rapido') === 2 && M.alturaA('alto', 100, 'rapido') === 20 && M.alturaA('bajo', 30, 'lento') === 6);

const sol = SOL.posicion(SOL.desdeBogota(2026, 11, 25, 14, 0), 4.65, -74.08);
revisar('sol de las 2 p. m. del 25 de noviembre: alto y al suroccidente', sol.altura > 40 && sol.azimut > 200 && sol.azimut < 260, `${sol.altura.toFixed(1)} ${sol.azimut.toFixed(1)}`);
const uno = M.sombraFila({ n: 1, sep: 8, rumbo: 0, h: 12, sol, paso: 0.25 });
const sm = uno.sombra;
revisar('un árbol: área contada cerca de π·a·b (más el tronco)', cerca(uno.area, Math.PI * sm.a * sm.b, 0.04 * Math.PI * sm.a * sm.b), `${uno.area.toFixed(1)} vs ${(Math.PI * sm.a * sm.b).toFixed(1)}`);
revisar('la sombra cae al lado contrario del sol (al nororiente a las 2 p. m.)', sm.dx > 0 && sm.dy > 0);
const largo = M.sombraFila({ n: 1, sep: 8, rumbo: 0, h: 12, sol: { altura: 20, azimut: sol.azimut }, paso: 0.5 });
revisar('sol más bajo, sombra más lejos', Math.hypot(largo.sombra.dx, largo.sombra.dy) > Math.hypot(sm.dx, sm.dy));
revisar('sin sol no hay sombra', M.sombraFila({ n: 5, sep: 8, rumbo: 0, h: 12, sol: { altura: 1, azimut: 270 } }).area === 0
  && M.sombraArbol(M.copa(12), null) === null);
const diez = M.sombraFila({ n: 10, sep: 8, rumbo: 0, h: 12, sol, paso: 0.5 });
revisar('copas que se juntan no cuentan dos veces', diez.area <= 10 * uno.area + 1);
const r = M.rangoFila({ n: 10, sep: 8, rumbo: 0, porte: 'medio', anios: 10, sol, paso: 0.5 });
revisar('rango: lento ≤ medio ≤ rápido en altura y en sombra', r.lento.h <= r.medio.h && r.medio.h <= r.rapido.h && r.lento.area <= r.medio.area && r.medio.area <= r.rapido.area,
  `${r.lento.area} ${r.medio.area} ${r.rapido.area}`);
revisar('la parte del andén a la sombra está entre 0 y 1', ['lento', 'medio', 'rapido'].every((k) => r[k].anden >= 0 && r[k].anden <= 1));
revisar('fila centrada: los pies suman cero', Math.abs(M.fila(7, 9, 90).reduce((s, p) => s + p[0] + p[1], 0)) < 1e-9);
const ll = M.aLonLat([100, 0], [-74.08, 4.65]);
revisar('100 m al oriente son unos 0,0009° de longitud en Bogotá', cerca(ll[0] + 74.08, 100 / (111320 * Math.cos(4.65 * Math.PI / 180)), 1e-12) && ll[1] === 4.65);

// ── 3. El sitio: baja al abrir «Probar», sello en el mapa, texto honesto ──
const mapa = leer('site/mapa.js');
revisar('mapa.js baja la herramienta al abrir la pestaña Probar', /bogotwin:pestana/.test(mapa) && /'escenarios-modelo\.js', 'escenarios\.js'/.test(mapa));
revisar('mapa.js le pregunta a escenarios.js antes de abrir una ficha', /B\.escenarios && B\.escenarios\.tomaClic\(e\)/.test(mapa));
const html = leer('site/index.html');
revisar('index.html: tarjeta «¿Qué pasa si…?» en Probar', /id="escenarios-cuerpo"/.test(html) && html.indexOf('id="escenarios"') > html.indexOf('id="pa-probar"'));
revisar('index.html: index.html no carga escenarios.js de entrada', !/<script[^>]+escenarios/.test(html));
const ui = leer('site/escenarios.js');
revisar('hay «Volver a hoy» en el panel y en el sello del mapa', (ui.match(/'Volver a hoy'/g) || []).length >= 2);
revisar('el sello del mapa dice que es un escenario', /no es el aire de hoy/.test(ui) && /no están sembrados/.test(ui));
revisar('mientras hay escenario el mapa lleva la clase en-escenario', /en-escenario/.test(ui) && /body\.en-escenario #mapa::after/.test(leer('site/estilo.css')));
revisar('el escenario queda en la URL (?esc=)', /q\.set\('esc'/.test(ui) && /get\('esc'\)/.test(ui));
revisar('cada cifra del resultado lleva marca', /function cifra\([^)]*\)\s*{\s*return el\('div', { clase: 'dato' }, B\.valor\(texto, marca, true\), ' ', B\.marca\(marca\)/.test(ui));
const copia = (ui + leer('site/escenarios-modelo.js') + leer('docs/escenarios.md')).toLowerCase();
revisar('el texto del escenario no dice pronóstico', !/pronóstic/.test(ui.toLowerCase().replace(/\/\/.*$/gm, '')), '');
revisar('ni «simulad» en ninguno de los tres archivos', !/simulad/.test(copia));
revisar('sin degradados en la hoja', !/gradient/i.test(leer('site/estilo.css')));
revisar('la bruma 3D sigue el escenario y lo marca como supuesto', /B\.escenario/.test(leer('site/sol-barra.js')) && /marca: 'supuesto'/.test(leer('site/sol-barra.js')));

cierre('Escenarios');
