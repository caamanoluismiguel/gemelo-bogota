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
  // Bruma del aire (PM2,5 del pronóstico): un gris pardo que lava la distancia. sol-barra.js
  // pasa la parte de la extinción que pone el aire sucio (0 a 1, vivo-datos.js pesoBruma).
  // De noche se va al mismo oscuro de la bruma de noche. El color es un supuesto de dibujo.
  const BRUMA_AIRE = [0.7, 0.66, 0.59];
  const BRUMA_AIRE_MAX = 0.95;              // con el aire de verdad, lo muy lejano se borra casi todo
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

  // Color de la bruma a esa hora. azimut en grados (menos de 180: mañana). aire: de 0 a 1.
  const aire01 = (a) => Math.min(1, Math.max(0, Number(a) || 0));
  const brumaAireColor = (altura) => mezcla(BRUMA_AIRE, BRUMA_NOCHE, deNoche(altura));
  function brumaHora(altura, azimut, intensidad, aire) {
    const k = suave(0.45, 1, intensidad == null ? 1 : intensidad);
    const dia = mezcla(BRUMA_CUBIERTO, BRUMA_DIA, k);
    const bajo = mezcla(dia, (azimut == null || azimut >= 180) ? BRUMA_OCASO : BRUMA_ALBA, 0.35 + 0.65 * k);
    const hora = mezcla(mezcla(bajo, dia, suave(2, 18, altura)), BRUMA_NOCHE, deNoche(altura));
    return mezcla(hora, brumaAireColor(altura), aire01(aire));
  }
  const aHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const brumaHex = (altura, azimut, intensidad, aire) => aHex(brumaHora(altura, azimut, intensidad, aire));
  const brumaAireHex = (altura) => aHex(brumaAireColor(altura));

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

  // ── Foto aérea en los techos (ronda 10) ─────────────────────────────────
  // La ortofoto no es «verdadera»: cada edificio sale inclinado hacia afuera del centro de la
  // toma, tanto más cuanto más alto. Para casas y edificios bajos el techo de la foto cae casi
  // donde va (un edificio de 4 pisos se corre de 1 a 3 m); en una torre de 25 pisos el techo
  // fotografiado queda decenas de metros corrido y en su lugar se ve la calle o la fachada.
  // Por eso la foto va entera hasta FOTO_ALTO[0] m, cede hasta FOTO_ALTO[1] m y de ahí arriba
  // el techo es el tono de siempre. Medido en las capturas de la ronda 10 (ver pruebas).
  const FOTO_ALTO = [13, 25];
  const FOTO_PESO = 0.92;      // un poco del tono queda: el techo no se confunde con el piso
  function pesoFoto(alto, cobertura, opacidad) {
    if (!(cobertura > 0) || !(opacidad > 0)) return 0;
    return FOTO_PESO * Math.min(1, cobertura) * Math.min(1, opacidad) * (1 - suave(FOTO_ALTO[0], FOTO_ALTO[1], alto));
  }
  // El mismo ajuste de color que MapLibre le hace a la capa raster del piso (raster.fragment).
  const factorSaturacion = (s) => (s > 0 ? 1 - 1 / (1.001 - s) : -s);
  const factorContraste = (c) => (c > 0 ? 1 / (1 - c) : 1 + c);
  // Dos mosaicos de la foto en planta: uno cerca de la cámara (más detalle) y otro que cubre
  // hasta donde llega la foto del piso. lado en metros, px de lado de la textura.
  const CASCADAS = [{ lado: 720, px: 2048 }, { lado: 2600, px: 1024 }];
  const ENTRADA_MS = 300;      // una tesela que llega entra en 0,3 s, sin parpadeo
  // Origen del mosaico: adelante de la cámara (hacia donde mira), en pasos de un octavo del
  // lado, para que no se rehaga en cada cuadro. Todo en coordenadas Mercator (0 a 1).
  function origenCascada(camX, camY, rumboGrados, ladoMerc) {
    const b = rumboGrados * RAD, adelante = 0.3 * ladoMerc, paso = ladoMerc / 8;
    const cx = camX + Math.sin(b) * adelante, cy = camY - Math.cos(b) * adelante;
    return [paso * Math.round((cx - ladoMerc / 2) / paso), paso * Math.round((cy - ladoMerc / 2) / paso)];
  }

  // altura: grados del sol sobre el horizonte. intensidad: 1 con sol directo, 0,5 cubierto.
  // aire (0 a 1): la parte de la extinción que pone el PM2,5; tiñe la bruma de gris pardo.
  // escalaAireM: 1 / extinción del aire de esa hora (Koschmieder, vivo-datos.js), en metros.
  // Con ella la bruma lejana sigue a Beer-Lambert con el aire de verdad en vez de la escala fija.
  function paleta(altura, intensidad, azimut, aire, escalaAireM) {
    const conAire = escalaAireM > 0 && Number.isFinite(escalaAireM);
    const a = aire01(aire);
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
      bruma: brumaHora(altura, azimut, intensidad, a).concat(conAire ? BRUMA_AIRE_MAX : BRUMA_MAX),
      // Multiplica el inicio de la bruma (no se mueve: la ciudad cercana sigue limpia) y, si hay
      // aire, da la escala en metros; si no, la escala fija de la capa.
      lejos: [1, 1],
      escalaM: conAire ? escalaAireM : 0,
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

  // ── Tipo de fachada por edificio (ronda 10) ─────────────────────────────
  // Antes todos los edificios de ladrillo compartían una sola cuadrícula de ventanas y las torres
  // salían clonadas. Ahora cada edificio saca de su número fijo (semilla) un tipo de fachada y
  // sus medidas. Son supuestos de aspecto: Catastro no dice cómo es cada fachada.
  //
  // La semilla sale del color del edificio y su número de pisos. De noche mapa.js mezcla el
  // color hacia NOCHE_MATERIAL, así que el sombreador no usa el color tal cual: busca en la
  // paleta de día (comun.js) el color que apunta en la misma dirección desde NOCHE_MATERIAL
  // (la mezcla en línea recta no cambia esa dirección). Así el tipo y las ventanas no saltan
  // al mover la hora. Estas funciones son el espejo en JS del sombreador, para las pruebas.
  const NOCHE_MATERIAL = [0x1c / 255, 0x22 / 255, 0x30 / 255];   // el mismo de mapa.js
  const fr = (x) => x - Math.floor(x);
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  function indicePaleta(rgb, paleta) {
    const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
    const d = unit(rgb.map((v, i) => v - NOCHE_MATERIAL[i] + 1e-5));
    let mejor = -2, idx = 0;
    paleta.forEach((p, i) => {
      const q = unit(p.map((v, j) => v - NOCHE_MATERIAL[j]));
      const k = d[0] * q[0] + d[1] * q[1] + d[2] * q[2];
      if (k > mejor) { mejor = k; idx = i; }
    });
    return idx;
  }
  // Colores casi alineados desde NOCHE_MATERIAL (grises y concretos parecidos) se confunden de
  // noche al redondear a 8 bits: cuentan como uno solo. grupos[i] es el primero de su grupo.
  const UNIDOS = 0.9999;
  function gruposPaleta(paleta) {
    const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
    const q = paleta.map((p) => unit(p.map((v, j) => v - NOCHE_MATERIAL[j])));
    const g = paleta.map((_, i) => i);
    const raizDe = (i) => (g[i] === i ? i : (g[i] = raizDe(g[i])));
    for (let i = 0; i < q.length; i++) for (let j = 0; j < i; j++) {
      if (q[i][0] * q[j][0] + q[i][1] * q[j][1] + q[i][2] * q[j][2] > UNIDOS) { const a = raizDe(i), b = raizDe(j); g[Math.max(a, b)] = Math.min(a, b); }
    }
    return g.map((_, i) => raizDe(i));
  }
  const semilla = (indice, alto) => {
    const i = indice + 1, p = Math.floor(Math.max(0, alto) / 3 + 0.5);
    return Math.floor(fr(i * 0.754877 + p * 0.56984 + i * p * 0.0131) * 997);
  };
  // Tipos. Bajos (menos de 12 pisos): 0 ventanas sueltas, 1 ventanas corridas (cinta),
  // 2 balcones (franja hundida y losa), 3 sobria (pocas ventanas, chicas). Torres: 4 muro
  // cortina con antepecho, 5 retícula de concreto, 6 aletas verticales.
  const TIPOS_FACHADA = ['sueltas', 'cinta', 'balcones', 'sobria', 'cortina', 'reticula', 'aletas'];
  function fachada(s, torre, alto) {
    const hA = fr(s * 0.6180339 + 0.13);
    const hD = fr(s * 0.236068 + 0.53), hE = fr(s * 0.5698403 + 0.91);
    const tipo = torre ? (hA < 0.4 ? 4 : hA < 0.75 ? 5 : 6) : (hA < 0.42 ? 0 : hA < 0.62 ? 1 : hA < 0.84 ? 2 : 3);
    return {
      tipo,
      // Local a la calle: el primer piso con vitrina ancha y oscura y una franja de aviso encima.
      tienda: !torre && alto < 21.5 && hE < 0.5,
      tinte: Math.floor(hD * 3.999)
    };
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
uniform vec4 u_paleta[24];  // colores de fachada de día (comun.js PALETA_FACHADA) y su grupo
uniform int u_npaleta;
uniform vec3 u_noche_mat;   // NOCHE_MATERIAL de mapa.js
uniform vec3 u_uvC;         // de unidades de tesela a la foto cercana: escala, corrimiento x, y
uniform vec3 u_uvL;         // lo mismo para la foto lejana
out vec3 v_base;
out vec2 v_uvC;
out vec2 v_uvL;
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
  v_uvC = a_pos * u_uvC.x + u_uvC.yz;
  v_uvL = a_pos * u_uvL.x + u_uvL.yz;
  // Semilla fija por edificio: el color de día que le corresponde (de noche viene mezclado hacia
  // NOCHE_MATERIAL, pero apunta en la misma dirección) y su número de pisos. Ver semilla() en JS.
  vec3 d = normalize(v_base - u_noche_mat + 1e-5);
  float mejor = -2.0, idx = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= u_npaleta) break;
    float k = dot(d, normalize(u_paleta[i].rgb - u_noche_mat));
    if (k > mejor) { mejor = k; idx = u_paleta[i].w; }
  }
  float ip = idx + 1.0, pisos = floor(v_alto / 3.0 + 0.5);
  v_semilla = floor(fract(ip * 0.754877 + pisos * 0.56984 + ip * pisos * 0.0131) * 997.0);
}`;

  const FRAGMENTO = `#version 300 es
