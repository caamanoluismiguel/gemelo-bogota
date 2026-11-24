'use strict';
// Paso 8: el lector de teselas (site/mvt.js) contra una tesela real de Kennedy, y la
// geometría de sombra que sale de ella. Necesita mapa-base/salida/catastro-pisos-bogota.pmtiles;
// si no está (por ejemplo en CI), la prueba lo dice y no falla.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const mvt = require('../site/mvt.js');
const G = require('../site/sombra-geom.js');
const { abrir } = require('./pmtiles-leer');

const ARCHIVO = path.join(__dirname, '..', 'mapa-base', 'salida', 'catastro-pisos-bogota.pmtiles');
if (!fs.existsSync(ARCHIVO)) {
  console.log('SALTA  no está ' + ARCHIVO);
} else {
  const pm = abrir(ARCHIVO);
  const bytes = pm.tesela(16, 19268, 31924); // centro de Kennedy
  revisar('la tesela 16/19268/31924 existe', !!bytes && bytes.length > 1000, bytes ? bytes.length + ' bytes' : '');
  const capa = mvt.leerCapa(bytes, 'construcciones');
  revisar('trae la capa construcciones', !!capa && capa.objetos.length > 1000, capa ? capa.objetos.length + ' construcciones' : '');
  revisar('extensión 4096', capa.extension === 4096, String(capa.extension));
  revisar('ninguna capa inventada', mvt.leerCapa(bytes, 'no-existe') === null);
  const conPisos = capa.objetos.filter((o) => Number.isInteger(o.propiedades.pisos)).length;
  revisar('todas traen pisos enteros', conPisos === capa.objetos.length, conPisos + ' de ' + capa.objetos.length);
  let min = Infinity, max = -Infinity;
  for (const o of capa.objetos) for (const r of o.anillos) for (const [x, y] of r) { min = Math.min(min, x, y); max = Math.max(max, x, y); }
  revisar('coordenadas dentro del buffer de 80 (−80 a 4176)', min >= -80 && max <= 4176 && min < 0 && max > 4096, `${min} a ${max}`);
  const exteriores = capa.objetos.filter((o) => mvt.areaFirmada(o.anillos[0]) > 0).length;
  revisar('el primer anillo es exterior (área positiva)', exteriores === capa.objetos.length, exteriores + ' de ' + capa.objetos.length);

  const geom = G.armar(capa.objetos.map((o) => ({ anillos: o.anillos, pisos: o.propiedades.pisos })), { extension: 4096, borde: 80 });
  const v = geom.vertices;
  let enCorte = 0;
  for (let i = 0; i < v.length; i += 20) {
    const ax = v[i], ay = v[i + 1], bx = v[i + 5], by = v[i + 6];
    if ((ax === bx && (ax === -80 || ax === 4176)) || (ay === by && (ay === -80 || ay === 4176))) enCorte++;
  }
  revisar('la geometría no trae paredes falsas en el corte de la tesela', enCorte === 0, String(enCorte));
  revisar('índices de 32 bits si pasan de 65 535 vértices', (v.length / 5 > 65535) === (geom.indices instanceof Uint32Array), (v.length / 5) + ' vértices');
  pm.cerrar();
}
cierre('Lector de teselas (paso 8)');
