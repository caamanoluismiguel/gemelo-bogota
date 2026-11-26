'use strict';
// Capa «PM2,5 de todo 2025»: la superficie anual que la SDA interpoló entre las estaciones de la
// RMCAB, pintada sobre el terreno, con los colegios y las sedes de la red pública de salud encima.
// Se baja solo al prender la capa (mapa.js). Todo viene de site/datos/aire/: el visor no le pide
// nada a los servidores del Distrito.
(function () {
  const B = window.Bogotwin;
  const D = B.aireAnualDatos;
  const { el } = B;
  const RUTA = 'datos/aire/';
  const LIC = {
    pm25: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' },
    colegios: { nombre: 'CC BY‑SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' },
    salud: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' }
  };
  const ATRIB = {
    pm25: 'PM2,5 2025: SDA (CC BY 4.0)',
    colegios: 'Colegios: SED (CC BY‑SA 4.0)',
    salud: 'Red pública de salud: SDS (CC BY 4.0)'
  };
  const ARCHIVO = { pm25: 'pm25-anual-2025.geojson', colegios: 'colegios-sed.geojson', salud: 'salud-red-publica.geojson' };
  const OPACIDAD = { plano: 0.85, tres: 0.75 };
  const leyendaCaja = document.getElementById('pm25-leyenda');
  // Cuántos puntos trae cada archivo (lo revisa pruebas/aire-anual.prueba.js): la leyenda los
  // dice antes de bajar los colegios, que pesan más.
  const CUANTOS = { colegios: 2176, salud: 116 };

  let mapaRef = null, encendida = false, popup = null, franjas = null;
  const datos = {}, bajando = {};
  const quiere = { colegios: true, salud: true };

  function bajar(k) {
    if (datos[k]) return Promise.resolve(datos[k]);
    if (!bajando[k]) {
      bajando[k] = fetch(RUTA + ARCHIVO[k]).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((j) => (datos[k] = j)).finally(() => { bajando[k] = null; });
    }
    return bajando[k];
  }

  const es3d = () => !!(B.mapaApi && B.mapaApi.es3d && B.mapaApi.es3d());
  const debajoDe = (m, ids) => ids.find((id) => m.getLayer(id));

  function ponerFranjas(m) {
    if (m.getSource('pm25')) return;
    m.addSource('pm25', { type: 'geojson', data: datos.pm25, attribution: ATRIB.pm25 });
    const color = ['step', ['get', 'pm25'], D.COLORES[0]];
    D.CORTES.forEach((c, i) => color.push(c + 1e-9, D.COLORES[i + 1]));
    // Bajo los límites de localidad y sector, sobre la foto aérea y las calles.
    const antes = debajoDe(m, ['sectores', 'upl', 'localidades', 'rotulos']);
    m.addLayer({ id: 'pm25', type: 'fill', source: 'pm25', metadata: { grupo: 'pm25' },
      paint: { 'fill-color': color, 'fill-opacity': es3d() ? OPACIDAD.tres : OPACIDAD.plano, 'fill-antialias': false } }, antes);
    m.addLayer({ id: 'pm25-borde', type: 'line', source: 'pm25', metadata: { grupo: 'pm25' },
      paint: { 'line-color': '#4a1340', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.2] } }, antes);
  }

  function ponerPuntos(m, k) {
    if (m.getSource('pm25-' + k)) return;
    m.addSource('pm25-' + k, { type: 'geojson', data: datos[k], attribution: ATRIB[k] });
    const radio = k === 'salud' ? [10, 3.5, 14, 6, 17, 9] : [10, 1.8, 14, 4, 17, 7];
    const pintura = k === 'salud'
      ? { 'circle-color': '#ffffff', 'circle-stroke-color': '#0f6b62', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 2.6] }
      : { 'circle-color': '#1f2a33', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.2] };
    m.addLayer({ id: 'pm25-' + k, type: 'circle', source: 'pm25-' + k, metadata: { grupo: 'pm25' },
      paint: Object.assign({ 'circle-radius': ['interpolate', ['linear'], ['zoom']].concat(radio), 'circle-pitch-alignment': 'map' }, pintura) },
      debajoDe(m, ['rotulos', 'estaciones-rotulo']));
    for (const ev of ['mouseenter', 'mouseleave']) m.on(ev, 'pm25-' + k, () => { m.getCanvas().style.cursor = ev === 'mouseenter' ? 'pointer' : ''; });
  }

  const ver = (m, id, si) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', si ? 'visible' : 'none'); };

  // Dos capas de color a la vez no se leen. Al prender esta, se apaga «Pisos de cada construcción»
  // con su propia casilla (así se ve el cambio) y vuelve al apagar, si nadie la tocó entre tanto.
  // En 3D, de lejos, los bloques de cada sector taparían el suelo: se quitan mientras esta capa
  // esté prendida; de cerca siguen los edificios uno por uno.
  let pisosApagados = false;
  const cajaPisos = () => document.querySelector('[data-grupo="pisos"]');
  function cederPisos(si) {
    const c = cajaPisos();
    if (si && c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); pisosApagados = true; }
    if (!si && pisosApagados && c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
    if (!si) pisosApagados = false;
    if (mapaRef && mapaRef.getLayer('sectores-3d')) mapaRef.setLayoutProperty('sectores-3d', 'visibility', !si && es3d() ? 'visible' : 'none');
  }

  function sincronizar() {
    const m = mapaRef;
    if (!m) return;
    ver(m, 'pm25', encendida); ver(m, 'pm25-borde', encendida);
    for (const k of ['colegios', 'salud']) {
      ver(m, 'pm25-' + k, encendida && quiere[k]);
      if (encendida && quiere[k] && !m.getSource('pm25-' + k)) {
        bajar(k).then(() => { if (encendida && quiere[k]) { ponerPuntos(m, k); ver(m, 'pm25-' + k, true); } })
          .catch(() => aviso(`No pudimos bajar ${k === 'colegios' ? 'los colegios' : 'las sedes de salud'}. Revisa la conexión.`));
      }
    }
    // Salud encima de colegios: son menos y se pierden entre 2.176 puntos.
    if (m.getLayer('pm25-salud') && m.getLayer('pm25-colegios')) m.moveLayer('pm25-salud', debajoDe(m, ['rotulos', 'estaciones-rotulo']));
  }

  function aviso(t) {
    if (!leyendaCaja) return;
    leyendaCaja.append(el('p', { clase: 'nota', texto: t }));
  }

  function casilla(k, texto) {
    const c = el('input', { type: 'checkbox', checked: quiere[k] });
    c.addEventListener('change', () => { quiere[k] = c.checked; sincronizar(); });
    const sw = el('span', { clase: 'pm25-punto', 'data-k': k });
    return el('label', { clase: 'pm25-sub' }, c, sw, texto);
  }

  function pintarLeyenda() {
    if (!leyendaCaja) return;
    const areas = D.areasPorClase(datos.pm25);
    const vals = datos.pm25.features.map((f) => f.properties.pm25);
    const min = Math.min(...vals), max = Math.max(...vals);
    const filas = el('ul', { clase: 'bicis-ley pm25-ley' });
    D.COLORES.forEach((c, i) => {
      const sw = el('span', { clase: 'bicis-sw' });
      sw.style.background = c;
      const km = areas[i] >= 0.5 ? `${Math.round(areas[i])} km²` : 'ninguna zona';
      filas.append(el('li', null, sw, `${D.ETIQUETAS[i]} (${km})`));
    });
    leyendaCaja.replaceChildren(
      el('p', { clase: 'nota' }, 'Promedio de todo 2025 en µg/m³. La SDA lo interpoló entre las estaciones de la RMCAB y lo entrega en ', String(datos.pm25.features.length), ' franjas; no se midió en cada cuadra. ', B.marca('de_fuente')),
      filas,
      el('p', { clase: 'nota', texto: `Toda la zona urbana que cubre queda entre ${D.coma(min)} y ${D.coma(max)}: de ${D.coma(min / D.OMS)} a ${D.coma(max / D.OMS)} veces la guía de la OMS. La norma colombiana se revisa en cada estación, así que esta superficie no dice si una zona la cumple.` }),
      el('p', { clase: 'nota', texto: 'Sirve para ver dónde el aire de todo el año es peor y qué colegios y sedes de salud quedan ahí. No dice cómo está el aire hoy.' }),
      casilla('colegios', `Colegios (${CUANTOS.colegios.toLocaleString('es-CO')} sedes, SED)`),
      casilla('salud', `Sedes de la red pública de salud (${CUANTOS.salud}, SDS)`),
      el('p', { clase: 'nota', texto: 'Toca una franja, un colegio o una sede para ver su valor. Mientras esta capa está prendida apagamos los pisos de cada construcción, para no mezclar dos colores, y en 3D de lejos quitamos los bloques de cada sector; de cerca siguen los edificios.' }),
      B.meta({ tipo: 'de_fuente', licencia: LIC.pm25, fuente: 'SDA, superficie anual de PM2,5 2025' }));
    leyendaCaja.hidden = false;
  }

  function prender(m) {
    mapaRef = m;
    encendida = true;
    if (leyendaCaja) { leyendaCaja.hidden = false; if (!datos.pm25) leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'Trayendo la superficie de PM2,5…' })); }
    return bajar('pm25').then(() => {
      if (!encendida) return;
      const ir = () => { if (!encendida) return; ponerFranjas(m); if (!franjas) pintarLeyenda(); franjas = true; cederPisos(true); sincronizar(); };
      if (m.isStyleLoaded()) ir(); else m.once('idle', ir);
    }).catch((e) => {
      if (leyendaCaja) leyendaCaja.replaceChildren(el('p', { clase: 'nota', texto: 'No pudimos bajar la superficie de PM2,5. Revisa la conexión e intenta de nuevo.' }));
      throw e;
    });
  }
  function apagar(m) {
    encendida = false;
    mapaRef = m;
    sincronizar();
    if (franjas) cederPisos(false);
    if (leyendaCaja) leyendaCaja.hidden = true;
    if (popup) { popup.remove(); popup = null; }
  }

  // En 3D la superficie va más transparente para que se lea el relieve y los edificios.
  window.addEventListener('bogotwin:3d', (ev) => {
    if (!mapaRef || !mapaRef.getLayer('pm25')) return;
    const on = !!(ev.detail && ev.detail.on);
    mapaRef.setPaintProperty('pm25', 'fill-opacity', on ? OPACIDAD.tres : OPACIDAD.plano);
    if (encendida && mapaRef.getLayer('sectores-3d')) mapaRef.setLayoutProperty('sectores-3d', 'visibility', 'none');
  });

  // Frases del valor de una franja, con su marca.
  function bloqueValor(caja, f) {
    if (!f) {
      caja.append(el('p', { clase: 'nota', texto: 'Queda fuera del área urbana que interpola la SDA: aquí no hay valor anual.' }));
      return;
    }
    const v = f.properties.pm25, c = D.comparar(v);
    caja.append(el('div', null, el('b', { texto: 'PM2,5 de 2025, valor de la franja (SDA): ' }), B.valor(`${D.coma(v)} µg/m³`, 'de_fuente', true)));
    caja.append(el('p', { clase: 'nota', texto: 'Es el valor que la SDA le da a esta franja al interpolar las estaciones de la RMCAB. No se midió en este punto.' }));
    caja.append(el('p', { clase: 'nota', texto: `${c.oms} ${c.norma}` }));
  }

  function abrir(lngLat, caja) {
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(caja).addTo(mapaRef);
  }

  // Un colegio o una sede de salud: se mira antes que las capas de la ciudad.
  function tocarPunto(ev) {
    if (!encendida || !mapaRef || !datos.pm25) return false;
    const capas = ['pm25-salud', 'pm25-colegios'].filter((id) => mapaRef.getLayer(id) && mapaRef.getLayoutProperty(id, 'visibility') !== 'none');
    if (!capas.length) return false;
    const p = ev.point;
    const f = mapaRef.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: capas })[0];
    if (!f) return false;
    const [lon, lat] = f.geometry.coordinates;
    const pr = f.properties, salud = f.layer.id === 'pm25-salud';
    const caja = el('div', { clase: 'pm25-pop' });
    caja.append(el('div', { clase: 'bicis-nombre', texto: D.nombre(pr.n) }));
    if (pr.s) caja.append(el('div', { clase: 'nota', texto: 'Sede: ' + D.nombre(pr.s) }));
    caja.append(el('div', { clase: 'nota', texto: salud ? `Red pública de salud, Subred ${pr.r}` : (Number(pr.o) === 1 ? 'Colegio oficial' : 'Colegio no oficial') }));
    bloqueValor(caja, D.franjaEn(datos.pm25, lon, lat));
    caja.append(B.meta({ tipo: 'de_fuente', licencia: salud ? LIC.salud : LIC.colegios, fuente: salud ? 'SDS, red adscrita de salud' : 'SED, colegios, corte del 30 sep 2026' }));
    caja.append(B.meta({ tipo: 'de_fuente', licencia: LIC.pm25, fuente: 'SDA, superficie anual de PM2,5 2025' }));
    abrir([lon, lat], caja);
    return true;
  }

  // Una franja: solo cuando el toque no cayó en otra cosa consultable.
  function tocarFranja(ev) {
    if (!encendida || !mapaRef || !datos.pm25) return false;
    const f = D.franjaEn(datos.pm25, ev.lngLat.lng, ev.lngLat.lat);
    if (!f) return false;
    const caja = el('div', { clase: 'pm25-pop' });
    bloqueValor(caja, f);
    caja.append(B.meta({ tipo: 'de_fuente', licencia: LIC.pm25, fuente: 'SDA, superficie anual de PM2,5 2025' }));
    abrir(ev.lngLat, caja);
    return true;
  }

  B.aireAnual = { prender, apagar, tocarPunto, tocarFranja };
})();
