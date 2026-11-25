'use strict';
// Escenario «Edificio nuevo: el sol que les quita a los vecinos» (ronda 1, parte B).
// Esta es la parte del mapa y del panel; las cuentas están en edificio-calculo.js y se prueban
// en Node (pruebas/edificio-calculo.prueba.js). mapa.js baja los dos archivos solo cuando
// alguien abre el escenario o llega con ?edificio= en el enlace: el arranque no pesa más.
//
// Qué hace:
//  * Paso 1: tocas una construcción (su forma sirve de lote) o un punto vacío (lote de 20 por 20 m).
//  * Paso 2: pisos, retroceso y huella. En el mapa sale un volumen fantasma con un tirador que
//    se arrastra hacia arriba o hacia abajo para cambiar los pisos.
//  * Paso 3: lo que les quita a los vecinos en un año, en la mañana y en el recreo de un patio.
//    Siempre como franja (de la combinación que menos quita a la que más) y con su marca.
//  * La sombra a la hora de la barra del sol, en tres tonos: segura, en la franja y sol seguro.
//  * El escenario vive en la URL (?edificio=...), es de cada persona y se imprime como ficha.
// No aprueba ni niega nada: solo muestra.
(function (raiz) {
  const B = raiz.Bogotwin, C = B.edificioCalculo, api = B.mapaApi, mapa = api.mapa;
  const doc = raiz.document;
  const RAD = Math.PI / 180, ZT = 16;
  const M_GRADO = 40075016.686 / 360;
  const ALCANCE = C.RADIO + C.MARCHA + 30;            // m alrededor del lote que se bajan
  const DEMORA = 250;                                 // ms quieto antes de recontar el año
  const LOTE_VACIO = 20;                              // m, lote cuando se toca un punto vacío
  const VERSION = 'versión 1 del 24 nov 2026 (edificio-calculo.js)';
  const COLOR = { sombra: '#2b2350', zona: '#f2d675', cuerpo: '#8f89b3', tapa: '#c9c4e3', lote: '#2b2350' };
  const CAPAS = ['edn-zona', 'edn-zona-borde', 'edn-sombra', 'edn-sombra-borde', 'edn-lote', 'edn-cuerpo', 'edn-tapa', 'edn-patio', 'edn-tirador'];
  const FUENTES = ['edn-zona', 'edn-sombra', 'edn-lote', 'edn-volumen', 'edn-patio'];
  const LICENCIA = { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' };

  const E = {
    esc: null,            // { lon, lat, ancho, fondo, giro, pisos, retroceso, huella, patio }
    modo: 'nada',         // 'nada' | 'lote' | 'patio'
    deCatastro: null,     // el lote salió de una construcción de Catastro (true) o de un punto (false)
    vecinos: null, R: null, claveR: null, res: null,
    ficha: null,          // lo último contado, con lo que la ficha necesita
    token: 0, tCalc: null, tUrl: null,
    tiempos: [],          // ms de cada cambio hasta que la sombra se dibujó (para medir)
    tiemposCalculo: [],   // ms de cada cuenta del año
    M: null, abierto: false
  };
  const ui = {};

  // ── Utilidades ────────────────────────────────────────────────────────────
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const poligono = (anillo, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'Polygon', coordinates: [anillo] } });
  const punto = (ll, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'Point', coordinates: ll } });
  const origen = () => [E.esc.lon, E.esc.lat];
  const aLL = (pts, o) => { const a = pts.map((p) => C.aLonLat(p, o)); a.push(a[0]); return a; };
  const poner = (id, datos) => { const s = mapa.getSource(id); if (s) s.setData(datos); };
  const normalizar = (e) => C.leerEscenario(C.escribirEscenario(e));
  const volumenDe = (esc) => C.volumen({ cx: 0, cy: 0, ancho: esc.ancho, fondo: esc.fondo, giro: esc.giro }, esc);
  const loteDe = (esc) => C.esquinas({ cx: 0, cy: 0, ancho: esc.ancho, fondo: esc.fondo, giro: esc.giro });
  const m1 = (x) => B.num(Math.round(x * 10) / 10);
  // Dos cifras significativas: una cuenta de horas·m² no tiene más precisión que eso.
  function redondo(v) {
    if (!(v >= 1)) return 0;
    const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / p) * p;
  }
  // Franja «de A a B». Si las cuatro combinaciones dan lo mismo, se dice así.
  // Las horas·m² pasan del millón con facilidad: «de 3,9 a 5,1 millones de horas·m²».
  function franjaHoras(r) {
    const v = r.map(redondo);
    if (v[1] < 1e6) return franja(v, B.num, 'horas·m²');
    return franja(v.map((x) => Math.round(x / 1e5) / 10), B.num, 'millones de horas·m²');
  }
  function franja(r, fmt, unidad, corto) {
    const a = fmt(r[0]), b = fmt(r[1]);
    if (a === b) return corto ? `${a} ${unidad}` : `${a} ${unidad} en las cuatro combinaciones`;
    return `de ${a} a ${b} ${unidad}`;
  }
  function boton(texto, alClic, clase) {
    const b = B.el('button', { type: 'button', clase: clase || 'boton-edn', texto });
    b.addEventListener('click', alClic);
    return b;
  }
  function solActual() {
    const S = B.solBarra && B.solBarra.estado;
    return S && S.sol && B.sombraGeom.vectorSombra(S.sol) ? S.sol : null;
  }
  function horaBarra() {
    const S = B.solBarra && B.solBarra.estado;
    if (!S || !S.anio) return '';
    const h = Math.floor(S.min / 60), mi = S.min % 60;
    const h12 = ((h + 11) % 12) + 1;
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${S.dia} de ${meses[S.mes - 1]}, ${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  }
  // Horas de sol directo que tiene un m² sin nada alrededor en el año de cuenta (cielo despejado).
  let horasPosibles = 0;
  for (const m of C.momentosAnio()) horasPosibles += m.horas;

  // ── Datos de alrededor: construcciones de Catastro, árboles del censo y cerros ───────
  const cacheCat = new Map(), cacheArb = new Map();
  let pmArb = null, bajandoArb = null;
  const bajarJs = (f) => new Promise((ok, mal) => {
    const s = doc.createElement('script');
    s.src = f; s.onload = ok; s.onerror = () => mal(new Error(f));
    doc.head.append(s);
  });
  // perfil() de arboles.js da el ancho de copa con la altura del censo. Si no baja, se sigue sin
  // árboles y el panel lo dice.
  function asegurarArboles() {
    if (!bajandoArb) {
      bajandoArb = (B.arboles ? Promise.resolve() : bajarJs('arboles.js'))
        .then(() => { pmArb = new raiz.pmtiles.PMTiles(api.teselaUrl('arboles-bogota.pmtiles')); })
        .catch(() => { pmArb = null; });
    }
    return bajandoArb;
  }
  function bajarTesela(pm, cache, x, y) {
    const k = x + '/' + y;
    if (!cache.has(k)) {
      cache.set(k, pm.getZxy(ZT, x, y)
        .then((r) => (r && r.data ? new Uint8Array(r.data) : new Uint8Array(0)))
        .catch(() => { cache.delete(k); return null; }));
    }
    return cache.get(k);
  }
  function teselaDe(lon, lat) {
    const n = 2 ** ZT;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n)];
  }
  async function cargarVecinos(o) {
    const clave = o.join(',');
    if (E.vecinos && E.vecinos.clave === clave) return E.vecinos;
    await asegurarArboles();
    const cosO = Math.cos(o[1] * RAD), n = 2 ** ZT;
    const dLon = ALCANCE / (M_GRADO * cosO), dLat = ALCANCE / M_GRADO;
    const [x0, y0] = teselaDe(o[0] - dLon, o[1] + dLat), [x1, y1] = teselaDe(o[0] + dLon, o[1] - dLat);
    const tareas = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tareas.push(Promise.all([bajarTesela(api.pmCat, cacheCat, x, y), pmArb ? bajarTesela(pmArb, cacheArb, x, y) : null])
          .then(([cat, arb]) => ({ x, y, cat, arb })));
      }
    }
    const teselas = await Promise.all(tareas);
    const construcciones = [], arboles = [];
    let faltan = 0;
    for (const t of teselas) {
      const local = (ext) => (px, py) => {
        const lon = (t.x + px / ext) / n * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (t.y + py / ext) / n))) / RAD;
        return [(lon - o[0]) * M_GRADO * cosO, (lat - o[1]) * M_GRADO];
      };
      if (!t.cat) faltan++;
      else if (t.cat.length) {
        const capa = B.mvt.leerCapa(t.cat, 'construcciones');
        if (capa) {
          const f = local(capa.extension);
          for (const ob of capa.objetos) {
            const anillos = ob.anillos.map((r) => r.map((p) => f(p[0], p[1])));
            let cerca = false;
            for (const r of anillos) for (const p of r) if (Math.abs(p[0]) < ALCANCE && Math.abs(p[1]) < ALCANCE) { cerca = true; break; }
            if (cerca) construcciones.push({ anillos, pisos: Number(ob.propiedades.pisos) || 1 });
          }
        }
      }
      if (t.arb && t.arb.length && B.arboles) {
        const capa = B.mvt.leerCapa(t.arb, 'arboles', 1);
        if (capa) {
          const f = local(capa.extension);
          for (const ob of capa.objetos) {
            const p0 = ob.anillos[0] && ob.anillos[0][0];
            if (!p0) continue;
            const q = f(p0[0], p0[1]);
            if (Math.abs(q[0]) > ALCANCE || Math.abs(q[1]) > ALCANCE) continue;
            const pr = B.arboles.perfil(ob.propiedades.h, Number(ob.propiedades.f) || 0);
            arboles.push({ x: q[0], y: q[1], h: pr[2] + pr[3], r: pr[4] });
          }
        }
      }
    }
    if (faltan) throw new Error('faltan teselas de Catastro');
    E.vecinos = { clave, construcciones, arboles, conArboles: !!pmArb };
    return E.vecinos;
  }
  // Horizonte de los cerros visto desde el lote: lo baja la barra del sol (una sola vez para
  // las dos). Si en 15 s no llega, se cuenta sin cerros y se dice.
  function cerrosEn(o) {
    const sb = B.solBarra;
    if (!sb || !sb.bajarCerros) return Promise.resolve(null);
    const espera = new Promise((ok) => setTimeout(ok, 15000));
    return Promise.race([sb.bajarCerros(), espera]).then(() => {
      const V = sb.velo;
      if (!V || V.estado !== 'listo') return null;
      const p = B.horizonte.consultar(V.rejillas, o[0], o[1]);
      return p ? { az: Array.from(p.az), hz: Array.from(p.hz) } : null;
    }).catch(() => null);
  }

  // ── Capas del mapa ────────────────────────────────────────────────────────
  function ponerCapas() {
    if (mapa.getSource('edn-volumen')) return;
    for (const id of FUENTES) mapa.addSource(id, { type: 'geojson', data: fc([]) });
    // Debajo de la sombra de hoy y de las construcciones: el techo tapa su propia sombra.
    const debajo = ['sombras', 'construcciones'].find((id) => mapa.getLayer(id));
    mapa.addLayer({ id: 'edn-zona', type: 'fill', source: 'edn-zona', paint: { 'fill-color': COLOR.zona, 'fill-opacity': 0.24 } }, debajo);
    mapa.addLayer({ id: 'edn-zona-borde', type: 'line', source: 'edn-zona', paint: { 'line-color': '#a88a1e', 'line-width': 1.5, 'line-dasharray': [3, 2] } }, debajo);
    mapa.addLayer({ id: 'edn-sombra', type: 'fill', source: 'edn-sombra',
      paint: { 'fill-color': COLOR.sombra, 'fill-opacity': ['match', ['get', 'tono'], 'segura', 0.5, 0.26] } }, debajo);
    mapa.addLayer({ id: 'edn-sombra-borde', type: 'line', source: 'edn-sombra', filter: ['==', ['get', 'tono'], 'banda'],
      paint: { 'line-color': COLOR.sombra, 'line-width': 1.5, 'line-dasharray': [2, 2] } }, debajo);
    mapa.addLayer({ id: 'edn-lote', type: 'line', source: 'edn-lote', paint: { 'line-color': COLOR.lote, 'line-width': 2, 'line-dasharray': [1.5, 1.5] } });
    const extrusion = (id, parte, color, opacidad) => mapa.addLayer({ id, type: 'fill-extrusion', source: 'edn-volumen', filter: ['==', ['get', 'parte'], parte],
      paint: { 'fill-extrusion-color': color, 'fill-extrusion-opacity': opacidad, 'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'alto'], 'fill-extrusion-vertical-gradient': false } });
    extrusion('edn-cuerpo', 'cuerpo', COLOR.cuerpo, 0.82);
    extrusion('edn-tapa', 'tapa', COLOR.tapa, 0.5);
    mapa.addLayer({ id: 'edn-patio', type: 'circle', source: 'edn-patio',
      paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': COLOR.sombra, 'circle-stroke-width': 3 } });
    // Capa sin dibujo: toma la matriz de la cámara para poner el tirador sobre el techo.
    mapa.addLayer({ id: 'edn-tirador', type: 'custom', renderingMode: '3d', onAdd() {}, render(gl, args) {
      E.M = args.defaultProjectionData.mainMatrix; ponerTirador();
    } });
    mapa.on('move', ponerTirador);
  }
  function quitarCapas() {
    for (const id of CAPAS) if (mapa.getLayer(id)) mapa.removeLayer(id);
    for (const id of FUENTES) if (mapa.getSource(id)) mapa.removeSource(id);
    mapa.off('move', ponerTirador);
  }

  // Lo que cambia con cada palanca: volumen, lote y sombra. Es solo geometría (milisegundos).
  function dibujar(t0) {
    if (!E.esc || !mapa.getSource('edn-volumen')) return;
    const esc = E.esc, o = origen();
    const vol = volumenDe(esc);
    const alto = [esc.pisos * C.M_PISO[0], esc.pisos * C.M_PISO[1]];
    const base = aLL(vol.pts, o);
    poner('edn-volumen', fc([poligono(base, { parte: 'cuerpo', base: 0, alto: alto[0] }), poligono(base, { parte: 'tapa', base: alto[0], alto: alto[1] })]));
    poner('edn-lote', fc([poligono(aLL(loteDe(esc), o))]));
    const sol = solActual(), tonos = [];
    if (sol) {
      const H1 = C.sombra(vol.pts, alto[1], sol), H0 = C.sombra(vol.pts, alto[0], sol);
      if (H1) tonos.push(poligono(aLL(H1, o), { tono: 'banda' }));
      if (H0) tonos.push(poligono(aLL(H0, o), { tono: 'segura' }));
    }
    poner('edn-sombra', fc(tonos));
    E.sinSol = !tonos.length;
    pintarHora();
    if (t0) medir(t0);
    ponerTirador();
  }
  // Al arrastrar llegan muchos cambios por cuadro. El primero se dibuja ya; los que llegan
  // mientras el mapa pinta ese cuadro se juntan y sale solo el último, en el cuadro siguiente.
  // No se pide un cuadro aparte: el mapa pinta solo cuando el dato nuevo ya está listo, y un
  // cuadro pedido antes saldría con la sombra vieja y atrasaría el bueno.
  let ocupado = false, pendiente = null;
  function pedirDibujo(t0) {
    if (ocupado) { pendiente = pendiente == null ? t0 : Math.min(pendiente, t0); return; }
    ocupado = true;
    dibujar(t0);
    mapa.once('render', () => {
      ocupado = false;
      if (pendiente != null) { const t = pendiente; pendiente = null; pedirDibujo(t); }
    });
  }
  function dibujarZona() {
    const o = origen(), anillo = [];
    for (let k = 0; k < 72; k++) { const t = k / 72 * 2 * Math.PI; anillo.push([C.RADIO * Math.cos(t), C.RADIO * Math.sin(t)]); }
    poner('edn-zona', fc([poligono(aLL(anillo, o))]));
  }
  function dibujarPatio() {
    const p = E.res && E.res.patio;
    poner('edn-patio', fc(p && E.esc ? [punto(C.aLonLat(p.xy, origen()))] : []));
  }
  // Tiempo desde el cambio hasta el primer cuadro con la sombra nueva ya en el mapa.
  function medir(t0) {
    const fin = () => {
      if (!mapa.getSource('edn-sombra') || !mapa.isSourceLoaded('edn-sombra') || !mapa.isSourceLoaded('edn-volumen')) { mapa.once('render', fin); return; }
      E.tiempos.push(Math.round(performance.now() - t0));
      if (E.tiempos.length > 100) E.tiempos.shift();
    };
    mapa.once('render', fin);
  }

  // ── Tirador sobre el techo ──────────────────────────────────────────────
  function pantallaDe(ll, h) {
    const M = E.M;
    if (!M) return null;
    const mc = raiz.maplibregl.MercatorCoordinate.fromLngLat(ll, 0);
    const z = h * mc.meterInMercatorCoordinateUnits();
    const x = M[0] * mc.x + M[4] * mc.y + M[8] * z + M[12];
    const y = M[1] * mc.x + M[5] * mc.y + M[9] * z + M[13];
    const w = M[3] * mc.x + M[7] * mc.y + M[11] * z + M[15];
    if (!(w > 0)) return null;
    const cv = mapa.getCanvas();
    return [(x / w + 1) / 2 * cv.clientWidth, (1 - y / w) / 2 * cv.clientHeight];
  }
  function sueloEn(ll) {
    const ter = mapa.terrain;
    try { return ter ? ter.getElevationForLngLatZoom(new raiz.maplibregl.LngLat(ll[0], ll[1]), 16) || 0 : 0; } catch { return 0; }
  }
  function ponerTirador() {
    const t = ui.tirador;
    if (!t) return;
    if (!E.esc || E.modo !== 'nada') { t.hidden = true; return; }
    const ll = origen();
    const p = pantallaDe(ll, sueloEn(ll) + E.esc.pisos * C.M_PISO[0]);
    const cv = mapa.getCanvas();
    if (!p || p[0] < 0 || p[1] < 0 || p[0] > cv.clientWidth || p[1] > cv.clientHeight) { t.hidden = true; return; }
    t.hidden = false;
    t.style.transform = `translate(${Math.round(p[0] - 22)}px, ${Math.round(p[1] - 52)}px)`;
    const texto = `${E.esc.pisos} pisos`;
    if (ui.tiradorTexto.textContent !== texto) {
      ui.tiradorTexto.textContent = texto;
      t.setAttribute('aria-label', `Tirador del edificio: ${texto}. Arrástralo o usa las flechas arriba y abajo para cambiar los pisos.`);
    }
  }
  // Cuántos píxeles de pantalla sube un piso en la vista de ahora (de 6 a 40; desde arriba, 14).
  function pxPorPiso() {
    const ll = origen(), s = sueloEn(ll), h = E.esc.pisos * C.M_PISO[0];
    const a = pantallaDe(ll, s + h), b = pantallaDe(ll, s + h + 10 * C.M_PISO[0]);
    const d = a && b ? Math.abs(a[1] - b[1]) / 10 : 0;
    return d >= 1 ? Math.min(40, Math.max(6, d)) : 14;
  }
  function armarTirador() {
    const t = B.el('button', { type: 'button', id: 'edn-tirador', clase: 'edn-tirador', hidden: true },
      B.el('span', { clase: 'edn-flechas', 'aria-hidden': 'true', texto: '↕' }), ui.tiradorTexto = B.el('span', { clase: 'edn-tirador-n' }));
    let arrastre = null;
    t.addEventListener('pointerdown', (ev) => {
      if (!E.esc) return;
      ev.preventDefault();
      t.setPointerCapture(ev.pointerId);
      arrastre = { y: ev.clientY, pisos: E.esc.pisos, px: pxPorPiso() };
      t.classList.add('arrastrando');
    });
    t.addEventListener('pointermove', (ev) => {
      if (!arrastre) return;
      cambiar('pisos', arrastre.pisos + Math.round((arrastre.y - ev.clientY) / arrastre.px), performance.now());
    });
    const soltar = () => { arrastre = null; t.classList.remove('arrastrando'); };
    t.addEventListener('pointerup', soltar);
    t.addEventListener('pointercancel', soltar);
    t.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0;
      if (!d || !E.esc) return;
      ev.preventDefault();
      cambiar('pisos', E.esc.pisos + d, performance.now());
    });
    mapa.getContainer().append(t);
    ui.tirador = t;
  }

  // ── Aviso sobre el mapa mientras se elige el lote o el patio ───────────────────────────
  function armarAviso() {
    ui.avisoTexto = B.el('p', { clase: 'edn-aviso-texto' });
    ui.aviso = B.el('div', { id: 'edn-aviso', clase: 'edn-aviso', hidden: true, role: 'status' }, ui.avisoTexto,
      boton('Cancelar', () => salirModo(), 'boton-edn secundario'));
    mapa.getContainer().append(ui.aviso);
  }
  function modo(nuevo) {
    E.modo = nuevo;
    ui.aviso.hidden = nuevo === 'nada';
    mapa.getCanvas().style.cursor = nuevo === 'nada' ? '' : 'crosshair';
    if (nuevo === 'lote') ui.avisoTexto.textContent = 'Paso 1 de 3: toca una construcción o un punto del mapa. Esa será el lote del edificio nuevo.';
    if (nuevo === 'patio') ui.avisoTexto.textContent = 'Toca el patio que quieres revisar: el de un colegio, una casa o un parque, fuera del lote.';
    if (nuevo !== 'nada' && api.movil.matches) api.plegar(true);
    ponerTirador();
  }
  function salirModo() {
    modo('nada');
    if (api.movil.matches) api.plegar(false);
    if (!E.esc) pintarPanel();
  }

  // ── Clics en el mapa ──────────────────────────────────────────────────────
  function tomaClic(e) {
    if (E.modo === 'lote') { elegirLote(e); return true; }
    if (E.modo === 'patio') { elegirPatio(e); return true; }
    return false;
  }
  function elegirLote(e) {
    // De lejos la huella es la de la manzana entera: primero se acerca.
    if (mapa.getZoom() < 15.5) {
      mapa.easeTo({ center: e.lngLat, zoom: 16.5, duration: 600 });
      ui.avisoTexto.textContent = 'Te acercamos. Ahora toca la construcción o el punto exacto del lote.';
      return;
    }
    const o = [e.lngLat.lng, e.lngLat.lat];
    const capas = ['construcciones-3d', 'construcciones'].filter((id) => mapa.getLayer(id) && mapa.getLayoutProperty(id, 'visibility') !== 'none');
    const f = capas.length ? mapa.queryRenderedFeatures([[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]], { layers: capas })[0] : null;
    let lote = null;
    if (f && f.geometry && /Polygon$/.test(f.geometry.type)) {
      const anillos = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
      const r = C.rectanguloMinimo(anillos.flat().map(([lon, lat]) => C.aLocal(lon, lat, o)));
      if (r) { const c = C.aLonLat([r.cx, r.cy], o); lote = { lon: c[0], lat: c[1], ancho: r.ancho, fondo: r.fondo, giro: r.giro }; }
    }
    const previo = E.esc;
    const palancas = lote ? { retroceso: 0, huella: 100 } : { retroceso: 2, huella: 80 };
    const esc = normalizar(Object.assign({ lon: o[0], lat: o[1], ancho: LOTE_VACIO, fondo: LOTE_VACIO, giro: 0 }, lote, palancas,
      { pisos: previo ? previo.pisos : 12, patio: null }));
    if (!esc) { ui.avisoTexto.textContent = 'Ese punto queda fuera de Bogotá. Toca un lote dentro de la ciudad.'; return; }
    E.deCatastro = !!lote;
    E.esc = esc;
    modo('nada');
    alCambiarLote(false);
  }
  function elegirPatio(e) {
    const xy = C.aLocal(e.lngLat.lng, e.lngLat.lat, origen());
    if (Math.hypot(xy[0], xy[1]) > C.RADIO) { ui.avisoTexto.textContent = 'Ese punto queda a más de 200 m del lote, fuera de lo que contamos. Toca uno más cerca.'; return; }
    const esc = normalizar(Object.assign({}, E.esc, { patio: [e.lngLat.lng, e.lngLat.lat] }));
    if (!esc) return;
    E.esc = esc;
    salirModo();
    escribirUrl();
    programarCalculo();
  }

  // ── Cambios del escenario ─────────────────────────────────────────────────
  function alCambiarLote(volar) {
    E.res = null; E.claveR = null;
    if (E.vecinos && E.vecinos.clave !== origen().join(',')) E.vecinos = null;
    if (api.movil.matches) api.plegar(false);
    pintarPanel();
    dibujarZona();
    dibujarPatio();
    dibujar(performance.now());
    escribirUrl();
    programarCalculo();
    // El lote queda a la vista, fuera de lo que tapa el panel.
    const panel = api.panel, movil = api.movil.matches;
    const relleno = movil ? { top: 60, bottom: Math.min(panel.offsetHeight, raiz.innerHeight * 0.62) + 20, left: 20, right: 20 }
      : { top: 60, bottom: 140, left: panel.offsetWidth + 40, right: 40 };
    const zoom = Math.max(mapa.getZoom(), 16.6);
    if (volar) mapa.jumpTo({ center: origen(), zoom: 16.6, padding: relleno });
    else mapa.easeTo({ center: origen(), zoom, padding: relleno, duration: 500 });
  }
  function cambiar(clave, v, t0) {
    if (!E.esc) return;
    const esc = normalizar(Object.assign({}, E.esc, { [clave]: v }));
    if (!esc || esc[clave] === E.esc[clave]) { pintarControles(); return; }
    E.esc = esc;
    pintarControles();
    pedirDibujo(t0 || performance.now());
    escribirUrl();
    programarCalculo();
  }
  function escribirUrl() {
    clearTimeout(E.tUrl);
    E.tUrl = setTimeout(() => {
      const q = new URLSearchParams(location.search);
      if (E.esc) q.set('edificio', C.escribirEscenario(E.esc)); else q.delete('edificio');
      const s = q.toString().replace(/%2C/g, ',');
      const nueva = location.pathname + (s ? '?' + s : '') + location.hash;
      if (nueva !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', nueva);
    }, 200);
  }
  function programarCalculo() {
    clearTimeout(E.tCalc);
    const tok = ++E.token;
    if (ui.estado) { ui.estado.hidden = false; ui.estado.textContent = 'Contando el sol de todo el año…'; }
    E.tCalc = setTimeout(() => { calcular(tok).catch((e) => fallo(tok, e)); }, DEMORA);
  }
  // La cuenta del año va en un trabajador (edificio-trabajador.js) para que el mapa no se trabe
  // mientras cuenta. Si el navegador no deja crear el trabajador, se cuenta aquí mismo: las
  // cuentas son las mismas (el mismo edificio-calculo.js) y dan lo mismo.
  let trabajador = null, trabajadorClave = null, trabajadorId = 0;
  const esperando = new Map();
  function enTrabajador(msj) {
    if (trabajador === null) {
      try {
        trabajador = new Worker('edificio-trabajador.js');
        trabajador.onmessage = (ev) => {
          const d = ev.data, p = esperando.get(d.id);
          if (!p) return;
          esperando.delete(d.id);
          if (d.error) p.mal(new Error(d.error)); else p.ok(d);
        };
        trabajador.onerror = (ev) => {
          ev.preventDefault();
          trabajador.terminate(); trabajador = false; trabajadorClave = null;
          for (const p of esperando.values()) p.mal(new Error('sin trabajador'));
          esperando.clear();
        };
      } catch { trabajador = false; }
    }
    if (!trabajador) return Promise.reject(new Error('sin trabajador'));
    const id = ++trabajadorId;
    return new Promise((ok, mal) => { esperando.set(id, { ok, mal }); trabajador.postMessage(Object.assign({ id }, msj)); });
  }
  function aqui(V, clave, esc, cerros, patioXY) {
    if (E.claveR !== clave) {
      E.R = C.armarRejilla({ construcciones: V.construcciones, arboles: V.arboles, lote: loteDe(esc) });
      E.claveR = clave;
    }
    const t0 = performance.now();
    const fn = cerros ? (az) => B.horizonte.enAzimut(cerros.az, cerros.hz, az) : null;
    const res = C.metricas(E.R, volumenDe(esc).pts, esc.pisos, { cerros: fn, patio: patioXY });
    return { res, ms: performance.now() - t0 };
  }
  async function calcular(tok) {
    const esc = E.esc;
    if (!esc) return;
    const o = origen();
    const [V, cerros] = await Promise.all([cargarVecinos(o), cerrosEn(o)]);
    if (tok !== E.token) return;
    const clave = [o, esc.ancho, esc.fondo, esc.giro].join('|');
    const patioXY = esc.patio ? C.aLocal(esc.patio[0], esc.patio[1], o) : null;
    let r;
    try {
      const rejilla = trabajadorClave === clave ? null : { construcciones: V.construcciones, arboles: V.arboles, lote: loteDe(esc) };
      trabajadorClave = clave;
      r = await enTrabajador({ clave, rejilla, pts: volumenDe(esc).pts, pisos: esc.pisos, cerros, patio: patioXY });
    } catch (e) {
      trabajadorClave = null;
      if (trabajador) console.warn('Edificio nuevo: el trabajador falló, cuento aquí.', e);
      r = aqui(V, clave, esc, cerros, patioXY);
    }
    E.tiemposCalculo.push(Math.round(r.ms));
    if (E.tiemposCalculo.length > 100) E.tiemposCalculo.shift();
    if (tok !== E.token) return;
    E.res = r.res;
    E.ficha = { esc, res: r.res, cerros: !!cerros, arboles: V.conArboles, nConstrucciones: V.construcciones.length, nArboles: V.arboles.length, cuando: new Date() };
    ui.estado.hidden = true;
    dibujarPatio();
    pintarCifras();
  }
  function fallo(tok, e) {
    console.warn('Edificio nuevo:', e);
    if (tok !== E.token || !ui.estado) return;
    ui.estado.hidden = false;
    ui.estado.textContent = 'No pudimos bajar los datos de alrededor del lote. Revisa la conexión y mueve cualquier palanca para intentar de nuevo.';
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function control(clave, nombre, lim, paso, fmt) {
    const id = 'edn-' + clave;
    const rango = B.el('input', { type: 'range', id, min: lim[0], max: lim[1], step: paso });
    const salida = B.el('output', { clase: 'edn-salida', htmlFor: id });
    const menos = boton('−', () => cambiar(clave, E.esc[clave] - paso), 'edn-paso-boton');
    const mas = boton('+', () => cambiar(clave, E.esc[clave] + paso), 'edn-paso-boton');
    menos.setAttribute('aria-label', 'Menos: ' + nombre.toLowerCase());
    mas.setAttribute('aria-label', 'Más: ' + nombre.toLowerCase());
    rango.addEventListener('input', () => cambiar(clave, Number(rango.value), performance.now()));
    ui.controles[clave] = { rango, salida, fmt };
    return B.el('div', { clase: 'edn-control' },
      B.el('div', { clase: 'edn-control-cabeza' }, B.el('label', { htmlFor: id, texto: nombre }), salida),
      B.el('div', { clase: 'edn-fila' }, menos, rango, mas));
  }
  function pintarControles() {
    if (!E.esc || !ui.controles) return;
    for (const [clave, c] of Object.entries(ui.controles)) {
      c.rango.value = E.esc[clave];
      c.salida.textContent = c.fmt(E.esc[clave]);
    }
    const vol = volumenDe(E.esc);
    ui.resumen.textContent = `Edificio de ${m1(vol.ancho)} por ${m1(vol.fondo)} m (${B.num(Math.round(vol.area))} m² de planta) y de ${m1(E.esc.pisos * C.M_PISO[0])} a ${m1(E.esc.pisos * C.M_PISO[1])} m de alto.`;
  }
  function armarPanel() {
    const cuerpo = doc.getElementById('edificio-cuerpo');
    ui.cuerpo = cuerpo;
    ui.controles = {};
    // Paso 1
    ui.p1texto = B.el('p', { clase: 'nota' });
    ui.elegir = boton('Elegir el lote en el mapa', () => modo('lote'));
    ui.paso1 = B.el('div', { clase: 'edn-paso' }, B.el('h3', { texto: 'Paso 1 de 3 · El lote' }), ui.p1texto, ui.elegir);
    // Paso 2
    ui.resumen = B.el('p', { clase: 'nota edn-resumen' });
    const lote = B.el('details', { clase: 'mas edn-lote-ajuste' }, B.el('summary', { texto: 'Ajustar el tamaño del lote' }),
      control('ancho', 'Ancho del lote', C.LIMITES.ancho, 1, (v) => m1(v) + ' m'),
      control('fondo', 'Fondo del lote', C.LIMITES.fondo, 1, (v) => m1(v) + ' m'),
      control('giro', 'Giro del lote', [-90, 90], 1, (v) => Math.round(v) + '°'));
    ui.paso2 = B.el('div', { clase: 'edn-paso' }, B.el('h3', { texto: 'Paso 2 de 3 · El edificio' }),
      B.el('p', { clase: 'nota', texto: 'Mueve las palancas o arrastra el tirador que sale sobre el edificio en el mapa. La sombra cambia al instante; las cifras del paso 3 se recuentan cuando sueltas.' }),
      control('pisos', 'Pisos', C.LIMITES.pisos, 1, (v) => v + (v === 1 ? ' piso' : ' pisos')),
      control('retroceso', 'Retroceso desde el borde del lote', C.LIMITES.retroceso, 0.5, (v) => m1(v) + ' m'),
      control('huella', 'Huella (qué parte del lote ocupa)', C.LIMITES.huella, 5, (v) => v + ' %'),
      ui.resumen, lote);
    // Paso 3
    ui.estado = B.el('p', { clase: 'estado', 'aria-live': 'polite' });
    ui.cifras = B.el('div', { clase: 'edn-cifras', 'aria-live': 'polite' });
    ui.hora = B.el('div', { clase: 'edn-hora' });
    ui.paso3 = B.el('div', { clase: 'edn-paso' }, B.el('h3', { texto: 'Paso 3 de 3 · Lo que les quita a los vecinos' }), ui.estado, ui.cifras, ui.hora);
    // Supuestos y acciones
    ui.supuestos = B.el('details', { clase: 'mas' }, B.el('summary', { texto: 'Supuestos y franjas de la cuenta' }), B.el('ul', { clase: 'edn-supuestos' }));
    ui.copiado = B.el('p', { clase: 'nota', 'aria-live': 'polite' });
    ui.acciones = B.el('div', { clase: 'edn-acciones' },
      boton('Ficha para imprimir', () => imprimirFicha()),
      boton('Copiar el enlace', () => copiarEnlace(), 'boton-edn secundario'),
      boton('Quitar el edificio', () => cerrar(), 'boton-edn secundario'));
    ui.fin = B.el('div', { clase: 'edn-paso' }, ui.supuestos,
      B.el('p', { clase: 'nota', texto: 'Qué sigue: imprime la ficha o copia el enlace. Quien lo abra ve este mismo edificio y estas mismas cifras; tus cambios no le cambian nada a nadie más.' }),
      ui.acciones, ui.copiado);
    cuerpo.replaceChildren(ui.paso1, ui.paso2, ui.paso3, ui.fin);
  }
  function pintarPanel() {
    const hay = !!E.esc;
    ui.p1texto.textContent = hay
      ? (E.deCatastro === false
        ? `Lote de ${m1(E.esc.ancho)} por ${m1(E.esc.fondo)} m alrededor del punto que tocaste. Ajusta su tamaño en el paso 2.`
        : `Lote de ${m1(E.esc.ancho)} por ${m1(E.esc.fondo)} m: el rectángulo que encierra la construcción de Catastro que tocaste (o el del enlace).`)
      : 'Toca «Elegir el lote en el mapa» y luego una construcción o un punto. Si tocas una construcción, su forma es el lote; si tocas un espacio vacío, ponemos un lote de 20 por 20 m. Después ajustas el edificio.';
    ui.elegir.textContent = hay ? 'Elegir otro lote' : 'Elegir el lote en el mapa';
    ui.paso2.hidden = ui.paso3.hidden = ui.fin.hidden = !hay;
    if (!hay) return;
    pintarControles();
    pintarSupuestos();
    if (!E.res) ui.cifras.replaceChildren();
  }
  function supuestos(conCerros) {
    return [
      'Cada piso mide de 2,8 a 3,3 m, en el edificio nuevo y en los vecinos. Catastro publica pisos, no metros.',
      'Las copas de los árboles vecinos van en dos casos: dejan pasar el sol o tapan como un muro. La altura de cada árbol es la del censo; el ancho de la copa lo ponemos con la altura.',
      'Solo contamos el suelo (calles, andenes, patios, parques) hasta 200 m del lote, en cuadros de 3 por 3 m. No contamos fachadas, ventanas ni techos.',
      'Cielo despejado: es el sol que llegaría sin nubes. Un año real tiene menos sol, y la pérdida real es menor en la misma proporción.',
      'El sol de 2026 en el centro de Bogotá: el día 15 de cada mes, cada 15 minutos, desde que pasa de 3° sobre el horizonte. Para el patio, los 365 días, cada 5 minutos de 7 a 10 a. m.',
      'Lo que hoy está construido en el lote sigue dando su sombra de hoy: solo se cuenta el sol que quita lo nuevo.',
      'El suelo alrededor del lote se toma plano.',
      conCerros === false
        ? 'Esta vez no se contó la sombra de los cerros (no cargó su horizonte): las cifras de la mañana pueden salir más altas.'
        : 'Los cerros tapan el sol cuando su horizonte lo tapa (relieve MDT 2025 y Copernicus): ese sol no se cuenta como perdido.',
      'El recreo de la mañana va de 9:30 a 10:00. Un día cuenta como «sin sol en el recreo» si tenía sol en algún momento de esa media hora y con el edificio ya no.'
    ];
  }
  function pintarSupuestos() {
    const ul = ui.supuestos.querySelector('ul');
    ul.replaceChildren(...supuestos(E.ficha ? E.ficha.cerros : null).map((t) => B.el('li', null, t + ' ', B.marca('supuesto'))));
  }
  function cifra(titulo, texto, explicacion) {
    return B.el('div', { clase: 'dato' },
      B.el('span', { clase: 'que', texto: titulo }),
      B.valor(texto, 'inferido', true), ' ', B.marca('inferido'),
      explicacion ? B.el('p', { clase: 'nota', texto: explicacion }) : null);
  }
  function pintarCifras() {
    const r = E.res;
    if (!r) return;
    const filas = [];
    const area = [redondo(r.horasM2[0] / horasPosibles), redondo(r.horasM2[1] / horasPosibles)];
    filas.push(cifra('Sol que pierde el suelo vecino en un año', franjaHoras(r.horasM2),
      `Es como dejar sin sol todo el año ${franja(area, B.num, 'm²')} de calle o patio. La cifra baja supone pisos de 2,8 m y copas que ya tapan; la alta, pisos de 3,3 m y copas que dejan pasar el sol.`));
    const p = r.patio;
    if (p) {
      const titulo = r.patioEsPeor ? 'El punto del suelo que más pierde en la mañana' : 'Tu patio';
      filas.push(B.el('h4', { clase: 'edn-sub', texto: titulo }));
      if (p.enLote) filas.push(B.el('p', { clase: 'nota', texto: 'Ese punto queda dentro del lote. Elige un patio fuera de él.' }));
      else if (p.enTecho) filas.push(B.el('p', { clase: 'nota', texto: 'Ese punto cae sobre un techo, y aquí solo contamos el suelo. Elige un patio descubierto.' }));
      else {
        filas.push(cifra('Minutos de sol que pierde cada mañana, de 7 a 10, en promedio', franja(p.minutosDia, (v) => B.num(Math.round(v)), 'minutos')));
        filas.push(cifra('La peor mañana del año', franja(p.peorDia, (v) => B.num(Math.round(v)), 'minutos menos')));
        filas.push(cifra('Días del año que se queda sin sol en el recreo (9:30 a 10:00)', franja(p.diasRecreo, B.num, 'días'),
          `Hoy, sin el edificio, tiene sol en el recreo ${franja(p.diasRecreoHoy, B.num, 'días', true)} del año.`));
      }
      filas.push(B.el('p', { clase: 'nota', texto: r.patioEsPeor
        ? 'Es el punto blanco del mapa. Si conoces el patio de un colegio o de una casa cerca, tócalo para ver el suyo.'
        : 'Es el punto blanco del mapa.' }));
      filas.push(boton(r.patioEsPeor ? 'Elegir un patio' : 'Cambiar el patio', () => modo('patio'), 'boton-edn secundario'));
    }
    ui.cifras.replaceChildren(...filas);
    pintarSupuestos();
  }
  // La sombra del mapa: a qué hora es y qué significa cada tono.
  function pintarHora() {
    if (!ui.hora) return;
    const hora = horaBarra();
    const hijos = [B.el('h4', { clase: 'edn-sub', texto: 'La sombra en el mapa' })];
    if (E.sinSol) {
      const ver = doc.querySelector('#sb-noche button[data-min="540"]');
      hijos.push(B.el('p', { clase: 'nota', texto: `A la hora de la barra del sol${hora ? ' (' + hora + ')' : ''} no hay sol directo, así que no hay sombra que dibujar. Mueve la hora en la barra del sol.` }));
      if (ver) hijos.push(boton('Ver la sombra a las 9 a. m.', () => ver.click(), 'boton-edn secundario'));
    } else {
      hijos.push(B.el('p', { clase: 'nota', texto: `A la hora de la barra del sol${hora ? ': ' + hora : ''}. Mueve la hora para ver otra.` }));
      const tono = (clase, texto) => B.el('li', null, B.el('span', { clase: 'edn-tono ' + clase, 'aria-hidden': 'true' }), texto);
      hijos.push(B.el('ul', { clase: 'edn-tonos' },
        tono('segura', 'Sombra segura: la hace el edificio aunque sus pisos midan 2,8 m.'),
        tono('banda', 'Sombra en la franja: solo si los pisos miden más, hasta 3,3 m.'),
        tono('sol', 'Sol seguro: el edificio no le quita sol a esta hora. El círculo marca los 200 m que contamos.')));
      hijos.push(B.el('div', { clase: 'meta' }, B.marca('inferido'), B.el('span', { texto: 'Sombra calculada aquí con el sol y una franja de alto de piso' })));
    }
    ui.hora.replaceChildren(...hijos);
  }

  // ── Enlace y ficha ───────────────────────────────────────────────────────
  function enlace() {
    const u = new URL(location.href);
    if (E.esc) u.searchParams.set('edificio', C.escribirEscenario(E.esc));
    return u.href.replace(/%2C/g, ',');
  }
  function copiarEnlace() {
    const url = enlace();
    const listo = () => { ui.copiado.textContent = 'Enlace copiado. Quien lo abra ve este mismo escenario.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(listo, () => { ui.copiado.textContent = url; });
    else ui.copiado.textContent = url;
  }
  function planoSvg(f) {
    const NS = 'http://www.w3.org/2000/svg', L = 240, s = L / 2 / (C.RADIO * 1.08);
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${L} ${L}`); svg.setAttribute('class', 'edn-plano'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Plano del lote, el edificio, el círculo de 200 m y el patio');
    const xy = (p) => [L / 2 + p[0] * s, L / 2 - p[1] * s];
    const add = (tag, attrs) => { const n = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    const pts = (arr) => arr.map((p) => xy(p).map((v) => v.toFixed(1)).join(',')).join(' ');
    add('circle', { cx: L / 2, cy: L / 2, r: C.RADIO * s, fill: '#fbf3d6', stroke: '#a88a1e', 'stroke-dasharray': '4 3' });
    const sol = solActual();
    const vol = volumenDe(f.esc);
    if (sol) {
      const H1 = C.sombra(vol.pts, f.esc.pisos * C.M_PISO[1], sol), H0 = C.sombra(vol.pts, f.esc.pisos * C.M_PISO[0], sol);
      if (H1) add('polygon', { points: pts(H1), fill: '#c9c4e3', stroke: COLOR.sombra, 'stroke-dasharray': '3 3' });
      if (H0) add('polygon', { points: pts(H0), fill: '#8f89b3' });
    }
    add('polygon', { points: pts(loteDe(f.esc)), fill: 'none', stroke: COLOR.lote, 'stroke-width': 1.5, 'stroke-dasharray': '2 2' });
    add('polygon', { points: pts(vol.pts), fill: COLOR.sombra });
    if (f.res.patio) { const c = xy(f.res.patio.xy); add('circle', { cx: c[0], cy: c[1], r: 5, fill: '#fff', stroke: COLOR.sombra, 'stroke-width': 2.5 }); }
    add('text', { x: L - 14, y: 18, 'font-size': 12, 'text-anchor': 'middle', fill: '#1f1f1f' }).textContent = 'N';
    add('path', { d: `M${L - 14} 22 l-4 10 h8 z`, fill: '#1f1f1f' });
    add('line', { x1: 10, y1: L - 12, x2: 10 + 50 * s, y2: L - 12, stroke: '#1f1f1f', 'stroke-width': 2 });
    add('text', { x: 10, y: L - 17, 'font-size': 10, fill: '#1f1f1f' }).textContent = '50 m';
    return svg;
  }
  function imprimirFicha() {
    const f = E.ficha;
    if (!f || f.esc !== E.esc) { ui.copiado.textContent = 'Espera a que terminen las cuentas del paso 3 y vuelve a tocar «Ficha para imprimir».'; return; }
    const esc = f.esc, r = f.res, vol = volumenDe(esc);
    const fila = (k, ...v) => B.el('tr', null, B.el('th', { texto: k }), B.el('td', null, ...v));
    const conMarca = (t, m) => [t + ' ', B.marca(m)];
    const fecha = f.cuando.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' });
    const p = r.patio;
    const hora = horaBarra();
    const hoja = B.el('section', { id: 'edificio-ficha', clase: 'edn-ficha', 'aria-label': 'Ficha del escenario' },
      B.el('h1', { texto: 'Edificio nuevo: el sol que les quita a los vecinos' }),
      B.el('p', { texto: B.frase(`Ficha de Bogotwin, un gemelo digital abierto e independiente de Bogotá. Hecha el ${fecha}. Este documento solo muestra una cuenta: no aprueba ni niega ninguna obra.`) }),
      B.el('p', { clase: 'edn-url' }, 'Enlace del escenario: ', B.el('span', { texto: enlace() })),
      B.el('div', { clase: 'edn-ficha-dos' },
        B.el('div', null,
          B.el('h2', { texto: 'El escenario' }),
          B.el('table', null, B.el('tbody', null,
            fila('Centro del lote', `${esc.lat.toFixed(6)}, ${esc.lon.toFixed(6)} (latitud, longitud)`),
            fila('Lote', `${m1(esc.ancho)} por ${m1(esc.fondo)} m, girado ${Math.round(esc.giro)}°`),
            fila('Edificio', `${esc.pisos} pisos, retroceso de ${m1(esc.retroceso)} m, huella del ${esc.huella} %: ${m1(vol.ancho)} por ${m1(vol.fondo)} m`),
            fila('Alto', ...conMarca(`de ${m1(esc.pisos * C.M_PISO[0])} a ${m1(esc.pisos * C.M_PISO[1])} m`, 'supuesto')),
            fila('Alrededor', `${B.num(f.nConstrucciones)} construcciones de Catastro y ${B.num(f.nArboles)} árboles del censo a menos de ${ALCANCE} m`)))),
        B.el('figure', null, planoSvg(f), B.el('figcaption', { texto: `Plano: lote (raya), edificio (lleno), círculo de 200 m y patio (punto blanco).${hora && solActual() ? ' Sombra del ' + hora + ': oscura la segura, clara la de la franja.' : ''}` }))),
      B.el('h2', { texto: 'Lo que les quita a los vecinos' }),
      B.el('table', null, B.el('tbody', null,
        fila('Sol que pierde el suelo vecino en un año', ...conMarca(franjaHoras(r.horasM2), 'inferido')),
        fila('Equivale a dejar sin sol todo el año', ...conMarca(franja([redondo(r.horasM2[0] / horasPosibles), redondo(r.horasM2[1] / horasPosibles)], B.num, 'm²'), 'inferido')),
        p && !p.enLote && !p.enTecho ? fila(r.patioEsPeor ? 'Punto que más pierde en la mañana: minutos por mañana (7 a 10)' : 'Patio: minutos por mañana (7 a 10)', ...conMarca(franja(p.minutosDia, (v) => B.num(Math.round(v)), 'minutos'), 'inferido')) : null,
        p && !p.enLote && !p.enTecho ? fila('La peor mañana', ...conMarca(franja(p.peorDia, (v) => B.num(Math.round(v)), 'minutos menos'), 'inferido')) : null,
        p && !p.enLote && !p.enTecho ? fila('Días sin sol en el recreo (9:30 a 10:00)', ...conMarca(`${franja(p.diasRecreo, B.num, 'días')}; hoy tiene sol en el recreo ${franja(p.diasRecreoHoy, B.num, 'días', true)}`, 'inferido')) : null,
        p ? fila('Punto del patio', `${C.aLonLat(p.xy, [esc.lon, esc.lat]).reverse().map((v) => v.toFixed(6)).join(', ')}`) : null)),
      B.el('h3', { texto: 'Las cuatro combinaciones de la franja (horas·m² al año)' }),
      B.el('table', null, B.el('tbody', null, ...r.combos.map((c) => fila(`${B.num(c.mPiso)} m por piso, ${c.arboles ? 'copas que tapan' : 'copas que dejan pasar el sol'}`, B.num(redondo(c.horasM2)))))),
      B.el('h2', { texto: 'Supuestos' }),
      B.el('ul', null, ...supuestos(f.cerros).map((t) => B.el('li', { texto: t }))),
      B.el('h2', { texto: 'Datos y licencias' }),
      B.el('ul', null,
        B.el('li', { texto: 'Pisos y huellas de cada construcción: UAECD (Catastro Bogotá), Datos Abiertos Bogotá, corte de octubre de 2026; teselas del 23 nov 2026. CC BY 4.0.' }),
        B.el('li', { texto: `Árboles: censo del arbolado urbano SIGAU del Jardín Botánico de Bogotá José Celestino Mutis, Datos Abiertos Bogotá, ficha del 27 oct 2026; teselas del 24 nov 2026. CC BY 4.0.${f.arboles ? '' : ' Esta vez no cargaron: la cuenta va sin árboles.'}` }),
        B.el('li', { texto: 'Relieve para la sombra de los cerros: Modelo Digital de Terreno de Bogotá 2025 (MDT 2025), Secretaría Distrital de Planeación y UAECD, publicado por IDECA, CC BY 4.0; alrededor del Distrito, Copernicus DEM GLO-30 (produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved).' }),
        B.el('li', { texto: 'Posición del sol: calculada aquí con las ecuaciones públicas del NOAA Solar Calculator (Meeus).' })),
      B.el('h2', { texto: 'Versión' }),
      B.el('p', { texto: `Cálculo: ${VERSION}. Año de cuenta: ${C.ANIO}.` }),
      B.el('h2', { texto: 'Cómo comprobarlo' }),
      B.el('ol', null,
        B.el('li', { texto: 'Abre el enlace en otro equipo: salen el mismo lote, el mismo edificio y las mismas cifras.' }),
        B.el('li', { texto: 'El largo de la sombra se revisa a mano: alto del edificio dividido por la tangente de la altura del sol. A las 8 a. m. el sol de Bogotá anda cerca de 20° a 30°, y la sombra mide de 2 a 3 veces el alto.' }),
        B.el('li', { texto: 'Las cuentas están en el código abierto del visor (site/edificio-calculo.js). Su prueba (pruebas/edificio-calculo.prueba.js) compara la sombra con la de las sombras del mapa y los minutos del patio con una cuenta aparte, día por día.' }),
        B.el('li', { texto: 'Los pisos de cada vecino se ven tocando su construcción en el mapa.' })),
      B.el('p', { clase: 'nota', texto: 'Proyecto independiente. No es de la Alcaldía de Bogotá ni de sus entidades. Los nombres de las entidades aparecen solo para dar crédito a sus datos.' }));
    const vieja = doc.getElementById('edificio-ficha');
    if (vieja) vieja.replaceWith(hoja); else doc.body.append(hoja);
    raiz.print();
  }

  // ── Abrir y cerrar ───────────────────────────────────────────────────────
  function abrir() {
    if (!E.abierto) {
      E.abierto = true;
      armarPanel();
      armarTirador();
      armarAviso();
      ponerCapas();
      raiz.addEventListener('bogotwin:sol', () => pedirDibujo(performance.now()));
    }
    if (!mapa.getSource('edn-volumen')) ponerCapas();
    const q = new URLSearchParams(location.search).get('edificio');
    if (!E.esc && q) {
      const esc = C.leerEscenario(q);
      if (esc) {
        E.esc = esc; E.deCatastro = null; alCambiarLote(true);
        // Quien llega con el enlace ve primero la tarjeta del escenario, no el buscador.
        const t = doc.getElementById('edificio');
        if (t) t.scrollIntoView({ block: 'start' });
        return;
      }
      pintarPanel();
      ui.p1texto.textContent = 'El enlace trae un edificio que no pudimos leer. Elige el lote en el mapa.';
      return;
    }
    pintarPanel();
    if (!E.esc) modo('lote');
  }
  function cerrar() {
    clearTimeout(E.tCalc); E.token++;
    E.esc = null; E.res = null; E.ficha = null; E.claveR = null;
    modo('nada');
    for (const id of FUENTES) poner(id, fc([]));
    escribirUrl();
    ui.cuerpo.replaceChildren(boton('Probar un edificio', () => { armarPanel(); abrir(); }));
    ponerTirador();
  }

  B.edificioNuevo = { abrir, cerrar, tomaClic, estado: E, quitarCapas };
})(window);
