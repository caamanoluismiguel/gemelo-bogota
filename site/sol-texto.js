'use strict';
// Textos y cuentas pequeñas de la barra del sol, sin DOM ni mapa: corre en el navegador
// (window.Bogotwin.solTexto) y en Node (require), para poder probarlo.
// Pasos 10 y 12 del plan de sombras (panel/sombras-DEBATE.md §3).
(function (raiz) {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const PUNTOS = ['norte', 'nororiente', 'oriente', 'suroriente', 'sur', 'suroccidente', 'occidente', 'noroccidente'];
  const HORA_MIN = 330, HORA_MAX = 1110, PASO = 5;   // 5:30 a. m. a 6:30 p. m. (DEBATE, tema 6)
  const DIA_MS = 86400000;

  const dos = (n) => String(n).padStart(2, '0');

  // Hora del día en minutos a «9:40 a. m.»; las 12:00 en punto son «12 m.». Con espacios duros
  // para que la hora nunca se parta entre dos renglones.
  function horaTexto(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    if (m === 720) return '12\u00a0m.';
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h % 12 || 12}:${dos(mm)}\u00a0${h < 12 ? 'a.\u00a0m.' : 'p.\u00a0m.'}`;
  }

  // «lunes, 23 nov»
  function fechaTexto(anio, mes, dia) {
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    return `${DIAS[d.getUTCDay()]}, ${dia} ${MES_CORTO[mes - 1]}`;
  }
  // «2 de abril»
  const diaTexto = (mes, dia) => `${dia} de ${MESES[mes - 1]}`;

  // Día del año, 1 a 365 (el 29 de febrero cuenta como el 28 para que la regla no salte).
  function diaDelAnio(anio, mes, dia) {
    const n = Math.round((Date.UTC(anio, mes - 1, dia) - Date.UTC(anio, 0, 1)) / DIA_MS) + 1;
    const bis = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return bis && n > 59 ? n - 1 : n;
  }
  function fechaDeDia(anio, n) {
    const bis = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    const k = Math.min(365, Math.max(1, Math.round(n)));
    const d = new Date(Date.UTC(anio, 0, (bis && k > 59 ? k + 1 : k)));
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
  }

  const ajustarHora = (min) => Math.min(HORA_MAX, Math.max(HORA_MIN, Math.round(min / PASO) * PASO));

  // ?sol=2026-04-02T12:00 (hora de Bogotá). Devuelve null si no es una fecha y hora válidas.
  function leerSol(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const [anio, mes, dia, h, mi] = m.slice(1).map(Number);
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    if (anio < 1900 || anio > 2200 || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || h > 23 || mi > 59) return null;
    return { anio, mes, dia, min: h * 60 + mi };
  }
  const escribirSol = (f) => `${f.anio}-${dos(f.mes)}-${dos(f.dia)}T${dos(Math.floor(f.min / 60))}:${dos(f.min % 60)}`;

  // Hacia dónde apunta algo (grados desde el norte, sentido del reloj), en ocho puntos.
  function direccion8(grados) {
    const g = ((grados % 360) + 360) % 360;
    return PUNTOS[Math.round(g / 45) % 8];
  }

  // Fila de la ventana de una construcción (paso 12). sol: { altura, azimut } de sol.js;
  // largo(sol, pisos, mPiso): sombraGeom.largoSombra. Núcleo 2,5 m y borde 4,0 m por piso.
  function filaSombra(sol, pisos, largo) {
    if (!sol || sol.altura <= 0) return 'Sombra a esta hora: no hay, es de noche';
    const x = largo(sol, pisos, 2.5), y = largo(sol, pisos, 4.0);
    if (x == null || y == null) return 'Sombra a esta hora: tan larga que no se dibuja, el sol está casi en el horizonte';
    const r = (v) => (v < 10 ? Math.max(0.1, Math.round(v * 10) / 10) : Math.round(v)).toLocaleString('es-CO');
    return `Sombra a esta hora: de ${r(x)} a ${r(y)} m hacia el ${direccion8(sol.azimut + 180)}`;
  }

  // Nubes en «Ahora» con el METAR de El Dorado y Guaymaral (DEBATE, tema 6).
  // metar: fuentes.metar de ahora.json. Devuelve { clave, intensidad, texto }.
  const RANGO = { SKC: 0, CLR: 0, NSC: 0, NCD: 0, CAVOK: 0, FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4 };
  const TEXTOS = {
    despejado: '',
    nubes: 'Hay nubes: el sol puede estar tapado a ratos.',
    cubierto: 'El aeropuerto reporta cielo cubierto. La sombra dibujada es la que habría con sol directo.',
    sinDato: 'Sin reporte reciente: sombra calculada para cielo despejado.'
  };
  function lluvia(fen) {
    // RA lluvia, DZ llovizna, TS tormenta, SH chubasco, SN, GR, GS, PL. «VC» es en las cercanías: no cuenta.
    return String(fen || '').split(/\s+/).some((t) => t && !/^[-+]?VC/.test(t) && /(RA|DZ|TS|SH|SN|GR|GS|PL)/.test(t));
  }
  function cielo(metar, ahoraMs) {
    const ahora = ahoraMs == null ? Date.now() : ahoraMs;
    const est = (metar && Array.isArray(metar.estaciones) ? metar.estaciones : []).filter((e) => {
      const t = Date.parse(e && e.hora_dato);
      return Number.isFinite(t) && ahora - t <= 90 * 60000 && ahora - t > -15 * 60000;
    });
    const sale = (clave) => ({ clave, intensidad: clave === 'cubierto' ? 0.5 : 1, texto: TEXTOS[clave] });
    if (!est.length) return sale('sinDato');
    const tope = est.map((e) => Math.max(0, ...(Array.isArray(e.nubes) ? e.nubes : []).map((n) => RANGO[String(n && n.cover).toUpperCase()] ?? 0)));
    if (est.some((e) => lluvia(e.fenomenos)) || tope.every((r) => r >= 3)) return sale('cubierto');
    if (tope.some((r) => r === 2 || r === 3)) return sale('nubes');
    return sale('despejado');
  }

  // Luz de MapLibre para el sol (paso 11): [radio, azimut, ángulo desde el cenit].
  // Por debajo de 5° la luz se deja en 5° para que las fachadas no queden negras.
  // Color e intensidad cambian con la altura del sol: dorado bajo, neutro alto, frío de noche.
  function luz(sol) {
    const alt = sol.altura;
    const az = ((sol.azimut % 360) + 360) % 360;
    const zenith = 90 - Math.max(5, alt);

    // Más intensidad, más diferencia entre la fachada al sol y la de la sombra (MapLibre
    // deja la cara opuesta en 1 − intensidad). La luz cálida va sobre un material frío
    // (mapa.js): con una luz muy naranja o muy fuerte la cara a la sombra se ve café. De noche
    // la luz es tenue y casi neutra: lo oscuro lo ponen los colores de noche de mapa.js (una
    // luz muy azul tiñe todo de morado).
    let color = '#ffffff', intensity = 0.48;
    if (alt <= 0) {
      color = '#d0d8e8'; intensity = 0.3;
    } else if (alt < 8) {
      color = '#ffe8cf'; intensity = 0.56;
    } else if (alt < 20) {
      color = '#ffeedc'; intensity = 0.56;
    } else if (alt < 40) {
      color = '#fff4ea'; intensity = 0.52;
    }

    return { anchor: 'map', color, intensity, position: [1.5, az, zenith] };
  }

  const solTexto = { horaTexto, fechaTexto, diaTexto, diaDelAnio, fechaDeDia, ajustarHora, leerSol, escribirSol,
    direccion8, filaSombra, cielo, luz, MES_CORTO, HORA_MIN, HORA_MAX, PASO };

  if (typeof module === 'object' && module.exports) module.exports = solTexto;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.solTexto = solTexto;
  }
})(typeof window !== 'undefined' ? window : globalThis);
