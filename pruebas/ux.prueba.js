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
revisar('valorFicha(null) y valorFicha("") = «sin dato»', B.valorFicha(null) === 'sin dato' && B.valorFicha('') === 'sin dato' && B.valorFicha(undefined) === 'sin dato');
revisar('ventana() de mapa.js escribe cada fila con valorFicha', /function ventana[\s\S]{0,300}B\.valorFicha\(v\)/.test(mapa));
const llamadas = [...mapa.matchAll(/\n\s*ventana\(ll,[\s\S]*?\);\n/g)].map((m) => m[0]);
const sinLicencia = llamadas.filter((c) => !/licencia:\s*\{\s*nombre:/.test(c)).map((c) => (c.match(/\[\['([^']+)'/) || [])[1]);
revisar('cada ficha del mapa trae marca, fuente y licencia', llamadas.length >= 6 && sinLicencia.length === 0,
  `${llamadas.length} fichas` + (sinLicencia.length ? '; sin licencia: ' + sinLicencia.join(', ') : ''));

cierre('ux');
