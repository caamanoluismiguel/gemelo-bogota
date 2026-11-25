'use strict';
// Service worker (site/sw.js) y su sello (mapa-base/sellar-sw.js): llaves de caché, versiones,
// qué se guarda y qué va siempre a la red, tope de tamaño y limpieza al cambiar de release.
// Corre en Node con un caché de mentira; no abre navegador.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { revisar, cierre } = require('./util');
const sw = require('../site/sw.js');
const sello = require('../mapa-base/sellar-sw.js');

const BASE = 'https://caamanoluismiguel.github.io/gemelo-bogota/';
const HUELLA_A = '854760352a50', HUELLA_B = '0e639c4e1254';
const VERSION = 'c8e307957490';
const CTX = { origen: 'https://caamanoluismiguel.github.io', base: BASE, version: VERSION,
  teselas: { 'osm-bogota.pmtiles': HUELLA_A, 'catastro-pisos-bogota.pmtiles': HUELLA_B, 'horizonte-bogota.hzn.gz': 'a52da64008ed' } };

// ---------- Rangos y llaves ----------
revisar('rango cerrado', JSON.stringify(sw.rangoDe('bytes=0-16383')) === '{"ini":0,"fin":16383}');
revisar('rango abierto no se guarda', sw.rangoDe('bytes=100-') === null);
revisar('rango por el final no se guarda', sw.rangoDe('bytes=-500') === null);
revisar('rango roto no se guarda', sw.rangoDe('bytes=9-3') === null && sw.rangoDe('bytes=1-2,5-6') === null && sw.rangoDe(null) === null);
revisar('Content-Range', JSON.stringify(sw.contentRange('bytes 10-19/100')) === '{"ini":10,"fin":19,"total":100}' && sw.contentRange('bytes */100') === null);

const u = BASE + 'teselas/osm-bogota.pmtiles';
const k1 = sw.claveTesela(u, HUELLA_A, { ini: 0, fin: 99 });
revisar('la llave lleva archivo, huella y rango', k1 === BASE + 'teselas/osm-bogota.pmtiles?sw=1&h=' + HUELLA_A + '&r=0-99', k1);
revisar('otro rango, otra llave', k1 !== sw.claveTesela(u, HUELLA_A, { ini: 100, fin: 199 }));
revisar('otra huella (release nuevo), otra llave', k1 !== sw.claveTesela(u, HUELLA_B, { ini: 0, fin: 99 }));
revisar('un ?v= en el pedido no cambia la llave', sw.claveTesela(u + '?v=3', HUELLA_A, { ini: 0, fin: 99 }) === k1);
revisar('archivo entero: llave «todo»', /&r=todo$/.test(sw.claveTesela(u, HUELLA_A, null)));
revisar('llave de página sin ?... ni #', sw.claveSitio(BASE + '?x=1#a', true) === BASE);
revisar('llave de archivo conserva su ?...', sw.claveSitio(BASE + 'mapa.js?v=2#a', false) === BASE + 'mapa.js?v=2');

// ---------- Qué toca a cada pedido ----------
const cl = (url, m) => sw.clasificar(m || 'GET', url, CTX);
revisar('tesela conocida: tesela', cl(u) === 'tesela');
revisar('horizonte entero: tesela', cl(BASE + 'teselas/horizonte-bogota.hzn.gz') === 'tesela');
revisar('tesela que el sello no conoce: red', cl(BASE + 'teselas/otra.pmtiles') === null);
revisar('maplibre con versión: cdn', cl('https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js') === 'cdn');
revisar('pmtiles con versión: cdn', cl('https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js') === 'cdn');
revisar('unpkg sin versión fija: red', cl('https://unpkg.com/maplibre-gl/dist/maplibre-gl.js') === null && cl('https://unpkg.com/maplibre-gl@5/dist/x.js') === null);
revisar('página, script, hoja y fuente del mapa: sitio', ['', 'index.html', 'mapa.js', 'estilo.css', 'fuentes/Noto%20Sans%20Medium/0-255.pbf', 'datos/buscador.json'].every((r) => cl(BASE + r) === 'sitio'));
revisar('datos vivos del repo vivo: red', cl('https://caamanoluismiguel.github.io/gemelo-bogota-vivo/cielo/ahora.json?t=5') === null
  && cl('https://caamanoluismiguel.github.io/gemelo-bogota-vivo/bicis/serie-48h.ndjson.gz') === null);
