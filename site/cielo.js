'use strict';
// Tarjeta del cielo (JSON que se arma cada 20 min) y tarjeta de noches frías (registro diario).
(function () {
  const B = window.Bogotwin;
  const { el, meta, valor, num } = B;
  const VIVO = 'https://caamanoluismiguel.github.io/gemelo-bogota-vivo/cielo/';
  const estado = document.getElementById('cielo-estado');
  const cuerpo = document.getElementById('cielo-cuerpo');
  const KMH = 1.852;

  const horaBogota = () => Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }));
  const categoriaUV = (x) => x < 3 ? 'bajo' : x < 6 ? 'moderado' : x < 8 ? 'alto' : x < 11 ? 'muy alto' : 'extremo';
  const lic = (f) => f && f.licencia ? { nombre: f.licencia.nombre, url: f.licencia.url } : null;

  function falla(titulo, f) {
    return el('div', { clase: 'dato falla' },
      el('span', { clase: 'que', texto: titulo }),
      el('span', { texto: 'Sin dato en la última consulta. No mostramos un valor viejo en su lugar.' }),
      f && f.hora_consulta ? el('div', { clase: 'nota' }, 'Consultado ', B.edad(f.hora_consulta)) : null);
  }

  function bloqueMetar(f) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', { texto: 'Temperatura del aire' }));
    for (const e of f.estaciones || []) {
      if (e.temperatura_c == null) continue;
      const viento = e.viento_nudos != null ? `viento ${Math.round(e.viento_nudos * KMH)} km/h` : null;
      frag.append(el('div', { clase: 'dato' },
        valor(`${num(e.temperatura_c)} °C`, 'medido'),
        el('span', { clase: 'que', texto: `Aeropuerto ${e.nombre}` + (viento ? `, ${viento}` : '') }),
        meta({ tipo: 'medido', hora: e.hora_dato, viejoMin: 90, licencia: lic(f), fuente: 'METAR' })));
    }
    frag.append(el('p', { clase: 'nota', texto: 'Es el aire a 2 m en la pista del aeropuerto, no en tu calle.' }));
    return frag;
  }

  function bloqueUV(f) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', { texto: 'Sol y UV' }));
    const h = horaBogota();
    const hoy = f.dias && f.dias.hoy, man = f.dias && f.dias.manana;
    const dia = h >= 6 && h < 18;
    if (dia && hoy) {
      frag.append(el('div', { clase: 'dato' },
        valor(num(f.uv_hora_actual), 'estimado'),
        el('span', { clase: 'que', texto: `Índice UV de esta hora, ${categoriaUV(f.uv_hora_actual)}` }),
        meta({ tipo: 'estimado', hora: f.hora_dato, viejoMin: 120, licencia: lic(f), fuente: 'CAMS' })));
      frag.append(el('div', { clase: 'dato' },
        valor(num(hoy.uv_max_con_nubes), 'estimado', true),
        el('span', { clase: 'que', texto: B.frase(`Máximo de hoy, ${categoriaUV(hoy.uv_max_con_nubes)}, cerca de las ${B.horaLocal(hoy.hora_uv_max)}. Con cielo despejado llegaría a ${num(hoy.uv_max_cielo_despejado)}.` )})));
    } else if (man) {
      frag.append(el('div', { clase: 'dato' },
        el('span', { clase: 'que', texto: 'De noche no hay UV.' }),
        valor(num(man.uv_max_con_nubes), 'estimado', true),
        el('span', { clase: 'que', texto: B.frase(`Máximo que se espera mañana, ${categoriaUV(man.uv_max_con_nubes)}, cerca de las ${B.horaLocal(man.hora_uv_max)}.` )}),
        meta({ tipo: 'estimado', hora: f.hora_dato, viejoMin: 180, licencia: lic(f), fuente: 'pronóstico CAMS' })));
    }
    frag.append(el('p', { clase: 'nota', texto: 'A 2.600 m el sol quema rápido aunque haga frío. Desde 3 conviene protegerse; desde 8 es muy alto. Es un modelo para una celda de unos 45 km, no una medida.' }));
    return frag;
  }

  function bloqueLluvia(f) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', { texto: 'Lluvia de hoy' }));
    const locs = (f.por_localidad || []).filter(l => l.acumulado_hoy_max_mm != null).sort((a, b) => b.acumulado_hoy_max_mm - a.acumulado_hoy_max_mm);
    // Solo los pluviómetros que reportan hoy, igual que la respuesta de «¿va a llover?».
    const reportan = (f.estaciones || []).filter(e => !e.sin_dato_hoy && Number.isFinite(e.acumulado_hoy_mm));
    const lloviendo = reportan.filter(e => e.ultimo_minuto_mm > 0).length;
    const total = reportan.length;
    frag.append(el('div', { clase: 'dato' },
      valor(`${lloviendo} de ${total}`, 'medido', true),
      el('span', { clase: 'que', texto: 'pluviómetros marcaron lluvia en el último minuto' })));
    if (locs.length) {
      const filas = el('div', { clase: 'filas' });
      for (const l of locs.slice(0, 4)) filas.append(el('span', { texto: B.nombrePropio(l.localidad) }), valor(`${num(l.acumulado_hoy_max_mm)} mm`, 'medido', true));
      frag.append(el('span', { clase: 'que', texto: 'Donde más ha llovido desde la medianoche (máximo por localidad):' }), filas);
    }
    frag.append(meta({ tipo: 'medido', hora: f.hora_dato, viejoMin: 30, licencia: lic(f), fuente: 'IDIGER, SAB' }));
    frag.append(el('p', { clase: 'nota' }, 'Datos crudos sin validar por completo. Las alertas oficiales son del ', B.enlace('https://www.idiger.gov.co', 'IDIGER'), '. Marca «Lluvia de hoy» en el mapa para ver cada pluviómetro.'));
    return frag;
  }

  function bloqueRadar(f) {
    if (!f || f.estado !== 'ok') return falla('Radar de Tablazo (IDEAM)', f);
    return el('div', { clase: 'dato' },
      el('span', { clase: 'que', texto: 'Radar de Tablazo (IDEAM)' }),
      el('span', { texto: f.texto || 'Con dato.' }),
      meta({ tipo: B.marcaDe(f.etiqueta, 'estimado'), hora: f.hora_dato, viejoMin: 360, licencia: lic(f) }),
      el('p', { clase: 'nota', texto: 'El radar se publica con unas horas de atraso.' }));
  }

  function bloqueGoes(f) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', { texto: 'Nubes vistas desde el satélite' }));
    const img = el('img', { clase: 'goes', src: VIVO + (f.archivo_local || 'goes19-bogota.jpg'), alt: 'Imagen GOES‑19 de Bogotá y la Sabana', loading: 'lazy', decoding: 'async', width: 240, height: 240 });
    frag.append(img, meta({ tipo: 'medido', hora: f.hora_dato, viejoMin: 60, licencia: lic(f), fuente: 'NOAA GOES‑19 vía NASA GIBS' }));
    frag.append(el('p', { clase: 'nota', texto: 'Color real de día; de noche, nubes en infrarrojo. No dice cuánto llueve.' }));
    return frag;
  }

  // «Ver más»: radar, satélite, fuego y sismos. La imagen del satélite no se baja hasta abrirlo.
  function bloqueMas(fs) {
    const d = el('details', { clase: 'mas' }, el('summary', { texto: 'Ver más: radar, satélite, fuego y sismos' }));
    d.append(bloqueRadar(fs.radar_tablazo));
    try { d.append(fs.goes19 && fs.goes19.estado === 'ok' ? bloqueGoes(fs.goes19) : falla('Satélite GOES‑19', fs.goes19)); }
    catch { d.append(falla('Satélite GOES‑19', fs.goes19)); }
    d.append(el('h3', { texto: 'Fuego y sismos cerca' }));
    const fc = fs.focos_calor;
    if (fc && fc.estado === 'ok') {
      d.append(el('div', { clase: 'dato' },
        valor(String(fc.conteo ?? 0), 'medido', true),
        el('span', { clase: 'que', texto: 'focos de calor vistos por satélite en la Sabana en las últimas 24 h' }),
        meta({ tipo: 'medido', hora: fc.hora_dato, licencia: lic(fc), fuente: 'NASA FIRMS' }),
        el('p', { clase: 'nota', texto: 'Un foco es un píxel de 375 m más caliente que su entorno: puede ser un incendio, una quema o una industria.' })));
    } else d.append(falla('Focos de calor (NASA FIRMS)', fc));
    const s = fs.sismos;
    if (s && s.estado === 'ok') {
      const ev = (s.eventos || []).slice(0, 3);
      d.append(el('span', { clase: 'que', texto: `Sismos de magnitud 2,5 o más a menos de 300 km, últimos 30 días: ${s.conteo ?? ev.length}` }));
      for (const e of ev) {
        d.append(el('div', { clase: 'dato' },
          valor(`M ${num(e.magnitud)}`, 'medido', true),
          el('span', { clase: 'que', texto: `a ${Math.round(e.distancia_centro_km)} km, ${B.fechaLocal(e.hora_dato)}` }),
          meta({ tipo: 'medido', hora: e.hora_dato, fuente: 'USGS' })));
      }
      d.append(el('p', { clase: 'nota' }, 'El catálogo oficial de Colombia es el del ', B.enlace('https://www.sgc.gov.co/sismos', 'Servicio Geológico Colombiano'), '.'));
    } else d.append(falla('Sismos (USGS)', s));
    return d;
  }

  // Hora real del dato y su edad, recalculada cada minuto. Pasado el doble de la cadencia
  // dice «sin dato reciente»: la cosecha depende de servicios de terceros y puede atrasarse.
  function horaYEdad(iso, limiteMin, sinTexto) {
    const s = el('span', { clase: 'hora-dato', 'data-hora': iso || '', 'data-limite': String(limiteMin), 'data-sin': sinTexto });
    pintarHora(s);
    return s;
  }
  function pintarHora(s) {
    const iso = s.dataset.hora;
    const min = B.minutosDesde(iso);
    if (min == null) { s.textContent = s.dataset.sin; s.classList.add('viejo'); return; }
    const cuando = min >= 20 * 60 ? `del ${B.fechaLocal(iso)}, a las ${B.horaLocal(iso)}` : `de las ${B.horaLocal(iso)}`;
    const viejo = min > Number(s.dataset.limite);
    s.textContent = (viejo ? `${s.dataset.sin}. Lo último es ${cuando}` : `Datos ${cuando}`) + `, ${B.edadTexto(min)}`;
    s.classList.toggle('viejo', viejo);
  }
  setInterval(() => document.querySelectorAll('.hora-dato[data-hora]').forEach(pintarHora), 60000);
  B.horaYEdad = horaYEdad;

  function pintarCielo(j) {
    const fs = j.fuentes || {};
    cuerpo.replaceChildren();
    const seccion = (nombre, f, fn) => {
      try { cuerpo.append(f && f.estado === 'ok' ? fn(f) : falla(nombre, f)); }
      catch { cuerpo.append(falla(nombre, f)); }
    };
    seccion('Temperatura (METAR)', fs.metar, bloqueMetar);
    seccion('Índice UV (CAMS)', fs.uv, bloqueUV);
    seccion('Lluvia (SAB)', fs.lluvia_sab, bloqueLluvia);
    cuerpo.append(bloqueMas(fs));
    estado.replaceChildren(horaYEdad(j.generado, 40, 'Sin dato reciente'), '. Lo armamos cerca de cada 20 minutos; a veces se atrasa. ', B.enlace(VIVO + 'ahora.json', 'Ver el JSON'));
    window.dispatchEvent(new CustomEvent('bogotwin:cielo', { detail: j }));
  }

  let primera = true;
  async function cargarCielo() {
    try {
      const r = await fetch(VIVO + 'ahora.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (j.esquema !== 'gemelo-bogota/cielo/1') throw new Error('esquema');
      pintarCielo(j);
      primera = false;
    } catch {
      if (primera) estado.textContent = 'No pudimos traer los datos del cielo. Revisa tu conexión; lo intentamos de nuevo en 10 minutos.';
    }
  }
  cargarCielo();
  setInterval(cargarCielo, 10 * 60000);

  // Pronóstico y aire: su código y sus JSON bajan después del primer cuadro del mapa (o de
  // cargar la página si no hay mapa), para que el arranque no pese más.
  let pronPedido = false;
  function pedirPronostico() {
    if (pronPedido) return;
    pronPedido = true;
    const js = (f) => new Promise((ok, mal) => { const s = el('script', { src: f }); s.onload = ok; s.onerror = mal; document.head.append(s); });
    (B.vivo ? Promise.resolve() : js('vivo-datos.js')).then(() => js('pronostico.js')).catch(() => {
      for (const id of ['pron-estado', 'aire-estado']) { const n = document.getElementById(id); if (n) n.textContent = 'No se pudo bajar esta tarjeta. Revisa la conexión y recarga la página.'; }
    });
  }
  const enCalma = () => window.requestIdleCallback ? requestIdleCallback(pedirPronostico, { timeout: 3000 }) : setTimeout(pedirPronostico, 1000);
  const trasPrimerCuadro = () => {
    const m = window.BogotwinMapa;
    if (m && !(m.loaded() && m.areTilesLoaded())) { m.once('idle', enCalma); setTimeout(pedirPronostico, 20000); }
    else enCalma();
  };
  if (document.readyState === 'complete') trasPrimerCuadro(); else addEventListener('load', trasPrimerCuadro, { once: true });

  // Noches frías: el sitio publica el último registro diario como datos/noches-frias/ultima.json.
  const nc = document.getElementById('noches-cuerpo');
  async function cargarNoches() {
    let j = null;
    try {
      const r = await fetch('datos/noches-frias/ultima.json', { cache: 'no-cache' });
      if (r.ok) j = await r.json();
    } catch { /* sin registro todavía */ }
    nc.replaceChildren();
    if (!j || j.esquema !== 'noches-frias/1') {
      nc.append(el('p', { clase: 'estado', texto: 'El registro empieza la mañana del 24 de noviembre de 2026. Cada mañana guardamos la mínima de la noche en los aeropuertos El Dorado y Guaymaral, y lo que esperan siete modelos para las noches siguientes.' }));
      return;
    }
    const umbral = j.umbrales ? j.umbrales.noche_fria_c : 6;
    nc.append(el('h3', { texto: `La noche que terminó el ${B.fechaLocal(j.fecha + 'T12:00:00-05:00')}` }));
    // La noche termina a las 6:00 de Bogotá; pasadas 48 h sin una noche nueva, el registro está atrasado.
    const finNoche = new Date(j.fecha + 'T06:00:00-05:00').getTime();
    const atrasado = Date.now() - finNoche > 48 * 3600000;
    const linea = el('p', { clase: 'estado' });
    if (atrasado) linea.append(el('span', { clase: 'hora-dato viejo', texto: 'Sin registro reciente' }), '. ');
    linea.append('Registrado ', B.edad(j.consultado_utc), j.relleno ? ', después de la noche: solo lo medido, faltó el pronóstico de ese día.' : '.');
    nc.append(linea);
    for (const m of j.medido || []) {
      if (m.minima_c == null) continue;
      const juicio = m.helada_a_2m ? 'Heló a 2 m.' : m.noche_fria ? `Noche fría: bajó de ${num(umbral)} °C.` : `No bajó de ${num(umbral)} °C.`;
      nc.append(el('div', { clase: 'dato' },
        valor(`${num(m.minima_c)} °C`, 'medido'),
        el('span', { clase: 'que', texto: B.frase(`Mínima en ${m.nombre}, a las ${B.horaLocal(m.hora_minima_local)}. ${juicio}` + (m.ventana_completa ? '' : ' Faltaron reportes esa noche.') )}),
        meta({ tipo: 'medido', fuente: 'METAR', licencia: { nombre: 'Dominio público (NOAA/NWS)', url: 'https://www.weather.gov/disclaimer' } })));
    }
    const pron = (j.pronostico || []).filter(p => p.rango_c && p.rango_c.bajo != null);
    if (pron.length) {
      nc.append(el('h3', { texto: 'Las próximas noches' }));
      const noches = [...new Set(pron.map(p => p.noche_que_termina))].sort();
      for (const n of noches) {
        const filas = el('div', { clase: 'filas' });
        for (const p of pron.filter(x => x.noche_que_termina === n)) {
          filas.append(el('span', { texto: p.nombre }), valor(`${B.numPar(p.rango_c.bajo, p.rango_c.alto).join(' a ')} °C`, B.marcaDe(p.etiqueta, 'estimado'), true));
        }
        nc.append(el('span', { clase: 'que', texto: `Mínima que esperan para la noche que termina el ${B.fechaLocal(n + 'T12:00:00-05:00')}:` }), filas);
      }
      nc.append(meta({ tipo: 'estimado', hora: j.consultado_utc, viejoMin: 30 * 60, fuente: 'rango entre 7 modelos, Open‑Meteo', licencia: { nombre: 'CC BY 4.0', url: 'https://open-meteo.com/en/licence' } }));
      nc.append(el('p', { clase: 'nota', texto: 'Cuánto aciertan estos rangos lo publicaremos después de 28 noches comparadas con lo medido. Esto es un registro, no una alerta: las alertas oficiales son del IDEAM y del IDIGER.' }));
    }
    nc.append(el('p', { clase: 'nota' }, 'Todos los días quedan guardados: ', B.enlace('https://github.com/caamanoluismiguel/gemelo-bogota/tree/main/data/noches-frias', 'ver el registro completo'), '.'));
  }
  cargarNoches();
})();
