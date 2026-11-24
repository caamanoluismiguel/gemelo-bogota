'use strict';
// Luz propia de los edificios en la vista 3D «Cómo se ve» (ronda 5).
//
// MapLibre pinta la cara al sol y la cara a la sombra con el mismo tono, solo más clara o más
// oscura. Aquí la cara al sol va cálida y la de la sombra fría, y la base de cada fachada se
// oscurece un poco cerca del suelo (una oclusión falsa y barata, por altura sobre el suelo).
// Lejos, los edificios se funden con la bruma del cielo.
//
// Cómo trabaja: no baja ni arma nada. Dibuja con los mismos búferes que MapLibre ya subió a la
// GPU para la capa «construcciones-3d» (misma geometría, mismo alto, mismo relieve), con un
// sombreador propio, y pone la opacidad de esa capa en 0 para que MapLibre no la dibuje dos
// veces. Eso usa piezas internas de MapLibre 5.24 (búferes de las teselas, datos del terreno y
// matrices por tesela). Si falta cualquiera de ellas, o no hay WebGL2, o algo falla al dibujar,
// la capa se quita sola y vuelve la luz de siempre de MapLibre.
(function (raiz) {
  const CIRC = 40075016.686;
  const RAD = Math.PI / 180;
  const EXT = 8192;              // unidades de tesela de MapLibre
  const OPACIDAD = 0.95;         // la de construcciones-3d en mapa.js

  // ── Paleta (pura, se prueba en Node) ────────────────────────────────────
  // Multiplicadores sobre el gris de cada edificio (el material lo pone mapa.js). El gris se
  // desatura casi del todo en el sombreador: el color viene de la luz, no de la pintura.
  const SOL_BAJO = [1.05, 1.0, 0.93];       // cara al sol con el sol bajo: gris claro tibio
  const SOL_ALTO = [1.0, 1.0, 0.99];        // al mediodía casi neutro
  const SOMBRA = [0.39, 0.4, 0.42];         // cara a la sombra: ~40 % de la del sol, apenas fría
  const CUBIERTO_SOL = [0.95, 0.95, 0.95];  // nublado: luz pareja
  const CUBIERTO_SOMBRA = [0.66, 0.66, 0.68];
  const CIELO = [0.5, 0.51, 0.54];          // sin sol directo (crepúsculo): solo la luz del cielo
  const NOCHE = [0.95, 0.96, 1.0];          // de noche el gris de noche de mapa.js, casi tal cual
  // Bruma de la distancia (ronda 7): azul pálido de día, más cálida con el sol bajo, oscura
  // de noche. La misma va al «fog-color» de MapLibre (sol-barra.js y mapa.js), así que los
  // edificios lejanos y los cerros se funden con el mismo aire.
  const BRUMA_DIA = [0.78, 0.84, 0.9];
  const BRUMA_CUBIERTO = [0.8, 0.82, 0.85];
  const BRUMA_ALBA = [0.86, 0.79, 0.72];
  const BRUMA_OCASO = [0.88, 0.73, 0.61];
  const BRUMA_NOCHE = [0.12, 0.15, 0.21];
  const BRUMA_MAX = 0.8;                    // ni los cerros más lejanos se borran del todo
  // Tinte de la hora sobre toda la escena (multiplica; 1 = nada).
  const TINTE_MANANA = [1.0, 0.95, 0.86];   // ámbar
  const TINTE_TARDE = [1.0, 0.92, 0.87];    // naranja rosado
  const TINTE_NOCHE = [0.84, 0.88, 0.98];   // azul frío
  const NEUTRO = [1, 1, 1];

  const mezcla = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function suave(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  // Cuánta noche hay: 0 con el sol arriba, 1 con el sol a −6° o más abajo (crepúsculo civil),
  // en línea recta. Es la misma cuenta que usa sol-barra.js para los colores del mapa.
  const deNoche = (altura) => Math.min(1, Math.max(0, -altura / 6));

  // Color de la bruma a esa hora. azimut en grados (menos de 180: mañana).
  function brumaHora(altura, azimut, intensidad) {
    const k = suave(0.45, 1, intensidad == null ? 1 : intensidad);
    const dia = mezcla(BRUMA_CUBIERTO, BRUMA_DIA, k);
    const bajo = mezcla(dia, (azimut == null || azimut >= 180) ? BRUMA_OCASO : BRUMA_ALBA, 0.35 + 0.65 * k);
    return mezcla(mezcla(bajo, dia, suave(2, 18, altura)), BRUMA_NOCHE, deNoche(altura));
  }
  const aHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const brumaHex = (altura, azimut, intensidad) => aHex(brumaHora(altura, azimut, intensidad));

  // Parte de las ventanas con luz de noche (0 a 1, antes de la variación por edificio y piso).
  // De día 0. Al caer la tarde se prenden en el crepúsculo (sol de −2° a −6°), quedan cerca de
  // un tercio en la noche temprana y bajan hacia la madrugada; antes del alba suben un poco.
  // Cada ventana tiene un umbral fijo: al cambiar la hora se prenden o apagan de a una, sin
  // parpadeo, y a la misma hora siempre son las mismas.
  function encendidas(altura, azimut) {
    if (!(altura < -2)) return 0;
    const entra = suave(-2, -6, altura);
    if (azimut == null || azimut >= 180) return entra * (0.32 - 0.18 * suave(-30, -60, altura));
    return entra * (0.12 + 0.12 * suave(-40, -8, altura));
  }

  // altura: grados del sol sobre el horizonte. intensidad: 1 con sol directo, 0,5 cubierto.
  function paleta(altura, intensidad, azimut) {
    const n = deNoche(altura);
    const sol = suave(-1, 4, altura);        // hay sol directo sobre las fachadas
    const k = suave(0.45, 1, intensidad == null ? 1 : intensidad);
    let calido = mezcla(CUBIERTO_SOL, mezcla(SOL_BAJO, SOL_ALTO, suave(6, 30, altura)), k);
    let frio = mezcla(CUBIERTO_SOMBRA, SOMBRA, k);
    const sinSol = mezcla(CIELO, NOCHE, n);
    return {
      calido: mezcla(sinSol, calido, sol),
      frio: mezcla(sinSol, frio, sol),
      techo: 1 + 0.12 * n,                  // de noche el techo recibe el cielo
      // Pie de la fachada (1 = nada). ao: oscurecimiento ancho y suave de los primeros 9 m
      // (abajo llega menos cielo). contacto: lo que se suma en el primer metro y medio, donde el
      // muro toca el piso (ronda 8): sin eso el edificio parece pegado encima de la foto. Los
      // dos son supuestos de aspecto, no una medida; la franja se apaga de lejos.
      ao: 0.58 + 0.14 * n,
      contacto: 0.2 - 0.1 * n,
      bruma: brumaHora(altura, azimut, intensidad).concat(BRUMA_MAX),
      encendidas: encendidas(altura, azimut),
      noche: n
    };
  }

  // Tinte de la hora (panel de textura, punto 1): ámbar en la mañana, neutro al mediodía,
  // naranja rosado en la tarde, azul frío de noche. azimut en grados (menos de 180: mañana).
  function tinte(altura, azimut, intensidad) {
    const k = suave(0.45, 1, intensidad == null ? 1 : intensidad);
    const bajo = (azimut == null || azimut < 180) ? TINTE_MANANA : TINTE_TARDE;
    let t = mezcla(bajo, NEUTRO, suave(4, 30, altura));
    t = mezcla(mezcla(NEUTRO, t, 0.3), t, k);          // nublado: casi neutro
    return mezcla(t, TINTE_NOCHE, deNoche(altura));
  }

  const VERTICE = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_normal_ed;
in vec2 a_centroid;
in float a_height;
in vec2 a_color;
uniform mat4 u_matriz;
uniform float u_con_terreno;
uniform sampler2D u_terrain;
uniform float u_terrain_dim;
uniform mat4 u_terrain_matrix;
uniform vec4 u_terrain_unpack;
uniform float u_terrain_exaggeration;
uniform vec2 u_camara;      // suelo bajo la cámara, en unidades de esta tesela
uniform float u_unidades_m; // unidades de tesela por metro
out vec3 v_base;
out vec3 v_n;
out float v_h;
out float v_lejos;
out float v_techo;
out float v_u;              // metros a lo largo del muro (para las ventanas)
flat out float v_alto;      // alto del edificio en metros
flat out float v_semilla;   // número fijo por edificio para variar ventanas y luces
const float ESCALON = 1.5;  // medio piso (PISO_M = 3 en mapa.js)
// Lo mismo que el preludio de MapLibre: color empacado y alto del terreno en el centroide.
vec2 desempacar(float v) { int i = int(v); int a = i / 256; return vec2(float(a), float(i - a * 256)); }
float ele(vec2 p) { vec4 c = (texture(u_terrain, p) * 255.0) * u_terrain_unpack; return c.r + c.g + c.b - u_terrain_unpack.a; }
float elevacion(vec2 pos) {
  vec2 coord = (u_terrain_matrix * vec4(pos, 0.0, 1.0)).xy * u_terrain_dim + 1.0;
  vec2 f = fract(coord);
  vec2 c = (floor(coord) + 0.5) / (u_terrain_dim + 2.0);
  float d = 1.0 / (u_terrain_dim + 2.0);
  float tl = ele(c), tr = ele(c + vec2(d, 0.0)), bl = ele(c + vec2(0.0, d)), br = ele(c + vec2(d, d));
  return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * u_terrain_exaggeration;
}
void main() {
  vec3 normal = a_normal_ed.xyz;
  float arriba = mod(normal.x, 2.0);
  bool terreno = u_con_terreno > 0.5;
  // El suelo de cada edificio es el relieve en su centroide, redondeado a medio piso. Sin
  // redondear, dos vecinos del mismo número de pisos quedaban a 0,1 a 0,6 m de diferencia (el
  // relieve medido en dos centroides a 10 m) y el muro de 30 cm entre los dos techos salía como
  // una raya clara. Medio piso está por debajo de lo que sabemos: el alto va de 3 en 3 m y el
  // relieve de 30 m tiene error de metros. Los escalones que quedan miden 1,5 m o más, como una
  // calle en pendiente de verdad. Los muros bajan 10 m bajo el suelo, así que nada flota.
  float suelo = terreno ? ESCALON * floor(elevacion(a_centroid) / ESCALON + 0.5) : 0.0;
  // Como MapLibre: con terreno la base baja 10 m para que no quede flotando en una ladera.
  float h = arriba > 0.0 ? max(0.0, a_height) : (terreno ? -10.0 : 0.0);
  gl_Position = u_matriz * vec4(a_pos, suelo + h, 1.0);
  v_base = vec3(desempacar(a_color.x), desempacar(a_color.y).x) / 255.0;
  v_n = normal / 16384.0;
  v_h = h;
  v_techo = (normal.x == 1.0 && normal.y == 0.0 && normal.z == 16384.0) ? 1.0 : 0.0;
  v_lejos = length(a_pos - u_camara) / u_unidades_m;
  // MapLibre guarda en a_normal_ed.w la distancia recorrida por el borde del polígono, en
  // unidades de tesela: sirve de coordenada horizontal continua al doblar la esquina.
  v_u = a_normal_ed.w / u_unidades_m;
  v_alto = max(0.0, a_height);
  v_semilla = floor(fract(dot(v_base, vec3(12.9898, 78.233, 37.719)) + a_height * 0.0137) * 997.0);
}`;

  const FRAGMENTO = `#version 300 es
precision highp float;
in vec3 v_base;
in vec3 v_n;
in float v_h;
in float v_lejos;
in float v_techo;
in float v_u;
flat in float v_alto;
flat in float v_semilla;
uniform float u_encendidas;
uniform vec3 u_luz;      // dirección de la luz de MapLibre (la pone sol-barra.js con el sol)
uniform vec3 u_calido;
uniform vec3 u_frio;
uniform float u_techo;
uniform float u_ao;
uniform float u_contacto;
uniform vec4 u_bruma;
uniform vec2 u_lejos_m;  // dónde empieza la bruma y su escala, en metros
out vec4 color;
float azar(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// 1 dentro de [a, b] con borde suavizado de un píxel (aa en metros).
float caja(float x, float a, float b, float aa) { return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x)); }
void main() {
  vec3 L = normalize(u_luz);
  float cara, inc;
  if (v_techo > 0.5) {
    cara = smoothstep(0.03, 0.3, L.z);
    inc = L.z;
  } else {
    // La fachada que mira hacia el sol, aunque el sol esté alto, va a la luz.
    vec2 n = normalize(v_n.xy + vec2(1e-6));
    cara = smoothstep(-0.05, 0.2, dot(n, normalize(L.xy + vec2(1e-6))));
    inc = max(dot(vec3(n, 0.0), L), 0.0);
  }
  // El color de fachada (ladrillo, pañete o concreto) se queda; la luz lo calienta o lo enfría.
  // La cubierta va un poco más oscura y menos saturada que los muros.
  float gris = dot(v_base, vec3(0.299, 0.587, 0.114));
  vec3 base = v_techo > 0.5 ? mix(vec3(gris), v_base, 0.55) * 0.86 : mix(vec3(gris), v_base, 0.92);
  vec3 luz = mix(u_frio, u_calido * (0.88 + 0.14 * inc), cara);
  vec3 c = base * luz;
  if (v_techo < 0.5 && v_h > 0.0) {
    // Pisos cada 3 m (el mismo supuesto del alto) y ventanas. Torres (12 pisos o más): más
    // vidrio y cuadrícula pareja. Casas y edificios de ladrillo: ventanas chicas y desiguales.
    float px = max(fwidth(v_u), fwidth(v_h));          // metros que cubre un píxel
    float detalle = 1.0 - smoothstep(0.18, 0.5, px);   // de lejos o de canto, muro liso
    float torre = step(35.5, v_alto);
    float piso = floor(v_h / 3.0), y = v_h - piso * 3.0;
    float paso = mix(3.2, 1.6, torre);
    float col = floor(v_u / paso), x = v_u - col * paso;
    float r1 = azar(vec3(col, piso, v_semilla)), r2 = azar(vec3(col + 0.5, piso, v_semilla + 3.0));
    float ancho = mix(0.85 + 0.6 * r1, 1.42, torre);
    float y0 = mix(0.9 + 0.2 * r2, 0.35, torre), y1 = mix(2.05 + 0.25 * r1, 2.75, torre);
    float hay = max(torre, step(0.14, r2)) * step(piso * 3.0 + y1 + 0.1, v_alto);
    float x0 = 0.5 * (paso - ancho), aa = max(px, 0.02);
    float vent = hay * caja(x, x0, x0 + ancho, aa) * caja(y, y0, y1, aa);
    float marco = hay * caja(x, x0 - 0.08, x0 + ancho + 0.08, aa) * caja(y, y0 - 0.08, y1 + 0.08, aa) - vent;
    // Vidrio: más oscuro que el muro, con algo del cielo; en las torres refleja más.
    float luzMedia = dot(luz, vec3(0.333));
    vec3 vidrio = mix(base * 0.4, u_bruma.rgb * 0.62, mix(0.22, 0.55, torre)) * mix(luz, vec3(luzMedia), 0.5);
    // Luces de noche: un umbral fijo por ventana; la parte encendida varía por edificio y piso.
    float cuota = u_encendidas * (0.7 + 0.6 * fract(v_semilla * 0.618)) * (0.8 + 0.4 * azar(vec3(piso, v_semilla, 7.0)));
    float prendida = step(azar(vec3(col, piso, v_semilla + 17.0)), cuota);
    vec3 calida = vec3(1.0, 0.8, 0.56) * (0.6 + 0.25 * r1);
    vec3 cerca = c * (1.0 + 0.1 * marco);
    cerca = mix(cerca, mix(vidrio, calida, prendida), vent);
    cerca *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.1 + aa, min(y, 3.0 - y))) * (1.0 - smoothstep(0.35, 0.75, px));
    // De lejos: el promedio de la fachada (muro, vidrio y luces), sin dibujar la cuadrícula.
    float f = mix(0.14, 0.6, torre);
    vec3 lejos = mix(c, vidrio, f) + f * u_encendidas * vec3(1.0, 0.8, 0.56) * 0.7;
    c = mix(lejos, cerca, detalle);
  }
  if (v_techo > 0.5) c *= u_techo;
  else {
    // Pie de la fachada: el ancho sube con la raíz del alto (rápido al principio) y el de
    // contacto es una franja corta y suave pegada al piso. La franja se va cuando un píxel
    // cubre más de medio metro (como las ventanas): de lejos mediría un píxel y sería una raya.
    float hs = max(v_h, 0.0);
    float pie = mix(u_ao, 1.0, sqrt(clamp(hs / 9.0, 0.0, 1.0)));
    float franja = 1.0 - smoothstep(0.25, 0.6, fwidth(v_h));
    pie *= 1.0 - u_contacto * franja * (1.0 - smoothstep(0.0, 1.5, hs));
    c *= pie;
  }
  // Bruma que crece con la distancia: la cuadra de enfrente limpia, los cerros a 8 km velados.
  c = mix(c, u_bruma.rgb, u_bruma.a * (1.0 - exp(-max(v_lejos - u_lejos_m.x, 0.0) / u_lejos_m.y)));
  color = vec4(min(c, vec3(1.0)), 1.0);
}`;

  // Tinte de la hora: un cuadro de pantalla completa que multiplica lo ya dibujado.
  const TINTE_V = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;
  const TINTE_F = `#version 300 es
