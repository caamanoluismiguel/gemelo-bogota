'use strict';
// Rondas 7 y 7b, y la foto propia: las ortoimágenes 2025 (CC BY 4.0) van en PMTiles nuestros,
// bajados una vez del servicio de IDECA. El visor no le pide nada a ningún servidor del
// Distrito, la CSP no lo deja, cada archivo está en el ancla del release y los créditos dicen
// que la foto está modificada.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const raiz = path.join(__dirname, '..');
const site = (f) => fs.readFileSync(path.join(raiz, 'site', f), 'utf8');
const mapa = site('mapa.js');
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, '');
const bloque = (mapa.match(/const MODIFICADA[\s\S]*?function ponerOrto[\s\S]*?\n  \}\n/) || [''])[0];
revisar('se encuentra el bloque de la foto aérea', bloque.length > 0);

// Ningún servidor del Distrito en el código del sitio (los .geojson guardan de dónde salieron).
const codigo = fs.readdirSync(path.join(raiz, 'site')).filter((f) => /\.(js|html)$/.test(f));
for (const f of codigo) revisar(`${f}: no le pide nada a serviciosgis ni a exportImage`, !/catastrobogota|serviciosgis|exportImage/i.test(site(f)));
revisar('nada de Ortho2017 ni Ortho2014 (licencias SA y NC)', !/ortho20(17|14)/i.test(sinComentarios(bloque)));

// Cada fuente: su PMTiles, teselas de 256, zooms y bounds del archivo.
const FUENTES = {
  SATELITE_FUENTE: ['satelite-entorno-bogota.pmtiles', 9, 13, 'SATELITE'],
  ORTO_LEJOS_FUENTE: ['orto-lejos-bogota.pmtiles', 10, 15, 'ORTO_LEJOS'],
  ORTO_CERROS_FUENTE: ['orto-cerros-bogota.pmtiles', 16, 16],
  // La urbana va en ocho franjas: la fuente pide «-N» y el protocolo pone la franja (pmtiles-red.js).
  ORTO_FUENTE: ['orto-urbana-bogota-N.pmtiles', 16, 18],
  ORTO_CERCA_FUENTE: ['orto-urbana-cerca-bogota.pmtiles', 19, 19]
};
const ancla = JSON.parse(fs.readFileSync(path.join(raiz, 'mapa-base', 'teselas-publicadas.json'), 'utf8')).archivos;
for (const [k, [archivo, zmin, zmax, credito]] of Object.entries(FUENTES)) {
  const f = (bloque.match(new RegExp(`const ${k} = \\{([\\s\\S]*?)\\};`)) || [])[1] || '';
  revisar(`${k}: raster de ${archivo}, z${zmin} a z${zmax}, teselas de 256 y bounds`,
    /type: 'raster'/.test(f) && (f.includes(`url: url('${archivo}')`) || f.includes(`tiles: [url('${archivo}') + '/{z}/{x}/{y}.webp']`)) && /tileSize: 256\b/.test(f) &&
    new RegExp(`minzoom: ${zmin}\\b`).test(f) && new RegExp(`maxzoom: ${zmax}\\b`).test(f) && /bounds: \[-7\d\.\d{4}, \d\.\d{4}, -7\d\.\d{4}, \d\.\d{4}\]/.test(f) && new RegExp(`attribution: ${credito || 'ORTO'}`).test(f));
  const archivos = archivo.includes('-N.') ? [1, 2, 3, 4, 5, 6, 7, 8].map((n) => archivo.replace('-N.', `-${n}.`)) : [archivo];
  for (const a of archivos) {
    const e = ancla[a];
    revisar(`${a}: está en el ancla del release con su huella y CC BY 4.0`, !!e && /^[0-9a-f]{64}$/.test(e.sha256) && e.bytes > 0 && e.licencia === 'CC BY 4.0');
  }
}

