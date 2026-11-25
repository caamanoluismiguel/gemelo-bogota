'use strict';
// Escenario «Edificio nuevo: el sol que les quita a los vecinos». Solo cuentas, sin mapa:
// sirve en el navegador y en Node (pruebas/edificio-calculo.prueba.js).
//
// Todo va en metros, en un plano local con el origen en el centro del lote: x al oriente,
// y al norte. A 300 m del origen el error de tomar la Tierra plana es de milímetros.
//
// Lo que no sabemos se cuenta como franja, nunca como un número suelto:
//  * metros por piso, de 2,8 a 3,3 (vale para el edificio nuevo y para los vecinos);
//  * copa de los árboles vecinos: «sin copa» (el sol pasa) o «copa cerrada» (tapa como un muro).
// Cada cifra sale de las cuatro combinaciones y se muestra de la menor a la mayor.
(function (raiz) {
  const enNode = typeof module === 'object' && module.exports;
  const SOL = enNode ? require('./sol.js') : raiz.Bogotwin.sol;
  const G = enNode ? require('./sombra-geom.js') : raiz.Bogotwin.sombraGeom;

  const RAD = Math.PI / 180;
  const M_GRADO = 40075016.686 / 360;          // metros por grado de latitud (la misma esfera de sombra-geom)
  const LAT = 4.6097, LON = -74.0817;          // el sol se calcula aquí, igual que la barra del sol
  const M_PISO = [2.8, 3.3];                   // supuesto: alto de un piso, de menos a más
  const ANIO = 2026;                           // año de referencia: así el mismo enlace da lo mismo siempre
  const CELDA = 3;                             // lado de la celda del suelo, m
  const RADIO = 200;                           // se cuenta el suelo hasta 200 m del centro del lote
  const MARCHA = 200;                          // lo que tapa el sol hoy se busca hasta 200 m más allá
  const PASO = 15;                             // minutos entre cuentas para el año
  const DIA = [5 * 60 + 30, 18 * 60 + 30];     // el sol de Bogotá sale y se pone dentro de esto
  const MANANA = [7 * 60, 10 * 60];
  const RECREO = [9 * 60 + 30, 10 * 60];       // supuesto: el recreo de la mañana
  const PASO_PATIO = 5;                        // minutos entre cuentas para el patio
  const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const LIMITES = { pisos: [1, 60], retroceso: [0, 15], huella: [30, 100], ancho: [6, 120], fondo: [6, 120] };
  // Combinaciones: [m por piso, cuentan los árboles]
  const COMBOS = [[M_PISO[0], false], [M_PISO[1], false], [M_PISO[0], true], [M_PISO[1], true]];

  // ── Plano local ──────────────────────────────────────────────────────────
  function aLocal(lon, lat, o) {
    return [(lon - o[0]) * M_GRADO * Math.cos(o[1] * RAD), (lat - o[1]) * M_GRADO];
  }
  function aLonLat(p, o) {
    return [o[0] + p[0] / (M_GRADO * Math.cos(o[1] * RAD)), o[1] + p[1] / M_GRADO];
  }

  // ── Polígonos ────────────────────────────────────────────────────────────
  // Envolvente convexa (cadena monótona), en sentido antihorario y sin repetir el primero.
  function envolvente(puntos) {
    const p = puntos.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const abajo = [], arriba = [];
    for (const q of p) {
      while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop();
      abajo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop();
      arriba.push(q);
    }
    abajo.pop(); arriba.pop();
    return abajo.concat(arriba);
  }
  function area(pol) {
    let a = 0;
    for (let i = 0, n = pol.length; i < n; i++) { const p = pol[i], q = pol[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  // Punto dentro de un polígono convexo antihorario (el borde cuenta como dentro).
  function dentroConvexo(x, y, pol) {
    for (let i = 0, n = pol.length; i < n; i++) {
      const a = pol[i], b = pol[(i + 1) % n];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-9) return false;
    }
    return true;
  }

  // Rectángulo de menor área que encierra los puntos (un lado siempre va sobre un lado de la
  // envolvente). giro: grados del lado «ancho» medidos desde el oriente, contra el reloj.
  function rectanguloMinimo(puntos) {
    const h = envolvente(puntos);
    if (h.length < 3) return null;
    let mejor = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(t), s = Math.sin(t);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of h) {
        const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      const ar = (u1 - u0) * (v1 - v0);
      if (!mejor || ar < mejor.ar - 1e-9) {
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
        mejor = { ar, cx: uc * c - vc * s, cy: uc * s + vc * c, ancho: u1 - u0, fondo: v1 - v0, giro: t / RAD };
      }
    }
    // Giro entre −45° y 45°: el mismo rectángulo siempre se escribe igual.
    let { giro, ancho, fondo } = mejor;
    while (giro > 45) { giro -= 90; [ancho, fondo] = [fondo, ancho]; }
    while (giro <= -45) { giro += 90; [ancho, fondo] = [fondo, ancho]; }
    return { cx: mejor.cx, cy: mejor.cy, ancho, fondo, giro };
  }

  // Las cuatro esquinas, antihorario.
  function esquinas(r) {
    const t = (r.giro || 0) * RAD, c = Math.cos(t), s = Math.sin(t);
    const a = r.ancho / 2, b = r.fondo / 2, cx = r.cx || 0, cy = r.cy || 0;
    return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
  }

  // Huella del edificio dentro del lote: se quita el retroceso por los cuatro lados y la
  // huella (porcentaje de lo que queda) se reparte igual en los dos lados.
  function volumen(lote, palancas) {
    const r = palancas.retroceso || 0;
    const s = Math.sqrt(Math.max(0.01, (palancas.huella == null ? 100 : palancas.huella) / 100));
    const ancho = Math.max(3, lote.ancho - 2 * r) * s, fondo = Math.max(3, lote.fondo - 2 * r) * s;
    const rect = { cx: lote.cx || 0, cy: lote.cy || 0, ancho, fondo, giro: lote.giro || 0 };
    return { rect, pts: esquinas(rect), ancho, fondo, area: ancho * fondo };
  }

  // Sombra en el suelo de un prisma de base convexa: la base barrida hasta la punta.
  // Devuelve el polígono (antihorario) o null si el sol está bajo (menos de 3°) o de noche.
  function sombra(pts, alto, sol) {
    const v = G.vectorSombra(sol);
    if (!v) return null;
    return envolvente(pts.concat(pts.map((p) => [p[0] + v[0] * alto, p[1] + v[1] * alto])));
  }

  // ── Momentos del año (en caché: el sol no cambia) ───────────────────────
  let cacheAnio = null, cachePatio = null;
  function momentosAnio() {
    if (cacheAnio) return cacheAnio;
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const base = SOL.desdeBogota(ANIO, m, 15, 0, 0, 0);
      for (let t = DIA[0] + PASO / 2; t < DIA[1]; t += PASO) {
        const sol = SOL.posicion(base + t * 60000, LAT, LON);
        if (!G.vectorSombra(sol)) continue;
        out.push({ mes: m, min: t, sol, horas: (PASO / 60) * DIAS_MES[m - 1], manana: t > MANANA[0] && t < MANANA[1] });
      }
    }
    return (cacheAnio = out);
  }
  // Los 365 días, de 7 a 10 a. m., cada 5 min (centro de cada tramo).
  function momentosPatio() {
    if (cachePatio) return cachePatio;
    const dias = [];
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= DIAS_MES[m - 1]; d++) {
        const base = SOL.desdeBogota(ANIO, m, d, 0, 0, 0);
        const lista = [];
        for (let t = MANANA[0] + PASO_PATIO / 2; t < MANANA[1]; t += PASO_PATIO) {
          lista.push({ min: t, sol: SOL.posicion(base + t * 60000, LAT, LON), recreo: t > RECREO[0] && t < RECREO[1] });
        }
        dias.push({ mes: m, dia: d, lista });
      }
    }
    return (cachePatio = dias);
  }

  // ── Rejilla del suelo ────────────────────────────────────────────────────
  // construcciones: [{ anillos: [[[x, y], ...]], pisos }] en metros locales.
  // arboles: [{ x, y, h (m), r (radio de copa, m) }]. lote: esquinas del lote (antihorario).
  function armarRejilla(op) {
    const celda = op.celda || CELDA, radio = op.radio || RADIO, marcha = op.marcha || MARCHA;
    const c = Math.ceil((radio + marcha) / celda), n = 2 * c + 1;
    const pisos = new Float32Array(n * n), arbol = new Float32Array(n * n), lote = new Uint8Array(n * n);
    const xDe = (i) => (i - c) * celda;
    let maxPisos = 0, maxArbol = 0;
    // Huellas: una fila a la vez, par e impar entre todos los anillos (los patios quedan fuera).
    for (const k of op.construcciones || []) {
      const p = Math.max(1, Number(k.pisos) || 1);
      let y0 = Infinity, y1 = -Infinity;
      for (const r of k.anillos) for (const q of r) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      const j0 = Math.max(0, Math.ceil(y0 / celda + c)), j1 = Math.min(n - 1, Math.floor(y1 / celda + c));
      for (let j = j0; j <= j1; j++) {
        const y = xDe(j), xs = [];
        for (const r of k.anillos) {
          for (let a = 0, m = r.length, b = m - 1; a < m; b = a++) {
            const pa = r[a], pb = r[b];
            if ((pa[1] > y) !== (pb[1] > y)) xs.push(pa[0] + (y - pa[1]) * (pb[0] - pa[0]) / (pb[1] - pa[1]));
          }
        }
        xs.sort((u, v) => u - v);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const i0 = Math.max(0, Math.ceil(xs[q] / celda + c)), i1 = Math.min(n - 1, Math.floor(xs[q + 1] / celda + c));
          for (let i = i0; i <= i1; i++) { const o = j * n + i; if (p > pisos[o]) pisos[o] = p; }
        }
      }
      if (p > maxPisos) maxPisos = p;
    }
    for (const t of op.arboles || []) {
      const rr = Math.max(0.5, t.r), ci = t.x / celda + c, cj = t.y / celda + c, rc = rr / celda;
      for (let j = Math.max(0, Math.ceil(cj - rc)); j <= Math.min(n - 1, Math.floor(cj + rc)); j++) {
        for (let i = Math.max(0, Math.ceil(ci - rc)); i <= Math.min(n - 1, Math.floor(ci + rc)); i++) {
          if ((i - ci) ** 2 + (j - cj) ** 2 > rc * rc) continue;
          const o = j * n + i; if (t.h > arbol[o]) arbol[o] = t.h;
        }
      }
      if (t.h > maxArbol) maxArbol = t.h;
    }
    if (op.lote) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (dentroConvexo(xDe(i), xDe(j), op.lote)) lote[j * n + i] = 1;
    }
    return { celda, radio, marcha, c, n, pisos, arbol, lote, maxPisos, maxArbol, alto: Math.max(maxPisos * M_PISO[1], maxArbol) };
  }

  // Lo más alto que hay hacia el sol desde la celda (i, j): [pisos por metro, metros de copa por metro].
  // Se camina en pasos de 2/3 de celda hasta MARCHA, o hasta donde nada pueda tapar ya ese sol.
  function rayo(R, i, j, az, tanAlt, salida) {
    const dx = Math.sin(az * RAD), dy = Math.cos(az * RAD), paso = R.celda * 2 / 3;
    const lejos = Math.min(R.marcha, tanAlt > 0 ? R.alto / tanAlt : R.marcha);
    let e = 0, t = 0;
    for (let d = paso; d <= lejos; d += paso) {
      const ii = Math.round(i + dx * d / R.celda), jj = Math.round(j + dy * d / R.celda);
      if (ii < 0 || jj < 0 || ii >= R.n || jj >= R.n) break;
      const o = jj * R.n + ii;
      const p = R.pisos[o]; if (p > 0 && p / d > e) e = p / d;
      const a = R.arbol[o]; if (a > 0 && a / d > t) t = a / d;
    }
    salida[0] = e; salida[1] = t;
    return salida;
  }
  // ¿Tenía sol hoy? (antes del edificio nuevo) con k m por piso y con o sin copas.
  const conSol = (tanAlt, e, t, k, arboles) => tanAlt > k * e && (!arboles || tanAlt > t);

  // cerros(az) → altura en grados del horizonte de los cerros visto desde el lote, o null.
  function tapanCerros(cerros, sol) { return !!cerros && sol.altura <= cerros(sol.azimut); }

  // ── Las cifras del escenario ─────────────────────────────────────────────
  // R: rejilla. huella: esquinas del edificio nuevo. pisos. op: { cerros, patio: [x, y] }.
  // Devuelve { horasM2: [min, max], combos: [...], patio: {...} | null, peor: [x, y] | null }.
  function metricas(R, huella, pisos, op) {
    const o = op || {};
    const lista = momentosAnio();
    const perdida = [0, 0, 0, 0];
    const celdaM2 = R.celda * R.celda;
    const manana = new Float32Array(R.n * R.n), total = new Float32Array(R.n * R.n);
    const tmp = [0, 0];
    const r2 = (R.radio / R.celda) ** 2;
    let celdasRayo = 0;
    for (const m of lista) {
      if (tapanCerros(o.cerros, m.sol)) continue;
      const H1 = sombra(huella, pisos * M_PISO[1], m.sol), H0 = sombra(huella, pisos * M_PISO[0], m.sol);
      if (!H1) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of H1) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const i0 = Math.max(0, Math.ceil(x0 / R.celda + R.c)), i1 = Math.min(R.n - 1, Math.floor(x1 / R.celda + R.c));
      const j0 = Math.max(0, Math.ceil(y0 / R.celda + R.c)), j1 = Math.min(R.n - 1, Math.floor(y1 / R.celda + R.c));
      const tanAlt = Math.tan(m.sol.altura * RAD);
      for (let j = j0; j <= j1; j++) {
        const y = (j - R.c) * R.celda, dj = (j - R.c) ** 2;
        for (let i = i0; i <= i1; i++) {
          if ((i - R.c) ** 2 + dj > r2) continue;
          const k = j * R.n + i;
          if (R.lote[k] || R.pisos[k] > 0) continue;
          const x = (i - R.c) * R.celda;
          if (!dentroConvexo(x, y, H1)) continue;
          const en0 = dentroConvexo(x, y, H0);
          rayo(R, i, j, m.sol.azimut, tanAlt, tmp);
          celdasRayo++;
          for (let q = 0; q < 4; q++) {
            const [mp, arb] = COMBOS[q];
            if (mp === M_PISO[0] && !en0) continue;
            if (!conSol(tanAlt, tmp[0], tmp[1], mp, arb)) continue;
            perdida[q] += m.horas * celdaM2;
            if (q === 1) { total[k] += m.horas; if (m.manana) manana[k] += m.horas; }
          }
        }
      }
    }
    // El punto más golpeado en la mañana (o en el día, si la mañana no pierde nada).
    let peor = -1, vPeor = 0;
    for (const arr of [manana, total]) {
      for (let k = 0; k < arr.length; k++) if (arr[k] > vPeor) { vPeor = arr[k]; peor = k; }
      if (peor >= 0) break;
    }
    const peorXY = peor >= 0 ? [((peor % R.n) - R.c) * R.celda, (Math.floor(peor / R.n) - R.c) * R.celda] : null;
    const combos = COMBOS.map(([mp, arb], q) => ({ mPiso: mp, arboles: arb, horasM2: perdida[q] }));
    const patioXY = o.patio || peorXY;
    return {
      horasM2: rango(perdida), combos, peor: peorXY, celdasRayo,
      patio: patioXY ? patio(R, huella, pisos, patioXY, o.cerros) : null,
      patioEsPeor: !o.patio && !!peorXY
    };
  }

  // Un punto del suelo (el patio): minutos de sol perdidos de 7 a 10 a. m. y días de recreo sin sol.
  function patio(R, huella, pisos, xy, cerros) {
    const i = Math.round(xy[0] / R.celda + R.c), j = Math.round(xy[1] / R.celda + R.c);
    const fuera = i < 0 || j < 0 || i >= R.n || j >= R.n;
    const k = fuera ? -1 : j * R.n + i;
    const enLote = k >= 0 && R.lote[k] === 1, enTecho = k >= 0 && R.pisos[k] > 0;
    const minutos = [0, 0, 0, 0], peorDia = [0, 0, 0, 0], recreo = [0, 0, 0, 0], recreoHoy = [0, 0, 0, 0];
    const tmp = [0, 0];
    const dias = momentosPatio();
    if (!fuera && !enLote) {
      for (const d of dias) {
        const minDia = [0, 0, 0, 0], solAntes = [false, false, false, false], solDespues = [false, false, false, false];
        for (const s of d.lista) {
          if (!G.vectorSombra(s.sol) || tapanCerros(cerros, s.sol)) continue;
          const tanAlt = Math.tan(s.sol.altura * RAD);
          rayo(R, i, j, s.sol.azimut, tanAlt, tmp);
          const H = [sombra(huella, pisos * M_PISO[0], s.sol), sombra(huella, pisos * M_PISO[1], s.sol)];
          for (let q = 0; q < 4; q++) {
            const [mp, arb] = COMBOS[q];
            const antes = !enTecho && conSol(tanAlt, tmp[0], tmp[1], mp, arb);
            const tapa = antes && dentroConvexo(xy[0], xy[1], H[mp === M_PISO[0] ? 0 : 1]);
            if (tapa) minDia[q] += PASO_PATIO;
            if (s.recreo) { if (antes) solAntes[q] = true; if (antes && !tapa) solDespues[q] = true; }
          }
        }
        for (let q = 0; q < 4; q++) {
          minutos[q] += minDia[q];
          if (minDia[q] > peorDia[q]) peorDia[q] = minDia[q];
          if (solAntes[q]) recreoHoy[q]++;
          if (solAntes[q] && !solDespues[q]) recreo[q]++;
        }
      }
    }
    return {
      xy, enLote, enTecho, fuera,
      minutosDia: rango(minutos.map((v) => v / dias.length)),
      peorDia: rango(peorDia),
      diasRecreo: rango(recreo),
      diasRecreoHoy: rango(recreoHoy)
    };
  }

  function rango(v) { return [Math.min(...v), Math.max(...v)]; }

  // ── Escenario en la URL ──────────────────────────────────────────────────
  // ?edificio=lon,lat,ancho,fondo,giro,pisos,retroceso,huella[,lonPatio,latPatio]
  const acotar = (v, [a, b]) => Math.min(b, Math.max(a, v));
  function escribirEscenario(e) {
    const f = (v, d) => Number(v).toFixed(d).replace(/\.?0+$/, '');
    const partes = [f(e.lon, 6), f(e.lat, 6), f(e.ancho, 1), f(e.fondo, 1), f(e.giro, 1), String(Math.round(e.pisos)), f(e.retroceso, 1), String(Math.round(e.huella))];
    if (e.patio) partes.push(f(e.patio[0], 6), f(e.patio[1], 6));
    return partes.join(',');
  }
  // Lee y valida: si algo no es un número dentro de Bogotá o de los límites, devuelve null.
  function leerEscenario(s) {
    if (typeof s !== 'string' || s.length > 160 || !/^[-0-9.,]+$/.test(s)) return null;
    const v = s.split(',').map(Number);
    if ((v.length !== 8 && v.length !== 10) || v.some((x) => !Number.isFinite(x))) return null;
    const dentroBogota = (lon, lat) => lon > -74.5 && lon < -73.9 && lat > 3.7 && lat < 4.9;
    if (!dentroBogota(v[0], v[1])) return null;
    const e = {
      lon: v[0], lat: v[1], ancho: acotar(v[2], LIMITES.ancho), fondo: acotar(v[3], LIMITES.fondo),
      giro: acotar(v[4], [-90, 90]), pisos: Math.round(acotar(v[5], LIMITES.pisos)),
      retroceso: acotar(v[6], LIMITES.retroceso), huella: Math.round(acotar(v[7], LIMITES.huella)), patio: null
    };
    if (v.length === 10) { if (!dentroBogota(v[8], v[9])) return null; e.patio = [v[8], v[9]]; }
    return e;
  }

  const calculo = {
    aLocal, aLonLat, envolvente, area, dentroConvexo, rectanguloMinimo, esquinas, volumen, sombra,
    momentosAnio, momentosPatio, armarRejilla, rayo, metricas, patio, escribirEscenario, leerEscenario,
    M_PISO, ANIO, CELDA, RADIO, MARCHA, PASO, MANANA, RECREO, LIMITES, LAT, LON
  };
  if (enNode) module.exports = calculo;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.edificioCalculo = calculo;
  }
})(typeof window !== 'undefined' ? window : globalThis);
