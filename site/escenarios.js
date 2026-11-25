'use strict';
// «¿Qué pasa si…?», en la pestaña «Probar». Dos escenarios con sus perillas (docs/escenarios.md):
// aire de un día malo y árboles en una calle. Las cuentas son de escenarios-modelo.js; aquí van
// el panel, las capas del mapa y el sello que dice que lo que se ve no es un dato de hoy.
// Lo baja mapa.js la primera vez que se abre la pestaña. El estado queda en ?esc= de la URL.
(function () {
  const B = window.Bogotwin;
  const M = B.escenariosModelo;
  const D = B.aireAnualDatos;
  const { el } = B;
  const doc = document;
  const RUTA = 'datos/aire/';
  const LIC = {
    pm25: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' },
    colegios: { nombre: 'CC BY‑SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' }
  };
  const ATRIB = 'PM2,5 2025: SDA (CC BY 4.0). Colegios: SED (CC BY‑SA 4.0). Salud: SDS (CC BY 4.0)';
  const CAPAS = ['esc-franjas', 'esc-franjas-borde', 'esc-colegios', 'esc-salud', 'esc-anden', 'esc-sombra', 'esc-sombra-rango', 'esc-tronco', 'esc-copa', 'esc-pie'];
  const FUENTES = ['esc-franjas', 'esc-lugares', 'esc-anden', 'esc-sombra', 'esc-arboles'];
  const COLOR_DIA = ['#fde0dd', '#f768a1', '#7a0177'];
  const fcVacio = () => ({ type: 'FeatureCollection', features: [] });
  const coma = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : 'sin dato');
  const entero = (x) => Math.round(x).toLocaleString('es-CO');

  let mapa = null, api = null;
  const E = {
    tipo: null,                // null (hoy), 'aire' o 'arboles'
    aire: { pm: 37, umbral: 'oms', colegios: true, salud: true },
    arboles: { lon: null, lat: null, porte: 'medio', sep: 8, n: 10, rumbo: 0, anios: 10, fecha: 'hoy', hora: 14 },
    modoClic: false,
    apagadas: []
  };
  const datos = {};
  let lugares = null, media = null, extremos = null;
  const ui = {};

  // ── Datos del aire: se bajan solo al abrir ese escenario ─────────────────
  function bajar(k, archivo) {
    if (datos[k]) return Promise.resolve(datos[k]);
    return fetch(RUTA + archivo).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((j) => (datos[k] = j));
  }
  function prepararAire() {
    if (lugares) return Promise.resolve();
    return Promise.all([bajar('pm25', 'pm25-anual-2025.geojson'), bajar('colegios', 'colegios-sed.geojson'), bajar('salud', 'salud-red-publica.geojson')])
      .then(() => {
        media = M.mediaPonderada(datos.pm25);
        const vals = datos.pm25.features.map((f) => f.properties.pm25);
        extremos = { min: Math.min(...vals), max: Math.max(...vals) };
        const leer = (fc, k) => fc.features.filter((f) => f.geometry && f.geometry.type === 'Point').map((f) => {
          const [lon, lat] = f.geometry.coordinates;
          const fr = D.franjaEn(datos.pm25, lon, lat);
          return { k, lon, lat, anual: fr ? fr.properties.pm25 : null, n: f.properties.n, s: f.properties.s };
        });
        lugares = { colegios: leer(datos.colegios, 'colegio'), salud: leer(datos.salud, 'salud') };
      });
  }

  // Media de hoy según CAMS (estimado), si el pronóstico del aire ya llegó y trae el día de hoy.
  function aireHoy() {
    const a = B.aire, V = B.vivo;
    if (!a || !a.datos || !V) return null;
    try {
      const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
      const d = V.diasAire(a.datos, 5).find((x) => x.fecha === hoy);
      return d ? d.media : null;
    } catch { return null; }
  }

  // ── Sello del mapa: borde y aviso mientras haya escenario ─────────────────
  function ponerSello() {
    const hay = !!E.tipo;
    doc.body.classList.toggle('en-escenario', hay);
    if (ui.sello) {
      ui.sello.hidden = !hay && !E.modoClic;
      ui.selloTexto.textContent = E.modoClic
        ? 'Toca la calle donde irían los árboles.'
        : E.tipo === 'aire' ? 'Escenario del aire: no es el aire de hoy.' : 'Escenario de árboles: no están sembrados.';
      ui.selloVolver.hidden = E.modoClic;
      ui.selloCancelar.hidden = !E.modoClic;
    }
    if (ui.volver) ui.volver.hidden = !hay;
  }

  // Otras capas de color se apagan mientras dura el escenario y vuelven con «Volver a hoy».
  function cajasColor() {
    return [...doc.querySelectorAll('[data-tipo="color"] > input[type="checkbox"], input[type="checkbox"][data-tipo="color"]')];
  }
  function cederColor() {
    const tres = api && api.es3d && api.es3d();
    for (const c of cajasColor()) {
      const pisos = (c.dataset.grupo || '') === 'pisos';
      if (!c.checked || (pisos && tres)) continue;
      c.checked = false;
      c.dispatchEvent(new Event('change', { bubbles: true }));
      E.apagadas.push(c);
    }
  }
  function devolverColor() {
    for (const c of E.apagadas) if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
    E.apagadas = [];
  }

  // ── Capas ────────────────────────────────────────────────────────────────
  const debajoDe = (ids) => ids.find((id) => mapa.getLayer(id));
  function ponerCapas() {
    if (mapa.getSource('esc-franjas')) return;
    for (const id of FUENTES) mapa.addSource(id, { type: 'geojson', data: fcVacio(), attribution: id === 'esc-franjas' || id === 'esc-lugares' ? ATRIB : undefined });
    const antes = debajoDe(['sectores', 'upl', 'localidades', 'rotulos']);
    mapa.addLayer({ id: 'esc-franjas', type: 'fill', source: 'esc-franjas', metadata: { grupo: 'escenario' },
      paint: { 'fill-color': ['step', ['get', 'dia'], COLOR_DIA[0], M.UMBRALES.oms.valor + 1e-9, COLOR_DIA[1], M.UMBRALES.norma.valor + 1e-9, COLOR_DIA[2]],
        'fill-opacity': 0.45, 'fill-antialias': false } }, antes);
    mapa.addLayer({ id: 'esc-franjas-borde', type: 'line', source: 'esc-franjas', metadata: { grupo: 'escenario' },
      paint: { 'line-color': '#6b3f91', 'line-width': 1.4, 'line-dasharray': [3, 2] } }, antes);
    const arriba = debajoDe(['rotulos', 'estaciones-rotulo']);
    mapa.addLayer({ id: 'esc-colegios', type: 'circle', source: 'esc-lugares', filter: ['==', ['get', 'k'], 'colegio'], metadata: { grupo: 'escenario' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'sobre'], 1], 2.6, 1.6], 15, ['case', ['==', ['get', 'sobre'], 1], 5.5, 3.5]],
        'circle-color': ['case', ['==', ['get', 'sobre'], 1], '#1f1f1f', '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'sobre'], 1], '#ffffff', '#6b6b6b'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.4], 'circle-pitch-alignment': 'map' } }, arriba);
    mapa.addLayer({ id: 'esc-salud', type: 'circle', source: 'esc-lugares', filter: ['==', ['get', 'k'], 'salud'], metadata: { grupo: 'escenario' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 7.5],
        'circle-color': ['case', ['==', ['get', 'sobre'], 1], '#0f6b62', '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'sobre'], 1], '#ffffff', '#0f6b62'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 15, 2.4], 'circle-pitch-alignment': 'map' } }, arriba);
    // Árboles: andén contado, sombra con crecimiento medio y borde de lento (línea) y rápido (rayas).
    mapa.addLayer({ id: 'esc-anden', type: 'line', source: 'esc-anden', metadata: { grupo: 'escenario' },
      paint: { 'line-color': '#6b3f91', 'line-width': 1.5, 'line-dasharray': [2, 2] } }, arriba);
    mapa.addLayer({ id: 'esc-sombra', type: 'fill', source: 'esc-sombra', filter: ['==', ['get', 'ritmo'], 'medio'], metadata: { grupo: 'escenario' },
      paint: { 'fill-color': '#2b2350', 'fill-opacity': 0.42 } }, arriba);
    mapa.addLayer({ id: 'esc-sombra-rango', type: 'line', source: 'esc-sombra', filter: ['!=', ['get', 'ritmo'], 'medio'], metadata: { grupo: 'escenario' },
      paint: { 'line-color': '#2b2350', 'line-width': 1.3, 'line-dasharray': ['case', ['==', ['get', 'ritmo'], 'rapido'], ['literal', [2, 1.5]], ['literal', [1, 0]]] } }, arriba);
    mapa.addLayer({ id: 'esc-tronco', type: 'fill-extrusion', source: 'esc-arboles', filter: ['==', ['get', 'parte'], 'tronco'], metadata: { grupo: 'escenario' },
      paint: { 'fill-extrusion-color': '#6b4a2f', 'fill-extrusion-base': 0, 'fill-extrusion-height': ['get', 'alto'], 'fill-extrusion-opacity': 0.95 } });
    mapa.addLayer({ id: 'esc-copa', type: 'fill-extrusion', source: 'esc-arboles', filter: ['==', ['get', 'parte'], 'copa'], metadata: { grupo: 'escenario' },
      paint: { 'fill-extrusion-color': '#4f7a3a', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'alto'], 'fill-extrusion-opacity': 0.6 } });
    mapa.addLayer({ id: 'esc-pie', type: 'circle', source: 'esc-arboles', filter: ['==', ['get', 'parte'], 'pie'], metadata: { grupo: 'escenario' },
      paint: { 'circle-radius': 3, 'circle-color': '#4f7a3a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2, 'circle-pitch-alignment': 'map' } });
  }
  function vaciarCapas() {
    if (!mapa) return;
    for (const id of FUENTES) { const s = mapa.getSource(id); if (s) s.setData(fcVacio()); }
  }
  function poner(id, fc) {
    const s = mapa && mapa.getSource(id);
    if (s) s.setData(fc);
  }

  // ── Escenario 1: aire de un día malo ─────────────────────────────────────
  function cuentaAire() {
    const a = E.aire, u = M.UMBRALES[a.umbral].valor;
    return {
      u,
      colegios: M.contar(lugares.colegios, a.pm, media, u),
      salud: M.contar(lugares.salud, a.pm, media, u),
      qCol: M.quiebres(lugares.colegios, media, u),
      vis: M.visibilidadKm(B.vivo, a.pm, media, extremos.min, extremos.max)
    };
  }
  function dibujarAire() {
    if (!mapa || !lugares) return;
    const a = E.aire, u = M.UMBRALES[a.umbral].valor;
    poner('esc-franjas', { type: 'FeatureCollection', features: datos.pm25.features.map((f) => ({ type: 'Feature', geometry: f.geometry,
      properties: { anual: f.properties.pm25, dia: M.pmEnLugar(f.properties.pm25, a.pm, media) } })) });
    const feats = [];
    for (const k of ['colegios', 'salud']) {
      if (!a[k]) continue;
      for (const l of lugares[k]) {
        const v = M.pmEnLugar(l.anual, a.pm, media);
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
          properties: { k: l.k, sobre: v != null && v > u ? 1 : 0, dia: v == null ? -1 : v, n: l.n || '', s: l.s || '' } });
      }
    }
    poner('esc-lugares', { type: 'FeatureCollection', features: feats });
  }

  // La bruma del cielo 3D sigue el escenario mientras dure (sol-barra.js lee B.escenario).
  function avisarBruma() {
    B.escenario = E.tipo === 'aire' ? { tipo: 'aire', pm25: E.aire.pm } : null;
    window.dispatchEvent(new CustomEvent('bogotwin:aire', { detail: { escenario: true } }));
  }

  // ── Escenario 2: árboles en una calle ────────────────────────────────────
  function fechaArboles() {
    const ahora = B.sol.enBogota(Date.now());
    const [mes, dia] = E.arboles.fecha === 'jun' ? [6, 21] : E.arboles.fecha === 'dic' ? [12, 21] : [ahora.mes, ahora.dia];
    const h = Math.floor(E.arboles.hora), mi = Math.round((E.arboles.hora - h) * 60);
    return { ms: B.sol.desdeBogota(ahora.anio, mes, dia, h, mi), mes, dia };
  }
  function cuentaArboles() {
    const a = E.arboles;
    if (a.lon == null) return null;
    const f = fechaArboles();
    const sol = B.sol.posicion(f.ms, a.lat, a.lon);
    const r = M.rangoFila({ n: a.n, sep: a.sep, rumbo: a.rumbo, porte: a.porte, anios: a.anios, sol, paso: 0.5 });
    return { sol, r, f };
  }
  function dibujarArboles(c) {
    if (!mapa || !c) { poner('esc-sombra', fcVacio()); poner('esc-arboles', fcVacio()); poner('esc-anden', fcVacio()); return; }
    const a = E.arboles, o = [a.lon, a.lat];
    const ll = (xy) => M.aLonLat(xy, o);
    const anillo = (pts) => pts.map(ll);
    const sombras = [];
    for (const ritmo of ['lento', 'medio', 'rapido']) {
      const x = c.r[ritmo];
      if (!x.sombra) continue;
      for (const p of x.pies) sombras.push({ type: 'Feature', properties: { ritmo }, geometry: { type: 'Polygon', coordinates: [anillo(M.poligonoSombra(p, x.sombra, 36))] } });
    }
    poner('esc-sombra', { type: 'FeatureCollection', features: sombras });
    const m = c.r.medio, cp = m.copa, arb = [];
    for (const p of m.pies) {
      arb.push({ type: 'Feature', properties: { parte: 'copa', base: cp.tronco, alto: cp.alto }, geometry: { type: 'Polygon', coordinates: [anillo(M.circulo(p[0], p[1], cp.rCopa, 20))] } });
      arb.push({ type: 'Feature', properties: { parte: 'tronco', alto: cp.tronco + 0.3 }, geometry: { type: 'Polygon', coordinates: [anillo(M.circulo(p[0], p[1], Math.max(0.25, cp.rTronco), 8))] } });
      arb.push({ type: 'Feature', properties: { parte: 'pie' }, geometry: { type: 'Point', coordinates: ll(p) } });
    }
    poner('esc-arboles', { type: 'FeatureCollection', features: arb });
    const largo = a.n * a.sep, ex = Math.sin(a.rumbo * Math.PI / 180), ey = Math.cos(a.rumbo * Math.PI / 180), w = M.ANDEN_M / 2;
    const esq = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([s, t]) => [s * largo / 2 * ex - t * w * ey, s * largo / 2 * ey + t * w * ex]);
    poner('esc-anden', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: anillo(esq) } }] });
  }

  // ── URL: ?esc=aire:37:oms o ?esc=arboles:lon:lat:porte:sep:n:rumbo:años:fecha:hora ──
  function escribirUrl() {
    const q = new URLSearchParams(location.search);
    const a = E.aire, t = E.arboles;
    if (E.tipo === 'aire') q.set('esc', ['aire', a.pm, a.umbral].join(':'));
    else if (E.tipo === 'arboles' && t.lon != null) q.set('esc', ['arboles', t.lon.toFixed(5), t.lat.toFixed(5), t.porte, t.sep, t.n, t.rumbo, t.anios, t.fecha, t.hora].join(':'));
    else q.delete('esc');
    const s = q.toString();
    history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }
  function leerUrl() {
    const v = new URLSearchParams(location.search).get('esc');
    if (!v) return null;
    const p = v.split(':');
    const n = (x, lo, hi, d) => { const k = Number(x); return Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d; };
    if (p[0] === 'aire') {
      E.aire.pm = n(p[1], M.PM_MIN, M.PM_MAX, 37);
      E.aire.umbral = M.UMBRALES[p[2]] ? p[2] : 'oms';
      return 'aire';
    }
    if (p[0] === 'arboles') {
      const lon = Number(p[1]), lat = Number(p[2]);
      if (!(lon > -74.5 && lon < -73.7 && lat > 4.2 && lat < 5.2)) return null;
      Object.assign(E.arboles, { lon, lat, porte: M.PORTES[p[3]] ? p[3] : 'medio', sep: n(p[4], 4, 16, 8), n: Math.round(n(p[5], 2, 20, 10)),
        rumbo: Math.round(n(p[6], 0, 175, 0) / 5) * 5, anios: Math.round(n(p[7], 0, 30, 10)), fecha: ['hoy', 'jun', 'dic'].includes(p[8]) ? p[8] : 'hoy', hora: n(p[9], 6, 18, 14) });
      return 'arboles';
    }
    return null;
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function boton(texto, fn, clase) {
    const b = el('button', { type: 'button', clase: clase || 'boton-edn', texto });
    b.addEventListener('click', fn);
    return b;
  }
  // Perilla con su barra, sus botones de − y + y la salida al lado del nombre.
  function control({ id, nombre, min, max, paso, valor, fmt, alCambiar }) {
    const rango = el('input', { type: 'range', id, min, max, step: paso });
    rango.value = valor();
    const salida = el('output', { clase: 'edn-salida', htmlFor: id, texto: fmt(valor()) });
    const ir = (x) => { const v = Math.min(max, Math.max(min, Math.round(x / paso) * paso)); alCambiar(v); rango.value = v; salida.textContent = fmt(v); };
    const menos = boton('−', () => ir(valor() - paso), 'edn-paso-boton');
    const mas = boton('+', () => ir(valor() + paso), 'edn-paso-boton');
    menos.setAttribute('aria-label', 'Menos: ' + nombre.toLowerCase());
    mas.setAttribute('aria-label', 'Más: ' + nombre.toLowerCase());
    rango.addEventListener('input', () => ir(Number(rango.value)));
    const caja = el('div', { clase: 'edn-control' },
      el('div', { clase: 'edn-control-cabeza' }, el('label', { htmlFor: id, texto: nombre }), salida),
      el('div', { clase: 'edn-fila' }, menos, rango, mas));
    caja.poner = () => { rango.value = valor(); salida.textContent = fmt(valor()); };
    return caja;
  }
  // Grupo de opciones como botones (aria-pressed). opciones: [[valor, texto]].
  function opciones({ nombre, opciones: ops, valor, alCambiar }) {
    const caja = el('div', { clase: 'esc-opciones', role: 'group', 'aria-label': nombre });
    const bs = ops.map(([v, t]) => {
      const b = el('button', { type: 'button', clase: 'esc-opcion', texto: t });
      b.addEventListener('click', () => { alCambiar(v); pintar(); });
      return [v, b];
    });
    const pintar = () => { for (const [v, b] of bs) b.setAttribute('aria-pressed', String(v === valor())); };
    pintar();
    caja.append(...bs.map((x) => x[1]));
    caja.poner = pintar;
    return el('div', { clase: 'edn-control' }, el('p', { clase: 'esc-nombre', texto: nombre }), caja);
  }
  // Grupo de controles: palanca (lo decides tú) o incertidumbre (nadie la controla).
  function grupo(tipo, titulo, ...hijos) {
    return el('fieldset', { clase: 'esc-grupo esc-' + tipo },
      el('legend', null, el('span', { clase: 'esc-chip esc-chip-' + tipo, texto: tipo === 'palanca' ? 'lo decides tú' : 'nadie lo controla' }), ' ', titulo), ...hijos);
  }
  // Una cifra del resultado con su marca.
  function cifra(texto, marca, que) {
    return el('div', { clase: 'dato' }, B.valor(texto, marca, true), ' ', B.marca(marca), el('span', { clase: 'que', texto: que }));
  }

  function armarAire() {
    const a = E.aire;
    const pm = control({ id: 'esc-pm', nombre: 'PM2,5 promedio del día en la ciudad', min: M.PM_MIN, max: M.PM_MAX, paso: 1,
      valor: () => a.pm, fmt: (v) => `${v} µg/m³`, alCambiar: (v) => { a.pm = v; alCambiarAire(); } });
    ui.pm = pm;
    ui.presets = el('div', { clase: 'esc-presets' });
    const umbral = opciones({ nombre: 'Avisas desde', opciones: [['oms', `Guía de la OMS (${M.UMBRALES.oms.valor})`], ['norma', `Norma colombiana (${M.UMBRALES.norma.valor})`]],
      valor: () => a.umbral, alCambiar: (v) => { a.umbral = v; alCambiarAire(); } });
    const quien = el('div', { clase: 'edn-control esc-quien' },
      el('p', { clase: 'esc-nombre', texto: 'A quién avisas' }),
      ...['colegios', 'salud'].map((k) => {
        const c = el('input', { type: 'checkbox', checked: a[k] });
        c.addEventListener('change', () => { a[k] = c.checked; alCambiarAire(); });
        return el('label', { clase: 'esc-casilla' }, c, k === 'colegios' ? ' Colegios' : ' Sedes de la red pública de salud');
      }));
    ui.resAire = el('div', { clase: 'esc-resultado', 'aria-live': 'polite' });
    ui.paneles.aire.replaceChildren(
      el('p', { clase: 'nota', texto: 'La pregunta: si un día el aire se pone así, ¿a cuántos colegios y sedes de salud les toca avisar, y cuánto se ve la ciudad?' }),
      grupo('incierto', 'El aire del día', pm, ui.presets),
      grupo('palanca', 'Tu regla de aviso', umbral, quien),
      ui.resAire,
      supuestosAire());
    pintarPresets();
  }
  function pintarPresets() {
    if (!ui.presets) return;
    const hoy = aireHoy();
    const lista = [];
    if (Number.isFinite(hoy)) lista.push([Math.round(hoy), `Hoy, según CAMS (${coma(hoy)})`, 'estimado']);
    if (media) lista.push([Math.round(media), `Promedio de 2025 (${coma(media)})`, 'inferido']);
    lista.push([M.UMBRALES.oms.valor, `En la guía de la OMS (${M.UMBRALES.oms.valor})`, 'de_fuente'], [M.UMBRALES.norma.valor, `En la norma de 24 h (${M.UMBRALES.norma.valor})`, 'de_fuente']);
    ui.presets.replaceChildren(el('p', { clase: 'esc-nombre', texto: 'Atajos' }), ...lista.map(([v, t, mk]) => {
      const b = boton(t, () => { E.aire.pm = v; ui.pm.poner(); alCambiarAire(); }, 'esc-atajo');
      b.append(' ', B.marca(mk));
      return b;
    }));
  }
  function supuestosAire() {
    return el('details', { clase: 'mas' }, el('summary', { texto: 'Qué supone esta cuenta' }), el('ul', { clase: 'edn-supuestos' },
      el('li', null, 'El día se reparte como el promedio de 2025 de la SDA: cada zona sube en la misma proporción. Un día real puede cargarse más hacia un lado de la ciudad. ', B.marca('supuesto')),
      el('li', null, 'El valor de cada colegio y sede es el de su franja de 2025, que la SDA interpoló entre estaciones; no se midió en el lugar. ', B.marca('inferido')),
      el('li', null, 'Los umbrales son la guía de la OMS de 2021 para 24 horas (15 µg/m³) y la norma colombiana de 24 horas (37 µg/m³, Resolución 2254 de 2017). ', B.marca('de_fuente')),
      el('li', null, 'Cuánto se ve sale de la fórmula de Koschmieder, la misma de la bruma del cielo, con 4 m²/g por 1,5 por la humedad. Sirve para comparar, no para medir. ', B.marca('supuesto')),
      el('li', { texto: 'Como la SDA entrega solo ocho franjas, las cuentas saltan de a muchos colegios a la vez y no de a uno.' }),
      el('li', { texto: 'Los colegios y sedes que caen fuera del área urbana que interpola la SDA no se cuentan ni como limpios ni como sucios.' })));
  }
  function alCambiarAire() {
    if (E.tipo !== 'aire' || !lugares) return;
    dibujarAire();
    pintarAire();
    avisarBruma();
    escribirUrl();
  }
  function pintarAire() {
    if (!ui.resAire || !lugares) return;
    const a = E.aire, c = cuentaAire(), u = M.UMBRALES[a.umbral];
    const conValor = (x) => x.total - x.sinValor;
    const hijos = [el('h3', { texto: 'Lo que pasaría' })];
    if (a.colegios) hijos.push(cifra(`${entero(c.colegios.sobre)} de ${entero(conValor(c.colegios))}`, 'estimado', `colegios quedarían sobre la ${u.nombre}${c.colegios.sinValor ? ` (${c.colegios.sinValor} quedan fuera del área de la SDA)` : ''}.`));
    if (a.salud) hijos.push(cifra(`${entero(c.salud.sobre)} de ${entero(conValor(c.salud))}`, 'estimado', `sedes de la red pública de salud quedarían sobre la ${u.nombre}.`));
    if (c.vis) hijos.push(cifra(`${Math.round(c.vis.peor)} a ${Math.round(c.vis.mejor)} km`, 'estimado', `se vería, de la zona más sucia a la más limpia (unos ${Math.round(c.vis.ciudad)} km con el promedio de la ciudad).`));
    if (c.qCol) hijos.push(el('p', { clase: 'nota esc-quiebre' }, `Dónde cambia la respuesta: con la ${u.nombre}, el primer colegio pasa cuando la ciudad promedia ${coma(c.qCol.primero)} µg/m³ y todos cuando promedia ${coma(c.qCol.todos)}. `, B.marca('inferido')));
    const hoy = aireHoy();
    hijos.push(el('p', { clase: 'nota' }, Number.isFinite(hoy)
      ? `Para comparar: CAMS espera hoy ${coma(hoy)} µg/m³ de media para toda la ciudad, en una celda de unos 45 km. `
      : 'Para comparar, el aire de hoy está en «Próximos días». ', Number.isFinite(hoy) ? B.marca('estimado') : null));
    hijos.push(el('p', { clase: 'nota', texto: 'En el mapa, las franjas se pintan con el valor de ese día: claro hasta 15, rosado de 15 a 37 y morado sobre 37. Los puntos negros son colegios sobre tu umbral; los verdes llenos, sedes de salud sobre tu umbral. Con el 3D prendido, la bruma del cielo sigue este escenario.' }));
    hijos.push(B.meta({ tipo: 'inferido', licencia: LIC.pm25, fuente: 'SDA, PM2,5 anual 2025; SED, colegios; SDS, red de salud' }));
    ui.resAire.replaceChildren(...hijos);
  }

  function armarArboles() {
    const a = E.arboles;
    ui.elegirCalle = boton('Elegir la calle en el mapa', () => modoClic(true));
    ui.donde = el('p', { clase: 'nota' });
    const porte = opciones({ nombre: 'Porte del árbol', opciones: Object.entries(M.PORTES).map(([k, p]) => [k, `${p.nombre[0].toUpperCase() + p.nombre.slice(1)} (${p.adulto} m)`]),
      valor: () => a.porte, alCambiar: (v) => { a.porte = v; alCambiarArboles(); } });
    // Giro de la fila para que siga la calle: 0° de sur a norte, 90° de occidente a oriente.
    const rumbo = control({ id: 'esc-rumbo', nombre: 'Giro de la fila, para que siga la calle', min: 0, max: 175, paso: 5, valor: () => a.rumbo,
      fmt: (v) => (v === 0 ? '0°, de sur a norte' : v === 90 ? '90°, de occidente a oriente' : `${v}°`), alCambiar: (v) => { a.rumbo = v; alCambiarArboles(); } });
    const sep = control({ id: 'esc-sep', nombre: 'Separación entre árboles', min: 4, max: 16, paso: 1, valor: () => a.sep, fmt: (v) => `${v} m`, alCambiar: (v) => { a.sep = v; alCambiarArboles(); } });
    const n = control({ id: 'esc-n', nombre: 'Árboles en la fila', min: 2, max: 20, paso: 1, valor: () => a.n, fmt: (v) => String(v), alCambiar: (v) => { a.n = v; alCambiarArboles(); } });
    const anios = control({ id: 'esc-anios', nombre: 'Años después de sembrar', min: 0, max: 30, paso: 1, valor: () => a.anios, fmt: (v) => (v === 1 ? '1 año' : `${v} años`), alCambiar: (v) => { a.anios = v; alCambiarArboles(); } });
    const fecha = opciones({ nombre: 'Día', opciones: [['hoy', 'Hoy'], ['jun', '21 de junio'], ['dic', '21 de diciembre']], valor: () => a.fecha, alCambiar: (v) => { a.fecha = v; alCambiarArboles(); } });
    const hora = control({ id: 'esc-hora', nombre: 'Hora', min: 6, max: 18, paso: 0.5, valor: () => a.hora, fmt: horaTexto, alCambiar: (v) => { a.hora = v; alCambiarArboles(); } });
    ui.resArboles = el('div', { clase: 'esc-resultado', 'aria-live': 'polite' });
    ui.paneles.arboles.replaceChildren(
      el('p', { clase: 'nota', texto: 'La pregunta: si siembras una fila de árboles en esta calle, ¿cuánta sombra dan a la hora que elijas y cuántos años tardan en darla?' }),
      el('div', { clase: 'edn-paso' }, ui.donde, ui.elegirCalle),
      grupo('palanca', 'Lo que siembras', porte, sep, n, rumbo),
      grupo('incierto', 'Cuánto crecen', el('p', { clase: 'nota' }, 'No hay curvas de crecimiento publicadas para los árboles de Bogotá. Por eso la cuenta va con tres ritmos a la vez: lento (0,3 m al año), medio (0,6) y rápido (1 m), todos desde 2 m al sembrar. ', B.marca('supuesto'))),
      el('fieldset', { clase: 'esc-grupo esc-cuando' }, el('legend', { texto: 'Cuándo miras' }), anios, fecha, hora),
      ui.resArboles,
      supuestosArboles());
  }
  function horaTexto(v) {
    const h = Math.floor(v), mi = Math.round((v - h) * 60);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  }
  function supuestosArboles() {
    return el('details', { clase: 'mas' }, el('summary', { texto: 'Qué supone esta cuenta' }), el('ul', { clase: 'edn-supuestos' },
      el('li', null, 'Tres portes con su altura adulta (6, 12 y 20 m), no especies con nombre. ', B.marca('supuesto')),
      el('li', null, 'La copa es redonda, con las mismas proporciones de los árboles de la vista de calle: unos 7 m de ancho para un árbol de 7 m, nunca más de 16. ', B.marca('supuesto')),
      el('li', null, 'El sol va donde está a esa hora y ese día, con las ecuaciones del NOAA. ', B.marca('inferido')),
      el('li', null, 'La sombra cae sobre suelo plano y con cielo despejado. No cuenta edificios vecinos que ya tapen el sol ni árboles que ya estén ahí. ', B.marca('supuesto')),
      el('li', null, `El andén que se cuenta es una franja de ${M.ANDEN_M} m de ancho a lo largo de la fila, con los árboles en el medio. `, B.marca('supuesto')),
      el('li', { texto: 'No cuenta los árboles que se mueren: con cada uno que falte, la sombra baja en su parte.' })));
  }
  function alCambiarArboles() {
    if (E.tipo !== 'arboles') return;
    const c = cuentaArboles();
    dibujarArboles(c);
    pintarArboles(c);
    escribirUrl();
  }
  const RUMBOS = ['norte', 'nororiente', 'oriente', 'suroriente', 'sur', 'suroccidente', 'occidente', 'noroccidente'];
  function pintarArboles(c) {
    const a = E.arboles;
    ui.donde.textContent = a.lon == null ? 'Primero toca en el mapa la calle donde irían los árboles.' : 'Fila puesta. Toca otra vez para moverla.';
    ui.elegirCalle.textContent = a.lon == null ? 'Elegir la calle en el mapa' : 'Mover la fila';
    if (!c) { ui.resArboles.replaceChildren(); return; }
    const { r, sol, f } = c;
    const cuando = `a las ${horaTexto(a.hora)} del ${f.dia} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][f.mes - 1]}`;
    const hijos = [el('h3', { texto: 'Lo que pasaría' })];
    if (!(sol.altura > M.SOL_MINIMO)) {
      hijos.push(el('p', { clase: 'nota', texto: `El sol está muy bajo o ya se fue ${cuando}: no hay sombra que contar.` }));
    } else {
      const L = r.lento, Me = r.medio, R = r.rapido;
      const alturas = L.h === R.h ? `${coma(L.h)} m` : `${coma(L.h)} a ${coma(R.h)} m`;
      hijos.push(cifra(alturas, 'estimado', `de alto a los ${a.anios} ${a.anios === 1 ? 'año' : 'años'}, de lento a rápido (${coma(Me.h)} m con ritmo medio).`));
      const areas = Math.round(L.area) === Math.round(R.area) ? `${entero(L.area)} m²` : `${entero(L.area)} a ${entero(R.area)} m²`;
      hijos.push(cifra(areas, 'estimado', `de sombra en el suelo ${cuando}, de lento a rápido (${entero(Me.area)} m² con ritmo medio, unos ${entero(Me.porArbol)} m² por árbol).`));
      const pc = (x) => Math.round(x * 100);
      const andenes = pc(L.anden) === pc(R.anden) ? `${pc(L.anden)} %` : `${Math.min(pc(L.anden), pc(R.anden))} a ${Math.max(pc(L.anden), pc(R.anden))} %`;
      hijos.push(cifra(andenes, 'estimado', `del andén de ${M.ANDEN_M} m junto a la fila queda a la sombra.`));
      const sm = Me.sombra, dist = Math.hypot(sm.dx, sm.dy);
      const hacia = RUMBOS[Math.round(((Math.atan2(sm.ux, sm.uy) * 180 / Math.PI + 360) % 360) / 45) % 8];
      hijos.push(el('p', { clase: 'nota esc-quiebre' }, `A esa hora el sol está a ${Math.round(sol.altura)}° sobre el horizonte y la sombra de la copa cae hacia el ${hacia}, con su centro a unos ${coma(dist)} m del pie. ${Me.anden < 0.5 ? 'Buena parte cae fuera del andén: el lado de la calle donde siembras importa tanto como cuántos.' : 'Con la calle en este giro, la sombra cae sobre todo encima del andén.'} `, B.marca('inferido')));
      const adulto = M.PORTES[a.porte].adulto;
      const tarda = (ritmo) => Math.ceil((adulto - M.ALTO_AL_SEMBRAR) / M.RITMOS[ritmo]);
      hijos.push(el('p', { clase: 'nota' }, `Llega a sus ${adulto} m entre los ${tarda('rapido')} y los ${tarda('lento')} años, según el ritmo. `, B.marca('supuesto')));
    }
    hijos.push(el('p', { clase: 'nota', texto: 'En el mapa: la mancha oscura es la sombra con ritmo medio, la línea continua con ritmo lento y la de rayas con ritmo rápido. La raya morada marca el andén que se cuenta.' }));
    ui.resArboles.replaceChildren(...hijos);
  }

  function modoClic(si) {
    E.modoClic = si;
    if (mapa) mapa.getCanvas().style.cursor = si ? 'crosshair' : '';
    if (si && api && api.movil && api.movil.matches) api.plegar(true);
    ponerSello();
  }
  // En el teléfono la hoja tapa la mitad de abajo: la fila se pone en el cuarto de arriba.
  const arribaDeLaHoja = () => (api && api.movil && api.movil.matches ? [0, -Math.round(window.innerHeight / 4)] : [0, 0]);
  // mapa.js pregunta aquí antes de abrir la ficha de lo tocado.
  function tomaClic(e) {
    if (!E.modoClic) return false;
    const lon = e.lngLat.lng, lat = e.lngLat.lat;
    if (!(lon > -74.5 && lon < -73.7 && lat > 4.2 && lat < 5.2)) { ui.selloTexto.textContent = 'Ese punto queda fuera de Bogotá. Toca una calle de la ciudad.'; return true; }
    E.arboles.lon = lon; E.arboles.lat = lat;
    modoClic(false);
    if (mapa.getZoom() < 16) mapa.easeTo({ center: e.lngLat, zoom: 18, duration: 600, offset: arribaDeLaHoja() });
    if (api && api.movil && api.movil.matches) api.plegar(false);
    entrar('arboles');
    return true;
  }

  // ── Entrar, cambiar y volver a hoy ───────────────────────────────────────
  function elegirPanel(tipo) {
    for (const [k, b] of Object.entries(ui.elegir)) b.setAttribute('aria-pressed', String(k === tipo));
    for (const [k, p] of Object.entries(ui.paneles)) p.hidden = k !== tipo;
  }
  function entrar(tipo) {
    elegirPanel(tipo);
    if (tipo === 'aire') {
      ui.cargando.hidden = false;
      return prepararAire().then(() => {
        ui.cargando.hidden = true;
        if (!E.tipo) cederColor();
        E.tipo = 'aire';
        ponerCapas();
        poner('esc-sombra', fcVacio()); poner('esc-arboles', fcVacio()); poner('esc-anden', fcVacio());
        if (!ui.resAire) armarAire(); else { ui.pm.poner(); pintarPresets(); }
        ponerSello();
        alCambiarAire();
      }).catch(() => { ui.cargando.textContent = 'No pudimos bajar los datos del aire. Revisa la conexión e intenta de nuevo.'; });
    }
    if (!ui.resArboles) armarArboles();
    if (E.arboles.lon == null) { pintarArboles(null); if (E.tipo === 'aire') volverAHoy(); modoClic(true); return Promise.resolve(); }
    if (!E.tipo) cederColor();
    E.tipo = 'arboles';
    ponerCapas();
    poner('esc-franjas', fcVacio()); poner('esc-lugares', fcVacio());
    avisarBruma();
    ponerSello();
    alCambiarArboles();
    return Promise.resolve();
  }
  function volverAHoy() {
    E.tipo = null;
    modoClic(false);
    vaciarCapas();
    avisarBruma();
    devolverColor();
    escribirUrl();
    ponerSello();
    if (ui.elegir) { for (const b of Object.values(ui.elegir)) b.setAttribute('aria-pressed', 'false'); for (const p of Object.values(ui.paneles)) p.hidden = true; }
  }

  function armarSello() {
    ui.selloTexto = el('p', { clase: 'esc-sello-texto' });
    ui.selloVolver = boton('Volver a hoy', volverAHoy, 'boton-edn');
    ui.selloCancelar = boton('Cancelar', () => modoClic(false), 'boton-edn secundario');
    ui.sello = el('div', { id: 'esc-sello', clase: 'esc-sello', hidden: true, role: 'status' }, el('span', { clase: 'esc-sello-chip', texto: 'escenario' }), ui.selloTexto, ui.selloVolver, ui.selloCancelar);
    mapa.getContainer().append(ui.sello);
  }

  function iniciar(m) {
    if (mapa) return;
    mapa = m;
    api = B.mapaApi;
    const cuerpo = doc.getElementById('escenarios-cuerpo');
    if (!cuerpo) return;
    ui.elegir = {
      aire: boton('Aire de un día malo', () => entrar('aire'), 'esc-elegir'),
      arboles: boton('Árboles en una calle', () => entrar('arboles'), 'esc-elegir')
    };
    for (const b of Object.values(ui.elegir)) b.setAttribute('aria-pressed', 'false');
    ui.volver = boton('Volver a hoy', volverAHoy, 'boton-edn esc-volver');
    ui.volver.hidden = true;
    ui.cargando = el('p', { clase: 'estado', texto: 'Trayendo los datos del aire…', hidden: true });
    ui.paneles = { aire: el('div', { clase: 'esc-panel', hidden: true }), arboles: el('div', { clase: 'esc-panel', hidden: true }) };
    cuerpo.replaceChildren(
      el('div', { clase: 'esc-elegir-fila', role: 'group', 'aria-label': 'Qué escenario' }, ui.elegir.aire, ui.elegir.arboles),
      ui.volver, ui.cargando, ui.paneles.aire, ui.paneles.arboles);
    armarSello();
    window.addEventListener('bogotwin:aire', (ev) => { if (!(ev.detail && ev.detail.escenario)) { pintarPresets(); if (E.tipo === 'aire') pintarAire(); } });
    const desdeUrl = leerUrl();
    if (desdeUrl === 'arboles' && mapa.getZoom() < 16) mapa.jumpTo({ center: [E.arboles.lon, E.arboles.lat], zoom: 18 }), mapa.panBy(arribaDeLaHoja().map((x) => -x), { duration: 0 });
    if (desdeUrl) entrar(desdeUrl);
  }

  B.escenarios = { iniciar, tomaClic, volverAHoy, estado: E };
})();
