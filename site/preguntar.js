'use strict';
// «Pregúntale a la ciudad»: la caja de preguntas de la cabecera. Este archivo es chico y solo
// arma la caja; la lógica (preguntar-logica.js) y los datos bajan la primera vez que alguien
// pregunta o toca la caja. Las respuestas salen de nuestros JSON, con su marca, su hora y su fuente.
(function () {
  const B = window.Bogotwin;
  const $ = (id) => document.getElementById(id);
  const forma = $('preguntar'), caja = $('pregunta'), salida = $('respuesta'), chips = $('preguntas-chips');
  if (!B || !forma || !caja || !salida || !chips) return;
  const movil = matchMedia('(max-width: 600px)');
  const el = B.el;

  // ── Carga perezosa ──
  const bajarJs = (f) => new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = f; s.onload = ok; s.onerror = () => mal(new Error(f));
    document.head.append(s);
  });
  const una = (fn) => { let p = null; return () => p || (p = fn().catch((e) => { p = null; throw e; })); };
  const json = (url) => fetch(url, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  const logica = una(() => (B.preguntar ? Promise.resolve() : bajarJs('preguntar-logica.js')));
  const vivo = una(() => (B.vivo ? Promise.resolve() : bajarJs('vivo-datos.js')));
  const aireAnual = una(() => (B.aireAnualDatos ? Promise.resolve() : bajarJs('aire-anual-datos.js')));
  const mvt = una(() => (B.mvt ? Promise.resolve() : bajarJs('mvt.js')));
  const indice = una(() => json('datos/buscador.json').then((j) => B.preguntar.prepararIndice(j.filas)));
  const troncales = una(() => json('datos/transporte/troncales.geojson').then((j) => j.features
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => ({ nombre: f.properties.nombre, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))));
  const pm25 = una(() => json('datos/aire/pm25-anual-2025.geojson'));
  const colegios = una(() => json('datos/aire/colegios-sed.geojson'));
  // Lo vivo se pide de nuevo en cada pregunta (el ?t= cambia cada 5 min y el navegador guarda el resto).
  const vivoJson = (f) => vivo().then(() => json(B.vivo.url(f)));
  const noches = () => json('datos/noches-frias/ultima.json').catch(() => null);
  const cielo = () => (B.ultimoCielo ? Promise.resolve(B.ultimoCielo) : vivoJson('cielo/ahora.json').catch(() => null));
  // El aire lo baja pronostico.js una sola vez para todo el visor; aquí se espera su aviso.
  const aire = () => (B.aire ? Promise.resolve(B.aire.datos) : new Promise((ok) => {
    const t = setTimeout(() => ok(null), 10000);
    addEventListener('bogotwin:aire', () => { clearTimeout(t); ok(B.aire ? B.aire.datos : null); }, { once: true });
  }));
  const pron = () => vivoJson('pronostico/ahora.json').catch(() => null);
  const intento = (p) => p.catch(() => null);

  // Teselas: límites (para saber qué cae dentro de una localidad o UPL) y pisos de Catastro.
  let pmLim = null;
  const archivoLim = () => pmLim || (pmLim = new pmtiles.PMTiles(new B.red.FuenteReintento(new pmtiles.FetchSource(B.mapaApi.teselaUrl('limites-bogota.pmtiles')))));
  const tesela = (pm, z, x, y) => pm.getZxy(z, x, y).then((r) => (r && r.data ? new Uint8Array(r.data) : null)).catch(() => null);
  const BOGOTA = [-74.45, 3.73, -73.99, 4.84];
  // Objetos de una capa en lon y lat, de todas las teselas z que cubren la caja.
  async function capa(pm, z, bbox, nombre) {
    await mvt();
    const P = B.preguntar;
    const ts = P.teselasDe(bbox, z);
    const out = [];
    const bytes = await Promise.all(ts.map(([tz, x, y]) => tesela(pm, tz, x, y)));
    ts.forEach(([tz, x, y], i) => {
      const c = bytes[i] && bytes[i].length ? B.mvt.leerCapa(bytes[i], nombre) : null;
      if (c) for (const o of c.objetos) out.push(Object.assign({}, o.propiedades, { anillos: P.anillosALonLat(tz, x, y, c.extension, o.anillos) }));
    });
    return out;
  }
  // Polígono de una localidad o UPL. Los barrios y sectores se quedan con su caja.
  async function conPoligono(lugar) {
    if (!lugar || (lugar.nivel !== 'localidad' && lugar.nivel !== 'upl')) return lugar;
    try {
      const lista = await capa(archivoLim(), 10, lugar.bbox, lugar.nivel === 'upl' ? 'upl' : 'localidades');
      const n = B.preguntar.normalizar;
      const piezas = lista.filter((o) => n(o.nombre) === lugar.clave);
      if (piezas.length) return Object.assign({}, lugar, { anillos: piezas.flatMap((o) => o.anillos) });
    } catch { /* sin polígono: queda la caja del buscador */ }
    return lugar;
  }

  // ── Armar la respuesta de cada intención ──
  async function responder(texto) {
    await logica();
    const P = B.preguntar;
    const { intencion } = P.detectarIntencion(texto);
    const ahora = Date.now();
    const lugarDe = async () => P.buscarLugar(texto, await indice());
    switch (intencion) {
      case 'lluvia': return P.responderLluvia({ pronostico: await pron(), cielo: await cielo(), ahora });
      case 'frio': { const [p, n] = await Promise.all([pron(), noches()]); return P.responderFrio({ pronostico: p, noches: n, ahora }); }
      case 'temperatura': return P.responderTemperatura({ cielo: await cielo(), ahora });
      case 'uv': return P.responderUV({ cielo: await cielo() });
      case 'sol': return P.responderSol({ sol: B.sol, ahora, texto });
      case 'canal': {
        const j = await intento(vivoJson('canales/ahora.json'));
        let c = null;
        try { c = j ? B.vivo.decodificarCanales(j) : null; } catch { c = null; }
        return P.responderCanales({ canales: c });
      }
      case 'bicis': {
        const [j, lugar] = await Promise.all([intento(vivoJson('bicis/ahora.json')), lugarDe()]);
        let b = null;
        try { b = j ? B.vivo.decodificarBicis(j) : null; } catch { b = null; }
        let punto = null;
        const calle = P.calleEn(texto);
        if (calle) punto = P.puntoDeCalle(calle, await intento(troncales()), b ? b.estaciones : []);
        if (!punto && lugar) punto = { nombre: lugar.nombre, lat: lugar.centro.lat, lon: lugar.centro.lon };
        return conAviso(P.responderBicis({ bicis: b, punto }), texto, punto);
      }
      case 'aire': {
        await aireAnual();
        const [a, fc, lugar] = await Promise.all([aire(), intento(pm25()), lugarDe()]);
        return conAviso(P.responderAire({ aire: a, ahora, lugar, pm25: fc, aa: B.aireAnualDatos }), texto, lugar);
      }
      case 'colegios_aire': {
        await aireAnual();
        const [fc, col, l0] = await Promise.all([intento(pm25()), intento(colegios()), lugarDe()]);
        const lugar = await conPoligono(l0);
        return conAviso(P.responderColegios({ colegios: col, pm25: fc, aa: B.aireAnualDatos, lugar }), texto, lugar);
      }
      case 'edificio_alto': {
        const lugar = await conPoligono(await lugarDe());
        if (!B.mapaApi || !B.mapaApi.pmCat) return P.noSe('edificio_alto', 'El mapa no cargó, así que no puedo leer los pisos de Catastro.');
        const sectores = await capa(B.mapaApi.pmCat, 10, lugar ? lugar.bbox : BOGOTA, 'pisos_sector').catch(() => []);
        const sector = P.sectorMasAlto(sectores, lugar);
        let edificio = null;
        if (sector) {
          // El edificio exacto: teselas z15 del sector (unas pocas; si fueran muchas, basta el sector).
          const bb = P.cajaDe(sector.anillos[0].map((p) => ({ lon: p[0], lat: p[1] })));
          if (bb && P.teselasDe(bb, 15).length <= 9) {
            const cons = await capa(B.mapaApi.pmCat, 15, bb, 'construcciones').catch(() => []);
            edificio = P.edificioEnSector(cons, sector);
          }
        }
        return conAviso(P.responderEdificio({ sector, edificio, lugar }), texto, lugar);
      }
      case 'no_se': return P.responderNoSe(texto);
      default: return P.responderNoSe(texto);
    }
  }
  // Si la pregunta nombra un sitio que no está en el índice, se dice en vez de contestar callado.
  function conAviso(r, texto, lugar) {
    const nombrado = B.preguntar.lugarNombrado(texto);
    if (!lugar && nombrado && r.sabe) r.notas.unshift(`No encontré «${nombrado}» entre las localidades, UPL y barrios; te respondo para toda Bogotá.`);
    return r;
  }

  // ── Pintar ──
  function pintar(r, texto) {
    const cuerpo = [];
    cuerpo.push(el('p', { clase: 'resp-pregunta', texto }));
    for (const b of r.bloques) cuerpo.push(el('p', { clase: 'resp-linea' }, ...b.map((x) => (typeof x === 'string' ? x : B.valor(x.v, x.m)))));
    for (const n of r.notas) cuerpo.push(el('p', { clase: 'nota', texto: n }));
    for (const a of r.acciones) {
      const ck = document.querySelector(a.selector);
      if (!ck || ck.disabled || ck.checked || ck.closest('[hidden]')) continue;
      const bt = el('button', { clase: 'resp-accion', type: 'button', texto: a.texto });
      bt.addEventListener('click', () => { poner(a.selector, true); bt.remove(); });
      cuerpo.push(bt);
    }
    for (const p of r.procedencia) cuerpo.push(B.meta(p));
    const cerrar = el('button', { clase: 'resp-cerrar', type: 'button', 'aria-label': 'Cerrar la respuesta', texto: '×' });
    cerrar.addEventListener('click', () => { ocultar(); caja.focus(); });
    salida.replaceChildren(cerrar, ...cuerpo);
    salida.hidden = false;
    salida.scrollTop = 0;
    pintarChips(r.sugerencias, r.sabe ? 'Pregunta también:' : 'Puedes preguntar:');
    document.body.classList.add('con-respuesta');
    avisarPanel();
  }
  function pintarChips(lista, titulo) {
    if (!lista || !lista.length) { chips.hidden = true; return; }
    const fila = lista.map((q) => {
      const b = el('button', { clase: 'chip', type: 'button', texto: q });
      b.addEventListener('click', () => { caja.value = q; preguntar(q); });
      return b;
    });
    chips.replaceChildren(el('span', { clase: 'chips-titulo', texto: titulo }), ...fila);
    chips.hidden = false;
    avisarPanel();
  }
  function ocultar() {
    salida.hidden = true;
    salida.replaceChildren();
    chips.hidden = true;
    document.body.classList.remove('con-respuesta');
    avisarPanel();
  }
  // La hoja cambió de alto: el mapa y la barra del sol se acomodan (mapa.js escucha este aviso).
  function avisarPanel() {
    const ui = B.panelUi;
    const hoja = ui ? ui.estado.hoja : 'asomada';
    window.dispatchEvent(new CustomEvent('bogotwin:panel', { detail: { plegado: hoja === 'asomada', hoja } }));
  }
  // Las capas que prendió una respuesta se apagan con la siguiente, para que no se amontonen.
  // Las que la persona ya tenía prendidas no se tocan.
  const prendidas = new Set();
  function poner(selector, si) {
    const ck = document.querySelector(selector);
    if (!ck || ck.checked === si || ck.disabled) return false;
    ck.checked = si;
    ck.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function prenderSolo(capas) {
    for (const s of [...prendidas]) {
      if (capas.includes(s)) continue;
      prendidas.delete(s);
      poner(s, false);
    }
    for (const s of capas) if (poner(s, true)) prendidas.add(s);
  }
  function volar(v) {
    const api = B.mapaApi;
    if (!v || !api || !api.mapa) return;
    const panel = $('panel');
    const pad = movil.matches
      ? { top: 24, left: 24, right: 24, bottom: (panel ? panel.offsetHeight : 200) + 24 }
      : { top: 40, bottom: 40, right: 40, left: (panel ? panel.offsetWidth : 360) + 40 };
    try {
      // Una zona entera con la cámara muy inclinada queda casi toda cielo en la franja que deja
      // la hoja: se baja la inclinación, sin subirla si la persona la tenía más plana.
      const pitch = Math.min(api.mapa.getPitch(), movil.matches ? 35 : 50);
      if (v.bbox) api.mapa.fitBounds([[v.bbox[0], v.bbox[1]], [v.bbox[2], v.bbox[3]]], { padding: pad, maxZoom: 16.5, pitch, freezeElevation: true });
      else if (v.centro) api.mapa.flyTo({ center: [v.centro.lon, v.centro.lat], zoom: v.zoom || 14, padding: pad, freezeElevation: true });
    } catch { /* el mapa sin WebGL no vuela; la respuesta igual queda */ }
  }

  let turno = 0;
  async function preguntar(texto) {
    const q = String(texto || '').trim().slice(0, 140);
    if (!q) { pintarChips(B.preguntar ? B.preguntar.SUGERENCIAS : SUGERENCIAS_BASE, 'Puedes preguntar:'); return; }
    const mio = ++turno;
    salida.hidden = false;
    salida.replaceChildren(el('p', { clase: 'estado', texto: 'Buscando en los datos…' }));
    avisarPanel();
    let r;
    try {
      r = await responder(q);
    } catch (e) {
      console.warn('Pregúntale:', e);
      await logica().catch(() => null);
      r = B.preguntar ? B.preguntar.noSe('error', 'No pude bajar los datos para contestarte. Revisa la conexión y vuelve a preguntar.') : null;
    }
    if (mio !== turno) return;
    if (!r) { salida.replaceChildren(el('p', { clase: 'estado', texto: 'No pude cargar las respuestas. Revisa la conexión.' })); return; }
    pintar(r, q);
    prenderSolo(r.capas || []);
    // En el teléfono el teclado tapa el mapa: se cierra para que se vea a dónde vamos.
    if (movil.matches) caja.blur();
    volar(r.vuelo);
  }

  // Los chips de arranque se muestran sin esperar la lógica: son las mismas preguntas.
  const SUGERENCIAS_BASE = ['¿Cómo está el aire en Kennedy?', '¿Va a llover hoy?', '¿Hará frío esta noche?', '¿Cuál es el edificio más alto de Chapinero?',
    '¿Hay algún canal en alerta?', '¿Dónde hay bicis cerca de la 72?', '¿A qué hora sale el sol?', '¿Qué colegios tienen peor aire?'];
  forma.addEventListener('submit', (e) => { e.preventDefault(); preguntar(caja.value); });
  caja.addEventListener('focus', () => {
    logica().catch(() => null);
    if (salida.hidden) pintarChips(SUGERENCIAS_BASE, 'Puedes preguntar:');
  });
  caja.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ocultar(); caja.blur(); } });
  // Al tocar el mapa, los chips sin respuesta se guardan para no tapar.
  document.addEventListener('pointerdown', (e) => {
    if (salida.hidden && !chips.hidden && !forma.contains(e.target) && !chips.contains(e.target)) { chips.hidden = true; avisarPanel(); }
  });
  // ?q= abre con la pregunta hecha, para compartir una respuesta.
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { caja.value = q0.slice(0, 140); addEventListener('load', () => preguntar(caja.value), { once: true }); }
})();
