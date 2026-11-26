'use strict';
// Service worker de Bogotwin: guarda en el teléfono lo que no cambia para que la segunda visita
// no vuelva a pedirlo. GitHub Pages manda max-age=600 y no se puede cambiar; aquí sí.
//
//  - Teselas PMTiles (pedidos por rango): primero lo guardado. La llave lleva el sha256 de cada
//    archivo, que pages.yml sella en este archivo al publicar: un release nuevo cambia la llave
//    y lo viejo se borra al activarse la versión nueva. Tope de tamaño; lo más viejo sale primero.
//  - Páginas, JS, CSS, fuentes del mapa y datos estáticos del sitio: primero lo guardado, en un
//    caché por despliegue (la versión es el hash de todo lo publicado). Un despliegue nuevo
//    cambia este archivo, el navegador lo instala y la carga siguiente ya trae todo nuevo.
//  - unpkg con versión en la ruta (maplibre, pmtiles): primero lo guardado; la URL no cambia
//    de contenido y el navegador igual comprueba el SRI.
//  - Datos vivos (repo gemelo-bogota-vivo), noches frías y cualquier otra cosa: NO se tocan.
//    Van directo a la red, así el «hace X min» del panel dice la verdad.
//
// Sin sello (servidor local sin sellar) no hace nada: no guarda ni responde por nadie.
// Las funciones puras se prueban en Node (pruebas/sw.prueba.js).

const VERSION = '__SW_VERSION__';
const TESELAS_SELLO = '__SW_TESELAS__';

const PREFIJO = 'bogotwin-';
const CACHE_TESELAS = PREFIJO + 'teselas';
const CACHE_CDN = PREFIJO + 'cdn';
const cacheSitio = (v) => PREFIJO + 'sitio-' + v;

const LIMITE_TESELAS = 128 * 1024 * 1024; // lo que ocupan las teselas guardadas, como máximo
const MAX_ENTRADA = 4 * 1024 * 1024;      // un pedido más grande no se guarda
const TAM_ARCHIVO_ENTERO = 512 * 1024;    // lo que se cuenta por cada archivo guardado entero
const CADA_CUANTOS_RECORTES = 16;         // se mira el tope cada tantas teselas guardadas

const ES_HUELLA = /^[0-9a-f]{8,64}$/;

// ---------- Funciones puras ----------

// '12345...' de un pedido «bytes=ini-fin». Los rangos abiertos o por el final no se guardan.
function rangoDe(cabecera) {
  const m = /^bytes=(\d+)-(\d+)$/.exec(String(cabecera || '').trim());
  if (!m) return null;
  const ini = Number(m[1]), fin = Number(m[2]);
  return Number.isSafeInteger(ini) && Number.isSafeInteger(fin) && fin >= ini ? { ini, fin } : null;
}

// «bytes a-b/total» de una respuesta 206.
function contentRange(cabecera) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(cabecera || '').trim());
  return m ? { ini: Number(m[1]), fin: Number(m[2]), total: Number(m[3]) } : null;
}

// El sello de teselas llega como texto JSON {nombre: huella}. Sin sello o dañado: vacío.
function leerTeselas(texto) {
  try {
    const o = JSON.parse(texto);
    const salida = {};
    for (const [k, v] of Object.entries(o || {})) if (/^[a-z0-9.-]+$/.test(k) && ES_HUELLA.test(String(v))) salida[k] = v;
    return salida;
  } catch (e) { return {}; }
}

