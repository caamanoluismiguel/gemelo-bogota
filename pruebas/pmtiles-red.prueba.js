'use strict';
// site/pmtiles-red.js: reintentos ante 5xx y fallas de red, la urbana partida en franjas y la
// ciudad entera en 3D de z12 a z14. Sin navegador ni red.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const raiz = path.join(__dirname, '..');
const red = require(path.join(raiz, 'site', 'pmtiles-red.js'));
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

// Una fuente de mentira que falla según una lista y luego responde.
function fuenteFalsa(fallas) {
  return {
    pedidos: 0,
    getKey: () => 'https://ejemplo.invalid/teselas/x.pmtiles',
    async getBytes(desde, largo) {
      const f = fallas[this.pedidos++];
      if (f) throw f;
      return { data: new ArrayBuffer(largo), etag: undefined };
    }
  };
}
const err503 = () => new Error('Bad response code: 503');
const err404 = () => new Error('Bad response code: 404');
const errRed = () => new TypeError('Failed to fetch');
const RAPIDO = { esperas: [1, 2] };

(async () => {
  // Qué se repite y qué no.
  revisar('503, 502 y 500 se repiten', ['503', '502', '500'].every((c) => red.reintentable(new Error('Bad response code: ' + c))));
  revisar('una falla de red (TypeError de fetch) se repite', red.reintentable(errRed()));
  revisar('404, 416 y 200 sin Range no se repiten', !red.reintentable(err404()) && !red.reintentable(new Error('Bad response code: 416')) &&
    !red.reintentable(new Error('Server returned no content-length header or content-length exceeding request.')));
  const cancelado = new Error('cancelado'); cancelado.name = 'AbortError';
  revisar('un pedido cancelado no se repite', !red.reintentable(cancelado));

  // Dos reintentos: falla, falla, responde.
  let f = fuenteFalsa([err503(), errRed()]);
  let r = await new red.FuenteReintento(f, RAPIDO).getBytes(0, 16);
  revisar('503 y luego red caída: al tercer pedido responde', f.pedidos === 3 && r.data.byteLength === 16, `pedidos ${f.pedidos}`);

  // Tres fallas seguidas: se rinde con el último error, sin un cuarto pedido.
  f = fuenteFalsa([err503(), err503(), err503(), null]);
  let error = null;
  try { await new red.FuenteReintento(f, RAPIDO).getBytes(0, 16); } catch (e) { error = e; }
  revisar('tras dos reintentos se rinde y pasa el error', !!error && /503/.test(error.message) && f.pedidos === 3, `pedidos ${f.pedidos}`);

  // Un 404 no se repite.
  f = fuenteFalsa([err404(), null]);
  error = null;
  try { await new red.FuenteReintento(f, RAPIDO).getBytes(0, 16); } catch (e) { error = e; }
  revisar('un 404 sale al primer pedido', !!error && f.pedidos === 1);

  // Cancelado mientras espera: no vuelve a pedir.
  f = fuenteFalsa([err503(), null]);
  const ctl = new AbortController();
  const p = new red.FuenteReintento(f, { esperas: [200, 200] }).getBytes(0, 16, ctl.signal);
  setTimeout(() => ctl.abort(), 20);
  error = null;
  try { await p; } catch (e) { error = e; }
  revisar('cancelado durante la espera: no hay segundo pedido', !!error && f.pedidos === 1);

  // La espera crece: por defecto 0,4 s y 1,2 s.
  const fuente = leer('site/pmtiles-red.js');
  revisar('dos reintentos con espera creciente', red.REINTENTOS === 2 && /const ESPERAS_MS = \[400, 1200\];/.test(fuente));
  revisar('la clave es la del archivo, así el protocolo la encuentra', new red.FuenteReintento(fuenteFalsa([])).getKey() === 'https://ejemplo.invalid/teselas/x.pmtiles');

  // abrir(): una sola vez por archivo y siempre con reintentos.
  const pmFalso = {
    FetchSource: class { constructor(u) { this.url = u; } getKey() { return this.url; } },
    PMTiles: class { constructor(s) { this.source = s; } }
  };
  const protocoloFalso = { m: new Map(), add(a) { this.m.set(a.source.getKey(), a); }, get(k) { return this.m.get(k); } };
  const a1 = red.abrir(pmFalso, protocoloFalso, 'https://x.invalid/teselas/a.pmtiles');
  const a2 = red.abrir(pmFalso, protocoloFalso, 'https://x.invalid/teselas/a.pmtiles');
  revisar('abrir() registra una sola vez y con FuenteReintento', a1 === a2 && a1.source instanceof red.FuenteReintento && protocoloFalso.m.size === 1);
  revisar('archivoDe() saca el archivo de la dirección del protocolo',
    red.archivoDe('pmtiles://https://x.invalid/teselas/a.pmtiles') === 'https://x.invalid/teselas/a.pmtiles' &&
    red.archivoDe('pmtiles://https://x.invalid/teselas/a.pmtiles/16/19280/31910.webp') === 'https://x.invalid/teselas/a.pmtiles' &&
    red.archivoDe('https://x.invalid/otra-cosa') === null);

  // Franjas de la urbana: mismas filas que orto_partir.py, en orden, y cada tesela en una sola.
  const py = leer('mapa-base/scripts/orto_partir.py');
  const filasPy = JSON.parse((py.match(/^FRANJAS = (\[[\d, ]+\])/m) || [])[1] || 'null');
  revisar('las franjas del visor son las de orto_partir.py', JSON.stringify(filasPy) === JSON.stringify(red.FRANJAS_URBANA));
  revisar('ocho franjas en orden creciente', red.FRANJAS_URBANA.length === 9 && red.FRANJAS_URBANA.every((v, i, a) => i === 0 || a[i - 1] < v));
  let malas = 0, vistas = new Set();
  for (let y16 = red.FRANJAS_URBANA[0]; y16 < red.FRANJAS_URBANA[8]; y16++) {
    const n16 = red.franjaUrbana(16, 19280, y16);
    for (let z = 17; z <= 18; z++) {
      const k = 2 ** (z - 16);
      for (let d = 0; d < k; d++) if (red.franjaUrbana(z, 19280 * k, y16 * k + d) !== n16) malas++;
    }
    vistas.add(n16);
  }
  revisar('una z17 o z18 cae en la franja de su z16', malas === 0, `${malas} distintas`);
  revisar('se usan las ocho franjas', vistas.size === 8 && !vistas.has(0));
  revisar('fuera de la foto o de z16 a z18 no hay franja', red.franjaUrbana(16, 19280, 31885) === 0 && red.franjaUrbana(16, 19280, 31951) === 0 && red.franjaUrbana(15, 9640, 15950) === 0 && red.franjaUrbana(19, 1, 1) === 0);
  const base = 'pmtiles://https://x.invalid/teselas/';
  revisar('rutaUrbana cambia la N por la franja', red.rutaUrbana(base + 'orto-urbana-bogota-N.pmtiles/16/19280/31886.webp') === base + 'orto-urbana-bogota-1.pmtiles/16/19280/31886.webp' &&
    red.rutaUrbana(base + 'orto-urbana-bogota-N.pmtiles/18/77120/127800.webp') === base + 'orto-urbana-bogota-8.pmtiles/18/77120/127800.webp');
  revisar('rutaUrbana deja igual lo que no es la urbana y da null fuera', red.rutaUrbana(base + 'orto-lejos-bogota.pmtiles/12/1/2.webp') === base + 'orto-lejos-bogota.pmtiles/12/1/2.webp' &&
    red.rutaUrbana(base + 'orto-urbana-bogota-N.pmtiles/16/19280/31000.webp') === null);

  // El ancla: las ocho franjas con su huella; el archivo de 420 MB ya no se publica.
  const ancla = JSON.parse(leer('mapa-base/teselas-publicadas.json')).archivos;
  const franjas = Object.keys(ancla).filter((k) => /^orto-urbana-bogota-\d\.pmtiles$/.test(k));
  revisar('ocho franjas en el ancla, cada una de menos de 60 MB', franjas.length === 8 && franjas.every((k) => ancla[k].bytes < 60e6 && /^[0-9a-f]{64}$/.test(ancla[k].sha256)));
  revisar('el archivo urbano de 420 MB no está en el ancla', !('orto-urbana-bogota.pmtiles' in ancla));
  revisar('ningún archivo del ancla pasa de 60 MB', Object.values(ancla).every((e) => e.bytes < 60e6));

  // El visor: la red se carga antes de mapa.js y el protocolo pasa por ella.
  const html = leer('site/index.html');
  const iRed = html.indexOf('src="pmtiles-red.js"'), iPm = html.indexOf('pmtiles@'), iMapa = html.indexOf('src="mapa.js"');
  revisar('index.html carga pmtiles-red.js entre pmtiles y mapa.js', iPm > 0 && iRed > iPm && iMapa > iRed);
  const mapa = leer('site/mapa.js');
  revisar('el protocolo cambia la franja y abre cada archivo con reintentos',
    /const dir = B\.red\.rutaUrbana\(params\.url\);/.test(mapa) && /B\.red\.abrir\(pmtiles, protocolo, archivo\)/.test(mapa) && /const pmCat = B\.red\.abrir\(pmtiles, protocolo,/.test(mapa));

  // La ciudad entera en 3D: de z12 a z14 las huellas unidas; los sectores solo debajo de z12.
  revisar('sectores-3d solo debajo de z12', /id: 'sectores-3d', [^\n]*maxzoom: 12,/.test(mapa));
  revisar('construcciones-lejos-3d de z12 a z14 con catastro-lejos', /id: 'construcciones-lejos-3d', type: 'fill-extrusion', source: 'catastro-lejos', 'source-layer': 'construcciones', minzoom: 12, maxzoom: 14,/.test(mapa) &&
    /addSource\('catastro-lejos', \{ type: 'vector', url: url\('catastro-lejos-bogota\.pmtiles'\), attribution: CAT \}\)/.test(mapa));
  revisar('la lente, la visibilidad y el toque alcanzan a la capa nueva', /const CONSTRUCCIONES_3D = \['construcciones-3d', 'construcciones-lejos-3d'(, 'partes-osm-3d')?\];/.test(mapa) &&
    /for \(const id of \['sectores-3d', \.\.\.CONSTRUCCIONES_3D\]\)/.test(mapa) && /'construcciones-lejos-3d': 'construcciones'/.test(mapa));
  const e = ancla['catastro-lejos-bogota.pmtiles'];
  revisar('catastro-lejos está en el ancla, pequeño y con CC BY 4.0', !!e && e.bytes < 2e6 && e.licencia === 'CC BY 4.0' && /^[0-9a-f]{64}$/.test(e.sha256));
  revisar('catastro.sh arma catastro-lejos de z12 a z13', /-o salida\/catastro-lejos-bogota\.pmtiles -l construcciones -Z12 -z13/.test(leer('mapa-base/scripts/catastro.sh')));

  cierre('Red de teselas: reintentos, franjas y ciudad en 3D');
})();
