'use strict';
// Ronda 7: la foto aérea del suelo (Ortoimagen urbana 2025, CC BY 4.0). La fuente, los zooms y
// la CSP tienen que coincidir; si no, el navegador la bloquea o se piden teselas de más.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const site = (f) => fs.readFileSync(path.join(__dirname, '..', 'site', f), 'utf8');
const mapa = site('mapa.js');
const HOST = 'https://serviciosgis.catastrobogota.gov.co';
const URL_ESPERADA = HOST + '/image/rest/services/imagenesfunciones/orthourbana2025funcion/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image';
const url = (mapa.match(/const ORTO_URL = '([^']+)'/) || [])[1];
revisar('la fuente es exportImage de la ortoimagen urbana 2025', url === URL_ESPERADA);
revisar('nada de Ortho2017 ni Ortho2014 (licencias SA y NC) ni el servicio rural', !/ortho20(17|14)|rural/i.test((mapa.match(/ORTO[\s\S]{0,1500}?function ponerOrto/) || [''])[0].replace(/\/\/.*$/gm, '')));
const fuente = (mapa.match(/const ORTO_FUENTE = \{([\s\S]*?)\};/) || [])[1] || '';
revisar('se pide desde z16 y hasta z20', /minzoom: 16\b/.test(fuente) && /maxzoom: 20\b/.test(fuente));
revisar('con bounds de la zona urbana (afuera el servicio da blanco)', /bounds: \[-74\.2250, 4\.4862, -74\.0189, 4\.8380\]/.test(fuente));
revisar('la capa empieza en z16 y aparece de a poco hasta z17', /id: 'orto', type: 'raster', source: 'orto', minzoom: 16/.test(mapa) && /'raster-opacity': \['interpolate', \['linear'\], \['zoom'\], 16, 0, 17, 1\]/.test(mapa));
revisar('solo con el 3D: la fuente se agrega al prender el 3D', /ponerTerreno\(on\);\s*ponerOrto\(on\);/.test(mapa) && !/sources: \{[^}]*orto/.test(mapa));
revisar('de noche la foto baja', /orto: \{ 'raster-brightness-max': 0\.3\d/.test(mapa));
revisar('una tesela que falla no ensucia la consola', /if \(esOrto\(e\)\) return;/.test(mapa) && /const esOrto = \(e\) => !!\(e && \/\^orto\//.test(mapa) && /function sinOrto/.test(mapa));
for (const f of fs.readdirSync(path.join(__dirname, '..', 'site')).filter((f) => f.endsWith('.html'))) {
  const h = site(f);
  if (!/maplibre/.test(h)) continue;
  const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const dir = (n) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(n + ' ')) || '').split(/\s+/);
  revisar(`${f}: la CSP deja pedir la foto (img-src y connect-src)`, dir('img-src').includes(HOST) && dir('connect-src').includes(HOST));
}
const fuentes = site('fuentes.html');
revisar('créditos: ortoimagen, SDP, SIGLA, contrato, IDECA y CC BY 4.0', /Ortoimagen urbana de Bogotá 2025 © Secretaría Distrital de Planeación \(SDP\); producida por SIGLA S\.A\.S\. \(Contrato 1047 de 2024\); publicada por <a href="https:\/\/www\.ideca\.gov\.co\/">IDECA<\/a>, UAECD/.test(fuentes));
revisar('atribución del mapa con enlaces a SDP, IDECA y la licencia', /const ORTO = '.*sdp\.gov\.co.*ideca\.gov\.co.*licenses\/by\/4\.0\/deed\.es/.test(mapa));
// Ronda 7b: los Cerros Orientales (Ortoimagen Cerros 2025, CC BY 4.0), bajo la urbana.
const URL_CERROS = HOST + '/image/rest/services/imagenesfunciones/orthocerros2025funcion/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&noData=255&f=image';
revisar('cerros: exportImage de orthocerros2025funcion, con transparencia fuera de la foto', (mapa.match(/const ORTO_CERROS_URL = '([^']+)'/) || [])[1] === URL_CERROS);
const fCerros = (mapa.match(/const ORTO_CERROS_FUENTE = \{([\s\S]*?)\};/) || [])[1] || '';
revisar('cerros: desde z13 hasta z20, con bounds de la extensión del servicio', /minzoom: 13\b/.test(fCerros) && /maxzoom: 20\b/.test(fCerros) && /bounds: \[-74\.0918, 4\.4600, -73\.9899, 4\.8262\]/.test(fCerros));
revisar('cerros lejanos: solo z11 con imágenes de 512 px (el servicio no dibuja más grueso)', /ORTO_CERROS_LEJOS = Object\.assign\(\{\}, ORTO_CERROS_FUENTE, \{ minzoom: 11, maxzoom: 11,\s*tiles: \[ORTO_CERROS_URL\.replace\('size=256,256', 'size=512,512'\)\] \}\)/.test(mapa));
const orden = ['orto-cerros-lejos', 'orto-cerros', 'orto'].map((id) => mapa.indexOf(`mapa.addLayer({ id: '${id}'`));
revisar('orden: cerros lejanos, cerros y la urbana encima', orden.every((i) => i > 0) && orden[0] < orden[1] && orden[1] < orden[2]);
revisar('cerros: solo con el 3D (se agregan en ponerOrto) y de noche bajan', /function ponerOrto[\s\S]*addSource\('orto-cerros'/.test(mapa) && /'orto-cerros': \{ 'raster-brightness-max': 0\.3/.test(mapa) && /'orto-cerros-lejos': \{ 'raster-brightness-max': 0\.3/.test(mapa));
revisar('créditos de los cerros: SDP, SIGLA, IDECA y CC BY 4.0', /Ortoimagen Cerros Orientales de Bogotá 2025 .*© Secretaría Distrital de Planeación \(SDP\); generación y procesamiento técnico de SIGLA S\.A\.S\.; publicada por <a href="https:\/\/www\.ideca\.gov\.co\/">IDECA<\/a>, UAECD/.test(fuentes));
revisar('atribución de los cerros con enlaces a SDP, IDECA y la licencia', /const ORTO_CERROS = 'Ortoimagen Cerros Orientales 2025.*sdp\.gov\.co.*ideca\.gov\.co.*licenses\/by\/4\.0\/deed\.es/.test(mapa) && /attribution: ORTO_CERROS \}/.test(mapa));
cierre('Foto aérea del suelo y los cerros');