// Qué le toca a un pedido: 'tesela', 'cdn', 'sitio' o null (a la red sin tocar).
// ctx: { origen, base (el alcance, con / al final), teselas, version }
function clasificar(metodo, urlTexto, ctx) {
  if (metodo !== 'GET' || !ES_HUELLA.test(String(ctx.version || ''))) return null;
  let u;
  try { u = new URL(urlTexto); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
  if (u.origin === 'https://unpkg.com') {
    // Solo con versión completa en la ruta (paquete@1.2.3/...): sin ella el contenido puede cambiar.
    return /^\/[^/@]+@\d+\.\d+\.\d+[^/]*\//.test(u.pathname) ? 'cdn' : null;
  }
  if (u.origin !== ctx.origen || !u.href.startsWith(ctx.base)) return null;
  const ruta = u.pathname.slice(new URL(ctx.base).pathname.length);
  if (ruta.startsWith('teselas/')) {
    const nombre = ruta.slice('teselas/'.length);
    return Object.prototype.hasOwnProperty.call(ctx.teselas, nombre) ? 'tesela' : null;
  }
  // Lo que el servidor cambia solo (noches frías) y este mismo archivo nunca se guardan.
  if (ruta.startsWith('datos/noches-frias/') || ruta === 'sw.js') return null;
  return 'sitio';
}

// Llave de una tesela: URL del mismo archivo con la huella y el rango. No es un pedido real,
// solo el nombre con que se guarda (el Cache API no acepta respuestas 206).
function claveTesela(urlTexto, huella, rango) {
  const u = new URL(urlTexto);
  return u.origin + u.pathname + '?sw=1&h=' + huella + '&r=' + (rango ? rango.ini + '-' + rango.fin : 'todo');
}

// Llave de una página o archivo del sitio. Las páginas se guardan sin la parte ?...
function claveSitio(urlTexto, esNavegacion) {
  const u = new URL(urlTexto);
  u.hash = '';
  if (esNavegacion) u.search = '';
  return u.href;
}

function partesClave(clave) {
  const u = new URL(clave);
  const r = u.searchParams.get('r') || '';
  const m = /^(\d+)-(\d+)$/.exec(r);
  return {
    nombre: u.pathname.slice(u.pathname.lastIndexOf('/') + 1),
    huella: u.searchParams.get('h') || '',
    ini: m ? Number(m[1]) : null,
    bytes: m ? Number(m[2]) - Number(m[1]) + 1 : TAM_ARCHIVO_ENTERO
  };
}

// Una tesela guardada ya no sirve si su archivo cambió de huella o ya no se publica.
function esObsoleta(clave, teselas) {
  const p = partesClave(clave);
  return teselas[p.nombre] !== p.huella;
}

// Qué borrar para quedar bajo el tope. Las llaves vienen de la más vieja a la más nueva.
// Lo que empieza en el byte 0 (cabecera y directorio raíz de cada archivo) no se borra: se
// pide en cada arranque y pesa poco.
function planRecorte(claves, limite) {
  const info = claves.map((k) => ({ k, ...partesClave(k) }));
  let total = info.reduce((a, x) => a + x.bytes, 0);
  const borrar = [];
  for (const x of info) {
    if (total <= limite) break;
    if (x.ini === 0) continue;
    borrar.push(x.k);
    total -= x.bytes;
  }
  return { borrar, total };
}

// Qué cachés borrar al activar: los de otra versión de despliegue. Los de teselas y cdn se quedan.
function cachesViejos(nombres, version) {
  const buenos = new Set([CACHE_TESELAS, CACHE_CDN, cacheSitio(version)]);
  return nombres.filter((n) => n.startsWith(PREFIJO) && !buenos.has(n));
}

// Una respuesta 206 armada desde lo guardado.
function aRespuesta206(guardada, ini, cuerpo) {
  const total = guardada.headers.get('x-sw-total');
  const fin = ini + cuerpo.byteLength - 1;
  const h = new Headers();
  h.set('Content-Range', 'bytes ' + ini + '-' + fin + '/' + total);
  h.set('Content-Length', String(cuerpo.byteLength));
  h.set('Accept-Ranges', 'bytes');
  const tipo = guardada.headers.get('content-type'); if (tipo) h.set('Content-Type', tipo);
  const etag = guardada.headers.get('x-sw-etag'); if (etag) h.set('ETag', etag);
  return new Response(cuerpo, { status: 206, statusText: 'Partial Content', headers: h });
}

// Lo que index.html carga al arrancar: scripts y hojas de estilo (y el icono). Devuelve, por
// cada uno, su URL completa y el integrity si lo trae. Sirve para llenar el caché al instalar.
function recursosDeArranque(html, base) {
  const salida = [];
  for (const tag of String(html).match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const esLink = /^<link/i.test(tag);
    if (esLink && !/\brel="(?:stylesheet|icon)"/i.test(tag)) continue;
    const m = /\b(?:src|href)="([^"]+)"/i.exec(tag);
    if (!m) continue;
    let url;
    try { url = new URL(m[1], base).href; } catch (e) { continue; }
    const i = /\bintegrity="([^"]+)"/i.exec(tag);
    salida.push({ url, integrity: i ? i[1] : null });
  }
  return salida;
}

