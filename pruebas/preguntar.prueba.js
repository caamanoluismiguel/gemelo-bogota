'use strict';
// «Pregúntale a la ciudad»: qué entiende de cada pregunta, qué lugar reconoce y qué responde con
// datos de prueba y con los archivos reales del sitio. Nada se inventa: sin dato, «no lo sé».
// El edificio más alto usa las teselas de mapa-base/salida; si no están (CI), esa parte salta.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const json = (r) => JSON.parse(leer(r));
const caja = { window: {} };
vm.createContext(caja);
for (const f of ['site/preguntar-logica.js', 'site/vivo-datos.js', 'site/aire-anual-datos.js']) vm.runInContext(leer(f), caja);
const P = caja.window.Bogotwin.preguntar;
const V = caja.window.Bogotwin.vivo;
const AA = caja.window.Bogotwin.aireAnualDatos;
const sol = require('../site/sol.js');
revisar('preguntar-logica.js deja Bogotwin.preguntar', !!P && typeof P.detectarIntencion === 'function');

const MARCAS = new Set(['medido', 'de_fuente', 'estimado', 'inferido', 'supuesto']);
const texto = (r) => r.bloques.map((b) => b.map((x) => (typeof x === 'string' ? x : x.v)).join('')).join(' ');
const cifras = (r) => r.bloques.flat().filter((x) => typeof x !== 'string');
// Toda respuesta: cada cifra con marca conocida, cada fuente con su marca, y nada simulado.
function bienFormada(nombre, r) {
  const malas = cifras(r).filter((x) => !MARCAS.has(x.m));
  revisar(`${nombre}: cada cifra lleva su marca`, malas.length === 0, malas.map((x) => x.v).join(', '));
  if (r.sabe) {
    revisar(`${nombre}: dice de dónde sale`, r.procedencia.length > 0 && r.procedencia.every((p) => MARCAS.has(p.tipo) && p.fuente));
    revisar(`${nombre}: lleva el mapa a la respuesta`, !!r.vuelo && (!!r.vuelo.centro || (Array.isArray(r.vuelo.bbox) && r.vuelo.bbox.every(Number.isFinite))));
  }
  revisar(`${nombre}: sin punto doble tras la hora`, !/m\.\./.test(texto(r)), texto(r));
  revisar(`${nombre}: sin decimales con punto`, !/\d\.\d{1,2}\b/.test(texto(r).replace(/\d+:\d+/g, '')), texto(r));
}

// 1. Intención: las ocho preguntas de los chips y variantes sin tildes, en mayúsculas o con otras palabras.
const esperadas = ['aire', 'lluvia', 'frio', 'edificio_alto', 'canal', 'bicis', 'sol', 'colegios_aire'];
P.SUGERENCIAS.forEach((q, i) => revisar(`«${q}» es ${esperadas[i]}`, P.detectarIntencion(q).intencion === esperadas[i], P.detectarIntencion(q).intencion));
const variantes = [
  ['COMO ESTA EL AIRE EN KENNEDY', 'aire'], ['como esta la contaminacion', 'aire'], ['¿llueve?', 'lluvia'], ['necesito paraguas', 'lluvia'],
  ['va a hacer frio', 'frio'], ['habrá helada', 'frio'], ['torre más alta', 'edificio_alto'], ['se desbordó algún río', 'canal'],
  ['dónde hay una cicla', 'bicis'], ['a qué hora amanece', 'sol'], ['a qué hora se pone el sol', 'sol'], ['qué escuelas respiran peor aire', 'colegios_aire'],
  ['qué temperatura hace', 'temperatura'], ['índice UV', 'uv'], ['hay trancón en la séptima', 'no_se'], ['cuéntame un chiste', 'desconocida'], ['   ', 'vacia']
];
for (const [q, i] of variantes) revisar(`«${q}» es ${i}`, P.detectarIntencion(q).intencion === i, P.detectarIntencion(q).intencion);

