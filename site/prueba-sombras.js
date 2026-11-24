'use strict';
// Página de prueba del paso 8: la capa de sombras sola, con una barra de hora y un
// contador de cuadros por segundo. No es parte del sitio publicado (noindex, sin enlaces).
//
// Parámetros de la dirección (todos opcionales):
//   ?fecha=2026-11-23&hora=07:00  día y hora de Bogotá (por defecto hoy, 12:00)
//   ?sinDedup=1                   control negativo: sin «una sola mano por píxel»
//   ?solofondo=1                  oculta todo menos el fondo y la sombra (prueba de color)
//   ?sintetico=1                  dos construcciones inventadas que se cruzan (con solofondo)
//   ?prueba=1                     guarda el lienzo para leer píxeles (solo pruebas)
(function () {
  const B = window.Bogotwin;
  const q = new URLSearchParams(location.search);
  const prueba = q.has('prueba');
  const sintetico = q.has('sintetico');
  const soloFondo = q.has('solofondo') || sintetico;
  const LAT = 4.627, LON = -74.153; // Kennedy

  // Fecha y hora de Bogotá (UTC−5 fija).
  const hoy = new Date(Date.now() - 5 * 3600e3);
  const fq = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.get('fecha') || '');
  const dia = fq ? [+fq[1], +fq[2], +fq[3]] : [hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, hoy.getUTCDate()];
  const hq = /^(\d{1,2}):(\d{2})$/.exec(q.get('hora') || '');
  const barra = document.getElementById('hora');
  if (hq) barra.value = String(+hq[1] * 60 + +hq[2]);
  document.getElementById('fecha').textContent = dia.map((n) => String(n).padStart(2, '0')).join('-');

  const ARCHIVO = new URL('teselas/catastro-pisos-bogota.pmtiles', location.href).href;
  const OSM = new URL('teselas/osm-bogota.pmtiles', location.href).href;
  const protocolo = new pmtiles.Protocol({ metadata: true });
  const pm = new pmtiles.PMTiles(ARCHIVO);
  protocolo.add(pm);

  let sombras = null;
  // Las teselas z16 de Catastro que baja el mapa se copian para la sombra antes de que
  // MapLibre las pase a su hilo de trabajo (allá el búfer queda inservible).
  const RE = /catastro-pisos-bogota\.pmtiles\/(\d+)\/(\d+)\/(\d+)$/;
  maplibregl.addProtocol('pmtiles', async (params, abort) => {
    const r = await protocolo.tile(params, abort);
    const m = RE.exec(params.url);
    if (m && sombras && r && r.data && !sintetico) sombras.recibir(+m[1], +m[2], +m[3], new Uint8Array(r.data.slice(0)));
    return r;
  });

  const PISOS_COLOR = ['#fbe3cf', '#f7c9a3', '#f2ad7e', '#e98d5e', '#d96a44', '#bd4a33', '#8f2d27'];
  const pasos = ['step', ['to-number', ['get', 'pisos'], 0],
    PISOS_COLOR[0], 2, PISOS_COLOR[1], 3, PISOS_COLOR[2], 4, PISOS_COLOR[3], 6, PISOS_COLOR[4], 10, PISOS_COLOR[5], 20, PISOS_COLOR[6]];
  const oculto = soloFondo ? { visibility: 'none' } : {};
  const estilo = {
    version: 8,
    sources: {
      osm: { type: 'vector', url: 'pmtiles://' + OSM, attribution: '© colaboradores de OpenStreetMap (ODbL)' },
      catastro: { type: 'vector', url: 'pmtiles://' + ARCHIVO, attribution: 'Pisos: UAECD, Datos Abiertos Bogotá (CC BY 4.0)' }
    },
    layers: [
      { id: 'fondo', type: 'background', paint: { 'background-color': '#f4f2ee' } },
      { id: 'verde', type: 'fill', source: 'osm', 'source-layer': 'verde', layout: oculto, paint: { 'fill-color': '#cfe3c4' } },
      { id: 'agua', type: 'fill', source: 'osm', 'source-layer': 'agua', layout: oculto,
        filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#a9cbe6' } },
      { id: 'vias', type: 'line', source: 'osm', 'source-layer': 'vias', layout: Object.assign({ 'line-cap': 'round', 'line-join': 'round' }, oculto),
        paint: { 'line-color': ['match', ['get', 'clase'], 'troncal', '#c9a24a', 'primaria', '#d6b46a', '#ffffff'],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1, 16, 6, 18, 20] } },
      // Opaca: va en la pasada opaca de MapLibre y tapa la sombra sobre su propio techo.
      { id: 'construcciones', type: 'fill', source: 'catastro', 'source-layer': 'construcciones', minzoom: 16,
        layout: soloFondo ? { visibility: 'none' } : {}, paint: { 'fill-color': pasos } }
    ]
  };

  const mapa = new maplibregl.Map({
    container: 'mapa', style: estilo, center: [LON, LAT], zoom: 17, maxZoom: 19, hash: true,
    attributionControl: { compact: true },
    canvasContextAttributes: prueba ? { preserveDrawingBuffer: true } : {}
  });
  window.mapa = mapa;

  // Contador de cuadros por segundo: cuenta los eventos «render» del último segundo.
  const fpsTxt = document.getElementById('fps');
  const estadoTxt = document.getElementById('estado');
  const marcas = [];
  mapa.on('render', () => {
    const t = performance.now();
    marcas.push(t);
    while (marcas.length && t - marcas[0] > 1000) marcas.shift();
  });
  setInterval(() => {
    const t = performance.now();
    while (marcas.length && t - marcas[0] > 1000) marcas.shift();
    fpsTxt.textContent = marcas.length ? marcas.length + ' cuadros/s' : 'quieto';
  }, 250);

  function solA(minutos) {
    const ms = B.sol.desdeBogota(dia[0], dia[1], dia[2], Math.floor(minutos / 60), minutos % 60);
    return B.sol.posicion(ms, LAT, LON);
  }
  function aplicarHora() {
    const m = +barra.value;
    document.getElementById('hora-txt').textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    if (sombras) sombras.fijarSol(solA(m));
  }
  barra.addEventListener('input', aplicarHora);

  mapa.on('load', () => {
    sombras = B.sombrasCapa.crear({ pmtiles: pm, dedup: !q.has('sinDedup'), alActualizar: (e) => {
      estadoTxt.textContent = e.sinWebGL2 ? 'este navegador no tiene WebGL2'
        : e.teselas + ' teselas · ' + Math.round(e.vertices / 1000) + ' mil vértices · ' + (e.bytesGPU / 1048576).toFixed(1) + ' MB';
    } });
    window.sombras = sombras;
    mapa.addLayer(sombras.capa, 'construcciones');
    if (sintetico) armarSintetico();
    aplicarHora();
  });

  // Dos construcciones inventadas en Kennedy: una de 20 pisos y, 30 m al occidente, una
  // de 6. En la mañana y en la tarde la sombra de la alta cae sobre la de la baja.
  function armarSintetico() {
    sombras.soloPrueba();
    const mLat = 1 / 110574, mLon = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
    const cuadro = (cx, cy, lado) => [[[cx - lado / 2 * mLon, cy - lado / 2 * mLat], [cx + lado / 2 * mLon, cy - lado / 2 * mLat],
      [cx + lado / 2 * mLon, cy + lado / 2 * mLat], [cx - lado / 2 * mLon, cy + lado / 2 * mLat]]];
    const n = 2 ** 16;
    const x = Math.floor((LON + 180) / 360 * n);
    const s = Math.sin(LAT * Math.PI / 180);
    const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    sombras.agregarPrueba('sintetico', [
      { anillos: cuadro(LON, LAT, 20), pisos: 20 },
      { anillos: cuadro(LON - 30 * mLon, LAT + 4 * mLat, 16), pisos: 6 },
      { anillos: cuadro(LON + 10 * mLon, LAT - 40 * mLat, 14), pisos: 12 }
    ], 16, x, y);
  }

  // Barrido automático: mueve la hora de 6:30 a 17:30 y vuelve, cada cuadro, durante 10 s.
  window.medir = function (segundos) {
    const dur = (segundos || 10) * 1000;
    return new Promise((listo) => {
      const intervalos = [], msCapa = [];
      let previo = null, t0 = null;
      const alRender = () => {
        const t = performance.now();
        if (previo != null) intervalos.push(t - previo);
        previo = t;
        if (sombras) msCapa.push(sombras.estado.ultimaMsRender);
      };
      mapa.on('render', alRender);
      const paso = (t) => {
        if (t0 == null) t0 = t;
        const f = (t - t0) / dur;
        if (f >= 1) {
          mapa.off('render', alRender);
          const orden = intervalos.slice().sort((a, b) => a - b);
          const media = intervalos.reduce((a, b) => a + b, 0) / Math.max(1, intervalos.length);
          const r = {
            cuadros: intervalos.length + 1,
            fps: +(1000 / media).toFixed(1),
            p95ms: +(orden[Math.floor(orden.length * 0.95)] || 0).toFixed(1),
            msCapaMedia: +(msCapa.reduce((a, b) => a + b, 0) / Math.max(1, msCapa.length)).toFixed(2),
            teselas: sombras ? sombras.estado.teselas : 0,
            dibujadas: sombras ? sombras.estado.dibujadas : 0,
            vertices: sombras ? sombras.estado.vertices : 0
          };
          window.resultadoMedicion = r;
          document.getElementById('resultado').textContent =
            r.fps + ' cuadros/s de media, el 5 % más lento sobre ' + r.p95ms + ' ms; la capa toma ' + r.msCapaMedia + ' ms de CPU por cuadro.';
          return listo(r);
        }
        const tri = f < 0.5 ? f * 2 : 2 - f * 2;
        barra.value = String(Math.round(390 + tri * 660));
        aplicarHora();
        requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    });
  };
  document.getElementById('medir').addEventListener('click', () => {
    document.getElementById('resultado').textContent = 'Midiendo…';
    window.medir(10);
  });

  // Solo pruebas: colores del lienzo en un recuadro, de más a menos frecuente.
  window.histograma = function (x, y, w, h) {
    const c = mapa.getCanvas();
    const lienzo = document.createElement('canvas');
    lienzo.width = c.width; lienzo.height = c.height;
    const g = lienzo.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(x || 0, y || 0, w || c.width, h || c.height).data;
    const cuenta = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      cuenta.set(k, (cuenta.get(k) || 0) + 1);
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ['#' + k.toString(16).padStart(6, '0'), n]);
  };
  window.pixel = function (x, y) {
    const c = mapa.getCanvas();
    const lienzo = document.createElement('canvas');
    lienzo.width = c.width; lienzo.height = c.height;
    const g = lienzo.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(x, y, 1, 1).data;
    return '#' + ((d[0] << 16) | (d[1] << 8) | d[2]).toString(16).padStart(6, '0');
  };
})();
