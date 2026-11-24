'use strict';
// Capa propia de MapLibre (CustomLayerInterface, WebGL2) que dibuja la sombra de las
// construcciones de Catastro sobre el suelo. Paso 8 del plan de sombras
// (panel/sombras-DEBATE.md §2.3 y §3).
//
// Cómo trabaja:
//  * Lee las teselas z16 de la capa `construcciones` del mismo PMTiles del mapa. Las que el
//    mapa ya bajó las toma al vuelo (no se bajan dos veces); las de una tesela de margen
//    alrededor de la vista las pide aparte, para que no falte la sombra que entra desde fuera.
//  * Por tesela arma la geometría una sola vez con sombra-geom.js y la deja en la GPU.
//  * Mover el sol cambia dos uniformes (u_sombra y u_m_piso). Nada se recalcula en la CPU.
//  * Dos pasadas: núcleo a 2,5 m por piso y borde claro hasta 4,0 m por piso.
//  * Cada píxel de sombra se pinta una sola vez, aunque se crucen sombras de dos
//    construcciones: ver «Una sola mano por píxel» abajo.
//
// En 2D no usa internos de MapLibre: solo la API pública de capas propias
// (onAdd, render, defaultProjectionData.mainMatrix) y eventos del mapa. Con terreno (paso 9)
// lee además map.terrain (alto del suelo) y painter.depthRangeFor3D (rango de profundidad
// del terreno), que no son API pública: si cambian en otra versión, se sigue sin la prueba
// de profundidad.
(function (raiz) {
  const B = raiz.Bogotwin;
  const G = B.sombraGeom;
  const Z = 16;                 // zoom de las teselas de construcciones
  const BORDE = 80;             // buffer real de las teselas (metadatos y lectura: −80 a 4176)
  const CIRC = 40075016.686;
  const RAD = Math.PI / 180;

  const FRAGMENTO = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform vec2 u_desvanecer;  // m donde la sombra empieza y termina de apagarse con la distancia
in float v_lejos;
out vec4 color;
void main() { color = u_color * (1.0 - smoothstep(u_desvanecer.x, u_desvanecer.y, v_lejos)); }`;

  // Con terreno (paso 9): la sombra se pinta primero en un búfer aparte con mezcla MAX (cada
  // píxel queda con el alfa más alto, sin sumar) y luego ese búfer se pega sobre el mapa.
  const PEGAR_V = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const PEGAR_F = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec3 u_rgb;
uniform float u_intensidad;
in vec2 v_uv;
out vec4 color;
void main() {
  float a = texture(u_tex, v_uv).r * u_intensidad;
  color = vec4(u_rgb * a, a);
}`;

  // Color plano (DEBATE §Tema 11): #3b3a36, núcleo al 28 % y borde al 12 %. Premultiplicado,
  // porque MapLibre mezcla con (ONE, ONE_MINUS_SRC_ALPHA).
  function colorPre(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255 * a, ((n >> 8) & 255) / 255 * a, (n & 255) / 255 * a, a];
  }

  function compilar(gl, tipo, src) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('sombreador: ' + gl.getShaderInfoLog(s));
    return s;
  }

  // Tesela a pantalla en doble precisión: mainMatrix (Mercator 0..1, z en unidades
  // Mercator) por la matriz que lleva las unidades de la tesela a Mercator.
  function matrizTesela(M, z, x, y, ext, zMerc, salida) {
    const s = 1 / 2 ** z, a = s / ext, tx = x * s, ty = y * s;
    for (let f = 0; f < 4; f++) {
      salida[f] = M[f] * a;
      salida[4 + f] = M[4 + f] * a;
      salida[8 + f] = M[8 + f] * zMerc;
      salida[12 + f] = M[f] * tx + M[4 + f] * ty + M[12 + f];
    }
    return salida;
  }

  // Centro de un punto de la tesela (unidades de tesela) en lon/lat.
  function aLonLat(z, x, y, ext, px, py) {
    const n = 2 ** z;
    const lon = (x + px / ext) / n * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / ext) / n))) / RAD;
    return [lon, lat];
  }

  function lonATeselaX(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
  function latATeselaY(lat, z) {
    const s = Math.sin(lat * RAD);
    return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z);
  }

  // opciones: { pmtiles (instancia de pmtiles.PMTiles del archivo de Catastro), capaFuente
  //   ('construcciones'), id, margen (teselas, 1), maxTeselas (64), dedup (true),
  //   alActualizar(estado) }
  function crear(opciones) {
    const op = Object.assign({ id: 'sombras', capaFuente: 'construcciones', margen: 1, maxTeselas: 64, dedup: true, zoomTerreno: 16,
      alzarProfundidad: 3, desfase: [-8, -16], nucleo: 2.5, borde: 4.0, color: '#3b3a36', alfaNucleo: 0.28, alfaBorde: 0.12,
      desvanecer: [260, 620] }, opciones);
    let mapa = null, gl = null, prog = null, loc = null;
    let sombra = null;            // [m al oriente, m al norte] por m de alto, o null (sol bajo)
    const teselas = new Map();    // "x/y" → { x, y, vao, bufs, n, tipoIdx, unidadesM, listo }
    const crudas = new Map();     // "x/y" → bytes recibidos del protocolo, por procesar
    const pedidas = new Set();
    const cola = [];
    let procesando = false;
    let fijo = false;             // modo de prueba sintética: no se piden ni sueltan teselas
    const est = { teselas: 0, vertices: 0, bytesGPU: 0, msArmado: 0, armadas: 0, ultimaMsRender: 0, dibujadas: 0, sinWebGL2: false };
    const matriz = new Float32Array(16), m64 = new Float64Array(16);
    let intensidad = 1;           // 0,5 con cielo cubierto (paso 10)
    let cNucleo = colorPre(op.color, op.alfaNucleo), cBorde = colorPre(op.color, op.alfaBorde);
    const rearmar = new Set();    // teselas que se vuelven a armar (cambió el terreno)
    // Búfer aparte para el camino con terreno.
    const fb = { fbo: null, tex: null, prof: null, ancho: 0, alto: 0, prog: null, vao: null, loc: null, sinCopia: false };

    function avisar() {
      est.pendientes = cola.length + pedidas.size;
      if (op.alActualizar) op.alActualizar(est);
    }

    // Bytes de una tesela que ya bajó el mapa (los entrega el protocolo envuelto).
    function recibir(z, x, y, bytes) {
      if (z !== Z) return;
      const k = x + '/' + y;
      if (teselas.has(k) || crudas.has(k)) return;
      crudas.set(k, bytes);
      if (necesarias().has(k)) encolar(k);
    }

    function necesarias() {
      const fuera = new Set();
      if (!mapa || mapa.getZoom() < Z) return fuera;
      const b = mapa.getBounds();
      const x0 = lonATeselaX(b.getWest(), Z) - op.margen, x1 = lonATeselaX(b.getEast(), Z) + op.margen;
      const y0 = latATeselaY(b.getNorth(), Z) - op.margen, y1 = latATeselaY(b.getSouth(), Z) + op.margen;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fuera.add(x + '/' + y);
      return fuera;
    }

    function encolar(k) {
      if ((teselas.has(k) && !rearmar.has(k)) || cola.includes(k)) return;
      cola.push(k);
      if (!procesando) { procesando = true; setTimeout(trabajar, 0); }
    }

    // Arma teselas sin trabar el cuadro: hasta 8 ms por turno.
    async function trabajar() {
      const t0 = performance.now();
      while (cola.length && performance.now() - t0 < 8) {
        const k = cola.shift();
        if (rearmar.has(k)) {
          rearmar.delete(k);
          const t = teselas.get(k);
          if (t) armarLista(k, t.lista, t.ext);
          continue;
        }
        if (teselas.has(k)) continue;
        let bytes = crudas.get(k);
        if (!bytes) {
          if (pedidas.has(k)) continue;
          pedidas.add(k);
          const [x, y] = k.split('/').map(Number);
          op.pmtiles.getZxy(Z, x, y).then((r) => {
            pedidas.delete(k);
            crudas.set(k, r && r.data ? new Uint8Array(r.data) : new Uint8Array(0));
            if (necesarias().has(k)) encolar(k);
          }).catch(() => { pedidas.delete(k); });
          continue;
        }
        crudas.delete(k);
        armarTesela(k, bytes);
      }
      if (cola.length) setTimeout(trabajar, 0);
      else procesando = false;
      avisar();
      if (mapa) mapa.triggerRepaint();
    }

    function armarTesela(k, bytes) {
      const capa = bytes.length ? B.mvt.leerCapa(bytes, op.capaFuente) : null;
      const ext = capa ? capa.extension : G.EXTENSION;
      const lista = capa ? capa.objetos.map((o) => ({ anillos: o.anillos, pisos: o.propiedades.pisos })) : [];
      armarLista(k, lista, ext);
    }

    // Con terreno, cada construcción apoya su sombra en el plano de su centroide más 0,3 m
    // (paso 9). El terreno devuelve 0 mientras no tiene la tesela de relieve: esa tesela de
    // sombra queda «pendiente» y se vuelve a armar cuando el mapa quede quieto.
    function ponerElevacion(lista, x, y, ext) {
      const ter = mapa && mapa.terrain;
      let pendiente = false;
      for (const c of lista) {
        if (!ter) { c.elevacion = 0; continue; }
        const anillos = (c.anillos || []).filter((r) => r.length >= 3);
        if (!anillos.length) { c.elevacion = 0; continue; }
        const [cx, cy] = G.centroide(anillos);
        const [lon, lat] = aLonLat(Z, x, y, ext, cx, cy);
        const h = ter.getElevationForLngLatZoom(new raiz.maplibregl.LngLat(lon, lat), op.zoomTerreno);
        if (!h) pendiente = true;
        c.elevacion = h + 0.3;
      }
      return { conTerreno: !!ter, pendiente };
    }

    function armarLista(k, lista, ext) {
      const [x, y] = k.split('/').map(Number);
      const t0 = performance.now();
      const ter = ponerElevacion(lista, x, y, ext);
      const geom = G.armar(lista, { extension: ext, borde: BORDE * ext / 4096 });
      est.msArmado += performance.now() - t0;
      est.armadas++;
      const previa = teselas.get(k);
      const intentos = previa && previa.pendiente && ter.pendiente ? (previa.intentos || 0) + 1 : 0;
      soltar(k);
      const t = { x, y, ext, n: geom.indices.length, vao: null, bufs: [], tipoIdx: 0, lista,
        conTerreno: ter.conTerreno, pendiente: ter.pendiente, intentos,
        unidadesM: G.unidadesPorMetro(Z, G.latitudTesela(Z, y), ext),
        zMerc: 1 / (CIRC * Math.cos(G.latitudTesela(Z, y) * RAD)), bytes: geom.vertices.byteLength + geom.indices.byteLength,
        vertices: geom.vertices.length / geom.zancada, maxPisos: pisosMax(lista) };
      if (t.n && gl) {
        t.vao = gl.createVertexArray();
        gl.bindVertexArray(t.vao);
        const vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
        const paso = geom.zancada * 4;
        gl.enableVertexAttribArray(loc.a_pos); gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, paso, 0);
        gl.enableVertexAttribArray(loc.a_corre); gl.vertexAttribPointer(loc.a_corre, 1, gl.FLOAT, false, paso, 8);
        gl.enableVertexAttribArray(loc.a_pisos); gl.vertexAttribPointer(loc.a_pisos, 1, gl.FLOAT, false, paso, 12);
        gl.enableVertexAttribArray(loc.a_elev); gl.vertexAttribPointer(loc.a_elev, 1, gl.FLOAT, false, paso, 16);
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        t.bufs = [vb, ib];
        t.tipoIdx = geom.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      }
      teselas.set(k, t);
      contar();
    }

    function pisosMax(lista) {
      let m = 1;
      for (const c of lista) m = Math.max(m, Number(c.pisos) || 1);
      return m;
    }

    // ¿La sombra de esta tesela cae en la vista? La tesela más su sombra más larga
    // (pisos máximos × 4,0 m), contra la vista en coordenadas de tesela z16.
    function enVista(t, v) {
      const largo = t.maxPisos * op.borde * t.unidadesM / t.ext;
      const dx = sombra[0] * largo, dy = -sombra[1] * largo;
      const x0 = t.x + Math.min(0, dx), x1 = t.x + 1 + Math.max(0, dx);
      const y0 = t.y + Math.min(0, dy), y1 = t.y + 1 + Math.max(0, dy);
      return x1 >= v[0] && x0 <= v[1] && y1 >= v[2] && y0 <= v[3];
    }

    function vistaZ16() {
      const b = mapa.getBounds(), n = 2 ** Z;
      const fy = (lat) => { const s = Math.sin(lat * RAD); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n; };
      return [(b.getWest() + 180) / 360 * n, (b.getEast() + 180) / 360 * n, fy(b.getNorth()), fy(b.getSouth())];
    }

    function soltar(k) {
      const t = teselas.get(k);
      if (!t) return;
      if (gl) { if (t.vao) gl.deleteVertexArray(t.vao); for (const b of t.bufs) gl.deleteBuffer(b); }
      teselas.delete(k);
    }

    function contar() {
      est.teselas = teselas.size;
      est.vertices = 0; est.bytesGPU = 0;
      for (const t of teselas.values()) { est.vertices += t.vertices; est.bytesGPU += t.bytes; }
    }

    // Al quedar quieto el mapa: pide lo que falta y suelta lo que quedó muy lejos.
    function alQuedarQuieto() {
      if (fijo) return;
      const nec = necesarias();
      // Teselas armadas con otro estado del terreno, o que esperaban el relieve.
      const conTerreno = !!(mapa && mapa.terrain);
      for (const [k, t] of teselas) {
        if (t.lista && (t.conTerreno !== conTerreno || (conTerreno && t.pendiente && t.intentos < 6)) && nec.has(k)) { rearmar.add(k); encolar(k); }
      }
      for (const k of nec) encolar(k);
      if (teselas.size > op.maxTeselas) {
        for (const k of [...teselas.keys()]) if (!nec.has(k)) { soltar(k); rearmar.delete(k); }
      }
      for (const k of [...crudas.keys()]) if (!nec.has(k)) crudas.delete(k);
      contar();
      avisar();
    }

    const capa = {
      id: op.id,
      type: 'custom',
      renderingMode: '2d',
      onAdd(m, contexto) {
        mapa = m;
        gl = contexto;
        if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
          est.sinWebGL2 = true; gl = null; avisar(); return;
        }
        prog = gl.createProgram();
        gl.attachShader(prog, compilar(gl, gl.VERTEX_SHADER, G.VERTICE_GLSL));
        gl.attachShader(prog, compilar(gl, gl.FRAGMENT_SHADER, FRAGMENTO));
        ['a_pos', 'a_corre', 'a_pisos', 'a_elev'].forEach((n, i) => gl.bindAttribLocation(prog, i, n));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(prog));
        loc = { a_pos: 0, a_corre: 1, a_pisos: 2, a_elev: 3 };
        for (const u of ['u_matriz', 'u_sombra', 'u_m_piso', 'u_unidades_m', 'u_color', 'u_alzar', 'u_camara', 'u_desvanecer']) loc[u] = gl.getUniformLocation(prog, u);
        fb.prog = gl.createProgram();
        gl.attachShader(fb.prog, compilar(gl, gl.VERTEX_SHADER, PEGAR_V));
        gl.attachShader(fb.prog, compilar(gl, gl.FRAGMENT_SHADER, PEGAR_F));
        gl.linkProgram(fb.prog);
        if (!gl.getProgramParameter(fb.prog, gl.LINK_STATUS)) throw new Error('programa pegar: ' + gl.getProgramInfoLog(fb.prog));
        fb.loc = { u_tex: gl.getUniformLocation(fb.prog, 'u_tex'), u_rgb: gl.getUniformLocation(fb.prog, 'u_rgb'), u_intensidad: gl.getUniformLocation(fb.prog, 'u_intensidad') };
        fb.vao = gl.createVertexArray();
        mapa.on('idle', alQuedarQuieto);
        mapa.on('moveend', alQuedarQuieto);
      },
      onRemove() {
        for (const k of [...teselas.keys()]) soltar(k);
        if (gl && prog) gl.deleteProgram(prog);
        if (gl && fb.prog) gl.deleteProgram(fb.prog);
        if (gl) { if (fb.vao) gl.deleteVertexArray(fb.vao); if (fb.fbo) gl.deleteFramebuffer(fb.fbo); if (fb.tex) gl.deleteTexture(fb.tex); if (fb.prof) gl.deleteRenderbuffer(fb.prof); }
        Object.assign(fb, { fbo: null, tex: null, prof: null, ancho: 0, alto: 0, prog: null, vao: null });
        if (mapa) { mapa.off('idle', alQuedarQuieto); mapa.off('moveend', alQuedarQuieto); }
        mapa = null; gl = null;
      },
      render(glr, args) {
        if (!gl || !sombra || mapa.getZoom() < Z || !teselas.size) return;
        const t0 = performance.now();
        gl.useProgram(prog);
        gl.uniform2f(loc.u_sombra, sombra[0], sombra[1]);
        gl.uniform1f(loc.u_alzar, mapa.terrain ? op.alzarProfundidad : 0);
        if (mapa.terrain) { dibujarConTerreno(args); est.ultimaMsRender = performance.now() - t0; return; }
        est.camino = '2d';
        // Una sola mano por píxel. El stencil de MapLibre guarda las máscaras de recorte de
        // las teselas y las reusa entre capas de la misma fuente (painter.ts,
        // _renderTileClippingMasks con currentStencilSource): escribir en él desde una capa
        // propia puede dañar la capa siguiente. Por eso usamos el búfer de profundidad, que
        // MapLibre deja para esta capa con un rango fijo [d, d] (getDepthModeForSublayer):
        // todos nuestros fragmentos tienen la misma profundidad d, y con LESS el primero que
        // cae en un píxel lo marca y los demás se descartan. Hace lo mismo que el stencil
        // (cada píxel una vez, núcleo antes que borde) y, de paso, la sombra no se pinta
        // sobre las construcciones opacas que van encima.
        if (op.dedup) {
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LESS);
          gl.depthMask(true);
        } else {
          gl.disable(gl.DEPTH_TEST);
        }
        gl.disable(gl.STENCIL_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        dibujarPasadas(args, [[op.nucleo, cNucleo], [op.borde, cBorde]]);
        gl.bindVertexArray(null);
        est.ultimaMsRender = performance.now() - t0;
      }
    };

    // Núcleo de todas las teselas primero, luego el borde: así el borde no pisa el núcleo
    // de una tesela vecina.
    function dibujarPasadas(args, pasadas) {
        const M = args.defaultProjectionData.mainMatrix;
        // Solo las teselas cuya sombra cae en la vista (las de margen casi nunca).
        const vista = vistaZ16();
        const visibles = [];
        for (const t of teselas.values()) if (t.n && enVista(t, vista)) visibles.push(t);
        est.dibujadas = visibles.length;
        // Con terreno la cámara va casi a ras de calle: la sombra lejana, vista de canto, se
        // vuelve rayas grises hasta el horizonte. Se apaga con la distancia al suelo bajo la
        // cámara (op.desvanecer, en m). En 2D no se apaga.
        const cam = mapa.terrain && op.desvanecer ? sueloBajoCamara() : null;
        const n2 = 2 ** Z;
        gl.uniform2f(loc.u_desvanecer, cam ? op.desvanecer[0] : 1e9, cam ? op.desvanecer[1] : 2e9);
        for (const [mPiso, color] of pasadas) {
          gl.uniform1f(loc.u_m_piso, mPiso);
          gl.uniform4fv(loc.u_color, color);
          for (const t of visibles) {
            matrizTesela(M, Z, t.x, t.y, t.ext, t.zMerc, m64);
            matriz.set(m64);
            gl.uniformMatrix4fv(loc.u_matriz, false, matriz);
            gl.uniform1f(loc.u_unidades_m, t.unidadesM);
            gl.uniform2f(loc.u_camara, cam ? (cam.x * n2 - t.x) * t.ext : 0, cam ? (cam.y * n2 - t.y) * t.ext : 0);
            gl.bindVertexArray(t.vao);
            gl.drawElements(gl.TRIANGLES, t.n, t.tipoIdx, 0);
          }
        }
    }

    // Suelo bajo la cámara en Mercator (0 a 1). transform.getCameraLngLat no es API pública:
    // si falta, se usa el centro del mapa (la sombra se apaga igual, solo más adelante).
    function sueloBajoCamara() {
      const t = mapa.transform;
      let ll = null;
      try { ll = t && t.getCameraLngLat ? t.getCameraLngLat() : null; } catch (e) { ll = null; }
      return raiz.maplibregl.MercatorCoordinate.fromLngLat(ll || mapa.getCenter());
    }

    function prepararBufer(w, h) {
      if (fb.fbo && fb.ancho === w && fb.alto === h) return;
      if (!fb.fbo) { fb.fbo = gl.createFramebuffer(); fb.tex = gl.createTexture(); fb.prof = gl.createRenderbuffer(); }
      fb.ancho = w; fb.alto = h;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fb.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER, fb.prof);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fb.tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, fb.prof);
    }

    // Paso 9. Tres cosas:
    //  1. Se copia la profundidad que ya dejó el terreno en el búfer aparte, para que un cerro
    //     tape la sombra que queda detrás (y la parte de la sombra que en una loma queda bajo
    //     el suelo). Si el equipo no deja copiarla, se sigue sin esa prueba (est.sinCopia).
    //  2. La sombra se pinta en ese búfer con mezcla MAX: donde se cruzan dos, el tono es el
    //     mismo, sin sumar (lo mismo que hace la profundidad en el camino 2D).
    //  3. El búfer se pega sobre el mapa con el gris de la sombra y la intensidad de las nubes.
    function dibujarConTerreno(args) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const previo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      prepararBufer(w, h);
      let conProf = !fb.sinCopia && !op.sinProfundidad;
      if (conProf) {
        while (gl.getError() !== gl.NO_ERROR) { /* limpiar errores viejos */ }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb.fbo);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        if (gl.getError() !== gl.NO_ERROR) { fb.sinCopia = true; est.sinCopia = true; conProf = false; }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
      gl.viewport(0, 0, w, h);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (conProf) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        const r = mapa.painter && mapa.painter.depthRangeFor3D;
        gl.depthRange(0, r ? r[1] : 1);
        if (op.desfase) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(op.desfase[0], op.desfase[1]); }
      } else {
        gl.disable(gl.DEPTH_TEST);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      const a = (x) => [x, x, x, x];
      dibujarPasadas(args, [[op.nucleo, a(op.alfaNucleo)], [op.borde, a(op.alfaBorde)]]);
      if (op.medir) est.pixeles = contarPixeles(w, h);
      // Pegar sobre el mapa.
      gl.bindFramebuffer(gl.FRAMEBUFFER, previo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthRange(0, 1);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(fb.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fb.tex);
      gl.uniform1i(fb.loc.u_tex, 0);
      const n = parseInt(op.color.slice(1), 16);
      gl.uniform3f(fb.loc.u_rgb, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      gl.uniform1f(fb.loc.u_intensidad, intensidad);
      gl.bindVertexArray(fb.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      est.camino = conProf ? 'terreno' : 'terreno-sin-profundidad';
    }

    // Solo para pruebas (opción medir): cuántos píxeles de sombra quedaron en el búfer.
    function contarPixeles(w, h) {
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]) n++;
      return n;
    }

    return {
      capa,
      recibir,
      estado: est,
      // sol: { altura, azimut } de sol.js. Solo cambia uniformes.
      fijarSol(sol) {
        sombra = G.vectorSombra(sol);
        if (mapa) mapa.triggerRepaint();
        return sombra;
      },
      // 1 con sol directo; 0,5 con cielo cubierto según el METAR (paso 10).
      fijarIntensidad(f) {
        intensidad = Math.min(1, Math.max(0, Number(f)));
        cNucleo = colorPre(op.color, op.alfaNucleo * intensidad);
        cBorde = colorPre(op.color, op.alfaBorde * intensidad);
        if (mapa) mapa.triggerRepaint();
      },
      // Para pruebas: con terreno, sin la prueba de profundidad.
      fijarOpcion(k, v) { op[k] = v; if (mapa) mapa.triggerRepaint(); },
      // Vuelve a armar ya las teselas con el terreno de ahora (al prender o apagar el 3D).
      rearmarTodo() { for (const k of teselas.keys()) { rearmar.add(k); encolar(k); } },
      teselas,
      // Para pruebas: arma una tesela con construcciones dadas en lon/lat.
      agregarPrueba(k, construcciones, z, x, y) {
        const geom = G.armar(construcciones, { lonlat: { z, x, y }, quitarCortes: false });
        if (z !== Z) throw new Error('solo z16');
        // Reusa el camino normal: se arma a partir de la geometría ya hecha.
        const t = { x, y, ext: G.EXTENSION, n: geom.indices.length, vao: null, bufs: [], tipoIdx: 0,
          unidadesM: G.unidadesPorMetro(Z, G.latitudTesela(Z, y)), zMerc: 1 / (CIRC * Math.cos(G.latitudTesela(Z, y) * RAD)),
          bytes: geom.vertices.byteLength + geom.indices.byteLength, vertices: geom.vertices.length / geom.zancada,
          maxPisos: pisosMax(construcciones) };
        t.vao = gl.createVertexArray();
        gl.bindVertexArray(t.vao);
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
        const paso = geom.zancada * 4;
        [['a_pos', 2, 0], ['a_corre', 1, 8], ['a_pisos', 1, 12], ['a_elev', 1, 16]].forEach(([n, c, o]) => {
          gl.enableVertexAttribArray(loc[n]); gl.vertexAttribPointer(loc[n], c, gl.FLOAT, false, paso, o);
        });
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        t.bufs = [vb, ib];
        t.tipoIdx = geom.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        soltar(k);
        teselas.set(k, t);
        contar();
        avisar();
        mapa.triggerRepaint();
      },
      soloPrueba() { fijo = true; for (const k of [...teselas.keys()]) soltar(k); cola.length = 0; crudas.clear(); op.margen = -999; }
    };
  }

  B.sombrasCapa = { crear, matrizTesela };
})(window);
