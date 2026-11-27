'use strict';
// Historia anual del aire por estación (IDEAM kekd-7v7h): la unión de estaciones del pipeline,
// la marca de años con pocos días, las barras y el archivo servido. Sin red y sin navegador.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');
const P = require('../pipelines/aire-historia/armar.js');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const caja = { window: {} };
vm.createContext(caja);
vm.runInContext(leer('site/aire-anual-datos.js'), caja);
const D = caja.window.Bogotwin.aireAnualDatos;

// 1. Distancia y nombres.
const d44 = P.distanciaM({ lat: 4.783733, lon: -74.043783 }, { lat: 4.783756, lon: -74.044183 });
revisar('Guaymaral: los dos puntos quedan a unos 44 m', d44 > 40 && d44 < 48, d44.toFixed(1));
const d900 = P.distanciaM({ lat: 4.6701, lon: -74.14155 }, { lat: 4.678242, lon: -74.143819 });
revisar('Fontibón: los dos puntos quedan a unos 940 m', d900 > 900 && d900 < 980, d900.toFixed(0));
revisar('«KENNEDY*» se lee como Kennedy con asterisco', P.limpiarNombre('KENNEDY*').base === 'KENNEDY' && P.limpiarNombre('KENNEDY*').asterisco);
revisar('nombres de presentación', P.nombrePropio('C. ALTO RENDIMIENTO') === 'Centro de Alto Rendimiento' && P.nombrePropio('LAS FERIAS') === 'Las Ferias' && P.nombrePropio('SAN CRISTÓBAL*') === 'San Cristóbal');

// 2. Unión: a menos de 100 m es la misma estación; más lejos, dos.
const fila = (estaci_n, lat, lon, a_o, promedio, rep = 90, variable = 'PM2.5', datos = 330) =>
  ({ id_estacion: '1', estaci_n, latitud: String(lat), longitud: String(lon), variable, a_o: String(a_o), promedio: String(promedio), no_de_datos: String(datos), representatividad_temporal: String(rep) });
const crudas = [
  fila('GUAYMARAL', 4.783733, -74.043783, 2018, 14), fila('GUAYMARAL', 4.783733, -74.043783, 2018, 14), // repetida igual
  fila('GUAYMARAL', 4.783756, -74.044183, 2021, 11.04),
  fila('FONTIBÓN', 4.6701, -74.14155, 2018, 30), fila('FONTIBÓN', 4.678242, -74.143819, 2021, 22, 60), fila('FONTIBÓN', 4.678242, -74.143819, 2020, 23),
  fila('KENNEDY*', 4.62505, -74.161333, 2019, 25.1), fila('KENNEDY', 4.62505, -74.161333, 2020, 21.6),
  fila('TUNAL', 4.5762, -74.13, 2020, 18, 80, 'PM2.5', 300), fila('TUNAL', 4.5762, -74.13, 2020, 19, 70, 'PM2.5', 200), // dos filas distintas
  fila('TUNAL', 4.5762, -74.13, 2020, 40, 95, 'O3')
];
const grupos = P.unirEstaciones(crudas.map(P.leerFila).filter(Boolean));
const de = (b) => grupos.filter((g) => g.base === b);
revisar('Guaymaral: dos puntos a 44 m quedan en una estación', de('GUAYMARAL').length === 1 && de('GUAYMARAL')[0].puntos.length === 2);
revisar('Fontibón: dos puntos a 940 m quedan en dos estaciones', de('FONTIBÓN').length === 2);
revisar('Kennedy y Kennedy* en el mismo punto son una estación', de('KENNEDY').length === 1);
revisar('variables que no son PM2,5 ni PM10 no entran', !grupos.some((g) => g.puntos.some((p) => p.filas.some((f) => f.v !== 'pm25' && f.v !== 'pm10'))));
const avisos = [];
const avisoViejo = console.warn; console.warn = (m) => avisos.push(m);
const h = P.armar(crudas, { consulta: 'x', bajado: '2026-11-26T00:00:00Z', sha: 'x' });
console.warn = avisoViejo;
const est = (n) => h.estaciones.find((e) => e.n === n);
revisar('años alineados de 2018 a 2021', JSON.stringify(h.anios) === '[2018,2019,2020,2021]');
revisar('Guaymaral: una serie, el año repetido una sola vez', est('Guaymaral') && JSON.stringify(est('Guaymaral').pm25) === '[[14,90],null,null,[11,90]]', JSON.stringify(est('Guaymaral') && est('Guaymaral').pm25));
revisar('Guaymaral: la nota dice que el punto se movió poco', /44 m/.test(est('Guaymaral').nota || ''));
revisar('Guaymaral: el punto es el del año más reciente', est('Guaymaral').lon === -74.044183);
revisar('Fontibón: cada una con sus años en el nombre', !!est('Fontibón (2018)') && !!est('Fontibón (desde 2020)'), h.estaciones.map((e) => e.n).join(' | '));
revisar('Fontibón: la nota explica por qué van aparte', /0,9 km/.test(est('Fontibón (desde 2020)').nota || ''));
revisar('Kennedy: el crudo guarda el asterisco', /KENNEDY\*/.test(est('Kennedy').crudo) && est('Kennedy').pm25.filter(Boolean).length === 2);
revisar('Tunal: con dos filas distintas gana la de más datos y se avisa', est('Tunal').pm25[2][0] === 18 && avisos.some((a) => /1 años/.test(a)));
revisar('Tunal: sin PM10 la serie queda null', est('Tunal').pm10 === null);
revisar('la licencia va en el archivo: CC BY-SA 4.0', h.fuente.licencia.nombre === 'CC BY-SA 4.0');