precision mediump float;
uniform vec3 u_tinte;
out vec4 color;
void main() { color = vec4(u_tinte, 1.0); }`;

  const TIPOS = { Int8: 0x1400, Uint8: 0x1401, Int16: 0x1402, Uint16: 0x1403, Int32: 0x1404, Uint32: 0x1405, Float32: 0x1406 };
  const LUGAR = { a_pos: 0, a_normal_ed: 1, a_centroid: 2, a_height: 3, a_color: 4 };

  function compilar(gl, tipo, src) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('sombreador: ' + gl.getShaderInfoLog(s));
    return s;
  }

  // opciones: { capaML ('construcciones-3d'), fuente ('catastro'), id ('luz-edificios'),
  //   lejos ([250, 5000] m: dónde empieza la bruma y su escala), alFallar(motivo) }
  function crear(opciones) {
    const op = Object.assign({ capaML: 'construcciones-3d', fuente: 'catastro', id: 'luz-edificios', lejos: [250, 5000] }, opciones);
    let mapa = null, gl = null, prog = null, vao = null, loc = {}, caida = false;
    const est = { activa: false, sinWebGL2: false, error: null, teselas: 0, segmentos: 0, ms: 0 };
    const m32 = new Float32Array(16);

    // Lo que dice el sol: de sol-barra.js si está prendido; si no, un día claro.
    function solActual() {
      const sb = raiz.Bogotwin && raiz.Bogotwin.solBarra;
      const S = sb && sb.estado;
      if (S && S.activo && S.sol) return { activo: true, altura: S.sol.altura, azimut: S.sol.azimut, intensidad: S.ahora && S.cielo ? S.cielo.intensidad : 1 };
      return { activo: false, altura: 45, azimut: 180, intensidad: 1 };
    }

    // La luz de MapLibre, como la usa su sombreador de extrusiones (ancla «viewport» gira con el mapa).
    function luzML() {
      const L = mapa.style.light;
      const p = L.properties.get('position');
      let x = p.x, y = p.y;
      if (L.properties.get('anchor') === 'viewport') {
        const b = mapa.transform.bearingInRadians || 0, c = Math.cos(b), s = Math.sin(b);
        [x, y] = [x * c - y * s, x * s + y * c];
      }
      return [x, y, p.z];
    }

    function caminoCamara() {
      const t = mapa.transform;
      let ll = null;
      try { ll = t && t.getCameraLngLat ? t.getCameraLngLat() : null; } catch (e) { ll = null; }
      return raiz.maplibregl.MercatorCoordinate.fromLngLat(ll || mapa.getCenter());
    }

    function apuntar(vb, desde) {
      for (const a of vb.attributes) {
        const i = LUGAR[a.name];
        if (i === undefined) continue;
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, a.components, TIPOS[a.type], false, vb.itemSize, a.offset + vb.itemSize * desde);
      }
    }

    function fallar(motivo) {
      if (caida) return;
      caida = true;
      est.error = String(motivo && motivo.message || motivo);
      est.activa = false;
      // Vuelve la capa de MapLibre; la nuestra se quita fuera del cuadro que se está dibujando.
      if (mapa && mapa.getLayer(op.capaML)) mapa.setPaintProperty(op.capaML, 'fill-extrusion-opacity', OPACIDAD);
      const m = mapa;
      setTimeout(() => { if (m && m.getLayer(op.id)) m.removeLayer(op.id); }, 0);
      if (op.alFallar) op.alFallar(est.error);
    }

    const capa = {
      id: op.id,
      type: 'custom',
      renderingMode: '3d',
      minzoom: 14,
      onAdd(m, contexto) {
        mapa = m;
        gl = contexto;
        caida = false;
        est.error = null;
        try {
          if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) { est.sinWebGL2 = true; throw new Error('sin WebGL2'); }
          const s = mapa.style;
          const tm = s && (s.tileManagers || s.sourceCaches || {})[op.fuente];
          if (!tm || typeof tm.getVisibleCoordinates !== 'function' || !mapa.transform || typeof mapa.transform.getProjectionData !== 'function' || !s.light) {
            throw new Error('esta versión de MapLibre no expone lo que hace falta');
          }
          prog = gl.createProgram();
          gl.attachShader(prog, compilar(gl, gl.VERTEX_SHADER, VERTICE));
          gl.attachShader(prog, compilar(gl, gl.FRAGMENT_SHADER, FRAGMENTO));
          for (const n in LUGAR) gl.bindAttribLocation(prog, LUGAR[n], n);
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(prog));
          for (const u of ['u_matriz', 'u_con_terreno', 'u_terrain', 'u_terrain_dim', 'u_terrain_matrix', 'u_terrain_unpack', 'u_terrain_exaggeration',
            'u_camara', 'u_unidades_m', 'u_luz', 'u_calido', 'u_frio', 'u_techo', 'u_ao', 'u_contacto', 'u_bruma', 'u_lejos_m', 'u_encendidas']) loc[u] = gl.getUniformLocation(prog, u);
          vao = gl.createVertexArray();
          est.activa = true;
          mapa.setPaintProperty(op.capaML, 'fill-extrusion-opacity', 0);
        } catch (e) {
          gl = gl instanceof (raiz.WebGL2RenderingContext || Object) ? gl : null;
          fallar(e);
        }
      },
      onRemove() {
        if (gl && prog) gl.deleteProgram(prog);
        if (gl && vao) gl.deleteVertexArray(vao);
        prog = null; vao = null;
        if (mapa && mapa.getLayer(op.capaML)) mapa.setPaintProperty(op.capaML, 'fill-extrusion-opacity', OPACIDAD);
        est.activa = false;
        mapa = null; gl = null;
      },
      render() {
        if (caida || !prog || !mapa) return;
        try { dibujar(); } catch (e) { fallar(e); }
      }
    };

    function dibujar() {
      const t0 = performance.now();
      const s = mapa.style;
      const capaML = s.getLayer ? s.getLayer(op.capaML) : mapa.getLayer(op.capaML);
      const tm = (s.tileManagers || s.sourceCaches)[op.fuente];
      if (!capaML || !tm) throw new Error('falta la capa o la fuente');
      if (mapa.getLayoutProperty(op.capaML, 'visibility') === 'none') return;
      const ter = mapa.terrain || null;
      const sol = solActual();
      const p = paleta(sol.altura, sol.intensidad, sol.azimut);
      const cam = caminoCamara();

      gl.useProgram(prog);
      gl.uniform3fv(loc.u_luz, luzML());
      gl.uniform3fv(loc.u_calido, p.calido);
      gl.uniform3fv(loc.u_frio, p.frio);
      gl.uniform1f(loc.u_techo, p.techo);
      gl.uniform1f(loc.u_ao, p.ao);
      gl.uniform1f(loc.u_contacto, p.contacto);
      gl.uniform4fv(loc.u_bruma, p.bruma);
      gl.uniform2f(loc.u_lejos_m, op.lejos[0], op.lejos[1]);
      gl.uniform1f(loc.u_encendidas, p.encendidas);
      gl.uniform1f(loc.u_con_terreno, ter ? 1 : 0);
      gl.uniform1i(loc.u_terrain, 3);
      // Lo mismo que MapLibre para las extrusiones: se descartan las caras de atrás.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.bindVertexArray(vao);

      let nt = 0, ns = 0;
      for (const coord of tm.getVisibleCoordinates()) {
        const tile = tm.getTile(coord);
        const bucket = tile && tile.getBucket(capaML);
        if (!bucket || !bucket.layoutVertexBuffer || !bucket.indexBuffer) continue;
        const pc = bucket.programConfigurations.get(capaML.id);
        let alto = null, color = null;
        for (const vb of pc.getPaintVertexBuffers()) {
          const n = vb.attributes[0] && vb.attributes[0].name;
          if (n === 'a_height') alto = vb; else if (n === 'a_color') color = vb;
        }
        if (!alto || !color) throw new Error('el alto o el color no vienen por edificio');
        const pd = mapa.transform.getProjectionData({ overscaledTileID: coord, applyGlobeMatrix: true, applyTerrainMatrix: true });
        m32.set(pd.mainMatrix);
        gl.uniformMatrix4fv(loc.u_matriz, false, m32);
        const c = coord.canonical, n2 = 2 ** c.z;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (c.y + 0.5) / n2))) / RAD;
        gl.uniform1f(loc.u_unidades_m, EXT * n2 / (CIRC * Math.cos(lat * RAD)));
        gl.uniform2f(loc.u_camara, (cam.x * n2 - c.x) * EXT, (cam.y * n2 - c.y) * EXT);
        const conCentroide = !!(ter && bucket.centroidVertexBuffer);
        if (conCentroide) {
          const td = ter.getTerrainData(coord);
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, td.texture);
          gl.uniform1f(loc.u_terrain_dim, td.u_terrain_dim);
          m32.set(td.u_terrain_matrix);
          gl.uniformMatrix4fv(loc.u_terrain_matrix, false, m32);
          gl.uniform4fv(loc.u_terrain_unpack, td.u_terrain_unpack);
          gl.uniform1f(loc.u_terrain_exaggeration, td.u_terrain_exaggeration);
        }
        gl.uniform1f(loc.u_con_terreno, conCentroide ? 1 : 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.indexBuffer.buffer);
        for (const seg of bucket.segments.get()) {
          gl.bindBuffer(gl.ARRAY_BUFFER, bucket.layoutVertexBuffer.buffer);
          apuntar(bucket.layoutVertexBuffer, seg.vertexOffset);
          gl.bindBuffer(gl.ARRAY_BUFFER, alto.buffer);
          apuntar(alto, seg.vertexOffset);
          gl.bindBuffer(gl.ARRAY_BUFFER, color.buffer);
          apuntar(color, seg.vertexOffset);
          if (conCentroide) {
            gl.bindBuffer(gl.ARRAY_BUFFER, bucket.centroidVertexBuffer.buffer);
            apuntar(bucket.centroidVertexBuffer, seg.vertexOffset);
          } else {
            gl.disableVertexAttribArray(LUGAR.a_centroid);
            gl.vertexAttrib2f(LUGAR.a_centroid, 0, 0);
          }
          gl.drawElements(gl.TRIANGLES, seg.primitiveLength * 3, gl.UNSIGNED_SHORT, seg.primitiveOffset * 6);
          ns++;
        }
        nt++;
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.disable(gl.CULL_FACE);
      est.teselas = nt; est.segmentos = ns; est.ms = performance.now() - t0;
    }

    // ── Tinte de la hora ─────────────────────────────────────────────────
    // Un cuadro de pantalla completa que multiplica toda la escena (cielo, relieve, calles y
    // edificios; los rótulos quedan encima, sin teñir). Un solo dibujo, sin descarga. Solo con
    // la barra del sol prendida: sin hora elegida no hay tinte.
    const IDT = op.id + '-tinte';
    let tg = null, tprog = null, tvao = null, tbuf = null, tloc = null;
    const capaTinte = {
      id: IDT,
      type: 'custom',
      renderingMode: '3d',
      onAdd(m, contexto) {
        tg = contexto;
        try {
          if (typeof WebGL2RenderingContext === 'undefined' || !(tg instanceof WebGL2RenderingContext)) throw new Error('sin WebGL2');
          tprog = tg.createProgram();
          tg.attachShader(tprog, compilar(tg, tg.VERTEX_SHADER, TINTE_V));
          tg.attachShader(tprog, compilar(tg, tg.FRAGMENT_SHADER, TINTE_F));
          tg.bindAttribLocation(tprog, 0, 'a_pos');
          tg.linkProgram(tprog);
          if (!tg.getProgramParameter(tprog, tg.LINK_STATUS)) throw new Error('programa del tinte');
          tloc = tg.getUniformLocation(tprog, 'u_tinte');
          tvao = tg.createVertexArray();
          tg.bindVertexArray(tvao);
          tbuf = tg.createBuffer();
          tg.bindBuffer(tg.ARRAY_BUFFER, tbuf);
          tg.bufferData(tg.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), tg.STATIC_DRAW);
          tg.enableVertexAttribArray(0);
          tg.vertexAttribPointer(0, 2, tg.FLOAT, false, 0, 0);
          tg.bindVertexArray(null);
        } catch (e) {
          est.errorTinte = String(e && e.message || e);
          tprog = null;
          setTimeout(() => { if (m.getLayer(IDT)) m.removeLayer(IDT); }, 0);
        }
      },
      onRemove() {
        if (tg && tprog) tg.deleteProgram(tprog);
        if (tg && tvao) tg.deleteVertexArray(tvao);
        if (tg && tbuf) tg.deleteBuffer(tbuf);
        tprog = null; tvao = null; tbuf = null; tg = null;
      },
      render() {
        if (!tprog) return;
        const sol = solActual();
        if (!sol.activo) { est.tinte = null; return; }
        const t = tinte(sol.altura, sol.azimut, sol.intensidad);
        est.tinte = t;
        if (t.every((v) => v > 0.995)) return;
        tg.useProgram(tprog);
        tg.uniform3fv(tloc, t);
        tg.disable(tg.DEPTH_TEST);
        tg.disable(tg.STENCIL_TEST);
        tg.disable(tg.CULL_FACE);
        tg.enable(tg.BLEND);
        tg.blendFunc(tg.DST_COLOR, tg.ZERO);    // multiplicar
        tg.bindVertexArray(tvao);
        tg.drawArrays(tg.TRIANGLE_STRIP, 0, 4);
        tg.bindVertexArray(null);
      }
    };

    return {
      capa,
      capaTinte,
      estado: est,
      // Pone la capa sobre construcciones-3d. Devuelve false si no se pudo.
      prender(m) {
        if (m.getLayer(op.id) || !m.getLayer(op.capaML)) return !!m.getLayer(op.id);
        if (est.error) return false;
        const capas = m.getStyle().layers.map((l) => l.id);
        const sig = capas[capas.indexOf(op.capaML) + 1];
        m.addLayer(capa, sig);
        if (!m.getLayer(IDT)) m.addLayer(capaTinte, m.getLayer('rotulos') ? 'rotulos' : undefined);
        return est.activa;
      },
      apagar(m) {
        if (m.getLayer(IDT)) m.removeLayer(IDT);
        if (m.getLayer(op.id)) m.removeLayer(op.id);
        if (m.getLayer(op.capaML)) m.setPaintProperty(op.capaML, 'fill-extrusion-opacity', OPACIDAD);
      }
    };
  }

  const luzEdificios = { crear, paleta, tinte, deNoche, brumaHora, brumaHex, encendidas };
  if (typeof module === 'object' && module.exports) module.exports = luzEdificios;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.luzEdificios = luzEdificios;
  }
})(typeof window !== 'undefined' ? window : globalThis);