revisar('noches frías: red', cl(BASE + 'datos/noches-frias/ultima.json') === null && cl(BASE + 'datos/noches-frias/indice.json') === null);
revisar('el propio sw.js: red', cl(BASE + 'sw.js') === null);
revisar('otro sitio del mismo dominio: red', cl('https://caamanoluismiguel.github.io/otro/index.html') === null);
revisar('?datos= a otro servidor: red', cl('https://ejemplo.org/teselas/osm-bogota.pmtiles') === null);
revisar('solo GET', cl(u, 'POST') === null && cl(BASE + 'mapa.js', 'HEAD') === null);
revisar('sin sello de versión no hace nada', sw.clasificar('GET', u, { ...CTX, version: '__SW_VERSION__' }) === null);

// ---------- Sello de teselas ----------
revisar('sello sano', Object.keys(sw.leerTeselas(JSON.stringify(CTX.teselas))).length === 3);
revisar('sello sin reemplazar o roto: vacío', Object.keys(sw.leerTeselas('__SW_TESELAS__')).length === 0 && Object.keys(sw.leerTeselas('{"a.pmtiles":"zz"}')).length === 0);

// ---------- Versiones y limpieza ----------
const todos = ['bogotwin-teselas', 'bogotwin-cdn', 'bogotwin-sitio-viejo1', 'bogotwin-sitio-' + VERSION, 'de-otro-sitio'];
const borrar = sw.cachesViejos(todos, VERSION);
revisar('al cambiar de versión se va el caché del sitio anterior', borrar.length === 1 && borrar[0] === 'bogotwin-sitio-viejo1', borrar.join());
revisar('teselas y cdn se quedan; lo ajeno no se toca', !borrar.includes('bogotwin-teselas') && !borrar.includes('bogotwin-cdn') && !borrar.includes('de-otro-sitio'));
revisar('esObsoleta: huella distinta', sw.esObsoleta(sw.claveTesela(u, 'ffffffffffff', { ini: 0, fin: 9 }), CTX.teselas));
revisar('esObsoleta: archivo que ya no se publica', sw.esObsoleta(sw.claveTesela(BASE + 'teselas/viejo.pmtiles', HUELLA_A, { ini: 0, fin: 9 }), CTX.teselas));
revisar('esObsoleta: huella vigente se conserva', !sw.esObsoleta(sw.claveTesela(u, HUELLA_A, { ini: 0, fin: 9 }), CTX.teselas));

// ---------- Tope de tamaño ----------
const MB = 1024 * 1024;
const claves = [sw.claveTesela(u, HUELLA_A, { ini: 0, fin: 16383 })];
for (let i = 0; i < 10; i++) claves.push(sw.claveTesela(u, HUELLA_A, { ini: 20 * MB + i * MB, fin: 20 * MB + (i + 1) * MB - 1 })); // 10 de 1 MB
const plan = sw.planRecorte(claves, 4 * MB);
revisar('recorte: borra lo más viejo hasta quedar bajo el tope', plan.borrar.length === 7 && plan.borrar[0] === claves[1] && plan.total <= 4 * MB, plan.borrar.length + ' borradas, ' + plan.total);
revisar('recorte: la cabecera (byte 0) no se borra', !plan.borrar.includes(claves[0]));
revisar('recorte: bajo el tope no borra nada', sw.planRecorte(claves, 100 * MB).borrar.length === 0);