precision highp float;
in vec3 v_base;
in vec3 v_n;
in float v_h;
in float v_lejos;
in float v_techo;
in float v_u;
in vec2 v_uvC;
in vec2 v_uvL;
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
uniform sampler2D u_fotoC;    // la foto del piso en planta, cerca de la cámara
uniform sampler2D u_fotoL;    // y hasta donde llega la foto
uniform float u_foto;         // opacidad de la foto del piso; 0 = sin foto (techo de siempre)
uniform vec4 u_orto_ajuste;   // el ajuste de la capa del piso: saturación, contraste, brillo mín y máx
uniform vec2 u_foto_alto;     // la foto va entera hasta x m de alto y se va del todo en y m
out vec4 color;
float azar(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// 1 dentro de [a, b] con borde suavizado de un píxel (aa en metros).
float caja(float x, float a, float b, float aa) { return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x)); }
// 1 dentro del mosaico, bajando a 0 en el 4 % del borde (sin corte duro donde termina).
float dentro(vec2 uv) { vec2 b = smoothstep(vec2(0.0), vec2(0.04), uv) * (1.0 - smoothstep(vec2(0.96), vec2(1.0), uv)); return b.x * b.y; }
void main() {
  // Las derivadas de la foto se toman aquí, fuera de los «if», y se usan con textureGrad.
  vec2 gCx = dFdx(v_uvC), gCy = dFdy(v_uvC), gLx = dFdx(v_uvL), gLy = dFdy(v_uvL);
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
    // Pisos cada 3 m (el mismo supuesto del alto) y ventanas. Torres: 12 pisos o más.
    float px = max(fwidth(v_u), fwidth(v_h));          // metros que cubre un píxel
    float detalle = 1.0 - smoothstep(0.18, 0.5, px);   // de lejos o de canto, muro liso
    float torre = step(35.5, v_alto);
    float piso = floor(v_h / 3.0), y = v_h - piso * 3.0;
    // Tipo y medidas de la fachada de este edificio (ronda 10; espejo: fachada() en JS).
    float s = v_semilla;
    float hA = fract(s * 0.6180339 + 0.13), hB = fract(s * 0.4142136 + 0.71), hC = fract(s * 0.7320508 + 0.37);
    float hD = fract(s * 0.236068 + 0.53), hE = fract(s * 0.5698403 + 0.91);
    int tipo = torre > 0.5 ? (hA < 0.4 ? 4 : hA < 0.75 ? 5 : 6) : (hA < 0.42 ? 0 : hA < 0.62 ? 1 : hA < 0.84 ? 2 : 3);
    // Local a la calle: solo el primer piso de edificios bajos (no sabemos qué muro da a la calle).
    bool tienda = torre < 0.5 && v_alto < 21.5 && hE < 0.5 && v_h < 3.0;
    float paso, ancho, y0, y1, falta = 0.0, marcoK = 1.0;
    if (tienda) { paso = 4.2 + 0.8 * hB; ancho = paso - 0.3; y0 = 0.15; y1 = 2.4; marcoK = 0.0; }
    else if (tipo == 0) { paso = 3.0 + 0.8 * hB; ancho = (0.38 + 0.2 * hC) * paso; y0 = 1.0; y1 = 2.17; falta = 0.14; }
    else if (tipo == 1) { paso = 2.0 + 1.0 * hB; ancho = paso - 0.14; y0 = 1.0; y1 = 2.15; marcoK = 0.0; }
    else if (tipo == 2) { paso = 2.6 + 1.0 * hB; ancho = (0.55 + 0.15 * hC) * paso; y0 = 0.2; y1 = 2.45; falta = 0.06; }
    else if (tipo == 3) { paso = 3.8 + 0.8 * hB; ancho = (0.28 + 0.12 * hC) * paso; y0 = 1.1; y1 = 2.0; falta = 0.3; }
    else if (tipo == 4) { paso = 1.2 + 0.3 * floor(hB * 4.0); ancho = paso - 0.08; y0 = 0.25 + 0.7 * hC; y1 = 2.95; marcoK = 0.0; }
    else if (tipo == 5) { paso = 1.5 + 0.3 * hB; ancho = 0.88 * paso; y0 = 0.35; y1 = 2.75; }
    else { paso = 1.4 + 0.3 * hB; ancho = paso - 0.1; y0 = 0.3; y1 = 2.8; marcoK = 0.0; }
    // Parte de vidrio de la fachada (para verla de lejos sin dibujar la cuadrícula).
    float f = (ancho / paso) * ((y1 - y0) / 3.0) * (1.0 - falta);
    float col = floor(v_u / paso), x = v_u - col * paso;
    float r1 = azar(vec3(col, piso, v_semilla)), r2 = azar(vec3(col + 0.5, piso, v_semilla + 3.0));
    // Las ventanas sueltas de ladrillo salen desiguales, como en la r9.
    if (tipo == 0 && !tienda) { ancho *= 0.85 + 0.3 * r1; y0 = 0.9 + 0.2 * r2; y1 = 2.05 + 0.25 * r1; }
    float hay = step(falta, r2) * step(piso * 3.0 + y1 + 0.1, v_alto);
    float x0 = 0.5 * (paso - ancho), aa = max(px, 0.02);
    float vent = hay * caja(x, x0, x0 + ancho, aa) * caja(y, y0, y1, aa);
    float marco = marcoK * hay * caja(x, x0 - 0.08, x0 + ancho + 0.08, aa) * caja(y, y0 - 0.08, y1 + 0.08, aa) - marcoK * vent;
    // Vidrio: más oscuro que el muro, con algo del cielo; en las torres refleja más y tiene
    // un tinte propio por edificio (neutro, azul, verde o bronce, unos ±6 %).
    float luzMedia = dot(luz, vec3(0.333));
    vec3 vidrio = mix(base * 0.4, u_bruma.rgb * 0.62, mix(0.22, 0.55, torre)) * mix(luz, vec3(luzMedia), 0.5);
    if (torre > 0.5) vidrio *= hD < 0.25 ? vec3(1.0) : hD < 0.5 ? vec3(0.95, 0.99, 1.06) : hD < 0.75 ? vec3(0.96, 1.04, 0.99) : vec3(1.06, 1.0, 0.93);
    if (tienda) vidrio *= 0.8;
    // El muro de este piso: franja hundida de los balcones, antepechos del muro cortina,
    // aletas, franja de aviso del local.
    vec3 muro = c;
    float muroLejos = 1.0;
    if (tienda) {
      muro *= 1.0 - 0.28 * caja(y, 2.45, 3.0, aa);
      muroLejos = 0.95;
    } else if (tipo == 2) {
      // Balcones: todo el piso va hundido (más oscuro) menos el canto de la losa y la baranda.
      float losa = 1.0 - smoothstep(0.14 - aa, 0.14 + aa, y);
      muro *= mix(0.8, 1.08, losa);
      muroLejos = 0.83;
    } else if (tipo == 4) {
      // Muro cortina: el antepecho entre pisos es vidrio opaco, entre el muro y el vidrio.
      muro = mix(c, vidrio * 1.15, 0.55);
      f += 0.55 * (y0 + 3.0 - y1) / 3.0 * (1.0 - f);
    } else if (tipo == 6) {
      // Aletas: un pilar de 45 cm cada tres montantes, un poco más claro.
      float aleta = (1.0 - step(0.5, mod(col, 3.0))) * caja(x, 0.0, 0.45, aa);
      vent *= 1.0 - aleta;
      muro *= 1.0 + 0.07 * aleta;
      f *= 1.0 - 0.45 / (3.0 * paso);
    }
    // Luces de noche: un umbral fijo por ventana; la parte encendida varía por edificio y piso.
    float cuota = u_encendidas * (0.7 + 0.6 * fract(v_semilla * 0.618)) * (0.8 + 0.4 * azar(vec3(piso, v_semilla, 7.0)));
    float prendida = step(azar(vec3(col, piso, v_semilla + 17.0)), cuota);
    vec3 calida = vec3(1.0, 0.8, 0.56) * (0.6 + 0.25 * r1);
    vec3 cerca = muro * (1.0 + 0.1 * marco);
    cerca = mix(cerca, mix(vidrio, calida, prendida), vent);
    if (tipo == 2 && !tienda) cerca *= 1.0 + 0.1 * caja(y, 0.98, 1.06, aa);   // baranda
    cerca *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.1 + aa, min(y, 3.0 - y))) * (1.0 - smoothstep(0.35, 0.75, px));
    // De lejos: el promedio de la fachada (muro, vidrio y luces), sin dibujar la cuadrícula.
    vec3 lejos = mix(c * muroLejos, vidrio, f) + f * u_encendidas * vec3(1.0, 0.8, 0.56) * 0.7;
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
  // Foto aérea en el techo (ronda 10): la misma foto del piso, en el mismo punto de la planta y
  // con el mismo ajuste de color. Sin foto (2D, error, tesela que no llegó) queda el tono.
  // Para ahorrar: el techo alto (sin foto) no lee nada, y el mosaico de lejos solo se lee
  // donde el de cerca no alcanza.
  float fotoAlto = 1.0 - smoothstep(u_foto_alto.x, u_foto_alto.y, v_alto);
  if (v_techo > 0.5 && u_foto > 0.0 && fotoAlto > 0.0) {
    vec4 fs = textureGrad(u_fotoC, v_uvC, gCx, gCy) * dentro(v_uvC);
    if (fs.a < 0.999) fs += textureGrad(u_fotoL, v_uvL, gLx, gLy) * dentro(v_uvL) * (1.0 - fs.a);
    vec3 foto = fs.rgb / max(fs.a, 1e-3);
    foto += (dot(foto, vec3(1.0 / 3.0)) - foto) * u_orto_ajuste.x;
    foto = (foto - 0.5) * u_orto_ajuste.y + 0.5;
    foto = mix(vec3(u_orto_ajuste.z), vec3(u_orto_ajuste.w), foto);
    float peso = 0.92 * u_foto * clamp(fs.a, 0.0, 1.0) * fotoAlto;
    c = mix(c, foto, peso);
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

  // Mosaico de la foto: copia cada tesela de la foto del piso a su lugar en planta.
  const FOTO_V = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect;   // esquinas de la tesela dentro del mosaico (0 a 1)
out vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(mix(u_rect.xy, u_rect.zw, a_pos) * 2.0 - 1.0, 0.0, 1.0); }`;
  const FOTO_F = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alfa;   // la tesela recién llegada entra de a poco
out vec4 color;
void main() { color = texture(u_tex, v_uv) * u_alfa; }`;   // MapLibre la guarda premultiplicada

  const TIPOS = { Int8: 0x1400, Uint8: 0x1401, Int16: 0x1402, Uint16: 0x1403, Int32: 0x1404, Uint32: 0x1405, Float32: 0x1406 };
  const LUGAR = { a_pos: 0, a_normal_ed: 1, a_centroid: 2, a_height: 3, a_color: 4 };

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
    for (const n in atributos) gl.bindAttribLocation(p, atributos[n], n);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // opciones: { capaML ('construcciones-3d'), fuente ('catastro'), id ('luz-edificios'),
  //   lejos ([250, 5000] m: dónde empieza la bruma y su escala), alFallar(motivo),
  //   fotos (['orto', 'orto-cerca']: capas raster de la foto del piso, de fuente con el mismo id) }
  function crear(opciones) {
    const op = Object.assign({ capaML: 'construcciones-3d', fuente: 'catastro', id: 'luz-edificios', lejos: [250, 5000], fotos: ['orto', 'orto-cerca'] }, opciones);
    let mapa = null, gl = null, prog = null, vao = null, loc = {}, caida = false;
    const est = { activa: false, sinWebGL2: false, error: null, teselas: 0, segmentos: 0, ms: 0, foto: 'sin foto', fotoTeselas: 0, fotoMs: 0, fotoVeces: 0 };
    const m32 = new Float32Array(16);
    const paletaGL = new Float32Array(24 * 4);
    let nPaleta = 0;

    // Lo que dice el sol: de sol-barra.js si está prendido; si no, un día claro.
    function solActual() {
      const sb = raiz.Bogotwin && raiz.Bogotwin.solBarra;
      const S = sb && sb.estado;
      if (S && S.activo && S.sol) return { activo: true, altura: S.sol.altura, azimut: S.sol.azimut, intensidad: S.ahora && S.cielo ? S.cielo.intensidad : 1, aire: S.brumaAire || 0, escalaAireM: S.escalaAireM || 0 };
      return { activo: false, altura: 45, azimut: 180, intensidad: 1, aire: 0, escalaAireM: 0 };
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
          prog = programa(gl, VERTICE, FRAGMENTO, LUGAR);
          for (const u of ['u_matriz', 'u_con_terreno', 'u_terrain', 'u_terrain_dim', 'u_terrain_matrix', 'u_terrain_unpack', 'u_terrain_exaggeration',
            'u_camara', 'u_unidades_m', 'u_luz', 'u_calido', 'u_frio', 'u_techo', 'u_ao', 'u_contacto', 'u_bruma', 'u_lejos_m', 'u_encendidas',
            'u_paleta', 'u_npaleta', 'u_noche_mat', 'u_uvC', 'u_uvL', 'u_fotoC', 'u_fotoL', 'u_foto', 'u_orto_ajuste', 'u_foto_alto']) loc[u] = gl.getUniformLocation(prog, u);
          vao = gl.createVertexArray();
          const pal = (raiz.Bogotwin && raiz.Bogotwin.PALETA_FACHADA) || [];
          nPaleta = Math.min(24, pal.length);
          const rgb = pal.slice(0, nPaleta).map(hexRgb), grupos = gruposPaleta(rgb);
          for (let i = 0; i < nPaleta; i++) paletaGL.set(rgb[i].concat(grupos[i]), i * 4);
          try { prepararFoto(); } catch (e) { apagarFoto(e); }
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
        if (gl) soltarFoto();
        if (mapa && mapa.getLayer(op.capaML)) mapa.setPaintProperty(op.capaML, 'fill-extrusion-opacity', OPACIDAD);
        est.activa = false;
        mapa = null; gl = null;
      },
      // Antes del cuadro, fuera de la pantalla: arma los mosaicos de la foto de los techos.
      prerender() {
        if (caida || !prog || !mapa || !F.prog) return;
        try { componerFoto(); } catch (e) { apagarFoto(e); }
      },
      render() {
        if (caida || !prog || !mapa) return;
        try { dibujar(); } catch (e) { fallar(e); }
      }
    };

    // ── Foto aérea en los techos ─────────────────────────────────────────
    // Las teselas de la foto que MapLibre ya tiene en la GPU para pintar el piso se copian, cada
    // una en su lugar, a dos mosaicos en planta (cerca y lejos de la cámara). El techo de cada
    // edificio lee el mosaico en su punto de la planta. No se baja nada aparte: si la foto del
    // piso cambia de origen, los techos la siguen. Si algo de esto falla, solo se apaga la foto.
    const F = { prog: null, vao: null, buf: null, loc: null, mos: [], visto: new Map(), ultimo: -1e9, pendiente: false, lista: false, ajuste: [0, 1, 0, 1], opacidad: 0, aniso: null };
    function prepararFoto() {
      F.prog = programa(gl, FOTO_V, FOTO_F, { a_pos: 0 });
      F.loc = { u_rect: gl.getUniformLocation(F.prog, 'u_rect'), u_tex: gl.getUniformLocation(F.prog, 'u_tex'), u_alfa: gl.getUniformLocation(F.prog, 'u_alfa') };
      F.vao = gl.createVertexArray();
      gl.bindVertexArray(F.vao);
      F.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, F.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      F.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      F.mos = CASCADAS.map((c) => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, Math.log2(c.px) + 1, gl.RGBA8, c.px, c.px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (F.aniso) gl.texParameterf(gl.TEXTURE_2D, F.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(F.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) throw new Error('el mosaico de la foto no se pudo armar');
        return { lado: c.lado, px: c.px, tex, fbo, org: [0, 0], S: 1, clave: '', lleno: false };
      });
      gl.bindTexture(gl.TEXTURE_2D, null);
      est.foto = 'lista';
    }
    function soltarFoto() {
      if (F.prog) gl.deleteProgram(F.prog);
      if (F.vao) gl.deleteVertexArray(F.vao);
      if (F.buf) gl.deleteBuffer(F.buf);
      for (const m of F.mos) { gl.deleteTexture(m.tex); gl.deleteFramebuffer(m.fbo); }
      F.prog = null; F.vao = null; F.buf = null; F.mos = []; F.lista = false; F.visto.clear();
    }
    function apagarFoto(e) {
      est.foto = 'apagada: ' + String(e && e.message || e);
      try { if (gl) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); soltarFoto(); } } catch (e2) { /* nada */ }
      F.lista = false;
    }
    // Las capas de la foto que se ven ahora (existen, visibles y dentro de su zoom).
    function capasFoto() {
      const z = mapa.getZoom(), s = mapa.style, tms = s.tileManagers || s.sourceCaches || {};
      const r = [];
      for (const id of op.fotos) {
        const l = mapa.getLayer(id);
        if (!l || mapa.getLayoutProperty(id, 'visibility') === 'none') continue;
        if (z < (l.minzoom || 0) || z >= (l.maxzoom || 99)) continue;
        const tm = tms[l.source || id];
        if (tm && typeof tm.getVisibleCoordinates === 'function') r.push({ id, l, tm });
      }
      return r;
    }
    function componerFoto() {
      const t0 = performance.now();
      const capas = capasFoto();
      if (!capas.length) { F.lista = false; F.opacidad = 0; est.foto = 'sin foto'; est.fotoTeselas = 0; return; }
      // El color y la opacidad de la foto del piso, tal como los pinta MapLibre ahora (de día o de noche).
      const pint = capas[0].l.paint;
      const g = (k, d) => { const v = pint && pint.get ? pint.get(k) : d; return typeof v === 'number' ? v : d; };
      F.opacidad = g('raster-opacity', 1);
      F.ajuste = [factorSaturacion(g('raster-saturation', 0)), factorContraste(g('raster-contrast', 0)), g('raster-brightness-min', 0), g('raster-brightness-max', 1)];
      const ahora = performance.now();
      const teselas = [], vivas = new Set();
      for (const { id, tm } of capas) {
        for (const coord of tm.getVisibleCoordinates()) {
          const t = tm.getTile(coord);
          const tex = t && t.texture && t.texture.texture;
          if (!tex) continue;
          const clave = id + '/' + coord.key;
          vivas.add(clave);
          if (!F.visto.has(clave)) F.visto.set(clave, ahora);
          teselas.push({ coord, tex, clave, alfa: Math.min(1, (ahora - F.visto.get(clave)) / ENTRADA_MS) });
        }
      }
      for (const k of F.visto.keys()) if (!vivas.has(k)) F.visto.delete(k);
      teselas.sort((a, b) => a.coord.canonical.z - b.coord.canonical.z || a.clave.localeCompare(b.clave));
      const entrando = teselas.some((t) => t.alfa < 1);
      const cam = caminoCamara();
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * cam.y))) / RAD;
      const merc = 1 / (CIRC * Math.cos(lat * RAD));       // Mercator por metro
      const firma = teselas.map((t) => t.clave).join(',');
      const pendientes = F.mos.map((m) => {
        const S = m.lado * merc;
        const org = origenCascada(cam.x, cam.y, mapa.getBearing(), S);
        const clave = org.join(',') + '|' + firma;
        return { m, S, org, cambio: clave !== m.clave || entrando, clave };
      }).filter((p) => p.cambio);
      F.lista = F.mos.some((m) => m.lleno);
      est.fotoTeselas = teselas.length;
      if (!pendientes.length) { est.foto = 'lista'; return; }
      // Rehacer el mosaico cuesta: como mucho cada 100 ms, y se pide otro cuadro si quedó algo.
      if (ahora - F.ultimo < 100 && F.lista) { mapa.triggerRepaint(); return; }
      F.ultimo = ahora;
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(F.prog);
      gl.uniform1i(F.loc.u_tex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(F.vao);
      gl.clearColor(0, 0, 0, 0);
      for (const { m, S, org, clave } of pendientes) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
        gl.viewport(0, 0, m.px, m.px);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const t of teselas) {
          const c = t.coord.canonical, n2 = 2 ** c.z;
          const x0 = (c.x / n2 + (t.coord.wrap || 0) - org[0]) / S, y0 = (c.y / n2 - org[1]) / S, k = 1 / (n2 * S);
          if (x0 > 1 || y0 > 1 || x0 + k < 0 || y0 + k < 0) continue;
          gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.uniform4f(F.loc.u_rect, x0, y0, x0 + k, y0 + k);
          gl.uniform1f(F.loc.u_alfa, t.alfa);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        m.S = S; m.org = org; m.clave = clave; m.lleno = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      F.lista = true;
      if (entrando) mapa.triggerRepaint();
      est.foto = 'lista';
      est.fotoMs = performance.now() - t0; est.fotoVeces++;
    }

    function dibujar() {
      const t0 = performance.now();
      const s = mapa.style;
      const capaML = s.getLayer ? s.getLayer(op.capaML) : mapa.getLayer(op.capaML);
      const tm = (s.tileManagers || s.sourceCaches)[op.fuente];
      if (!capaML || !tm) throw new Error('falta la capa o la fuente');
      if (mapa.getLayoutProperty(op.capaML, 'visibility') === 'none') return;
      const ter = mapa.terrain || null;
      const sol = solActual();
      const p = paleta(sol.altura, sol.intensidad, sol.azimut, sol.aire, sol.escalaAireM);
      const cam = caminoCamara();

      gl.useProgram(prog);
      gl.uniform3fv(loc.u_luz, luzML());
      gl.uniform3fv(loc.u_calido, p.calido);
      gl.uniform3fv(loc.u_frio, p.frio);
      gl.uniform1f(loc.u_techo, p.techo);
      gl.uniform1f(loc.u_ao, p.ao);
      gl.uniform1f(loc.u_contacto, p.contacto);
      gl.uniform4fv(loc.u_bruma, p.bruma);
      gl.uniform2f(loc.u_lejos_m, op.lejos[0] * p.lejos[0], p.escalaM || op.lejos[1] * p.lejos[1]);
      gl.uniform1f(loc.u_encendidas, p.encendidas);
      gl.uniform1f(loc.u_con_terreno, ter ? 1 : 0);
      gl.uniform1i(loc.u_terrain, 3);
      gl.uniform4fv(loc.u_paleta, paletaGL);
      gl.uniform1i(loc.u_npaleta, nPaleta);
      gl.uniform3fv(loc.u_noche_mat, NOCHE_MATERIAL);
      // La foto de los techos: siempre hay una textura en las unidades 4 y 5 (aunque no se use).
      const conFoto = F.lista && F.mos.length === 2 && F.opacidad > 0;
      gl.uniform1f(loc.u_foto, conFoto ? F.opacidad : 0);
      gl.uniform4fv(loc.u_orto_ajuste, F.ajuste);
      gl.uniform2f(loc.u_foto_alto, FOTO_ALTO[0], FOTO_ALTO[1]);
      gl.uniform1i(loc.u_fotoC, 4);
      gl.uniform1i(loc.u_fotoL, 5);
      if (F.mos.length === 2) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, F.mos[0].tex);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, F.mos[1].tex);
      }
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
        // De unidades de esta tesela al mosaico de la foto: (x / EXT + c.x) / 2^z, menos el origen, entre el lado.
        for (let i = 0; i < 2; i++) {
          const m = F.mos[i];
          const u = i ? loc.u_uvL : loc.u_uvC;
          if (m) gl.uniform3f(u, 1 / (EXT * n2 * m.S), ((c.x / n2 + (coord.wrap || 0)) - m.org[0]) / m.S, (c.y / n2 - m.org[1]) / m.S);
          else gl.uniform3f(u, 0, -1, -1);
        }
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
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, null);
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

  const luzEdificios = { crear, paleta, tinte, deNoche, brumaHora, brumaHex, brumaAireHex, encendidas,
    pesoFoto, FOTO_ALTO, factorSaturacion, factorContraste, CASCADAS, origenCascada,
    indicePaleta, gruposPaleta, semilla, fachada, TIPOS_FACHADA, NOCHE_MATERIAL, hexRgb };
  if (typeof module === 'object' && module.exports) module.exports = luzEdificios;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.luzEdificios = luzEdificios;
  }
})(typeof window !== 'undefined' ? window : globalThis);
