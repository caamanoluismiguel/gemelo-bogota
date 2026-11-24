'use strict';
// Árboles de la calle en la vista 3D «Cómo se ve» (ronda 7).
//
// Cada árbol del censo SIGAU del Jardín Botánico de Bogotá (JBB, CC BY 4.0) es un punto con
// su altura total (dato de fuente) y una forma de copa sacada del nombre de la especie
// (inferida al armar las teselas, ver mapa-base/scripts/arboles.sql). El censo no publica el
// diámetro de copa: aquí se calcula con la altura y la forma (supuesto, ver perfil()).
//
// Cómo trabaja: una capa propia de MapLibre en 3D (comparte la profundidad con los edificios).
// Baja las teselas z16 de arboles-bogota.pmtiles solo cerca de la cámara, arma por tesela un
// búfer con un registro por árbol y dibuja todos los árboles de la tesela de una sola vez con la
// misma malla: un tronco de seis caras y una copa redonda de pocas caras. Lejos se encogen
// hasta el suelo (sin transparencias que ordenar). Con el sol de la barra prendido, cada copa
// deja en el suelo una mancha de sombra corrida según el sol.
//
// Si no hay WebGL2, si el archivo no está o si algo falla al dibujar, la capa se quita sola y
// el visor queda como antes.
(function (raiz) {
  const Z = 16;
  const CIRC = 40075016.686;
  const RAD = Math.PI / 180;
  const ZANCADA = 10;             // floats por árbol en el búfer de instancias

  // ── Piezas puras (se prueban en Node) ───────────────────────────────────

  // Perfil de un árbol en metros, desde la altura del censo (h, en decímetros) y la forma
  // (f: 0 copa redonda, 1 palma, 2 conífera, 3 eucalipto). Devuelve
  // [tronco libre, radio del tronco, base de la copa, alto de la copa, radio de la copa].
  // Supuesto: proporciones típicas de árboles de calle, no medidas de cada árbol. La copa
  // redonda sale de unos 7 m de ancho para un árbol de 7 m y no pasa de 16 m. Ronda 8: medida
  // contra la ortofoto IDECA 2025 (calle 72 con carrera 7), donde los urapanes de unos 12 m
  // dejan copas de 10 a 15 m; con 0,28·h la copa 3D salía de la mitad.
  function perfil(hDm, f) {
    const h = Math.max(1.5, Math.min(60, (Number(hDm) || 0) / 10));
    let tronco, rTronco, copaAlto, rCopa;
    if (f === 1) {                       // palma: tronco largo, penacho corto y ancho
      copaAlto = Math.max(1, 0.22 * h);
      tronco = h - copaAlto;
      rTronco = 0.18;
      rCopa = Math.min(5.5, 1.4 + 0.18 * h);
    } else if (f === 2) {                // conífera: copa desde abajo, angosta y en punta
      tronco = Math.max(0.6, 0.12 * h);
      copaAlto = h - tronco;
      rTronco = Math.min(0.45, 0.06 + 0.014 * h);
      rCopa = Math.min(5, 0.5 + 0.17 * h);
    } else if (f === 3) {                // eucalipto: alto, copa angosta
      tronco = 0.4 * h;
      copaAlto = h - tronco;
      rTronco = Math.min(0.5, 0.08 + 0.014 * h);
      rCopa = Math.min(7, 0.6 + 0.18 * h);
    } else {                             // copa redonda (la mayoría)
      tronco = Math.max(1.2, 0.35 * h);
      if (tronco > h - 0.6) tronco = h - 0.6;
      copaAlto = h - tronco;
      rTronco = Math.min(0.45, 0.06 + 0.012 * h);
      rCopa = Math.min(8, Math.max(0.8, 0.8 + 0.36 * h));
    }
    return [tronco, rTronco, tronco, copaAlto, rCopa];
  }

  // Tono de verde de cada árbol, de 0 a 1, fijo por su lugar en la tesela.
  function tono(x, y) {
    let n = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) & 1023) / 1023;
  }

  function lonATeselaX(lon, z) { return (lon + 180) / 360 * 2 ** z; }
  function latATeselaY(lat, z) {
    const s = Math.sin(lat * RAD);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
  }

  // Teselas z16 que tocan un círculo de radio m alrededor de lon/lat, la más cercana primero.
  function teselasCerca(lon, lat, radio) {
    const n = 2 ** Z;
    const cx = lonATeselaX(lon, Z), cy = latATeselaY(lat, Z);
    const r = radio / (CIRC * Math.cos(lat * RAD) / n);   // en teselas
    const fuera = [];
    for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
      for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y++) {
        const dx = Math.max(x - cx, 0, cx - (x + 1)), dy = Math.max(y - cy, 0, cy - (y + 1));
        const d = Math.hypot(dx, dy);
        if (d <= r) fuera.push({ k: x + '/' + y, d });
      }
    }
    return fuera.sort((a, b) => a.d - b.d).map((t) => t.k);
  }

  // Registros de una tesela leída con mvt.leerCapa(bytes, 'arboles', 1). El alto del suelo
  // (posición 2) queda en 0: lo pone la capa con el relieve.
  function instancias(objetos) {
    const v = new Float32Array(objetos.length * ZANCADA);
    let i = 0;
    for (const o of objetos) {
      const p = o.anillos && o.anillos[0] && o.anillos[0][0];
      if (!p) continue;
      const pr = perfil(o.propiedades.h, Number(o.propiedades.f) || 0);
      v[i] = p[0]; v[i + 1] = p[1]; v[i + 2] = 0;
      v[i + 3] = pr[0]; v[i + 4] = pr[1]; v[i + 5] = pr[2]; v[i + 6] = pr[3]; v[i + 7] = pr[4];
      v[i + 8] = tono(p[0], p[1]); v[i + 9] = Number(o.propiedades.f) || 0;
      i += ZANCADA;
    }
    return i === v.length ? v : v.slice(0, i);
  }

  // Malla de un árbol, en unidades: tronco de 6 caras (parte 0, z de 0 a 1) y LOBULOS esferas
  // chicas de 6 gajos y 4 franjas (partes 1 a LOBULOS). Cada lóbulo sale igual; el sombreador
  // los mueve, los achata y les rompe el borde según la forma y un número fijo de cada árbol,
  // así la copa queda en grumos y no en una bola. Cada vértice: x, y, z, parte.
  const LOBULOS = 4;
  function malla() {
    const v = [], idx = [];
    const S = 6;
    for (let i = 0; i < S; i++) {
      const a = i / S * 2 * Math.PI;
      v.push(Math.cos(a), Math.sin(a), 0, 0, Math.cos(a), Math.sin(a), 1, 0);
    }
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      idx.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1);
    }
    const G = 6, F = 4;
    for (let k = 1; k <= LOBULOS; k++) {
      const base = v.length / 4;
      v.push(0, 0, -1, k);
      for (let f = 1; f < F; f++) {
        const lat = -Math.PI / 2 + f / F * Math.PI;
        for (let g = 0; g < G; g++) {
          const a = (g + (f % 2) * 0.5 + k * 0.37) / G * 2 * Math.PI;   // gajos corridos por franja y lóbulo
          v.push(Math.cos(lat) * Math.cos(a), Math.cos(lat) * Math.sin(a), Math.sin(lat), k);
        }
      }
      v.push(0, 0, 1, k);
      const anillo = (f) => base + 1 + (f - 1) * G;
      const arriba = base + 1 + (F - 1) * G;
      for (let g = 0; g < G; g++) idx.push(base, anillo(1) + (g + 1) % G, anillo(1) + g);
      for (let f = 1; f < F - 1; f++) {
        for (let g = 0; g < G; g++) {
          const a0 = anillo(f) + g, a1 = anillo(f) + (g + 1) % G, b0 = anillo(f + 1) + g, b1 = anillo(f + 1) + (g + 1) % G;
          idx.push(a0, a1, b1, a0, b1, b0);
        }
      }
      for (let g = 0; g < G; g++) idx.push(arriba, anillo(F - 1) + g, anillo(F - 1) + (g + 1) % G);
    }
    return { vertices: new Float32Array(v), indices: new Uint16Array(idx) };
  }

  // Mancha de sombra en el suelo: un octágono (centro y 8 puntas), x, y en unidades.
  function mallaSombra() {
    const v = [0, 0], idx = [];
    for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * Math.PI; v.push(Math.cos(a), Math.sin(a)); }
    for (let i = 0; i < 8; i++) idx.push(0, 1 + i, 1 + (i + 1) % 8);
    return { vertices: new Float32Array(v), indices: new Uint16Array(idx) };
  }

  // Sol en dirección de este, norte y arriba (azimut desde el norte, en el sentido del reloj).
  function haciaSol(altura, azimut) {
    const a = altura * RAD, z = azimut * RAD;
    return [Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a)];
  }

  const puro = { perfil, tono, teselasCerca, instancias, malla, mallaSombra, haciaSol, ZANCADA, Z, LOBULOS };
  if (typeof module === 'object' && module.exports) { module.exports = puro; return; }

  // ── Capa en el navegador ────────────────────────────────────────────────
  const B = raiz.Bogotwin = raiz.Bogotwin || {};

  const ARBOL_V = `#version 300 es
in vec4 a_v;          // malla: x, y, z, parte (0 tronco, 1 a 4 lóbulos de la copa)
in vec3 i_pos;        // tesela x, y; alto del suelo en m
in vec4 i_dim;        // tronco libre, radio del tronco, base de la copa, alto de la copa
in vec3 i_otro;       // radio de la copa, tono, forma
uniform mat4 u_matriz;
uniform float u_unidades_m;
uniform vec2 u_camara;
uniform vec2 u_desvanecer;
out vec3 v_normal;
out vec3 v_color;
out float v_alto;     // 0 abajo de la copa, 1 arriba (oscurece por dentro)
out float v_ao;       // 1 por fuera; menos en la cara del lóbulo que mira hacia dentro de la copa
out vec3 v_q;         // punto del lóbulo, para las manchas de sombra entre hojas
void main() {
  float forma = i_otro.z;
  float lejos = length(i_pos.xy - u_camara) / u_unidades_m;
  vec3 lp; vec3 n;
  v_ao = 1.0; v_q = vec3(0.0);
  if (a_v.w < 0.5) {
    // El tronco entra un poco en la copa y baja 1 m bajo el suelo calculado (por si el
    // relieve queda más abajo que el punto que muestreamos).
    lp = vec3(a_v.xy * i_dim.y, mix(-1.0, i_dim.x + 0.35 * i_dim.w, a_v.z));
    n = vec3(a_v.xy, 0.0);
    v_color = vec3(0.36, 0.29, 0.22);
    v_alto = 0.0;
  } else {
    // Copa en cuatro lóbulos. c: centro del lóbulo (x, y en radios de copa; z en medio alto de
    // copa desde su centro). rad: radio del lóbulo en esas mismas medidas. Dos números fijos
    // por árbol (s1, s2) giran y corren los lóbulos para que no haya dos árboles iguales.
    float k = a_v.w - 1.0;
    float t = i_otro.y;
    float s1 = fract(t * 7.13 + 0.17), s2 = fract(t * 31.7 + 0.53);
    float r = i_otro.x, semi = 0.5 * i_dim.w;
    // Más allá de unos 250 a 420 m el árbol mide pocos píxeles: queda un solo lóbulo grande.
    float lod = smoothstep(0.45 * u_desvanecer.x, 0.75 * u_desvanecer.x, lejos);
    vec3 q = a_v.xyz;
    float ang = 6.2832 * (k / 3.0 + s1);
    vec3 c; vec2 rad; vec2 radLejos = vec2(0.92, 0.95);
    if (forma > 0.5 && forma < 1.5) {          // palma: penacho chico y hojas que caen hacia afuera
      if (k < 0.5) { c = vec3(0.0, 0.0, 0.3); rad = vec2(0.34, 0.42); }
      else { c = vec3(cos(ang), sin(ang), 0.0) * 0.52 + vec3(0.0, 0.0, -0.12 - 0.2 * s2); rad = vec2(0.5, 0.3); }
    } else if (forma > 1.5 && forma < 2.5) {   // conífera: pisos que se angostan hasta la punta
      float h = k / 3.0;
      c = vec3(0.06 * cos(ang), 0.06 * sin(ang), mix(-0.58, 0.6, h));
      rad = vec2(mix(1.3, 0.45, h), mix(0.44, 0.42, h));
      radLejos = vec2(1.3, 1.0);
      q.xy *= mix(1.0, k > 2.5 ? 0.0 : mix(0.3, 0.0, lod), q.z * 0.5 + 0.5);
    } else if (forma > 2.5) {                  // eucalipto: grumos altos y ralos, corridos de lado
      float a2 = 6.2832 * (s1 + k * 0.37);
      c = vec3(cos(a2), sin(a2), 0.0) * (0.18 + 0.1 * k) + vec3(0.0, 0.0, mix(-0.5, 0.6, k / 3.0));
      rad = vec2(mix(0.7, 0.45, k / 3.0), 0.42);
    } else {                                   // redonda: un cuerpo y tres grumos alrededor
      if (k < 0.5) { c = vec3(0.0, 0.0, -0.06); rad = vec2(0.72, 0.76); }
      else {
        float d = 0.36 + 0.12 * s2;
        c = vec3(cos(ang) * d, sin(ang) * d, (k < 1.5 ? -0.22 : (k < 2.5 ? 0.3 : 0.05)) + 0.16 * (s2 - 0.5));
        rad = vec2(0.58 + 0.1 * fract(s1 * 5.0 + k * 0.3), 0.6);
      }
    }
    if (k < 0.5) { c = mix(c, vec3(0.0), lod); rad = mix(rad, radLejos, lod); }
    else rad *= 1.0 - lod;
    // Borde roto: cada vértice sale o entra hasta un 20 % según un ruido fijo del árbol.
    float ruido = sin(dot(q, vec3(4.1, 3.3, 5.7)) + 6.2832 * s2 + 2.3 * k) * sin(dot(q, vec3(-3.7, 5.1, 2.9)) + 6.2832 * s1 + 1.7 * k);
    q *= 1.0 + 0.2 * ruido * (1.0 - lod);
    vec3 cm = vec3(c.xy * r, c.z * semi);
    vec3 dl = vec3(q.xy * rad.x * r, q.z * rad.y * semi);
    lp = cm + dl + vec3(0.0, 0.0, i_dim.z + semi);
    vec3 nl = normalize(vec3(q.xy / max(rad.x * r, 0.05), q.z / max(rad.y * semi, 0.05)));
    vec3 nc = normalize(vec3((cm.xy + dl.xy) / max(r, 0.3), (cm.z + dl.z) / max(semi, 0.3)));
    n = normalize(mix(nl, nc, 0.4));
    // Entre lóbulos: la cara que mira de vuelta hacia el centro de la copa queda en sombra.
    v_ao = mix(0.55, 1.0, smoothstep(-0.4, 0.5, dot(nl, nc)));
    v_q = a_v.xyz + vec3(3.1 * k, 9.7 * s1, 9.7 * s2);
    // Verdes apagados, oliva y gris, como las copas de la ortofoto (ronda 8; antes más vivos).
    vec3 col = mix(vec3(0.29, 0.37, 0.22), vec3(0.43, 0.49, 0.30), t);              // redonda
    if (forma > 0.5 && forma < 1.5) col = mix(vec3(0.38, 0.46, 0.27), vec3(0.48, 0.54, 0.32), t);   // palma
    else if (forma > 1.5 && forma < 2.5) col = mix(vec3(0.19, 0.27, 0.19), vec3(0.27, 0.35, 0.24), t); // conífera
    else if (forma > 2.5) col = mix(vec3(0.33, 0.40, 0.33), vec3(0.44, 0.49, 0.41), t);           // eucalipto
    v_color = col * (0.92 + 0.16 * fract(s1 * 3.7 + k * 0.61));   // cada grumo con su tono
    v_alto = clamp((cm.z + dl.z) / max(semi, 0.3) * 0.5 + 0.5, 0.0, 1.0);
  }
  v_normal = n;
  // Lejos, el árbol se encoge hasta el suelo: a esa distancia mide pocos píxeles y no deja
  // el borde cortado de un círculo ni el polvo de un tramado.
  lp *= 1.0 - smoothstep(u_desvanecer.x, u_desvanecer.y, lejos);
  vec2 p = i_pos.xy + vec2(lp.x, -lp.y) * u_unidades_m;
  gl_Position = lejos > u_desvanecer.y ? vec4(0.0, 0.0, 2.0, 1.0) : u_matriz * vec4(p, i_pos.z + lp.z, 1.0);
}`;

  const ARBOL_F = `#version 300 es
precision highp float;
uniform vec3 u_sol;          // hacia el sol: este, norte, arriba
uniform vec3 u_luz;          // directa, cielo, noche (0 a 1)
in vec3 v_normal;
in vec3 v_color;
in float v_alto;
in float v_ao;
in vec3 v_q;
out vec4 color;
void main() {
  vec3 n = normalize(v_normal);
  float dif = max(dot(n, u_sol), 0.0) * u_luz.x;
  float cielo = u_luz.y * (0.75 + 0.25 * n.z);
  float dentro = mix(0.72, 1.0, v_alto);
  vec3 c = v_color * (cielo + dif) * dentro * v_ao;
  // Huecos entre ramas: manchas oscuras fijas en cada lóbulo. Se van cuando un píxel cubre
  // media mancha (de lejos serían polvo). En el tronco v_q es 0 y no hay manchas.
  // Senos torcidos unos por otros: manchas de borde irregular, no lunares redondos. En la cara
  // al sol hay menos (las hojas de afuera tapan), en la de sombra más.
  float m = sin(v_q.x * 4.3 + 1.7 * sin(v_q.y * 3.1)) * sin(v_q.y * 3.9 + 1.9 * sin(v_q.z * 2.7)) + 0.6 * sin(v_q.z * 7.3 + 2.3 * v_q.x);
  float cerca = 1.0 - smoothstep(0.35, 0.9, fwidth(v_q.x) + fwidth(v_q.y));
  float alSol = smoothstep(0.2, 0.8, dif / max(u_luz.x, 0.01));
  c *= 1.0 - 0.32 * smoothstep(0.35, 0.85, m) * cerca * (1.0 - 0.5 * alSol);
  c = mix(c, c * vec3(0.32, 0.36, 0.48), u_luz.z);
  color = vec4(c, 1.0);
}`;

  const SOMBRA_V = `#version 300 es
in vec2 a_v;
in vec3 i_pos;
in vec4 i_dim;
in vec3 i_otro;
uniform mat4 u_matriz;
uniform float u_unidades_m;
uniform vec2 u_camara;
uniform vec2 u_desvanecer;
uniform vec3 u_corre;        // m de sombra al este y al norte por m de alto; estirar
out float v_lejos;
out float v_borde;
void main() {
  float hc = i_dim.z + 0.5 * i_dim.w;                     // centro de la copa
  vec2 eje = normalize(u_corre.xy + vec2(1e-6, 0.0));
  vec2 lado = vec2(-eje.y, eje.x);
  float r = i_otro.x * (i_otro.z > 1.5 && i_otro.z < 2.5 ? 0.8 : 1.0);
  vec2 q = eje * a_v.x * r * u_corre.z + lado * a_v.y * r;
  vec2 m = u_corre.xy * hc + q;
  v_borde = length(a_v);
  v_lejos = length(i_pos.xy - u_camara) / u_unidades_m;
  vec2 p = i_pos.xy + vec2(m.x, -m.y) * u_unidades_m;
  vec4 pos = u_matriz * vec4(p, i_pos.z + 0.3, 1.0);
  // Igual que la sombra de los edificios: la mancha queda donde está en pantalla, con la
  // profundidad de un plano 2 m más alto, para que el relieve no la tape.
  vec4 alta = u_matriz * vec4(p, i_pos.z + 2.3, 1.0);
  gl_Position = v_lejos > u_desvanecer.y ? vec4(0.0, 0.0, 2.0, 1.0) : vec4(pos.xy, alta.z / alta.w * pos.w, pos.w);
}`;

  const SOMBRA_F = `#version 300 es
precision highp float;
uniform float u_alfa;
uniform vec2 u_desvanecer;
in float v_lejos;
in float v_borde;
out vec4 color;
void main() {
  float a = u_alfa * (1.0 - smoothstep(u_desvanecer.x, u_desvanecer.y, v_lejos)) * (1.0 - smoothstep(0.55, 1.0, v_borde));
  color = vec4(0.0, 0.0, 0.0, a);
}`;

  function compilar(gl, tipo, src) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('sombreador: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function programa(gl, v, f, atributos) {
    const p = gl.createProgram();
    gl.attachShader(p, compilar(gl, gl.VERTEX_SHADER, v));
    gl.attachShader(p, compilar(gl, gl.FRAGMENT_SHADER, f));
    atributos.forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const nombre = gl.getActiveUniform(p, i).name;
      u[nombre] = gl.getUniformLocation(p, nombre);
    }
    return { p, u };
  }

  // Tesela a pantalla en doble precisión (igual que sombras-capa.js).
  function matrizTesela(M, x, y, ext, zMerc, salida) {
    const s = 1 / 2 ** Z, a = s / ext, tx = x * s, ty = y * s;
    for (let f = 0; f < 4; f++) {
      salida[f] = M[f] * a;
      salida[4 + f] = M[4 + f] * a;
      salida[8 + f] = M[8 + f] * zMerc;
      salida[12 + f] = M[f] * tx + M[4 + f] * ty + M[12 + f];
    }
    return salida;
  }
  function latitudTesela(y) { const n = Math.PI - 2 * Math.PI * (y + 0.5) / 2 ** Z; return Math.atan(Math.sinh(n)) / RAD; }

  // opciones: { url (del pmtiles), id ('arboles'), radio (m alrededor de la cámara, 1000),
  //   desvanecer ([560, 960] m), maxTeselas (48), sombras (true), alFallar(motivo) }
  // Ronda 8: el desvanecer pasó de [380, 720] a [560, 960] para que la calle no quede pelada a
  // media distancia; el radio sube con él para que las teselas lleguen antes de verse.
  function crear(opciones) {
    const op = Object.assign({ id: 'arboles', radio: 1000, desvanecer: [560, 960], maxTeselas: 48, sombras: true,
      alfaSombra: 0.26, credito: 'Árboles: JBB, censo SIGAU, Datos Abiertos Bogotá (CC BY 4.0)' }, opciones);
    let mapa = null, gl = null, pa = null, ps = null, caida = false, pm = null;
    let mArbol = null, mSombra = null;      // { vb, ib, n }
    const teselas = new Map();               // k → { x, y, ext, n, datos, vb, vaoA, vaoS, zMerc, unidadesM, pendiente, intentos }
    const pedidas = new Set();
    const cola = [];
    let trabajando = false;
    const est = { activa: false, sinWebGL2: false, error: null, teselas: 0, arboles: 0, dibujados: 0, ms: 0, sombras: false };
    const m64 = new Float64Array(16), m32 = new Float32Array(16);

    function fallar(motivo) {
      if (caida) return;
      caida = true;
      est.error = String(motivo && motivo.message || motivo);
      try { if (op.alFallar) op.alFallar(est.error); } catch (e) { /* nada */ }
      const m = mapa;
      if (m) setTimeout(() => apagar(m), 0);
    }

    function solActual() {
      const sb = B.solBarra;
      const S = sb && sb.estado;
      if (S && S.activo && S.sol) return { activo: true, altura: S.sol.altura, azimut: S.sol.azimut, intensidad: S.ahora && S.cielo ? S.cielo.intensidad : 1 };
      return { activo: false, altura: 45, azimut: 180, intensidad: 1 };
    }

    function sueloBajoCamara() {
      const t = mapa.transform;
      let ll = null;
      try { ll = t && t.getCameraLngLat ? t.getCameraLngLat() : null; } catch (e) { ll = null; }
      return ll || mapa.getCenter();
    }

    function necesarias() {
      if (!mapa || mapa.getZoom() < 15) return [];
      const c = sueloBajoCamara();
      return teselasCerca(c.lng, c.lat, op.radio);
    }

    function encolar(k) { if (!cola.includes(k)) cola.push(k); if (!trabajando) { trabajando = true; setTimeout(trabajar, 0); } }

    function trabajar() {
      if (!mapa || caida) { trabajando = false; return; }
      const t0 = performance.now();
      try {
        while (cola.length && performance.now() - t0 < 8) {
          const k = cola.shift();
          const t = teselas.get(k);
          if (t && t.datos) { if (t.pendiente) ponerSuelo(t); continue; }
          if (pedidas.has(k)) continue;
          pedidas.add(k);
          const [x, y] = k.split('/').map(Number);
          pm.getZxy(Z, x, y).then((r) => {
            pedidas.delete(k);
            if (!mapa || caida) return;
            armar(k, x, y, r && r.data ? new Uint8Array(r.data) : null);
            mapa.triggerRepaint();
          }).catch((e) => { pedidas.delete(k); fallar(e); });
        }
      } catch (e) { fallar(e); }
      if (cola.length) setTimeout(trabajar, 0); else trabajando = false;
      if (mapa) mapa.triggerRepaint();
    }

    function armar(k, x, y, bytes) {
      try {
        const capa = bytes && bytes.length ? B.mvt.leerCapa(bytes, 'arboles', 1) : null;
        const ext = capa ? capa.extension : 4096;
        const datos = capa ? instancias(capa.objetos) : new Float32Array(0);
        const lat = latitudTesela(y);
        const t = { x, y, ext, n: datos.length / ZANCADA, datos, vb: null, vaoA: null, vaoS: null,
          zMerc: 1 / (CIRC * Math.cos(lat * RAD)), unidadesM: ext / (CIRC * Math.cos(lat * RAD) / 2 ** Z), pendiente: true, intentos: 0 };
        soltar(k);
        teselas.set(k, t);
        ponerSuelo(t);
        contar();
      } catch (e) { fallar(e); }
    }

    // Alto del suelo de cada árbol: el relieve se muestrea en una grilla de 17 × 17 puntos
    // por tesela (unos 38 m) y se interpola. Mientras el relieve no ha cargado devuelve 0: la
    // tesela queda pendiente y se vuelve a calcular cuando el mapa quede quieto.
    function ponerSuelo(t) {
      if (!t.n) { t.pendiente = false; subir(t); return; }
      const ter = mapa.terrain;
      const N = 16, g = new Float32Array((N + 1) * (N + 1));
      let faltan = false;
      if (ter) {
        const n = 2 ** Z;
        for (let j = 0; j <= N; j++) {
          const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (t.y + j / N) / n))) / RAD;
          for (let i = 0; i <= N; i++) {
            const lon = (t.x + i / N) / n * 360 - 180;
            const h = ter.getElevationForLngLatZoom(new raiz.maplibregl.LngLat(lon, lat), Z);
            if (!h) faltan = true;
            g[j * (N + 1) + i] = h || 0;
          }
        }
      }
      const d = t.datos;
      for (let i = 0; i < d.length; i += ZANCADA) {
        const fx = Math.min(N - 1e-6, Math.max(0, d[i] / t.ext * N)), fy = Math.min(N - 1e-6, Math.max(0, d[i + 1] / t.ext * N));
        const i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
        const a = g[j0 * (N + 1) + i0], b = g[j0 * (N + 1) + i0 + 1], c = g[(j0 + 1) * (N + 1) + i0], e = g[(j0 + 1) * (N + 1) + i0 + 1];
        d[i + 2] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
      }
      t.conTerreno = !!ter;
      t.pendiente = !!ter && faltan;
      if (t.pendiente) t.intentos++;
      subir(t);
    }

    function subir(t) {
      if (!gl || !t.n) return;
      if (!t.vb) {
        t.vb = gl.createBuffer();
        t.vaoA = gl.createVertexArray();
        enlazar(t.vaoA, mArbol, 4, t.vb);
        t.vaoS = gl.createVertexArray();
        enlazar(t.vaoS, mSombra, 2, t.vb);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, t.vb);
      gl.bufferData(gl.ARRAY_BUFFER, t.datos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    function enlazar(vao, m, comp, vb) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, comp, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      const paso = ZANCADA * 4;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, paso, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, paso, 12); gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, paso, 28); gl.vertexAttribDivisor(3, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    function malla2gl(m) {
      const vb = gl.createBuffer(), ib = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      return { vb, ib, n: m.indices.length };
    }

    function soltar(k) {
      const t = teselas.get(k);
      if (!t) return;
      if (gl) { if (t.vaoA) gl.deleteVertexArray(t.vaoA); if (t.vaoS) gl.deleteVertexArray(t.vaoS); if (t.vb) gl.deleteBuffer(t.vb); }
      teselas.delete(k);
    }

    function contar() {
      est.teselas = teselas.size;
      est.arboles = 0;
      for (const t of teselas.values()) est.arboles += t.n;
    }

    function alQuedarQuieto() {
      if (!mapa || caida) return;
      const nec = necesarias();
      const conTerreno = !!mapa.terrain;
      for (const k of nec) {
        const t = teselas.get(k);
        if (!t) encolar(k);
        else if (t.datos && (t.conTerreno !== conTerreno || (t.pendiente && t.intentos < 6))) encolar(k);
      }
      if (teselas.size > op.maxTeselas) {
        const s = new Set(nec);
        for (const k of [...teselas.keys()]) if (!s.has(k)) soltar(k);
      }
      contar();
    }

    const capa = {
      id: op.id,
      type: 'custom',
      renderingMode: '3d',
      onAdd(m, contexto) {
        mapa = m;
        gl = contexto;
        try {
          if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('sin WebGL2');
          pa = programa(gl, ARBOL_V, ARBOL_F, ['a_v', 'i_pos', 'i_dim', 'i_otro']);
          ps = programa(gl, SOMBRA_V, SOMBRA_F, ['a_v', 'i_pos', 'i_dim', 'i_otro']);
          mArbol = malla2gl(malla());
          mSombra = malla2gl(mallaSombra());
          for (const t of teselas.values()) { t.vb = null; subir(t); }
          mapa.on('idle', alQuedarQuieto);
          mapa.on('moveend', alQuedarQuieto);
          alQuedarQuieto();
        } catch (e) {
          if (/WebGL2/.test(e.message)) est.sinWebGL2 = true;
          gl = null;
          fallar(e);
        }
      },
      onRemove() {
        for (const k of [...teselas.keys()]) soltar(k);
        if (gl) {
          if (pa) gl.deleteProgram(pa.p);
          if (ps) gl.deleteProgram(ps.p);
          for (const mm of [mArbol, mSombra]) if (mm) { gl.deleteBuffer(mm.vb); gl.deleteBuffer(mm.ib); }
        }
        pa = ps = mArbol = mSombra = null;
        if (mapa) { mapa.off('idle', alQuedarQuieto); mapa.off('moveend', alQuedarQuieto); }
        mapa = null; gl = null;
      },
      render(glr, args) {
        if (!gl || caida || mapa.getZoom() < 15 || !teselas.size) return;
        const t0 = performance.now();
        try { dibujar(args); } catch (e) { fallar(e); }
        est.ms = performance.now() - t0;
      }
    };

    function dibujar(args) {
      const M = args.defaultProjectionData.mainMatrix;
      const c = raiz.maplibregl.MercatorCoordinate.fromLngLat(sueloBajoCamara());
      const n2 = 2 ** Z;
      const sol = solActual();
      const noche = Math.min(1, Math.max(0, -sol.altura / 6));
      const arriba = Math.min(1, Math.max(0, (sol.altura + 1) / 5));      // hay sol directo
      const k = sol.intensidad == null ? 1 : sol.intensidad;
      const L = haciaSol(Math.max(sol.altura, 2), sol.azimut);
      const directa = 0.62 * arriba * (k < 0.75 ? 0.35 : 1) * (1 - noche);
      const cielo = (0.55 + (k < 0.75 ? 0.15 : 0)) * (1 - 0.6 * noche);
      const visibles = [];
      for (const t of teselas.values()) if (t.n && t.vaoA) visibles.push(t);
      est.dibujados = 0;

      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);

      // 1. Sombras en el suelo (antes, para que los troncos queden encima).
      est.sombras = !!(op.sombras && sol.activo && sol.altura > 4 && noche === 0);
      if (est.sombras) {
        const largo = 1 / Math.tan(sol.altura * RAD);
        const az = sol.azimut * RAD;
        const estirar = Math.min(3, 1 / Math.sin(sol.altura * RAD));
        gl.useProgram(ps.p);
        gl.uniform3f(ps.u.u_corre, -Math.sin(az) * largo, -Math.cos(az) * largo, estirar);
        gl.uniform1f(ps.u.u_alfa, op.alfaSombra * (k < 0.75 ? 0.35 : 1));
        gl.uniform2f(ps.u.u_desvanecer, op.desvanecer[0], op.desvanecer[1]);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        for (const t of visibles) dibujarTesela(ps, t, t.vaoS, mSombra.n, M, c, n2);
      }

      // 2. Árboles, opacos.
      gl.useProgram(pa.p);
      gl.uniform3f(pa.u.u_sol, L[0], L[1], L[2]);
      gl.uniform3f(pa.u.u_luz, directa, cielo, noche);
      gl.uniform2f(pa.u.u_desvanecer, op.desvanecer[0], op.desvanecer[1]);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      for (const t of visibles) { dibujarTesela(pa, t, t.vaoA, mArbol.n, M, c, n2); est.dibujados += t.n; }
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);
    }

    function dibujarTesela(pr, t, vao, nIdx, M, c, n2) {
      matrizTesela(M, t.x, t.y, t.ext, t.zMerc, m64);
      m32.set(m64);
      gl.uniformMatrix4fv(pr.u.u_matriz, false, m32);
      gl.uniform1f(pr.u.u_unidades_m, t.unidadesM);
      gl.uniform2f(pr.u.u_camara, (c.x * n2 - t.x) * t.ext, (c.y * n2 - t.y) * t.ext);
      gl.bindVertexArray(vao);
      gl.drawElementsInstanced(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0, t.n);
    }

    // El crédito va con una fuente vacía: MapLibre lo muestra mientras la capa está prendida.
    function ponerCredito(m) {
      if (!m.getSource(op.id + '-credito')) m.addSource(op.id + '-credito', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: op.credito });
      if (!m.getLayer(op.id + '-credito')) m.addLayer({ id: op.id + '-credito', type: 'circle', source: op.id + '-credito' });
    }

    function prender(m) {
      if (caida || est.activa) return;
      try {
        if (!B.mvt || !raiz.pmtiles) throw new Error('faltan mvt.js o pmtiles');
        if (!pm) pm = new raiz.pmtiles.PMTiles(op.url);
        // El archivo puede no estar publicado todavía: se revisa la cabecera antes de dibujar.
        pm.getHeader().then(() => {
          if (caida || est.activa) return;
          try {
            ponerCredito(m);
            const antes = m.getLayer('rotulos') ? 'rotulos' : undefined;
            m.addLayer(capa, antes);
            est.activa = true;
          } catch (e) { fallar(e); }
        }).catch(fallar);
      } catch (e) { fallar(e); }
    }

    function apagar(m) {
      est.activa = false;
      try {
        if (m.getLayer(op.id)) m.removeLayer(op.id);
        if (m.getLayer(op.id + '-credito')) m.removeLayer(op.id + '-credito');
        if (m.getSource(op.id + '-credito')) m.removeSource(op.id + '-credito');
      } catch (e) { /* el mapa ya no está */ }
    }

    return { prender, apagar, estado: est, fijarOpcion(k, v) { op[k] = v; if (mapa) mapa.triggerRepaint(); } };
  }

  B.arboles = Object.assign({ crear }, puro);
})(typeof window !== 'undefined' ? window : globalThis);
