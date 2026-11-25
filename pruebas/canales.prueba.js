'use strict';
// Nivel de canales: decodificar canales/ahora.json, el color según los umbrales del IDIGER y la
// serie, más reglas de la capa (lee solo el repo vivo, crédito, licencia y sin alertas propias).
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
revisar('vivo-datos.js trae las funciones de canales', typeof V.decodificarCanales === 'function' && typeof V.categoriaCanal === 'function');

// 1. Decodificar: v en el orden de campos, umbrales nulos, fuera de la Sabana no se dibuja.
const campos = ['lectura_m', 'espejo_msnm', 'borde_libre_m', 'min_desde_lectura', 'dudoso'];
const sensor = (id, v, extra) => Object.assign({ id, nombre: 'S' + id, cauce: 'RIO TUNJUELO', localidad: 'KENNEDY', lat: 4.6, lon: -74.1,
  tipo_lectura: 2, cota_sensor_msnm: 2554.68, fondo_msnm: 2543, desborde_msnm: 2549.43,
  umbrales_msnm: { bajo: 2546, medio: 2547, alto: 2548 }, hora: '2026-11-25T00:10:00Z', v }, extra || {});
const doc = { esquema: 'bogotwin/canales/1', campos, cadencia_min: 10, hora_dato: '2026-11-25T00:10:00Z', etiquetas: { borde_libre_m: 'inferido' },
  sensores: [
    sensor('a', [10.18, 2544.5, 4.93, 4, 0]),
    sensor('b', [8.18, 2546.5, 2.93, 4, 0]),
    sensor('c', [7.18, 2547.5, 1.93, 4, 0]),
    sensor('d', [6.18, 2548.5, 0.93, 4, 0]),
    sensor('e', [5, 2549.68, -0.25, 4, 0]),
    sensor('f', [8.03, 2569.47, 2.43, 3, 0], { umbrales_msnm: null }),
    sensor('g', [8.03, 2569.47, 2.43, 95, 0]),
    sensor('h', [-1, 2555.68, -6.25, 4, 1]),
    sensor('i', [null, null, null, null, 0], { tipo_lectura: 7 }),
    sensor('j', [1, 2, 3, 4, 0], { lat: 10.4, lon: -75.5 }),
    sensor('k', [8.03, 2569.47, 2.43, 3, 0], { umbrales_msnm: { bajo: 1, medio: null, alto: 3 } })
  ] };
const d = V.decodificarCanales(doc);
const cat = Object.fromEntries(d.sensores.map((s) => [s.id, s.cat]));
revisar('fuera de la Sabana no se dibuja', d.sensores.length === 10 && !('j' in cat));
revisar('por debajo del nivel bajo', cat.a === 'bajo_umbral');
revisar('bajo, medio y alto según el espejo frente a los umbrales del IDIGER', cat.b === 'bajo' && cat.c === 'medio' && cat.d === 'alto');
revisar('borde libre ≤ 0 es desborde, aunque haya umbrales', cat.e === 'desborde');
revisar('sin umbrales publicados no se inventa un color de nivel', cat.f === 'sin_umbrales');
revisar('un umbral a medias cuenta como sin umbrales', cat.k === 'sin_umbrales');
revisar('más de 60 min sin lectura es quieto', cat.g === 'quieto');
revisar('dudoso gana sobre desborde', cat.h === 'dudoso');
revisar('tipo de lectura desconocido queda sin dato', cat.i === 'sin_dato');
const a = d.sensores.find((s) => s.id === 'a');
revisar('lee espejo, borde y lectura en el orden de campos', a.lectura === 10.18 && a.espejo === 2544.5 && a.borde === 4.93 && a.min_desde_lectura === 4 && a.dudoso === false);
revisar('trae la cota de desborde y los umbrales de la fuente', a.desborde === 2549.43 && a.umbrales.alto === 2548);
revisar('pasa las etiquetas del JSON', d.etiquetas.borde_libre_m === 'inferido' && d.cadencia === 10);
let rompe = false;
try { V.decodificarCanales({ esquema: 'bogotwin/bicis/1', campos: [], sensores: [] }); } catch { rompe = true; }
revisar('otro esquema no se lee como canales', rompe);

// 2. Serie: por id en cada línea, ordenada, salta nulos.
const lineas = V.leerNdjson('{"t":"2026-11-25T00:10:00Z","ids":["a","b"],"v":[[10.1,2544.58,4.85,1,0],[8,2546.6,2.8,1,0]]}\n' +
  '{"t":"2026-11-25T00:00:00Z","ids":["b","a"],"v":[[8,2546.6,2.8,1,0],[10.18,2544.5,4.93,1,0]]}\n' +
  '{"t":"2026-11-24T23:50:00Z","ids":["a"],"v":[[null,null,null,null,0]]}\n');
const se = V.serieCanal(lineas, 'a', campos, 'espejo_msnm');
revisar('serieCanal ordena por hora, busca el id y salta nulos', se.length === 2 && se[0][1] === 2544.5 && se[1][1] === 2544.58);
revisar('serieCanal usa el borde libre por defecto', V.serieCanal(lineas, 'a', campos)[1][1] === 4.85);

// 3. La capa: solo el repo vivo, crédito, licencia, enlace al visor oficial y sin alertas propias.
const js = leer('site/canales.js');
revisar('canales.js lee del repo vivo y no del SAB', /V\.url\('canales\/ahora\.json'\)/.test(js) && !/ServletTipoSensores|fetch\([^)]*sab\.gov/.test(js));
revisar('canales.js dice la licencia CC BY-NC y el crédito al IDIGER', /by-nc\/4\.0/.test(js) && /IDIGER/.test(js) && /SAB/.test(js));
revisar('canales.js enlaza al visor oficial y dice que no emite alertas', /niveles_umbrales\.htm/.test(js) && /no emite alertas/.test(js));
revisar('canales.js no trae licencias SA', !/by-sa/i.test(js));
revisar('canales.js no promete en vivo ni tiempo real', !/en vivo|tiempo real/i.test(js));
const mapa = leer('site/mapa.js'), html = leer('site/index.html'), fuentes = leer('site/fuentes.html');
revisar('mapa.js baja canales.js solo al prender y atiende el toque', /script: 'canales\.js'/.test(mapa) && /B\.canales\.tocar\(e\)/.test(mapa));
revisar('index.html trae la casilla y la caja de leyenda', /id="ver-canales"/.test(html) && /id="canales-leyenda"/.test(html));
revisar('index.html no carga canales.js de entrada', !/<script[^>]*canales\.js/.test(html));
const fila = (fuentes.match(/<tr><td>Nivel de quebradas[\s\S]*?<\/tr>/) || [''])[0];
revisar('fuentes.html trae la fila del nivel con CC BY-NC y la regla de no mezclar con SA', /by-nc\/4\.0/.test(fila) && /CC BY‑SA/.test(fila) && /10 min/.test(fila));

cierre('Nivel de canales');