// 3. Años con pocos días.
revisar('menos de 75 % es poco; 75 ya alcanza', D.REP_MIN === 75 && D.pocaRep(74.9) && !D.pocaRep(75) && !D.pocaRep(100));
revisar('sin representatividad cuenta como poco', D.pocaRep(null) && D.pocaRep(undefined) && D.pocaRep(NaN));
const serie = [[31, 83], [28.3, 60], null, [16.7, 92]];
const g = D.barrasHistoria(serie, { ancho: 200, alto: 60, oms: 5, norma: 25 });
revisar('una barra por año con dato', g.barras.length === 3 && g.barras.map((b) => b.i).join() === '0,1,3');
revisar('el año con 60 % va marcado como poco', g.barras.find((b) => b.i === 1).poca && !g.barras.find((b) => b.i === 0).poca);
revisar('la barra más alta cabe y la norma queda dentro', g.barras.every((b) => b.y >= 0 && b.y + b.h <= 60.0001) && g.yNorma > 0 && g.yOms > g.yNorma);
const bajo = D.barrasHistoria([[8, 90], [9, 90]], { ancho: 100, alto: 60, oms: 5, norma: 25 });
revisar('con valores bajos la raya de la norma sigue cabiendo', bajo.yNorma > 0 && bajo.tope >= 25);
const r = D.resumenHistoria(serie, [2011, 2012, 2013, 2014]);
revisar('la frase usa solo años con días suficientes', r.primero.anio === 2011 && r.ultimo.anio === 2014 && r.pocos === 1 && r.buenos === 2);
revisar('sin años buenos no hay frase', D.resumenHistoria([[20, 40]], [2020]).primero === null);
const geo = D.historiaGeojson({ estaciones: [{ n: 'A', lon: -74.1, lat: 4.6 }] });
revisar('las estaciones salen como puntos con su índice', geo.features[0].geometry.coordinates[0] === -74.1 && geo.features[0].properties.i === 0);

// 4. El archivo servido.
const RUTA = 'site/datos/aire/historia-estaciones.json';
const servido = JSON.parse(leer(RUTA));
const bytes = fs.statSync(path.join(raiz, RUTA)).size;
revisar('archivo chico (menos de 30 KB)', bytes < 30000, bytes + ' B');
revisar('de 2011 a 2025', servido.anios[0] === 2011 && servido.anios[servido.anios.length - 1] === 2025);
revisar('CC BY-SA 4.0 y la ficha del IDEAM', servido.fuente.licencia.nombre === 'CC BY-SA 4.0' && /kekd-7v7h/.test(servido.fuente.ficha) && /Share Alike 4\.0/.test(servido.fuente.licencia_ficha || ''));
revisar('trae la consulta y el corte', /datos\.gov\.co\/resource\/kekd-7v7h\.json\?/.test(servido.fuente.consulta) && /^\d{4}-\d{2}-\d{2}$/.test(servido.fuente.corte || ''));
const n = servido.anios.length;
revisar('cada serie alineada con los años', servido.estaciones.every((e) => ['pm25', 'pm10'].every((k) => e[k] === null || e[k].length === n)));
revisar('todas en la Sabana', servido.estaciones.every((e) => e.lon > -74.3 && e.lon < -73.9 && e.lat > 4.4 && e.lat < 4.9));
revisar('valores con sentido (0 a 200 µg/m³, 0 a 100 %)', servido.estaciones.every((e) => ['pm25', 'pm10'].every((k) => !e[k] || e[k].every((p) => !p || (p[0] > 0 && p[0] < 200 && (p[1] === null || (p[1] >= 0 && p[1] <= 100)))))));
const base = (e) => e.n.replace(/ \(.*\)$/, '');
const juntas = servido.estaciones.flatMap((a, i) => servido.estaciones.slice(i + 1).filter((b) => base(a) === base(b) && P.distanciaM(a, b) <= P.UMBRAL_M).map((b) => a.n + ' y ' + b.n));
revisar('ninguna pareja con el mismo nombre a menos de 100 m', juntas.length === 0, juntas.join(', '));
const js = leer('site/aire-anual.js');
const cuantas = js.match(/CUANTAS_ESTACIONES = (\d+)/);
revisar('la casilla dice cuántas estaciones trae el archivo', cuantas && +cuantas[1] === servido.estaciones.length);
revisar('aire-anual.js no llama a datos.gov.co', !/datos\.gov\.co/.test(js + leer('site/aire-anual-datos.js')));
revisar('la ventana marca los promedios como medidos', /B\.valor\(D\.coma\(p\[0\]\), 'medido'/.test(js) && /tipo: 'medido', licencia: LIC\.estaciones/.test(js));
const fu = leer('site/fuentes.html');
revisar('fuentes.html: fila del IDEAM con CC BY‑SA', /kekd-7v7h[\s\S]{0,1200}CC BY‑SA 4\.0/.test(fu));

cierre('aire-historia');
