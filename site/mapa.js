'use strict';
// Mapa de la ciudad por pisos, estaciones y buscador.
(function () {
  const B = window.Bogotwin;
  const movil = matchMedia('(max-width: 600px)');

  // Teselas: por defecto ./teselas/ junto a esta página. Con ?datos=https://... se prueba otro servidor.
  const param = new URLSearchParams(location.search).get('datos');
  const base = (param && /^https:\/\//.test(param)) ? param.replace(/\/?$/, '/') : new URL('teselas/', location.href).href;
  const url = (f) => 'pmtiles://' + new URL(f, base).href;
  const protocolo = new pmtiles.Protocol({ metadata: true });
  // El archivo de Catastro se registra aparte para que las sombras puedan pedir teselas de margen.
  const pmCat = new pmtiles.PMTiles(new URL('catastro-pisos-bogota.pmtiles', base).href);
  protocolo.add(pmCat);
  // Las teselas z16 de Catastro que baja el mapa se copian para las sombras (si están prendidas)
  // antes de que MapLibre las pase a su hilo de trabajo, donde el búfer queda inservible.
  const RE_CAT = /catastro-pisos-bogota\.pmtiles\/(\d+)\/(\d+)\/(\d+)$/;
  maplibregl.addProtocol('pmtiles', async (params, abort) => {
    const r = await protocolo.tile(params, abort);
    const m = B.recibirCatastro && RE_CAT.exec(params.url);
    if (m && m[1] === '16' && r && r.data) B.recibirCatastro(16, +m[2], +m[3], new Uint8Array(r.data.slice(0)));
    return r;
  });

  const PISOS_COLOR = ['#fbe3cf', '#f7c9a3', '#f2ad7e', '#e98d5e', '#d96a44', '#bd4a33', '#8f2d27'];
  const pasos = (campo) => ['step', ['to-number', ['get', campo], 0],
    PISOS_COLOR[0], 2, PISOS_COLOR[1], 3, PISOS_COLOR[2], 4, PISOS_COLOR[3], 6, PISOS_COLOR[4], 10, PISOS_COLOR[5], 20, PISOS_COLOR[6]];
  // Material neutro: grises fríos con variación sutil (se lee como material, no como dato). Fríos
  // porque la luz del sol bajo es cálida: así la fachada a la sombra queda gris y no café.
  // De noche (solo con 3D y sombras) el material baja a grises azulados oscuros.
  const NEUTRO_DIA = ['#d3d7dd', '#d0d4da', '#cdd1d8', '#cacfd6', '#c8ccd3', '#c5cad1', '#c2c7cf'];
  const NEUTRO_NOCHE = ['#565b66', '#535863', '#50555f', '#4d525c', '#4a4f59', '#474c56', '#444953'];
  let noche = 0;   // 0 de día, 1 de noche; en medio durante el crepúsculo civil (sol de 0 a −6°)
  const neutro = (campo) => { const c = noche <= 0 ? NEUTRO_DIA : noche >= 1 ? NEUTRO_NOCHE : NEUTRO_DIA.map((d, i) => B.mezclarColor(d, NEUTRO_NOCHE[i], noche));
    return ['step', ['to-number', ['get', campo], 0], c[0], 2, c[1], 3, c[2], 4, c[3], 6, c[4], 10, c[5], 20, c[6]]; };
  const leyenda = document.getElementById('leyenda');
  for (const c of PISOS_COLOR) { const s = document.createElement('span'); s.style.background = c; leyenda.append(s); }

  const OSM = '<a href="https://www.openstreetmap.org/copyright">© colaboradores de OpenStreetMap</a> (ODbL)';
  const LIM = 'Límites: SDP y UAECD, Datos Abiertos Bogotá (CC BY 4.0)';
  const CAT = 'Pisos: UAECD (Catastro Bogotá), Datos Abiertos Bogotá (CC BY 4.0)';
  const TM = 'Estaciones: TransMilenio S.A. (CC BY 4.0)';
  const MET = 'Metro L1: Empresa Metro de Bogotá vía IDECA (CC BY 4.0)';
  const SITP = 'Paraderos: GTFS de TransMilenio, 13 oct 2026 (CC BY‑SA 4.0)';
  const SAB = 'Lluvia: IDIGER, SAB (CC BY‑NC 4.0)';
  // Texto provisional: el definitivo lo da la revisión de licencias (ver fuentes.html).
  const CAJA_REL = [-74.27, 4.43, -73.93, 4.87];   // donde el relieve tiene datos (oeste, sur, este, norte)
  const REL = 'Relieve: MDT 2025 © SDP y UAECD, IDECA (CC BY 4.0); produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';
  const vacio = { type: 'FeatureCollection', features: [] };

  const estilo = {
    version: 8,
    glyphs: new URL('fuentes/{fontstack}/{range}.pbf', location.href).href.replace('%7Bfontstack%7D', '{fontstack}').replace('%7Brange%7D', '{range}'),
    sources: {
      osm: { type: 'vector', url: url('osm-bogota.pmtiles'), attribution: OSM },
      limites: { type: 'vector', url: url('limites-bogota.pmtiles'), attribution: LIM },
      catastro: { type: 'vector', url: url('catastro-pisos-bogota.pmtiles'), attribution: CAT },
      troncal: { type: 'geojson', data: 'datos/transporte/troncales.geojson', attribution: TM },
      metro: { type: 'geojson', data: 'datos/transporte/metro-l1.geojson', attribution: MET },
      paraderos: { type: 'geojson', data: vacio, attribution: SITP },
      lluvia: { type: 'geojson', data: vacio, attribution: SAB }
    },
    layers: [
      { id: 'fondo', type: 'background', paint: { 'background-color': '#f4f2ee' } },
      { id: 'verde', type: 'fill', source: 'osm', 'source-layer': 'verde', metadata: { grupo: 'base' },
        paint: { 'fill-color': ['match', ['get', 'clase'], 'reserva', '#dde9d3', 'paramo', '#e3e8cf', 'bosque', '#bcd6b0', '#cfe3c4'] } },
      { id: 'agua', type: 'fill', source: 'osm', 'source-layer': 'agua', metadata: { grupo: 'base' },
        filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#a9cbe6' } },
      { id: 'agua-lineas', type: 'line', source: 'osm', 'source-layer': 'agua', metadata: { grupo: 'base' },
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#86b4da', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2.5] } },
      { id: 'pisos-sector', type: 'fill', source: 'catastro', 'source-layer': 'pisos_sector', maxzoom: 16, metadata: { grupo: 'pisos' },
        paint: { 'fill-color': pasos('pisos_prom'), 'fill-opacity': 0.75 } },
      { id: 'construcciones', type: 'fill', source: 'catastro', 'source-layer': 'construcciones', minzoom: 16, metadata: { grupo: 'pisos' },
        paint: { 'fill-color': pasos('pisos'), 'fill-outline-color': '#7a6a5e' } },
      { id: 'vias', type: 'line', source: 'osm', 'source-layer': 'vias', metadata: { grupo: 'base' },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'clase'], 'troncal', '#c9a24a', 'primaria', '#d6b46a', 'peatonal', '#b9b4aa', 'ciclorruta', '#5f9a6b', '#ffffff'],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'],
            9, ['match', ['get', 'clase'], 'troncal', 1.6, 'primaria', 1.1, 0.5],
            16, ['match', ['get', 'clase'], 'troncal', 12, 'primaria', 9, 'secundaria', 7, 'terciaria', 6, 'local', 4.5, 'peatonal', 1.5, 'ciclorruta', 1.5, 3]],
          'line-dasharray': ['match', ['get', 'clase'], 'peatonal', ['literal', [2, 1]], ['literal', [1, 0]]]
        } },
      { id: 'sectores', type: 'line', source: 'limites', 'source-layer': 'sectores', metadata: { grupo: 'sectores' },
        layout: { visibility: 'none' }, paint: { 'line-color': '#6d6d6d', 'line-width': 0.7 } },
      { id: 'upl', type: 'line', source: 'limites', 'source-layer': 'upl', minzoom: 10, metadata: { grupo: 'localidades' },
        paint: { 'line-color': '#3d5a80', 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'localidades', type: 'line', source: 'limites', 'source-layer': 'localidades', metadata: { grupo: 'localidades' },
        paint: { 'line-color': '#2b2b2b', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 14, 2.5] } },
      { id: 'metro-trazado', type: 'line', source: 'metro', filter: ['==', ['get', 'tipo'], 'trazado'], metadata: { grupo: 'metro' },
        paint: { 'line-color': '#1d6a7a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6], 'line-dasharray': [2, 1] } },
      { id: 'paraderos', type: 'circle', source: 'paraderos', minzoom: 13, metadata: { grupo: 'paraderos' }, layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5], 'circle-color': '#ffffff',
          'circle-stroke-color': '#3d5a80', 'circle-stroke-width': 1.4 } },
      { id: 'troncal', type: 'circle', source: 'troncal', metadata: { grupo: 'troncal' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 7], 'circle-color': '#b8312f',
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } },
      { id: 'metro-estaciones', type: 'circle', source: 'metro', filter: ['==', ['get', 'tipo'], 'estacion'], metadata: { grupo: 'metro' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 8], 'circle-color': '#ffffff',
          'circle-stroke-color': '#1d6a7a', 'circle-stroke-width': 2.5 } },
      { id: 'lluvia', type: 'circle', source: 'lluvia', metadata: { grupo: 'lluvia' }, layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'mm'], 0], 0, 4, 5, 7, 20, 11, 50, 15],
          'circle-color': ['case', ['!', ['get', 'con_dato']], '#ffffff',
            ['step', ['get', 'mm'], '#e3eef7', 1, '#a9cbe6', 5, '#5b97c9', 20, '#24609b', 50, '#0e3a66']],
          'circle-stroke-color': ['case', ['!', ['get', 'con_dato']], '#8a857c', '#0e3a66'], 'circle-stroke-width': 1.2 } },
      { id: 'rotulos', type: 'symbol', source: 'limites', 'source-layer': 'rotulos', metadata: { grupo: 'localidades' },
        filter: ['!=', ['get', 'nivel'], 'sector'],
        layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Medium'],
          'text-size': ['match', ['get', 'nivel'], 'localidad', 13, 11.5],
          'text-transform': ['match', ['get', 'nivel'], 'localidad', 'uppercase', 'none'], 'text-max-width': 8 },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } },
      { id: 'estaciones-rotulo', type: 'symbol', source: 'troncal', minzoom: 14, metadata: { grupo: 'troncal' },
        layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1],
          'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true },
        paint: { 'text-color': '#7a1f1d', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } }
    ]
  };

  let mapa;
  try {
    mapa = new maplibregl.Map({
    container: 'mapa', style: estilo, center: [-74.105, 4.65], zoom: movil.matches ? 9.9 : 10.4, minZoom: 8, maxZoom: 19, maxPitch: 85,
    maxBounds: [[-74.9, 3.4], [-73.6, 5.0]], hash: true, attributionControl: { compact: true },
    cooperativeGestures: false
    });
  } catch (e) {
    // Sin WebGL no hay mapa, pero la tarjeta del cielo sí funciona: lo decimos y seguimos.
    document.getElementById('mapa').append(B.el('p', { clase: 'sin-mapa',
      texto: 'Este navegador no pudo dibujar el mapa porque no tiene WebGL activo. Los datos del cielo y las noches frías siguen en el panel.' }));
    return;
  }
  mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  mapa.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  window.BogotwinMapa = mapa;

  // Panel: en teléfono arranca plegado para que el mapa se vea primero.
  const panel = document.getElementById('panel');
  const boton = document.getElementById('plegar');
  // --alto-panel: lo que tapa el borde de abajo del mapa (hoja del teléfono más la barra del sol),
  // para subir la escala y los créditos. --alto-cabeza: dónde se apoya la barra en el teléfono.
  const fijarAlto = () => {
    const barra = document.getElementById('sol-barra');
    const hb = barra && !barra.hidden ? barra.offsetHeight + 8 : 0;
    const raizCss = document.documentElement.style;
    raizCss.setProperty('--alto-cabeza', panel.offsetHeight + 'px');
    raizCss.setProperty('--alto-panel', movil.matches ? panel.offsetHeight + hb + 'px' : (hb ? hb + 24 + 'px' : '0px'));
  };
  const plegar = (si) => {
    panel.classList.toggle('plegado', si);
    boton.setAttribute('aria-expanded', String(!si));
    boton.textContent = si ? 'Ver datos' : 'Ocultar';
    window.dispatchEvent(new CustomEvent('bogotwin:panel', { detail: { plegado: si } }));
    fijarAlto();
  };
  boton.addEventListener('click', () => plegar(!panel.classList.contains('plegado')));
  plegar(movil.matches);
  movil.addEventListener('change', fijarAlto);
  addEventListener('resize', fijarAlto);

  // Capas por grupo.
  let paraderosCargados = false;
  const cajas = document.querySelectorAll('[data-grupo]');
  function aplicar(caja) {
    const g = caja.dataset.grupo;
    if (g === 'paraderos' && caja.checked && !paraderosCargados) {
      paraderosCargados = true;
      mapa.getSource('paraderos').setData('datos/transporte/paraderos-sitp.geojson');
      if (mapa.getZoom() < 13) mapa.easeTo({ zoom: 14, freezeElevation: true });
    }
    for (const capa of estilo.layers) {
      if (capa.metadata && capa.metadata.grupo === g && mapa.getLayer(capa.id)) {
        mapa.setLayoutProperty(capa.id, 'visibility', caja.checked ? 'visible' : 'none');
      }
    }
  }
  mapa.on('load', () => cajas.forEach(aplicar));
  // 3D: el alto es pisos × 3 m, un dibujo (supuesto), no una altura medida.
  const PISO_M = 3;
  const alto = (campo) => ['*', PISO_M, ['max', 1, ['to-number', ['coalesce', ['get', campo], 1]]]];
  const caja3d = document.getElementById('ver-3d');
  // Relieve (paso 4): solo con el 3D. La fuente se agrega la primera vez que se prende, así
  // que con el 3D apagado no se pide ni una tesela del terreno.
  function ponerTerreno(on) {
    if (on && !mapa.getSource('terreno')) {
      const dem = { type: 'raster-dem', url: url('terreno-bogota.pmtiles'), encoding: 'terrarium', tileSize: 256, attribution: REL };
      // Dos fuentes con el mismo archivo: MapLibre dibuja mejor el sombreado si no comparte
      // la fuente con el terreno. Las teselas son las mismas y salen de la misma caché.
      mapa.addSource('terreno', dem);
      mapa.addSource('terreno-sombreado', Object.assign({}, dem));
      // Sombreado suave del relieve, bajo el verde y el agua. Luz fija del noroccidente; con las
      // sombras prendidas la mueve sol-barra.js para que venga del sol.
      mapa.addLayer({ id: 'relieve', type: 'hillshade', source: 'terreno-sombreado', metadata: { grupo: 'relieve' },
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-illumination-direction': 315, 'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': '#6f6a60', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#8c867a' } }, 'verde');
      // Fuera de la caja del relieve las teselas repiten el valor del borde y el sombreado sale
      // en rayas. Un velo del color del fondo lo tapa; el verde y el agua quedan encima.
      mapa.addSource('relieve-fuera', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
        [[-76, 2.5], [-72, 2.5], [-72, 6.5], [-76, 6.5], [-76, 2.5]],
        [[CAJA_REL[0], CAJA_REL[1]], [CAJA_REL[0], CAJA_REL[3]], [CAJA_REL[2], CAJA_REL[3]], [CAJA_REL[2], CAJA_REL[1]], [CAJA_REL[0], CAJA_REL[1]]]] } } });
      mapa.addLayer({ id: 'relieve-fuera', type: 'fill', source: 'relieve-fuera', metadata: { grupo: 'relieve' },
        paint: { 'fill-color': '#f4f2ee', 'fill-antialias': false } }, 'verde');
    }
    for (const id of ['relieve', 'relieve-fuera']) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
  // Cielo estático por defecto (día pleno). sol-barra.js lo reemplaza cuando hay sombras activas.
  const CIELO_DIA = { 'sky-color': '#89c2e8', 'sky-horizon-blend': 0.3, 'horizon-color': '#e8e4dd',
    'fog-color': '#f0ece6', 'horizon-fog-blend': 0.2, 'fog-ground-blend': 0.05, 'atmosphere-blend': 0.75 };

  // Entrada al 3D: Chapinero por la Calle 72 mirando al norte, con los cerros a la derecha.
  const VISTA_CALLE = {
    escritorio: { center: [-74.0585, 4.6535], zoom: 17.3, pitch: 79, bearing: 15 },
    movil: { center: [-74.0585, 4.6535], zoom: 17.0, pitch: 80, bearing: 15 }
  };

  // Noche (solo con 3D y sombras, la pide sol-barra.js): el mapa base y los edificios bajan
  // a colores oscuros planos. Con 2D o de día, los colores de siempre.
  const NOCHE = {
    fondo: { 'background-color': '#1b212c' },
    verde: { 'fill-color': '#1f2a26' },
    agua: { 'fill-color': '#1a2c40' },
    'agua-lineas': { 'line-color': '#24405a' },
    vias: { 'line-color': ['match', ['get', 'clase'], 'troncal', '#5c4f33', 'primaria', '#4f4733', 'peatonal', '#30343c', 'ciclorruta', '#2a4030', '#343a46'] },
    localidades: { 'line-color': '#9aa0ab' },
    upl: { 'line-color': '#6c86ad' },
    rotulos: { 'text-color': '#dfe2e8', 'text-halo-color': '#1b212c' },
    'estaciones-rotulo': { 'text-color': '#f0b4b2', 'text-halo-color': '#1b212c' },
    'relieve-fuera': { 'fill-color': '#1b212c' },
    relieve: { 'hillshade-shadow-color': '#0c1017', 'hillshade-highlight-color': '#3a4252', 'hillshade-accent-color': '#161b24' }
  };
  // La noche llega de a poco (panel de textura, punto 3): t va de 0 (día) a 1 (noche) y los
  // colores se mezclan en línea recta. Se redondea a pasos de 1/20 para no repintar el estilo
  // en cada minuto de la barra. También acepta true o false.
  const DIA = {};
  function fijarNoche(t) {
    t = Math.round(Math.min(1, Math.max(0, Number(t) || 0)) * 20) / 20;
    if (t === noche) return;
    noche = t;
    for (const id of Object.keys(NOCHE)) {
      if (!mapa.getLayer(id)) continue;
      for (const k of Object.keys(NOCHE[id])) {
        const clave = id + '|' + k;
        if (!(clave in DIA)) DIA[clave] = mapa.getPaintProperty(id, k);
        mapa.setPaintProperty(id, k, t === 0 ? DIA[clave] : t === 1 ? NOCHE[id][k] : B.mezclarValor(DIA[clave], NOCHE[id][k], t));
      }
    }
    aplicarLente();
  }

  // Lente del 3D: «como-se-ve» (neutro) o «pisos» (coropleta naranja).
  const lente3d = document.getElementById('lente-3d');
  function lenteActual() { const r = lente3d.querySelector('input[name="lente"]:checked'); return r ? r.value : 'como-se-ve'; }
  function colorPor3d(campo) { return lenteActual() === 'pisos' ? pasos(campo) : neutro(campo); }

  // Vista de calle (3D con «Cómo se ve»): la ciudad ocupa la pantalla. Al entrar, el panel se
  // pliega a su barra de título y la barra del sol queda en su forma corta; los dos se abren
  // con un toque. Si el foco estaba dentro del panel, pasa al botón que lo vuelve a abrir.
  let vistaCalle = false;
  let alVistaCalle = () => {};   // luz propia de los edificios (más abajo, solo con WebGL2)
  function ponerVistaCalle() {
    const si = caja3d.checked && lenteActual() === 'como-se-ve';
    if (si === vistaCalle) return;
    vistaCalle = si;
    alVistaCalle(si);
    document.body.classList.toggle('vista-calle', si);
    if (si && !panel.classList.contains('plegado')) {
      const conFoco = panel.querySelector('#cuerpo').contains(document.activeElement);
      plegar(true);
      if (conFoco) boton.focus();
    } else {
      fijarAlto();
    }
  }

  function aplicarLente() {
    ponerVistaCalle();
    const ley = document.getElementById('leyenda');
    const esc = ley && ley.nextElementSibling;
    if (!caja3d.checked) {
      // Sin 3D, la leyenda y la escala siguen a la capa de pisos (siempre visibles si pisos está marcada).
      if (ley) ley.hidden = false;
      if (esc && esc.classList.contains('escala')) esc.hidden = false;
      return;
    }
    const esPisos = lenteActual() === 'pisos';
    if (mapa.getLayer('sectores-3d')) mapa.setPaintProperty('sectores-3d', 'fill-extrusion-color', esPisos ? pasos('pisos_prom') : neutro('pisos_prom'));
    if (mapa.getLayer('construcciones-3d')) mapa.setPaintProperty('construcciones-3d', 'fill-extrusion-color', esPisos ? pasos('pisos') : neutro('pisos'));
    // Leyenda y escala: solo con la lente «pisos».
    if (ley) ley.hidden = !esPisos;
    if (esc && esc.classList.contains('escala')) esc.hidden = !esPisos;
  }
  lente3d.addEventListener('change', aplicarLente);

  function poner3d() {
    const on = caja3d.checked;
    ponerTerreno(on);
    // Mostrar u ocultar el selector de lente.
    lente3d.hidden = !on;
    if (on && !mapa.getLayer('construcciones-3d')) {
      const antes = mapa.getLayer('rotulos') ? 'rotulos' : undefined;
      // Sin degradado vertical: cada fachada de un solo tono, la del sol y la de la sombra.
      mapa.addLayer({ id: 'sectores-3d', type: 'fill-extrusion', source: 'catastro', 'source-layer': 'pisos_sector', maxzoom: 14,
        paint: { 'fill-extrusion-color': colorPor3d('pisos_prom'), 'fill-extrusion-height': alto('pisos_prom'), 'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': false } }, antes);
      mapa.addLayer({ id: 'construcciones-3d', type: 'fill-extrusion', source: 'catastro', 'source-layer': 'construcciones', minzoom: 14,
        paint: { 'fill-extrusion-color': colorPor3d('pisos'), 'fill-extrusion-height': alto('pisos'), 'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': false } }, antes);
    }
    for (const id of ['sectores-3d', 'construcciones-3d']) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of ['pisos-sector', 'construcciones']) mapa.setLayoutProperty(id, 'visibility', on ? 'none' : (document.querySelector('[data-grupo="pisos"]').checked ? 'visible' : 'none'));
    // Cielo y atmósfera: con 3D el cielo estático de día; sol-barra.js lo anima si hay sombras.
    if (on) { mapa.setSky(CIELO_DIA); } else { mapa.setSky({}); }
    if (!on) fijarNoche(false);
    // Leyenda y escala según la lente activa.
    aplicarLente();
    // freezeElevation y el terreno puesto después de arrancar el giro: sin eso MapLibre 5.24 deja
    // la altura de la cámara congelada en la de antes de llegar las teselas (0 m) y la cámara
    // queda bajo el suelo de la sabana, con el mapa en blanco. Así la altura sigue al terreno.
    if (on) {
      const zoom = mapa.getZoom();
      if (zoom < 15) {
        // Chapinero, Calle 72, a la altura de la calle: se ven las fachadas, el cielo y los cerros.
        mapa.flyTo(Object.assign({ duration: 1800, freezeElevation: true }, VISTA_CALLE[movil.matches ? 'movil' : 'escritorio']));
      } else {
        mapa.easeTo({ pitch: Math.max(mapa.getPitch(), 75), duration: 900, freezeElevation: true });
      }
    } else {
      mapa.easeTo({ pitch: 0, bearing: 0, duration: 900, freezeElevation: true });
    }
    mapa.setTerrain(on ? { source: 'terreno', exaggeration: 1 } : null);
    window.dispatchEvent(new CustomEvent('bogotwin:3d', { detail: { on } }));
  }
  caja3d.addEventListener('change', () => { if (mapa.isStyleLoaded()) poner3d(); else mapa.once('load', poner3d); });
  // Los créditos completos arrancan cerrados (botón ⓘ), en teléfono y en escritorio, para no
  // tapar la ciudad. OpenStreetMap queda siempre a la vista con su enlace a la licencia, como
  // pide la guía de atribución de la OSMF; el resto está a un toque en la ⓘ.
  mapa.once('idle', () => {
    const c = document.querySelector('.maplibregl-ctrl-attrib');
    if (!c) return;
    c.classList.remove('maplibregl-compact-show'); c.removeAttribute('open');
    const corto = document.createElement('div');
    corto.className = 'maplibregl-ctrl osm-corto';
    const a = document.createElement('a');
    a.href = 'https://www.openstreetmap.org/copyright';
    a.textContent = '© OpenStreetMap';
    corto.append(a);
    c.after(corto);
  });
  cajas.forEach(c => c.addEventListener('change', () => aplicar(c)));

  // Sombras de los edificios (pasos 8 a 12): los módulos se bajan solo al prenderlas.
  // Sin WebGL2 no hay sombras y la casilla no se muestra.
  const cajaSombras = document.getElementById('ver-sombras');
  const glMapa = mapa.painter && mapa.painter.context && mapa.painter.context.gl;
  const conWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && glMapa instanceof WebGL2RenderingContext;
  B.mapaApi = { mapa, movil, plegar, fijarAlto, pmCat, panel, teselaUrl: (f) => new URL(f, base).href, es3d: () => caja3d.checked, fijarNoche, panelAbierto: () => !panel.classList.contains('plegado'), cieloDia: CIELO_DIA };
  // Luz propia de los edificios en la vista de calle (edificios-luz.js): cara al sol cálida,
  // cara a la sombra fría y el pie de las fachadas un poco más oscuro. Se baja solo al entrar a
  // la vista de calle y solo con WebGL2; si no carga o falla, queda la luz de MapLibre.
  if (conWebGL2) {
    let luz = null, bajando = null;
    const bajarLuz = () => bajando || (bajando = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'edificios-luz.js'; s.onload = ok; s.onerror = () => { bajando = null; mal(new Error('edificios-luz.js')); };
      document.head.append(s);
    }));
    alVistaCalle = (si) => {
      if (!si) { if (luz) luz.apagar(mapa); return; }
      bajarLuz().then(() => {
        if (!vistaCalle || !mapa.getLayer('construcciones-3d')) return;
        if (!luz) luz = B.luzEdificios.crear({ alFallar: (m) => console.warn('Luz propia de los edificios apagada:', m) });
        if (!luz.estado.error) luz.prender(mapa);
      }).catch(() => {});
    };
    B.luzEdificios3d = () => luz;
    if (vistaCalle) alVistaCalle(true);
  }

  if (cajaSombras) {
    if (!conWebGL2) {
      for (const n of document.querySelectorAll('.solo-sombras')) n.hidden = true;
    } else {
      const MODULOS = ['sol.js', 'sombra-geom.js', 'mvt.js', 'sombras-capa.js', 'sol-texto.js', 'horizonte.js', 'sol-barra.js'];
      let cargando = null;
      const cargar = () => cargando || (cargando = MODULOS.reduce((p, f) => p.then(() => new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = f; s.onload = ok; s.onerror = () => mal(new Error(f));
        document.head.append(s);
      })), Promise.resolve()).catch((e) => { cargando = null; throw e; }));
      const ponerSombras = () => {
        if (!cajaSombras.checked) { if (B.solBarra) B.solBarra.apagar(); return; }
        cargar().then(() => {
          const ir = () => { if (cajaSombras.checked) B.solBarra.prender(); };
          if (mapa.isStyleLoaded()) ir(); else mapa.once('load', ir);
        }).catch(() => {
          cajaSombras.checked = false;
          const n = document.getElementById('sombras-nota');
          if (n) n.textContent = 'No se pudieron bajar las sombras. Revisa la conexión e intenta de nuevo.';
        });
      };
      cajaSombras.addEventListener('change', ponerSombras);
      B.quitarSombras = () => { cajaSombras.checked = false; ponerSombras(); };
      // Un enlace con ?sombras=1 o ?sol=... abre con las sombras prendidas.
      const q = new URLSearchParams(location.search);
      if (q.get('sombras') === '1' || q.has('sol')) { cajaSombras.checked = true; ponerSombras(); }
    }
  }

  // Lluvia del SAB: la pone cielo.js cuando llega el JSON vivo.
  window.addEventListener('bogotwin:cielo', (ev) => {
    B.ultimoCielo = ev.detail;
    const sab = ev.detail && ev.detail.fuentes && ev.detail.fuentes.lluvia_sab;
    if (!sab || !Array.isArray(sab.estaciones)) return;
    const fc = { type: 'FeatureCollection', features: sab.estaciones
      .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon))
      .map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: { nombre: e.nombre, localidad: e.localidad, mm: e.acumulado_hoy_mm, con_dato: !e.sin_dato_hoy && e.acumulado_hoy_mm != null,
          hora: e.hora_dato, ultimo: e.ultimo_minuto_mm } })) };
    const poner = () => mapa.getSource('lluvia').setData(fc);
    if (mapa.isStyleLoaded()) poner(); else mapa.once('load', poner);
  });

  // Ventana con los datos de lo que se toca.
  const consultables = ['lluvia', 'metro-estaciones', 'troncal', 'paraderos', 'construcciones', 'pisos-sector', 'construcciones-3d', 'sectores-3d'];
  function ventana(lngLat, filas, metaArgs, extra) {
    const caja = B.el('div');
    for (const [k, v] of filas) caja.append(B.el('div', null, B.el('b', { texto: k + ': ' }), String(v ?? 'sin dato')));
    if (metaArgs) caja.append(B.meta(metaArgs));
    if (extra) caja.append(extra);
    new maplibregl.Popup({ maxWidth: '270px' }).setLngLat(lngLat).setDOMContent(caja).addTo(mapa);
  }
  mapa.on('click', (e) => {
    const capas = consultables.filter(id => mapa.getLayer(id) && mapa.getLayoutProperty(id, 'visibility') !== 'none');
    const caja = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    const f = mapa.queryRenderedFeatures(caja, { layers: capas })[0];
    if (!f) return;
    const p = f.properties;
    const id = ({ 'construcciones-3d': 'construcciones', 'sectores-3d': 'pisos-sector' })[f.layer.id] || f.layer.id;
    const ll = f.geometry.type === 'Point' ? f.geometry.coordinates : e.lngLat;
    if (id === 'construcciones') {
      // Paso 12: con las sombras prendidas, cuánto mide la sombra a la hora elegida.
      const fila = B.solBarra && B.solBarra.filaPopup(p.pisos);
      let extra = null;
      if (fila) {
        const i = fila.indexOf(': ');
        extra = B.el('div', { clase: 'fila-sombra' }, B.el('b', { texto: fila.slice(0, i + 2) }), fila.slice(i + 2) + ' ', B.marca('inferido'));
      }
      // Lejos (teselas 14 y 15) la huella es la unión de las construcciones de la manzana con
      // los mismos pisos y no trae sótanos: se dice, en vez de un «sin dato» que confunde.
      const lejos = p.sotanos === undefined;
      ventana(ll, [['Pisos', p.pisos], lejos ? ['Huella', 'unida por manzana (vista lejana); acércate para ver cada construcción'] : ['Sótanos', p.sotanos], ['Altura en metros', 'no la publica Catastro'] ].concat(f.layer.id.endsWith('-3d') ? [['Alto dibujado', `${3 * Math.max(1, Number(p.pisos) || 1)} m (3 m por piso, supuesto)`]] : []),
        { tipo: 'de_fuente', fuente: 'UAECD, Catastro Bogotá', licencia: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' } }, extra);
    } else if (id === 'pisos-sector') {
      ventana(ll, [['Sector', p.nombre], ['Pisos promedio', p.pisos_prom], ['Pisos máximo', p.pisos_max], ['Construcciones', p.construcciones]],
        { tipo: 'inferido', fuente: 'promedio ponderado por área, calculado aquí con datos de Catastro' });
    } else if (id === 'troncal') {
      ventana(ll, [['Estación de TransMilenio', p.nombre]], { tipo: 'de_fuente', fuente: 'TransMilenio S.A.', licencia: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' } });
    } else if (id === 'metro-estaciones') {
      ventana(ll, [['Metro línea 1', p.nombre], ['Estado', p.estado]], { tipo: 'de_fuente', fuente: 'Empresa Metro de Bogotá vía IDECA', licencia: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' } });
    } else if (id === 'paraderos') {
      ventana(ll, [['Paradero', p.nombre], ['Código', p.codigo]], { tipo: 'de_fuente', fuente: 'GTFS del 13 oct 2026', licencia: { nombre: 'CC BY‑SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' } });
    } else if (id === 'lluvia') {
      const con = p.con_dato === true || p.con_dato === 'true';
      ventana(ll, [['Pluviómetro', p.nombre], ['Localidad', B.nombrePropio(String(p.localidad || ''))], ['Lluvia de hoy', con ? B.num(Number(p.mm)) + ' mm' : 'sin dato hoy']],
        { tipo: 'medido', hora: p.hora, viejoMin: 30, fuente: 'IDIGER, SAB. Crudo sin validar', licencia: { nombre: 'CC BY‑NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.es' } });
    }
  });
  for (const id of consultables) {
    mapa.on('mouseenter', id, () => { mapa.getCanvas().style.cursor = 'pointer'; });
    mapa.on('mouseleave', id, () => { mapa.getCanvas().style.cursor = ''; });
  }

  // Buscador: el índice (unos 60 KB comprimido) se baja solo cuando alguien empieza a buscar.
  const entrada = document.getElementById('buscar');
  const lista = document.getElementById('resultados');
  const NIVEL = { localidad: 'Localidad', upl: 'UPL', sector: 'Sector catastral', barrio: 'Barrio legalizado' };
  const ORDEN = { localidad: 0, upl: 1, sector: 2, barrio: 3 };
  let indice = null, pidiendo = null;
  function cargarIndice() {
    if (!pidiendo) {
      pidiendo = fetch('datos/buscador.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(j => { indice = j.filas.map(f => ({ f, clave: B.sinTildes(f[0]) })); })
        .catch(() => { pidiendo = null; throw new Error('sin índice'); });
    }
    return pidiendo;
  }
  entrada.addEventListener('focus', () => { cargarIndice().catch(() => {}); }, { once: true });
  let ultimo = '';
  entrada.addEventListener('input', async () => {
    const q = B.sinTildes(entrada.value.trim());
    ultimo = q;
    lista.replaceChildren();
    if (q.length < 2) return;
    try { await cargarIndice(); } catch { lista.append(B.el('li', { clase: 'vacio', texto: 'No se pudo cargar el buscador. Intenta de nuevo.' })); return; }
    if (q !== ultimo) return;
    const hallados = indice.filter(x => x.clave.includes(q))
      .sort((a, b) => (a.clave.startsWith(q) ? 0 : 1) - (b.clave.startsWith(q) ? 0 : 1) || ORDEN[a.f[1]] - ORDEN[b.f[1]] || a.clave.localeCompare(b.clave))
      .slice(0, 8);
    if (!hallados.length) { lista.append(B.el('li', { clase: 'vacio', texto: 'No encontré ese nombre en los límites oficiales.' })); return; }
    for (const { f } of hallados) {
      const [nombre, nivel, loc, x0, y0, x1, y1] = f;
      const b = B.el('button', { type: 'button' }, B.nombrePropio(nombre), B.el('br'),
        B.el('span', { clase: 'nivel', texto: NIVEL[nivel] + (loc && nivel !== 'localidad' ? ' en ' + B.nombrePropio(loc) : '') }));
      b.addEventListener('click', () => {
        mapa.fitBounds([[x0, y0], [x1, y1]], { padding: movil.matches ? 40 : { top: 40, bottom: 40, left: 400, right: 40 }, maxZoom: 16.5, freezeElevation: true });
        lista.replaceChildren();
        entrada.value = B.nombrePropio(nombre);
        if (movil.matches) plegar(true);
      });
      lista.append(B.el('li', null, b));
    }
  });
})();
