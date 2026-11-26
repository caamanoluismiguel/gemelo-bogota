'use strict';
// Edificios con forma de OpenStreetMap: cajas-ocultas.js, partes-osm.js, la base en la luz
// propia (edificios-luz.js) y las piezas que hacen sombra (sombras-capa.js). Con el archivo
// mapa-base/salida/osm-3d-bogota.pmtiles (scripts/osm3d.sh) revisa también los hitos.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');
const { abrir } = require('./pmtiles-leer');
const SITE = path.join(__dirname, '..', 'site');
const leer = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');

// cajas-ocultas.js: un módulo nuevo en cada prueba, sin estado compartido.
const nuevoC = () => { const m = { exports: {} }; vm.runInNewContext(leer('cajas-ocultas.js'), { module: m, globalThis: {} }); return m.exports; };
{
  const C = nuevoC();
  revisar('sin nada escondido el filtro es null', C.filtro() === null);
  C.agregar('osm', [5, 3, 3, 'x']);
  const f = C.filtro();
  revisar('un arreglo cuenta como cerca, sin repetidos y en orden', JSON.stringify(f[2]) === JSON.stringify(['match', ['to-number', ['id'], -1], [3, 5], false, true]), JSON.stringify(f));
  revisar('lejos vacío: todo se ve de lejos', f[3] === true);
  revisar('cerca y lejos se separan por «tono»', f[0] === 'case' && JSON.stringify(f[1]) === '["has","tono"]');
  C.agregar('hitos', { cerca: [5, 9], lejos: [7] });
  const g = C.filtro();
  revisar('dos orígenes se juntan', JSON.stringify(g[2][2]) === '[3,5,9]' && JSON.stringify(g[3][2]) === '[7]');
  revisar('cuántas', C.cuantas().cerca === 3 && C.cuantas().lejos === 1 && C.cuantas().origenes.length === 2);
  C.agregar('osm', { cerca: [1] });
  revisar('agregar otra vez reemplaza lo del mismo origen', JSON.stringify(C.filtro()[2][2]) === '[1,5,9]');
  C.quitar('osm'); C.quitar('hitos');
  revisar('al quitar todo vuelve a null', C.filtro() === null);
  // aplicar: pone el filtro solo si la capa existe, y recuerda el mapa para después.
  const puestos = [];
  let hay = false;
  const mapa = { getLayer: (id) => hay && id === 'construcciones-3d', setFilter: (id, x) => puestos.push([id, x]) };
  C.aplicar(mapa);
  revisar('sin la capa no hace nada', puestos.length === 0);
  hay = true;
  C.agregar('osm', [42]);
  revisar('con la capa, agregar ya pone el filtro', puestos.length === 1 && puestos[0][0] === 'construcciones-3d' && JSON.stringify(puestos[0][1][2][2]) === '[42]');
  C.quitar('osm');
  revisar('quitar pone null en la capa', puestos.length === 2 && puestos[1][1] === null);
}

// partes-osm.js: la ventana y los metadatos.
const P = require(path.join(SITE, 'partes-osm.js'));
{
  const f = P.filas({ nombre: 'Torre Bancolombia', alto_total: 202, fuente_alto: 'height', base_osm: 0, techo: 'pyramidal', pieza: 'techo', techo_supuesto: 0, decision: 'osm-coherente' });
  const m = Object.fromEntries(f.map(([k, v, t]) => [k, [v, t]]));
  revisar('nombre de OSM', m.Edificio[0] === 'Torre Bancolombia');
  revisar('alto de OSM con su marca «de fuente»', m['Alto en OSM'] && m['Alto en OSM'][0] === '202 m' && m['Alto en OSM'][1] === 'de_fuente');
  revisar('techo aproximado: supuesto', m.Techo && m.Techo[0] === 'en pirámide' && m.Techo[1] === 'supuesto');
  revisar('sin base no hay fila de base', !m['Empieza a']);
  revisar('dice por qué ese alto', /cuadra con sus pisos/.test(m['Por qué este alto'][0]));
  const g = Object.fromEntries(P.filas({ alto_total: 8.4, fuente_alto: 'niveles+techo', base_osm: 12, fuente_base: 'min_height', techo: 'gabled', aviso: 'hueco de 5.0 m' }).map(([k, v, t]) => [k, [v, t]]));
  revisar('sin nombre lo dice', g.Edificio[0] === 'sin nombre en OSM');
  revisar('alto por pisos: supuesto y dice cómo', g['Alto dibujado'][1] === 'supuesto' && /× 3 m más el techo/.test(g['Alto dibujado'][0]));
  revisar('base de OSM: de fuente', g['Empieza a'][1] === 'de_fuente' && /^12 m/.test(g['Empieza a'][0]));
  revisar('el aviso se ve', g.Ojo[0] === 'hueco de 5.0 m');
  revisar('sin propiedades no se cae', P.filas(undefined).length === 1);
  revisar('ocultas desde texto JSON', JSON.stringify(P.leerOcultas({ ocultas: '{"cerca":[1,"2"],"lejos":[3]}' })) === '{"cerca":[1,2],"lejos":[3]}');
  revisar('ocultas rotas: no se esconde nada', JSON.stringify(P.leerOcultas({ ocultas: '{mal' })) === '{"cerca":[],"lejos":[]}' && P.leerOcultas(null).cerca.length === 0);
  revisar('sin archivo leído, nada para las sombras', P.paraSombras() === null);
  revisar('licencia ODbL', P.ODBL.nombre === 'ODbL 1.0');
}

