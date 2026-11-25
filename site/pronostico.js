'use strict';
// Tarjetas del pronóstico (48 h en El Dorado, con su marcador de acierto) y del aire (PM2,5 a
// 5 días para toda la ciudad). Las baja cielo.js después del primer cuadro del mapa.
(function () {
  const B = window.Bogotwin;
  const V = B.vivo;
  const { el, valor, num, meta } = B;
  const pCuerpo = document.getElementById('pron-cuerpo'), pEstado = document.getElementById('pron-estado');
  const aCuerpo = document.getElementById('aire-cuerpo'), aEstado = document.getElementById('aire-estado');
  if (!pCuerpo || !aCuerpo) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, texto) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (texto != null) n.textContent = texto;
    return n;
  };
  const horaBog = (t) => Number(new Date(t).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' })) % 24;
  const diaCorto = (t) => new Date(t).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: 'America/Bogota' }).replace('.', '');
  const lic = (f) => f && f.licencia ? { nombre: f.licencia.nombre, url: f.licencia.url } : null;
  const estadoCon = (j, texto, enlace) => {
    const lim = V.limiteMin(j.cadencia_min) || 120;
    return [B.horaYEdad(j.generado, lim, 'Sin dato reciente'), '. ' + texto + ' ', B.enlace(enlace, 'Ver el JSON')];
  };

  // Gráfica de 48 h: temperatura en línea y probabilidad de lluvia en barras, colores planos.
  function grafica(horas) {
    const W = 320, H = 150, iz = 30, de = 6, arT = 10, abT = 78, arL = 92, abL = 128;
    const t0 = horas[0].t, t1 = horas[horas.length - 1].t;
    const x = (t) => iz + (W - iz - de) * (t - t0) / Math.max(1, t1 - t0);
    const temps = horas.map((h) => h.temp).filter(Number.isFinite);
    const lo = Math.floor(Math.min(...temps)) - 1, hi = Math.ceil(Math.max(...temps)) + 1;
    const y = (c) => abT - (abT - arT) * (c - lo) / Math.max(1, hi - lo);
    const yl = (p) => abL - (abL - arL) * p / 100;
    const resumen = `Temperatura entre ${num(Math.min(...temps))} y ${num(Math.max(...temps))} °C en las próximas 48 horas.`;
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pron-grafica', role: 'img', 'aria-label': resumen });
    // Rejilla: días a medianoche y horas cada 6. Los rótulos que se montarían se quitan.
    const marcas = [];
    for (const h of horas) {
      const hb = horaBog(h.t);
      if (hb % 6) continue;
      const xx = x(h.t);
      s.append(sv('line', { x1: xx, x2: xx, y1: arT - 4, y2: abL, class: hb === 0 ? 'g-dia' : 'g-hora' }));
      marcas.push({ x: xx, dia: hb === 0, texto: hb === 0 ? diaCorto(h.t) : hb === 12 ? '12 m' : hb === 6 ? '6 a. m.' : '6 p. m.' });
    }
    for (const r of V.rotulosEje(marcas, 2, W - 1)) {
      s.append(sv('text', { x: r.x, y: H - 6, class: 'g-rot' + (r.dia ? ' g-rot-dia' : ''), 'text-anchor': r.ancla }, r.texto));
    }
    // Escala de temperatura.
    for (const c of [lo + 1, Math.round((lo + hi) / 2), hi - 1]) {
      s.append(sv('text', { x: iz - 4, y: y(c) + 3, class: 'g-rot', 'text-anchor': 'end' }, `${c}°`));
    }
    s.append(sv('text', { x: iz - 4, y: yl(100) + 6, class: 'g-rot', 'text-anchor': 'end' }, '100%'));
    s.append(sv('line', { x1: iz, x2: W - de, y1: abL, y2: abL, class: 'g-base' }));
    // Barras de lluvia.
    const ancho = Math.max(1.5, (W - iz - de) / horas.length - 1);
    for (const h of horas) {
      if (!Number.isFinite(h.prob) || h.prob <= 0) continue;
      s.append(sv('rect', { x: x(h.t) - ancho / 2, y: yl(h.prob), width: ancho, height: abL - yl(h.prob), class: 'g-lluvia' }));
    }
    s.append(sv('line', { x1: iz, x2: W - de, y1: yl(50), y2: yl(50), class: 'g-medio' }));
    // Línea de temperatura.
    const pts = horas.filter((h) => Number.isFinite(h.temp)).map((h) => `${x(h.t).toFixed(1)},${y(h.temp).toFixed(1)}`).join(' ');
    s.append(sv('polyline', { points: pts, class: 'g-temp' }));
    return s;
  }

  function tablaHoras(horas) {
    const d = el('details', { clase: 'mas' }, el('summary', { texto: 'Ver hora por hora' }));
    const t = el('table', { clase: 'pron-tabla' });
    t.append(el('thead', null, el('tr', null, el('th', { texto: 'Hora' }), el('th', { texto: 'Temperatura' }), el('th', { texto: 'Lluvia' }))));
    const tb = el('tbody');
    for (const h of horas.filter((_, i) => i % 3 === 0)) {
      tb.append(el('tr', null, el('td', { texto: B.frase(`${diaCorto(h.t)}, ${B.horaLocal(new Date(h.t).toISOString())}`) }),
        el('td', null, valor(Number.isFinite(h.temp) ? `${num(h.temp)} °C` : 'sin dato', 'estimado', true)),
        el('td', null, valor(Number.isFinite(h.prob) ? `${h.prob} %` : 'sin dato', 'estimado', true))));
    }
    t.append(tb);
    d.append(t);
    return d;
  }

  function bloqueAcierto(j) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', { texto: 'Cuánto ha acertado' }));
    let m;
    try { m = V.marcador(j); } catch { frag.append(el('p', { clase: 'estado', texto: 'No pudimos leer el marcador de acierto.' })); return frag; }
    if (m.vacio) {
      frag.append(el('p', { clase: 'estado', texto: 'El marcador arranca cuando haya días calificados.' }),
        el('p', { clase: 'nota', texto: 'Cada día cerrado comparamos lo que dijo el pronóstico con lo que midió el termómetro de El Dorado. Mientras no haya días comparados, no mostramos cifras.' }));
    } else {
      const celda = (w, p, que) => {
        const x = m[w][p];
        if (que === 'temp') return x.error == null ? el('span', { clase: 'nota', texto: 'aún sin horas' }) : valor(`${num(x.error)} °C`, 'inferido', true);
        return x.porcentaje == null ? el('span', { clase: 'nota', texto: 'aún sin bloques' }) : valor(`${num(x.porcentaje)} %`, 'inferido', true);
      };
      const t = el('table', { clase: 'pron-tabla acierto' });
      t.append(el('thead', null, el('tr', null, el('th', { texto: '' }),
        el('th', { texto: `7 días (${m.v7.dias} calificados)` }), el('th', { texto: `30 días (${m.v30.dias})` }))));
      const tb = el('tbody');
      for (const [p, rotulo] of [['a24h', 'un día antes'], ['a48h', 'dos días antes']]) {
        tb.append(el('tr', null, el('th', { texto: `Error medio de temperatura, ${rotulo}` }), el('td', null, celda('v7', p, 'temp')), el('td', null, celda('v30', p, 'temp'))));
        tb.append(el('tr', null, el('th', { texto: `Acierto de lluvia, ${rotulo}` }), el('td', null, celda('v7', p, 'lluvia')), el('td', null, celda('v30', p, 'lluvia'))));
      }
      t.append(tb);
      frag.append(t, el('p', { clase: 'nota', texto: 'El error medio es cuántos grados se equivocó en promedio, hacia arriba o hacia abajo. El acierto de lluvia cuenta bloques de 6 horas: si dijo que llovería (50 % o más) y llovió en El Dorado, o si dijo que no y no llovió. El termómetro del aeropuerto redondea a grados enteros.' }));
    }
    const p = el('p', { clase: 'estado' }, B.horaYEdad(j.generado, V.limiteMin(j.cadencia_min) || 2880, 'Sin dato reciente'), '. Se califica una vez al día. ',
      B.enlace(V.BASE + 'pronostico/acierto.json', 'Ver el JSON'));
    frag.append(p, meta({ tipo: 'inferido', licencia: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' }, fuente: 'calculado aquí con Open‑Meteo y el METAR de El Dorado' }));
    return frag;
  }

  function pintarPronostico(j, acierto) {
    const horas = V.horasPronostico(j);
    pCuerpo.replaceChildren();
    if (horas.length < 2) throw new Error('sin horas');
    // Solo las horas desde ahora: la gráfica sí arranca en la hora en curso.
    const { tmin, tmax, lluvia } = V.resumen24(horas, Date.now());
    if (tmin != null) {
      pCuerpo.append(el('div', { clase: 'dato' },
        valor(`${num(tmin)} a ${num(tmax)} °C`, 'estimado'),
        el('span', { clase: 'que', texto: 'Temperatura que espera el modelo en las próximas 24 horas' })));
    }
    if (lluvia) {
      pCuerpo.append(el('div', { clase: 'dato' },
        valor(`${lluvia.prob} %`, 'estimado', true),
        el('span', { clase: 'que', texto: B.frase(lluvia.prob >= 50
          ? `Probabilidad de lluvia más alta en las próximas 24 horas, ${diaCorto(lluvia.t)} cerca de las ${B.horaLocal(new Date(lluvia.t).toISOString())}.`
          : 'Probabilidad de lluvia más alta en las próximas 24 horas. No pasa del 50 %.') })));
    }
    pCuerpo.append(grafica(horas),
      el('div', { clase: 'g-leyenda', 'aria-hidden': 'true' },
        el('span', { clase: 'g-l-temp' }), 'Temperatura', el('span', { clase: 'g-l-lluvia' }), 'Probabilidad de lluvia', el('span', { clase: 'g-l-medio' }), '50 %'),
      tablaHoras(horas),
      meta({ tipo: 'estimado', licencia: lic(j.fuente), fuente: 'Weather data by Open-Meteo.com' }),
      el('p', { clase: 'nota', texto: 'Es el pronóstico de un modelo para el aeropuerto El Dorado, en el occidente. No es el de cada barrio. Las alertas oficiales son del IDEAM y del IDIGER.' }));
    pEstado.replaceChildren(...estadoCon(j, 'Lo renovamos cerca de cada hora.', V.BASE + 'pronostico/ahora.json'));
    if (acierto) pCuerpo.append(bloqueAcierto(acierto));
    else pCuerpo.append(el('h3', { texto: 'Cuánto ha acertado' }), el('p', { clase: 'estado', texto: 'No pudimos traer el marcador de acierto en esta consulta.' }));
  }

  function pintarAire(j) {
    const dias = V.diasAire(j, 5);
    aCuerpo.replaceChildren();
    if (!dias.length) throw new Error('sin días');
    const tope = Math.max(V.OMS_24H * 2, ...dias.map((d) => d.maxima));
    const lista = el('div', { clase: 'aire-dias' });
    for (const d of dias) {
      const fecha = B.fechaLocal(d.fecha + 'T12:00:00-05:00');
      // Anchos por CSSOM (la CSP no deja atributos style en línea).
      const pct = (x) => (100 * x / tope).toFixed(1) + '%';
      const max = el('span', { clase: 'aire-max' }), med = el('span', { clase: 'aire-media' + (d.pasaOms ? ' pasa' : '') }), oms = el('span', { clase: 'aire-oms' });
      max.style.width = pct(d.maxima); med.style.width = pct(d.media); oms.style.left = pct(V.OMS_24H);
      const barra = el('div', { clase: 'aire-barra', 'aria-hidden': 'true' }, max, med, oms);
      lista.append(el('div', { clase: 'aire-dia' },
        el('span', { clase: 'aire-fecha', texto: fecha + (d.horas < 20 ? ` (${d.horas} h)` : '') }),
        el('span', { clase: 'aire-cifras' }, 'media ', valor(num(d.media), 'estimado', true), ', máxima ', valor(num(d.maxima), 'estimado', true)),
        barra,
        d.pasaOms ? el('span', { clase: 'aire-nota', texto: 'La media pasa la guía de la OMS' }) : null));
    }
    aCuerpo.append(
      el('p', { clase: 'que', texto: 'PM2,5 en µg/m³ para toda la ciudad. La barra oscura es la media del día, la clara la hora más alta y la raya la guía de la OMS.' }),
      lista,
      meta({ tipo: 'estimado', licencia: lic(j.fuente), fuente: 'CAMS (Copernicus) vía Open‑Meteo, celda de 45 km' }),
      el('p', { clase: 'nota', texto: 'Es un modelo con una sola celda de unos 45 km para toda Bogotá: no dice cómo está tu barrio. La guía de la OMS (2021) pide que la media de 24 horas no pase de 15 µg/m³; es una referencia de salud, no una alerta. No mostramos cuánto acierta porque las medidas de la red de la ciudad no declaran licencia. El índice oficial de Bogotá es el IBOCA de la Secretaría de Ambiente.' }));
    aEstado.replaceChildren(...estadoCon(j, 'Lo renovamos cerca de cada hora.', V.BASE + 'aire/pronostico.json'));
  }

  const traer = (f) => fetch(V.url(f), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  let primera = true;
  async function cargar() {
    const [p, a, r] = await Promise.allSettled([traer('pronostico/ahora.json'), traer('pronostico/acierto.json'), traer('aire/pronostico.json')]);
    try { if (p.status !== 'fulfilled') throw p.reason; pintarPronostico(p.value, a.status === 'fulfilled' ? a.value : null); }
    catch { if (primera) pEstado.textContent = 'No pudimos traer el pronóstico. Lo intentamos de nuevo en 30 minutos.'; }
    try { if (r.status !== 'fulfilled') throw r.reason; pintarAire(r.value); }
    catch { if (primera) aEstado.textContent = 'No pudimos traer el pronóstico del aire. Lo intentamos de nuevo en 30 minutos.'; }
    primera = false;
  }
  cargar();
  setInterval(cargar, 30 * 60000);
})();
