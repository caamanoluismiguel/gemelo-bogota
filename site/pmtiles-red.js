'use strict';
// Red de las teselas PMTiles: reintentos ante fallas pasajeras y la foto urbana partida en franjas.
(function (raiz) {
  // GitHub Pages a veces responde 503 a un pedido por partes, sobre todo en frío. Antes eso
  // dejaba un hueco en el mapa hasta recargar. Ahora cada pedido se repite hasta dos veces,
  // con espera creciente (0,4 s y 1,2 s), si la red falló o el servidor respondió 5xx. Un 4xx,
  // un pedido cancelado o una huella (ETag) que no coincide no se repiten: no se arreglan solos.
  const REINTENTOS = 2;
  const ESPERAS_MS = [400, 1200];

  function reintentable(e) {
    if (!e || e.name === 'AbortError') return false;
    if (e instanceof TypeError) return true;   // fetch: red caída, conexión cortada
    return /Bad response code: 5\d\d\b/.test(String(e.message || ''));
  }

  function esperar(ms, senal) {
    return new Promise((ok, mal) => {
      if (senal && senal.aborted) { mal(senal.reason || new DOMException('Cancelado', 'AbortError')); return; }
      const t = setTimeout(() => { if (senal) senal.removeEventListener('abort', alCancelar); ok(); }, ms);
      function alCancelar() { clearTimeout(t); mal(senal.reason || new DOMException('Cancelado', 'AbortError')); }
      if (senal) senal.addEventListener('abort', alCancelar, { once: true });
    });
  }

  // Envuelve cualquier fuente de PMTiles (getKey y getBytes, como FetchSource) con los reintentos.
  class FuenteReintento {
    constructor(interna, opciones) {
      this.interna = interna;
      this.esperas = (opciones && opciones.esperas) || ESPERAS_MS;
    }
    getKey() { return this.interna.getKey(); }
    async getBytes(desde, largo, senal, etag) {
      for (let intento = 0; ; intento++) {
        try {
          return await this.interna.getBytes(desde, largo, senal, etag);
        } catch (e) {
          if (intento >= REINTENTOS || !reintentable(e) || (senal && senal.aborted)) throw e;
          await esperar(this.esperas[intento], senal);
        }
      }
    }
  }

  // La ortoimagen urbana (z16 a z18) va en ocho archivos de menos de 60 MB, de norte a sur, en
  // vez de uno de 420 MB que Pages servía con 503. Cada franja es un rango de filas z16; una
  // tesela z17 o z18 va a la franja de su fila z16, así cada tesela está en un solo archivo.
  // Las mismas filas que mapa-base/scripts/orto_partir.py (primera fila de cada franja y, al
  // final, la siguiente a la última).
  const FRANJAS_URBANA = [31886, 31901, 31908, 31914, 31920, 31925, 31930, 31938, 31951];
  const URBANA = 'orto-urbana-bogota';

  // Número de franja (1 a 8) de una tesela z16 a z18, o 0 si cae fuera de la foto.
  function franjaUrbana(z, x, y) {
    if (z < 16 || z > 18) return 0;
    const f = y >> (z - 16);
    for (let i = 0; i < FRANJAS_URBANA.length - 1; i++) if (f >= FRANJAS_URBANA[i] && f < FRANJAS_URBANA[i + 1]) return i + 1;
    return 0;
  }

  // La fuente del mapa pide «orto-urbana-bogota-N.pmtiles/z/x/y»; aquí la N se cambia por la
  // franja. Devuelve la dirección real, la misma si no es de la urbana, o null si cae fuera.
  const RE_URBANA = new RegExp(URBANA + '-N\\.pmtiles/(\\d+)/(\\d+)/(\\d+)');
  function rutaUrbana(url) {
    const m = RE_URBANA.exec(url);
    if (!m) return url;
    const n = franjaUrbana(+m[1], +m[2], +m[3]);
    return n ? url.replace(URBANA + '-N.pmtiles/', URBANA + '-' + n + '.pmtiles/') : null;
  }

  // Archivo PMTiles de una dirección del protocolo (pmtiles://archivo o pmtiles://archivo/z/x/y).
  function archivoDe(url) {
    const m = /^pmtiles:\/\/(.+?\.pmtiles)(?:\/\d+\/\d+\/\d+.*)?$/.exec(url);
    return m ? m[1] : null;
  }

  // Abre un archivo con reintentos y lo deja en el protocolo, una sola vez por archivo.
  function abrir(pm, protocolo, href) {
    let a = protocolo.get(href);
    if (!a) { a = new pm.PMTiles(new FuenteReintento(new pm.FetchSource(href))); protocolo.add(a); }
    return a;
  }

  const api = { FuenteReintento, reintentable, franjaUrbana, rutaUrbana, archivoDe, abrir, FRANJAS_URBANA, REINTENTOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.red = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
