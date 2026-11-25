'use strict';
// Capa de nivel de quebradas, ríos y canales: un punto por sensor del SAB, de color según el
// umbral del IDIGER que el agua ya pasó. Lee solo el repo vivo, nunca los servidores del
// Distrito. Se baja solo al prender la capa (mapa.js).
(function () {
  const B = window.Bogotwin;
  const V = B.vivo;
  const { el } = B;
  const FUENTE = 'canales', CAPA = 'canales', ROTULO = 'canales-rotulo';
  const VISOR = 'https://app.sab.gov.co/sab/niveles_umbrales.htm';
  const LICENCIA = { nombre: 'CC BY‑NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.es' };
  // Colores planos que siguen los del visor oficial (azul, verde, amarillo, rojo) para que se
  // puedan comparar; el desborde va más oscuro que el rojo. Sin umbrales: blanco con borde azul.
  const COLORES = {
    bajo_umbral: '#1d5b99', bajo: '#2f8a3e', medio: '#e3b505', alto: '#c0392b', desborde: '#5a1010',
    sin_umbrales: '#ffffff', quieto: '#cfcfcf', dudoso: '#9b9b9b', sin_dato: '#cfcfcf'
  };
  const BORDES = { sin_umbrales: '#1d5b99' };
  const LEYENDA = [
    ['bajo_umbral', 'Por debajo del nivel bajo'], ['bajo', 'Nivel bajo'], ['medio', 'Nivel medio'], ['alto', 'Nivel alto'],
    ['desborde', 'En la cota de desborde o por encima'],
    ['sin_umbrales', 'El IDIGER no publica umbrales para este sensor: solo lo que le falta para desbordarse'],
    ['quieto', 'Sin lectura hace más de 1 hora'], ['dudoso', 'Lectura dudosa']
  ];
  const leyendaCaja = document.getElementById('canales-leyenda');
  const f2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m = (x) => f2.format(x) + ' m';
  const msnm = (x) => f2.format(x) + ' m s. n. m.';

  let datos = null, mapaRef = null, reloj = null, encendida = false, popup = null, encuadrado = false;
  let serie = null, serieHora = 0, serieBajando = null;

  // Rótulo con un decimal; por debajo de 1 m, con dos, para que 0,04 no se lea como 0.
  const rotuloDe = (s) => (s.borde == null || s.cat === 'dudoso' || s.cat === 'sin_dato') ? '' : (Math.abs(s.borde) < 1 ? f2.format(s.borde) : B.num(s.borde)) + ' m';
  function geojson(d) {
    return { type: 'FeatureCollection', features: d.sensores.map((s, i) => ({
      type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { i, cat: s.cat, rotulo: rotuloDe(s) } })) };
  }

  function pintarLeyenda(d) {
    if (!leyendaCaja) return;
    const t = d.totales || {};
    const filas = el('ul', { clase: 'bicis-ley' });
    for (const [cat, texto] of LEYENDA) {
      const n = d.sensores.filter((s) => s.cat === cat).length;
      if (!n && (cat === 'quieto' || cat === 'dudoso' || cat === 'desborde')) continue;
      const sw = el('span', { clase: 'bicis-sw canales-sw', 'data-cat': cat });
      sw.style.background = COLORES[cat];
      if (BORDES[cat]) sw.style.borderColor = BORDES[cat];
      filas.append(el('li', null, sw, `${texto} (${n})`));
    }
    const lim = V.limiteMin(d.cadencia) || 20;
    leyendaCaja.replaceChildren(
      el('p', { clase: 'nota' }, B.horaYEdad(d.hora, lim, 'Sin dato reciente'), '. Lo revisamos cerca de cada 10 minutos.'),
      filas,
      el('p', { clase: 'nota', texto: 'El número junto a cada punto es lo que le falta al agua para llegar a la cota de desborde, en metros. Los niveles bajo, medio y alto son los umbrales del IDIGER, no nuestros. Toca un sensor para ver sus números.' +
        (t.sin_lectura_acueducto ? ` Hay ${t.sin_lectura_acueducto} sensores más del acueducto que el SAB lista sin lectura y no se dibujan.` : '') }),
      el('p', { clase: 'nota' }, 'El gemelo no emite alertas. Las oficiales son del IDIGER: ', B.enlace(VISOR, 'visor de niveles del SAB'), '.'),
      B.meta({ tipo: 'medido', licencia: LICENCIA, fuente: 'IDIGER, Sistema de Alerta de Bogotá (SAB). Crudo, sin validar por completo' }));
    leyendaCaja.hidden = false;
  }

  // Punto plano dibujado a mano: relleno, borde y sin degradado. 2× para pantallas densas.
  function punto(relleno, borde, ancho) {
    const n = 36, c = n / 2, r = n / 2 - 2;
    const data = new Uint8Array(n * n * 4);
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [fr, fg, fb] = rgb(relleno), [br, bg, bb] = rgb(borde);
    const anchoPx = ancho * 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const a = Math.max(0, Math.min(1, r - d + 0.5));   // borde suave de medio píxel contra el fondo
      if (!a) continue;
      const enBorde = d > r - anchoPx;
      const k = (y * n + x) * 4;
      data[k] = enBorde ? br : fr; data[k + 1] = enBorde ? bg : fg; data[k + 2] = enBorde ? bb : fb; data[k + 3] = Math.round(255 * a);
    }
    return { width: n, height: n, data };
  }

  function poner(mapa) {
    const fc = geojson(datos);
    if (mapa.getSource(FUENTE)) { mapa.getSource(FUENTE).setData(fc); return; }
    mapa.addSource(FUENTE, { type: 'geojson', data: fc });
    for (const cat of Object.keys(COLORES)) {
      if (!mapa.hasImage('canal-' + cat)) mapa.addImage('canal-' + cat, punto(COLORES[cat], BORDES[cat] || '#ffffff', BORDES[cat] ? 3 : 2), { pixelRatio: 2 });
    }
    // Ícono y no círculo: va en el mismo pase que los rótulos, encima de los volúmenes 3D.
    mapa.addLayer({ id: CAPA, type: 'symbol', source: FUENTE, metadata: { grupo: 'canales' },
      layout: { 'icon-image': ['concat', 'canal-', ['get', 'cat']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 15, 1.1],
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport' } });
    mapa.addLayer({ id: ROTULO, type: 'symbol', source: FUENTE, metadata: { grupo: 'canales' }, minzoom: 10.5,
      layout: { 'text-field': ['get', 'rotulo'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.35],
        'text-anchor': 'top', 'text-allow-overlap': false },
      paint: { 'text-color': '#1f2a33', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    mapa.on('mouseenter', CAPA, () => { mapa.getCanvas().style.cursor = 'pointer'; });
    mapa.on('mouseleave', CAPA, () => { mapa.getCanvas().style.cursor = ''; });
  }

  // La primera vez, si menos de la mitad de los sensores cae en la vista, se encuadran todos
  // (van del Tunjuelo a Guaymaral). Quien ya mira la red completa no pierde su vista.
  function encuadrar(mapa) {
    if (encuadrado || !datos || !datos.sensores.length) return;
    encuadrado = true;
    const b = mapa.getBounds();
    if (2 * datos.sensores.filter((s) => b.contains([s.lon, s.lat])).length >= datos.sensores.length) return;
    const lons = datos.sensores.map((s) => s.lon), lats = datos.sensores.map((s) => s.lat);
    mapa.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 50, pitch: Math.min(mapa.getPitch(), 45), maxZoom: 13 });
  }

  async function traer() {
    const r = await fetch(V.url('canales/ahora.json'), { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    return V.decodificarCanales(await r.json());
  }

  async function refrescar() {
    try {
      datos = await traer();
      if (!encendida) return;
      const ir = () => { if (encendida) { poner(mapaRef); pintarLeyenda(datos); encuadrar(mapaRef); } };
      if (mapaRef.isStyleLoaded()) ir(); else mapaRef.once('idle', ir);
    } catch (e) {
      if (leyendaCaja && !datos) {
        leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'No pudimos traer los niveles. Revisa la conexión; lo intentamos de nuevo en 10 minutos.' }));
        leyendaCaja.hidden = false;
      }
    }
  }

  function prender(mapa) {
    mapaRef = mapa;
    encendida = true;
    for (const id of [CAPA, ROTULO]) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', 'visible');
    if (leyendaCaja) { leyendaCaja.hidden = false; if (!datos) leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'Trayendo los sensores…' })); }
    refrescar();
    clearInterval(reloj);
    reloj = setInterval(refrescar, 10 * 60000);
  }
  function apagar(mapa) {
    encendida = false;
    clearInterval(reloj);
    for (const id of [CAPA, ROTULO]) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', 'none');
    if (leyendaCaja) leyendaCaja.hidden = true;
    if (popup) { popup.remove(); popup = null; }
  }

  async function bajarSerie() {
    if (serie && Date.now() - serieHora < 10 * 60000) return serie;
    if (!serieBajando) {
      serieBajando = (async () => {
        const r = await fetch(V.url('canales/serie-48h.ndjson.gz'), { cache: 'no-cache' });
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

  // Línea chica del espejo de agua con la cota de desborde como raya: el agua sube, la línea sube.
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  function lineaChica(puntos, desborde) {
    const W = 220, H = 52, ahora = Math.max(Date.now(), puntos[puntos.length - 1][0]), t0 = Math.max(ahora - 48 * 3600000, puntos[0][0]);
    const vals = puntos.map((p) => p[1]);
    const alto = Math.max(desborde ?? -Infinity, ...vals), bajo = Math.min(...vals);
    const rango = Math.max(0.5, alto - bajo);
    const x = (t) => 2 + (W - 4) * (t - t0) / Math.max(1, ahora - t0);
    const y = (v) => H - 4 - (H - 10) * (v - bajo) / rango;
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bicis-linea canales-linea', role: 'img',
      'aria-label': `Nivel del agua en la serie: entre ${msnm(bajo)} y ${msnm(Math.max(...vals))}` + (desborde != null ? `; desborde a ${msnm(desborde)}.` : '.') });
    if (desborde != null) s.append(sv('line', { x1: 2, x2: W - 2, y1: y(desborde), y2: y(desborde), class: 'g-desborde' }));
    let tramo = [];
    const cerrar = () => { if (tramo.length > 1) s.append(sv('polyline', { points: tramo.join(' '), class: 'g-bicis' })); else if (tramo.length === 1) { const [a, b] = tramo[0].split(','); s.append(sv('circle', { cx: a, cy: b, r: 1.5, class: 'g-bicis-p' })); } tramo = []; };
    puntos.forEach((p, i) => {
      if (i && p[0] - puntos[i - 1][0] > 25 * 60000) cerrar();
      if (p[0] >= t0) tramo.push(`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
    });
    cerrar();
    return s;
  }

  const AVISOS = {
    desborde: 'Según la lectura, el agua está en la cota de desborde que publica el IDIGER o por encima. Mira el visor oficial.',
    alto: 'El agua pasó el nivel alto del IDIGER.', medio: 'El agua pasó el nivel medio del IDIGER.', bajo: 'El agua pasó el nivel bajo del IDIGER.',
    dudoso: 'Lectura dudosa: deja el agua en un sitio que no cuadra con el cauce. Mostramos los números igual, pero no los tomes como dato.',
    sin_dato: 'Este sensor no trae una lectura que sepamos leer.'
  };
  function contenido(s) {
    const caja = el('div', { clase: 'bicis-pop canales-pop' });
    caja.append(el('div', { clase: 'bicis-nombre', texto: s.nombre }));
    caja.append(el('div', { clase: 'nota', texto: [B.nombrePropio(s.cauce), B.nombrePropio(s.localidad)].filter(Boolean).join(', ') }));
    if (s.cat === 'quieto') caja.append(el('p', { clase: 'bicis-aviso', texto: `El sensor no tiene lectura nueva hace ${s.min_desde_lectura} min: los números pueden estar viejos.` }));
    else if (AVISOS[s.cat]) caja.append(el('p', { clase: 'bicis-aviso', texto: AVISOS[s.cat] }));
    const fila = (k, ...v) => caja.append(el('div', null, el('b', { texto: k + ': ' }), ...v));
    const et = datos.etiquetas || {};
    if (s.borde != null) fila('Le falta para desbordarse', B.valor(m(s.borde), et.borde_libre_m || 'inferido'));
    if (s.espejo != null) fila('Agua a', B.valor(msnm(s.espejo), et.espejo_msnm || 'inferido'));
    if (s.desborde != null) fila('Desborde a', B.valor(msnm(s.desborde), et.desborde_msnm || 'de_fuente'));
    const u = s.umbrales;
    if (u && [u.bajo, u.medio, u.alto].every(Number.isFinite)) {
      fila('Umbrales del IDIGER', B.valor(`bajo ${msnm(u.bajo)}, medio ${f2.format(u.medio)}, alto ${f2.format(u.alto)}`, et.umbrales_msnm || 'de_fuente'));
    } else {
      caja.append(el('div', { clase: 'nota', texto: 'El IDIGER no publica niveles bajo, medio y alto para este sensor, así que no le ponemos color de nivel.' }));
    }
    if (s.lectura != null) {
      const que = s.tipo === 1 ? 'altura del agua sobre el fondo' : s.tipo === 2 ? 'distancia del sensor al agua' : 'sin interpretar';
      fila('Lectura del sensor', B.valor(m(s.lectura), et.lectura_m || 'medido'), ` (${que})`);
    }
    caja.append(B.meta({ tipo: 'medido', hora: s.hora, viejoMin: V.MIN_SIN_LECTURA, licencia: LICENCIA, fuente: 'IDIGER, SAB. Crudo, sin validar por completo' }));
    caja.append(el('p', { clase: 'nota' }, 'El gemelo no emite alertas. ', B.enlace(VISOR, 'Visor oficial del IDIGER'), '.'));
    const hueco = el('div', { clase: 'bicis-serie' });
    caja.append(hueco);
    if (s.cat !== 'dudoso' && s.cat !== 'sin_dato') {
      bajarSerie().then((lineas) => {
        const pts = V.serieCanal(lineas, s.id, datos.campos, 'espejo_msnm');
        if (pts.length < 6) return;   // con menos de una hora la línea no dice nada todavía
        const min = Math.round((Date.now() - pts[0][0]) / 60000);
        const lapso = min >= 47 * 60 ? 'las últimas 48 horas' : min >= 120 ? `las últimas ${Math.round(min / 60)} horas, desde que empezó la serie` : `los últimos ${Math.max(1, min)} min, desde que empezó la serie`;
        hueco.append(el('div', { clase: 'nota', texto: `Nivel del agua en ${lapso}` + (s.desborde != null ? '. La raya es la cota de desborde.' : '.') }), lineaChica(pts, s.desborde));
      }).catch(() => {});
    }
    return caja;
  }

  function tocar(ev) {
    if (!encendida || !datos || !mapaRef || !mapaRef.getLayer(CAPA)) return false;
    const p = ev.point;
    const f = mapaRef.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: [CAPA] })[0];
    if (!f) return false;
    const s = datos.sensores[f.properties.i];
    if (!s) return false;
    if (popup) popup.remove();
    // En pantallas angostas la ventana es más alta que ancha: se centra el sensor abajo para
    // que la ventana quepa entera y no se corte por un lado.
    const angosta = mapaRef.getContainer().clientWidth < 600;
    if (angosta) mapaRef.easeTo({ center: [s.lon, s.lat], offset: [0, Math.round(mapaRef.getContainer().clientHeight * 0.3)], duration: 300 });
    popup = new maplibregl.Popup({ maxWidth: angosta ? 'min(280px, calc(100vw - 32px))' : '280px', anchor: angosta ? 'bottom' : undefined })
      .setLngLat([s.lon, s.lat]).setDOMContent(contenido(s)).addTo(mapaRef);
    return true;
  }

  B.canales = { prender, apagar, tocar, COLORES };
})();