// ---------- Con efectos (caché y red) ----------

// ctx: { caches, fetch, origen, base, teselas, version, esperar(promesa) }
async function atenderTesela(req, ctx) {
  const cabRango = req.headers.get('range');
  const rango = rangoDe(cabRango);
  if (cabRango && !rango) return ctx.fetch(req);
  const huella = ctx.teselas[partesClave(req.url.split('?')[0]).nombre];
  const clave = claveTesela(req.url, huella, rango);
  const cache = await ctx.caches.open(CACHE_TESELAS);
  // Tras un despliegue Pages cambia el ETag aunque el archivo sea igual; pmtiles reintenta con
  // cache:'reload' y ahí hay que ir a la red y reemplazar la copia (si no, EtagMismatch y mapa vacío).
  // Solo 'reload': Chrome en Windows manda 'no-store' siempre.
  const guardada = req.cache === 'reload' ? null : await cache.match(clave);
  if (guardada) {
    if (!rango) return guardada;
    return aRespuesta206(guardada, rango.ini, await guardada.arrayBuffer());
  }
  const r = await ctx.fetch(req);
  const valida = rango
    ? r.status === 206 && (contentRange(r.headers.get('content-range')) || {}).ini === rango.ini
    : r.status === 200;
  const largo = Number(r.headers.get('content-length'));
  if (valida && (!largo || largo <= MAX_ENTRADA)) {
    const copia = r.clone();
    ctx.esperar(guardarTesela(cache, clave, copia, rango, ctx));
  }
  return r;
}

let guardadas = 0;
async function guardarTesela(cache, clave, r, rango, ctx) {
  const cuerpo = await r.arrayBuffer();
  if (cuerpo.byteLength > MAX_ENTRADA) return;
  const h = new Headers();
  const tipo = r.headers.get('content-type'); if (tipo) h.set('content-type', tipo);
  const etag = r.headers.get('etag'); if (etag) h.set('x-sw-etag', etag);
  const cr = rango ? contentRange(r.headers.get('content-range')) : null;
  h.set('x-sw-total', String(cr ? cr.total : cuerpo.byteLength));
  await cache.put(clave, new Response(cuerpo, { status: 200, headers: h }));
  if (++guardadas % CADA_CUANTOS_RECORTES === 0) await recortar(cache);
}

async function recortar(cache) {
  const claves = (await cache.keys()).map((k) => k.url);
  const { borrar } = planRecorte(claves, LIMITE_TESELAS);
  await Promise.all(borrar.map((k) => cache.delete(k)));
}

async function atenderCdn(req, ctx) {
  const cache = await ctx.caches.open(CACHE_CDN);
  const guardada = await cache.match(req.url);
  if (guardada) return guardada;
  const r = await ctx.fetch(req);
  if (r.ok && r.status === 200 && r.type === 'cors') ctx.esperar(cache.put(req.url, r.clone()));
  return r;
}

async function atenderSitio(req, ctx) {
  const cache = await ctx.caches.open(cacheSitio(ctx.version));
  const clave = claveSitio(req.url, req.mode === 'navigate');
  const guardada = await cache.match(clave);
  if (guardada) return guardada;
  // Al llenar el caché se pregunta al servidor (no-cache): un archivo de max-age=600 de la
  // versión anterior no puede entrar a la versión nueva.
  const r = await ctx.fetch(clave, { cache: 'no-cache', credentials: 'same-origin' });
  if (r.status === 200 && r.type === 'basic' && !r.redirected) ctx.esperar(cache.put(clave, r.clone()));
  return r;
}