// ---------- Flujo completo con red y caché de mentira ----------
function cacheFalso() {
  const m = new Map();
  return {
    async match(k) { const g = m.get(typeof k === 'string' ? k : k.url); return g ? new Response(g.cuerpo.slice(0), { status: g.status, headers: g.headers }) : undefined; },
    async put(k, r) { m.set(typeof k === 'string' ? k : k.url, { cuerpo: await r.arrayBuffer(), status: r.status, headers: [...r.headers] }); },
    async keys() { return [...m.keys()].map((url) => ({ url })); },
    async delete(k) { return m.delete(typeof k === 'string' ? k : k.url); }
  };
}
function almacenFalso() {
  const cs = new Map();
  return { async open(n) { if (!cs.has(n)) cs.set(n, cacheFalso()); return cs.get(n); }, async keys() { return [...cs.keys()]; }, async delete(n) { return cs.delete(n); }, _cs: cs };
}
// Una Response creada a mano es de tipo 'default'; la de un fetch al mismo sitio es 'basic'.
const propia = (r) => Object.defineProperty(r, 'type', { value: 'basic' });
// Servidor de mentira: archivo de 1000 bytes con Range, etag fijo.
function redFalsa() {
  const llamadas = [];
  const f = async (req, init) => {
    const url = typeof req === 'string' ? req : req.url;
    const rango = typeof req === 'string' ? null : req.headers.get('range');
    llamadas.push({ url, rango, init });
    if (rango) {
      const m = /bytes=(\d+)-(\d*)/.exec(rango); const ini = +m[1], fin = Math.min(m[2] === '' ? 999 : +m[2], 999);
      return new Response(new Uint8Array(fin - ini + 1).fill(7), { status: 206, headers: { 'content-range': `bytes ${ini}-${fin}/1000`, 'content-length': String(fin - ini + 1), etag: '"e1"', 'content-type': 'application/octet-stream' } });
    }
    return propia(new Response('contenido de ' + url, { status: 200, headers: { 'content-type': 'text/javascript' } }));
  };
  f.llamadas = llamadas;
  return f;
}
function ctxFalso(extra) {
  const pend = [];
  const c = { ...CTX, caches: almacenFalso(), fetch: redFalsa(), esperar: (p) => pend.push(p), ...extra };
  c.vaciar = () => Promise.all(pend.splice(0));
  return c;
}