// 2. Lugares del buscador, con o sin tildes. Gana el nombre más largo; a igual nombre, la localidad.
const indice = P.prepararIndice(json('site/datos/buscador.json').filas);
const lugar = (q) => P.buscarLugar(q, indice);
revisar('Kennedy es la localidad', (lugar('¿cómo está el aire en Kennedy?') || {}).nivel === 'localidad');
revisar('«usaquen» sin tilde encuentra Usaquén', (lugar('aire en usaquen') || {}).nombre === 'Usaquén');
revisar('«ENGATIVÁ» con tilde encuentra Engativá', (lugar('EDIFICIO MÁS ALTO DE ENGATIVÁ') || {}).nombre === 'Engativá');
revisar('«Chapinero Central» gana a Chapinero', (lugar('edificio más alto de chapinero central') || {}).nombre === 'Chapinero Central');
revisar('una pregunta sin lugar no inventa uno', lugar('¿va a llover hoy?') === null && lugar('¿a qué hora sale el sol?') === null && lugar('¿hay algún canal en alerta?') === null);
revisar('Bogotá no es un lugar del índice', lugar('aire en bogota') === null);
revisar('un sitio que no existe se reconoce como nombrado', P.lugarNombrado('aire en Chapinerox') === 'chapinerox' && lugar('aire en Chapinerox') === null);
const k = lugar('aire en kennedy');
revisar('el lugar trae caja y centro', k && k.bbox.length === 4 && k.centro.lat > 4.5 && k.centro.lat < 4.7);

