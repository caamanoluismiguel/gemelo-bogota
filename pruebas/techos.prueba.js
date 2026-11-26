'use strict';
// Ronda 12: color de techo medido en la Ortoimagen urbana 2025 (CC BY 4.0) para las
// construcciones de hasta 4 pisos, de z12 a z15. La paleta está en dos lugares (el script que
// la mide y el visor que la pinta) y tiene que ser la misma; el crédito dice que la foto está
// modificada; la leyenda separa lo medido de lo supuesto; y el color va solo en archivos de
// Catastro (CC BY), nunca con OSM (ODbL). Con las teselas en mapa-base/salida, también las lee.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { revisar, cierre } = require('./util');
const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, '');

// La paleta: igual en techos.py y en comun.js.
const vm = require('vm');
const ventana = {};
vm.runInNewContext(leer('site', 'comun.js'), { window: ventana, setInterval: () => 0, document: { querySelectorAll: () => [] }, Intl, Date, Math, Number, String, Object });
const B = ventana.Bogotwin || {};
const py = leer('mapa-base', 'scripts', 'techos.py');
const enPy = ((py.match(/^PALETA = \[([\s\S]*?)^\]/m) || [])[1] || '').match(/#[0-9a-f]{6}/gi) || [];
revisar('la paleta de techos.py tiene 11 colores', enPy.length === 11, enPy.length + ' colores');
revisar('comun.js expone TECHO_COLOR y exprTecho', Array.isArray(B.TECHO_COLOR) && typeof B.exprTecho === 'function');
revisar('la paleta es la misma en techos.py y en comun.js', JSON.stringify(enPy.map((c) => c.toLowerCase())) === JSON.stringify((B.TECHO_COLOR || []).map((c) => c.toLowerCase())));
revisar('los colores de techo no entran a PALETA_FACHADA (edificios-luz la usa para el tipo de fachada)',
  Array.isArray(B.PALETA_FACHADA) && B.PALETA_FACHADA.length <= 24 && (B.TECHO_COLOR || []).every((c) => !B.PALETA_FACHADA.includes(c)));

// La expresión: con «techo», el color medido (índice acotado); sin él, la de siempre.
if (typeof B.exprTecho === 'function') {
  const e = B.exprTecho('#123456', (c) => c.toUpperCase());
  revisar('exprTecho: case con has techo y, si no, la expresión de antes', e[0] === 'case' && JSON.stringify(e[1]) === '["has","techo"]' && e[3] === '#123456');
  revisar('exprTecho: el índice queda entre 0 y 10', JSON.stringify(e[2]).includes('["min",10,["max",0,["round",["to-number",["get","techo"],0]]]]'));
  revisar('exprTecho: la mezcla de noche pasa a cada color', JSON.stringify(e[2]).includes(JSON.stringify(B.TECHO_COLOR.map((c) => c.toUpperCase()))));
}
const mapa = leer('site', 'mapa.js');
revisar('«Cómo se ve» envuelve la fachada con el techo y la misma mezcla de noche',
  /const deNoche = \(c\) => B\.mezclarColor\(c, NOCHE_MATERIAL, 0\.62 \* noche\);[\s\S]{0,1200}?14, B\.exprTecho\(B\.exprFachada\(apagado, deNoche\), deNoche\)\];/.test(mapa));
