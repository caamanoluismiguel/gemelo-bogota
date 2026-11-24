'use strict';
// Geometría de la sombra de las construcciones para la capa propia en la GPU.
// Módulo puro: no toca el DOM ni WebGL. Corre en el navegador (window.Bogotwin.sombraGeom)
// y en Node (require).
//
// La idea: la sombra de un prisma (una huella levantada a cierta altura) sobre el suelo
// plano es la huella barrida por el vector de sombra. Ese barrido es igual a la huella
// más un cuadrilátero por cada borde, que va del borde a su copia corrida. La huella ya
// la tapa la construcción, así que solo se arman los cuadriláteros de los bordes.
//
// Diseño de datos (panel/sombras-DEBATE.md, §2.3):
//  * Los cuadriláteros se arman UNA vez por tesela, cuando el mapa queda quieto.
//  * Cada vértice lleva: x, y (unidades de tesela), si se corre o no (0 o 1), pisos y
//    elevación del plano donde se apoya (m).
//  * Al mover el sol cambian solo dos uniformes: u_sombra (cuánto se corre la sombra
//    por cada metro de alto, en metros al oriente y al norte) y u_m_piso (2,5 m en el
//    núcleo y 4,0 m en el borde). u_unidades_m es fijo por tesela.
//  * Que la tesela corte una construcción no cambia nada: la sombra de la unión de
//    pedazos es la unión de sus sombras, y el stencil pinta cada píxel una sola vez.
(function (raiz) {
  const RAD = Math.PI / 180;
  const CIRCUNFERENCIA = 40075016.686; // m, ecuador de WGS84 (la de Web Mercator)
  const EXTENSION = 4096;              // unidades de una tesela vectorial
  const ZANCADA = 5;                   // floats por vértice: x, y, corre, pisos, elevación
  const ALTURA_MINIMA_SOL = 3;         // grados; más bajo no se dibuja [supuesto]

  // Vértice para la GPU. Es el espejo exacto de desplazar() de aquí abajo.
  const VERTICE_GLSL = `#version 300 es
in vec2 a_pos;        // unidades de tesela
in float a_corre;     // 0 en la base, 1 en la punta de la sombra
in float a_pisos;
in float a_elev;      // m, plano del centroide más 0,3 m
uniform mat4 u_matriz;     // tesela a pantalla (la da MapLibre por tesela)
uniform vec2 u_sombra;     // m al oriente y al norte por cada m de alto
uniform float u_m_piso;    // 2,5 núcleo, 4,0 borde
uniform float u_unidades_m;// unidades de tesela por metro en esta tesela
uniform float u_alzar;    // m que se acerca solo la profundidad (con terreno), 0 en 2D
void main() {
  float alto = a_pisos * u_m_piso;
  vec2 corrido = a_corre * alto * u_sombra * u_unidades_m;
  // en la tesela y crece hacia el sur: el norte resta
  vec2 p = a_pos + vec2(corrido.x, -corrido.y);
  vec4 pos = u_matriz * vec4(p, a_elev, 1.0);
  // La sombra queda donde está en pantalla; solo su profundidad es la de un plano u_alzar m
  // más arriba, para que el terreno (que MapLibre dibuja con otra malla) no la tape.
  vec4 alta = u_matriz * vec4(p, a_elev + u_alzar, 1.0);
  gl_Position = vec4(pos.xy, alta.z / alta.w * pos.w, pos.w);
}`;

  // Vector de sombra por metro de alto, desde la posición del sol.
  // Devuelve null si el sol está bajo (sin sombra de construcciones).
  function vectorSombra(sol, alturaMinima) {
    const min = alturaMinima == null ? ALTURA_MINIMA_SOL : alturaMinima;
    if (!sol || !(sol.altura > min)) return null;
    const largo = 1 / Math.tan(sol.altura * RAD); // m de sombra por m de alto
    // La sombra va al lado contrario del sol.
    return [-Math.sin(sol.azimut * RAD) * largo, -Math.cos(sol.azimut * RAD) * largo];
  }

  // Unidades de tesela por metro de suelo a esa latitud y zoom (Web Mercator).
  function unidadesPorMetro(z, lat, extension) {
    const ext = extension || EXTENSION;
    return (ext * 2 ** z) / (CIRCUNFERENCIA * Math.cos(lat * RAD));
  }

  // Lon/lat a unidades de la tesela z/x/y.
  function aTesela(lon, lat, z, tx, ty, extension) {
    const ext = extension || EXTENSION;
    const n = 2 ** z;
    const mx = (lon + 180) / 360;
    const s = Math.sin(lat * RAD);
    const my = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    return [(mx * n - tx) * ext, (my * n - ty) * ext];
  }

  // Latitud del centro de una tesela (para unidadesPorMetro).
  function latitudTesela(z, ty) {
    const y = (ty + 0.5) / 2 ** z;
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;
  }

  // Centroide por área de una lista de anillos (los huecos restan solos por su sentido).
  function centroide(anillos) {
    let a = 0, cx = 0, cy = 0;
    for (const r of anillos) {
      for (let i = 0, n = r.length; i < n; i++) {
        const p = r[i], q = r[(i + 1) % n];
        const c = p[0] * q[1] - q[0] * p[1];
        a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
      }
    }
    if (Math.abs(a) < 1e-12) { const p = anillos[0][0]; return [p[0], p[1]]; }
    return [cx / (3 * a), cy / (3 * a)];
  }

  // Arma la geometría de una tesela.
  // construcciones: [{ anillos: [[[x, y], ...], ...], pisos, elevacion? }]
  // opciones.lonlat = { z, x, y } si los anillos vienen en lon/lat (se pasan a esa tesela).
  // opciones.extension (4096 por defecto; MapLibre entrega 8192), opciones.borde y
  // opciones.quitarCortes: ver los bordes del corte aquí abajo.
  // Devuelve { vertices: Float32Array, indices: Uint16Array|Uint32Array, zancada,
  //            centroides: [[x, y], ...] (en unidades de tesela, uno por construcción) }.
  function armar(construcciones, opciones) {
    const op = opciones || {};
    const ll = op.lonlat;
    const verts = [];
    const idx = [];
    const centroides = [];
    let nv = 0;
    // Bordes del corte de la tesela. El que arma las teselas (tippecanoe) recorta cada
    // anillo por su lado, así que un patio cortado deja un borde sobre la línea del corte,
    // dentro del patio, y su cuadrilátero pintaría sombra falsa. Esos bordes no son paredes:
    // la pared de verdad está en la tesela vecina, que la trae entera. Se quitan:
    //  * con opciones.borde = b, los que caen justo en x o y = −b o extensión + b;
    //  * sin borde, cualquier borde recto que quede fuera de [0, extensión] (sirve también
    //    con teselas sobreampliadas, donde el corte cae en otro número);
    //  * con opciones.quitarCortes = false, ninguno (para una construcción sin cortar).
    const ext = op.extension || EXTENSION;
    const b = op.borde;
    const fuera = (c) => (b == null ? c < 0 || c > ext : c === -b || c === ext + b);
    const esCorte = op.quitarCortes === false ? () => false
      : (p, q) => (p[0] === q[0] && fuera(p[0])) || (p[1] === q[1] && fuera(p[1]));
    for (const c of construcciones) {
      const pisos = Math.max(1, Number(c.pisos) || 1);
      const elev = Number(c.elevacion) || 0;
      const anillos = (c.anillos || []).map((r) => {
        const pts = ll ? r.map((p) => aTesela(p[0], p[1], ll.z, ll.x, ll.y, op.extension)) : r.map((p) => [p[0], p[1]]);
        // Sin el punto que repite el primero.
        if (pts.length > 1) {
          const a = pts[0], b = pts[pts.length - 1];
          if (a[0] === b[0] && a[1] === b[1]) pts.pop();
        }
        return pts;
      }).filter((r) => r.length >= 3);
      if (!anillos.length) { centroides.push(null); continue; }
      centroides.push(centroide(anillos));
      for (const r of anillos) {
        for (let i = 0, n = r.length; i < n; i++) {
          const a = r[i], b = r[(i + 1) % n];
          if (a[0] === b[0] && a[1] === b[1]) continue;
          if (esCorte(a, b)) continue;
          // a base, b base, b punta, a punta
          verts.push(a[0], a[1], 0, pisos, elev, b[0], b[1], 0, pisos, elev,
            b[0], b[1], 1, pisos, elev, a[0], a[1], 1, pisos, elev);
          idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
          nv += 4;
        }
      }
    }
    const Indices = nv > 65535 ? Uint32Array : Uint16Array;
    return { vertices: new Float32Array(verts), indices: new Indices(idx), zancada: ZANCADA, centroides };
  }

  // Lo mismo que hace el vértice en la GPU, en la CPU: para las pruebas y para la
  // ventana de la construcción. Devuelve los cuadriláteros ya corridos, en unidades de tesela.
  function desplazar(geom, sombra, mPiso, unidadesM) {
    const v = geom.vertices, z = geom.zancada;
    const out = [];
    for (let q = 0; q < v.length / z; q += 4) {
      const quad = [];
      for (let k = 0; k < 4; k++) {
        const o = (q + k) * z;
        const alto = v[o + 3] * mPiso;
        const f = v[o + 2] * alto * unidadesM;
        quad.push([v[o] + f * sombra[0], v[o + 1] - f * sombra[1]]);
      }
      out.push(quad);
    }
    return out;
  }

  // Largo de la sombra en metros para un número de pisos (para «de 21 a 34 m»).
  function largoSombra(sol, pisos, mPiso, alturaMinima) {
    const s = vectorSombra(sol, alturaMinima);
    if (!s) return null;
    return Math.hypot(s[0], s[1]) * Math.max(1, Number(pisos) || 1) * mPiso;
  }

  const sombraGeom = { armar, desplazar, vectorSombra, unidadesPorMetro, aTesela, latitudTesela, centroide, largoSombra,
    VERTICE_GLSL, ZANCADA, EXTENSION, ALTURA_MINIMA_SOL };

  if (typeof module === 'object' && module.exports) module.exports = sombraGeom;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.sombraGeom = sombraGeom;
  }
})(typeof window !== 'undefined' ? window : globalThis);
