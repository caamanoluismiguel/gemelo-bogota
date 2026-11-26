'use strict';
// Cajas escondidas: cuando otra fuente dibuja un edificio mejor (las partes de OSM, un hito 3D
// modelado a mano), lo que queda debajo se esconde para que no asome ni se vea doble.
//
// Uso, desde cualquier módulo:
//   const C = window.Bogotwin.cajasOcultas;
//   C.agregar('osm', { cerca: [604430, ...], lejos: [49069, ...] });   // o agregar('osm', [ids])
//   C.agregar('hitos:colpatria', { cerca: [...], lejos: [...], osm: ['way/1175248695'] });
//   C.quitar('hitos:colpatria');                                         // vuelven a verse
//
// Qué va en cada lista:
//   cerca: id de la construcción en las teselas z16 de catastro-pisos-bogota.pmtiles (cada
//          construcción; traen la propiedad «tono»).
//   lejos: id en las teselas z14 y z15 (huellas unidas por manzana; sin «tono», con su propia
//          numeración, la misma en los dos zooms porque salen del mismo archivo).
//   osm:   id_osm de las partes de OSM (capa partes-osm-3d), por ejemplo «way/1175248695». Así
//          un hito no queda doble con la pieza que la gente de OSM dibujó en el mismo sitio.
// Las numeraciones de Catastro se pueden cruzar, por eso van aparte. Un arreglo simple cuenta
// como cerca.
//
// Solo cambia el filtro de construcciones-3d y partes-osm-3d. Las sombras (sombras-capa.js) leen
// las teselas por su cuenta, así que una caja escondida sigue haciendo sombra. La capa de lejos
// (construcciones-lejos-3d, z12 y z13, otro archivo) no se toca.
(function (raiz) {
  const CAPA = 'construcciones-3d';
  const CAPA_OSM = 'partes-osm-3d';
  const origenes = new Map();   // origen → { cerca: Set, lejos: Set, osm: Set }
  let mapa = null;

  const aLista = (v) => (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);
  const aTextos = (v) => (Array.isArray(v) ? v : []).filter((s) => typeof s === 'string' && s);

  function agregar(origen, ids) {
    const o = Array.isArray(ids) ? { cerca: ids } : (ids || {});
    origenes.set(String(origen), { cerca: new Set(aLista(o.cerca)), lejos: new Set(aLista(o.lejos)), osm: new Set(aTextos(o.osm)) });
    aplicar();
  }

  function quitar(origen) {
    if (origenes.delete(String(origen))) aplicar();
  }

  function juntar(k) {
    const s = new Set();
    for (const o of origenes.values()) for (const id of o[k]) s.add(id);
    return k === 'osm' ? [...s].sort() : [...s].sort((a, b) => a - b);
  }

  // El filtro para la capa de Catastro, o null si no hay nada que esconder. «match» busca en una
  // tabla, no recorre la lista: con miles de ids no pesa por construcción.
  function filtro() {
    const cerca = juntar('cerca'), lejos = juntar('lejos');
    if (!cerca.length && !lejos.length) return null;
    const id = ['to-number', ['id'], -1];
    const uno = (ids) => (ids.length ? ['match', id, ids, false, true] : true);
    return ['case', ['has', 'tono'], uno(cerca), uno(lejos)];
  }

  // El filtro para las partes de OSM, o null.
  function filtroOsm() {
    const osm = juntar('osm');
    return osm.length ? ['match', ['to-string', ['get', 'id_osm']], osm, false, true] : null;
  }

  // Pone los filtros en las capas que ya existan. mapa.js y partes-osm.js lo llaman después de
  // crear su capa; agregar y quitar lo llaman con el último mapa conocido.
  function aplicar(m) {
    if (m) mapa = m;
    if (!mapa && raiz && raiz.Bogotwin && raiz.Bogotwin.mapaApi) mapa = raiz.Bogotwin.mapaApi.mapa || null;
    if (!mapa || !mapa.getLayer) return;
    if (mapa.getLayer(CAPA)) mapa.setFilter(CAPA, filtro());
    if (mapa.getLayer(CAPA_OSM)) mapa.setFilter(CAPA_OSM, filtroOsm());
  }

  function cuantas() { return { cerca: juntar('cerca').length, lejos: juntar('lejos').length, osm: juntar('osm').length, origenes: [...origenes.keys()] }; }
  function lista() { return [...origenes.keys()]; }

  const api = { agregar, quitar, filtro, filtroOsm, aplicar, cuantas, origenes: lista, CAPA, CAPA_OSM };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.cajasOcultas = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
