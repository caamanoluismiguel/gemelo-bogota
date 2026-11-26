'use strict';
// Estaciones de TransMilenio y Metro (estaciones.js): nombres de presentación, cruce con los buses
// troncales programados del GTFS y las estaciones que quedan sin servicio en día hábil.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const caja = { window: { Bogotwin: {} } };
vm.createContext(caja);
vm.runInContext(leer('site/estaciones.js'), caja);
const E = caja.window.Bogotwin.estaciones;
revisar('estaciones.js expone poner, ventana y el cálculo', E && typeof E.poner === 'function' && typeof E.ventana === 'function' && E.calc);
const C = E.calc;

// 1. Nombres.
revisar('el patrocinio después del guion se va', C.nombreTm('Calle 72 - Banco Davivienda', '07006') === 'Calle 72');
revisar('Suba conserva su segunda parte', C.nombreTm('Suba - Calle 100', '03011') === 'Suba Calle 100');
revisar('AV. pasa a Av.', C.nombreTm('AV. Jiménez - CL 13', '1') === 'Av. Jiménez');
revisar('Granja Kr 77 con su carrera escrita', C.nombreTm('Granja - Kr 77', '04100') === 'Granja Carrera 77');
revisar('la 14003 no se confunde con la temporal', C.nombreTm('Temporal AV. Jiménez - Inter Eléctricas', '14003') === 'Av. Jiménez de la Calle 13');
revisar('un nombre sin guion queda igual', C.nombreTm('Héroes', '1') === 'Héroes');
revisar('Metro con número y tilde', C.nombreMetro('Estación 12-Avenida Jimenez') === 'Estación 12 · Avenida Jiménez', C.nombreMetro('Estación 12-Avenida Jimenez'));
revisar('Metro sin nombre deja el número', C.nombreMetro('Estación 3') === 'Estación 3');
revisar('lo que no es Metro queda igual', C.nombreMetro('Patio Taller') === 'Patio Taller');

// 2. Cruce con los datos reales del sitio.
const doc = JSON.parse(leer('site/datos/transporte/troncal-frecuencia.json'));
const capa = JSON.parse(leer('site/datos/transporte/troncales.geojson'));
const pts = capa.features.filter((f) => f.geometry && f.geometry.type === 'Point');
const cruce = C.cruzar(doc, pts.map((f) => ({ codigo: f.properties.codigo, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
const sin = pts.filter((f, i) => C.sinServicio(doc, cruce[i])).map((f) => String(f.properties.codigo)).sort();
const esperadas = ['07009', '09108', '09109', '09111', '09117', '09120', '09123', '12003', '14003'];
revisar('nueve estaciones sin buses troncales en día hábil, las conocidas', JSON.stringify(sin) === JSON.stringify(esperadas), sin.join(','));
const de = (cod) => { const i = pts.findIndex((f) => String(f.properties.codigo) === cod); return i >= 0 ? doc.estaciones[cruce[i]] : null; };
revisar('Granja Kr 77 toma la estación que opera (4004)', de('04100') && Number(de('04100').id) === 4004);
revisar('Suba Calle 100 toma su código 9000x', de('03011') && Number(de('03011').id) === 90007);
revisar('ninguna estación del GTFS queda para dos puntos por cercanía', (() => {
  const vistos = new Map();
  return cruce.every((k, i) => k < 0 || Number(doc.estaciones[k].id) === Number(pts[i].properties.codigo) || !vistos.has(k) && vistos.set(k, i));
})());

// 3. Fecha y hora.
revisar('fecha del GTFS en texto corto', C.fechaGtfs(doc) === C.fechaGtfs({ fuente: doc.fuente }) && /^\d{1,2} [a-z]{3} \d{4}$/.test(C.fechaGtfs(doc)), C.fechaGtfs(doc));
revisar('fecha de un archivo conocido', C.fechaGtfs({ fuente: { archivo: 'GTFS_20261125.zip' } }) === '25 nov 2026');
const m = C.momento(Date.parse('2026-11-26T04:30:00Z'), []);
revisar('las 4:30 Z del jueves son las 11 p. m. de un día hábil en Bogotá', m.tipo === 'habil' && m.hora === 23, JSON.stringify(m));
revisar('festivo entre semana va como domingo', C.momento(Date.parse('2026-12-08T15:00:00Z'), ['2026-12-08']).tipo === 'domingo');

// 4. Textos: programado, nunca «en vivo».
const js = leer('site/estaciones.js');
revisar('la ventana dice que son programados y no los buses en la calle', /programados a esta hora/.test(js) && /no son los buses en la calle/.test(js));
revisar('sin «en vivo» ni «en tiempo real»', !/en vivo|tiempo real/i.test(js));

cierre('Estaciones');
