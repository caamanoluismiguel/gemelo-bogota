'use strict';
// Buses troncales programados por hora en cada tramo de TransMilenio. Sale del GTFS estático
// (pipelines/frecuencia), no de los buses en la calle: se rotula «programado» y nunca se presenta como lo que pasa ahora.
// Lee primero el repo vivo; si allí todavía no está, la copia que viene con el sitio.
// Se baja solo al prender la capa (mapa.js).
(function () {
  const B = window.Bogotwin;
  const V = B.vivo;
  const FUENTE = 'frecuencia', CAPA = 'frecuencia', ESQUEMA = 'bogotwin/troncal-frecuencia/1';
  const COPIA = 'datos/transporte/troncal-frecuencia.json';
  const TIPOS = ['habil', 'sabado', 'domingo'];
  const NOMBRE_TIPO = { habil: 'Día hábil', sabado: 'Sábado', domingo: 'Domingo o festivo' };
  const CORTO_TIPO = { habil: 'Hábil', sabado: 'Sábado', domingo: 'Domingo y festivo' };
  // Pasos planos, sin degradado: de pocos buses (claro) a muchos (oscuro). Buses por hora,
  // sumando los dos sentidos.
  const PASOS = [
    [1, '#fde3ae', '1 a 29'], [30, '#f6b26b', '30 a 59'], [60, '#e9803f', '60 a 119'],
    [120, '#cc4a2f', '120 a 239'], [240, '#952033', '240 a 399'], [400, '#55112f', '400 o más']
  ];
  const SIN = '#bdbdbd';

  // ── Cálculo puro (probado en pruebas/frecuencia.prueba.js) ──
  function decodificar(doc) {
    if (!doc || doc.esquema !== ESQUEMA || !Array.isArray(doc.tramos) || !Array.isArray(doc.estaciones)) throw new Error('esquema');
    const largo = (s) => Array.isArray(s) && s.length === 24;
    for (const t of doc.tramos) {
      if (!Number.isInteger(t.a) || !Number.isInteger(t.b) || !doc.estaciones[t.a] || !doc.estaciones[t.b]) throw new Error('tramo');
      if (!TIPOS.every((k) => t.f && largo(t.f[k]))) throw new Error('serie');
    }
    return doc;
  }
  // Tipo de día para una fecha de Bogotá: domingo y festivo van juntos, como en la programación.
  function tipoDia(ymd, diaSemana, festivos) {
    if (diaSemana === 0 || (festivos || []).includes(ymd)) return 'domingo';
    return diaSemana === 6 ? 'sabado' : 'habil';
  }
  function color(v) {
    let c = SIN;
    for (const [desde, col] of PASOS) if (v >= desde) c = col;
    return c;
  }
  // Serie de 24 horas sumada para varios tramos que van por la misma vía.
  function suma(d, idx, tipo) {
    const s = new Array(24).fill(0);
    for (const i of idx) d.tramos[i].f[tipo].forEach((v, h) => { s[h] += v; });
    return s;
  }
  // Los más cargados se dibujan al final, encima: donde dos tramos comparten vía se ve el mayor.
  function geojson(d, tipo, hora) {
    const feats = d.tramos.map((t, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.c },
      properties: { i, v: t.f[tipo][hora], col: color(t.f[tipo][hora]) } }));
    feats.sort((a, b) => a.properties.v - b.properties.v);
    return { type: 'FeatureCollection', features: feats };
  }
  // Fecha, día de la semana y hora en Bogotá, sin depender de la zona del teléfono.
  function enBogota(ms) {
    const b = new Date(ms - 5 * 3600000);
    const ymd = b.toISOString().slice(0, 10);
    return { ymd, diaSemana: b.getUTCDay(), hora: b.getUTCHours() };
  }
  const calc = { decodificar, tipoDia, color, suma, geojson, enBogota, PASOS, TIPOS };

  // ── Capa ──
  const el = B.el;
  const LICENCIA_DEF = { nombre: 'CC BY‑SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' };
  const caja = () => document.getElementById('frecuencia-leyenda');
  const horaTexto = (h) => new Date(Date.UTC(2026, 0, 1, h + 5)).toLocaleTimeString('es-CO', { hour: 'numeric', timeZone: 'America/Bogota' });
  const entero = new Intl.NumberFormat('es-CO');

  let datos = null, mapaRef = null, encendida = false, popup = null, reloj = null, origen = null;
  const estado = { sigue: true, tipo: 'habil', hora: 8 };

  // Mientras sigue el reloj: la hora de la barra del sol si está prendida, o la de ahora.
  function momento() {
    const sb = B.solBarra && B.solBarra.estado;
    if (sb && sb.activo && !sb.ahora) {
      const ymd = `${sb.anio}-${String(sb.mes).padStart(2, '0')}-${String(sb.dia).padStart(2, '0')}`;
      return { ymd, diaSemana: new Date(Date.UTC(sb.anio, sb.mes - 1, sb.dia)).getUTCDay(), hora: Math.floor(sb.min / 60) % 24, barra: true };
    }
    return enBogota(Date.now());
  }
  function seguir() {
    if (!estado.sigue || !datos) return false;
    const m = momento();
    const tipo = tipoDia(m.ymd, m.diaSemana, datos.festivos), cambio = tipo !== estado.tipo || m.hora !== estado.hora;
    estado.tipo = tipo; estado.hora = m.hora; estado.barra = !!m.barra;
    return cambio;
  }

  function pintar() {
    if (!encendida || !datos || !mapaRef) return;
    const fc = geojson(datos, estado.tipo, estado.hora);
    if (mapaRef.getSource(FUENTE)) mapaRef.getSource(FUENTE).setData(fc);
    else {
      mapaRef.addSource(FUENTE, { type: 'geojson', data: fc });
      mapaRef.addLayer({ id: CAPA, type: 'line', source: FUENTE, metadata: { grupo: 'frecuencia' },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'col'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 12, 4.5, 14, 7, 16, 10],
          'line-opacity': ['case', ['==', ['get', 'v'], 0], 0.6, 1] } });
      mapaRef.on('mouseenter', CAPA, () => { mapaRef.getCanvas().style.cursor = 'pointer'; });
      mapaRef.on('mouseleave', CAPA, () => { mapaRef.getCanvas().style.cursor = ''; });
    }
    pintarLeyenda();
  }

  // La leyenda se arma una vez; mover la hora solo cambia el rótulo y los botones, así el
  // deslizador no se reemplaza mientras el dedo lo arrastra.
  let ley = null;
  function armarLeyenda(c) {
    const chips = el('div', { clase: 'frec-dias', role: 'group', 'aria-label': 'Tipo de día' });
    const botones = TIPOS.map((t) => {
      const b = el('button', { type: 'button', clase: 'frec-dia', texto: CORTO_TIPO[t] });
      b.addEventListener('click', () => { estado.sigue = false; estado.tipo = t; pintar(); });
      chips.append(b);
      return b;
    });
    const rotulo = el('span');
    const rango = el('input', { type: 'range', min: '0', max: '23', step: '1', id: 'frec-hora', 'aria-label': 'Hora del día' });
    rango.addEventListener('input', () => { estado.sigue = false; estado.hora = Number(rango.value); pintar(); });
    const ahora = el('button', { type: 'button', clase: 'frec-ahora' });
    ahora.addEventListener('click', () => { estado.sigue = true; seguir(); pintar(); });
    const filas = el('ul', { clase: 'bicis-ley' });
    for (const [, col, txt] of PASOS) { const sw = el('span', { clase: 'bicis-sw' }); sw.style.background = col; filas.append(el('li', null, sw, txt)); }
    const sw0 = el('span', { clase: 'bicis-sw' }); sw0.style.background = SIN; filas.append(el('li', null, sw0, 'Sin buses'));
    const f = datos.fuente || {};
    const fecha = /GTFS_(\d{4})(\d{2})(\d{2})/.exec(f.archivo || '');
    const lic = datos.licencia && datos.licencia.url ? { nombre: datos.licencia.id === 'CC-BY-SA-4.0' ? 'CC BY‑SA 4.0' : datos.licencia.nombre, url: datos.licencia.url } : LICENCIA_DEF;
    c.replaceChildren(
      el('p', { clase: 'nota frec-aviso', texto: 'Programado, no son los buses en la calle. Buses por hora en los dos sentidos.' }),
      chips,
      el('label', { clase: 'frec-hora', htmlFor: 'frec-hora' }, rotulo, rango),
      ahora,
      filas,
      el('p', { clase: 'nota', texto: 'Solo servicios troncales, sin duales ni alimentadores. Donde varios tramos comparten vía se ve el mayor; al tocar ves la suma.' }),
      B.meta({ tipo: 'inferido', licencia: lic, fuente: 'TransMilenio S.A., GTFS' + (fecha ? ` del ${Number(fecha[3])}/${Number(fecha[2])}/${fecha[1]}` : '') + (origen === 'copia' ? ', copia del sitio' : '') }));
    ley = { caja: c, botones, rotulo, rango, ahora };
  }
  function pintarLeyenda() {
    const c = caja();
    if (!c || !datos) return;
    if (!ley || ley.caja !== c || !c.contains(ley.rango)) armarLeyenda(c);
    TIPOS.forEach((t, i) => ley.botones[i].setAttribute('aria-pressed', String(t === estado.tipo)));
    ley.rotulo.textContent = horaTexto(estado.hora) + ', ' + NOMBRE_TIPO[estado.tipo].toLowerCase();
    if (document.activeElement !== ley.rango) ley.rango.value = String(estado.hora);
    ley.ahora.textContent = estado.sigue ? (estado.barra ? 'Sigue la barra del sol' : 'Sigue la hora de ahora') : 'Volver a ahora';
    ley.ahora.disabled = estado.sigue;
    c.hidden = false;
  }

  async function traer() {
    try {
      const r = await fetch(V.url('frecuencia/troncal.json'), { cache: 'no-cache' });
      if (r.ok) { const d = decodificar(await r.json()); origen = 'vivo'; return d; }
    } catch { /* sigue con la copia */ }
    const r = await fetch(COPIA);
    if (!r.ok) throw new Error(String(r.status));
    origen = 'copia';
    return decodificar(await r.json());
  }

  const alSol = () => { if (encendida && seguir()) pintar(); };
  function prender(mapa) {
    mapaRef = mapa; encendida = true;
    if (mapa.getLayer(CAPA)) mapa.setLayoutProperty(CAPA, 'visibility', 'visible');
    const c = caja();
    if (c) { c.hidden = false; if (!datos) c.replaceChildren(el('p', { clase: 'nota', texto: 'Trayendo la programación…' })); }
    (datos ? Promise.resolve(datos) : traer()).then((d) => {
      datos = d; seguir();
      const ir = () => pintar();
      if (mapa.isStyleLoaded()) ir(); else mapa.once('idle', ir);
    }).catch(() => {
      const k = caja();
      if (k) { k.replaceChildren(el('p', { clase: 'nota', texto: 'No pudimos traer la programación. Revisa la conexión e intenta de nuevo.' })); k.hidden = false; }
    });
    window.addEventListener('bogotwin:sol', alSol);
    clearInterval(reloj);
    reloj = setInterval(alSol, 60000);
  }
  function apagar(mapa) {
    encendida = false;
    clearInterval(reloj);
    window.removeEventListener('bogotwin:sol', alSol);
    if (mapa.getLayer(CAPA)) mapa.setLayoutProperty(CAPA, 'visibility', 'none');
    const c = caja(); if (c) c.hidden = true;
    if (popup) { popup.remove(); popup = null; }
  }

  // Barras chicas de las 24 horas, planas; la hora elegida en oscuro.
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  function barras(serie, hora) {
    const W = 240, H = 50, max = Math.max(1, ...serie), ancho = W / 24;
    const s = sv('svg', { viewBox: `0 0 ${W} ${H + 12}`, class: 'frec-barras', role: 'img',
      'aria-label': `Buses por hora en el día: máximo ${entero.format(max)}` });
    serie.forEach((v, h) => {
      const alto = Math.round((H - 2) * v / max);
      s.append(sv('rect', { x: (h * ancho + 1).toFixed(1), y: H - alto, width: (ancho - 2).toFixed(1), height: Math.max(alto, v ? 1 : 0), class: h === hora ? 'g-frec-hora' : 'g-frec' }));
    });
    for (const h of [0, 6, 12, 18]) { const t = sv('text', { x: h * ancho + 1, y: H + 10, class: 'g-frec-eje' }); t.textContent = horaTexto(h); s.append(t); }
    return s;
  }

  function contenido(idx) {
    const d = datos, tipo = estado.tipo, h = estado.hora;
    const serie = suma(d, idx, tipo);
    const pico = serie.indexOf(Math.max(...serie));
    const nombre = (i) => d.estaciones[i].nombre;
    const caja2 = el('div', { clase: 'bicis-pop frec-pop' });
    if (idx.length === 1) caja2.append(el('div', { clase: 'bicis-nombre', texto: `Entre ${nombre(d.tramos[idx[0]].a)} y ${nombre(d.tramos[idx[0]].b)}` }));
    else {
      caja2.append(el('div', { clase: 'bicis-nombre', texto: `${idx.length} tramos por esta vía` }));
      caja2.append(el('div', { clase: 'nota', texto: idx.map((i) => `${nombre(d.tramos[i].a)} a ${nombre(d.tramos[i].b)}`).join('; ') }));
    }
    caja2.append(el('p', { clase: 'nota frec-aviso', texto: 'Programado, no son los buses en la calle.' }));
    caja2.append(el('div', null, el('b', { texto: `${horaTexto(h)}, ${NOMBRE_TIPO[tipo].toLowerCase()}: ` }), B.valor(`${entero.format(serie[h])} buses por hora`, 'inferido')));
    caja2.append(el('div', null, el('b', { texto: 'Hora con más buses: ' }), B.valor(`${horaTexto(pico)}, ${entero.format(serie[pico])}`, 'inferido')));
    if (serie[h]) caja2.append(el('div', { clase: 'nota', texto: `En promedio, uno cada ${Math.max(1, Math.round(3600 / serie[h]))} segundos sumando los dos sentidos.` }));
    caja2.append(barras(serie, h));
    caja2.append(B.meta({ tipo: 'inferido', licencia: LICENCIA_DEF, fuente: 'Contado de la programación (GTFS) de TransMilenio S.A.' }));
    return caja2;
  }

  function tocar(ev) {
    if (!encendida || !datos || !mapaRef || !mapaRef.getLayer(CAPA)) return false;
    const p = ev.point;
    const fs = mapaRef.queryRenderedFeatures([[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]], { layers: [CAPA] });
    if (!fs.length) return false;
    const idx = [...new Set(fs.map((f) => f.properties.i))];
    if (popup) popup.remove();
    const angosta = mapaRef.getContainer().clientWidth < 600;
    // En el teléfono la leyenda flota a media altura y queda encima de las ventanas del mapa:
    // el tramo sube cerca del borde de arriba y la ventana se abre hacia abajo.
    if (angosta) mapaRef.easeTo({ center: ev.lngLat, offset: [0, -Math.round(mapaRef.getContainer().clientHeight * 0.4)], duration: 300 });
    popup = new maplibregl.Popup({ maxWidth: angosta ? 'min(280px, calc(100vw - 32px))' : '280px', anchor: angosta ? 'top' : undefined })
      .setLngLat(ev.lngLat).setDOMContent(contenido(idx)).addTo(mapaRef);
    return true;
  }

  B.frecuencia = { prender, apagar, tocar, calc, estado };
})();
