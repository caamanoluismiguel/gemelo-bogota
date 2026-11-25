'use strict';
// Capa de bicicletas compartidas: una columna por estación, alta según las bicis disponibles y
// de color según qué tan llena está. Se baja solo al prender la capa (mapa.js).
(function () {
  const B = window.Bogotwin;
  const V = B.vivo;
  const { el } = B;
  const FUENTE = 'bicis', CAPA = 'bicis';
  // Paleta plana: azules de menos a más ocupación; vacía en naranja y llena en morado para que
  // no dependan solo del tono de azul; gris para lo que no tomamos como dato.
  const COLORES = {
    vacia: '#d9601a', baja: '#9cc5e3', media: '#4a8fc7', alta: '#1d5b99', llena: '#5b2a86',
    dudosa: '#9b9b9b', quieta: '#cfcfcf'
  };
  const LEYENDA = [
    ['vacia', 'Vacía, 0 bicis'], ['baja', 'Menos de un tercio llena'], ['media', 'Entre un tercio y dos tercios'],
    ['alta', 'Más de dos tercios'], ['llena', 'Llena, sin anclajes libres'], ['quieta', 'No presta bicis o no reporta hace más de 1 hora'],
    ['dudosa', 'Dato dudoso: las cuentas no cuadran']
  ];
  const R = 55;            // radio de la columna en metros
  const BASE_M = 20, POR_BICI_M = 10;
  const leyendaCaja = document.getElementById('bicis-leyenda');

  let datos = null, mapaRef = null, reloj = null, encendida = false, popup = null;
  let serie = null, serieHora = 0, serieBajando = null;

  function octagono(lon, lat) {
    const dLat = R / 111320, dLon = R / (111320 * Math.cos(lat * Math.PI / 180));
    const anillo = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i % 8) * Math.PI / 4 + Math.PI / 8;
      anillo.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return [anillo];
  }
  const altoDe = (e) => (e.cat === 'dudosa' || e.cat === 'quieta' || !e.bicis) ? BASE_M : BASE_M + POR_BICI_M * e.bicis;

  function geojson(d) {
    return { type: 'FeatureCollection', features: d.estaciones.map((e, i) => ({
      type: 'Feature', id: i, geometry: { type: 'Polygon', coordinates: octagono(e.lon, e.lat) },
      properties: { i, cat: e.cat, alto: altoDe(e) } })) };
  }

  function pintarLeyenda(d) {
    if (!leyendaCaja) return;
    const t = d.totales || {};
    const filas = el('ul', { clase: 'bicis-ley' });
    for (const [cat, texto] of LEYENDA) {
      const n = d.estaciones.filter((e) => e.cat === cat).length;
      const sw = el('span', { clase: 'bicis-sw', 'data-cat': cat });
      sw.style.background = COLORES[cat];
      filas.append(el('li', null, sw, `${texto} (${n})`));
    }
    const lim = V.limiteMin(d.cadencia) || 20;
    leyendaCaja.replaceChildren(
      el('p', { clase: 'nota' }, B.horaYEdad(d.hora, lim, 'Sin dato reciente'), '. Lo revisamos cerca de cada 10 minutos.'),
      filas,
      el('p', { clase: 'nota', texto: `La altura de cada columna sigue las bicis disponibles${t.bicis != null ? `: ${t.bicis} en total` : ''}. Toca una estación para ver sus números.` +
        (d.fuera ? ` ${d.fuera === 1 ? 'Una estación trae' : d.fuera + ' estaciones traen'} coordenadas fuera de la Sabana y no se dibuja${d.fuera === 1 ? '' : 'n'}.` : '') }),
      B.meta({ tipo: 'de_fuente', licencia: d.fuente && d.fuente.licencia ? { nombre: d.fuente.licencia.nombre, url: d.fuente.licencia.url } : null, fuente: 'sistema de bicicletas compartidas, GBFS' }));
    leyendaCaja.hidden = false;
  }

  function poner(mapa) {
    const fc = geojson(datos);
    if (mapa.getSource(FUENTE)) { mapa.getSource(FUENTE).setData(fc); return; }
    mapa.addSource(FUENTE, { type: 'geojson', data: fc });
    const color = ['match', ['get', 'cat']];
    for (const [k, v] of Object.entries(COLORES)) color.push(k, v);
    color.push('#9b9b9b');
    mapa.addLayer({ id: CAPA, type: 'fill-extrusion', source: FUENTE, metadata: { grupo: 'bicis' },
      paint: { 'fill-extrusion-color': color, 'fill-extrusion-height': ['get', 'alto'], 'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': false } },
      mapa.getLayer('rotulos') ? 'rotulos' : undefined);
    mapa.on('mouseenter', CAPA, () => { mapa.getCanvas().style.cursor = 'pointer'; });
    mapa.on('mouseleave', CAPA, () => { mapa.getCanvas().style.cursor = ''; });
  }

  async function traer() {
    const r = await fetch(V.url('bicis/ahora.json'), { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    return V.decodificarBicis(await r.json());
  }

  async function refrescar() {
    try {
      datos = await traer();
      if (!encendida) return;
      const ir = () => { if (encendida) { poner(mapaRef); pintarLeyenda(datos); } };
      if (mapaRef.isStyleLoaded()) ir(); else mapaRef.once('idle', ir);
    } catch (e) {
      if (leyendaCaja && !datos) {
        leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'No pudimos traer las bicicletas. Revisa la conexión; lo intentamos de nuevo en 10 minutos.' }));
        leyendaCaja.hidden = false;
      }
    }
  }

  function prender(mapa) {
    mapaRef = mapa;
    encendida = true;
    if (mapa.getLayer(CAPA)) mapa.setLayoutProperty(CAPA, 'visibility', 'visible');
    if (leyendaCaja) { leyendaCaja.hidden = false; if (!datos) leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'Trayendo las estaciones…' })); }
    // De cerca las columnas taparían la calle: se aleja a ver varias cuadras.
    if (mapa.getZoom() > 15.5) mapa.easeTo({ zoom: 14, pitch: Math.min(mapa.getPitch(), 60), freezeElevation: true });
    refrescar();
    clearInterval(reloj);
    reloj = setInterval(refrescar, 10 * 60000);
  }
  function apagar(mapa) {
    encendida = false;
    clearInterval(reloj);
    if (mapa.getLayer(CAPA)) mapa.setLayoutProperty(CAPA, 'visibility', 'none');
    if (leyendaCaja) leyendaCaja.hidden = true;
    if (popup) { popup.remove(); popup = null; }
  }

  // Serie de 48 h: se baja la primera vez que se toca una estación y se renueva cada 10 min.
  async function bajarSerie() {
    if (serie && Date.now() - serieHora < 10 * 60000) return serie;
    if (!serieBajando) {
      serieBajando = (async () => {
        const r = await fetch(V.url('bicis/serie-48h.ndjson.gz'), { cache: 'no-cache' });
        if (!r.ok) throw new Error(String(r.status));
        const bytes = await r.arrayBuffer();
        let texto;
        try { texto = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
        catch { texto = new TextDecoder().decode(bytes); }   // por si el servidor ya lo descomprimió
        serie = V.leerNdjson(texto); serieHora = Date.now();
        return serie;
      })().finally(() => { serieBajando = null; });
    }
    return serieBajando;
  }

  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  function lineaChica(puntos, capacidad) {
    // El eje va del primer punto (o de hace 48 h) hasta ahora, para que una serie corta se lea.
    const W = 220, H = 44, ahora = Math.max(Date.now(), puntos[puntos.length - 1][0]), t0 = Math.max(ahora - 48 * 3600000, puntos[0][0]);
    const tope = Math.max(1, capacidad || 0, ...puntos.map((p) => p[1]));
    const x = (t) => 2 + (W - 4) * (t - t0) / Math.max(1, ahora - t0);
    const y = (b) => H - 3 - (H - 6) * b / tope;
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bicis-linea', role: 'img',
      'aria-label': `Bicis disponibles en la serie: entre ${Math.min(...puntos.map((p) => p[1]))} y ${Math.max(...puntos.map((p) => p[1]))}.` });
    s.append(sv('line', { x1: 2, x2: W - 2, y1: H - 3, y2: H - 3, class: 'g-base' }));
    // Una corrida que faltó queda como hueco: la línea se corta si pasan más de 25 min.
    let tramo = [];
    const cerrar = () => { if (tramo.length > 1) s.append(sv('polyline', { points: tramo.join(' '), class: 'g-bicis' })); else if (tramo.length === 1) { const [a, b] = tramo[0].split(','); s.append(sv('circle', { cx: a, cy: b, r: 1.5, class: 'g-bicis-p' })); } tramo = []; };
    puntos.forEach((p, i) => {
      if (i && p[0] - puntos[i - 1][0] > 25 * 60000) cerrar();
      if (p[0] >= t0) tramo.push(`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
    });
    cerrar();
    return s;
  }

  function contenido(e) {
    const caja = el('div', { clase: 'bicis-pop' });
    caja.append(el('div', { clase: 'bicis-nombre', texto: e.nombre }));
    const fila = (k, v) => caja.append(el('div', null, el('b', { texto: k + ': ' }), v == null ? 'sin dato' : String(v)));
    const dias = (m) => m >= 2880 ? `${Math.round(m / 1440)} días` : m >= 120 ? `${Math.round(m / 60)} horas` : `${m} min`;
    if (e.cat === 'dudosa') {
      caja.append(el('p', { clase: 'bicis-aviso', texto: 'Dato dudoso: las cuentas de esta estación no cuadran, así que no la tomamos como dato.' }));
      caja.append(el('p', { clase: 'nota', texto: `Lo que reporta el sistema: ${e.bicis ?? 'sin dato'} bicis y ${e.anclajes_libres ?? 'sin dato'} anclajes libres` +
        (e.capacidad != null ? `, con capacidad para ${e.capacidad}` : '') + (e.min_desde_reporte != null ? `. Su último reporte es de hace ${dias(e.min_desde_reporte)}.` : '.') }));
    } else {
      if (e.cat === 'quieta') caja.append(el('p', { clase: 'bicis-aviso', texto: !e.estado.presta ? 'La estación no está prestando bicis.' : `La estación no reporta hace ${dias(e.min_desde_reporte)}: los números pueden estar viejos.` }));
      fila('Bicis disponibles', e.bicis != null && e.capacidad ? `${e.bicis} de ${e.capacidad} puestos` : e.bicis);
      fila('Eléctricas', e.electricas);
      fila('Anclajes libres', e.anclajes_libres);
      if (e.cat === 'vacia') caja.append(el('p', { clase: 'nota', texto: 'Vacía: no hay bicis para sacar.' }));
      if (e.cat === 'llena') caja.append(el('p', { clase: 'nota', texto: 'Llena: no hay dónde dejar una bici.' }));
    }
    caja.append(el('div', { clase: 'nota' }, B.horaYEdad(datos.hora, V.limiteMin(datos.cadencia) || 20, 'Sin dato reciente')));
    caja.append(B.meta({ tipo: 'de_fuente', licencia: { nombre: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.es' }, fuente: 'GBFS del sistema' }));
    const hueco = el('div', { clase: 'bicis-serie' });
    caja.append(hueco);
    if (e.cat !== 'dudosa') {
      bajarSerie().then((lineas) => {
        const pts = V.serieDe(lineas, e.id, datos.campos);
        if (pts.length < 2) return;
        const min = Math.round((Date.now() - pts[0][0]) / 60000);
        const lapso = min >= 47 * 60 ? 'las últimas 48 horas' : min >= 120 ? `las últimas ${Math.round(min / 60)} horas, desde que empezó la serie` : `los últimos ${Math.max(1, min)} min, desde que empezó la serie`;
        hueco.append(el('div', { clase: 'nota', texto: `Bicis disponibles en ${lapso}: de ${Math.min(...pts.map((p) => p[1]))} a ${Math.max(...pts.map((p) => p[1]))}` }), lineaChica(pts, e.capacidad));
      }).catch(() => {});
    }
    return caja;
  }

  function tocar(ev) {
    if (!encendida || !datos || !mapaRef || !mapaRef.getLayer(CAPA)) return false;
    const p = ev.point;
    const f = mapaRef.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: [CAPA] })[0];
    if (!f) return false;
    const e = datos.estaciones[f.properties.i];
    if (!e) return false;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: '270px' }).setLngLat([e.lon, e.lat]).setDOMContent(contenido(e)).addTo(mapaRef);
    return true;
  }

  B.bicis = { prender, apagar, tocar, COLORES };
})();
