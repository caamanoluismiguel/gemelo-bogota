'use strict';
// Lectura de los datos del repo vivo (bicis, canales, pronóstico, acierto, aire y su bruma). Solo funciones
// puras: se cargan después del primer cuadro y se prueban en Node (pruebas/vivo.prueba.js).
(function () {
  const BASE = 'https://caamanoluismiguel.github.io/gemelo-bogota-vivo/';
  // Pages manda max-age=600: el ?t= cambia cada 5 min para leer lo último sin pedir de más.
  const url = (f, ahora) => BASE + f + '?t=' + Math.floor((ahora ?? Date.now()) / 300000);

  // Regla del repo vivo: «sin dato reciente» cuando la edad pasa del doble de cadencia_min.
  function limiteMin(cadenciaMin) {
    const c = Number(cadenciaMin);
    return Number.isFinite(c) && c > 0 ? 2 * c : null;
  }
  function sinDatoReciente(iso, cadenciaMin, ahora) {
    const t = Date.parse(iso);
    const lim = limiteMin(cadenciaMin);
    if (Number.isNaN(t) || lim == null) return true;
    return ((ahora ?? Date.now()) - t) / 60000 > lim;
  }

  // Bicis: cada estación trae v en el orden de campos; estado es una suma de bits.
  const BITS = { instalada: 1, presta: 2, recibe: 4, dato_dudoso: 8 };
  function leerEstado(n, bits) {
    const b = bits || BITS;
    const x = Number(n) | 0;
    const r = {};
    for (const k of Object.keys(b)) r[k] = (x & b[k]) !== 0;
    return r;
  }
  // La Sabana: lo que cae fuera no se dibuja (README del repo vivo).
  const enSabana = (lat, lon) => lat >= 4.2 && lat <= 5.2 && lon >= -74.5 && lon <= -73.7;

  // Más de 60 min sin reportar: la estación no está contando, aunque traiga números.
  const MIN_SIN_REPORTE = 60;
  function categoria(e) {
    if (e.estado.dato_dudoso) return 'dudosa';
    if (!e.estado.presta || (e.min_desde_reporte != null && e.min_desde_reporte > MIN_SIN_REPORTE)) return 'quieta';
    const b = e.bicis ?? 0, l = e.anclajes_libres ?? 0;
    if (b === 0) return 'vacia';
    if (l === 0) return 'llena';
    const o = b / (b + l);
    return o < 1 / 3 ? 'baja' : o < 2 / 3 ? 'media' : 'alta';
  }

  function decodificarBicis(j) {
    if (!j || j.esquema !== 'bogotwin/bicis/1' || !Array.isArray(j.campos) || !Array.isArray(j.estaciones)) throw new Error('esquema');
    const ix = {};
    j.campos.forEach((c, i) => { ix[c] = i; });
    const num = (v, k) => { const x = ix[k] == null ? null : v[ix[k]]; return x == null || !Number.isFinite(Number(x)) ? null : Number(x); };
    const estaciones = [];
    let fuera = 0;
    for (const s of j.estaciones) {
      if (!Array.isArray(s.v)) continue;
      const lat = Number(s.lat), lon = Number(s.lon);
      if (!enSabana(lat, lon)) { fuera++; continue; }
      const e = {
        id: String(s.id), nombre: String(s.nombre || ''), lat, lon,
        capacidad: Number.isFinite(Number(s.capacidad)) ? Number(s.capacidad) : null,
        bicis: num(s.v, 'bicis'), electricas: num(s.v, 'electricas'), anclajes_libres: num(s.v, 'anclajes_libres'),
        min_desde_reporte: num(s.v, 'min_desde_reporte'),
        estado: leerEstado(num(s.v, 'estado'), j.estado_bits)
      };
      e.ocupacion = e.bicis != null && e.anclajes_libres != null && e.bicis + e.anclajes_libres > 0 ? e.bicis / (e.bicis + e.anclajes_libres) : null;
      e.cat = categoria(e);
      estaciones.push(e);
    }
    return { estaciones, fuera, hora: j.hora_dato || j.generado, generado: j.generado, cadencia: j.cadencia_min, fuente: j.fuente, campos: j.campos, totales: j.totales };
  }

  // Serie de 48 h: una línea por corrida; ids[i] va con v[i]. Devuelve [t, bicis] de una estación.
  function serieDe(lineas, id, campos) {
    const ib = (campos || []).indexOf('bicis');
    const out = [];
    for (const l of lineas) {
      if (!l || !Array.isArray(l.ids) || !Array.isArray(l.v)) continue;
      const i = l.ids.indexOf(String(id));
      if (i < 0 || !Array.isArray(l.v[i])) continue;
      const b = l.v[i][ib < 0 ? 0 : ib];
      const t = Date.parse(l.t);
      if (b == null || Number.isNaN(t)) continue;
      out.push([t, Number(b)]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  const leerNdjson = (texto) => texto.split('\n').filter((s) => s.trim()).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

  // Pronóstico: las horas desde la hora en curso, hasta 48 adelante.
  function horasPronostico(j, ahora) {
    if (!j || j.esquema !== 'bogotwin/pronostico/1' || !Array.isArray(j.horas)) throw new Error('esquema');
    const desde = (ahora ?? Date.now()) - 3600000;
    return j.horas.filter((h) => { const t = Date.parse(h.t); return t >= desde && t <= desde + 49 * 3600000; })
      .map((h) => ({ t: Date.parse(h.t), temp: h.temp_c, prob: h.prob_lluvia_pct, mm: h.lluvia_mm }));
  }

  // Resumen de las próximas 24 horas: solo las horas desde ahora, para que la hora de lluvia
  // más alta nunca sea una que ya pasó. Las horas llegan como las deja horasPronostico.
  function resumen24(horas, ahora) {
    const t0 = ahora ?? Date.now();
    const prox = (horas || []).filter((h) => h.t >= t0 && h.t <= t0 + 24 * 3600000);
    const temps = prox.map((h) => h.temp).filter(Number.isFinite);
    const lluvia = prox.filter((h) => Number.isFinite(h.prob)).reduce((a, h) => (!a || h.prob > a.prob ? h : a), null);
    return { horas: prox.length, tmin: temps.length ? Math.min(...temps) : null, tmax: temps.length ? Math.max(...temps) : null, lluvia };
  }

  // Rótulos del eje de la gráfica: ancho estimado de cada rótulo (fuente de 9 px) y se quitan
  // los que se montarían sobre otro. Los días mandan sobre las horas. Junto a los bordes, el
  // rótulo se ancla a su lado para no salirse; si al hacerlo choca con el vecino, se quita.
  function anchoRotulo(texto, negrita) {
    let w = 0;
    for (const c of String(texto)) w += /[ .,:;il1]/.test(c) ? 3 : /[mw]/.test(c) ? 7.8 : 5.4;
    return w * (negrita ? 1.08 : 1);
  }
  function rotulosEje(marcas, desde, hasta, sep) {
    const hueco = sep ?? 3;
    const cajas = marcas.map((m, i) => {
      const w = anchoRotulo(m.texto, m.dia);
      let ancla = 'middle', iz = m.x - w / 2;
      if (m.x + w / 2 > hasta) { ancla = 'end'; iz = m.x - w; }
      else if (iz < desde) { ancla = 'start'; iz = m.x; }
      return { ...m, i, ancla, iz, de: iz + w };
    });
    const puestas = [];
    const choca = (c) => puestas.some((p) => c.iz < p.de + hueco && p.iz < c.de + hueco);
    for (const c of [...cajas.filter((c) => c.dia), ...cajas.filter((c) => !c.dia)]) if (!choca(c)) puestas.push(c);
    return puestas.sort((a, b) => a.i - b.i);
  }

  // Marcador de acierto: null quiere decir «todavía no hay con qué calificar», nunca 0.
  function marcador(j) {
    if (!j || j.esquema !== 'bogotwin/acierto/1' || !j.resumen) throw new Error('esquema');
    const ventana = (w) => {
      const r = j.resumen[w] || {};
      const plazo = (p) => {
        const x = r[p] || {};
        const t = x.temperatura || {}, l = x.lluvia || {};
        return {
          error: Number.isFinite(t.error_medio_c) ? t.error_medio_c : null, horas: t.horas || 0, sesgo: Number.isFinite(t.sesgo_c) ? t.sesgo_c : null,
          porcentaje: Number.isFinite(l.porcentaje) ? l.porcentaje : null, bloques: l.bloques || 0
        };
      };
      return { dias: r.dias_calificados || 0, desde: r.desde, hasta: r.hasta, a24h: plazo('a24h'), a48h: plazo('a48h') };
    };
    const v7 = ventana('ultimos_7_dias'), v30 = ventana('ultimos_30_dias');
    return { vacio: !v7.dias && !v30.dias, v7, v30 };
  }

  // Aire: los días con al menos 12 horas de modelo, hasta 5. La guía de la OMS (2021) para
  // 24 h es 15 µg/m³ y se compara con la media del día.
  const OMS_24H = 15;
  function diasAire(j, max) {
    if (!j || j.esquema !== 'bogotwin/aire/1' || !Array.isArray(j.dias)) throw new Error('esquema');
    return j.dias.filter((d) => d && d.horas >= 12 && Number.isFinite(d.media) && Number.isFinite(d.maxima))
      .slice(0, max || 5).map((d) => ({ fecha: d.fecha_bogota, media: d.media, maxima: d.maxima, horas: d.horas, pasaOms: d.media > OMS_24H }));
  }

  // Canales: nivel del SAB. El color dice qué tan cerca está el agua del umbral del IDIGER.
  // Nunca inventamos un umbral: sin bajo, medio y alto publicados, la categoría es «sin_umbrales».
  const MIN_SIN_LECTURA = 60;
  function categoriaCanal(s) {
    if (s.lectura == null || s.espejo == null) return 'sin_dato';
    if (s.min_desde_lectura != null && s.min_desde_lectura > MIN_SIN_LECTURA) return 'quieto';
    if (s.dudoso) return 'dudoso';
    if (s.borde != null && s.borde <= 0) return 'desborde';
    const u = s.umbrales;
    if (!u || ![u.bajo, u.medio, u.alto].every(Number.isFinite)) return 'sin_umbrales';
    if (s.espejo >= u.alto) return 'alto';
    if (s.espejo >= u.medio) return 'medio';
    if (s.espejo >= u.bajo) return 'bajo';
    return 'bajo_umbral';
  }

  function decodificarCanales(j) {
    if (!j || j.esquema !== 'bogotwin/canales/1' || !Array.isArray(j.campos) || !Array.isArray(j.sensores)) throw new Error('esquema');
    const ix = {};
    j.campos.forEach((c, i) => { ix[c] = i; });
    const num = (v, k) => { const x = ix[k] == null || !Array.isArray(v) ? null : v[ix[k]]; return x == null || !Number.isFinite(Number(x)) ? null : Number(x); };
    const fin = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
    const sensores = [];
    for (const s of j.sensores) {
      const lat = Number(s.lat), lon = Number(s.lon);
      if (!enSabana(lat, lon)) continue;
      const u = s.umbrales_msnm;
      const e = {
        id: String(s.id), nombre: String(s.nombre || ''), cauce: String(s.cauce || ''), localidad: String(s.localidad || ''), lat, lon,
        tipo: Number(s.tipo_lectura), cota: fin(s.cota_sensor_msnm), fondo: fin(s.fondo_msnm), desborde: fin(s.desborde_msnm),
        umbrales: u && typeof u === 'object' ? { bajo: fin(u.bajo), medio: fin(u.medio), alto: fin(u.alto) } : null,
        hora: s.hora || null,
        lectura: num(s.v, 'lectura_m'), espejo: num(s.v, 'espejo_msnm'), borde: num(s.v, 'borde_libre_m'),
        min_desde_lectura: num(s.v, 'min_desde_lectura'), dudoso: num(s.v, 'dudoso') === 1
      };
      e.cat = categoriaCanal(e);
      sensores.push(e);
    }
    return { sensores, hora: j.hora_dato || j.generado, generado: j.generado, cadencia: j.cadencia_min, fuente: j.fuente, campos: j.campos, totales: j.totales, etiquetas: j.etiquetas || {} };
  }

  // Serie de 48 h de un sensor: [t, borde libre]. Si la lectura no cambió de hora, se repite la
  // misma fila del SAB; se toma la hora de cada corrida y los huecos quedan como huecos.
  function serieCanal(lineas, id, campos, campo) {
    const i0 = (campos || []).indexOf(campo || 'borde_libre_m');
    const out = [];
    for (const l of lineas) {
      if (!l || !Array.isArray(l.ids) || !Array.isArray(l.v) || i0 < 0) continue;
      const i = l.ids.indexOf(String(id));
      if (i < 0 || !Array.isArray(l.v[i])) continue;
      const x = l.v[i][i0];
      const t = Date.parse(l.t);
      if (x == null || !Number.isFinite(Number(x)) || Number.isNaN(t)) continue;
      out.push([t, Number(x)]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }


  // Aire por hora para la bruma del cielo 3D (sol-barra.js). ms es el momento que muestra la
  // barra del sol; vale la hora que lo contiene (Bogotá va en UTC−5, las horas caen iguales).
  // estado: 'ok' con pm25, 'fuera' (el pronóstico no tiene esa hora o la trae vacía), 'viejo'
  // (el archivo pasó del doble de su cadencia, la regla del repo vivo) o 'sin_dato'.
  function aireEnHora(j, ms, ahora) {
    if (!j || j.esquema !== 'bogotwin/aire/1' || !Array.isArray(j.horas) || !Number.isFinite(ms)) return { estado: 'sin_dato' };
    if (sinDatoReciente(j.generado, j.cadencia_min, ahora)) return { estado: 'viejo' };
    const campos = Array.isArray(j.horas_campos) ? j.horas_campos : ['t', 'pm25'];
    const it = campos.indexOf('t'), ip = campos.indexOf('pm25');
    if (it < 0 || ip < 0) return { estado: 'sin_dato' };
    const hora = Math.floor(ms / 3600000) * 3600000;
    for (const h of j.horas) {
      if (!Array.isArray(h) || Date.parse(h[it]) !== hora) continue;
      const v = h[ip];
      return v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? { estado: 'ok', pm25: Number(v), t: hora } : { estado: 'fuera' };
    }
    return { estado: 'fuera' };
  }
  // Bruma del aire con la fórmula de Koschmieder (visibilidad ≈ 3,912 / extinción). La
  // extinción de las partículas es MEE · f(HR) · PM2,5: MEE de 4 m²/g para aerosol urbano seco
  // y f(HR) de 1,5 por la humedad de las mañanas de Bogotá; la del aire limpio (Rayleigh a
  // 2.600 m) es cerca de 1,2·10⁻⁵ m⁻¹. Son supuestos de libro, no una medida de Bogotá.
  // El visor ya dibuja el aire limpio (unos 5 µg/m³ de fondo): la bruma suma solo lo de más.
  const KOSCHMIEDER = 3.912;
  const MEE_M2_G = 4, F_HR = 1.5, B_RAYLEIGH = 1.2e-5, PM_FONDO = 5;
  const BRUMA_FISICA = { KOSCHMIEDER, MEE_M2_G, F_HR, B_RAYLEIGH, PM_FONDO };
  const pmValido = (pm25) => pm25 != null && pm25 !== '' && Number.isFinite(Number(pm25)) && Number(pm25) >= 0;
  // Extinción total (m⁻¹) y visibilidad (m) para un PM2,5.
  function extincion(pm25) { return B_RAYLEIGH + MEE_M2_G * F_HR * 1e-6 * (pmValido(pm25) ? Number(pm25) : 0); }
  function visibilidad(pm25) { return KOSCHMIEDER / extincion(pm25); }
  // Extinción que la bruma suma al aire limpio que ya dibuja el visor (m⁻¹; 0 si no hay dato).
  function brumaAire(pm25) {
    if (!pmValido(pm25)) return 0;
    return MEE_M2_G * F_HR * 1e-6 * Math.max(0, Number(pm25) - PM_FONDO);
  }

  const api = { BASE, url, limiteMin, sinDatoReciente, leerEstado, enSabana, categoria, decodificarBicis, serieDe, leerNdjson, horasPronostico, resumen24, anchoRotulo, rotulosEje, marcador, diasAire, aireEnHora, brumaAire, extincion, visibilidad, BRUMA_FISICA, OMS_24H, MIN_SIN_REPORTE,
    categoriaCanal, decodificarCanales, serieCanal, MIN_SIN_LECTURA };
  const raiz = typeof window !== 'undefined' ? window : globalThis;
  raiz.Bogotwin = Object.assign(raiz.Bogotwin || {}, { vivo: api });
})();