revisar('la lente de pisos no usa el techo', /const pasos = \(campo\) => \['step'/.test(mapa) && !/pasos[^\n]*techo/.test(sinComentarios(mapa)));

// Crédito en el mapa y en fuentes.html, sin decir que el Distrito lo respalda.
const CRED = 'Ortoimagen 2025 SDP/IDECA, CC BY 4.0. Modificada: color mediano de techo derivado';
revisar('atribución de Catastro en el mapa con el crédito del color de techo', mapa.includes(`const CAT = 'Pisos: UAECD (Catastro Bogotá), Datos Abiertos Bogotá (CC BY 4.0). Color de techo: ${CRED}';`));
const fuentes = leer('site', 'fuentes.html');
revisar('fuentes.html: fila del color de techo con el crédito y la licencia', new RegExp(`color de techo[^<]*<span class="marca" data-marca="inferido">inferido</span></td><td>${CRED.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\.`).test(fuentes));
revisar('fuentes.html: dice que ni la SDP ni IDECA revisaron el cálculo', /Ni la SDP ni IDECA hicieron ni revisaron este cálculo/.test(fuentes));
revisar('ningún texto dice que el Distrito avala, respalda o certifica', ![fuentes, mapa, leer('site', 'index.html')].some((t) => /(avalad|respaldad|certificad)[oa]s? por (la SDP|IDECA|el Distrito)/i.test(t)));

// Leyenda: medido en foto 2025 frente a supuesto, solo con «Cómo se ve» y de lejos.
const index = leer('site', 'index.html');
const ley = (index.match(/<div class="ley-bloque" data-capa="techos" hidden>[\s\S]*?\n {2}<\/div>/) || [''])[0];
revisar('leyenda: bloque de techos', ley.length > 0);
revisar('leyenda: «medido en la foto 2025» y «supuesto» con su marca', /Medido en la foto 2025/.test(ley) && /Sin medir <span class="marca" data-marca="supuesto">supuesto<\/span>/.test(ley));
revisar('leyenda: se ve en 3D con «Cómo se ve» de z12 a z15, no de noche, y se revisa al cambiar el zoom',
  /k === 'techos'\) \{ const z = mapa\.getZoom\(\); si = caja3d\.checked && lenteActual\(\) === 'como-se-ve' && z >= 12 && z < 16 && !\(noche > 0\.5\); \}/.test(mapa) && /mapa\.on\('zoomend', ponerLeyenda\);/.test(mapa));
revisar('leyenda: sin degradados', !/gradient/i.test(leer('site', 'estilo.css').split('.techo-ley')[1] || ''));

// Tubería: el color va en los archivos de Catastro y nunca en el de OSM.
const sh = leer('mapa-base', 'scripts', 'catastro.sh');
const sql = leer('mapa-base', 'scripts', 'catastro.sql');
revisar('catastro.sh lleva techo a z12-13 y z14-15 como entero', (sh.match(/-y pisos -y techo -T pisos:int -T techo:int/g) || []).length === 2);
revisar('catastro.sh: sin techos.csv arma igual', /\[ -f "\$K\/techos\.csv" \] \|\| echo "fid,techo,techo_q" > "\$K\/techos\.csv"/.test(sh));
revisar('catastro.sql: un color por grupo, el de más área, si cubre la mitad', /arg_max\(techo, area\)/.test(sql) && /kt\.a_medida >= 0\.5 \* g\.a/.test(sql));
revisar('techos.sql: solo hasta 4 pisos y huella encogida 1 m', /WHERE CONNPISOS <= 4/.test(leer('mapa-base', 'scripts', 'techos.sql')) && /ST_Buffer\([^)]*\), -1\.0\)/.test(leer('mapa-base', 'scripts', 'techos.sql')));
revisar('el script de OSM no toca el techo', !/techo/i.test(leer('mapa-base', 'scripts', 'osm.sh')));

// Las teselas, si están: z13 y z15 traen techo dentro de la paleta; z16 no lo trae.
const SAL = path.join(raiz, 'mapa-base', 'salida');
const LEJOS = path.join(SAL, 'catastro-lejos-bogota.pmtiles'), PISOS = path.join(SAL, 'catastro-pisos-bogota.pmtiles');
if (!fs.existsSync(LEJOS) || !fs.existsSync(PISOS)) {
  console.log('SALTA  no están las teselas de Catastro en mapa-base/salida');
} else {
  const mvt = require('../site/mvt.js');
  const { abrir } = require('./pmtiles-leer');
  const objetos = (a, z, x, y) => { let t = abrir(a).tesela(z, x, y); if (t && t[0] === 0x1f) t = zlib.gunzipSync(t); const c = t && mvt.leerCapa(t, 'construcciones'); return c ? c.objetos : []; };
  // Kennedy: 16/19268/31924 y sus madres.
  for (const [a, z, x, y] of [[LEJOS, 13, 2408, 3990], [PISOS, 15, 9634, 15962]]) {
    const os = objetos(a, z, x, y);
    const con = os.filter((o) => o.propiedades.techo !== undefined);
    revisar(`z${z}: la mayoría de las construcciones de Kennedy traen techo`, os.length > 100 && con.length > os.length / 2, `${con.length} de ${os.length}`);
    revisar(`z${z}: techo es entero dentro de la paleta`, con.every((o) => Number.isInteger(o.propiedades.techo) && o.propiedades.techo >= 0 && o.propiedades.techo <= 10));
  }
  const z16 = objetos(PISOS, 16, 19268, 31924);
  revisar('z16: cada construcción sin techo (ahí se ve la foto)', z16.length > 1000 && z16.every((o) => o.propiedades.techo === undefined));
}
cierre('Color de techo medido en la foto 2025');
