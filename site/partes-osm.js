'use strict';
// Edificios con forma de OpenStreetMap: las partes (building:part) con alto y base que la gente
// de OSM dibujó a mano, como las dos torres del BD Bacatá sobre su plataforma, la punta de la
// Torre Bancolombia o la cúpula del Planetario. Salen de osm-3d-bogota.pmtiles (scripts/osm3d.sh).
//
// Cada pieza trae: alto y base (metros, lo que se dibuja), alto_total (el alto del edificio en
// OSM), pisos y tono (para el mismo color de fachada que Catastro), techo (forma en OSM),
// pieza («cuerpo» o «techo»: el techo inclinado va en cuatro escalones, aproximado), decision
// (por qué se usa el alto de OSM y no el de Catastro) y, si hace falta, aviso. Los valores de
// Catastro no viajan en este archivo (es ODbL y no se mezcla con CC BY): la comparación pieza
// por pieza queda en el reporte de osm3d.py.
//
// El archivo trae en sus metadatos las cajas de Catastro que quedan debajo («ocultas»); se
// esconden con cajas-ocultas.js. Si el archivo no está o no se puede leer, el mapa sigue como
// antes: no se agrega nada y no se esconde nada.
(function (raiz) {
  const CAPA = 'partes-osm-3d';
  const FUENTE = 'osm-3d';
  const CAPA_TESELA = 'partes';
  const ODBL = { nombre: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' };
  let pm = null, listo = false, pidiendo = null;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const metros = (v) => { const n = num(v); return n === null ? null : (Math.round(n * 10) / 10).toLocaleString('es-CO') + ' m'; };

  // Filas de la ventana al tocar una pieza: [rótulo, valor, tipo] con tipo «de_fuente», «inferido»
  // o «supuesto» (B.marca). Se separa para poder probarla sin mapa.
  function filas(p) {
    p = p || {};
    const out = [];
    out.push(['Edificio', p.nombre ? String(p.nombre) : 'sin nombre en OSM', null]);
    const total = metros(p.alto_total);
    if (total) {
      if (p.fuente_alto === 'height') out.push(['Alto en OSM', total, 'de_fuente']);
      else out.push(['Alto dibujado', total + ' (pisos de OSM × 3 m' + (p.fuente_alto === 'niveles+techo' ? ' más el techo' : '') + ')', 'supuesto']);
    }
    const base = num(p.base_osm);
    if (base && base > 0) out.push(['Empieza a', metros(base) + ' del piso' + (p.fuente_base === 'min_level' ? ' (pisos de OSM × 3 m)' : ''), p.fuente_base === 'min_level' ? 'supuesto' : 'de_fuente']);
    if (p.techo && p.techo !== 'flat') out.push(['Techo', NOMBRE_TECHO[p.techo] || String(p.techo), p.pieza === 'techo' || p.techo_supuesto ? 'supuesto' : 'de_fuente']);
    const dec = TEXTO_DECISION[p.decision];
    if (dec) out.push(['Por qué este alto', dec, null]);
    if (p.aviso) out.push(['Ojo', String(p.aviso), null]);
    return out;
  }
  const NOMBRE_TECHO = { hipped: 'a cuatro aguas', gabled: 'a dos aguas', skillion: 'a un agua', round: 'redondo',
    pyramidal: 'en pirámide', mansard: 'mansarda', dome: 'cúpula', onion: 'cúpula de bulbo', gambrel: 'holandés',
    'half-hipped': 'a cuatro aguas recortado', cone: 'cono' };
  const TEXTO_DECISION = {
    osm: 'OSM y Catastro dicen casi lo mismo',
    'osm-coherente': 'OSM y Catastro no coinciden; el de OSM cuadra con sus pisos',
    'osm-conjunto': 'es parte de un edificio armado en OSM pieza por pieza',
    'osm-sin-catastro': 'Catastro no tiene construcción aquí'
  };

  // Lo que necesitan las sombras (sombras-capa.js): el archivo abierto, cuando ya se leyó bien.
  function paraSombras() { return listo && pm ? { pmtiles: pm, capa: CAPA_TESELA } : null; }

  // op: { pmtiles (la librería), protocolo, href (dirección del archivo), color (expresión),
  //   alto (no se usa: el alto viene en la tesela), antes (capa de arriba), visible() }
  // Devuelve una promesa que se cumple con true si la capa quedó puesta.
  function poner(mapa, op) {
    const B = raiz.Bogotwin;
    if (mapa.getLayer(CAPA)) return Promise.resolve(true);
    if (!pidiendo) {
      pm = B.red.abrir(op.pmtiles, op.protocolo, op.href);
      pidiendo = pm.getMetadata().then((meta) => {
        const ocultas = leerOcultas(meta);
        listo = true;
        return ocultas;
      }).catch((e) => { pidiendo = null; pm = null; throw e; });
    }
    return pidiendo.then((ocultas) => {
      if (mapa.getLayer(CAPA)) return true;
      if (!mapa.getSource(FUENTE)) mapa.addSource(FUENTE, { type: 'vector', url: 'pmtiles://' + op.href, attribution: op.attribution });
      const antes = op.antes && mapa.getLayer(op.antes) ? op.antes : undefined;
      mapa.addLayer({ id: CAPA, type: 'fill-extrusion', source: FUENTE, 'source-layer': CAPA_TESELA, minzoom: 14,
        layout: { visibility: !op.visible || op.visible() ? 'visible' : 'none' },
        paint: { 'fill-extrusion-color': op.color, 'fill-extrusion-height': ['to-number', ['get', 'alto'], 0],
          'fill-extrusion-base': ['to-number', ['get', 'base'], 0], 'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': false } }, antes);
      const C = B.cajasOcultas;
      if (C) { C.agregar('osm', ocultas); C.aplicar(mapa); }
      return true;
    }).catch((e) => { console.warn('Edificios de OSM apagados:', e && e.message || e); return false; });
  }

  // Los ids de Catastro que se esconden, de los metadatos del archivo. Acepta el texto JSON o
  // el objeto; si falta o viene mal, no se esconde nada.
  function leerOcultas(meta) {
    let o = meta && meta.ocultas;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
    const lista = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);
    return { cerca: lista(o && o.cerca), lejos: lista(o && o.lejos) };
  }

  const api = { poner, paraSombras, filas, leerOcultas, CAPA, FUENTE, ODBL };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.partesOsm = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
