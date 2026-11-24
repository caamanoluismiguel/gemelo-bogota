'use strict';
// Sombra de los cerros (paso 6 del plan de sombras, panel/sombras-DEBATE.md §3).
// Lee la rejilla de horizonte HZN2 que arma mapa-base/terreno/horizonte.py: para cada nodo,
// el ángulo del horizonte en 26 direcciones (60° a 120° y 240° a 300°, de 5 en 5). Con el sol
// de un momento pinta un lienzo pequeño, un píxel por nodo de 100 m, que mapa.js pone como
// fuente `canvas`: en 2D queda plano y con terreno MapLibre lo pega al relieve.
// Sin DOM ni mapa en lo que se prueba: corre en el navegador (window.Bogotwin.horizonte) y en
// Node (require). La lectura sigue a leer_hzn2 y consultar de horizonte.py.
(function (raiz) {
  const SEMI_DISCO = 0.267;     // el sol llega con su borde superior (horizonte.py)
  const BORDE = 0.5;            // grados de transición suave entre sol y sombra en el velo
  // Por encima de esta altura del sol ningún nodo de la rejilla queda a la sombra de un cerro
  // (el horizonte más alto es 51,5°, en una quebrada de los cerros orientales). La prueba lo
  // comprueba contra el archivo (horizonte.prueba.js).
  const SOL_BAJO = 52;

  // ── Lectura ──────────────────────────────────────────────────────────────
  const esGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;

  // Devuelve los bytes sin comprimir. Si el servidor ya los entregó descomprimidos, pasan igual.
  async function descomprimir(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (!esGzip(u8)) return u8;
    if (typeof DecompressionStream === 'function') {
      const flujo = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(flujo).arrayBuffer());
    }
    // Node sin DecompressionStream (las pruebas).
    return new Uint8Array(require('zlib').gunzipSync(u8));
  }

  // Formato HZN2 (cabecera de horizonte.py), little endian.
  function leer(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'HZN2') throw new Error('no es HZN2');
    const n = dv.getUint16(4, true);
    let off = 6;
    const rejillas = [];
    for (let k = 0; k < n; k++) {
      const nc = dv.getUint16(off, true), nf = dv.getUint16(off + 2, true), nd = dv.getUint16(off + 4, true), band = dv.getUint16(off + 6, true);
      off += 8;
      const lon0 = dv.getFloat64(off, true), lat0 = dv.getFloat64(off + 8, true), dlon = dv.getFloat64(off + 16, true), dlat = dv.getFloat64(off + 24, true);
      off += 32;
      const esc = dv.getFloat32(off, true), des = dv.getFloat32(off + 4, true);
      off += 8;
      const az = [];
      for (let d = 0; d < nd; d++) az.push(dv.getFloat32(off + 4 * d, true));
      off += 4 * nd;
      let mascara = null, bloque = 0, nbx = 0, nby = 0;
      if (band & 4) {
        bloque = dv.getUint16(off, true); nbx = dv.getUint16(off + 2, true); nby = dv.getUint16(off + 4, true);
        off += 6;
        mascara = u8.slice(off, off + nbx * nby);
        off += nbx * nby;
      }
      const tam = nf * nc;
      if (off + nd * tam > u8.length) throw new Error('HZN2 cortado');
      const q = u8.slice(off, off + nd * tam);
      off += nd * tam;
      if (band & 2) {
        for (let d = 1; d < nd; d++) {
          if (az[d] - az[d - 1] !== 5) continue;
          const a = d * tam, b = (d - 1) * tam;
          for (let i = 0; i < tam; i++) q[a + i] = (q[a + i] + q[b + i]) & 255;
        }
      }
      const H = new Float32Array(nd * tam);
      for (let i = 0; i < H.length; i++) H[i] = q[i] * esc + des;
      rejillas.push({ nc, nf, nd, lon0, lat0, dlon, dlat, esc, des, az, H, mascara, bloque, nbx, nby });
    }
    if (off !== u8.length) throw new Error('HZN2 con bytes de más');
    return rejillas;
  }

  // ── Consulta ─────────────────────────────────────────────────────────────
  // Muestreo bilineal en índices fraccionarios, igual que comun.bilineal.
  function bilineal(H, base, nc, nf, cf, ff) {
    const c0 = Math.min(Math.max(Math.floor(cf), 0), nc - 2), f0 = Math.min(Math.max(Math.floor(ff), 0), nf - 2);
    const fc = Math.min(Math.max(cf - c0, 0), 1), fr = Math.min(Math.max(ff - f0, 0), 1);
    const i = base + f0 * nc + c0;
    return H[i] * (1 - fc) * (1 - fr) + H[i + 1] * fc * (1 - fr) + H[i + nc] * (1 - fc) * fr + H[i + nc + 1] * fc * fr;
  }
  const conDatos = (r, f, c) => !r.mascara || r.mascara[Math.floor(f / r.bloque) * r.nbx + Math.floor(c / r.bloque)] === 1;

  // Ángulos del horizonte en un punto: la rejilla fina si sus 4 nodos caen en bloques con datos;
  // si no, la gruesa. null fuera de la rejilla.
  function consultar(rejillas, lon, lat) {
    for (let k = rejillas.length - 1; k >= 0; k--) {
      const r = rejillas[k];
      const cf = (lon - r.lon0) / r.dlon, ff = (r.lat0 - lat) / r.dlat;
      if (!(cf >= 0 && cf <= r.nc - 1 && ff >= 0 && ff <= r.nf - 1)) continue;
      if (r.mascara) {
        const c0 = Math.min(Math.floor(cf), r.nc - 2), f0 = Math.min(Math.floor(ff), r.nf - 2);
        if (!(conDatos(r, f0, c0) && conDatos(r, f0, c0 + 1) && conDatos(r, f0 + 1, c0) && conDatos(r, f0 + 1, c0 + 1))) continue;
      }
      const tam = r.nc * r.nf, out = new Float64Array(r.nd);
      for (let d = 0; d < r.nd; d++) out[d] = bilineal(r.H, d * tam, r.nc, r.nf, cf, ff);
      return { hz: out, az: r.az, fina: !!r.mascara };
    }
    return null;
  }

  // Interpolación lineal en el azimut, como numpy.interp (fuera de los extremos, el extremo).
  function enAzimut(az, hz, a) {
    const n = az.length;
    if (a <= az[0]) return hz[0];
    if (a >= az[n - 1]) return hz[n - 1];
    let j = 1;
    while (az[j] < a) j++;
    const t = (a - az[j - 1]) / (az[j] - az[j - 1]);
    return hz[j - 1] + (hz[j] - hz[j - 1]) * t;
  }

  // ── Campo para pintar ────────────────────────────────────────────────────
  // Todo el campo a la resolución de la rejilla fina: el nodo fino donde su bloque tiene datos y,
  // en el resto, la gruesa interpolada en ese punto. Se arma una vez (unos 2,7 millones de valores).
  function armarCampo(rejillas) {
    const fina = rejillas[rejillas.length - 1], gruesa = rejillas[0];
    const { nc, nf, nd } = fina, tam = nc * nf;
    const H = new Float32Array(nd * tam);
    const tamG = gruesa.nc * gruesa.nf;
    let maximo = -90;
    for (let f = 0; f < nf; f++) {
      const lat = fina.lat0 - f * fina.dlat, ffG = (gruesa.lat0 - lat) / gruesa.dlat;
      for (let c = 0; c < nc; c++) {
        const i = f * nc + c;
        const propia = fina.mascara && conDatos(fina, f, c);
        const cfG = (fina.lon0 + c * fina.dlon - gruesa.lon0) / gruesa.dlon;
        for (let d = 0; d < nd; d++) {
          const v = propia ? fina.H[d * tam + i] : bilineal(gruesa.H, d * tamG, gruesa.nc, gruesa.nf, cfG, ffG);
          H[d * tam + i] = v;
          if (v > maximo) maximo = v;
        }
      }
    }
    // Esquinas del lienzo: el borde de los píxeles, medio paso por fuera de los nodos.
    const oeste = fina.lon0 - fina.dlon / 2, este = fina.lon0 + (nc - 0.5) * fina.dlon;
    const norte = fina.lat0 + fina.dlat / 2, sur = fina.lat0 - (nf - 0.5) * fina.dlat;
    return { nc, nf, nd, az: fina.az, H, maximo, esquinas: [[oeste, norte], [este, norte], [este, sur], [oeste, sur]] };
  }

  // Cuánta sombra de cerro hay en un nodo (0 sol pleno, 1 sombra), con el borde superior del sol.
  function sombraEn(hz, alturaGeometrica) {
    return Math.min(1, Math.max(0, (hz - (alturaGeometrica + SEMI_DISCO)) / BORDE + 0.5));
  }

  // Alfa por nodo (0 a 255) para un sol { alturaGeometrica, azimut }. De noche, todo 0: la noche
  // ya la dice la barra. Devuelve también cuántos nodos quedan en sombra.
  function alfas(campo, sol, salida) {
    const { nc, nf, nd, az, H } = campo, tam = nc * nf;
    const out = salida || new Uint8ClampedArray(tam);
    out.fill(0);
    const alt = sol.alturaGeometrica != null ? sol.alturaGeometrica : sol.altura;
    if (!(alt + SEMI_DISCO > 0) || alt >= SOL_BAJO) return { alfa: out, enSombra: 0 };
    const a = ((sol.azimut % 360) + 360) % 360;
    // El ángulo de interpolación es el mismo en todos los nodos: se calcula una vez.
    let j0 = 0, t = 0;
    if (a <= az[0]) { j0 = 0; t = 0; } else if (a >= az[nd - 1]) { j0 = nd - 2; t = 1; } else {
      let j = 1;
      while (az[j] < a) j++;
      j0 = j - 1; t = (a - az[j0]) / (az[j] - az[j0]);
    }
    const b0 = j0 * tam, b1 = (j0 + 1) * tam;
    let enSombra = 0;
    for (let i = 0; i < tam; i++) {
      const hz = H[b0 + i] + (H[b1 + i] - H[b0 + i]) * t;
      const s = sombraEn(hz, alt);
      if (s > 0) { out[i] = Math.round(s * 255); if (s >= 0.5) enSombra++; }
    }
    return { alfa: out, enSombra };
  }

  // ── Sol de horizonte.py, para comparar en las pruebas y dar la hora del primer sol ──
  // NOAA simplificado, hora local UTC‑5. Devuelve altura geométrica y azimut en grados.
  function solNoaa(lat, lon, doy, horaLocal) {
    const g = 2 * Math.PI / 365 * (doy - 1 + (horaLocal - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = horaLocal * 60 + eqt + 4 * lon + 300;
    const ha = (tst / 4 - 180) * Math.PI / 180, la = lat * Math.PI / 180;
    const cz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
    const el = 90 - Math.acos(Math.max(-1, Math.min(1, cz))) * 180 / Math.PI;
    const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) * 180 / Math.PI + 180;
    return { altura: el, azimut: ((az % 360) + 360) % 360 };
  }

  // Minuto del día (hora local) en que el borde superior del sol pasa el horizonte, de mañana.
  // posSol(minuto) da { alturaGeometrica | altura, azimut }; por defecto el sol de horizonte.py.
  function llegada(punto, lon, lat, doy, posSol) {
    const pos = posSol || ((m) => solNoaa(lat, lon, doy, m / 60));
    for (let s = 4 * 3600; s < 11 * 3600; s += 15) {
      const p = pos(s / 60);
      const alt = p.alturaGeometrica != null ? p.alturaGeometrica : p.altura;
      if (alt + SEMI_DISCO > enAzimut(punto.az, punto.hz, p.azimut)) return s / 60;
    }
    return null;
  }

  const horizonte = { descomprimir, leer, consultar, enAzimut, armarCampo, sombraEn, alfas, solNoaa, llegada, SEMI_DISCO, SOL_BAJO };

  if (typeof module === 'object' && module.exports) module.exports = horizonte;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.horizonte = horizonte;
  }
})(typeof window !== 'undefined' ? window : globalThis);
