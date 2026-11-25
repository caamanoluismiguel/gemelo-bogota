'use strict';
// Datos del repo vivo: decodificar v y estado de las bicis, la regla de la edad, el marcador
// vacío y los días del aire. Carga site/vivo-datos.js en una caja de Node, sin navegador.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const caja = { window: {} };
vm.createContext(caja);
vm.runInContext(leer('site/vivo-datos.js'), caja);
const V = caja.window.Bogotwin.vivo;
revisar('vivo-datos.js se carga y deja Bogotwin.vivo', !!V && typeof V.decodificarBicis === 'function');

// 1. estado es una suma de bits: instalada 1, presta 2, recibe 4, dato_dudoso 8.
const e7 = V.leerEstado(7);
revisar('estado 7 = instalada, presta y recibe, sin duda', e7.instalada && e7.presta && e7.recibe && !e7.dato_dudoso);
const e15 = V.leerEstado(15);
revisar('estado 15 lleva dato_dudoso', e15.dato_dudoso && e15.presta);
const e1 = V.leerEstado(1);
revisar('estado 1 = instalada pero no presta', e1.instalada && !e1.presta && !e1.recibe);

// 2. v va en el orden de campos.
const campos = ['bicis', 'electricas', 'anclajes_libres', 'bicis_fuera_de_servicio', 'anclajes_fuera_de_servicio', 'estado', 'min_desde_reporte'];
const est = (id, v, lat = 4.65, lon = -74.06) => ({ id, nombre: 'Estación ' + id, lat, lon, capacidad: 20, v });
const feed = {
  esquema: 'bogotwin/bicis/1', generado: '2026-11-24T15:00:00Z', hora_dato: '2026-11-24T14:58:00Z', cadencia_min: 10,
  campos, estado_bits: { instalada: 1, presta: 2, recibe: 4, dato_dudoso: 8 },
  estaciones: [
    est('a', [0, 0, 20, 0, 0, 7, 3]),          // vacía
    est('b', [20, 2, 0, 0, 0, 7, 3]),          // llena
    est('c', [3, 1, 17, 0, 0, 7, 3]),          // baja
    est('d', [10, 0, 10, 0, 0, 7, 3]),         // media
    est('e', [17, 4, 3, 0, 0, 7, 3]),          // alta
    est('f', [5, 0, 15, 0, 0, 5, 3]),          // no presta: quieta
    est('g', [5, 0, 15, 0, 0, 7, 240]),        // 4 h sin reportar: quieta
    est('h', [198, null, 99, 0, 0, 15, 3]),    // dudosa
    est('x', [4, 0, 4, 0, 0, 7, 3], -23.4, -46.6) // fuera de la Sabana
  ]
};
const d = V.decodificarBicis(feed);
const cat = Object.fromEntries(d.estaciones.map((s) => [s.id, s.cat]));
revisar('la estación fuera de la Sabana no se dibuja y se cuenta', d.fuera === 1 && !('x' in cat));
revisar('categorías: vacía, llena, baja, media, alta',
  cat.a === 'vacia' && cat.b === 'llena' && cat.c === 'baja' && cat.d === 'media' && cat.e === 'alta', JSON.stringify(cat));
revisar('no presta o más de 60 min sin reportar = quieta', cat.f === 'quieta' && cat.g === 'quieta');
revisar('dato_dudoso gana sobre los números', cat.h === 'dudosa');
const c = d.estaciones.find((s) => s.id === 'c');
revisar('v se lee por nombre de campo', c.bicis === 3 && c.electricas === 1 && c.anclajes_libres === 17 && c.min_desde_reporte === 3);
const h = d.estaciones.find((s) => s.id === 'h');
revisar('un null en v queda null, no 0', h.electricas === null);
revisar('hora y cadencia pasan tal cual', d.hora === feed.hora_dato && d.cadencia === 10);
// Si cambia el orden de campos, se sigue leyendo bien.
const otro = JSON.parse(JSON.stringify(feed));
otro.campos = ['anclajes_libres', 'bicis', ...campos.slice(1).filter((k) => k !== 'anclajes_libres')];
otro.estaciones = [est('c', [17, 3, 1, 0, 0, 7, 3])];
const c2 = V.decodificarBicis(otro).estaciones[0];
revisar('otro orden de campos da los mismos números', c2.bicis === 3 && c2.anclajes_libres === 17 && c2.electricas === 1);
let error = '';
try { V.decodificarBicis({ esquema: 'bogotwin/bicis/2', campos: [], estaciones: [] }); } catch (x) { error = x.message; }
revisar('otro esquema se rechaza', error === 'esquema');

