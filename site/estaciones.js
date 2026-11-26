'use strict';
// Estaciones de TransMilenio y del Metro: nombres de presentación (el crudo de la fuente queda
// a la vista en la ventana), cruce con los buses troncales programados del GTFS y la ventana
// de cada estación. El cálculo es puro y se prueba en pruebas/estaciones.prueba.js.
(function () {
  const B = window.Bogotwin = window.Bogotwin || {};
  const FRECUENCIA = 'datos/transporte/troncal-frecuencia.json';
  const TRONCALES = 'datos/transporte/troncales.geojson';

  // ── Nombres ──
  // Nombres que no salen bien con la regla general: la parte antes del guion no basta sola
  // («Suba», «NQS», «Ricaurte») o la fuente trae abreviaturas y tildes perdidas.
  const PROPIOS = {
    'Suba - AV. Boyacá': 'Suba Av. Boyacá', 'Suba - Calle 95': 'Suba Calle 95', 'Suba - Calle 116': 'Suba Calle 116',
    'Suba - Calle 100': 'Suba Calle 100', 'NQS - Calle 30 S': 'NQS Calle 30 Sur', 'Ricaurte - NQS': 'Ricaurte NQS',
    'Ricaurte - CL 13': 'Ricaurte Calle 13', 'AV. Américas - AV. Boyacá': 'Av. Américas Av. Boyacá',
    'Tygua - San José': 'Tygua San José', 'Guatoque - Veraguas': 'Guatoque Veraguas', 'CDS - Carrera 32': 'CDS Carrera 32',
    'Salitre - El Greco': 'Salitre El Greco', 'CC Paseo Villa del Río - Madelena': 'Madelena',
    'Granja - Kr 77': 'Granja Carrera 77', 'Cl38A sur - CENTRO MAYOR': 'Calle 38A Sur', 'Quinta Paredes -RTVC': 'Quinta Paredes',
    'Pepe Sierra Universidad UTEL': 'Pepe Sierra', 'AV. ElDorado': 'Av. El Dorado', 'AV. 1 Mayo': 'Av. Primero de Mayo',
    'Toberin': 'Toberín', 'San Facon Carrera 22': 'San Façon Carrera 22'
  };
  // Dos puntos de la fuente se llaman igual («Temporal AV. Jiménez - Inter Eléctricas»): el
  // 14003 es la de la Calle 13 sobre el Eje Ambiental y no es temporal; el 09110 sí lo es.
  const POR_CODIGO = { 14003: 'Av. Jiménez de la Calle 13' };

  function nombreTm(nombre, codigo) {
    const crudo = String(nombre || '').trim();
    if (POR_CODIGO[Number(codigo)]) return POR_CODIGO[Number(codigo)];
    if (PROPIOS[crudo]) return PROPIOS[crudo];
    // Lo que va después de « - » o « – » es casi siempre un patrocinio o un apellido de la estación.
    const corto = crudo.split(/\s+[-–]\s+/)[0];
    return corto.replace(/\bAV\.\s*/g, 'Av. ').trim();
  }

  // Metro: «Estación 12-Avenida Jimenez» pasa a «Estación 12 · Avenida Jiménez».
  const TILDES_METRO = { Jimenez: 'Jiménez', Americas: 'Américas', Boyaca: 'Boyacá' };
  function nombreMetro(nombre) {
    const m = /^Estaci[oó]n\s*(\d+)\s*(?:[-–]\s*(.*))?$/.exec(String(nombre || '').trim());
    if (!m) return String(nombre || '');
    const resto = (m[2] || '').trim().replace(/\p{L}+/gu, (w) => TILDES_METRO[w] || w);
    return 'Estación ' + m[1] + (resto ? ' · ' + resto : '');
  }

  // ── Cruce con los buses programados ──
  const suma = (s) => (s || []).reduce((a, b) => a + (Number(b) || 0), 0);
  function metros(lat1, lon1, lat2, lon2) {
    const k = Math.PI / 180;
    return 6371000 * Math.hypot((lon2 - lon1) * k * Math.cos((lat1 + lat2) / 2 * k), (lat2 - lat1) * k);
  }
  // Para cada punto de la capa (código y coordenadas), la estación del GTFS que le toca: la del
  // mismo código si tiene buses en día hábil; si no, la más cercana a menos de 300 m que ningún
  // otro punto reclama por código (así Granja Kr 77, 04100 sin servicio, toma la 4004 que opera,
  // y Portal Usme o Danubio toman sus códigos 9000x). Sin nada de eso, la del mismo código.
  function cruzar(doc, puntos) {
    const est = (doc && doc.estaciones) || [];
    const porCodigo = new Map(est.map((e, i) => [Number(e.id), i]));
    const reclamados = new Set(puntos.map((p) => porCodigo.get(Number(p.codigo))).filter((i) => i !== undefined));
    return puntos.map((p) => {
      const propio = porCodigo.get(Number(p.codigo));
      if (propio !== undefined && suma(est[propio].f && est[propio].f.habil) > 0) return propio;
      let mejor = -1, dMejor = 300;
      est.forEach((e, i) => {
        if (reclamados.has(i) || !(suma(e.f && e.f.habil) > 0)) return;
        const d = metros(p.lat, p.lon, e.lat, e.lon);
        if (d < dMejor) { dMejor = d; mejor = i; }
      });
      if (mejor >= 0) return mejor;
      return propio !== undefined ? propio : -1;
    });
  }
  const sinServicio = (doc, i) => i < 0 || !(suma(doc.estaciones[i].f && doc.estaciones[i].f.habil) > 0);

  // Fecha del GTFS para el texto: «25 nov 2026».
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fechaGtfs(doc) {
    const m = /GTFS_(\d{4})(\d{2})(\d{2})/.exec((doc && doc.fuente && doc.fuente.archivo) || '');
    return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '';
  }
  // Tipo de día y hora en Bogotá, sin depender de la zona del teléfono (igual que frecuencia.js).
  function momento(ms, festivos) {
    const b = new Date(ms - 5 * 3600000);
    const ymd = b.toISOString().slice(0, 10), dia = b.getUTCDay();
    const tipo = dia === 0 || (festivos || []).includes(ymd) ? 'domingo' : dia === 6 ? 'sabado' : 'habil';
    return { tipo, hora: b.getUTCHours() };
  }

  const calc = { nombreTm, nombreMetro, cruzar, sinServicio, fechaGtfs, momento, metros };

  // ── En el mapa ──
  let doc = null, bajando = null, cruce = null, fc = null, mapaRef = null;
  const bajarFrecuencia = () => doc ? Promise.resolve(doc) : (bajando || (bajando = fetch(FRECUENCIA)
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((d) => { doc = d; return d; })
    .catch((e) => { bajando = null; throw e; })));

  function pintar() {
    if (!mapaRef || !fc || !mapaRef.getSource('troncal')) return;
    fc.features.forEach((f, i) => {
      f.properties.corto = nombreTm(f.properties.nombre, f.properties.codigo);
      if (cruce) f.properties.sin_servicio = sinServicio(doc, cruce[i]);
    });
    mapaRef.getSource('troncal').setData(fc);
  }
  function cruzarYa() {
    if (cruce || !doc || !fc) return;
    cruce = cruzar(doc, fc.features.map((f) => ({ codigo: f.properties.codigo, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
    pintar();
  }
  // Los nombres van desde el arranque (la capa ya bajó el geojson; esto sale de la caché). Los
  // buses programados bajan cuando las estaciones se ven de cerca, no antes.
  function poner(mapa) {
    mapaRef = mapa;
    fetch(TRONCALES).then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((j) => { fc = { type: 'FeatureCollection', features: j.features.filter((f) => f.geometry && f.geometry.type === 'Point') }; pintar(); cruzarYa(); })
      .catch(() => {});
    const mirar = () => {
      if (doc || mapa.getZoom() < 12 || !mapa.getLayer('troncal') || mapa.getLayoutProperty('troncal', 'visibility') === 'none') return;
      mapa.off('idle', mirar);
      bajarFrecuencia().then(cruzarYa).catch(() => mapa.on('idle', mirar));
    };
    mapa.on('idle', mirar);
  }

  // Ventana de una estación de TransMilenio: p son las propiedades del punto, ll su [lon, lat].
  function ventana(p, ll, alVerBuses) {
    const el = B.el;
    const caja = el('div', { clase: 'estacion-pop' });
    const corto = nombreTm(p.nombre, p.codigo);
    caja.append(el('div', null, el('b', { texto: 'Estación de TransMilenio: ' }), corto));
    if (corto !== p.nombre) caja.append(el('div', { clase: 'nota', texto: 'En la fuente: ' + p.nombre }));
    const buses = el('div', { clase: 'estacion-buses' }, el('span', { clase: 'nota', texto: 'Trayendo los buses programados…' }));
    caja.append(buses);
    const ir = el('button', { type: 'button', clase: 'aviso-boton', texto: 'Ver buses por hora' });
    ir.addEventListener('click', () => { if (alVerBuses) alVerBuses(); });
    caja.append(ir);
    caja.append(B.meta({ tipo: 'de_fuente', fuente: 'TransMilenio S.A.', licencia: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' } }));
    bajarFrecuencia().then((d) => {
      cruzarYa();
      const k = fc ? fc.features.findIndex((f) => String(f.properties.codigo) === String(p.codigo) && f.properties.nombre === p.nombre) : -1;
      const i = k >= 0 && cruce ? cruce[k] : cruzar(d, [{ codigo: p.codigo, lon: ll[0], lat: ll[1] }])[0];
      const fecha = fechaGtfs(d);
      if (sinServicio(d, i)) {
        buses.replaceChildren(el('div', { texto: 'Sin buses troncales programados en el GTFS del ' + fecha + '.' }));
        return;
      }
      const m = momento(Date.now(), d.festivos);
      const n = Number(d.estaciones[i].f[m.tipo][m.hora]) || 0;
      buses.replaceChildren(el('div', null, el('b', { texto: 'Buses troncales programados a esta hora: ' }), B.valor(String(n), 'inferido')),
        el('div', { clase: 'nota', texto: 'Programados en el GTFS del ' + fecha + ', no son los buses en la calle.' }));
    }).catch(() => buses.replaceChildren(el('div', { clase: 'nota', texto: 'No pudimos traer los buses programados.' })));
    return caja;
  }

  B.estaciones = { calc, poner, ventana, nombreMetro };
})();
