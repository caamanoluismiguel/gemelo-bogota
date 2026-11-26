'use strict';
// Cajas de Catastro que se esconden porque otra cosa dibuja ese edificio (un hito 3D, por
// ejemplo). Cada quien que tapa algo lo pide con su nombre:
//
//   Bogotwin.cajasOcultas.agregar('hitos:colpatria', { z14: [], z15: [50212], z16: [610071] })
//   Bogotwin.cajasOcultas.quitar('hitos:colpatria')
//
// ids: los ids de tippecanoe de la capa «construcciones» en las teselas de Catastro. Las
// teselas z14 y z15 traen huellas unidas por manzana con otros ids, por eso van por zoom; una
// lista sola se toma como z16 (cada construcción). Los ids cambian si se rehacen las teselas.
//
// Se esconden solo en «construcciones-3d» (la capa de cerca). La luz propia de los edificios
// (edificios-luz.js) dibuja con los mismos búferes de esa capa, así que también deja el hueco.
// La ciudad lejana (z12 y z13) no se toca: de lejos el hito no se dibuja.
(function (raiz) {
  const ZOOMS = ['z14', 'z15', 'z16'];

  function normalizar(ids) {
    const o = Array.isArray(ids) ? { z16: ids } : (ids || {});
    const r = {};
    for (const z of ZOOMS) r[z] = (Array.isArray(o[z]) ? o[z] : []).filter((v) => Number.isFinite(v));
    return r;
  }

  // Une lo pedido por todos: { z14: [...], z15: [...], z16: [...] } sin repetidos.
  function unir(pedidos) {
    const r = {};
    for (const z of ZOOMS) {
      const s = new Set();
      for (const p of pedidos) for (const v of p[z]) s.add(v);
      r[z] = [...s].sort((a, b) => a - b);
    }
    return r;
  }

  // Filtro de MapLibre: por zoom de tesela (step arriba del todo, como pide la especificación),
  // fuera los ids pedidos, y siempre junto con el filtro que la capa ya tenía.
  function filtro(unidos, previo) {
    const fuera = (ids) => (ids.length ? ['!', ['in', ['id'], ['literal', ids]]] : true);
    const conPrevio = (e) => (previo ? (e === true ? previo : ['all', previo, e]) : e);
    if (!ZOOMS.some((z) => unidos[z].length)) return previo || null;
    return ['step', ['zoom'], conPrevio(fuera(unidos.z14)), 15, conPrevio(fuera(unidos.z15)), 16, conPrevio(fuera(unidos.z16))];
  }

  function crear(capas) {
    const lista = capas || ['construcciones-3d'];
    const pedidos = new Map();
    const previos = new Map();   // capa → filtro que tenía antes de esconder nada
    let mapa = null, puesto = new Map();

    function aplicar() {
      if (!mapa) return;
      const unidos = unir([...pedidos.values()]);
      for (const id of lista) {
        if (!mapa.getLayer(id)) continue;
        if (!previos.has(id)) previos.set(id, mapa.getFilter(id) || null);
        const f = filtro(unidos, previos.get(id));
        const clave = JSON.stringify(f);
        if (puesto.get(id) === clave && JSON.stringify(mapa.getFilter(id) || null) === clave) continue;
        mapa.setFilter(id, f);
        puesto.set(id, clave);
        if (!pedidos.size) previos.delete(id);
      }
    }
    // Si alguien rehace la capa (cambio de estilo), se vuelve a poner.
    function alEstilo() { if (pedidos.size) aplicar(); }

    return {
      usar(m) {
        if (mapa === m) return;
        if (mapa) mapa.off('styledata', alEstilo);
        mapa = m; puesto = new Map();
        if (mapa) { mapa.on('styledata', alEstilo); aplicar(); }
      },
      agregar(origen, ids) { pedidos.set(String(origen), normalizar(ids)); aplicar(); },
      quitar(origen) { if (pedidos.delete(String(origen))) aplicar(); },
      ocultos() { return unir([...pedidos.values()]); },
      origenes() { return [...pedidos.keys()]; }
    };
  }

  const puro = { normalizar, unir, filtro, crear, ZOOMS };
  if (typeof module === 'object' && module.exports) { module.exports = puro; return; }

  const B = raiz.Bogotwin = raiz.Bogotwin || {};
  const una = crear();
  // Con el mapa listo (mapa.js deja B.mapaApi), se engancha sola.
  const enganchar = () => { if (B.mapaApi && B.mapaApi.mapa) una.usar(B.mapaApi.mapa); };
  B.cajasOcultas = {
    agregar(origen, ids) { enganchar(); una.agregar(origen, ids); },
    quitar(origen) { enganchar(); una.quitar(origen); },
    ocultos: una.ocultos,
    origenes: una.origenes,
    usar: una.usar,
    filtro, normalizar, unir
  };
})(typeof window !== 'undefined' ? window : globalThis);
