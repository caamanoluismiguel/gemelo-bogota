'use strict';
// Posición del sol para Bogotwin.
// Escrito desde cero con las ecuaciones públicas del NOAA Solar Calculator
// (hoja «NOAA_Solar_Calculations», que sigue a Meeus, Astronomical Algorithms).
// Módulo puro: no toca el DOM ni la hora del equipo. Corre igual en el navegador
// (window.Bogotwin.sol) y en Node (require). La hora de Bogotá es UTC−5 fija:
// Colombia no cambia la hora en el año.
(function (raiz) {
  const RAD = Math.PI / 180;
  const DIA_MS = 86400000;
  const BOGOTA_MS = -5 * 3600000;
  // Bogotá a 2.600 m: presión típica 750 hPa y 14 °C. Solo cambian la refracción.
  const ATMOSFERA = { presionHpa: 750, temperaturaC: 14 };
  // Salida y puesta con la convención de siempre: borde superior del disco a −0,8333°
  // (0,5667° de refracción al nivel del mar más 0,2667° de semidiámetro).
  const ALTURA_SALIDA = -0.8333;

  const sen = (g) => Math.sin(g * RAD);
  const cos = (g) => Math.cos(g * RAD);
  const tan = (g) => Math.tan(g * RAD);
  const grados = (r) => r / RAD;
  const mod360 = (x) => ((x % 360) + 360) % 360;

  // Lo que depende solo del instante: declinación y ecuación del tiempo.
  function efemeride(ms) {
    const jd = ms / DIA_MS + 2440587.5;
    const t = (jd - 2451545) / 36525;
    const l0 = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const c = sen(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      sen(2 * m) * (0.019993 - 0.000101 * t) + sen(3 * m) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = l0 + c - 0.00569 - 0.00478 * sen(omega);
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * cos(omega);
    const declinacion = grados(Math.asin(sen(eps) * sen(lambda)));
    const y = tan(eps / 2) ** 2;
    const ecuacionTiempo = 4 * grados(
      y * sen(2 * l0) - 2 * e * sen(m) + 4 * e * y * sen(m) * cos(2 * l0) -
      0.5 * y * y * sen(4 * l0) - 1.25 * e * e * sen(2 * m)); // minutos
    return { declinacion, ecuacionTiempo };
  }

  // Refracción de la NOAA, escalada por presión y temperatura (factor de Saemundsson).
  function refraccion(altura, atm) {
    if (altura > 85) return 0;
    const te = tan(altura);
    let s;
    if (altura > 5) s = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (altura > -0.575) s = 1735 + altura * (-518.2 + altura * (103.4 + altura * (-12.79 + altura * 0.711)));
    else s = -20.774 / te;
    return (s / 3600) * (atm.presionHpa / 1010) * (283 / (273 + atm.temperaturaC));
  }

  function horario(ms, lon, ecuacionTiempo) {
    const minUTC = (((ms % DIA_MS) + DIA_MS) % DIA_MS) / 60000;
    const solarVerdadera = minUTC + ecuacionTiempo + 4 * lon; // minutos
    let h = solarVerdadera / 4 - 180;
    h = ((h + 180) % 360 + 360) % 360 - 180;
    return h;
  }

  // Altura y azimut del sol. fecha: Date o milisegundos UTC. lon positiva al oriente.
  // azimut: grados desde el norte, en el sentido del reloj. altura: con refracción.
  function posicion(fecha, lat, lon, opciones) {
    const ms = +fecha;
    const atm = Object.assign({}, ATMOSFERA, opciones);
    const { declinacion, ecuacionTiempo } = efemeride(ms);
    const h = horario(ms, lon, ecuacionTiempo);
    const cosZ = Math.min(1, Math.max(-1, sen(lat) * sen(declinacion) + cos(lat) * cos(declinacion) * cos(h)));
    const alturaGeometrica = 90 - grados(Math.acos(cosZ));
    const azimut = mod360(grados(Math.atan2(sen(h), cos(h) * sen(lat) - tan(declinacion) * cos(lat))) + 180);
    const altura = opciones && opciones.sinRefraccion ? alturaGeometrica : alturaGeometrica + refraccion(alturaGeometrica, atm);
    return { altura, azimut, alturaGeometrica, declinacion, ecuacionTiempo, angulo_horario: h };
  }

  // Hora de Bogotá (UTC−5 fija) en partes, sin depender de la zona del equipo.
  function enBogota(fecha) {
    const d = new Date(+fecha + BOGOTA_MS);
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
      hora: d.getUTCHours(), minuto: d.getUTCMinutes(), segundo: d.getUTCSeconds() };
  }
  // Milisegundos UTC de una hora de Bogotá.
  function desdeBogota(anio, mes, dia, hora, minuto, segundo) {
    return Date.UTC(anio, mes - 1, dia, hora || 0, minuto || 0, segundo || 0) - BOGOTA_MS;
  }

  // Mediodía solar del día de Bogotá dado (milisegundos UTC), con dos vueltas.
  function mediodia(anio, mes, dia, lon) {
    const base = Date.UTC(anio, mes - 1, dia);
    let ms = base + (720 - 4 * lon) * 60000;
    for (let i = 0; i < 3; i++) ms = base + (720 - 4 * lon - efemeride(ms).ecuacionTiempo) * 60000;
    return ms;
  }

  // Instante en que la altura geométrica cruza «h0» a la mañana (signo −1) o a la tarde (+1).
  // Se parte del mediodía y se corrige con el ángulo horario que pide la declinación de ese instante.
  function cruce(anio, mes, dia, lat, lon, h0, signo) {
    let ms = mediodia(anio, mes, dia, lon);
    for (let i = 0; i < 8; i++) {
      const { declinacion, ecuacionTiempo } = efemeride(ms);
      const cosH = (sen(h0) - sen(lat) * sen(declinacion)) / (cos(lat) * cos(declinacion));
      if (cosH > 1 || cosH < -1) return null; // ese día no cruza (en Bogotá no pasa)
      let delta = signo * grados(Math.acos(cosH)) - horario(ms, lon, ecuacionTiempo);
      delta = ((delta + 180) % 360 + 360) % 360 - 180;
      ms += delta * 4 * 60000;
      if (Math.abs(delta) < 1e-5) break;
    }
    return ms;
  }

  // Salida, mediodía y puesta del sol para un día de Bogotá. Devuelve milisegundos UTC.
  function salidaPuesta(anio, mes, dia, lat, lon, alturaHorizonte) {
    const h0 = alturaHorizonte == null ? ALTURA_SALIDA : alturaHorizonte;
    return {
      salida: cruce(anio, mes, dia, lat, lon, h0, -1),
      mediodia: mediodia(anio, mes, dia, lon),
      puesta: cruce(anio, mes, dia, lat, lon, h0, +1)
    };
  }

  // Días del año en que el sol pasa casi por el cenit al mediodía en esa latitud:
  // la declinación al mediodía cruza la latitud. Devuelve el día de Bogotá más cercano
  // al cruce y la altura del sol al mediodía de ese día.
  function diasCenitales(anio, lat, lon) {
    const out = [];
    let previo = null;
    const dias = (Date.UTC(anio + 1, 0, 1) - Date.UTC(anio, 0, 1)) / DIA_MS;
    for (let k = 0; k <= dias; k++) {
      const d = new Date(Date.UTC(anio, 0, 1 + k));
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
      const tr = mediodia(y, m, dd, lon);
      const dif = efemeride(tr).declinacion - lat;
      const hoy = { y, m, dd, tr, dif };
      if (previo && Math.sign(previo.dif) !== Math.sign(dif)) {
        const el = Math.abs(previo.dif) <= Math.abs(dif) ? previo : hoy;
        if (el.y === anio) {
          out.push({
            fecha: `${el.y}-${String(el.m).padStart(2, '0')}-${String(el.dd).padStart(2, '0')}`,
            mediodia: el.tr,
            altura: posicion(el.tr, lat, lon).altura,
            // al cruzar, el sol del mediodía pasa del sur al norte (marzo) o del norte al sur (septiembre)
            pasaAlNorte: dif > 0
          });
        }
      }
      previo = hoy;
    }
    return out;
  }

  const sol = { posicion, salidaPuesta, mediodia, diasCenitales, enBogota, desdeBogota, refraccion: (a, o) => refraccion(a, Object.assign({}, ATMOSFERA, o)), ALTURA_SALIDA };

  if (typeof module === 'object' && module.exports) module.exports = sol;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.sol = sol;
  }
})(typeof window !== 'undefined' ? window : globalThis);
