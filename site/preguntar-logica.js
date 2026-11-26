'use strict';
// «Pregúntale a la ciudad»: entiende la pregunta y arma la respuesta con los datos que ya carga el
// visor. Sin servidor, sin claves y sin modelo de lenguaje: reglas sobre el texto y cuentas sobre
// nuestros JSON. Funciones puras: no tocan el mapa ni el DOM, las prueba pruebas/preguntar.prueba.js.
//
// Una respuesta es un objeto así:
//   { intencion, sabe, bloques: [[texto | {v, m}]], notas: [texto], procedencia: [{tipo, hora,
//     viejoMin, fuente, licencia}], vuelo: {bbox} | {centro, zoom} | null, capas: [selector],
//     acciones: [{texto, selector}], sugerencias: [pregunta] }
// {v, m} es una cifra con su marca (medido, de_fuente, estimado, inferido, supuesto), igual que
// en el panel. Si un dato no llegó, la respuesta lo dice; nunca rellena con un número inventado.
(function () {
  const BOGOTA_MS = -5 * 3600000; // UTC−5 todo el año
  const ZONA = 'America/Bogota';
  const CENTRO = [4.6097, -74.0817]; // el mismo centro que usa la barra del sol
  const ELDORADO = { lat: 4.706, lon: -74.151 };

  const LIC = {
    ccby: { nombre: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' },
    ccbysa: { nombre: 'CC BY‑SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' },
    ccbync: { nombre: 'CC BY‑NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.es' },
    openmeteo: { nombre: 'CC BY 4.0', url: 'https://open-meteo.com/en/licence' },
    noaa: { nombre: 'Dominio público (NOAA/NWS)', url: 'https://www.weather.gov/disclaimer' },
    cc0: { nombre: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.es' }
  };

  // Lo que se puede preguntar. Los chips salen de aquí, en este orden.
  const SUGERENCIAS = [
    '¿Cómo está el aire en Kennedy?',
    '¿Va a llover hoy?',
    '¿Hará frío esta noche?',
    '¿Cuál es el edificio más alto de Chapinero?',
    '¿Hay algún canal en alerta?',
    '¿Dónde hay bicis cerca de la 72?',
    '¿A qué hora sale el sol?',
    '¿Qué colegios tienen peor aire?'
  ];

  // ── Texto ──
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function normalizar(s) {
    return sinTildes(s).replace(/[¿?¡!.,;:"'«»()[\]{}/\\_–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const fmt1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
  const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const num = (x) => fmt1.format(x);
  const entero = (x) => fmt0.format(x);
  const hora = (ms) => new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA });
  const fecha = (ms) => new Date(ms).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: ZONA });
  const TILDES = { Usaquen: 'Usaquén', Bolivar: 'Bolívar', Engativa: 'Engativá', Fontibon: 'Fontibón', Cristobal: 'Cristóbal', Martires: 'Mártires', Narino: 'Nariño' };
  const ROMANO = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3})$/i;
  // Siglas que llegan en mayúscula y se quedan así: «(IED)», no «(Ied)».
  const SIGLAS = /^(?:IED|SED|IPS|USS|CAPS|UPA|CAMI|CDI|ESE|SAB|UPZ|UPL|IDIGER|RMCAB)$/;
  const propio = (s) => String(s || '').replace(/\p{L}+/gu, (w) => (SIGLAS.test(w) ? w : w.toLowerCase()))
    .replace(/(^|[\s(\-/.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\p{L}+/gu, (w) => TILDES[w] || (ROMANO.test(w) ? w.toUpperCase() : w));
  const v = (texto, marca) => ({ v: texto, m: marca });

  // Día de Bogotá: medianoche local en ms UTC.
  function inicioDia(ms) {
    const d = new Date(ms + BOGOTA_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - BOGOTA_MS;
  }
  const horaBogota = (ms) => new Date(ms + BOGOTA_MS).getUTCHours();
  const fechaIso = (ms) => new Date(ms + BOGOTA_MS).toISOString().slice(0, 10);

  // ── Intención ──
  // El orden importa: «¿qué colegios tienen peor aire?» es de colegios antes que de aire, y
  // «¿a qué hora sale el sol?» es del sol antes que del UV.
  const REGLAS = [
    ['no_se', /\b(trafico|trancon\w*|congestion|accidente\w*|tunel\w*|seguridad|robo\w*|hurto\w*|delito\w*|pico y placa|arriendo\w*|precio\w*|cuanto cuesta|vacuna\w*|eleccion\w*|ruido)\b/],
    ['colegios_aire', /\b(colegio\w*|escuela\w*|ied)\b/],
    ['edificio_alto', /\b(edificio\w*|torre\w*|rascacielo\w*|mas alt[oa]s?|pisos)\b/],
    ['canal', /\b(canal\w*|rio\w*|quebrada\w*|inunda\w*|desbord\w*|nivel del agua|crecient\w*)\b/],
    ['bicis', /\b(bici\w*|cicla\w*|tembici)\b/],
    ['sol', /\b(sale el sol|salida del sol|amanec\w*|se pone el sol|puesta del sol|atardec\w*|anochec\w*|oscurec\w*|sol sale|sol se pone)\b/],
    ['frio', /\b(frio\w*|helad\w*|minima|congel\w*|abrig\w*|noche fria)\b/],
    ['lluvia', /\b(llov\w*|lluvi\w*|llueve|aguacero\w*|paraguas|sombrilla|chubasco\w*|chaparron\w*)\b/],
    ['aire', /\b(aire|pm ?2 ?5|pm25|contamina\w*|smog|esmog|polucion|respira\w*)\b/],
    ['uv', /\b(uv|ultravioleta|bloqueador|protector solar|quema\w*)\b/],
    ['temperatura', /\b(temperatura|grados|calor|clima|caliente)\b/]
  ];
  function detectarIntencion(texto) {
    const n = normalizar(texto);
    if (!n) return { intencion: 'vacia', texto: n };
    for (const [nombre, re] of REGLAS) if (re.test(n)) return { intencion: nombre, texto: n };
    return { intencion: 'desconocida', texto: n };
  }

  // ── Lugares ──
  // Palabras que nunca nombran un lugar en estas preguntas: se quitan antes de buscar para que
  // «el sol» o «la noche» no se confundan con un barrio que se llame así.
  const RUIDO = /\b(como|esta|estan|el|la|los|las|en|de|del|hay|algun|alguna|donde|que|cual|cuales|hoy|esta noche|noche|manana|aire|sol|lluvia|frio|edificio|alto|mas|canal|alerta|bicis?|cerca|colegios?|peor|mejor|tienen|va|a|llover|hara|hora|sale|ahora)\b/g;
  const PRIORIDAD = { localidad: 0, upl: 1, sector: 2, barrio: 3 };
  // Índice del buscador (localidades, UPL, sectores y barrios). Devuelve el nombre más largo que
  // aparece completo en la pregunta; a igual largo gana la localidad sobre la UPL, el sector y el barrio.
  function prepararIndice(filas) {
    return (filas || []).map((f) => ({ n: normalizar(f[0]), f })).filter((x) => x.n.length >= 4 && x.n !== 'bogota');
  }
  function buscarLugar(texto, indice) {
    const q = ' ' + normalizar(texto) + ' ';
    let mejor = null;
    for (const x of indice || []) {
      if (!q.includes(' ' + x.n + ' ')) continue;
      const pr = PRIORIDAD[x.f[1]] ?? 9;
      if (!mejor || x.n.length > mejor.n.length || (x.n.length === mejor.n.length && pr < mejor.pr)) mejor = { n: x.n, pr, f: x.f };
    }
    if (!mejor) return null;
    const [nombre, nivel, localidad, x0, y0, x1, y1] = mejor.f;
    return { nombre: nivel === 'upl' ? nombre : propio(nombre), nivel, localidad: propio(localidad || ''), bbox: [x0, y0, x1, y1],
      centro: { lat: (y0 + y1) / 2, lon: (x0 + x1) / 2 }, clave: normalizar(nombre) };
  }
  // ¿La pregunta nombra un sitio que no encontramos? Sirve para avisar en vez de callar.
  function lugarNombrado(texto) {
    const m = normalizar(texto).match(/\b(?:en|de|del|por|cerca de|cerca del)\s+(?:la |el |los |las )?([a-zñ0-9 ]{3,})$/);
    if (!m) return null;
    const resto = m[1].replace(RUIDO, ' ').replace(/\s+/g, ' ').trim();
    return resto.length >= 3 && !/^(bogota|la ciudad|toda la ciudad|hoy|ahora|noche)$/.test(resto) ? resto : null;
  }

  // «la 72», «calle 72», «cl 72», «carrera 7», «kr 7». En Bogotá «la 72» es la calle.
  function calleEn(texto) {
    const n = normalizar(texto);
    const m = n.match(/\b(calle|cl|cll|carrera|cra|kra|kr|ak|ac|avenida calle|avenida carrera|la|el)\s+(\d{1,3})( sur)?\b/);
    if (!m) return null;
    const via = /^(carrera|cra|kra|kr|ak|avenida carrera)$/.test(m[1]) ? 'carrera' : 'calle';
    return { via, numero: Number(m[2]), sur: Boolean(m[3]) };
  }
  // Punto para una calle: primero una estación de TransMilenio con ese nombre; si no hay, el centro
  // de las estaciones de bicis cuya dirección lo nombra («CL 72 con KR 11»).
  function puntoDeCalle(c, estacionesTM, estacionesBici) {
    if (!c) return null;
    const pal = c.via === 'calle' ? 'calle' : 'carrera';
    const re = new RegExp('^(?:temporal )?' + pal + ' ' + c.numero + (c.sur ? ' s(?:ur)?\\b' : '\\b(?! s(?:ur)?\\b)'));
    const tm = (estacionesTM || []).find((e) => re.test(normalizar(e.nombre)));
    const nombre = (c.via === 'calle' ? 'la calle ' : 'la carrera ') + c.numero + (c.sur ? ' sur' : '');
    if (tm) return { nombre, lat: tm.lat, lon: tm.lon, por: 'estación ' + tm.nombre + ' de TransMilenio' };
    const sig = c.via === 'calle' ? '(?:cl|ac|calle)' : '(?:kr|ak|cra|carrera)';
    const reB = new RegExp('\\b' + sig + ' ' + c.numero + (c.sur ? ' s(?:ur)?\\b' : '\\b(?! s(?:ur)?\\b)'));
    const bs = (estacionesBici || []).filter((e) => reB.test(normalizar(e.nombre)));
    if (!bs.length) return null;
    return { nombre, lat: bs.reduce((a, e) => a + e.lat, 0) / bs.length, lon: bs.reduce((a, e) => a + e.lon, 0) / bs.length, por: 'estaciones de bicis sobre esa vía' };
  }

  // ── Geometría ──
  const RAD = Math.PI / 180;
  function distanciaM(a, b) {
    const dla = (b.lat - a.lat) * RAD, dlo = (b.lon - a.lon) * RAD;
    const s = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlo / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(s));
  }
  function enAnillo(x, y, an) {
    let d = false;
    for (let i = 0, j = an.length - 1; i < an.length; j = i++) {
      const [xi, yi] = an[i], [xj, yj] = an[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
  }
  // Polígonos como lista de anillos en [lon, lat]. Con regla par-impar los huecos quedan fuera.
  function enPoligonos(lon, lat, anillos) {
    let d = false;
    for (const an of anillos || []) if (enAnillo(lon, lat, an)) d = !d;
    return d;
  }
  function centroAnillo(an) {
    let x = 0, y = 0;
    for (const p of an) { x += p[0]; y += p[1]; }
    return { lon: x / an.length, lat: y / an.length };
  }
  function cajaDe(puntos) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of puntos) { x0 = Math.min(x0, p.lon); x1 = Math.max(x1, p.lon); y0 = Math.min(y0, p.lat); y1 = Math.max(y1, p.lat); }
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  }
  // Teselas MVT: coordenada de la tesela (0..extension) a lon y lat.
  function teselaALonLat(z, x, y, ext, px, py) {
    const n = 2 ** z;
    const lon = ((x + px / ext) / n) * 360 - 180;
    const yy = Math.PI * (1 - (2 * (y + py / ext)) / n);
    return [lon, Math.atan(Math.sinh(yy)) / RAD];
  }
  const anillosALonLat = (z, x, y, ext, anillos) => anillos.map((an) => an.map((p) => teselaALonLat(z, x, y, ext, p[0], p[1])));
  function teselasDe(bbox, z) {
    const tx = (lon) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const ty = (lat) => { const r = lat * RAD; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
    const out = [];
    for (let x = tx(bbox[0]); x <= tx(bbox[2]); x++) for (let y = ty(bbox[3]); y <= ty(bbox[1]); y++) out.push([z, x, y]);
    return out;
  }
  // ¿El punto cae en el lugar? Con polígono (localidad o UPL) se usa; si no, la caja del buscador.
  function enLugar(lugar, lon, lat) {
    if (!lugar) return true;
    if (lugar.anillos && lugar.anillos.length) return enPoligonos(lon, lat, lugar.anillos);
    const b = lugar.bbox;
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  }

  // ── Piezas comunes ──
  const nueva = (intencion, extra) => Object.assign({ intencion, sabe: true, bloques: [], notas: [], procedencia: [], vuelo: null, capas: [], acciones: [], sugerencias: [] }, extra);
  const otras = (menos) => SUGERENCIAS.filter((s) => s !== menos).slice(0, 3);
  function noSe(intencion, motivo, extra) {
    return nueva(intencion, Object.assign({ sabe: false, bloques: [['Eso no lo sé todavía.' + (motivo ? ' ' + motivo : '')]], sugerencias: SUGERENCIAS.slice() }, extra));
  }
  const viejo = (iso, cadencia, ahora) => {
    const t = Date.parse(iso), c = Number(cadencia);
    return Number.isNaN(t) || !(c > 0) ? false : (ahora - t) / 60000 > 2 * c;
  };

  // ── Lluvia ──
  function responderLluvia({ pronostico: j, cielo, ahora }) {
    const r = nueva('lluvia');
    const fin = inicioDia(ahora) + 24 * 3600000;
    const horas = j && Array.isArray(j.horas) ? j.horas.map((h) => ({ t: Date.parse(h.t), prob: h.prob_lluvia_pct, mm: h.lluvia_mm })).filter((h) => h.t >= ahora - 3600000 && h.t < fin && Number.isFinite(h.prob)) : [];
    const tarde = horaBogota(ahora) >= 21;
    // El mismo número de la franja: la probabilidad más alta de las próximas 24 horas.
    const prox = j && Array.isArray(j.horas) ? j.horas.map((h) => ({ t: Date.parse(h.t), prob: h.prob_lluvia_pct })).filter((h) => h.t >= ahora && h.t <= ahora + 24 * 3600000 && Number.isFinite(h.prob)) : [];
    const max24 = prox.length ? prox.reduce((a, h) => (h.prob > a.prob ? h : a)) : null;
    const cuando = (t) => (inicioDia(t) === inicioDia(ahora) ? 'hoy' : 'mañana') + ' a las ' + hora(t);
    if (horas.length) {
      const max = horas.reduce((a, h) => (h.prob > a.prob ? h : a));
      const mm = horas.reduce((a, h) => a + (Number(h.mm) || 0), 0);
      const juicio = max.prob >= 60 ? 'Es probable que llueva.' : max.prob >= 30 ? 'Puede llover.' : 'No se ve mucha lluvia.';
      r.bloques.push([`Lo que queda de hoy, el pronóstico para El Dorado da hasta `, v(`${max.prob} %`, 'estimado'), ` de probabilidad de lluvia, a las ${hora(max.t)}`, mm > 0 ? ', y en total ' : '.', ...(mm > 0 ? [v(`${num(mm)} mm`, 'estimado'), '.'] : []), ' ', juicio]);
      r.procedencia.push({ tipo: 'estimado', hora: j.generado, viejoMin: 2 * (j.cadencia_min || 60), fuente: 'Open‑Meteo, pronóstico para El Dorado', licencia: LIC.openmeteo });
      if (max24 && (max24.prob > max.prob || inicioDia(max24.t) !== inicioDia(ahora))) r.bloques.push(['En las próximas 24 horas lo más alto es ', v(`${max24.prob} %`, 'estimado'), `, ${cuando(max24.t)}.`]);
      if (viejo(j.generado, j.cadencia_min, ahora)) r.notas.push('Ojo: el pronóstico no se ha renovado a tiempo.');
    } else if (max24) {
      r.bloques.push(['Ya casi termina el día. En las próximas 24 horas, el pronóstico para El Dorado da hasta ', v(`${max24.prob} %`, 'estimado'), ` de probabilidad de lluvia, ${cuando(max24.t)}.`]);
      r.procedencia.push({ tipo: 'estimado', hora: j.generado, viejoMin: 2 * (j.cadencia_min || 60), fuente: 'Open‑Meteo, pronóstico para El Dorado', licencia: LIC.openmeteo });
    } else {
      r.bloques.push([tarde ? 'Ya casi termina el día y no quedan horas de pronóstico para hoy.' : 'El pronóstico no llegó, así que no te digo una probabilidad.']);
    }
    const sab = cielo && cielo.fuentes && cielo.fuentes.lluvia_sab;
    if (sab && sab.estado === 'ok' && Array.isArray(sab.estaciones)) {
      const con = sab.estaciones.filter((e) => !e.sin_dato_hoy && Number.isFinite(e.acumulado_hoy_mm));
      const mojadas = con.filter((e) => e.acumulado_hoy_mm > 0);
      const ahoraLl = con.filter((e) => Number(e.ultimo_minuto_mm) > 0);
      if (!con.length) r.bloques.push(['Los pluviómetros del SAB no reportan hoy.']);
      else if (!mojadas.length) r.bloques.push(['En lo que va de hoy no ha llovido en ninguno de los ', v(entero(con.length), 'medido'), ' pluviómetros del SAB que reportan.']);
      else {
        const top = mojadas.reduce((a, e) => (e.acumulado_hoy_mm > a.acumulado_hoy_mm ? e : a));
        r.bloques.push(['Hoy ya llovió en ', v(entero(mojadas.length), 'medido'), ` de ${entero(con.length)} pluviómetros del SAB. Lo más alto: `, v(`${num(top.acumulado_hoy_mm)} mm`, 'medido'), ` en ${propio(top.nombre)} (${propio(top.localidad || '')}).`]);
        r.vuelo = { centro: { lat: top.lat, lon: top.lon }, zoom: 13 };
      }
      if (ahoraLl.length) r.bloques.push(['En el último minuto llovía en ', v(entero(ahoraLl.length), 'medido'), ahoraLl.length === 1 ? ' pluviómetro.' : ' pluviómetros.']);
      r.procedencia.push({ tipo: 'medido', hora: sab.hora_dato, viejoMin: 30, fuente: 'IDIGER, SAB, pluviómetros', licencia: LIC.ccbync });
      r.capas.push('[data-grupo="lluvia"]');
    }
    if (!r.vuelo) r.vuelo = { centro: ELDORADO, zoom: 11.5 };
    r.notas.push('El pronóstico es para un punto, el aeropuerto: en tu barrio puede ser distinto.');
    r.sugerencias = otras('¿Va a llover hoy?');
    if (!r.procedencia.length) return noSe('lluvia', 'No llegó ni el pronóstico ni lo medido por los pluviómetros.');
    return r;
  }

  // ── Frío esta noche ──
  // La noche va de 18:00 a 06:00 de Bogotá, la misma ventana del registro de noches frías.
  function nocheDe(ahora) {
    const d0 = inicioDia(ahora), h = horaBogota(ahora);
    if (h < 6) return { desde: ahora, hasta: d0 + 6 * 3600000, termina: fechaIso(ahora) };
    return { desde: d0 + 18 * 3600000, hasta: d0 + 30 * 3600000, termina: fechaIso(d0 + 30 * 3600000) };
  }
  function responderFrio({ pronostico: j, noches, ahora }) {
    const r = nueva('frio');
    const n = nocheDe(ahora);
    const umbral = noches && noches.umbrales && Number.isFinite(noches.umbrales.noche_fria_c) ? noches.umbrales.noche_fria_c : 6;
    const horas = j && Array.isArray(j.horas) ? j.horas.map((h) => ({ t: Date.parse(h.t), temp: h.temp_c })).filter((h) => h.t >= n.desde && h.t <= n.hasta && Number.isFinite(h.temp)) : [];
    if (horas.length) {
      const min = horas.reduce((a, h) => (h.temp < a.temp ? h : a));
      r.bloques.push(['Para esta noche, el pronóstico en El Dorado baja a ', v(`${num(min.temp)} °C`, 'estimado'), ` cerca de las ${hora(min.t)}. `,
        min.temp < umbral ? `Es una noche fría: baja de ${num(umbral)} °C.` : `No baja de ${num(umbral)} °C, el corte que usamos para llamarla noche fría.`]);
      r.procedencia.push({ tipo: 'estimado', hora: j.generado, viejoMin: 2 * (j.cadencia_min || 60), fuente: 'Open‑Meteo, pronóstico para El Dorado', licencia: LIC.openmeteo });
    }
    if (noches && noches.esquema === 'noches-frias/1') {
      const pr = (noches.pronostico || []).filter((p) => p.noche_que_termina === n.termina && p.rango_c && Number.isFinite(p.rango_c.bajo));
      for (const p of pr) r.bloques.push([`Siete modelos esperan en ${p.nombre} entre `, v(`${num(p.rango_c.bajo)} y ${num(p.rango_c.alto)} °C`, 'estimado'), ' de mínima.']);
      if (pr.length) r.procedencia.push({ tipo: 'estimado', hora: noches.consultado_utc, viejoMin: 30 * 60, fuente: 'rango entre 7 modelos, Open‑Meteo', licencia: LIC.openmeteo });
      const m = (noches.medido || []).find((x) => Number.isFinite(x.minima_c));
      if (m) {
        r.bloques.push([`La noche que terminó el ${fecha(Date.parse(noches.fecha + 'T12:00:00-05:00'))}, ${m.nombre} midió `, v(`${num(m.minima_c)} °C`, 'medido'), ' de mínima.']);
        r.procedencia.push({ tipo: 'medido', fuente: 'METAR', licencia: LIC.noaa });
      }
    }
    if (!r.procedencia.length) return noSe('frio', 'No llegó el pronóstico de esta noche.');
    r.vuelo = { centro: ELDORADO, zoom: 11.5 };
    r.notas.push('Son temperaturas a 2 m en los aeropuertos. En los cerros y en las zonas bajas del occidente suele hacer más frío que eso.');
    r.sugerencias = otras('¿Hará frío esta noche?');
    return r;
  }

  // ── Temperatura de ahora y UV ──
  function responderTemperatura({ cielo, ahora }) {
    const m = cielo && cielo.fuentes && cielo.fuentes.metar;
    const est = m && m.estado === 'ok' && Array.isArray(m.estaciones) ? m.estaciones.filter((e) => Number.isFinite(e.temperatura_c)) : [];
    if (!est.length) return noSe('temperatura', 'No llegó la última medición de los aeropuertos.');
    const r = nueva('temperatura');
    for (const e of est) r.bloques.push([`En ${e.nombre} hay `, v(`${num(e.temperatura_c)} °C`, 'medido'), `, medido a las ${hora(Date.parse(e.hora_dato))}.`]);
    r.procedencia.push({ tipo: 'medido', hora: m.hora_dato, viejoMin: 90, fuente: 'METAR de los aeropuertos', licencia: LIC.noaa });
    r.vuelo = { centro: ELDORADO, zoom: 11 };
    r.notas.push('Es lo que miden los aeropuertos, no tu calle.');
    r.sugerencias = otras();
    void ahora;
    return r;
  }
  function responderUV({ cielo }) {
    const u = cielo && cielo.fuentes && cielo.fuentes.uv;
    if (!u || u.estado !== 'ok' || !Number.isFinite(u.uv_hora_actual)) return noSe('uv', 'No llegó el índice UV de esta hora.');
    const x = u.uv_hora_actual;
    const cat = x < 3 ? 'bajo' : x < 6 ? 'moderado' : x < 8 ? 'alto' : x < 11 ? 'muy alto' : 'extremo';
    const r = nueva('uv');
    r.bloques.push(['El índice UV de esta hora en Bogotá es ', v(num(x), 'estimado'), `, ${cat}.`]);
    r.procedencia.push({ tipo: 'estimado', hora: u.hora_dato, viejoMin: 180, fuente: 'CAMS vía Open‑Meteo, índice UV', licencia: { nombre: 'CC BY 4.0 (CAMS vía Open‑Meteo)', url: 'https://open-meteo.com/en/terms' } });
    r.notas.push('Es un modelo para toda la ciudad, no una medición.');
    r.sugerencias = otras();
    return r;
  }

  // ── Sol ──
  function responderSol({ sol, ahora, texto }) {
    const n = normalizar(texto || '');
    const quierePuesta = /\b(se pone|puesta|atardec\w*|anochec\w*|oscurec\w*)\b/.test(n);
    const b = sol.enBogota(ahora);
    let d = sol.salidaPuesta(b.anio, b.mes, b.dia, CENTRO[0], CENTRO[1]);
    let cual = 'hoy';
    const pasado = quierePuesta ? ahora > d.puesta : ahora > d.salida;
    if (pasado) {
      const m = sol.enBogota(ahora + 24 * 3600000);
      d = sol.salidaPuesta(m.anio, m.mes, m.dia, CENTRO[0], CENTRO[1]);
      cual = 'mañana';
    }
    const r = nueva('sol');
    if (quierePuesta) r.bloques.push([`El sol se pone ${cual} a las `, v(hora(d.puesta), 'inferido'), '.']);
    else if (cual === 'hoy') r.bloques.push(['El sol sale hoy a las ', v(hora(d.salida), 'inferido'), ' y se pone a las ', v(hora(d.puesta), 'inferido'), '.']);
    else {
      // Ya salió hoy: la salida que sirve es la de mañana; si aún no se pone, también va la puesta de hoy.
      const hoy = sol.salidaPuesta(b.anio, b.mes, b.dia, CENTRO[0], CENTRO[1]);
      r.bloques.push(['El sol sale mañana a las ', v(hora(d.salida), 'inferido'), '.',
        ...(ahora < hoy.puesta ? [' Hoy se pone a las ', v(hora(hoy.puesta), 'inferido'), '.'] : [])]);
    }
    r.procedencia.push({ tipo: 'inferido', fuente: 'cálculo astronómico (ecuaciones de NOAA) para el centro de Bogotá' });
    r.notas.push('Es la hora sobre un horizonte plano. Cerca de los cerros orientales lo ves salir más tarde, porque la montaña lo tapa.');
    r.vuelo = { centro: { lat: CENTRO[0], lon: CENTRO[1] }, zoom: 12 };
    r.sugerencias = otras('¿A qué hora sale el sol?');
    return r;
  }

  // ── Canales ──
  const ORDEN_CANAL = ['desborde', 'alto', 'medio', 'bajo'];
  function responderCanales({ canales: c }) {
    if (!c || !Array.isArray(c.sensores)) return noSe('canal', 'No llegó la lectura de los sensores de nivel.');
    const r = nueva('canal');
    const cuenta = (k) => c.sensores.filter((s) => s.cat === k).length;
    const conU = c.sensores.filter((s) => ['bajo_umbral', 'bajo', 'medio', 'alto', 'desborde'].includes(s.cat));
    const peor = ORDEN_CANAL.map((k) => c.sensores.filter((s) => s.cat === k)).find((l) => l.length);
    const altos = cuenta('alto') + cuenta('desborde');
    if (altos) r.bloques.push([v(entero(altos), 'medido'), altos === 1 ? ' sensor está' : ' sensores están', ' en el nivel alto del IDIGER o por encima.']);
    else if (cuenta('medio')) r.bloques.push(['Ningún sensor llega al nivel alto del IDIGER. ', v(entero(cuenta('medio')), 'medido'), ' en nivel medio.']);
    else r.bloques.push(['No. Ninguno de los ', v(entero(conU.length), 'medido'), ' sensores con umbrales publicados llega al nivel medio ni al alto del IDIGER.']);
    if (peor) {
      const s = peor[0];
      r.bloques.push([`El más cerca de su umbral: ${propio(s.nombre)}, en ${propio(s.cauce)} (${propio(s.localidad)}), nivel ${s.cat === 'desborde' ? 'de desborde' : s.cat}.`]);
      r.vuelo = { centro: { lat: s.lat, lon: s.lon }, zoom: 14 };
    }
    const sinU = cuenta('sin_umbrales');
    if (sinU) r.notas.push(`${sinU} sensores no tienen umbrales publicados; de esos solo mostramos el nivel.`);
    r.notas.push('El gemelo no emite alertas. Las alertas oficiales las da el IDIGER.');
    r.procedencia.push({ tipo: 'medido', hora: c.hora, viejoMin: 2 * (c.cadencia || 10), fuente: 'IDIGER, SAB, sensores de nivel. Crudo, sin validar por completo', licencia: LIC.ccbync });
    if (!r.vuelo) r.vuelo = { bbox: cajaDe(c.sensores) };
    r.capas.push('#ver-canales');
    r.sugerencias = otras('¿Hay algún canal en alerta?');
    return r;
  }

  // ── Bicis ──
  const nombreBici = (s) => String(s || '').replace(/^\d+\s*-\s*/, '');
  function responderBicis({ bicis: b, punto }) {
    if (!b || !Array.isArray(b.estaciones)) return noSe('bicis', 'No llegó el estado de las estaciones de bicis.');
    if (!punto) {
      return noSe('bicis', 'Dime cerca de dónde: una calle («cerca de la 72»), un barrio o una localidad.', { sugerencias: ['¿Dónde hay bicis cerca de la 72?', '¿Hay bicis en Chapinero?', '¿Dónde hay bicis cerca de la carrera 7?'] });
    }
    const utiles = b.estaciones.filter((e) => e.bicis > 0 && e.cat !== 'quieta' && e.cat !== 'dudosa')
      .map((e) => ({ e, d: distanciaM(punto, e) })).sort((x, y) => x.d - y.d).slice(0, 3);
    const r = nueva('bicis');
    if (!utiles.length || utiles[0].d > 3000) {
      r.bloques.push([`No hay estaciones con bicis disponibles a menos de 3 km de ${punto.nombre}.`]);
    } else {
      r.bloques.push([`Cerca de ${punto.nombre}:`]);
      for (const { e, d } of utiles) {
        r.bloques.push([`A ${d < 1000 ? entero(Math.round(d / 10) * 10) + ' m' : num(d / 1000) + ' km'}, ${nombreBici(e.nombre)}: `, v(`${entero(e.bicis)} ${e.bicis === 1 ? 'bici' : 'bicis'}`, 'de_fuente'),
          e.electricas ? ` (${entero(e.electricas)} ${e.electricas === 1 ? 'eléctrica' : 'eléctricas'})` : '', '.']);
      }
      r.vuelo = { bbox: cajaDe([punto, ...utiles.map((u) => u.e)]) };
    }
    if (punto.por) r.notas.push(`Ubiqué ${punto.nombre} por la ${punto.por}. Las distancias son en línea recta.`);
    else r.notas.push('Las distancias son en línea recta desde el centro del lugar.');
    r.procedencia.push({ tipo: 'de_fuente', hora: b.hora, viejoMin: 2 * (b.cadencia || 10), fuente: 'sistema de bicicletas compartidas, GBFS', licencia: b.fuente && b.fuente.licencia ? { nombre: b.fuente.licencia.nombre, url: b.fuente.licencia.url } : LIC.cc0 });
    r.capas.push('#ver-bicis');
    r.sugerencias = otras('¿Dónde hay bicis cerca de la 72?');
    return r;
  }

  // ── Aire ──
  // aa son las cuentas de aire-anual-datos.js (franjaEn y comparar).
  function responderAire({ aire, ahora, lugar, pm25, aa }) {
    const r = nueva('aire');
    const campos = aire && Array.isArray(aire.horas_campos) ? aire.horas_campos : ['t', 'pm25'];
    const it = campos.indexOf('t'), ip = campos.indexOf('pm25');
    const h0 = Math.floor(ahora / 3600000) * 3600000;
    const fila = aire && Array.isArray(aire.horas) ? aire.horas.find((h) => Array.isArray(h) && Date.parse(h[it]) === h0) : null;
    const pmAhora = fila && Number.isFinite(Number(fila[ip])) ? Number(fila[ip]) : null;
    if (pmAhora != null && !viejo(aire.generado, aire.cadencia_min, ahora)) {
      r.bloques.push([lugar ? 'Ahora, para toda Bogotá (el modelo no distingue ' + lugar.nombre + '), el PM2,5 estimado es ' : 'Ahora, el PM2,5 estimado para Bogotá es ', v(`${num(pmAhora)} µg/m³`, 'estimado'), '.']);
      const hoy = (aire.dias || []).find((d) => d.fecha_bogota === fechaIso(ahora));
      if (hoy && Number.isFinite(hoy.media)) r.bloques.push(['La media de hoy sería ', v(`${num(hoy.media)} µg/m³`, 'estimado'), hoy.media > 15 ? ', por encima de la guía diaria de la OMS (15).' : ', dentro de la guía diaria de la OMS (15).']);
      r.procedencia.push({ tipo: 'estimado', hora: aire.generado, viejoMin: 2 * (aire.cadencia_min || 60), fuente: 'CAMS (Copernicus) vía Open‑Meteo, celda de 45 km', licencia: LIC.openmeteo });
    }
    if (pm25 && aa) {
      const punto = lugar ? lugar.centro : { lat: CENTRO[0], lon: CENTRO[1] };
      const f = lugar ? aa.franjaEn(pm25, punto.lon, punto.lat) : null;
      if (f) {
        const c = aa.comparar(f.properties.pm25);
        r.bloques.push([`En todo 2025, el promedio en ${lugar.nombre} fue `, v(`${num(f.properties.pm25)} µg/m³`, 'inferido'), '. ', c.oms, ' ', c.norma]);
        r.procedencia.push({ tipo: 'inferido', fuente: 'SDA, superficie anual de PM2,5 2025', licencia: LIC.ccby });
        r.capas.push('#ver-pm25');
      } else if (lugar) {
        r.notas.push(`La superficie anual de la SDA no cubre el centro de ${lugar.nombre}.`);
      }
    }
    if (!r.procedencia.length) return noSe('aire', 'No llegó el pronóstico del aire de esta hora.');
    r.vuelo = lugar ? { bbox: lugar.bbox } : { centro: { lat: CENTRO[0], lon: CENTRO[1] }, zoom: 11 };
    r.notas.push('No es un índice oficial ni una alerta.');
    r.sugerencias = otras('¿Cómo está el aire en Kennedy?');
    return r;
  }

  // ── Colegios con peor aire ──
  function responderColegios({ colegios, pm25, aa, lugar }) {
    if (!colegios || !pm25 || !aa) return noSe('colegios_aire', 'No pude cargar los colegios o la capa de PM2,5 de 2025.');
    const con = [];
    for (const f of colegios.features || []) {
      const [lon, lat] = f.geometry.coordinates;
      if (!enLugar(lugar, lon, lat)) continue;
      const fr = aa.franjaEn(pm25, lon, lat);
      if (fr) con.push({ f, pm: fr.properties.pm25, lon, lat });
    }
    if (!con.length) return noSe('colegios_aire', lugar ? `No encontré colegios de la SED dentro de ${lugar.nombre} con dato de 2025.` : '');
    const peor = Math.max(...con.map((c) => c.pm));
    const top = con.filter((c) => c.pm === peor).sort((a, b) => (b.f.properties.o || 0) - (a.f.properties.o || 0) || a.f.properties.n.localeCompare(b.f.properties.n, 'es'));
    const c = aa.comparar(peor);
    const r = nueva('colegios_aire');
    // Cada punto de la SED es una sede: se cuentan sedes y se agrupan por colegio.
    r.bloques.push([`De las ${entero(con.length)} sedes de colegios de la SED ${lugar ? 'en ' + lugar.nombre + ' ' : ''}con valor en la superficie de 2025, `, v(entero(top.length), 'de_fuente'), top.length === 1 ? ' queda' : ' quedan', ' en la franja con el promedio más alto de 2025: ', v(`${num(peor)} µg/m³`, 'inferido'), '. ', c.oms]);
    const nom = aa.nombre || propio;
    const total = new Map();
    for (const f of colegios.features || []) total.set(f.properties.n, (total.get(f.properties.n) || 0) + 1);
    const grupos = new Map();
    for (const x of top) {
      const g = grupos.get(x.f.properties.n) || [];
      g.push(x.f.properties.s);
      grupos.set(x.f.properties.n, g);
    }
    const PAL = ['', 'una', 'dos', 'tres', 'cuatro', 'cinco'];
    const cuenta = (k) => PAL[k] || entero(k);
    const nombres = [...grupos].map(([n, sedes]) => {
      const t = total.get(n) || sedes.length;
      if (sedes.length === 1) return nom(n) + (sedes[0] && t > 1 ? ', ' + nom(sedes[0]) : '');
      return nom(n) + (sedes.length === t ? `, en sus ${cuenta(t)} sedes` : `, en ${cuenta(sedes.length)} de sus ${cuenta(t)} sedes`);
    });
    const lista = nombres.length === 1 ? nombres[0]
      : nombres.slice(0, 3).join('; ') + (nombres.length > 3 ? ' y ' + entero(nombres.length - 3) + ' colegios más' : '');
    r.bloques.push([nombres.length > 1 ? `Son: ${lista}.` : (/^Colegio /.test(lista) ? 'Es el ' : 'Es ') + lista + '.']);
    r.notas.push('Todos los colegios de una misma franja comparten el mismo valor: es la superficie que interpoló la SDA con sus estaciones, no una medición en cada colegio.');
    r.procedencia.push({ tipo: 'de_fuente', fuente: 'SED, colegios, corte del 30 sep 2026', licencia: LIC.ccbysa });
    r.procedencia.push({ tipo: 'inferido', fuente: 'SDA, superficie anual de PM2,5 2025', licencia: LIC.ccby });
    r.vuelo = { bbox: cajaDe(top) };
    r.capas.push('#ver-pm25');
    r.sugerencias = otras('¿Qué colegios tienen peor aire?');
    return r;
  }

  // ── Edificio más alto ──
  // sectores: [{codigo, nombre, pisos_max, pisos_prom, construcciones, anillos (lon, lat)}] de la
  // capa pisos_sector. Un sector partido entre teselas llega dos veces: cuenta una.
  function sectorMasAlto(sectores, lugar) {
    let mejor = null;
    const vistos = new Set();
    for (const s of sectores || []) {
      if (!Number.isFinite(s.pisos_max) || !s.anillos || !s.anillos.length) continue;
      const c = centroAnillo(s.anillos[0]);
      let dentro;
      if (lugar && lugar.nivel === 'sector') dentro = normalizar(s.nombre) === lugar.clave && enLugar({ bbox: lugar.bbox }, c.lon, c.lat);
      // Un barrio es más chico que un sector: vale el sector que contiene el centro del barrio.
      else if (lugar && lugar.nivel === 'barrio') dentro = enPoligonos(lugar.centro.lon, lugar.centro.lat, s.anillos);
      else dentro = enLugar(lugar, c.lon, c.lat);
      if (!dentro || vistos.has(s.codigo)) continue;
      vistos.add(s.codigo);
      if (!mejor || s.pisos_max > mejor.pisos_max) mejor = Object.assign({ centro: c }, s);
    }
    return mejor;
  }
  // Construcciones de las teselas z15 que cubren el sector: la de más pisos dentro del sector.
  function edificioEnSector(construcciones, sector) {
    let mejor = null;
    for (const o of construcciones || []) {
      if (!o.anillos || !o.anillos.length || !Number.isFinite(o.pisos)) continue;
      const c = centroAnillo(o.anillos[0]);
      if (!enPoligonos(c.lon, c.lat, sector.anillos)) continue;
      if (!mejor || o.pisos > mejor.pisos) mejor = { pisos: o.pisos, centro: c };
    }
    return mejor;
  }
  function responderEdificio({ sector, edificio, lugar }) {
    if (!sector) return noSe('edificio_alto', lugar ? `No encontré construcciones de Catastro dentro de ${lugar.nombre}.` : 'No pude leer la capa de pisos de Catastro.');
    const r = nueva('edificio_alto');
    const donde = lugar ? `En ${lugar.nombre}` : 'En toda Bogotá';
    r.bloques.push([`${donde}, la construcción con más pisos según Catastro tiene `, v(`${entero(sector.pisos_max)} pisos`, 'de_fuente'), ` y queda en el sector ${propio(sector.nombre)}.`]);
    if (edificio && edificio.pisos === sector.pisos_max) {
      r.vuelo = { centro: edificio.centro, zoom: 17, marca: true };
      r.bloques.push(['Te llevo hasta ella en el mapa.']);
    } else {
      r.vuelo = { bbox: cajaDe(sector.anillos[0].map((p) => ({ lon: p[0], lat: p[1] }))) };
    }
    r.notas.push('Catastro publica pisos, no metros. Si la quieres ver en altura, levanta la ciudad en 3D; ahí cada piso cuenta como 3 m, y eso es un supuesto.');
    r.notas.push('Es el dato que publica Catastro; no lo revisamos edificio por edificio.');
    r.procedencia.push({ tipo: 'de_fuente', fuente: 'UAECD (Catastro Bogotá), construcciones con pisos', licencia: LIC.ccby });
    r.acciones.push({ texto: 'Ver en 3D', selector: '#ver-3d' });
    r.sugerencias = otras('¿Cuál es el edificio más alto de Chapinero?');
    return r;
  }

  // ── Lo que no sabemos ──
  const TEMAS = [
    [/trafico|trancon|congestion|pico y placa|tunel/, 'tráfico'],
    [/accidente/, 'accidentes'],
    [/seguridad|robo|hurto|delito/, 'seguridad'],
    [/arriendo|precio|cuanto cuesta/, 'precios'],
    [/ruido/, 'ruido']
  ];
  function responderNoSe(texto) {
    const n = normalizar(texto);
    const t = TEMAS.find(([re]) => re.test(n));
    return noSe('no_se', t ? `El gemelo no tiene datos de ${t[1]}. Esto sí te lo puedo contestar:` : 'Esto sí te lo puedo contestar:');
  }

  const api = {
    SUGERENCIAS, CENTRO, ELDORADO, LIC, normalizar, detectarIntencion, prepararIndice, buscarLugar, lugarNombrado, calleEn, puntoDeCalle,
    distanciaM, enPoligonos, centroAnillo, cajaDe, teselaALonLat, anillosALonLat, teselasDe, enLugar, nocheDe, inicioDia,
    responderLluvia, responderFrio, responderTemperatura, responderUV, responderSol, responderCanales, responderBicis,
    responderAire, responderColegios, sectorMasAlto, edificioEnSector, responderEdificio, responderNoSe, noSe
  };
  // Una hora como «6:00 a. m.» ya cierra con punto: no se le suma el de la frase.
  function pulir(r) {
    if (!r || !Array.isArray(r.bloques)) return r;
    for (const b of r.bloques) {
      for (let i = 0; i < b.length; i++) {
        if (typeof b[i] === 'string') b[i] = b[i].replace(/([ap]\.\s?m\.)\./g, '$1');
        const prev = i > 0 ? (typeof b[i - 1] === 'string' ? b[i - 1] : b[i - 1] && b[i - 1].v) : '';
        if (typeof b[i] === 'string' && b[i].startsWith('.') && /\.$/.test(prev || '')) b[i] = b[i].slice(1);
      }
    }
    return r;
  }
  for (const k of Object.keys(api)) {
    if (!/^responder|^noSe$/.test(k)) continue;
    const f = api[k];
    api[k] = (...a) => { const r = f(...a); return r && typeof r.then === 'function' ? r.then(pulir) : pulir(r); };
  }
  api.pulir = pulir;
  const raiz = typeof window !== 'undefined' ? window : globalThis;
  raiz.Bogotwin = Object.assign(raiz.Bogotwin || {}, { preguntar: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
