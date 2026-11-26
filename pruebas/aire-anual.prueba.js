'use strict';
// Capa «PM2,5 de todo 2025»: los archivos servidos, sus licencias, las cuentas de
// aire-anual-datos.js y que mapa.js la baje solo al prenderla. Sin navegador.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const json = (r) => JSON.parse(leer(r));
const caja = { window: {} };
vm.createContext(caja);
vm.runInContext(leer('site/aire-anual-datos.js'), caja);
const D = caja.window.Bogotwin.aireAnualDatos;
revisar('aire-anual-datos.js deja Bogotwin.aireAnualDatos', !!D && typeof D.franjaEn === 'function');

// 1. Clases y cortes: la guía de la OMS, la meta de 2030 y la norma de hoy.
revisar('cortes 5, 10, 15, 20, 25', JSON.stringify(D.CORTES) === '[5,10,15,20,25]');
revisar('OMS 5, meta 2030 15, norma 25', D.OMS === 5 && D.META_2030 === 15 && D.NORMA === 25);
revisar('seis colores sólidos #rrggbb', D.COLORES.length === 6 && D.COLORES.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
const luz = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
revisar('la paleta va de claro a oscuro (se lee en grises)', D.COLORES.every((c, i) => i === 0 || luz(c) < luz(D.COLORES[i - 1])));
revisar('5 cumple la guía; 5,01 ya no', D.clase(5) === 0 && D.clase(5.01) === 1);
revisar('25 queda bajo el valor de la norma; 25,1 sobre él', D.clase(25) === 4 && D.clase(25.1) === 5);
revisar('11,04 cae en 10 a 15 y 29,82 en más de 25', D.clase(11.04) === 2 && D.clase(29.82) === 5);
revisar('una etiqueta por color', D.ETIQUETAS.length === D.COLORES.length);

// 2. Frases de comparación, con coma decimal.
const c30 = D.comparar(29.82);
revisar('29,82: 6,0 veces la OMS y su valor supera el de la norma', /6,0 veces/.test(c30.oms) && /Su valor supera los 25 µg\/m³ de la norma anual colombiana; la norma se revisa en cada estación, no por zona\./.test(c30.norma), c30.oms + ' ' + c30.norma);
const c18 = D.comparar(18.84);
revisar('18,84: bajo el valor de la norma y sobre la meta de 2030', /queda bajo los 25/.test(c18.norma) && /sobre los 15 de la meta de 2030/.test(c18.norma));
const c11 = D.comparar(11.04);
revisar('11,04: bajo los dos valores', /y bajo los 15 de la meta de 2030/.test(c11.norma) && /2,2 veces/.test(c11.oms));
revisar('4: dentro de la guía', /dentro de la guía/.test(D.comparar(4).oms));
revisar('sin punto decimal en las frases', ![c30, c18, c11].some((c) => /\d\.\d/.test(c.oms + c.norma)));

// 3. Punto en polígono con huecos.
const cuadro = (x0, y0, x1, y1, ccw = true) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]; return ccw ? r : r.reverse(); };
const dona = { type: 'Feature', properties: { pm25: 12 }, geometry: { type: 'MultiPolygon', coordinates: [[cuadro(0, 0, 10, 10), cuadro(4, 4, 6, 6, false)]] } };
const centro = { type: 'Feature', properties: { pm25: 20 }, geometry: { type: 'Polygon', coordinates: [cuadro(4, 4, 6, 6)] } };
const fc = { type: 'FeatureCollection', features: [dona, centro] };
revisar('en la dona da 12', (D.franjaEn(fc, 2, 2) || {}).properties.pm25 === 12);
revisar('en el hueco da la franja de adentro', (D.franjaEn(fc, 5, 5) || {}).properties.pm25 === 20);
revisar('fuera de todo da null', D.franjaEn(fc, 20, 20) === null);

