'use strict';
// Cuentas de «¿Qué pasa si…?» (docs/escenarios.md). Solo funciones puras: no tocan el mapa ni
// el DOM y se prueban en Node (pruebas/escenarios.prueba.js). Corre igual en el navegador
// (window.Bogotwin.escenariosModelo) y con require().
//
// Dos escenarios:
//  1. Aire de un día malo: si el PM2,5 promedio de la ciudad en un día llega a P, cuánto le toca
//     a cada colegio y sede de salud (repartido como el promedio de 2025 de la SDA), cuáles pasan
//     el umbral de aviso que elijas y cuánto se ve la ciudad (Koschmieder, la misma cuenta de la
//     bruma del cielo en vivo-datos.js).
//  2. Árboles en una calle: una fila de árboles de un porte, con su separación, a cierta edad;
//     cuánta sombra dejan en el suelo a una hora y una fecha (posición del sol de sol.js).
(function (raiz) {
  const RAD = Math.PI / 180;

  // ── 1. Aire de un día malo ──────────────────────────────────────────────

  // Umbrales de 24 horas con respaldo. No hay otro: la perilla es de dos posiciones.
  //   oms   guía de la OMS de 2021 para 24 h (WHO Global Air Quality Guidelines, tabla 0.1).
  //   norma nivel máximo permisible de 24 h en Colombia (Res. 2254 de 2017, art. 2, tabla 1).
  const UMBRALES = {
    oms: { valor: 15, nombre: 'guía de la OMS para 24 horas' },
    norma: { valor: 37, nombre: 'norma colombiana de 24 horas' }
  };
  const PM_MIN = 5, PM_MAX = 100;

  // Área de un anillo en km² (trapecio sobre la esfera), igual que aire-anual-datos.js.
  function areaAnillo(anillo) {
    const R = 6371.0088;
    let s = 0;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      s += (anillo[i][0] - anillo[j][0]) * RAD * (2 + Math.sin(anillo[j][1] * RAD) + Math.sin(anillo[i][1] * RAD));
    }
    return Math.abs(s * R * R / 2);
  }
  function areaKm2(g) {
    const polis = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let a = 0;
    for (const p of polis) p.forEach((anillo, k) => { a += (k === 0 ? 1 : -1) * areaAnillo(anillo); });
    return a;
  }

  // Promedio de 2025 de toda el área urbana, pesado por el área de cada franja (µg/m³).
  function mediaPonderada(fc) {
    let s = 0, a = 0;
    for (const f of (fc && fc.features) || []) {
      const v = Number(f.properties && f.properties.pm25);
      const ar = areaKm2(f.geometry);
      if (!Number.isFinite(v) || !(ar > 0)) continue;
      s += v * ar; a += ar;
    }
    return a > 0 ? s / a : null;
  }

  // Lo que le toca a un lugar si la ciudad entera promedia P en el día. Supuesto: el día malo
  // se reparte como el promedio de 2025 (las zonas sucias del año siguen siendo las sucias).
  function pmEnLugar(anual, P, media) {
    if (!Number.isFinite(anual) || !Number.isFinite(P) || !(media > 0)) return null;
    return P * anual / media;
  }

  // Cuenta de lugares sobre el umbral. lugares: [{ anual }]; los que no tienen valor anual
  // (fuera del área que interpola la SDA) van aparte, nunca se cuentan como limpios.
  function contar(lugares, P, media, umbral) {
    let sobre = 0, bajo = 0, sinValor = 0;
    for (const l of lugares) {
      const v = pmEnLugar(l.anual, P, media);
      if (v == null) sinValor++;
      else if (v > umbral) sobre++;
      else bajo++;
    }
    return { sobre, bajo, sinValor, total: lugares.length };
  }

  // Puntos de quiebre: con qué promedio de ciudad pasa el umbral el primer lugar (el de la franja
  // más sucia) y con cuál pasan todos (el de la más limpia).
  function quiebres(lugares, media, umbral) {
    const vals = lugares.map((l) => l.anual).filter(Number.isFinite);
    if (!vals.length || !(media > 0)) return null;
    const max = Math.max(...vals), min = Math.min(...vals);
    return { primero: umbral * media / max, todos: umbral * media / min };
  }

  // Visibilidad en km para un PM2,5, con la misma cuenta de la bruma (vivo-datos.js).
  // Devuelve el rango de la ciudad: con el lugar más sucio y con el más limpio.
  function visibilidadKm(vivo, P, media, minAnual, maxAnual) {
    if (!vivo || typeof vivo.visibilidad !== 'function') return null;
    const km = (pm) => vivo.visibilidad(pm) / 1000;
    return { ciudad: km(P), peor: km(pmEnLugar(maxAnual, P, media)), mejor: km(pmEnLugar(minAnual, P, media)) };
  }

  // Clase del valor de un día para pintar el mapa: 0 hasta 15, 1 de 15 a 37, 2 más de 37.
  function claseDia(v) { return v > UMBRALES.norma.valor ? 2 : v > UMBRALES.oms.valor ? 1 : 0; }

  // ── 2. Árboles en una calle ─────────────────────────────────────────────

  // Portes con su altura adulta en metros. Supuesto: tres clases redondas, no especies.
  const PORTES = {
    bajo: { adulto: 6, nombre: 'bajo' },
    medio: { adulto: 12, nombre: 'medio' },
    alto: { adulto: 20, nombre: 'alto' }
  };
  // Metros por año. Supuesto: no hay curvas de crecimiento publicadas para Bogotá.
  const RITMOS = { lento: 0.3, medio: 0.6, rapido: 1.0 };
  const ALTO_AL_SEMBRAR = 2;   // m, supuesto
  const ANDEN_M = 3;           // m, ancho de la franja del andén que se cuenta, supuesto
  const SOL_MINIMO = 3;        // grados; más bajo no se cuenta sombra (igual que sombra-geom.js)

  function alturaA(porte, anios, ritmo) {
    const p = PORTES[porte] || PORTES.medio;
    const r = RITMOS[ritmo] != null ? RITMOS[ritmo] : RITMOS.medio;
    const t = Math.max(0, Number(anios) || 0);
    return Math.min(p.adulto, ALTO_AL_SEMBRAR + r * t);
  }

  // Copa redonda con las proporciones de arboles.js (perfil, forma 0): tronco libre, alto de copa
  // y radio de copa. Para árboles chicos el radio no pasa de la mitad de la altura (un árbol de
  // 2 m no tiene copa de 3 m); desde unos 6 m de alto es igual a arboles.js.
  function copa(h) {
    const alto = Math.max(1.5, Math.min(60, Number(h) || 0));
    let tronco = Math.max(1.2, 0.35 * alto);
    if (tronco > alto - 0.6) tronco = alto - 0.6;
    const copaAlto = alto - tronco;
    const rCopa = Math.min(8, Math.max(0.8, 0.8 + 0.36 * alto), 0.5 * alto);
    const rTronco = Math.min(0.45, 0.06 + 0.012 * alto);
    return { alto, tronco, copaAlto, rCopa, rTronco };
  }

  // Sombra de una copa elipsoide (radio r a lo ancho, copaAlto/2 a lo alto) con el sol a cierta
  // altura y azimut, sobre suelo plano. Devuelve la elipse en metros, relativa al pie del árbol:
  // centro (dx al oriente, dy al norte), semieje a lo largo de la sombra (a) y a lo ancho (b),
  // dirección (ux, uy) y el tronco como segmento de largo «tronco».
  function sombraArbol(c, sol) {
    if (!sol || !(sol.altura > SOL_MINIMO)) return null;
    const al = sol.altura * RAD, az = sol.azimut * RAD;
    const ux = -Math.sin(az), uy = -Math.cos(az);           // hacia donde cae la sombra
    const cot = Math.cos(al) / Math.sin(al);
    const hc = c.tronco + c.copaAlto / 2;
    const cz = c.copaAlto / 2;
    const a = Math.sqrt((c.rCopa * Math.sin(al)) ** 2 + (cz * Math.cos(al)) ** 2) / Math.sin(al);
    return { dx: ux * hc * cot, dy: uy * hc * cot, a, b: c.rCopa, ux, uy, troncoLargo: c.tronco * cot, rTronco: c.rTronco };
  }

  // Pies de la fila en metros locales: n árboles separados «sep», centrados en 0, a lo largo del
  // rumbo (grados desde el norte: 0 una carrera de sur a norte, 90 una calle de occidente a oriente).
  function fila(n, sep, rumbo) {
    const k = Math.max(1, Math.round(n)), s = Math.max(1, Number(sep) || 1);
    const ex = Math.sin((rumbo || 0) * RAD), ey = Math.cos((rumbo || 0) * RAD);
    const out = [];
    for (let i = 0; i < k; i++) { const u = (i - (k - 1) / 2) * s; out.push([u * ex, u * ey]); }
    return out;
  }

  function dentroSombra(x, y, pie, sm) {
    // Copa: elipse con centro corrido.
    const px = x - pie[0] - sm.dx, py = y - pie[1] - sm.dy;
    const t = px * sm.ux + py * sm.uy, w = -px * sm.uy + py * sm.ux;
    if ((t / sm.a) ** 2 + (w / sm.b) ** 2 <= 1) return true;
    // Tronco: franja del pie hasta donde empieza la copa.
    const qx = x - pie[0], qy = y - pie[1];
    const tt = qx * sm.ux + qy * sm.uy, ww = -qx * sm.uy + qy * sm.ux;
    return tt >= 0 && tt <= sm.troncoLargo && Math.abs(ww) <= sm.rTronco;
  }

  // Área de sombra en m² (sin contar dos veces donde se juntan dos copas), contada en una
  // cuadrícula de «paso» metros, y la parte del andén a la sombra: una franja de ANDEN_M de ancho
  // centrada en la fila y del largo de la fila más media separación a cada lado.
  function sombraFila({ n, sep, rumbo, h, sol, paso }) {
    const pies = fila(n, sep, rumbo);
    const c = copa(h);
    const sm = sombraArbol(c, sol);
    const k = pies.length, s = Math.max(1, Number(sep) || 1);
    const largo = k * s;
    if (!sm) return { area: 0, porArbol: 0, anden: 0, copa: c, sombra: null, pies };
    const d = Math.max(0.1, paso || 0.5);
    const alcance = Math.hypot(sm.dx, sm.dy) + Math.max(sm.a, sm.b, sm.troncoLargo) + 1;
    const xs = pies.map((p) => p[0]), ys = pies.map((p) => p[1]);
    const ex = Math.sin((rumbo || 0) * RAD), ey = Math.cos((rumbo || 0) * RAD);
    // Solo se recorre la caja que puede tener sombra o andén.
    const m = alcance + ANDEN_M + s;
    const caja = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m };
    let somb = 0, andenTot = 0, andenSomb = 0;
    for (let y = caja.y0 + d / 2; y < caja.y1; y += d) {
      for (let x = caja.x0 + d / 2; x < caja.x1; x += d) {
        let si = false;
        for (const p of pies) {
          if (Math.abs(x - p[0] - sm.dx) > alcance || Math.abs(y - p[1] - sm.dy) > alcance) continue;
          if (dentroSombra(x, y, p, sm)) { si = true; break; }
        }
        if (si) somb++;
        const u = x * ex + y * ey, v = -x * ey + y * ex;
        if (Math.abs(u) <= largo / 2 && Math.abs(v) <= ANDEN_M / 2) { andenTot++; if (si) andenSomb++; }
      }
    }
    const area = somb * d * d;
    return { area, porArbol: area / k, anden: andenTot ? andenSomb / andenTot : 0, copa: c, sombra: sm, pies };
  }

  // Los tres ritmos a la vez: el rango que se muestra (lento a rápido) y el del medio.
  function rangoFila(op) {
    const r = {};
    for (const ritmo of Object.keys(RITMOS)) {
      const h = alturaA(op.porte, op.anios, ritmo);
      r[ritmo] = Object.assign({ h }, sombraFila(Object.assign({}, op, { h })));
    }
    return r;
  }

  // Polígono de una elipse de sombra en metros locales (para dibujarla), con «lados» vértices.
  function poligonoSombra(pie, sm, lados) {
    const k = lados || 32, out = [];
    for (let i = 0; i <= k; i++) {
      const t = (i % k) / k * 2 * Math.PI;
      const a = Math.cos(t) * sm.a, b = Math.sin(t) * sm.b;
      out.push([pie[0] + sm.dx + a * sm.ux - b * sm.uy, pie[1] + sm.dy + a * sm.uy + b * sm.ux]);
    }
    return out;
  }
  function circulo(cx, cy, r, lados) {
    const k = lados || 24, out = [];
    for (let i = 0; i <= k; i++) { const t = (i % k) / k * 2 * Math.PI; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return out;
  }
  // Metros locales a longitud y latitud alrededor de un origen (aproximación plana; en 200 m el
  // error es de centímetros).
  function aLonLat(xy, origen) {
    const [lon0, lat0] = origen;
    return [lon0 + xy[0] / (111320 * Math.cos(lat0 * RAD)), lat0 + xy[1] / 110540];
  }

  const api = { UMBRALES, PM_MIN, PM_MAX, areaKm2, mediaPonderada, pmEnLugar, contar, quiebres, visibilidadKm, claseDia,
    PORTES, RITMOS, ALTO_AL_SEMBRAR, ANDEN_M, SOL_MINIMO, alturaA, copa, sombraArbol, fila, sombraFila, rangoFila, poligonoSombra, circulo, aLonLat };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz && typeof raiz === 'object') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.escenariosModelo = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