// 3. Calles: «la 72» es la calle 72 y cae en la estación de TransMilenio de ese nombre.
revisar('«la 72» es la calle 72', JSON.stringify(P.calleEn('bicis cerca de la 72')) === '{"via":"calle","numero":72,"sur":false}');
revisar('«kr 7» es la carrera 7', (P.calleEn('bicis en la kr 7') || {}).via === 'carrera');
revisar('«calle 40 sur» es sur', (P.calleEn('bicis cerca de la calle 40 sur') || {}).sur === true);
const tm = json('site/datos/transporte/troncales.geojson').features.filter((f) => f.geometry.type === 'Point')
  .map((f) => ({ nombre: f.properties.nombre, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
const p72 = P.puntoDeCalle(P.calleEn('la 72'), tm, []);
revisar('la 72 cae en la estación Calle 72 de TransMilenio', p72 && /Calle 72/.test(p72.por) && Math.abs(p72.lat - 4.657) < 0.01, p72 && p72.por);
const p40 = P.puntoDeCalle(P.calleEn('calle 40 sur'), tm, []);
revisar('la calle 40 sur no se confunde con la 40 norte', p40 && /40 Sur/.test(p40.por), p40 && p40.por);
const pBici = P.puntoDeCalle({ via: 'calle', numero: 82, sur: false }, [], [{ nombre: '001 - CL 82 con KR 11', lat: 4.6658, lon: -74.0528 }]);
revisar('sin estación de TM, la calle sale de las bicis que la nombran', pBici && Math.abs(pBici.lat - 4.6658) < 1e-6);

// 4. Lluvia: pronóstico de El Dorado y pluviómetros del SAB. Ahora = 25 nov 2026, 10:00 de Bogotá.
const AHORA = Date.parse('2026-11-25T15:00:00Z');
const horasPron = [];
for (let h = -2; h < 48; h++) horasPron.push({ t: new Date(AHORA + h * 3600000).toISOString(), temp_c: 14 - Math.abs(h - 20) * 0.3, prob_lluvia_pct: h === 5 ? 62 : 10, lluvia_mm: h === 5 ? 1.2 : 0 });
const pron = { esquema: 'bogotwin/pronostico/1', generado: '2026-11-25T14:20:00Z', cadencia_min: 60, horas: horasPron };
const cielo = { fuentes: {
  lluvia_sab: { estado: 'ok', hora_dato: '2026-11-25T14:59:00Z', estaciones: [
    { nombre: 'COLMAC', localidad: 'Usaquen', lat: 4.81, lon: -74.03, sin_dato_hoy: false, acumulado_hoy_mm: 3.4, ultimo_minuto_mm: 0.2 },
    { nombre: 'SAN JOSE', localidad: 'Kennedy', lat: 4.62, lon: -74.15, sin_dato_hoy: false, acumulado_hoy_mm: 0, ultimo_minuto_mm: 0 },
    { nombre: 'SIN DATO', localidad: 'Bosa', lat: 4.6, lon: -74.2, sin_dato_hoy: true, acumulado_hoy_mm: null }] },
  metar: { estado: 'ok', hora_dato: '2026-11-25T15:00:00Z', estaciones: [{ nombre: 'El Dorado', temperatura_c: 16, hora_dato: '2026-11-25T15:00:00Z' }] },
  uv: { estado: 'ok', uv_hora_actual: 7.2, hora_dato: '2026-11-25T15:00:00Z' }
} };
const rl = P.responderLluvia({ pronostico: pron, cielo, ahora: AHORA });
bienFormada('lluvia', rl);
revisar('lluvia: la probabilidad más alta de lo que queda de hoy (62 %)', cifras(rl).some((x) => x.v === '62 %' && x.m === 'estimado'), texto(rl));
revisar('lluvia: lo medido por el SAB va como medido', cifras(rl).some((x) => x.v === '3,4 mm' && x.m === 'medido'));
revisar('lluvia: cuenta solo los pluviómetros con dato de hoy', /1 de 2 pluviómetros/.test(texto(rl).replace(/\s+/g, ' ')), texto(rl));
revisar('lluvia: prende la capa de lluvia', rl.capas.includes('[data-grupo="lluvia"]'));
revisar('lluvia: si el máximo de hoy es el de las 24 h, no lo repite', !/próximas 24 horas/.test(texto(rl)), texto(rl));
// El máximo de las próximas 24 h cae mañana de madrugada: la respuesta lo dice, igual que la franja.
const pron24 = Object.assign({}, pron, { horas: horasPron.map((h, i) => Object.assign({}, h, { prob_lluvia_pct: i === 2 + 18 ? 88 : h.prob_lluvia_pct })) });
const rl24 = P.responderLluvia({ pronostico: pron24, cielo, ahora: AHORA });
revisar('lluvia: dice también el máximo de las próximas 24 h, con su hora', cifras(rl24).some((x) => x.v === '62 %') && cifras(rl24).some((x) => x.v === '88 %') && /próximas 24 horas[^.]*mañana a las 4:00\sa\.\sm\./.test(texto(rl24)), texto(rl24));
const rl0 = P.responderLluvia({ pronostico: null, cielo: null, ahora: AHORA });
revisar('lluvia sin datos: «Eso no lo sé todavía», sin cifras', !rl0.sabe && /^Eso no lo sé todavía/.test(texto(rl0)) && cifras(rl0).length === 0);
revisar('sin datos ofrece las preguntas que sí sabe', rl0.sugerencias.length === P.SUGERENCIAS.length);

// 5. Frío: la noche de 18:00 a 06:00, el rango de siete modelos y la última noche medida.
const nf = json('data/noches-frias/2026-11-24.json'); // registro real: pronostica las noches que terminan el 25, 26 y 27
const rf = P.responderFrio({ pronostico: pron, noches: nf, ahora: AHORA });
bienFormada('frío', rf);
const minNoche = Math.min(...horasPron.filter((h) => { const t = Date.parse(h.t); return t >= Date.parse('2026-11-25T23:00:00Z') && t <= Date.parse('2026-11-26T11:00:00Z'); }).map((h) => h.temp_c));
revisar('frío: la mínima de esta noche sale del pronóstico', cifras(rf).some((x) => x.m === 'estimado' && x.v === new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(minNoche) + ' °C'), texto(rf));
revisar('frío: usa el rango de los modelos para la noche que termina mañana', /entre/.test(texto(rf)) && cifras(rf).some((x) => / y .* °C$/.test(x.v)), texto(rf));
revisar('frío: la última noche va como medido', cifras(rf).some((x) => x.m === 'medido'));
const n1 = P.nocheDe(Date.parse('2026-11-25T08:00:00Z')); // 3:00 de Bogotá
revisar('a las 3:00 la noche es la que va hasta las 6:00 de hoy', n1.termina === '2026-11-25' && n1.hasta === Date.parse('2026-11-25T11:00:00Z'));
const n2 = P.nocheDe(AHORA);
revisar('a las 10:00 la noche es la de hoy a mañana', n2.termina === '2026-11-26' && n2.desde === Date.parse('2026-11-25T23:00:00Z'));
revisar('frío sin pronóstico ni registro: no lo sé', !P.responderFrio({ pronostico: null, noches: null, ahora: AHORA }).sabe);

// 6. Sol: cálculo de sol.js para el centro de Bogotá.
const rs = P.responderSol({ sol, ahora: Date.parse('2026-11-25T08:00:00Z'), texto: '¿a qué hora sale el sol?' });
bienFormada('sol', rs);
const salida = cifras(rs)[0].v;
revisar('sol: sale entre 5:30 y 6:00 a. m. a fin de noviembre', /^5:[3-5]\d\sa/.test(salida), salida);
revisar('sol: va como inferido', cifras(rs).every((x) => x.m === 'inferido'));
const rs2 = P.responderSol({ sol, ahora: Date.parse('2026-11-25T20:00:00Z'), texto: 'a qué hora sale el sol' });
revisar('sol: pasada la salida, responde la de mañana y la puesta de hoy', /mañana/.test(texto(rs2)) && /Hoy se pone/.test(texto(rs2)), texto(rs2));
const rs3 = P.responderSol({ sol, ahora: Date.parse('2026-11-25T08:00:00Z'), texto: 'a qué hora se pone el sol' });
revisar('sol: «se pone» responde la puesta', /se pone hoy/.test(texto(rs3)) && /p\.\s?m\./.test(cifras(rs3)[0].v), texto(rs3));

// 7. Canales: categorías de vivo-datos.js con umbrales del IDIGER.
const sensor = (id, espejo, u, extra) => Object.assign({ id, nombre: 'Sensor ' + id, cauce: 'RIO FUCHA', localidad: 'KENNEDY', lat: 4.6, lon: -74.12,
  tipo_lectura: 1, desborde_msnm: 2600, umbrales_msnm: u, v: [1, espejo, 2600 - espejo, 5, 0] }, extra);
const U = { bajo: 2590, medio: 2594, alto: 2597 };
const canalesJ = { esquema: 'bogotwin/canales/1', hora_dato: '2026-11-25T14:50:00Z', cadencia_min: 10, campos: ['lectura_m', 'espejo_msnm', 'borde_libre_m', 'min_desde_lectura', 'dudoso'],
  sensores: [sensor('1', 2585, U), sensor('2', 2595, U), sensor('3', 2591, null)] };
const rc = P.responderCanales({ canales: V.decodificarCanales(canalesJ) });
bienFormada('canales', rc);
revisar('canales: ninguno en alto, uno en medio', /Ningún sensor llega al nivel alto/.test(texto(rc)) && cifras(rc).some((x) => x.v === '1' && x.m === 'medido'), texto(rc));
revisar('canales: el más cerca del umbral es el 2', /Sensor 2/.test(texto(rc)));
revisar('canales: aclara que las alertas son del IDIGER', rc.notas.some((n) => /alertas oficiales las da el IDIGER/.test(n)));
canalesJ.sensores.push(sensor('4', 2598, U));
const rc2 = P.responderCanales({ canales: V.decodificarCanales(canalesJ) });
revisar('canales: con uno en alto lo dice primero', /^1 sensor está en el nivel alto/.test(texto(rc2)), texto(rc2));
revisar('canales sin dato: no lo sé', !P.responderCanales({ canales: null }).sabe);

// 8. Bicis: las tres más cerca con bicis, sin las quietas ni las dudosas.
const est = (id, lat, lon, v) => ({ id, nombre: `0${id} - CL 72 con KR ${id}`, lat, lon, capacidad: 20, v });
const bicisJ = { esquema: 'bogotwin/bicis/1', hora_dato: '2026-11-25T14:58:00Z', cadencia_min: 10, fuente: { licencia: { nombre: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } },
  campos: ['bicis', 'electricas', 'anclajes_libres', 'bicis_fuera_de_servicio', 'anclajes_fuera_de_servicio', 'estado', 'min_desde_reporte'],
  estaciones: [est(1, 4.6572, -74.0623, [5, 2, 10, 0, 0, 7, 2]), est(2, 4.6572, -74.0600, [0, 0, 15, 0, 0, 7, 2]),
    est(3, 4.6580, -74.0630, [4, 0, 10, 0, 0, 7, 300]), est(4, 4.6600, -74.0650, [3, 1, 10, 0, 0, 7, 3]), est(5, 4.6500, -74.0700, [8, 0, 2, 0, 0, 15, 3])] };
const rb = P.responderBicis({ bicis: V.decodificarBicis(bicisJ), punto: p72 });
bienFormada('bicis', rb);
const tb = texto(rb);
revisar('bicis: la más cerca primero, con eléctricas', tb.indexOf('KR 1') > 0 && tb.indexOf('KR 1') < tb.indexOf('KR 4') && /2 eléctricas/.test(tb), tb);
revisar('bicis: sin la vacía, la quieta ni la dudosa', !/KR 2\b/.test(tb) && !/KR 3\b/.test(tb) && !/KR 5\b/.test(tb), tb);
revisar('bicis: las cifras van de fuente', cifras(rb).every((x) => x.m === 'de_fuente'));
revisar('bicis: prende la capa', rb.capas.includes('#ver-bicis'));
const rb0 = P.responderBicis({ bicis: V.decodificarBicis(bicisJ), punto: null });
revisar('bicis sin lugar: pide uno, no adivina', !rb0.sabe && /Dime cerca de dónde/.test(texto(rb0)));

// 9. Aire: CAMS para toda la ciudad (estimado) y la superficie anual de la SDA en el lugar (inferido).
const fc = json('site/datos/aire/pm25-anual-2025.geojson');
const h0 = new Date(Math.floor(AHORA / 3600000) * 3600000).toISOString().replace('.000Z', 'Z');
const aireJ = { esquema: 'bogotwin/aire/1', generado: '2026-11-25T14:30:00Z', cadencia_min: 60, horas_campos: ['t', 'pm25'], horas: [[h0, 21.4]],
  dias: [{ fecha_bogota: '2026-11-25', media: 17.3, maxima: 40.5, horas: 20 }] };
const ra = P.responderAire({ aire: aireJ, ahora: AHORA, lugar: k, pm25: fc, aa: AA });
bienFormada('aire', ra);
revisar('aire: el PM2,5 de esta hora es estimado y para toda la ciudad', cifras(ra).some((x) => x.v === '21,4 µg/m³' && x.m === 'estimado') && /no distingue Kennedy/.test(texto(ra)), texto(ra));
const fK = AA.franjaEn(fc, k.centro.lon, k.centro.lat);
revisar('aire: el promedio de 2025 en Kennedy es el de su franja', fK && cifras(ra).some((x) => x.m === 'inferido' && x.v.startsWith(AA.coma ? AA.coma(fK.properties.pm25) : '')), texto(ra));
revisar('aire: compara con la OMS', /guía anual de la OMS/.test(texto(ra)));
const raV = P.responderAire({ aire: Object.assign({}, aireJ, { generado: '2026-11-25T08:00:00Z' }), ahora: AHORA, lugar: null, pm25: fc, aa: AA });
revisar('aire con el pronóstico viejo y sin lugar: no lo sé', !raV.sabe);

// 10. Colegios: los que caen en la franja más alta de 2025, entre todos o dentro de un lugar.
const col = json('site/datos/aire/colegios-sed.geojson');
const rco = P.responderColegios({ colegios: col, pm25: fc, aa: AA, lugar: null });
bienFormada('colegios', rco);
const maxFranja = Math.max(...col.features.map((f) => AA.franjaEn(fc, ...f.geometry.coordinates)).filter(Boolean).map((f) => f.properties.pm25));
revisar('colegios: usa la franja más alta que toca algún colegio', cifras(rco).some((x) => x.m === 'inferido' && x.v === AA.coma(maxFranja) + ' µg/m³'), texto(rco));
revisar('colegios: nombra hasta tres, sin repetir', /(Son: |Es el )[^.]+/.test(texto(rco)) && (() => { const l = texto(rco).split(/Son: |Es el /).pop().replace(/\.$/, '').split(/; | y \d/); return l.length <= 3 && new Set(l).size === l.length; })(), texto(rco));
revisar('colegios: cuenta sedes y junta las sedes de un mismo colegio', /De las [\d.]+ sedes de colegios/.test(texto(rco)) && !/Torres \(IED\)[^.]*Torres \(IED\)/.test(texto(rco)), texto(rco));
revisar('colegios: siglas y tildes en los nombres', AA.nombre('COLEGIO REPUBLICA DE PANAMA (IED)') === 'Colegio República de Panamá (IED)' && AA.nombre('SEDE A - MARIA CRISTINA') === 'Sede A - María Cristina' && !/\(Ied\)/.test(texto(rco)));
revisar('colegios: aclara que no es una medición en el colegio', rco.notas.some((n) => /no una medición en cada colegio/.test(n)));
const rcoK = P.responderColegios({ colegios: col, pm25: fc, aa: AA, lugar: k });
revisar('colegios en Kennedy: solo de Kennedy (caja)', rcoK.sabe && rcoK.vuelo.bbox[0] >= k.bbox[0] - 1e-9 && rcoK.vuelo.bbox[2] <= k.bbox[2] + 1e-9);

// 11. Temperatura y UV del JSON del cielo.
const rt = P.responderTemperatura({ cielo, ahora: AHORA });
bienFormada('temperatura', rt);
revisar('temperatura: El Dorado medido', cifras(rt).some((x) => x.v === '16 °C' && x.m === 'medido'));
const ru = P.responderUV({ cielo });
revisar('UV: 7,2 estimado, alto', cifras(ru).some((x) => x.v === '7,2' && x.m === 'estimado') && /alto/.test(texto(ru)));

// 12. Lo que no sabemos: lo dice claro y ofrece lo que sí.
const rn = P.responderNoSe('¿hay trancón en la séptima?');
revisar('tráfico: «Eso no lo sé todavía» y que no hay datos de tráfico', !rn.sabe && /^Eso no lo sé todavía\. El gemelo no tiene datos de tráfico\./.test(texto(rn)), texto(rn));
revisar('tráfico: ofrece las ocho preguntas', JSON.stringify(rn.sugerencias) === JSON.stringify(P.SUGERENCIAS));
revisar('tráfico: sin cifras', cifras(rn).length === 0);

// 13. Geometría de teselas: la esquina de la tesela 10/301/498 cae en su lon y lat.
const [lon0, lat0] = P.teselaALonLat(10, 301, 498, 4096, 0, 0);
revisar('esquina de la tesela 10/301/498', Math.abs(lon0 - (301 / 1024 * 360 - 180)) < 1e-9 && lat0 > 4.8 && lat0 < 5.0, `${lon0}, ${lat0}`);
revisar('teselas z10 de Bogotá, con Sumapaz, son 8', P.teselasDe([-74.45, 3.73, -73.99, 4.84], 10).length === 8);

// 14. Edificio más alto con las teselas reales (si están).
const CAT = path.join(raiz, 'mapa-base', 'salida', 'catastro-pisos-bogota.pmtiles');
const LIM = path.join(raiz, 'mapa-base', 'salida', 'limites-bogota.pmtiles');
if (!fs.existsSync(CAT) || !fs.existsSync(LIM)) {
  console.log('SALTA  no están las teselas de mapa-base/salida');
} else {
  const mvt = require('../site/mvt.js');
  const { abrir } = require('./pmtiles-leer');
  const cat = abrir(CAT), lim = abrir(LIM);
  const bytes = (a, z, x, y) => { let t = a.tesela(z, x, y); if (t && t[0] === 0x1f) t = zlib.gunzipSync(t); return t; };
  const capa = (a, z, bbox, nombre) => P.teselasDe(bbox, z).flatMap(([tz, x, y]) => {
    const t = bytes(a, tz, x, y); const c = t && mvt.leerCapa(t, nombre);
    return c ? c.objetos.map((o) => Object.assign({}, o.propiedades, { anillos: P.anillosALonLat(tz, x, y, c.extension, o.anillos) })) : [];
  });
  const BOG = [-74.45, 3.73, -73.99, 4.84];
  const sectores = capa(cat, 10, BOG, 'pisos_sector');
  const ciudad = P.sectorMasAlto(sectores, null);
  revisar('edificio: en toda Bogotá sale un sector con su máximo de pisos', ciudad && ciudad.pisos_max >= 40, ciudad && `${ciudad.nombre} ${ciudad.pisos_max}`);
  const ch = lugar('edificio más alto de chapinero');
  const piezas = capa(lim, 10, ch.bbox, 'localidades').filter((o) => P.normalizar(o.nombre) === ch.clave);
  revisar('edificio: el polígono de Chapinero está en los límites', piezas.length > 0);
  const chP = Object.assign({}, ch, { anillos: piezas.flatMap((o) => o.anillos) });
  const sCh = P.sectorMasAlto(sectores, chP);
  revisar('edificio: Chapinero tiene su sector más alto, no más alto que la ciudad', sCh && sCh.pisos_max <= ciudad.pisos_max, sCh && `${sCh.nombre} ${sCh.pisos_max}`);
  const c = P.centroAnillo(sCh.anillos[0]);
  revisar('edificio: ese sector cae dentro de Chapinero', P.enPoligonos(c.lon, c.lat, chP.anillos));
  const bb = P.cajaDe(sCh.anillos[0].map((p) => ({ lon: p[0], lat: p[1] })));
  const ed = P.edificioEnSector(capa(cat, 15, bb, 'construcciones'), sCh);
  revisar('edificio: en z15 aparece la construcción con esos pisos', ed && ed.pisos === sCh.pisos_max, ed && String(ed.pisos));
  const re = P.responderEdificio({ sector: sCh, edificio: ed, lugar: chP });
  bienFormada('edificio', re);
  revisar('edificio: pisos de fuente y el supuesto de 3 m dicho como supuesto', cifras(re).every((x) => x.m === 'de_fuente') && re.notas.some((n) => /pisos, no metros/.test(n) && /supuesto/.test(n)));
  revisar('edificio: vuela al edificio', re.vuelo.zoom === 17);
  cat.cerrar(); lim.cerrar();
}

// 15. Lo de la página: la caja baja la lógica solo al usarla y no trae estilos en línea.
const html = leer('site/index.html');
revisar('index.html carga preguntar.js y no la lógica', /<script defer src="preguntar\.js"><\/script>/.test(html) && !/preguntar-logica\.js/.test(html));
revisar('la caja está en la cabecera del panel, antes de la franja', html.indexOf('id="preguntar"') > html.indexOf('class="cabeza"') && html.indexOf('id="preguntar"') < html.indexOf('id="ahora-franja"'));
const ui = leer('site/preguntar.js');
revisar('preguntar.js baja preguntar-logica.js', /bajarJs\('preguntar-logica\.js'\)/.test(ui));
const base = ui.match(/SUGERENCIAS_BASE = \[([^\]]+)\]/);
revisar('los chips de arranque son las mismas preguntas de la lógica', base && JSON.stringify(JSON.parse('[' + base[1].replace(/'/g, '"') + ']')) === JSON.stringify(P.SUGERENCIAS));
revisar('sin estilos en línea ni innerHTML', !/innerHTML|style=|setAttribute\('style'/.test(ui + leer('site/preguntar-logica.js')));
revisar('sin claves ni servicios de pago', !/api[_-]?key|anthropic|openai|Authorization/i.test(ui + leer('site/preguntar-logica.js')));

cierre('Pregúntale a la ciudad');