// 3. Regla de la edad: «sin dato reciente» pasado el doble de cadencia_min.
const t0 = Date.parse('2026-11-24T15:00:00Z');
revisar('limiteMin(10) = 20', V.limiteMin(10) === 20);
revisar('limiteMin sin cadencia = null', V.limiteMin(undefined) === null && V.limiteMin(0) === null);
revisar('19 min con cadencia 10: reciente', !V.sinDatoReciente('2026-11-24T14:41:00Z', 10, t0));
revisar('20 min justos: todavía reciente', !V.sinDatoReciente('2026-11-24T14:40:00Z', 10, t0));
revisar('21 min con cadencia 10: sin dato reciente', V.sinDatoReciente('2026-11-24T14:39:00Z', 10, t0));
revisar('cadencia 60: 110 min reciente, 130 min no', !V.sinDatoReciente('2026-11-24T13:10:00Z', 60, t0) && V.sinDatoReciente('2026-11-24T12:50:00Z', 60, t0));
revisar('hora ilegible = sin dato reciente', V.sinDatoReciente('nada', 10, t0));
revisar('la URL cambia el ?t= cada 5 min', V.url('a.json', t0) === V.url('a.json', t0 + 299999) && V.url('a.json', t0) !== V.url('a.json', t0 + 300000));

// 4. Marcador vacío: null, nunca cifras inventadas.
const vacio = V.marcador({ esquema: 'bogotwin/acierto/1', resumen: {
  ultimos_7_dias: { dias_calificados: 0, a24h: { temperatura: { horas: 0, error_medio_c: null, sesgo_c: null }, lluvia: { bloques: 0, porcentaje: null } }, a48h: {} },
  ultimos_30_dias: { dias_calificados: 0 } }, dias: [] });
revisar('marcador sin días = vacío', vacio.vacio === true);
revisar('marcador vacío deja null, no 0', vacio.v7.a24h.error === null && vacio.v7.a24h.porcentaje === null && vacio.v30.a48h.error === null);
const lleno = V.marcador({ esquema: 'bogotwin/acierto/1', resumen: {
  ultimos_7_dias: { dias_calificados: 3, a24h: { temperatura: { horas: 70, error_medio_c: 1.2, sesgo_c: -0.3 }, lluvia: { bloques: 12, porcentaje: 75 } } },
  ultimos_30_dias: { dias_calificados: 3 } } });
revisar('marcador con días trae error y porcentaje', !lleno.vacio && lleno.v7.a24h.error === 1.2 && lleno.v7.a24h.porcentaje === 75 && lleno.v7.a48h.error === null);
const texto = leer('site/pronostico.js');
revisar('la frase del marcador vacío está tal cual', texto.includes('El marcador arranca cuando haya días calificados'));

