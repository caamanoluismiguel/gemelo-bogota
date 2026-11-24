'use strict';
// Barra del sol y sombras de los edificios en el mapa (pasos 10, 11 y 12 del plan de
// sombras, panel/sombras-DEBATE.md §3, y panel/sombras-ux.md). La carga mapa.js solo cuando
// alguien prende «Sombras de los edificios».
//
// Qué hace:
//  * «Ahora»: el sol de este minuto en hora de Bogotá, recalculado cada minuto, con las nubes
//    del METAR (cubierto en las dos estaciones o lluvia: sombra a media intensidad).
//  * Hora (5:30 a. m. a 6:30 p. m., de 5 en 5 minutos) y día del año: eligen otro momento.
//  * Con 3D, la luz de los edificios y del relieve viene del sol (paso 11).
//  * La fila de la sombra en la ventana de cada construcción (paso 12).
//  * El velo de la sombra de los cerros (paso 6): la rejilla de horizonte se baja la primera vez
//    que hace falta (con 3D, o con el sol bajo) y se pinta en un lienzo, fuente `canvas`.
//  * La URL guarda ?sombras=1 y, fuera de «Ahora», &sol=AAAA-MM-DDTHH:MM.
(function (raiz) {
  const B = raiz.Bogotwin;
  const SOL = B.sol, G = B.sombraGeom, T = B.solTexto, HZ = B.horizonte;
  const LAT = 4.6097, LON = -74.0817;            // centro de Bogotá, el mismo de sol.prueba.js
  const ZOOM_SOMBRA = 16;
  const LUZ_FIJA = { anchor: 'viewport', color: '#ffffff', intensity: 0.5, position: [1.15, 210, 30] };
  const RELIEVE_FIJO = 315;                       // luz del noroccidente, la de siempre
  const ALFA_2D = [0.28, 0.12], ALFA_3D = [0.6, 0.26];   // núcleo y borde de la sombra
  const VELO_OPACIDAD = 0.25;                     // gris de la sombra de los cerros (supuesto)
  const LEJOS_SIN_VELO = 'Las sombras se ven de cerca, calle por calle.';
  const LEJOS_CON_VELO = 'De lejos ves la sombra de los cerros. La de los edificios se ve de cerca.';
  const VELO_BORDE = 8; // celdas de 100 m
  const VELO_COLOR = [0x3b, 0x3a, 0x36];          // el mismo gris de la sombra de los edificios
  const HONESTA_CON_CERROS = 'Edificios de 2,5 a 4 m por piso, sin árboles.';
  const HONESTA_SIN_CERROS = 'Edificios de 2,5 a 4 m por piso, sin cerros ni árboles.';
  const reducido = raiz.matchMedia('(prefers-reduced-motion: reduce)');

  const S = { activo: false, ahora: true, anio: 2026, mes: 1, dia: 1, min: 720, sol: null, solDibujado: null,
    cielo: { clave: 'sinDato', intensidad: 1, texto: '' }, pestana: 'hora', calculando: false };
  let api = null, mapa = null, sombras = null, barra = null, reloj = null, relojInicio = null;
  let tCalculo = null, tVivo = null, tUrl = null;
  const $ = (sel) => barra.querySelector(sel);

  // ── Tiempo ───────────────────────────────────────────────────────────────
  function tomarAhora() {
    const b = SOL.enBogota(Date.now());
    Object.assign(S, { anio: b.anio, mes: b.mes, dia: b.dia, min: b.hora * 60 + b.minuto });
  }
  const msMomento = () => SOL.desdeBogota(S.anio, S.mes, S.dia, Math.floor(S.min / 60), S.min % 60);
  const minDeMs = (ms) => { const b = SOL.enBogota(ms); return b.hora * 60 + b.minuto + b.segundo / 60; };
  const otraZona = () => new Date().getTimezoneOffset() !== 300;

  // ── Barra ────────────────────────────────────────────────────────────────
  function armarBarra() {
    barra = B.el('section', { id: 'sol-barra', 'aria-label': 'Sol y sombras' });
    barra.hidden = true;
    barra.innerHTML = `
<div class="sb-fila">
  <button type="button" id="sb-ahora" class="sb-ahora" aria-pressed="true"><span class="sb-punto" aria-hidden="true"></span>Ahora</button>
  <div class="sb-pestanas" role="tablist" aria-label="Qué mover">
    <button type="button" role="tab" id="sb-p-hora" aria-controls="sb-c-hora" aria-selected="true">Hora</button>
    <button type="button" role="tab" id="sb-p-dia" aria-controls="sb-c-dia" aria-selected="false" tabindex="-1">Día</button>
  </div>
  <p class="sb-fecha"><span id="sb-fecha"></span> <span class="sb-zona" id="sb-zona" hidden>hora de Bogotá</span></p>
  <button type="button" id="sb-mas" class="sb-quitar sb-mas" aria-expanded="false" aria-controls="sb-c-dia sb-estado-ver sb-honesta-p">Más</button>
  <button type="button" id="sb-quitar" class="sb-quitar" aria-label="Quitar las sombras">Quitar</button>
</div>
<div class="sb-controles" id="sb-controles">
  <div class="sb-control" id="sb-c-hora" role="tabpanel" aria-labelledby="sb-p-hora">
    <span class="sb-nombre" aria-hidden="true">Hora</span>
    <div class="sb-pista">
      <div class="sb-riel" id="sb-riel-hora" aria-hidden="true"></div>
      <input type="range" id="sb-hora" min="${T.HORA_MIN}" max="${T.HORA_MAX}" step="${T.PASO}" aria-label="Hora del sol">
    </div>
    <div class="sb-rotulos" id="sb-rot-hora" aria-hidden="true"></div>
  </div>
  <div class="sb-control" id="sb-c-dia" role="tabpanel" aria-labelledby="sb-p-dia">
    <span class="sb-nombre" aria-hidden="true">Día</span>
    <div class="sb-pista">
      <div class="sb-riel" id="sb-riel-dia" aria-hidden="true"></div>
      <input type="range" id="sb-dia" min="1" max="365" step="1" aria-label="Día del año">
    </div>
    <div class="sb-rotulos" id="sb-rot-dia" aria-hidden="true"></div>
    <p class="sb-leyenda" aria-hidden="true"><span class="sb-l-punto"></span> sol casi encima al mediodía <span class="sb-l-raya"></span> solsticio <span class="sb-l-banda"></span> sol por el norte al mediodía</p>
  </div>
</div>
<div class="sb-lejos" id="sb-lejos" hidden><span id="sb-lejos-texto">${LEJOS_SIN_VELO}</span> <button type="button" id="sb-acercar">Acercarme</button></div>
<p class="sb-estado" id="sb-estado-ver" aria-hidden="true"></p>
<div class="sb-noche" id="sb-noche" hidden><button type="button" data-min="540">Ver a las 9 a. m.</button><button type="button" data-min="960">Ver a las 4 p. m.</button></div>
<p class="sb-honesta" id="sb-honesta-p"><span id="sb-honesta">${HONESTA_CON_CERROS}</span> <span class="marca" data-marca="supuesto">supuesto</span></p>
<p class="oculto" id="sb-estado" aria-live="polite"></p>`;
    document.body.append(barra);
    // La CSP no deja estilos en línea dentro del HTML: las posiciones se ponen por el DOM.
    $('#sb-rot-hora').append(...[[360, '6 a. m.'], [720, '12 m.'], [1080, '6 p. m.']].map(([m, t]) => trozo('', pctHora(m), null, t)));
    $('#sb-rot-dia').append(...[[1, 0], [60, 2], [121, 4], [182, 6], [244, 8], [305, 10]].map(([n, m]) => trozo('', pctDia(n), null, T.MES_CORTO[m])));

    $('#sb-ahora').addEventListener('click', () => {
      if (S.ahora) { S.ahora = false; } else { S.ahora = true; tomarAhora(); }
      todo();
    });
    $('#sb-quitar').addEventListener('click', () => { if (B.quitarSombras) B.quitarSombras(); });
    // En la vista de calle la barra va corta (solo la hora); «Más» abre el día y las notas.
    $('#sb-mas').addEventListener('click', () => {
      const abrir = !barra.classList.contains('sb-abierta');
      barra.classList.toggle('sb-abierta', abrir);
      $('#sb-mas').setAttribute('aria-expanded', String(abrir));
      $('#sb-mas').textContent = abrir ? 'Menos' : 'Más';
    });
    $('#sb-acercar').addEventListener('click', () => mapa.easeTo({ zoom: 16.5, duration: reducido.matches ? 0 : 800, freezeElevation: true }));
    for (const b of barra.querySelectorAll('#sb-noche button')) {
      b.addEventListener('click', () => { S.ahora = false; S.min = Number(b.dataset.min); todo(); $('#sb-hora').focus(); });
    }
    const hora = $('#sb-hora'), dia = $('#sb-dia');
    hora.addEventListener('input', () => { S.ahora = false; S.min = Number(hora.value); todo(); });
    dia.addEventListener('input', () => { S.ahora = false; Object.assign(S, T.fechaDeDia(S.anio, Number(dia.value))); todo(); });
    // Re Pág y Av Pág: una hora o un mes.
    hora.addEventListener('keydown', (e) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      e.preventDefault();
      S.ahora = false; S.min = T.ajustarHora(S.min + (e.key === 'PageUp' ? 60 : -60)); todo();
    });
    dia.addEventListener('keydown', (e) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      e.preventDefault();
      const d = new Date(Date.UTC(S.anio, S.mes - 1 + (e.key === 'PageUp' ? 1 : -1), 1));
      const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      // Sin pasar de año: la regla es de un solo año.
      if (d.getUTCFullYear() !== S.anio) return;
      S.ahora = false; S.mes = d.getUTCMonth() + 1; S.dia = Math.min(S.dia, ultimo); todo();
    });
    // Pestañas (solo se ven en el teléfono).
    const pest = [$('#sb-p-hora'), $('#sb-p-dia')];
    pest.forEach((p, i) => {
      p.addEventListener('click', () => elegirPestana(i ? 'dia' : 'hora'));
      p.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const otra = pest[1 - i];
        elegirPestana(i ? 'hora' : 'dia');
        otra.focus();
      });
    });
    elegirPestana('hora');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => api.fijarAlto()).observe(barra);
  }

  function elegirPestana(p) {
    S.pestana = p;
    barra.dataset.pestana = p;
    $('#sb-p-hora').setAttribute('aria-selected', String(p === 'hora'));
    $('#sb-p-dia').setAttribute('aria-selected', String(p === 'dia'));
    $('#sb-p-hora').tabIndex = p === 'hora' ? 0 : -1;
    $('#sb-p-dia').tabIndex = p === 'dia' ? 0 : -1;
  }

  function pctHora(min) { return Math.min(100, Math.max(0, (min - T.HORA_MIN) / (T.HORA_MAX - T.HORA_MIN) * 100)); }
  function pctDia(n) { return (n - 1) / 364 * 100; }
  function trozo(clase, izq, ancho, texto) {
    const e = document.createElement('span');
    if (clase) e.className = clase;
    e.style.left = izq + '%';
    if (ancho != null) e.style.width = ancho + '%';
    if (texto) e.textContent = texto;
    return e;
  }
  const aguja = (id) => { const e = trozo('sb-aguja', 0); e.id = id; return e; };

  // Riel de la hora: día y noche del día elegido, salida y puesta, mediodía y la aguja.
  let rielHoraDe = '', rielDiaDe = '';
  function pintarRieles(noche) {
    const clave = `${S.anio}-${S.mes}-${S.dia}`;
    if (clave !== rielHoraDe) {
      rielHoraDe = clave;
      const sp = SOL.salidaPuesta(S.anio, S.mes, S.dia, LAT, LON);
      const a = pctHora(minDeMs(sp.salida)), b = pctHora(minDeMs(sp.puesta)), m = pctHora(minDeMs(sp.mediodia));
      $('#sb-riel-hora').replaceChildren(trozo('sb-noche-t', 0, a), trozo('sb-dia-t', a, b - a), trozo('sb-noche-t', b, 100 - b),
        trozo('sb-marca-alta', a), trozo('sb-marca-alta', b), trozo('sb-marca-media', m), aguja('sb-aguja-hora'));
    }
    if (String(S.anio) !== rielDiaDe) {
      rielDiaDe = String(S.anio);
      const cen = SOL.diasCenitales(S.anio, LAT, LON).map((c) => {
        const [y, mo, d] = c.fecha.split('-').map(Number);
        return { n: T.diaDelAnio(y, mo, d), norte: c.pasaAlNorte };
      });
      const ini = cen.find((c) => c.norte), fin = cen.find((c) => !c.norte);
      const h = [];
      if (ini && fin) h.push(trozo('sb-banda', pctDia(ini.n), pctDia(fin.n) - pctDia(ini.n), 'sol por el norte al mediodía'));
      for (const n of [T.diaDelAnio(S.anio, 6, 21), T.diaDelAnio(S.anio, 12, 21)]) h.push(trozo('sb-marca-alta', pctDia(n)));
      for (const c of cen) h.push(trozo('sb-cenit', pctDia(c.n)));
      $('#sb-riel-dia').replaceChildren(...h, aguja('sb-aguja-dia'));
    }
    const ah = $('#sb-aguja-hora');
    ah.style.left = pctHora(S.min) + '%';
    ah.hidden = noche || S.min < T.HORA_MIN || S.min > T.HORA_MAX;
    $('#sb-aguja-dia').style.left = pctDia(T.diaDelAnio(S.anio, S.mes, S.dia)) + '%';
  }

  // ── Cálculo y estado ─────────────────────────────────────────────────────
  function todo() {
    if (!S.activo) return;
    S.sol = SOL.posicion(msMomento(), LAT, LON);
    // En «Ahora» solo se vuelve a dibujar si el sol se movió al menos 0,25°.
    const d = S.solDibujado;
    if (!S.ahora || !d || Math.abs(d.altura - S.sol.altura) >= 0.25 || Math.abs(d.azimut - S.sol.azimut) >= 0.25 || (d.altura > 0) !== (S.sol.altura > 0)) {
      S.solDibujado = S.sol;
      sombras.fijarSol(S.sol);
      ponerLuz();
      ponerCielo();
      V.sucio = true;
    }
    if (S.ahora) S.cielo = T.cielo(B.ultimoCielo && B.ultimoCielo.fuentes && B.ultimoCielo.fuentes.metar);
    fijarAlfa();
    sombras.fijarIntensidad(S.ahora ? S.cielo.intensidad : 1);
    velo();
    pintar();
    escribirUrl();
  }

  // Con 3D la sombra va más oscura: al ras de la calle el gris suave del 2D no se lee.
  function fijarAlfa() {
    const tres = api.es3d();
    sombras.fijarOpcion('alfaNucleo', tres ? ALFA_3D[0] : ALFA_2D[0]);
    sombras.fijarOpcion('alfaBorde', tres ? ALFA_3D[1] : ALFA_2D[1]);
  }

  // Paso 11: con 3D, la luz de las fachadas y del relieve viene del sol.
  function ponerLuz() {
    const tres = S.activo && api.es3d() && S.sol;
    const conSol = tres && S.sol.altura > 0;
    // De noche con 3D: luz fría y tenue (T.luz la da para el sol bajo el horizonte).
    mapa.setLight(tres ? T.luz(S.sol) : LUZ_FIJA);
    if (mapa.getLayer('relieve')) {
      mapa.setPaintProperty('relieve', 'hillshade-illumination-direction', conSol ? Math.round(S.sol.azimut) % 360 : RELIEVE_FIJO);
    }
  }

  // ── Cielo por hora del sol ─────────────────────────────────────────────
  function lerpHex(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return '#' + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0');
  }
  function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  function cieloPorAltura(alt) {
    if (alt < -6) {
      return { 'sky-color': '#0a1628', 'sky-horizon-blend': 0.4, 'horizon-color': '#1a2a40',
        'fog-color': '#141e2e', 'horizon-fog-blend': 0.3, 'fog-ground-blend': 0.6, 'atmosphere-blend': 1.0 };
    }
    if (alt < 0) {
      const t = (alt + 6) / 6;
      return { 'sky-color': lerpHex('#0a1628', '#2a4a7a', t), 'sky-horizon-blend': lerp(0.4, 0.5, t),
        'horizon-color': lerpHex('#1a2a40', '#d4956a', t), 'fog-color': lerpHex('#141e2e', '#8a7060', t),
        'horizon-fog-blend': 0.3, 'fog-ground-blend': lerp(0.5, 0.3, t), 'atmosphere-blend': 1.0 };
    }
    if (alt < 15) {
      const t = alt / 15;
      return { 'sky-color': lerpHex('#4a7ab0', '#6fa8dc', t), 'sky-horizon-blend': lerp(0.5, 0.35, t),
        'horizon-color': lerpHex('#d4956a', '#e0d0b8', t), 'fog-color': lerpHex('#8a7060', '#d8d0c8', t),
        'horizon-fog-blend': lerp(0.3, 0.25, t), 'fog-ground-blend': lerp(0.3, 0.1, t), 'atmosphere-blend': lerp(1.0, 0.8, t) };
    }
    return { 'sky-color': '#89c2e8', 'sky-horizon-blend': 0.3, 'horizon-color': '#e8e4dd',
      'fog-color': '#f0ece6', 'horizon-fog-blend': 0.2, 'fog-ground-blend': 0.05, 'atmosphere-blend': 0.75 };
  }

  function ponerCielo() {
    const tres = api.es3d();
    if (api.fijarNoche) api.fijarNoche(S.activo && tres && S.sol && S.sol.altura <= 0);
    if (!tres) return;
    const alt = S.sol ? S.sol.altura : -10;
    mapa.setSky(cieloPorAltura(alt));
  }

  function estadoTexto() {
    const z = mapa.getZoom(), tres = api.es3d(), alt = S.sol.altura;
    const noche = alt <= 0;
    let texto = '', lejos = false;
    if (z < ZOOM_SOMBRA && !tres && !noche) lejos = true;
    if (noche) {
      if (S.ahora) {
        const sp = SOL.salidaPuesta(S.anio, S.mes, S.dia, LAT, LON);
        const antes = Date.now() < sp.salida;
        const sale = antes ? sp.salida : SOL.salidaPuesta(...manana(), LAT, LON).salida;
        texto = `Es de noche en Bogotá: no hay sombras. El sol sale ${antes ? 'hoy' : 'mañana'} a las ${T.horaTexto(Math.round(minDeMs(sale)))}`;
      } else texto = 'Esa hora es de noche: no hay sombras.';
    } else if (lejos) {
      texto = '';
    } else if (alt <= G.ALTURA_MINIMA_SOL) {
      texto = 'El sol está casi en el horizonte. Las sombras son tan largas que no se dibujan.';
    } else if (z < ZOOM_SOMBRA) {
      texto = veloEnVista() ? 'De lejos ves la sombra de los cerros. Acércate para ver la de los edificios.'
        : 'De lejos solo cambia la luz sobre los edificios. Acércate para ver las sombras.';
    } else if (S.calculando) {
      texto = 'Calculando las sombras…';
    } else {
      const partes = [];
      const mediodia = SOL.posicion(SOL.mediodia(S.anio, S.mes, S.dia, LON), LAT, LON).altura;
      if (mediodia >= 87) partes.push(S.ahora ? 'Hoy el sol pasa casi encima: al mediodía casi no hay sombra.' : 'Ese día el sol pasa casi encima: al mediodía casi no hay sombra.');
      const primer = primerSolAqui();
      if (primer != null) partes.push(`Aquí el sol pasa los cerros a las ${T.horaTexto(Math.round(primer))}`.replace(/\.?$/, '.'));
      if (S.ahora && S.cielo.texto) partes.push(S.cielo.texto);
      texto = partes.join(' ');
    }
    return { texto, lejos, noche };
  }
  function manana() {
    const d = new Date(Date.UTC(S.anio, S.mes - 1, S.dia + 1));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }

  function pintar() {
    if (!barra) return;
    const { texto, lejos, noche } = estadoTexto();
    const bAhora = $('#sb-ahora');
    bAhora.setAttribute('aria-pressed', String(S.ahora));
    $('#sb-fecha').textContent = `${T.fechaTexto(S.anio, S.mes, S.dia)}, ${T.horaTexto(S.min)}`;
    $('#sb-zona').hidden = !otraZona();
    const hora = $('#sb-hora'), dia = $('#sb-dia');
    hora.value = String(T.ajustarHora(S.min));
    hora.setAttribute('aria-valuetext', T.horaTexto(S.min));
    dia.value = String(T.diaDelAnio(S.anio, S.mes, S.dia));
    dia.setAttribute('aria-valuetext', T.diaTexto(S.mes, S.dia));
    pintarRieles(noche);
    $('#sb-honesta').textContent = V.estado === 'fallo' ? HONESTA_SIN_CERROS : HONESTA_CON_CERROS;
    $('#sb-controles').hidden = lejos;
    $('#sb-lejos').hidden = !lejos;
    const textoLejos = veloEnVista() ? LEJOS_CON_VELO : LEJOS_SIN_VELO;
    $('#sb-lejos-texto').textContent = textoLejos;
    $('#sb-noche').hidden = !noche || lejos;
    $('#sb-estado-ver').textContent = texto;
    $('#sb-estado-ver').hidden = !texto;
    barra.classList.toggle('sb-de-noche', noche);
    // El lector de pantalla oye el estado 600 ms después, para no repetir cada paso del deslizador.
    clearTimeout(tVivo);
    const vivo = lejos ? textoLejos : texto;
    tVivo = setTimeout(() => { const n = barra && $('#sb-estado'); if (n && n.textContent !== vivo) n.textContent = vivo; }, 600);
    mostrarBarra();
  }

  // En el teléfono, con la hoja abierta la barra se esconde y el panel lo dice.
  function mostrarBarra() {
    if (!barra) return;
    const tapada = api.movil.matches && api.panelAbierto();
    barra.hidden = !S.activo || tapada;
    const aviso = document.getElementById('sombras-hoja');
    if (aviso) aviso.hidden = !(S.activo && tapada);
    api.fijarAlto();
  }

  function alActualizar(est) {
    if (est.pendientes > 0) {
      if (!tCalculo && !S.calculando) tCalculo = setTimeout(() => { tCalculo = null; S.calculando = true; if (S.activo) pintar(); }, 400);
    } else {
      clearTimeout(tCalculo); tCalculo = null;
      if (S.calculando) { S.calculando = false; if (S.activo) pintar(); }
    }
  }

  // ── Velo de los cerros (paso 6) ──────────────────────────────────────────
  // estado: 'nada' (no se ha pedido), 'bajando', 'listo' o 'fallo'. Se baja una sola vez, la
  // primera vez que hace falta: con 3D, o en 2D con el sol más bajo que el cerro más alto.
  const V = { estado: 'nada', rejillas: null, campo: null, lienzo: null, ctx: null, img: null, borde: null, enSombra: 0, sucio: true, empuje: false, primer: null };

  function haceFaltaVelo() {
    if (!S.activo || !S.sol) return false;
    const alt = S.sol.alturaGeometrica;
    return api.es3d() || (alt + HZ.SEMI_DISCO > 0 && alt < HZ.SOL_BAJO);
  }

  function bajarVelo() {
    if (V.estado !== 'nada') return;
    V.estado = 'bajando';
    fetch(api.teselaUrl('horizonte-bogota.hzn.gz'))
      .then((r) => { if (!r.ok) throw new Error('horizonte ' + r.status); return r.arrayBuffer(); })
      .then(HZ.descomprimir)
      .then((bytes) => {
        V.rejillas = HZ.leer(bytes);
        V.campo = HZ.armarCampo(V.rejillas);
        const { nc, nf } = V.campo;
        V.lienzo = document.createElement('canvas');
        V.lienzo.width = nc; V.lienzo.height = nf;
        V.ctx = V.lienzo.getContext('2d');
        V.img = V.ctx.createImageData(nc, nf);
        for (let i = 0; i < nc * nf; i++) V.img.data.set(VELO_COLOR, i * 4);
        // La rejilla termina en una caja: el velo se apaga en los últimos 800 m para que el
        // borde no se lea como una línea del terreno.
        V.borde = new Float32Array(nc * nf);
        for (let f = 0; f < nf; f++) for (let c = 0; c < nc; c++) {
          V.borde[f * nc + c] = Math.min(1, (Math.min(c, nc - 1 - c, f, nf - 1 - f) + 0.5) / VELO_BORDE);
        }
        V.estado = 'listo';
        V.sucio = true;
        if (S.activo) { velo(); pintar(); }
      })
      .catch(() => {
        // Sin la rejilla no hay sombra de cerros: la línea de honestidad lo dice.
        V.estado = 'fallo';
        if (S.activo) pintar();
      });
  }

  function velo() {
    if (V.estado === 'nada' && haceFaltaVelo()) bajarVelo();
    if (V.estado !== 'listo' || !S.activo) return;
    if (!mapa.getSource('velo-cerros')) {
      mapa.addSource('velo-cerros', { type: 'canvas', canvas: V.lienzo, coordinates: V.campo.esquinas, animate: false });
    }
    const opacidad = VELO_OPACIDAD * (S.ahora ? S.cielo.intensidad : 1);
    if (!mapa.getLayer('velo-cerros')) {
      // Encima de calles, sombras y construcciones; debajo de límites y rótulos.
      mapa.addLayer({ id: 'velo-cerros', type: 'raster', source: 'velo-cerros',
        paint: { 'raster-opacity': opacidad, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'sectores');
      V.sucio = true;
    }
    if (V.sucio) {
      V.sucio = false;
      const px = V.img.data, { alfa, enSombra } = HZ.alfas(V.campo, S.sol);
      V.enSombra = enSombra;
      for (let i = 0; i < alfa.length; i++) px[i * 4 + 3] = alfa[i] * V.borde[i];
      V.ctx.putImageData(V.img, 0, 0);
      // MapLibre solo vuelve a subir el lienzo mientras «reproduce»: un cuadro y se detiene.
      const fuente = mapa.getSource('velo-cerros');
      fuente.play(); fuente.pause();
      // Con terreno, las capas raster se guardan ya pegadas al relieve y un lienzo nuevo no
      // borra ese guardado; un cambio de estilo sí. La opacidad se mueve una diezmilésima.
      V.empuje = !V.empuje;
    }
    mapa.setPaintProperty('velo-cerros', 'raster-opacity', opacidad + (V.empuje ? 0.0001 : 0));
    mapa.triggerRepaint();
  }

  // ¿Hay sombra de cerros dentro de la vista? Para no decir «ves» cuando no se ve.
  function veloEnVista() {
    if (V.estado !== 'listo' || !V.enSombra || !mapa.getLayer('velo-cerros')) return false;
    // Una malla de 12 × 12 puntos de la pantalla: con el mapa inclinado la caja de la vista
    // abarca mucho más de lo que se ve.
    const { nc, nf, esquinas } = V.campo, [[o, n], [e], [, su]] = esquinas, px = V.img.data;
    const lienzo = mapa.getCanvas(), an = lienzo.clientWidth, al = lienzo.clientHeight;
    // Lo que tapan el panel y la barra no se ve: esos puntos no cuentan.
    const tapan = [api.panel, barra].filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    const caja = lienzo.getBoundingClientRect();
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const sx = (x + 0.5) * an / 12, sy = (y + 0.5) * al / 12;
      if (tapan.some((r) => caja.left + sx >= r.left && caja.left + sx <= r.right && caja.top + sy >= r.top && caja.top + sy <= r.bottom)) continue;
      const p = mapa.unproject([sx, sy]);
      const c = Math.floor((p.lng - o) / (e - o) * nc), f = Math.floor((n - p.lat) / (n - su) * nf);
      if (c >= 0 && c < nc && f >= 0 && f < nf && px[(f * nc + c) * 4 + 3] >= 128) return true;
    }
    return false;
  }

  function quitarVelo() {
    if (mapa.getLayer('velo-cerros')) mapa.removeLayer('velo-cerros');
    if (mapa.getSource('velo-cerros')) mapa.removeSource('velo-cerros');
  }

  // Hora a la que el borde superior del sol pasa los cerros en el centro de la vista, el día
  // elegido. null si no hay rejilla o el centro está fuera.
  function primerSolAqui() {
    if (V.estado !== 'listo') return null;
    const c = mapa.getCenter();
    const clave = `${S.anio}-${S.mes}-${S.dia} ${c.lng.toFixed(3)} ${c.lat.toFixed(3)}`;
    if (V.primer && V.primer.clave === clave) return V.primer.min;
    const punto = HZ.consultar(V.rejillas, c.lng, c.lat);
    const cero = SOL.desdeBogota(S.anio, S.mes, S.dia, 0, 0);
    const min = punto ? HZ.llegada(punto, c.lng, c.lat, 0, (m) => SOL.posicion(cero + m * 60000, c.lat, c.lng)) : null;
    V.primer = { clave, min };
    return min;
  }

  // ── URL ──────────────────────────────────────────────────────────────────
  function escribirUrl() {
    clearTimeout(tUrl);
    tUrl = setTimeout(() => {
      const q = new URLSearchParams(location.search);
      q.delete('sombras'); q.delete('sol');
      let s = q.toString();
      if (S.activo) s += (s ? '&' : '') + 'sombras=1' + (S.ahora ? '' : '&sol=' + T.escribirSol(S));
      const nueva = location.pathname + (s ? '?' + s : '') + location.hash;
      if (nueva !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', nueva);
    }, 250);
  }

  // ── Encender y apagar ────────────────────────────────────────────────────
  function cadaMinuto() {
    if (S.ahora) { tomarAhora(); todo(); }
    else if (barra) pintar();
  }

  function prender() {
    if (S.activo) return;
    api = B.mapaApi; mapa = api.mapa;
    if (!barra) armarBarra();
    const elegido = T.leerSol(new URLSearchParams(location.search).get('sol'));
    if (elegido) { S.ahora = false; Object.assign(S, elegido); } else { S.ahora = true; tomarAhora(); }
    sombras = B.sombrasCapa.crear({ pmtiles: api.pmCat, alActualizar });
    B.recibirCatastro = sombras.recibir;
    // Orden de abajo arriba: calles, sombra, construcciones. Así la construcción tapa la
    // sombra sobre su propio techo y la sombra sí cae sobre la calle.
    mapa.addLayer(Object.assign(sombras.capa, { minzoom: ZOOM_SOMBRA }), 'sectores');
    mapa.moveLayer('construcciones', 'sectores');
    S.activo = true;
    S.solDibujado = null;
    V.sucio = true;
    todo();
    const espera = 60000 - (Date.now() % 60000) + 200;
    relojInicio = setTimeout(() => { cadaMinuto(); reloj = setInterval(cadaMinuto, 60000); }, espera);
    mapa.on('zoomend', pintar);
    mapa.on('moveend', pintar);
  }

  function apagar() {
    if (!S.activo) return;
    S.activo = false;
    clearTimeout(relojInicio); clearInterval(reloj); clearTimeout(tCalculo); tCalculo = null; S.calculando = false;
    mapa.off('zoomend', pintar);
    mapa.off('moveend', pintar);
    B.recibirCatastro = null;
    if (mapa.getLayer(sombras.capa.id)) mapa.removeLayer(sombras.capa.id);
    quitarVelo();
    mapa.moveLayer('construcciones', 'vias');
    sombras = null;
    ponerLuz();
    // Restaurar el cielo estático de día si el 3D sigue encendido; borrarlo si no.
    if (api.fijarNoche) api.fijarNoche(false);
    if (api.es3d()) mapa.setSky(api.cieloDia); else mapa.setSky({});
    mostrarBarra();
    escribirUrl();
  }

  addEventListener('bogotwin:cielo', () => { if (S.activo && S.ahora) todo(); });
  addEventListener('bogotwin:panel', () => { if (S.activo) mostrarBarra(); });
  addEventListener('bogotwin:3d', () => {
    if (!S.activo) return;
    sombras.rearmarTodo();
    fijarAlfa();
    sombras.fijarIntensidad(S.ahora ? S.cielo.intensidad : 1);
    ponerLuz();
    ponerCielo();
    V.sucio = true;
    velo();
    pintar();
  });
  raiz.matchMedia('(max-width: 600px)').addEventListener('change', () => { if (S.activo) mostrarBarra(); });

  // Paso 12: fila de la ventana de una construcción. null si las sombras están apagadas.
  function filaPopup(pisos) {
    if (!S.activo || !S.sol) return null;
    return T.filaSombra(S.sol, pisos, G.largoSombra);
  }

  B.solBarra = { prender, apagar, filaPopup, estado: S, capa: () => sombras, velo: V };
})(window);
