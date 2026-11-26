'use strict';
// Hitos 3D en la vista «Cómo se ve»: la Torre Colpatria, la Catedral Primada, el Capitolio y la
// Plaza de toros La Santamaría con su forma, en vez de la caja de Catastro.
//
// Qué es cada modelo lo dice hitos/catalogo.json y el archivo de procedencia de cada uno. Hoy
// todos están modelados en código a partir de la huella de Catastro y de un alto con fuente
// pública (pipelines/hitos/modelar.js): son un supuesto ilustrativo, no una medida. El lector
// también abre modelos de fotogrametría (GLB con textura) para cuando haya uno libre.
//
// Cómo trabaja: una capa propia de MapLibre en 3D (comparte la profundidad con los edificios).
// Solo baja el modelo de un hito cuando la cámara está a menos de 2 km y el zoom es 14 o más.
// El suelo sale del relieve (queryTerrainElevation) en el centro y el contorno del hito: el más
// bajo, y los muros bajan 6 m más, así nada queda flotando en una ladera. La luz es la misma de
// edificios-luz.js (cara al sol cálida, a la sombra fría, pie oscuro, bruma de lejos).
// Mientras el modelo se dibuja, la caja de Catastro de ese edificio se esconde
// (cajas-ocultas.js); si el modelo se va, la caja vuelve.
//
// No echa sombra propia: las sombras del mapa (sombras-capa.js) salen de las teselas de
// Catastro, así que bajo el hito sigue la sombra de la caja (más corta en la Colpatria).
//
// Si no hay WebGL2, si falta el catálogo o algo falla al dibujar, la capa se quita sola, las
// cajas vuelven y el visor queda como antes.
(function (raiz) {
  const CIRC = 40075016.686;
  const RAD = Math.PI / 180;
  const R_TIERRA = 6378137;

  // ── Piezas puras (se prueban en Node) ───────────────────────────────────

  // Lee un GLB (glTF 2.0 binario). Devuelve las partes de dibujo (un primitivo de triángulos
  // cada una) con sus atributos tal como vienen: { pos, nor, col, uv, idx, imagen }.
  // No aplica las transformaciones de los nodos: los modelos del catálogo vienen ya en metros,
  // con y arriba y el origen en el suelo del hito.
  const COMPONENTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const TIPOS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  function leerGlb(buf) {
    const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv = new DataView(ab);
    if (ab.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('no es un GLB');
    if (dv.getUint32(4, true) !== 2) throw new Error('GLB de una versión que no es la 2');
    let p = 12, json = null, bin = null;
    while (p + 8 <= ab.byteLength) {
      const largo = dv.getUint32(p, true), tipo = dv.getUint32(p + 4, true);
      const datos = new Uint8Array(ab, p + 8, largo);
      if (tipo === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(datos));
      else if (tipo === 0x004e4942) bin = datos;
      p += 8 + largo;
    }
    if (!json) throw new Error('GLB sin JSON');
    const vista = (i) => {
      const v = json.bufferViews[i];
      if (!bin || v.buffer !== 0) throw new Error('GLB con datos fuera del archivo');
      return { off: bin.byteOffset + (v.byteOffset || 0), largo: v.byteLength, paso: v.byteStride || 0 };
    };
    function accesor(i) {
      if (i === undefined) return null;
      const a = json.accessors[i];
      const T = TIPOS[a.componentType], n = COMPONENTES[a.type];
      if (!T || !n || a.bufferView === undefined || a.sparse) throw new Error('accesor que este lector no abre');
      const v = vista(a.bufferView);
      const tam = T.BYTES_PER_ELEMENT, ini = v.off + (a.byteOffset || 0);
      let datos;
      if (!v.paso || v.paso === n * tam) {
        if (ini % tam) datos = new T(ab.slice(ini, ini + a.count * n * tam));
        else datos = new T(ab, ini, a.count * n);
      } else {
        datos = new T(a.count * n);
        const src = new DataView(ab);
        const get = { 1: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32', 5120: 'getInt8' }[a.componentType];
        for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) datos[k * n + c] = src[get](ini + k * v.paso + c * tam, true);
      }
      return { datos, n, tipo: a.componentType, normalizado: !!a.normalized, min: a.min, max: a.max };
    }
    function imagenDe(material) {
      const m = json.materials && json.materials[material];
      const t = m && m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
      if (!t || !json.textures) return null;
      const im = json.images && json.images[json.textures[t.index].source];
      if (!im || im.bufferView === undefined) return null;
      const v = vista(im.bufferView);
      return { bytes: new Uint8Array(ab, v.off, v.largo), mime: im.mimeType || 'image/jpeg' };
    }
    const partes = [];
    for (const malla of json.meshes || []) {
      for (const pr of malla.primitives) {
        if (pr.mode !== undefined && pr.mode !== 4) continue;
        const at = pr.attributes;
        const pos = accesor(at.POSITION);
        if (!pos || pos.n !== 3 || pos.tipo !== 5126) throw new Error('posiciones que no son float32');
        let idx = accesor(pr.indices);
        if (!idx) { const d = new Uint32Array(pos.datos.length / 3); for (let i = 0; i < d.length; i++) d[i] = i; idx = { datos: d, n: 1, tipo: 5125 }; }
        let nor = accesor(at.NORMAL);
        if (!nor) nor = { datos: normales(pos.datos, idx.datos), n: 3, tipo: 5126 };
        partes.push({ pos, nor, col: accesor(at.COLOR_0), uv: accesor(at.TEXCOORD_0), idx, imagen: imagenDe(pr.material) });
      }
    }
    if (!partes.length) throw new Error('GLB sin triángulos');
    return { partes, asset: json.asset || {}, extras: json.extras || null };
  }

  // Normales por vértice (promedio de las caras) para los modelos que no las traen.
  function normales(pos, idx) {
    const n = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
      const a = 3 * idx[i], b = 3 * idx[i + 1], c = 3 * idx[i + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const L = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= L; n[i + 1] /= L; n[i + 2] /= L;
    }
    return n;
  }

  function triangulos(glb) { return glb.partes.reduce((s, p) => s + p.idx.datos.length / 3, 0); }

  // Distancia en metros entre dos puntos cercanos (plano local; sobra para 2 km).
  function distanciaM(lon1, lat1, lon2, lat2) {
    const k = R_TIERRA * RAD;
    return Math.hypot((lon2 - lon1) * k * Math.cos((lat1 + lat2) / 2 * RAD), (lat2 - lat1) * k);
  }

  // Hitos a menos de radio metros de (lon, lat), del más cercano al más lejano.
  function cercanos(hitos, lon, lat, radio) {
    return hitos.map((h) => ({ h, d: distanciaM(lon, lat, h.lon, h.lat) })).filter((x) => x.d <= radio)
      .sort((a, b) => a.d - b.d).map((x) => x.h);
  }

  // Del modelo (metros: x este, y arriba, z sur, origen en el suelo del hito) al espacio de
  // recorte, con la matriz de MapLibre (que toma Mercator de 0 a 1 y la altura en las mismas
  // unidades). La traslación se suma en doble precisión, como en arboles.js.
  function matrizModelo(M, mx, my, sueloM, s, salida) {
    const o = salida || new Float64Array(16);
    for (let f = 0; f < 4; f++) {
      o[f] = M[f] * s;                  // x (este) → Mercator x
      o[4 + f] = M[8 + f] * s;          // y (arriba) → altura
      o[8 + f] = M[4 + f] * s;          // z (sur) → Mercator y
      o[12 + f] = M[f] * mx + M[4 + f] * my + M[8 + f] * sueloM * s + M[12 + f];
    }
    return o;
  }
  // Metros por unidad Mercator a esa latitud, al revés: unidades Mercator por metro.
  const mercPorMetro = (lat) => 1 / (CIRC * Math.cos(lat * RAD));

  // Punto del modelo a píxeles de pantalla (o null si queda detrás de la cámara).
  function aPantalla(F, x, y, z, ancho, alto) {
    const cx = F[0] * x + F[4] * y + F[8] * z + F[12];
    const cy = F[1] * x + F[5] * y + F[9] * z + F[13];
    const cw = F[3] * x + F[7] * y + F[11] * z + F[15];
    if (!(cw > 1e-6)) return null;
    return [(cx / cw + 1) / 2 * ancho, (1 - cy / cw) / 2 * alto];
  }

  // Envolvente convexa de puntos en la pantalla.
  function envolvente(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  function dentro(pt, r) {
    let d = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d;
    }
    return d;
  }

  // Silueta del hito en la pantalla: el contorno de su planta (metros este y norte) abajo y
  // arriba, proyectado, y su envolvente. null si el hito queda detrás de la cámara.
  function silueta(F, contorno, altoM, ancho, alto) {
    const pts = [];
    for (const [e, n] of contorno) for (const y of [0, altoM]) { const q = aPantalla(F, e, y, -n, ancho, alto); if (q) pts.push(q); }
    return pts.length >= 3 ? envolvente(pts) : null;
  }

  // Lo que dice la ventana al tocar el hito.
  function ficha(h) {
    const medido = h.tipo === 'fotogrametria';
    return {
      filas: [
        ['Hito', h.nombre],
        ['Modelo', medido ? 'fotogrametría (medido)' : 'modelado a partir de huella y altura (supuesto ilustrativo)'],
        ['Alto', h.altoTexto || (h.alto ? h.alto + ' m' : null)],
        ['Fuente', h.fuente]
      ],
      meta: { tipo: medido ? 'medido' : 'supuesto', fuente: h.autor || 'Bogotwin', licencia: h.licencia }
    };
  }

  const puro = { leerGlb, normales, triangulos, distanciaM, cercanos, matrizModelo, mercPorMetro, aPantalla, envolvente, dentro, silueta, ficha };
  if (typeof module === 'object' && module.exports) { module.exports = puro; return; }

  const B = raiz.Bogotwin = raiz.Bogotwin || {};

  const VERTICE = `#version 300 es
in vec3 a_pos;
in vec3 a_nor;
in vec4 a_col;
in vec2 a_uv;
uniform mat4 u_matriz;
uniform vec3 u_camara;     // suelo bajo la cámara, en metros del modelo
out vec3 v_base;
out vec3 v_n;
out float v_h;
out float v_lejos;
out vec2 v_uv;
void main() {
  // glTF: x este, y arriba, z sur. La luz de MapLibre viene en x este, y sur, z arriba.
  v_n = vec3(a_nor.x, a_nor.z, a_nor.y);
  v_h = a_pos.y;
  v_lejos = length(a_pos.xz - u_camara.xz);
  v_base = a_col.rgb;
  v_uv = a_uv;
  gl_Position = u_matriz * vec4(a_pos, 1.0);
}`;

  // La misma luz de edificios-luz.js, sin las ventanas dibujadas (el modelo trae su forma).
  const FRAGMENTO = `#version 300 es
precision highp float;
in vec3 v_base;
in vec3 v_n;
in float v_h;
in float v_lejos;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_con_tex;
uniform vec3 u_luz;
uniform vec3 u_calido;
uniform vec3 u_frio;
uniform float u_techo;
uniform float u_ao;
uniform float u_contacto;
uniform vec4 u_bruma;
uniform vec2 u_lejos_m;
uniform vec3 u_noche_mat;
uniform float u_noche;
out vec4 color;
void main() {
  vec3 L = normalize(u_luz);
  vec3 nn = normalize(v_n);
  bool techo = nn.z > 0.5;
  float cara, inc;
  if (techo) {
    cara = smoothstep(0.03, 0.3, L.z);
    inc = L.z;
  } else {
    // Las normales de las cajas de MapLibre (las que usa edificios-luz.js) miran hacia adentro y
    // la luz va con ellas; las del modelo miran hacia afuera: se dan vuelta para que la misma
    // luz deje la misma cara al sol.
    vec2 n = -normalize(nn.xy + vec2(1e-6));
    cara = smoothstep(-0.05, 0.2, dot(n, normalize(L.xy + vec2(1e-6))));
    inc = max(dot(vec3(n, 0.0), L), 0.0);
    if (nn.z < -0.5) cara = 0.0;    // caras que miran abajo (aleros): a la sombra
  }
  vec3 b = v_base;
  if (u_con_tex > 0.5) b = texture(u_tex, v_uv).rgb;
  float gris = dot(b, vec3(0.299, 0.587, 0.114));
  vec3 base = u_con_tex > 0.5 ? b : (techo ? mix(vec3(gris), b, 0.55) * 0.86 : mix(vec3(gris), b, 0.92));
  // De noche el material va hacia el gris de noche de mapa.js, como el de las cajas.
  base = mix(base, u_noche_mat, 0.85 * u_noche);
  vec3 c = base * mix(u_frio, u_calido * (0.88 + 0.14 * inc), cara);
  if (techo) c *= u_techo;
  else {
    float hs = max(v_h, 0.0);
    float pie = mix(u_ao, 1.0, sqrt(clamp(hs / 9.0, 0.0, 1.0)));
    float franja = 1.0 - smoothstep(0.25, 0.6, fwidth(v_h));
    pie *= 1.0 - u_contacto * franja * (1.0 - smoothstep(0.0, 1.5, hs));
    c *= pie;
  }
  c = mix(c, u_bruma.rgb, u_bruma.a * (1.0 - exp(-max(v_lejos - u_lejos_m.x, 0.0) / u_lejos_m.y)));
  color = vec4(min(c, vec3(1.0)), 1.0);
}`;

  const NOCHE_MATERIAL = [0x1c / 255, 0x22 / 255, 0x30 / 255];   // el de mapa.js y edificios-luz.js

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

  // opciones: { catalogo (URL de hitos/catalogo.json), radio (2000 m), zoomMin (14), alFallar }
  function crear(opciones) {
    const op = Object.assign({ id: 'hitos-3d', catalogo: 'hitos/catalogo.json', radio: 2000, soltar: 2600, zoomMin: 14,
      lejos: [250, 5000], credito: 'Hitos 3D: Bogotwin, con huellas de UAECD, Catastro Bogotá (CC BY 4.0)' }, opciones);
    let mapa = null, gl = null, pr = null, caida = false, catalogo = null, base = null;
    const hitos = new Map();   // id → { h, estado: 'bajando'|'listo', partes, suelo, intentos, F, visto }
    const est = { activa: false, error: null, cargados: 0, dibujados: 0, ms: 0, triangulos: 0, bytes: 0, ocultos: [] };
    const m32 = new Float32Array(16);

    function fallar(motivo) {
      if (caida) return;
      caida = true;
      est.error = String(motivo && motivo.message || motivo);
      try { if (op.alFallar) op.alFallar(est.error); } catch (e) { /* nada */ }
      const m = mapa;
      if (m) setTimeout(() => apagar(m), 0);
    }

    function solActual() {
      const S = B.solBarra && B.solBarra.estado;
      if (S && S.activo && S.sol) return { altura: S.sol.altura, azimut: S.sol.azimut, intensidad: S.ahora && S.cielo ? S.cielo.intensidad : 1, aire: S.brumaAire || 0, escalaAireM: S.escalaAireM || 0 };
      if (B.solArranque) return { altura: B.solArranque.altura, azimut: B.solArranque.azimut, intensidad: 1, aire: 0, escalaAireM: 0 };
      return { altura: 45, azimut: 180, intensidad: 1, aire: 0, escalaAireM: 0 };
    }
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
    function sueloBajoCamara() {
      const t = mapa.transform;
      let ll = null;
      try { ll = t && t.getCameraLngLat ? t.getCameraLngLat() : null; } catch (e) { ll = null; }
      return ll || mapa.getCenter();
    }

    const origen = (h) => 'hitos:' + h.id;

    // Suelo del hito: el más bajo del relieve en el centro y en el contorno. Si el catálogo trae
    // «sueloEn» (un piso plano del hito, como el ruedo de la plaza), el más alto de esos puntos:
    // así ese piso queda encima del relieve y los muros de abajo cubren la ladera. null si el
    // relieve de ese lugar todavía no llegó (se vuelve a intentar).
    function suelo(h) {
      if (!mapa.terrain) return 0;
      const k = R_TIERRA * RAD, kx = k * Math.cos(h.lat * RAD);
      const alto = Array.isArray(h.sueloEn) && h.sueloEn.length > 0;
      let r = alto ? -Infinity : Infinity;
      for (const [e, n] of alto ? h.sueloEn : [[0, 0]].concat(h.contorno || [])) {
        const v = mapa.queryTerrainElevation([h.lon + e / kx, h.lat + n / k]);
        if (v == null || !Number.isFinite(v) || v === 0) return null;
        r = alto ? Math.max(r, v) : Math.min(r, v);
      }
      return r;
    }

    function bajar(h) {
      const x = { h, estado: 'bajando', partes: null, suelo: null, intentos: 0, F: null };
      hitos.set(h.id, x);
      fetch(new URL(h.glb, base).href).then((r) => {
        if (!r.ok) throw new Error(h.glb + ': ' + r.status);
        return r.arrayBuffer();
      }).then((ab) => {
        if (!mapa || caida || hitos.get(h.id) !== x) return;
        const g = leerGlb(ab);
        x.partes = g.partes.map(subir);
        x.triangulos = triangulos(g);
        x.bytes = ab.byteLength;
        x.estado = 'listo';
        ponerSuelo(x);
        contar();
        mapa.triggerRepaint();
      }).catch((e) => {
        // Un hito que no baja no tumba la capa: se queda la caja de Catastro.
        console.warn('Hito 3D sin modelo:', h.id, e && e.message);
        if (hitos.get(h.id) === x) x.estado = 'falla';
      });
    }

    function ponerSuelo(x) {
      const s = suelo(x.h);
      if (s === null) { x.intentos++; return; }
      x.suelo = s;
      x.conTerreno = !!mapa.terrain;
      // Desde aquí el modelo se dibuja: la caja de Catastro se esconde.
      if (B.cajasOcultas && x.h.ocultar) B.cajasOcultas.agregar(origen(x.h), x.h.ocultar);
    }

    function subir(p) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const bufs = [];
      const atr = (i, a, porDefecto) => {
        if (!a) { gl.disableVertexAttribArray(i); gl.vertexAttrib4f(i, ...porDefecto); return; }
        const b = gl.createBuffer();
        bufs.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, a.datos, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, a.n, a.tipo, a.tipo !== 5126 && (a.normalizado || i === 2 || i === 3), 0, 0);
      };
      atr(0, p.pos);
      atr(1, p.nor);
      atr(2, p.col, [0.8, 0.8, 0.8, 1]);
      atr(3, p.uv, [0, 0, 0, 0]);
      const ib = gl.createBuffer();
      bufs.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.idx.datos, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const parte = { vao, bufs, n: p.idx.datos.length, tipoIdx: p.idx.tipo, tex: null };
      if (p.imagen && raiz.createImageBitmap) {
        raiz.createImageBitmap(new Blob([p.imagen.bytes], { type: p.imagen.mime }), { imageOrientation: 'none' }).then((im) => {
          if (!gl || caida) return;
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindTexture(gl.TEXTURE_2D, null);
          parte.tex = t;
          if (mapa) mapa.triggerRepaint();
        }).catch(() => {});
      }
      return parte;
    }

    function soltar(id) {
      const x = hitos.get(id);
      if (!x) return;
      if (gl && x.partes) for (const p of x.partes) {
        gl.deleteVertexArray(p.vao);
        for (const b of p.bufs) gl.deleteBuffer(b);
        if (p.tex) gl.deleteTexture(p.tex);
      }
      if (B.cajasOcultas) B.cajasOcultas.quitar(origen(x.h));
      hitos.delete(id);
    }

    function contar() {
      est.cargados = 0; est.triangulos = 0; est.bytes = 0;
      for (const x of hitos.values()) if (x.estado === 'listo') { est.cargados++; est.triangulos += x.triangulos; est.bytes += x.bytes; }
      est.ocultos = B.cajasOcultas ? B.cajasOcultas.origenes().filter((o) => o.startsWith('hitos:')) : [];
    }

    function alQuedarQuieto() {
      if (!mapa || caida || !catalogo) return;
      // Cerca de la cámara o del centro de la pantalla: con la vista muy inclinada la cámara
      // queda lejos de lo que se mira.
      const c = sueloBajoCamara(), m = mapa.getCenter();
      const dist = (h) => Math.min(distanciaM(c.lng, c.lat, h.lon, h.lat), distanciaM(m.lng, m.lat, h.lon, h.lat));
      const zoomOk = mapa.getZoom() >= op.zoomMin;
      const cerca = zoomOk ? catalogo.hitos.filter((h) => dist(h) <= op.radio) : [];
      for (const h of cerca) if (!hitos.has(h.id)) bajar(h);
      for (const [id, x] of [...hitos]) {
        const d = dist(x.h);
        if (!zoomOk || d > op.soltar) { soltar(id); continue; }
        // El relieve pudo llegar o cambiar (3D prendido o apagado): se vuelve a medir el suelo.
        if (x.estado === 'listo' && (x.suelo === null ? x.intentos < 20 : x.conTerreno !== !!mapa.terrain)) ponerSuelo(x);
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
          pr = programa(gl, VERTICE, FRAGMENTO, ['a_pos', 'a_nor', 'a_col', 'a_uv']);
          mapa.on('idle', alQuedarQuieto);
          mapa.on('moveend', alQuedarQuieto);
          alQuedarQuieto();
        } catch (e) { gl = null; fallar(e); }
      },
      onRemove() {
        for (const id of [...hitos.keys()]) soltar(id);
        if (gl && pr) gl.deleteProgram(pr.p);
        pr = null;
        if (mapa) { mapa.off('idle', alQuedarQuieto); mapa.off('moveend', alQuedarQuieto); }
        mapa = null; gl = null;
        contar();
      },
      render(glr, args) {
        if (!gl || caida || mapa.getZoom() < op.zoomMin || !hitos.size) return;
        const t0 = performance.now();
        try { dibujar(args); } catch (e) { fallar(e); }
        est.ms = performance.now() - t0;
      }
    };

    function dibujar(args) {
      const M = args.defaultProjectionData.mainMatrix;
      const luz = B.luzEdificios;
      const sol = solActual();
      const p = luz ? luz.paleta(sol.altura, sol.intensidad, sol.azimut, sol.aire, sol.escalaAireM) : null;
      const cam = raiz.maplibregl.MercatorCoordinate.fromLngLat(sueloBajoCamara());
      gl.useProgram(pr.p);
      const u = pr.u;
      gl.uniform3fv(u.u_luz, luzML());
      gl.uniform3fv(u.u_calido, p ? p.calido : [1, 1, 1]);
      gl.uniform3fv(u.u_frio, p ? p.frio : [0.55, 0.56, 0.58]);
      gl.uniform1f(u.u_techo, p ? p.techo : 1);
      gl.uniform1f(u.u_ao, p ? p.ao : 0.6);
      gl.uniform1f(u.u_contacto, p ? p.contacto : 0.2);
      gl.uniform4fv(u.u_bruma, p ? p.bruma : [0.78, 0.84, 0.9, 0.8]);
      gl.uniform2f(u.u_lejos_m, op.lejos[0] * (p ? p.lejos[0] : 1), (p && p.escalaM) || op.lejos[1] * (p ? p.lejos[1] : 1));
      gl.uniform3fv(u.u_noche_mat, NOCHE_MATERIAL);
      gl.uniform1f(u.u_noche, p ? p.noche : 0);
      gl.uniform1i(u.u_tex, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      est.dibujados = 0;
      for (const x of hitos.values()) {
        if (x.estado !== 'listo' || x.suelo === null) continue;
        const h = x.h;
        const mc = raiz.maplibregl.MercatorCoordinate.fromLngLat([h.lon, h.lat]);
        const s = mercPorMetro(h.lat);
        x.F = matrizModelo(M, mc.x, mc.y, x.suelo, s, x.F);
        m32.set(x.F);
        gl.uniformMatrix4fv(u.u_matriz, false, m32);
        gl.uniform3f(u.u_camara, (cam.x - mc.x) / s, 0, (cam.y - mc.y) / s);
        for (const q of x.partes) {
          gl.uniform1f(u.u_con_tex, q.tex ? 1 : 0);
          gl.bindTexture(gl.TEXTURE_2D, q.tex);
          gl.bindVertexArray(q.vao);
          gl.drawElements(gl.TRIANGLES, q.n, q.tipoIdx === 5125 ? gl.UNSIGNED_INT : q.tipoIdx === 5121 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, 0);
        }
        est.dibujados++;
      }
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.enable(gl.BLEND);
    }

    // Toque: el hito cuya silueta en la pantalla cubre el punto (el más cercano a la cámara).
    // Una capa propia no responde a queryRenderedFeatures; por eso se mira aquí. Devuelve lo
    // que va en la ventana ({ filas, meta, procedencia }) o null; la ventana la abre mapa.js.
    function tocar(e) {
      if (!mapa || caida || !est.activa) return null;
      const W = mapa.transform.width, H = mapa.transform.height;
      let mejor = null;
      for (const x of hitos.values()) {
        if (!x.F || x.estado !== 'listo' || x.suelo === null) continue;
        const sil = silueta(x.F, x.h.contorno || [[0, 0]], x.h.alto || 10, W, H);
        if (!sil || !dentro([e.point.x, e.point.y], sil)) continue;
        const w = x.F[15];   // distancia del pie del hito a la cámara (w del origen)
        if (!mejor || w < mejor.w) mejor = { x, w };
      }
      if (!mejor) return null;
      const h = mejor.x.h;
      return Object.assign(ficha(h), { hito: h, procedencia: h.procedencia ? new URL(h.procedencia, base).href : null });
    }

    function ponerCredito(m) {
      if (!m.getSource(op.id + '-credito')) m.addSource(op.id + '-credito', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: op.credito });
      if (!m.getLayer(op.id + '-credito')) m.addLayer({ id: op.id + '-credito', type: 'circle', source: op.id + '-credito' });
    }

    // Va justo después de los edificios (y de su luz), antes del tinte de la hora y de los
    // rótulos: así el tinte de edificios-luz.js también le llega al hito.
    function antesDe(m) {
      const ids = m.getStyle().layers.map((l) => l.id);
      for (const ref of ['luz-edificios', 'construcciones-3d']) {
        const i = ids.indexOf(ref);
        if (i >= 0 && ids[i + 1]) return ids[i + 1];
      }
      return m.getLayer('rotulos') ? 'rotulos' : undefined;
    }

    function prender(m) {
      if (caida || est.activa) return;
      base = raiz.location ? raiz.location.href : 'http://localhost/';
      const listo = catalogo ? Promise.resolve(catalogo) : fetch(new URL(op.catalogo, base).href).then((r) => {
        if (!r.ok) throw new Error('catálogo de hitos: ' + r.status);
        return r.json();
      });
      listo.then((c) => {
        if (caida || est.activa) return;
        catalogo = c;
        try {
          ponerCredito(m);
          m.addLayer(capa, antesDe(m));
          est.activa = true;
        } catch (e) { fallar(e); }
      }).catch(fallar);
    }

    function apagar(m) {
      est.activa = false;
      try {
        if (m.getLayer(op.id)) m.removeLayer(op.id);
        if (m.getLayer(op.id + '-credito')) m.removeLayer(op.id + '-credito');
        if (m.getSource(op.id + '-credito')) m.removeSource(op.id + '-credito');
      } catch (e) { /* el mapa ya no está */ }
      // Por si la capa nunca llegó a quitarse: ninguna caja queda escondida.
      if (B.cajasOcultas) for (const o of B.cajasOcultas.origenes()) if (o.startsWith('hitos:')) B.cajasOcultas.quitar(o);
      contar();
    }

    return { prender, apagar, tocar, estado: est, catalogo: () => catalogo };
  }

  B.hitos3d = Object.assign({ crear }, puro);
})(typeof window !== 'undefined' ? window : globalThis);
