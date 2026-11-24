'use strict';
// Piezas comunes. Todo lo que viene de un dato entra como texto (textContent), nunca como HTML.
(function () {
  const MARCAS = {
    medido: 'medido',
    de_fuente: 'de fuente',
    estimado: 'estimado',
    inferido: 'inferido',
    supuesto: 'supuesto'
  };
  // Marcas viejas que todavía pueden venir en un JSON ya guardado: se leen con la marca de hoy.
  const MARCAS_VIEJAS = { pronostico: 'estimado' };

  // Marca segura para un valor que viene de un JSON: la de hoy, la vieja traducida o la que se pida por defecto.
  function marcaDe(tipo, porDefecto) {
    if (MARCAS[tipo]) return tipo;
    if (MARCAS_VIEJAS[tipo]) return MARCAS_VIEJAS[tipo];
    return MARCAS[porDefecto] ? porDefecto : 'de_fuente';
  }

  function el(tag, props, ...hijos) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'clase') n.className = v;
        else if (k === 'texto') n.textContent = String(v);
        else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'alt' || k === 'title' || k === 'loading' || k === 'decoding') n.setAttribute(k, String(v));
        else n[k] = v;
      }
    }
    for (const h of hijos) if (h != null) n.append(h instanceof Node ? h : document.createTextNode(String(h)));
    return n;
  }

  // Solo enlaces https: un dato nunca puede meter javascript: ni otro esquema.
  function enlace(url, texto) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return el('span', { texto });
      return el('a', { href: u.href, texto, rel: 'noopener noreferrer', target: '_blank' });
    } catch { return el('span', { texto }); }
  }

  function marca(tipo) {
    const t = MARCAS[tipo] ? tipo : 'de_fuente';
    return el('span', { clase: 'marca', 'data-marca': t, texto: MARCAS[t] });
  }

  function minutosDesde(iso, ahora) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.round(((ahora ?? Date.now()) - t) / 60000);
  }

  function edadTexto(min) {
    if (min == null) return 'hora desconocida';
    if (min < 0) return 'en ' + edadTexto(-min).replace(/^hace /, '');
    if (min < 1) return 'hace menos de 1 min';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 48) return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} días`;
  }

  // Edad que se recalcula sola cada minuto con la hora del dato, no con la de cuando se armó el JSON.
  function edad(iso, viejoMin) {
    const s = el('span', { clase: 'edad', 'data-hora': iso || '' });
    if (viejoMin) s.dataset.viejo = String(viejoMin);
    pintarEdad(s);
    return s;
  }
  function pintarEdad(s) {
    const min = minutosDesde(s.dataset.hora);
    const lim = Number(s.dataset.viejo || 0);
    const viejo = lim && min != null && min > lim;
    s.textContent = edadTexto(min) + (viejo ? ', dato viejo' : '');
    s.classList.toggle('viejo', !!viejo);
  }
  setInterval(() => document.querySelectorAll('.edad[data-hora]').forEach(pintarEdad), 60000);

  // Línea de procedencia: marca, edad, licencia y fuente.
  function meta({ tipo, hora, viejoMin, licencia, fuente }) {
    const m = el('div', { clase: 'meta' }, marca(tipo));
    if (hora !== undefined) m.append(edad(hora, viejoMin));
    if (licencia && licencia.nombre) m.append(licencia.url ? enlace(licencia.url, licencia.nombre) : el('span', { texto: licencia.nombre }));
    if (fuente) m.append(el('span', { texto: fuente }));
    return m;
  }

  // Valor con su marca: cada número visible lleva data-marca para la prueba de marcas.
  function valor(texto, tipo, chico) {
    return el('span', { clase: 'valor' + (chico ? ' chico' : ''), 'data-marca': MARCAS[tipo] ? tipo : 'de_fuente', texto });
  }

  const fmt1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
  const num = (x) => fmt1.format(x);
  const horaLocal = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  const fechaLocal = (iso) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });

  const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Los datos traen las localidades sin tilde; las ponemos con su nombre oficial.
  const TILDES = { Usaquen: 'Usaquén', Bolivar: 'Bolívar', Engativa: 'Engativá', Fontibon: 'Fontibón', Cristobal: 'Cristóbal', Martires: 'Mártires', Narino: 'Nariño' };
  const nombrePropio = (s) => s.toLowerCase().replace(/(^|[\s(\-/.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\p{L}+/gu, (w) => TILDES[w] || w);
  // «p. m.» ya trae su punto: evita «p. m..» al final de una frase.
  const frase = (s) => s.replace(/\.\./g, '.');

  // Se suma a lo que ya haya (sol.js y sombra-geom.js cuelgan sus piezas aquí también).
  window.Bogotwin = Object.assign(window.Bogotwin || {}, { el, enlace, marca, marcaDe, meta, valor, edad, edadTexto, minutosDesde, num, horaLocal, fechaLocal, sinTildes, nombrePropio, frase, MARCAS });
})();