// 4. Nombres en mayúsculas a nombre propio, sin romper siglas.
revisar('«COLEGIO AQUILEO PARRA (IED)»', D.nombre('COLEGIO AQUILEO PARRA (IED)') === 'Colegio Aquileo Parra (IED)', D.nombre('COLEGIO AQUILEO PARRA (IED)'));
revisar('«DE» y «LA» en minúscula, salvo tras guion', D.nombre('SEDE B - LA ESPERANZA DE SUBA') === 'Sede B - La Esperanza de Suba', D.nombre('SEDE B - LA ESPERANZA DE SUBA'));

// 5. Los archivos servidos.
const DIR = 'site/datos/aire/';
const pm = json(DIR + 'pm25-anual-2025.geojson');
const col = json(DIR + 'colegios-sed.geojson');
const sal = json(DIR + 'salud-red-publica.geojson');
const proc = json(DIR + 'procedencia.json');
revisar('PM2,5: 8 franjas de 2025 con licencia CC BY 4.0', pm.features.length === 8 && pm.licencia === 'CC BY 4.0' && /2025/.test(pm.fuente));
const vals = pm.features.map((f) => f.properties.pm25);
revisar('PM2,5: valores entre 11 y 30 µg/m³', Math.min(...vals) > 11 && Math.max(...vals) < 30, vals.join(' '));
// Toda franja trae su exterior contra el reloj y sus huecos a favor (así se dibujan bien).
const giro = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
const malGiro = pm.features.flatMap((f) => f.geometry.coordinates.flatMap((p) => p.map((r, k) => (k === 0) === (giro(r) > 0) ? null : f.properties.pm25))).filter((x) => x != null);
revisar('PM2,5: exteriores contra el reloj y huecos a favor', malGiro.length === 0, malGiro.join(' '));
const areas = D.areasPorClase(pm);
const total = areas.reduce((a, b) => a + b, 0);
revisar('PM2,5: área total cerca de 516 km² (la que declara la SDA)', total > 505 && total < 525, total.toFixed(1));
revisar('PM2,5: ninguna zona por debajo de 10', areas[0] < 0.5 && areas[1] < 0.5);
// Las franjas no se pisan: en una rejilla, cada punto cae en una franja o en ninguna.
let dobles = 0, dentro = 0;
for (let lon = -74.22; lon <= -74.0; lon += 0.004) for (let lat = 4.49; lat <= 4.84; lat += 0.004) {
  const n = pm.features.filter((f) => f.geometry.coordinates.some((p) => D.enPoligono(lon, lat, p))).length;
  if (n > 1) dobles++; if (n) dentro++;
}
revisar('PM2,5: las franjas no se pisan', dobles === 0 && dentro > 1000, `dobles ${dobles}, dentro ${dentro}`);
// La franja de 29,8 queda en el suroccidente (cerca de Carvajal y Kennedy).
const alta = pm.features.find((f) => f.properties.pm25 > 29);
const [ax, ay] = alta.geometry.coordinates[0][0][0];
revisar('PM2,5: la franja más alta está en el suroccidente', ax > -74.18 && ax < -74.1 && ay > 4.57 && ay < 4.66, `${ax},${ay}`);

revisar('colegios: CC BY‑SA 4.0, en su propio archivo', col.licencia === 'CC BY-SA 4.0' && !('pm25' in (col.features[0].properties)));
revisar('salud: CC BY 4.0', sal.licencia === 'CC BY 4.0');
const enBogota = (f) => { const [x, y] = f.geometry.coordinates; return x > -74.5 && x < -73.9 && y > 3.7 && y < 4.9; };
revisar('colegios y sedes con coordenadas lon, lat en la Sabana', col.features.every(enBogota) && sal.features.every(enBogota));
revisar('cada colegio tiene nombre y o = 0 o 1', col.features.every((f) => f.properties.n && (f.properties.o === 0 || f.properties.o === 1)));
revisar('cada sede tiene nombre y subred', sal.features.every((f) => f.properties.n && /^(Norte|Sur|Sur Occidente|Centro Oriente)$/.test(f.properties.r)));
const js = leer('site/aire-anual.js');
const cuantos = js.match(/CUANTOS = \{ colegios: (\d+), salud: (\d+) \}/);
revisar('la leyenda dice cuántos puntos trae cada archivo', cuantos && +cuantos[1] === col.features.length && +cuantos[2] === sal.features.length,
  `${cuantos && cuantos.slice(1)} vs ${col.features.length}, ${sal.features.length}`);