// Capas: de abajo hacia arriba el satélite del entorno, la foto de lejos, cerros, urbana y su z19.
// Las dos lejanas entran después del primer cuadro quieto, debajo de los cerros.
const orden = ['orto-cerros', 'orto', 'orto-cerca'].map((id) => mapa.indexOf(`mapa.addLayer({ id: '${id}'`));
revisar('lo lejano entra después, debajo de los cerros y en orden: satélite y luego foto de lejos',
  /function ponerLejos\(\) \{[\s\S]*?addLayer\(\{ id: 'orto-satelite'[^\n]*\}, 'orto-cerros'\);\s*mapa\.addLayer\(\{ id: 'orto-lejos'[^\n]*\}, 'orto-cerros'\);/.test(mapa) &&
  /mapa\.once\('idle', luego\);\s*setTimeout\(luego, 12000\);/.test(mapa) && /if \(noche\) \{ const t = noche; noche = -1; fijarNoche\(t\); \}/.test(mapa));
revisar('orden: cerros, la urbana y su z19 encima', orden.every((i) => i > 0) && orden.every((v, i) => i === 0 || orden[i - 1] < v));
// Ronda 12: la capa se ve desde z15 (el mapa en z15 ya pide teselas z16, así que la fuente no cambia).
revisar('la urbana se ve desde z15 y llega del todo en z15,5', /id: 'orto', type: 'raster', source: 'orto', minzoom: 15/.test(mapa) && /'raster-opacity': \['interpolate', \['linear'\], \['zoom'\], 15, 0, 15\.5, 1\]/.test(mapa));
revisar('la z19 del centro solo desde z19', /id: 'orto-cerca', type: 'raster', source: 'orto-cerca', minzoom: 19/.test(mapa));
revisar('solo con el 3D: las fuentes se agregan al prender el 3D', /ponerTerreno\(on\);\s*ponerOrto\(on\);/.test(mapa) && !/sources: \{[^}]*orto/.test(mapa) && /function ponerOrto[\s\S]*addSource\('orto-cerros'[\s\S]*function ponerLejos[\s\S]*addSource\('orto-satelite'/.test(mapa));
revisar('prender y apagar alcanza a las cinco capas', /const ORTO_CAPAS = \['orto-satelite', 'orto-lejos', 'orto-cerros', 'orto', 'orto-cerca'\];/.test(mapa) && /for \(const id of ORTO_CAPAS\)/.test(mapa));
revisar('de noche las cinco bajan', /orto: \{ 'raster-brightness-max': 0\.3\d/.test(mapa) && ['orto-cerca', 'orto-cerros', 'orto-lejos', 'orto-satelite'].every((id) => new RegExp(`'${id}': \\{ 'raster-brightness-max': 0\\.3`).test(mapa)));
revisar('una tesela que falla no ensucia la consola', /if \(esOrto\(e\)\) return;/.test(mapa) && /const esOrto = \(e\) => !!\(e && \/\^orto\//.test(mapa) && /function sinOrto/.test(mapa));

// CSP: sin el servidor de Catastro; los PMTiles se leen del mismo sitio.
for (const f of codigo.filter((f) => f.endsWith('.html'))) {
  const h = site(f);
  if (!/maplibre/.test(h)) continue;
  const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const dir = (n) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(n + ' ')) || '').split(/\s+/);
  revisar(`${f}: la CSP no deja pedir a gov.co y sí al propio sitio`, !/gov\.co/.test(csp) && dir('connect-src').includes("'self'") && dir('img-src').includes("'self'"));
}

// Atribución en el mapa: titular, IDECA, la licencia y que está modificada.
revisar('atribución: enlaces a SDP, IDECA y la licencia, y «Modificada»', /const MODIFICADA = ' Modificada: reproyectada, recortada en teselas y comprimida\.';/.test(mapa) &&
  /const SDP = '<a href="https:\/\/www\.sdp\.gov\.co\/">SDP<\/a>';/.test(mapa) && /CREDITO_ORTO = \(nombre, titular\) => .*ideca\.gov\.co.*licenses\/by\/4\.0\/deed\.es.*\+ MODIFICADA;/.test(mapa));
revisar('atribución de cada foto con su titular', /const ORTO = CREDITO_ORTO\('Ortoimagen urbana 2025'\);/.test(mapa) && /const ORTO_CERROS = CREDITO_ORTO\('Ortoimagen Cerros Orientales 2025'\);/.test(mapa) &&
  /const ORTO_LEJOS = 'Ortoimágenes 2025 de Bogotá © ' \+ SDP \+ ' y UAECD, publicadas por .*ideca\.gov\.co.*CC BY 4\.0.*Modificada: .*reducida, unida/.test(mapa));
// El satélite del entorno: el crédito que pide ESA WorldCover, tal cual, con CC BY 4.0 y «Modificada».
revisar('atribución del satélite: ESA WorldCover, Copernicus Sentinel, CC BY 4.0 y modificada',
  /const SATELITE = '.*ESA WorldCover project 2021<\/a> \/ Contains modified Copernicus Sentinel data \(2021\) processed by ESA WorldCover consortium, .*licenses\/by\/4\.0.*Modificada:/.test(mapa));
revisar('nada de EOX ni s2maps (licencia comercial restringida)', !/eox|s2maps|s2cloudless/i.test(sinComentarios(mapa)));

// Créditos de fuentes.html.
const fuentes = site('fuentes.html');
const MOD = 'Bajamos las teselas una sola vez y las servimos desde este sitio. Modificada: reproyectada, recortada en teselas y comprimida.';
revisar('créditos de la urbana: SDP, SIGLA, contrato, IDECA y modificada', /Ortoimagen urbana de Bogotá 2025 © Secretaría Distrital de Planeación \(SDP\); producida por SIGLA S\.A\.S\. \(Contrato 1047 de 2024\); publicada por <a href="https:\/\/www\.ideca\.gov\.co\/">IDECA<\/a>, UAECD\. /.test(fuentes));
revisar('créditos de los cerros: SDP, SIGLA, IDECA', /Ortoimagen Cerros Orientales de Bogotá 2025 .*© Secretaría Distrital de Planeación \(SDP\); generación y procesamiento técnico de SIGLA S\.A\.S\.; publicada por <a href="https:\/\/www\.ideca\.gov\.co\/">IDECA<\/a>, UAECD\. /.test(fuentes));
revisar('créditos de la rural: UAECD, SIGLA, IDECA', /Ortoimagen satelital rural de Bogotá 2025 .*© Unidad Administrativa Especial de Catastro Distrital \(UAECD\); generada por SIGLA S\.A\.S\.; publicada por <a href="https:\/\/www\.ideca\.gov\.co\/">IDECA<\/a>\. /.test(fuentes));
revisar('créditos de la foto de lejos y del satélite', /Foto del suelo en el 3D, de lejos<\/td><td>.*reducidas y unidas.*Modificada:/.test(fuentes) &&
  /ESA WorldCover project 2021 \/ Contains modified Copernicus Sentinel data \(2021\) processed by ESA WorldCover consortium\..*Modificada:.*licenses\/by\/4\.0/.test(fuentes));
revisar('las tres filas dicen que la foto está modificada y que la servimos nosotros', fuentes.split(MOD).length - 1 === 3);
revisar('privacidad: ya no se habla de pedirle la foto a Catastro', !/servidor de Catastro|dirección IP/.test(fuentes));
cierre('Foto aérea propia: suelo, cerros y campo del sur');