// 5. Aire: días con 12 horas o más, máximo 5; la guía de la OMS es 15 µg/m³ en 24 h.
const aire = V.diasAire({ esquema: 'bogotwin/aire/1', dias: [
  { fecha_bogota: '2026-11-24', horas: 6, media: 30, maxima: 40 },
  { fecha_bogota: '2026-11-25', horas: 24, media: 14.9, maxima: 22 },
  { fecha_bogota: '2026-11-26', horas: 24, media: 15.1, maxima: 25 },
  { fecha_bogota: '2026-11-27', horas: 24, media: 10, maxima: 12 },
  { fecha_bogota: '2026-11-28', horas: 24, media: 11, maxima: 13 },
  { fecha_bogota: '2026-11-29', horas: 24, media: 12, maxima: 14 },
  { fecha_bogota: '2026-11-30', horas: 24, media: 13, maxima: 15 }
] });
revisar('el día parcial (6 h) no entra', aire[0].fecha === '2026-11-25');
revisar('hasta 5 días', aire.length === 5);
revisar('pasa la guía de la OMS solo por encima de 15', V.OMS_24H === 15 && !aire[0].pasaOms && aire[1].pasaOms);

// 6. Serie de 48 h y NDJSON.
const lineas = V.leerNdjson('{"t":"2026-11-24T14:00:00Z","ids":["c","d"],"v":[[3,1,17],[10,0,10]]}\nbasura\n\n{"t":"2026-11-24T13:50:00Z","ids":["d","c"],"v":[[9,0,11],[2,1,18]]}\n');
revisar('NDJSON salta líneas rotas', lineas.length === 2);
const serie = V.serieDe(lineas, 'c', campos);
revisar('serieDe ordena por hora y busca el id en cada línea', serie.length === 2 && serie[0][1] === 2 && serie[1][1] === 3);

// 7. Nada nuevo promete «en vivo» ni «tiempo real».
const nuevos = ['site/index.html', 'site/fuentes.html', 'site/bicis.js', 'site/canales.js', 'site/frecuencia.js', 'site/pronostico.js', 'site/vivo-datos.js'];
const conVivo = nuevos.filter((f) => /en vivo|tiempo real/i.test(leer(f)));
revisar('ni «en vivo» ni «tiempo real» en las páginas y capas nuevas', conVivo.length === 0, conVivo.join(', '));

// 8. Bruma del aire: la hora de la barra del sol elige la hora del pronóstico de PM2,5.
const ahoraAire = Date.parse('2026-11-24T23:50:00Z');
const jAire = {
  esquema: 'bogotwin/aire/1', generado: '2026-11-24T23:40:32Z', cadencia_min: 60, horas_campos: ['t', 'pm25'],
  horas: [['2026-11-24T23:00:00Z', 24.1], ['2026-11-25T00:00:00Z', 8.2], ['2026-11-25T01:00:00Z', null], ['2026-11-25T02:00:00Z', 70]]
};
const enHora = (iso, j, ahora) => V.aireEnHora(j || jAire, Date.parse(iso), ahora ?? ahoraAire);
const h1 = enHora('2026-11-24T23:59:00Z');
revisar('la hora en curso da su valor', h1.estado === 'ok' && h1.pm25 === 24.1, JSON.stringify(h1));
revisar('6:20 p. m. de Bogotá cae en la hora de las 6 (23 Z)', enHora('2026-11-24T23:20:00Z').pm25 === 24.1);
revisar('la hora siguiente da el valor siguiente', enHora('2026-11-25T00:00:00Z').pm25 === 8.2 && enHora('2026-11-25T00:59:59Z').pm25 === 8.2);
revisar('antes del pronóstico: fuera', enHora('2026-11-24T22:59:00Z').estado === 'fuera');
revisar('después de la última hora: fuera', enHora('2026-11-25T03:00:00Z').estado === 'fuera');
revisar('un día que la barra eligió en marzo: fuera', enHora('2026-03-10T15:00:00Z').estado === 'fuera');
revisar('una hora vacía (null) no es 0: fuera', enHora('2026-11-25T01:30:00Z').estado === 'fuera');
revisar('archivo de más de 2 h (doble de la cadencia): viejo',
  enHora('2026-11-24T23:30:00Z', null, Date.parse('2026-11-25T01:41:00Z')).estado === 'viejo' &&
  enHora('2026-11-24T23:30:00Z', null, Date.parse('2026-11-25T01:40:00Z')).estado === 'ok');