// 6. Procedencia: URL, licencia leída de la ficha y sha256 de cada producto.
for (const [k, f] of Object.entries(proc.fuentes)) {
  revisar(`procedencia ${k}: URL del portal o del servicio del Distrito`, /^https:\/\/(datosabiertos\.bogota\.gov\.co|serviciosgis\.catastrobogota\.gov\.co)\//.test(f.url));
  revisar(`procedencia ${k}: la ficha dice la misma licencia`, f.ficha_dice && f.ficha_dice.license_url === f.licencia.url && f.ficha_dice.isopen === true);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, DIR, f.producto))).digest('hex');
  revisar(`procedencia ${k}: sha256 del producto al día`, sha === f.sha256_producto);
}
revisar('licencias aceptadas: CC BY o CC BY‑SA', Object.values(proc.fuentes).every((f) => /^CC BY(-SA)? 4\.0$/.test(f.licencia.nombre)));

// 7. El visor no llama al Distrito y la capa no se baja al arrancar.
for (const f of ['site/aire-anual.js', 'site/aire-anual-datos.js', 'site/mapa.js']) {
  revisar(`${f} no llama a servidores del Distrito`, !/ambientebogota|catastrobogota|datosabiertos\.bogota/.test(leer(f)));
}
const html = leer('site/index.html');
revisar('index.html no carga aire-anual*.js al arrancar', !/<script[^>]+aire-anual/.test(html));
revisar('index.html tiene la casilla y su caja', /id="ver-pm25"[^>]*data-pestana="ciudad"[^>]*data-tipo="color"/.test(html) && /id="pm25-leyenda" hidden/.test(html));
const mapa = leer('site/mapa.js');
revisar('mapa.js baja aire-anual-datos.js y aire-anual.js al prender', /\['aire-anual-datos\.js', 'aire-anual\.js'\]/.test(mapa) && /cajaPm25\.addEventListener\('change'/.test(mapa));
revisar('mapa.js mira los puntos antes que la ciudad y la franja al final', /B\.aireAnual\.tocarPunto\(e\)/.test(mapa) && /B\.aireAnual\.tocarFranja\(e\)/.test(mapa));
revisar('aire-anual.js marca el valor de la SDA como de fuente', /B\.valor\(`[^`]*`, 'de_fuente'/.test(js) && /No se midió en este punto/.test(js));
revisar('sin degradados en la capa', !/gradient|interpolate-hcl|interpolate-lab/.test(js.replace(/'fill-extrusion-vertical-gradient'/g, '')) && !/\['interpolate', \['linear'\], \['get', 'pm25'\]/.test(js));

// 8. fuentes.html: las tres filas con su licencia.
const fu = leer('site/fuentes.html');
revisar('fuentes.html: fila de la superficie, CC BY 4.0, de fuente', /PM2,5 promedio de todo 2025 <span class="marca" data-marca="de_fuente">/.test(fu) && /pm-25-promedio-anual-bogota-d-c/.test(fu));
revisar('fuentes.html: colegios con CC BY‑SA', /colegios-bogota-d-c[\s\S]{0,400}CC BY‑SA 4\.0/.test(fu));
revisar('fuentes.html: red de salud con CC BY', /red-adscrita-de-salud-para-bogota[\s\S]{0,400}CC BY 4\.0/.test(fu));

cierre('Capa de PM2,5 de todo 2025');
