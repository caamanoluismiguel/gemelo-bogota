'use strict';
// Cajas de Catastro escondidas: cuando otra fuente dibuja un edificio mejor (las partes de OSM,
// un hito modelado a mano), la caja de Catastro que queda debajo se esconde para que no asome.
//
// Uso, desde cualquier módulo:
//   const C = window.Bogotwin.cajasOcultas;
//   C.agregar('osm', { cerca: [604430, ...], lejos: [49069, ...] });   // o agregar('osm', [ids])
//   C.quitar('osm');                                                     // vuelven a verse
//
// Qué id va en cada lista: el id de la construcción en las teselas de catastro-pisos-bogota.pmtiles.
//   cerca: teselas z16 (cada construcción; traen la propiedad «tono»).
//   lejos: teselas z14 y z15 (huellas unidas por manzana; sin «tono», con su propia numeración).
// Las dos numeraciones se pueden cruzar, por eso van aparte. Un arreglo simple cuenta como cerca.
//
// Solo cambia el filtro de la capa construcciones-3d. Las sombras (sombras-capa.js) leen las
// teselas por su cuenta, así que una caja escondida sigue haciendo sombra. La capa de lejos
// (construcciones-lejos-3d, z12 y z13, otro archivo) no se toca.
(function (raiz) {
  const CAPA = 'construcciones-3d';
  const origenes = new Map();   // origen → { cerca: Set, lejos: Set }
  let mapa = null;

  const aLista = (v) => (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);

  function agregar(origen, ids) {
    const o = Array.isArray(ids) ? { cerca: ids } : (ids || {});
    origenes.set(String(origen), { cerca: new Set(aLista(o.cerca)), lejos: new Set(aLista(o.lejos)) });
    aplicar();
  }

  function quitar(origen) {
    if (origenes.delete(String(origen))) aplicar();
  }

  function juntar(k) {
    const s = new Set();
    for (const o of origenes.values()) for (const id of o[k]) s.add(id);
    return [...s].sort((a, b) => a - b);
  }

  // El filtro para la capa, o null si no hay nada que esconder. «match» busca en una tabla, no
  // recorre la lista: con miles de ids no pesa por construcción.
  function filtro() {
    const cerca = juntar('cerca'), lejos = juntar('lejos');
    if (!cerca.length && !lejos.length) return null;
    const id = ['to-number', ['id'], -1];
    const uno = (ids) => (ids.length ? ['match', id, ids, false, true] : true);
    return ['case', ['has', 'tono'], uno(cerca), uno(lejos)];
  }

  // Pone el filtro en la capa si ya existe. mapa.js lo llama después de crear la capa.
  function aplicar(m) {
    if (m) mapa = m;
    if (mapa && mapa.getLayer && mapa.getLayer(CAPA)) mapa.setFilter(CAPA, filtro());
  }

  function cuantas() { return { cerca: juntar('cerca').length, lejos: juntar('lejos').length, origenes: [...origenes.keys()] }; }

  const api = { agregar, quitar, filtro, aplicar, cuantas, CAPA };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.cajasOcultas = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
