'use strict';
// Buses troncales programados por hora (frecuencia.js y pipelines/frecuencia): cálculo de la capa,
// la copia del sitio, el cableado en el panel y que nunca se presente como lo que pasa ahora.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const caja = { window: { Bogotwin: { vivo: {}, el: () => null } } };
vm.createContext(caja);
vm.runInContext(leer('site/frecuencia.js'), caja);
const F = caja.window.Bogotwin.frecuencia;
revisar('frecuencia.js expone prender, apagar, tocar y el cálculo', F && ['prender', 'apagar', 'tocar'].every((k) => typeof F[k] === 'function') && F.calc);
const C = F.calc;

// 1. Tipo de día en Bogotá: domingo y festivo juntos.
const fest = ['2026-12-08'];
revisar('lunes a viernes: hábil', C.tipoDia('2026-11-25', 3, fest) === 'habil');
revisar('sábado', C.tipoDia('2026-11-28', 6, fest) === 'sabado');
revisar('domingo', C.tipoDia('2026-11-29', 0, fest) === 'domingo');
revisar('un festivo entre semana va como domingo', C.tipoDia('2026-12-08', 2, fest) === 'domingo');
const b = C.enBogota(Date.parse('2026-11-26T04:30:00Z'));
revisar('las 4:30 Z del jueves son las 11 p. m. del miércoles en Bogotá', b.ymd === '2026-11-25' && b.diaSemana === 3 && b.hora === 23, JSON.stringify(b));

// 2. Colores por pasos planos.
revisar('cero buses: gris', C.color(0) === '#bdbdbd');
revisar('29 y 30 caen en pasos distintos', C.color(29) !== C.color(30));
revisar('400 o más: el más oscuro', C.color(579) === C.PASOS[C.PASOS.length - 1][1]);
revisar('los pasos suben sin saltos', C.PASOS.every((p, i) => !i || p[0] > C.PASOS[i - 1][0]));
revisar('sin degradados en la capa ni en sus estilos', !/gradient/i.test(leer('site/frecuencia.js')) && !/gradient/i.test(leer('site/estilo.css').split('frecuencia.js')[1] || ''));