// edificios-luz.js: la base de la extrusión llega al sombreador y la segunda luz no tiñe.
{
  const L = leer('edificios-luz.js');
  revisar('el sombreador lee a_base', /in float a_base;/.test(L) && /a_base: 5/.test(L));
  revisar('sin búfer de base, base 0', /vertexAttrib1f\(LUGAR\.a_base, 0\)/.test(L));
  revisar('opción tinte, encendida por defecto', /tinte: true \}/.test(L) && /if \(op\.tinte && !m\.getLayer\(IDT\)\)/.test(L));
  const M = leer('mapa.js');
  revisar('la luz de las partes va sin tinte', /capaML: B\.partesOsm\.CAPA[^}]*tinte: false/.test(M));
  revisar('las partes siguen la lente y el 3D', /CONSTRUCCIONES_3D = \[[^\]]*'partes-osm-3d'/.test(M));
  const H = leer('index.html');
  revisar('index carga cajas-ocultas y partes-osm antes de mapa.js', H.indexOf('src="cajas-ocultas.js"') > 0 && H.indexOf('src="partes-osm.js"') > H.indexOf('src="cajas-ocultas.js"') && H.indexOf('src="mapa.js"') > H.indexOf('src="partes-osm.js"'));
}

// sombras-capa.js: piezasExtra pasa las piezas a la escala de Catastro con pisos = alto / 3.
function cargarSombras(mvt) {
  const win = { Bogotwin: { mvt, sombraGeom: { EXTENSION: 4096 } } };
  vm.runInNewContext(leer('sombras-capa.js'), { window: win, console, Math, Map, Set, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Promise, setTimeout, clearTimeout });
  return win.Bogotwin.sombrasCapa;
}
{
  const falso = { leerCapa: () => ({ extension: 16384, objetos: [
    { anillos: [[[0, 0], [16384, 0], [16384, 8192], [0, 0]]], propiedades: { alto: 90 } },
    { anillos: [[[0, 0], [4, 0], [4, 4], [0, 0]]], propiedades: { alto: 0 } }] }) };
  const S = cargarSombras(falso);
  const p = S.piezasExtra(new Uint8Array([1]), 'partes', 4096);
  revisar('sombras: sin alto no hay pieza', p.length === 1);
  revisar('sombras: 16384 → 4096', p[0].anillos[0][1][0] === 4096 && p[0].anillos[0][2][1] === 2048);
  revisar('sombras: pisos = alto / 3', p[0].pisos === 30);
  revisar('sombras: tesela vacía, nada', S.piezasExtra(null, 'partes').length === 0 && S.piezasExtra(new Uint8Array(0), 'partes').length === 0);
}

// El archivo armado: tamaño, licencia, ocultas y los hitos.
const ARCHIVO = path.join(__dirname, '..', 'mapa-base', 'salida', 'osm-3d-bogota.pmtiles');
if (!fs.existsSync(ARCHIVO)) {
  console.log('SALTA  no está ' + ARCHIVO);
} else {
  const mvt = require(path.join(SITE, 'mvt.js'));
  const pm = abrir(ARCHIVO);
  const bytes = fs.statSync(ARCHIVO).size;
  revisar('el archivo pesa menos de 1 MB', bytes < 1e6, bytes + ' bytes');
  revisar('licencia ODbL en los metadatos', pm.metadatos.license === 'ODbL 1.0' && /OpenStreetMap/.test(pm.metadatos.attribution || ''));
  const oc = P.leerOcultas(pm.metadatos);
  revisar('esconde miles de cajas cerca y cientos lejos', oc.cerca.length > 2000 && oc.lejos.length > 100, oc.cerca.length + ' / ' + oc.lejos.length);
  const tile = (lon, lat, z) => { const n = 2 ** z, r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
  const piezas = (lon, lat) => { const [x, y] = tile(lon, lat, 16); const b = pm.tesela(16, x, y); const c = b && mvt.leerCapa(b, 'partes'); return c ? c.objetos.map((o) => o.propiedades) : []; };
  const bac = piezas(-74.0703, 4.6050);
  const maxAlto = (ps, re) => Math.max(0, ...ps.filter((p) => re.test(p.nombre || '')).map((p) => p.alto));
  revisar('BD Bacatá: torre sur llega a 216 m', bac.some((p) => p.alto >= 215 && p.alto <= 217), String(Math.max(0, ...bac.map((p) => p.alto))));
  revisar('BD Bacatá: la torre sur sin hueco en 54 a 59 m', bac.some((p) => p.base <= 13 && p.alto >= 58.9 && p.alto <= 59.1));
  const ban = piezas(-74.0719, 4.6163);
  revisar('Torre Bancolombia 202 m con punta en pirámide', ban.some((p) => p.alto_total === 202 && p.techo === 'pyramidal' && p.pieza === 'techo'), String(maxAlto(ban, /Bancolombia/)));
  const pla = piezas(-74.0688, 4.6127);
  revisar('Planetario: cúpula sobre su base', pla.some((p) => p.techo === 'dome' && p.base >= 9));
  revisar('sin valores de Catastro en la tesela (ODbL aparte de CC BY)', [...bac, ...ban, ...pla].every((p) => !('catastro_m' in p) && !/^Catastro/.test(p.aviso || '')));
  pm.cerrar();
}

cierre('Edificios con forma de OSM');
