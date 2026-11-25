'use strict';
// Lectura de los datos del repo vivo (bicis, pronóstico, acierto y aire). Solo funciones
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

  const api = { BASE, url, limiteMin, sinDatoReciente, leerEstado, enSabana, categoria, decodificarBicis, serieDe, leerNdjson, horasPronostico, marcador, diasAire, OMS_24H, MIN_SIN_REPORTE };
  const raiz = typeof window !== 'undefined' ? window : globalThis;
  raiz.Bogotwin = Object.assign(raiz.Bogotwin || {}, { vivo: api });
})();