// 3. Decodificar, sumar y ordenar.
const serie = (h, v) => Array.from({ length: 24 }, (_, i) => (i === h ? v : 0));
const doc = { esquema: 'bogotwin/troncal-frecuencia/1', festivos: fest,
  estaciones: [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' }],
  tramos: [
    { a: 0, b: 1, c: [[-74.1, 4.6], [-74.09, 4.6]], f: { habil: serie(7, 300), sabado: serie(7, 0), domingo: serie(7, 0) } },
    { a: 1, b: 2, c: [[-74.09, 4.6], [-74.08, 4.6]], f: { habil: serie(7, 20), sabado: serie(7, 5), domingo: serie(7, 0) } }
  ] };
const d = C.decodificar(doc);
revisar('decodifica un archivo bueno', d === doc);
let malo = false;
try { C.decodificar(Object.assign({}, doc, { esquema: 'otro' })); } catch { malo = true; }
revisar('rechaza otro esquema', malo);
malo = false;
try { C.decodificar(Object.assign({}, doc, { tramos: [{ a: 0, b: 9, c: [], f: doc.tramos[0].f }] })); } catch { malo = true; }
revisar('rechaza un tramo con una estación que no existe', malo);
const s = C.suma(d, [0, 1], 'habil');
revisar('la suma de dos tramos por la misma vía', s[7] === 320 && s.length === 24);
const fc = C.geojson(d, 'habil', 7);
revisar('el más cargado se dibuja al final, encima', fc.features[1].properties.v === 300 && fc.features[0].properties.v === 20);
revisar('cada línea lleva su color y su índice', fc.features.every((f) => f.properties.col && Number.isInteger(f.properties.i)));

// 4. La copia del sitio.
const copiaRuta = 'site/datos/transporte/troncal-frecuencia.json';
const copiaTexto = leer(copiaRuta);
const copia = JSON.parse(copiaTexto);
revisar('la copia del sitio decodifica', (() => { try { C.decodificar(copia); return true; } catch { return false; } })());
revisar('la copia dice «programado», CC BY-SA 4.0 y la fuente con sha256', copia.marca === 'programado' && copia.licencia.id === 'CC-BY-SA-4.0' && /^[0-9a-f]{64}$/.test(copia.fuente.sha256));
revisar('la copia no trae nada del modo de prueba sin licencia revisada', !!copia.licencia.revisada, String(copia.licencia.revisada));
const gz = zlib.gzipSync(Buffer.from(copiaTexto), { level: 9 }).length;
revisar('liviana para el teléfono: menos de 45 KB comprimida', gz < 45000, `${gz} B`);
revisar('más de 150 tramos y 150 estaciones troncales', copia.tramos.length > 150 && copia.estaciones.length > 150);
revisar('ningún tramo con horas fuera de 24 ni valores negativos', copia.tramos.every((t) => C.TIPOS.every((k) => t.f[k].length === 24 && t.f[k].every((v) => Number.isInteger(v) && v >= 0))));
revisar('coordenadas dentro de Bogotá', copia.tramos.every((t) => t.c.every(([x, y]) => x > -74.3 && x < -73.95 && y > 4.45 && y < 4.85)));

// 5. Cableado: casilla de color en «Ahora», leyenda propia, capaViva y toque.
const html = leer('site/index.html');
const mapa = leer('site/mapa.js');
revisar('casilla de color en la pestaña Ahora', /data-pestana="ahora" data-tipo="color"><input type="checkbox" id="ver-frecuencia">[^<]*programados/.test(html));
revisar('bloque propio en la leyenda flotante', html.includes('data-capa="frecuencia"') && html.includes('id="frecuencia-leyenda"'));
revisar('mapa.js la carga con capaViva y la consulta al tocar', /capaViva\(\{ caja: 'ver-frecuencia'[^)]*script: 'frecuencia.js'/.test(mapa) && mapa.includes('B.frecuencia.tocar(e)'));
revisar('tiene nombre para el aviso de una capa de color a la vez', mapa.includes("'ver-frecuencia': ['los buses programados'"));
const js = leer('site/frecuencia.js');
revisar('lee el repo vivo y, si falta, la copia del sitio', js.includes("V.url('frecuencia/troncal.json')") && js.includes(copiaRuta.replace('site/', '')));
revisar('sigue la barra del sol', js.includes('bogotwin:sol') && js.includes('B.solBarra'));
revisar('todo lo contado va marcado inferido', js.split('\n').filter((l) => l.includes('B.valor(')).every((l) => l.includes("'inferido'")) && js.includes("tipo: 'inferido'"));
revisar('dice «programado» en la leyenda y en el toque', (js.match(/Programado/g) || []).length >= 2);

// 6. Fuentes: fila con licencia SA y sin mezclar con NC.
const fuentes = leer('site/fuentes.html');
const fila = (fuentes.match(/<tr><td>Buses troncales por hora[\s\S]*?<\/tr>/) || [''])[0];
revisar('fila en fuentes.html con CC BY-SA 4.0 y marca inferido', fila.includes('by-sa/4.0') && fila.includes('data-marca="inferido"'));
revisar('la fila dice que es lo programado y que no se mezcla con NC', /programad/.test(fila) && /CC BY‑NC/.test(fila));

// 7. Pruebas de Python del pipeline sobre un GTFS de juguete, sin red.
const r = spawnSync('python3', ['-I', path.join(__dirname, 'frecuencia_gtfs.py')], { encoding: 'utf8' });
process.stdout.write(r.stdout || '');
revisar('pipeline de frecuencia: pruebas de Python', r.status === 0, (r.stderr || '').slice(-300));

cierre('Buses troncales programados');