(async () => {
  // Tesela por rango: la primera va a la red, la segunda sale del caché como 206 igual.
  let c = ctxFalso();
  const pedir = () => new Request(u, { headers: { Range: 'bytes=100-199' } });
  const r1 = await sw.atender(pedir(), 'tesela', c); await c.vaciar();
  revisar('1.ª tesela: red y 206', r1.status === 206 && c.fetch.llamadas.length === 1);
  const r2 = await sw.atender(pedir(), 'tesela', c); await c.vaciar();
  const b2 = new Uint8Array(await r2.arrayBuffer());
  revisar('2.ª tesela: del caché, sin red', c.fetch.llamadas.length === 1 && r2.status === 206);
  revisar('el 206 guardado trae Content-Range, largo, etag y el mismo cuerpo',
    r2.headers.get('content-range') === 'bytes 100-199/1000' && r2.headers.get('content-length') === '100' && r2.headers.get('etag') === '"e1"' && b2.length === 100 && b2[0] === 7);
  await sw.atender(new Request(u, { headers: { Range: 'bytes=200-299' } }), 'tesela', c); await c.vaciar();
  revisar('otro rango: red de nuevo', c.fetch.llamadas.length === 2);

  // Release nuevo: misma URL, otra huella en el sello, no sirve lo viejo.
  const c2 = ctxFalso({ caches: c.caches, teselas: { ...CTX.teselas, 'osm-bogota.pmtiles': 'aaaaaaaaaaaa' } });
  await sw.atender(pedir(), 'tesela', c2); await c2.vaciar();
  revisar('release nuevo: vuelve a la red por el mismo rango', c2.fetch.llamadas.length === 1);
  await sw.limpiar(c2);
  const kt = await (await c.caches.open(sw.CACHE_TESELAS)).keys();
  revisar('al activar se borra lo del release anterior y queda lo nuevo', kt.length === 1 && kt[0].url.includes('h=aaaaaaaaaaaa'), String(kt.length));

  // Rangos que no se guardan: abiertos pasan a la red tal cual.
  c = ctxFalso();
  await sw.atender(new Request(u, { headers: { Range: 'bytes=500-' } }), 'tesela', c); await c.vaciar();
  revisar('rango abierto: a la red y no se guarda', c.fetch.llamadas.length === 1 && (await (await c.caches.open(sw.CACHE_TESELAS)).keys()).length === 0);
  // Una respuesta 200 a un pedido con Range (el servidor lo ignoró) no se guarda.
  c = ctxFalso({ fetch: async () => new Response('x'.repeat(50), { status: 200 }) });
  await sw.atender(pedir(), 'tesela', c); await c.vaciar();
  revisar('200 a un pedido por rango: no se guarda', (await (await c.caches.open(sw.CACHE_TESELAS)).keys()).length === 0);
  // Una respuesta enorme no se guarda.
  c = ctxFalso({ fetch: async () => new Response('x', { status: 206, headers: { 'content-range': 'bytes 100-199/1000', 'content-length': String(sw.MAX_ENTRADA + 1) } }) });
  await sw.atender(pedir(), 'tesela', c); await c.vaciar();
  revisar('respuesta más grande que el tope por entrada: no se guarda', (await (await c.caches.open(sw.CACHE_TESELAS)).keys()).length === 0);

  // Archivo entero (horizonte).
  c = ctxFalso();
  const hz = BASE + 'teselas/horizonte-bogota.hzn.gz';
  await sw.atender(new Request(hz), 'tesela', c); await c.vaciar();
  const h2 = await sw.atender(new Request(hz), 'tesela', c);
  revisar('archivo entero: segunda vez del caché, 200', h2.status === 200 && c.fetch.llamadas.length === 1);

  // Sitio: caché por versión; al llenar pregunta al servidor (no-cache).
  c = ctxFalso();
  const pg = () => new Request(BASE + 'mapa.js');
  await sw.atender(pg(), 'sitio', c); await c.vaciar();
  revisar('sitio: al llenar el caché pide con no-cache', c.fetch.llamadas[0].init && c.fetch.llamadas[0].init.cache === 'no-cache');
  const s2 = await sw.atender(pg(), 'sitio', c);
  revisar('sitio: segunda vez del caché', c.fetch.llamadas.length === 1 && (await s2.text()).includes('mapa.js'));
  const c3 = ctxFalso({ caches: c.caches, version: 'bbbbbbbbbbbb' });
  await sw.atender(pg(), 'sitio', c3); await c3.vaciar();
  revisar('despliegue nuevo: caché vacío, va a la red', c3.fetch.llamadas.length === 1);
  await sw.limpiar(c3);
  revisar('al activar el despliegue nuevo se borra el caché del anterior', !(await c.caches.keys()).includes(sw.cacheSitio(VERSION)));
  // Una respuesta que no es 200 no se guarda.
  c = ctxFalso({ fetch: async () => new Response('no', { status: 404 }) });
  await sw.atender(pg(), 'sitio', c); await c.vaciar();
  revisar('sitio: un 404 no se guarda', (await (await c.caches.open(sw.cacheSitio(VERSION))).keys()).length === 0);

  // Con los reintentos de pmtiles-red.js: un 503 o una red caída pasan tal cual (sin guardarse)
  // y el pedido repetido, ya bueno, sí se guarda.
  let intento = 0;
  const ok206 = () => new Response(new Uint8Array(100).fill(7), { status: 206, headers: { 'content-range': 'bytes 100-199/1000', 'content-length': '100' } });
  c = ctxFalso({ fetch: async () => { intento++; if (intento === 1) return new Response('x', { status: 503 }); return ok206(); } });
  const e1 = await sw.atender(pedir(), 'tesela', c);
  revisar('503: pasa tal cual al reintento de pmtiles-red.js y no se guarda', e1.status === 503 && (await (await c.caches.open(sw.CACHE_TESELAS)).keys()).length === 0);
  // Red caída: el worker lo intenta una vez más directo (como si no existiera) y, si también falla, el error sigue siendo TypeError.
  let cayo = null; const c4 = ctxFalso({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  try { await sw.atender(pedir(), 'tesela', c4); } catch (e) { cayo = e; }
  revisar('red caída: llega TypeError (reintentable por pmtiles-red.js) y no se guarda', cayo instanceof TypeError && (await (await c4.caches.open(sw.CACHE_TESELAS)).keys()).length === 0);
  const e3 = await sw.atender(pedir(), 'tesela', c); await c.vaciar();
  revisar('el pedido repetido, ya bueno, sí se guarda', e3.status === 206 && (await (await c.caches.open(sw.CACHE_TESELAS)).keys()).length === 1);

  // Todo PMTiles que usa el sitio (franjas de la urbana y catastro-lejos incluidos) está en el sello.
  const ancla2 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mapa-base', 'teselas-publicadas.json'), 'utf8'));
  const ctxReal = { ...CTX, teselas: sello.mapaTeselas(ancla2) };
  const nombres = ['catastro-lejos-bogota.pmtiles', 'catastro-pisos-bogota.pmtiles', 'osm-bogota.pmtiles', 'limites-bogota.pmtiles', 'terreno-bogota.pmtiles', 'arboles-bogota.pmtiles',
    'orto-cerros-bogota.pmtiles', 'orto-lejos-bogota.pmtiles', 'orto-urbana-cerca-bogota.pmtiles', 'satelite-entorno-bogota.pmtiles', 'horizonte-bogota.hzn.gz'];
  for (let i = 1; i <= 8; i++) nombres.push('orto-urbana-bogota-' + i + '.pmtiles');
  revisar('los PMTiles del sitio son «tesela» para el worker', nombres.every((n) => sw.clasificar('GET', BASE + 'teselas/' + n, ctxReal) === 'tesela'), nombres.filter((n) => sw.clasificar('GET', BASE + 'teselas/' + n, ctxReal) !== 'tesela').join());
  revisar('los PMTiles del sitio son los que usa el código', fs.readdirSync(path.join(__dirname, '..', 'site')).filter((f) => f.endsWith('.js')).every((f) => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'site', f), 'utf8');
    return (t.match(/[a-z0-9-]+\.pmtiles/g) || []).filter((n) => !/^(op|raiz)\.pmtiles$/.test(n)).every((n) => nombres.includes(n) || n.includes('-N.'));
  }));

  // unpkg: versionado, primero lo guardado; una respuesta opaca no se guarda.
  const ml = 'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js';
  const cors = (r) => Object.defineProperty(r, 'type', { value: 'cors' });
  c = ctxFalso({ fetch: async (r) => cors(new Response('lib', { status: 200 })) });
  await sw.atender(new Request(ml), 'cdn', c); await c.vaciar();
  const cdn2 = await sw.atender(new Request(ml), 'cdn', { ...c, fetch: async () => { throw new Error('no debía ir a la red'); } });
  revisar('cdn: la segunda vez sale del caché', (await cdn2.text()) === 'lib');
  c = ctxFalso({ fetch: async () => Object.defineProperty(new Response('x', { status: 200 }), 'type', { value: 'opaque' }) });
  await sw.atender(new Request(ml), 'cdn', c); await c.vaciar();
  revisar('cdn: una respuesta opaca no se guarda', (await (await c.caches.open(sw.CACHE_CDN)).keys()).length === 0);

  // Sin caché disponible (modo privado): como si no existiera.
  c = ctxFalso({ caches: { open: async () => { throw new Error('SecurityError'); }, keys: async () => [] } });
  const sin = await sw.atender(new Request(BASE + 'mapa.js'), 'sitio', c);
  revisar('si el caché falla, responde desde la red', sin.status === 200 && c.fetch.llamadas.length === 1);

  // Lo que arranca la página: sale de index.html.
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  const rec = sw.recursosDeArranque(html, BASE).map((x) => x.url.replace(BASE, ''));
  revisar('arranque: ve los scripts propios y los de unpkg', ['comun.js', 'mapa.js', 'registrar-sw.js', 'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js', 'https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js'].every((x) => rec.includes(x)), rec.join(' '));
  revisar('arranque: ve las hojas y el icono', ['estilo.css', 'icono.svg', 'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.css'].every((x) => rec.includes(x)));
  revisar('arranque: trae el integrity de unpkg', sw.recursosDeArranque(html, BASE).filter((x) => x.url.startsWith('https://unpkg.com')).every((x) => /^sha384-/.test(x.integrity)));
  c = ctxFalso({ fetch: async (r) => { const url = typeof r === 'string' ? r : r.url; return propia(new Response(url === BASE ? html : 'x', { status: 200, headers: { 'content-type': 'text/plain' } })); } });
  await sw.precargar(c);
  const ks = (await (await c.caches.open(sw.cacheSitio(VERSION))).keys()).map((k) => k.url);
  revisar('precarga: guarda la página de entrada y lo propio', ks.includes(BASE) && ks.includes(BASE + 'mapa.js') && ks.includes(BASE + 'estilo.css'), ks.length + ' archivos');
  revisar('precarga: ya no guarda fuera de lo suyo', ks.every((k) => k.startsWith(BASE)));

  // ---------- Sello del despliegue ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sello-'));
  try {
    const esc = (r, t) => { fs.mkdirSync(path.dirname(path.join(dir, r)), { recursive: true }); fs.writeFileSync(path.join(dir, r), t); };
    esc('index.html', 'a'); esc('mapa.js', 'b'); esc('sw.js', "const VERSION = '__SW_VERSION__';\nconst TESELAS_SELLO = '__SW_TESELAS__';\n");
    esc('teselas/osm-bogota.pmtiles', 'xx'); esc('datos/noches-frias/ultima.json', '{}'); esc('.nojekyll', '');
    const v1 = sello.calcularVersion(dir);
    revisar('versión: 12 letras hex', /^[0-9a-f]{12}$/.test(v1), v1);
    esc('datos/noches-frias/ultima.json', '{"otro":1}'); esc('teselas/osm-bogota.pmtiles', 'yy');
    revisar('versión: no cambia con noches frías ni teselas (van por su huella)', sello.calcularVersion(dir) === v1);
    fs.writeFileSync(path.join(dir, 'sw.js'), 'otro sw');
    revisar('versión: no depende del propio sw.js', sello.calcularVersion(dir) === v1);
    esc('mapa.js', 'b2');
    const v2 = sello.calcularVersion(dir);
    revisar('versión: cambia si cambia un archivo del sitio', v2 !== v1);
    esc('nuevo.js', 'c');
    revisar('versión: cambia si se agrega un archivo', sello.calcularVersion(dir) !== v2);

    const ancla = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mapa-base', 'teselas-publicadas.json'), 'utf8'));
    const mapa = sello.mapaTeselas(ancla);
    revisar('teselas: una huella de 12 por cada archivo del ancla', Object.keys(mapa).length === Object.keys(ancla.archivos).length && Object.values(mapa).every((h) => /^[0-9a-f]{12}$/.test(h)));
    revisar('teselas: sin sha256 válido falla', (() => { try { sello.mapaTeselas({ archivos: { 'a.pmtiles': { sha256: 'x' } } }); return false; } catch (e) { return true; } })());
    const real = fs.readFileSync(path.join(__dirname, '..', 'site', 'sw.js'), 'utf8');
    const sellado = sello.sellar(real, v2, mapa);
    revisar('sello: reemplaza las dos marcas', !sellado.includes('__SW_') && sellado.includes("'" + v2 + "'") && sellado.includes('osm-bogota.pmtiles'));
    revisar('sello: el JSON que queda lo lee el worker', Object.keys(sw.leerTeselas(/const TESELAS_SELLO = '(.*)';/.exec(sellado)[1])).length === Object.keys(mapa).length);
    revisar('sello: no sella dos veces', (() => { try { sello.sellar(sellado, v2, mapa); return false; } catch (e) { return true; } })());
    revisar('sello: el sw.js sellado sigue siendo JavaScript válido', (() => { try { new Function(sellado); return true; } catch (e) { return false; } })());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // ---------- Que lo demás esté cableado ----------
  const flujo = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  revisar('pages.yml sella sw.js después de armar la carpeta', /node mapa-base\/sellar-sw\.js publicar mapa-base\/teselas-publicadas\.json/.test(flujo));
  revisar('pages.yml se lanza si cambia el sello', /mapa-base\/sellar-sw\.js/.test(/paths:[\s\S]*?workflow_dispatch/.exec(flujo)[0]));
  revisar('index.html registra el worker de primero y async', /<script async src="registrar-sw\.js"><\/script>/.test(html) && html.indexOf('registrar-sw.js') < html.indexOf('maplibre-gl.css'));
  revisar('la CSP deja registrar el worker (worker-src \'self\') y no se abrió nada más', /worker-src 'self' blob:/.test(html) && !/unsafe-inline|unsafe-eval|\*;/.test(html));
  const mapaJs = fs.readFileSync(path.join(__dirname, '..', 'site', 'mapa.js'), 'utf8');
  revisar('la hoja de MapLibre sale de media="print" antes de crear el mapa', /maplibre-gl\.css" media="print"/.test(html) && mapaJs.indexOf("hojaMapa.media = 'all'") > 0 && mapaJs.indexOf("hojaMapa.media = 'all'") < mapaJs.indexOf('new maplibregl.Map'));
  const reg = fs.readFileSync(path.join(__dirname, '..', 'site', 'registrar-sw.js'), 'utf8');
  revisar('el registro se sale solo si no hay serviceWorker y atrapa el error', /'serviceWorker' in navigator/.test(reg) && /\.catch\(/.test(reg));
  revisar('?sw=0 desregistra y borra lo guardado', /sw=0/.test(reg) && /unregister\(\)/.test(reg) && /caches\.delete/.test(reg));
  revisar('sw.js nunca guarda los datos vivos (no nombra el repo vivo ni guarda noches frías)', !/gemelo-bogota-vivo/.test(fs.readFileSync(path.join(__dirname, '..', 'site', 'sw.js'), 'utf8').replace(/\/\/.*$/gm, '')));
  cierre('sw.prueba.js');
})();