async function atender(req, tipo, ctx) {
  try {
    if (tipo === 'tesela') return await atenderTesela(req, ctx);
    if (tipo === 'cdn') return await atenderCdn(req, ctx);
    return await atenderSitio(req, ctx);
  } catch (e) {
    // Sin caché (modo privado, disco lleno) o algo raro: como si este archivo no existiera.
    return ctx.fetch(req);
  }
}

// Al instalar: la página de entrada y lo que ella carga al arrancar, para que la segunda visita
// ya lo encuentre guardado (la primera lo pidió antes de que este worker existiera). Todo se
// pregunta al servidor (no-cache), así lo guardado es de esta versión y no una copia vieja de
// max-age=600. Si algo falla se sigue: lo que falte se guarda cuando se pida.
async function precargar(ctx) {
  const sitio = await ctx.caches.open(cacheSitio(ctx.version));
  const inicio = await ctx.fetch(ctx.base, { cache: 'no-cache', credentials: 'same-origin' });
  if (inicio.status !== 200 || inicio.redirected) return;
  const html = await inicio.clone().text();
  await sitio.put(claveSitio(ctx.base, true), inicio);
  const cdn = await ctx.caches.open(CACHE_CDN);
  await Promise.all(recursosDeArranque(html, ctx.base).map(async (rec) => {
    const tipo = clasificar('GET', rec.url, ctx);
    try {
      if (tipo === 'sitio') {
        const clave = claveSitio(rec.url, false);
        const r = await ctx.fetch(clave, { cache: 'no-cache', credentials: 'same-origin' });
        if (r.status === 200 && r.type === 'basic' && !r.redirected) await sitio.put(clave, r);
      } else if (tipo === 'cdn' && !(await cdn.match(rec.url))) {
        // Igual que la etiqueta de index.html: CORS sin cookies y con su SRI.
        const r = await ctx.fetch(rec.url, { mode: 'cors', credentials: 'omit', integrity: rec.integrity || undefined });
        if (r.status === 200 && r.type === 'cors') await cdn.put(rec.url, r);
      }
    } catch (e) { /* ese archivo se guarda cuando se pida */ }
  }));
}

async function limpiar(ctx) {
  for (const n of cachesViejos(await ctx.caches.keys(), ctx.version)) await ctx.caches.delete(n);
  const cache = await ctx.caches.open(CACHE_TESELAS);
  for (const k of await cache.keys()) if (esObsoleta(k.url, ctx.teselas)) await cache.delete(k);
  await recortar(cache);
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  const contexto = () => ({
    caches: self.caches, fetch: (...a) => self.fetch(...a), origen: self.location.origin,
    base: self.registration.scope, teselas: leerTeselas(TESELAS_SELLO), version: VERSION
  });
  self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
      if (ES_HUELLA.test(VERSION)) await precargar(contexto()).catch(() => {});
      await self.skipWaiting();
    })());
  });
  self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
      if (ES_HUELLA.test(VERSION)) await limpiar(contexto()).catch(() => {});
      await self.clients.claim();
    })());
  });
  self.addEventListener('fetch', (e) => {
    const ctx = contexto();
    const tipo = clasificar(e.request.method, e.request.url, ctx);
    if (!tipo) return; // la red, sin intermediarios
    ctx.esperar = (p) => e.waitUntil(p.catch(() => {}));
    e.respondWith(atender(e.request, tipo, ctx));
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    rangoDe, contentRange, leerTeselas, clasificar, claveTesela, claveSitio, partesClave, esObsoleta,
    planRecorte, cachesViejos, aRespuesta206, recursosDeArranque, atender, precargar, limpiar, cacheSitio,
    CACHE_TESELAS, CACHE_CDN, LIMITE_TESELAS, MAX_ENTRADA
  };
}