revisar('sin JSON, con otro esquema o sin hora: sin_dato',
  V.aireEnHora(null, ahoraAire).estado === 'sin_dato' && V.aireEnHora({ esquema: 'bogotwin/aire/2', horas: [] }, ahoraAire, ahoraAire).estado === 'sin_dato' &&
  V.aireEnHora(jAire, NaN, ahoraAire).estado === 'sin_dato');
const otroOrden = Object.assign({}, jAire, { horas_campos: ['pm25', 't'], horas: [[33, '2026-11-24T23:00:00Z']] });
revisar('horas_campos manda el orden', enHora('2026-11-24T23:10:00Z', otroOrden).pm25 === 33);
// Koschmieder: V ≈ 3,912 / extinción; extinción = Rayleigh + 4 m²/g × 1,5 × PM2,5.
const km = (pm) => V.visibilidad(pm) / 1000;
revisar('visibilidad: 45 µg/m³ da entre 5 y 15 km (mañana mala en Bogotá)', km(45) >= 5 && km(45) <= 15, km(45).toFixed(1) + ' km');
revisar('visibilidad: 6 µg/m³ pasa de 50 km', km(6) > 50, km(6).toFixed(1) + ' km');
revisar('visibilidad: baja con el PM2,5', km(6) > km(25) && km(25) > km(45) && km(45) > km(100));
revisar('extinción = 3,912 / visibilidad', Math.abs(V.extincion(30) * V.visibilidad(30) - 3.912) < 1e-9);
revisar('bruma: el aire de fondo (5 µg/m³) ya lo dibuja el visor, no suma', V.brumaAire(0) === 0 && V.brumaAire(5) === 0);
revisar('bruma: con 6 µg/m³ el aire sucio pone poco (peso < 15 %)', V.pesoBruma(6) > 0 && V.pesoBruma(6) < 0.15, V.pesoBruma(6).toFixed(3));
revisar('bruma: con 45 µg/m³ el aire sucio pone más de 80 % de la extinción', V.pesoBruma(45) > 0.8 && V.pesoBruma(45) < 0.9, V.pesoBruma(45).toFixed(3));
revisar('peso = bruma / extinción total', Math.abs(V.pesoBruma(30) - V.brumaAire(30) / V.extincion(30)) < 1e-12);
revisar('bruma: sube con el PM2,5 y nunca llega a 1', V.pesoBruma(20) < V.pesoBruma(30) && V.pesoBruma(30) < V.pesoBruma(45) && V.pesoBruma(1e4) < 1);
revisar('bruma: sin valor no hay bruma', V.pesoBruma(null) === 0 && V.brumaAire(null) === 0 && V.brumaAire(undefined) === 0 && V.brumaAire(NaN) === 0 && V.brumaAire('x') === 0);

// 9. Una sola fuente escribe el cielo y el JSON del aire no se baja dos veces.
const conSky = fs.readdirSync(path.join(raiz, 'site')).filter((f) => f.endsWith('.js') && /\.setSky\(/.test(leer('site/' + f)));
revisar('solo mapa.js (cielo fijo del 3D) y sol-barra.js llaman setSky', conSky.sort().join(',') === 'mapa.js,sol-barra.js', conSky.join(', '));
const conAireJson = fs.readdirSync(path.join(raiz, 'site')).filter((f) => f.endsWith('.js') && leer('site/' + f).includes('aire/pronostico.json'));
revisar('solo pronostico.js baja aire/pronostico.json', conAireJson.join(',') === 'pronostico.js', conAireJson.join(', '));
const barraTxt = leer('site/sol-barra.js');
revisar('la barra dice que es para toda la ciudad', barraTxt.includes('para toda la ciudad'));
revisar('la barra dice cuándo no hay bruma del aire', barraTxt.includes('no llega a esa hora') && barraTxt.includes('está viejo'));
revisar('la bruma respeta prefers-reduced-motion', /reducido\.matches \? sinTransicion/.test(barraTxt));

cierre('Datos del repo vivo');
