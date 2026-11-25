'use strict';
// Pasos de UX del plan de jerarquía. Solo lee archivos y corre comun.js en una caja; no carga el
// sitio. Lo que se mide en el navegador (capturas a 390 px y en escritorio) va aparte.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
function cargarComun(extra) {
  const ventana = Object.assign({}, extra);
  const caja = Object.assign({ window: ventana, setInterval: () => 0, document: { querySelectorAll: () => [] }, Intl, Date, Math, Number, String, Object }, extra);
  vm.runInNewContext(leer('site/comun.js'), caja);
  return ventana.Bogotwin;
}
const B = cargarComun();
const mapa = leer('site/mapa.js');

// Paso 1. Las fichas con coma decimal y con su sello completo.
revisar('valorFicha(3.4) = «3,4»', B.valorFicha(3.4) === '3,4', B.valorFicha(3.4));
revisar('valorFicha("3.4") = «3,4» (número que llega como texto)', B.valorFicha('3.4') === '3,4', B.valorFicha('3.4'));
revisar('valorFicha(12) = «12» (un entero o un código no cambia)', B.valorFicha(12) === '12' && B.valorFicha('045A01') === '045A01');
revisar('valorFicha(1624) = «1624» y «1.624» no se vuelve 1,6', B.valorFicha(1624) === '1624' && B.valorFicha('1.624') === '1.624', B.valorFicha('1.624'));
revisar('valorFicha(null) y valorFicha("") = «sin dato»', B.valorFicha(null) === 'sin dato' && B.valorFicha('') === 'sin dato' && B.valorFicha(undefined) === 'sin dato');
revisar('ventana() de mapa.js escribe cada fila con valorFicha', /function ventana[\s\S]{0,300}B\.valorFicha\(v\)/.test(mapa));
const llamadas = [...mapa.matchAll(/\n\s*ventana\(ll,[\s\S]*?\);\n/g)].map((m) => m[0]);
const sinLicencia = llamadas.filter((c) => !/licencia:\s*\{\s*nombre:/.test(c)).map((c) => (c.match(/\[\['([^']+)'/) || [])[1]);
revisar('cada ficha del mapa trae marca, fuente y licencia', llamadas.length >= 6 && sinLicencia.length === 0,
  `${llamadas.length} fichas` + (sinLicencia.length ? '; sin licencia: ' + sinLicencia.join(', ') : ''));

// Paso 2. Movimiento reducido. MapLibre 5.24 ya salta sin animar easeTo, flyTo y fitBounds cuando
// el sistema pide menos movimiento, salvo si la llamada dice essential: true. Medido en el
// navegador: con «reduce» el 3D llega a zoom 17 en 150 ms sin moverse; sin él va en 13,5 y
// sigue moviéndose. Esta prueba cuida que nadie le ponga essential: true a un movimiento.
const js = fs.readdirSync(path.join(raiz, 'site')).filter((f) => f.endsWith('.js'));
const esenciales = js.filter((f) => /essential\s*:\s*true/.test(leer('site/' + f)));
revisar('ningún movimiento de cámara se salta el movimiento reducido (essential: true)', esenciales.length === 0, esenciales.join(', '));
const camara = js.filter((f) => /\.(easeTo|flyTo|fitBounds)\(/.test(leer('site/' + f)));
revisar('los movimientos de cámara son de MapLibre (easeTo, flyTo, fitBounds)', camara.length >= 2, camara.join(', '));
const animaciones = js.filter((f) => /requestAnimationFrame/.test(leer('site/' + f)) && !/sombras-capa|prueba-sombras/.test(f));
const css = leer('site/estilo.css');
revisar('sin animaciones propias fuera del mapa (CSS ni requestAnimationFrame)', !/@keyframes|animation\s*:|transition\s*:/.test(css) && animaciones.length === 0,
  animaciones.join(', '));

// Paso 3. De noche, el primer cuadro ya es de noche (antes de que llegue la barra del sol).
const SOL = require('../site/sol.js');
const Bsol = cargarComun();
Bsol.sol = SOL;
const bogota = (h, m) => SOL.desdeBogota(2026, 11, 24, h, m);
const n19 = Bsol.cieloArranque(bogota(19, 0));
revisar('19:00 en Bogotá: noche plena y cielo de noche', !!n19 && n19.noche === 1 && n19.cielo['sky-color'] === '#0a1628', n19 && `${n19.noche} ${n19.cielo['sky-color']}`);
const n12 = Bsol.cieloArranque(bogota(12, 0));
revisar('12:00 en Bogotá: sin cambio (cielo de día)', n12 === null);
const n18 = Bsol.cieloArranque(bogota(17, 55));
revisar('17:55 en Bogotá: crepúsculo, noche entre 0 y 1', !!n18 && n18.noche > 0 && n18.noche < 1, n18 && String(Math.round(n18.noche * 100) / 100));
revisar('sin sol.js no inventa la hora: devuelve null', B.cieloArranque(bogota(19, 0)) === null);
const barra = leer('site/sol-barra.js');
const cuerpo = (barra.match(/function cieloPorAltura[\s\S]*?\n  \}/) || [''])[0];
const hexComun = [...new Set(leer('site/comun.js').match(/(CIELO_NOCHE|CIELO_OCASO) = \{[^}]*\}/g).join(' ').match(/#[0-9a-f]{6}/gi))];
revisar('los colores de noche son los de cieloPorAltura en sol-barra.js', hexComun.length >= 6 && hexComun.every((h) => cuerpo.includes(h)), hexComun.join(' '));
const indice = leer('site/index.html');
revisar('index.html carga sol.js antes de mapa.js', indice.indexOf('src="sol.js"') > 0 && indice.indexOf('src="sol.js"') < indice.indexOf('src="mapa.js"'));
revisar('apagar las sombras antes de que llegue la barra quita la noche del arranque', /if \(B\.solBarra\) B\.solBarra\.apagar\(\); else if \(noche\) \{ fijarNoche\(false\)/.test(mapa));
revisar('poner3d usa cieloArranque al arrancar', /function poner3d[\s\S]{0,2500}B\.cieloArranque\(Date\.now\(\)\)/.test(mapa));

cierre('ux');
