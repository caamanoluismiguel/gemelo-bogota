'use strict';
// Panel: la hoja de tres alturas, la franja del ahora y las cuatro pestañas. No depende del
// mapa: sin WebGL el panel se abre, se cierra y cambia de pestaña igual.
(function () {
  const B = window.Bogotwin;
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const boton = $('plegar');
  if (!panel || !boton) return;
  const movil = matchMedia('(max-width: 600px)');
  const PESTANAS = ['ahora', 'dias', 'ciudad', 'probar'];
  const tabs = () => PESTANAS.map((p) => $('pe-' + p)).filter((t) => t && !t.hidden);
  const estado = { hoja: 'asomada', pestana: 'ahora' };

  // ── Hoja: asomada (cabecera, franja y pestañas), media (50 %, solo teléfono) y completa ──
  function ponerHoja(h) {
    if (!movil.matches && h === 'media') h = 'completa';
    estado.hoja = h;
    panel.dataset.hoja = h;
    const plegado = h === 'asomada';
    panel.classList.toggle('plegado', plegado);
    boton.setAttribute('aria-expanded', String(!plegado));
    boton.textContent = h === 'completa' ? 'Menos datos' : 'Más datos';
    window.dispatchEvent(new CustomEvent('bogotwin:panel', { detail: { plegado, hoja: h } }));
  }
  // abrir(true) sube la hoja a media si estaba asomada; abrir(false) la deja asomada.
  function abrir(si) {
    if (!si) ponerHoja('asomada');
    else if (estado.hoja === 'asomada') ponerHoja('media');
  }
  boton.addEventListener('click', () => {
    const sig = movil.matches ? { asomada: 'media', media: 'completa', completa: 'asomada' } : { asomada: 'completa', completa: 'asomada', media: 'asomada' };
    ponerHoja(sig[estado.hoja]);
  });
  // Al pasar de teléfono a escritorio la altura media no existe.
  movil.addEventListener('change', () => { if (estado.hoja === 'media') ponerHoja('completa'); });

  // ── Pestañas: role=tablist, flechas, Inicio y Fin; la elegida queda en ?p= ──
  function escribirP(p) {
    const q = new URLSearchParams(location.search);
    if (q.get('p') === p) return;
    q.set('p', p);
    history.replaceState(history.state, '', location.pathname + '?' + q.toString() + location.hash);
  }
  function elegir(p, { abrir: abrirla = true, escribir = true, foco = false } = {}) {
    if (!PESTANAS.includes(p)) return;
    const t = $('pe-' + p);
    if (!t || t.hidden) return;
    estado.pestana = p;
    for (const q of PESTANAS) {
      const tq = $('pe-' + q), pq = $('pa-' + q);
      if (!tq || !pq) continue;
      const si = q === p;
      tq.setAttribute('aria-selected', String(si));
      tq.tabIndex = si ? 0 : -1;
      pq.hidden = !si;
    }
    if (abrirla) abrir(true);
    if (escribir) escribirP(p);
    if (foco) t.focus();
    const c = $('cuerpo');
    if (c) c.scrollTop = 0;
    window.dispatchEvent(new CustomEvent('bogotwin:pestana', { detail: { p } }));
  }
  for (const p of PESTANAS) {
    const t = $('pe-' + p);
    if (!t) continue;
    t.addEventListener('click', () => elegir(p));
    t.addEventListener('keydown', (e) => {
      const lista = tabs();
      const i = lista.indexOf(t);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % lista.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + lista.length) % lista.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = lista.length - 1;
      if (j == null) return;
      e.preventDefault();
      elegir(lista[j].id.slice(3), { foco: true });
    });
  }

  // ── «?»: cómo leer cada dato, junto al sello de la franja ──
  const ayuda = $('ayuda-marcas'), cajaAyuda = $('marcas-ayuda');
  if (ayuda && cajaAyuda) {
    ayuda.addEventListener('click', () => {
      const abrirla = cajaAyuda.hidden;
      cajaAyuda.hidden = !abrirla;
      ayuda.setAttribute('aria-expanded', String(abrirla));
      window.dispatchEvent(new CustomEvent('bogotwin:panel', { detail: { plegado: estado.hoja === 'asomada', hoja: estado.hoja } }));
    });
  }

  // ── Franja del ahora: temperatura de El Dorado, lluvia en 24 h y PM2,5 de esta hora ──
  const cifra = (id) => { const b = $(id); return b && b.querySelector('.franja-valor'); };
  const sellos = { metar: null, pron: null };
  const valores = { temp: '', lluvia: '', aire: '' };
  const voz = $('franja-voz');
  // Devuelve verdadero solo si cambia una cifra que ya se mostraba: llenarla la primera vez o
  // repetir el mismo valor en cada refresco no se anuncia.
  function poner(clave, id, texto) {
    const n = cifra(id);
    if (!n || valores[clave] === texto) return false;
    const antes = valores[clave];
    valores[clave] = texto;
    n.textContent = texto;
    return antes !== '';
  }
  function anunciar() {
    if (voz) voz.textContent = `Ahora: ${valores.temp || 'sin dato'} en El Dorado, lluvia en 24 horas ${valores.lluvia || 'sin dato'}, PM2,5 ${valores.aire || 'sin dato'}.`;
  }
  function pintarSellos() {
    const n = $('franja-sellos');
    if (!n) return;
    const hay = [sellos.metar, sellos.pron].filter(Boolean);
    if (hay.length) n.replaceChildren(...hay.flatMap((s, i) => i ? [' ', s] : [s]));
  }
  window.addEventListener('bogotwin:cielo', (ev) => {
    const m = ev.detail && ev.detail.fuentes && ev.detail.fuentes.metar;
    const est = m && m.estado === 'ok' && Array.isArray(m.estaciones) ? m.estaciones.filter((e) => e && e.temperatura_c != null) : [];
    const e = est.find((x) => /dorado/i.test(x.nombre || '')) || est[0];
    const cambio = poner('temp', 'franja-temp', e ? `${B.num(e.temperatura_c)} °C` : 'sin dato');
    const q = $('franja-temp');
    if (q) q.querySelector('.franja-que').textContent = e && !/dorado/i.test(e.nombre || '') ? B.nombrePropio(String(e.nombre || '')) : 'El Dorado';
    sellos.metar = e ? B.sello({ tipo: 'medido', hora: e.hora_dato, viejoMin: 90 }) : null;
    pintarSellos();
    if (cambio) anunciar();
  });
  window.addEventListener('bogotwin:pronostico', (ev) => {
    const d = ev.detail || {};
    const cambio = poner('lluvia', 'franja-lluvia', Number.isFinite(d.prob) ? `${d.prob} %` : 'sin dato');
    sellos.pron = d.generado ? B.sello({ tipo: 'estimado', hora: d.generado, viejoMin: d.viejoMin || 120 }) : null;
    pintarSellos();
    if (cambio) anunciar();
  });
  window.addEventListener('bogotwin:aire', () => {
    const V = B.vivo;
    const r = V && B.aire && B.aire.datos ? V.aireEnHora(B.aire.datos, Date.now()) : { estado: 'sin_dato' };
    if (poner('aire', 'franja-aire', r.estado === 'ok' ? B.num(r.pm25) : 'sin dato')) anunciar();
  });
  // Cada cifra abre su pestaña y lleva a su tarjeta.
  for (const b of document.querySelectorAll('.franja-dato')) {
    b.addEventListener('click', () => {
      elegir(b.dataset.ir);
      const t = $(b.dataset.tarjeta);
      if (t) t.scrollIntoView({ block: 'start' });
    });
  }

  // ── Arranque: con ?p= la hoja abre en esa pestaña; sin enlace, asomada en «Ahora» ──
  const p0 = new URLSearchParams(location.search).get('p');
  ponerHoja('asomada');
  if (PESTANAS.includes(p0)) elegir(p0, { escribir: false });
  // Sin WebGL2 no hay sombras ni escenario: la pestaña «Probar» se esconde con su tarjeta.
  B.panelUi = { ponerHoja, abrir, elegir, estado, abierto: () => estado.hoja !== 'asomada', porEnlace: PESTANAS.includes(p0) };
})();
