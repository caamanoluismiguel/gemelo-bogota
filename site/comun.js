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

  // Mezcla en línea recta de dos colores #rrggbb (t de 0 a 1). Para la noche que llega de a poco.
  const HEX = /^#[0-9a-f]{6}$/i;
  function mezclarColor(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
  }
  // Lo mismo para un valor de estilo: colores sueltos o dentro de una expresión con la misma
  // forma de día y de noche (un «match» de vías, por ejemplo). Si no se pueden mezclar, cambia
  // a la mitad del camino.
  function mezclarValor(a, b, t) {
    if (typeof a === 'string' && typeof b === 'string' && HEX.test(a) && HEX.test(b)) return mezclarColor(a, b, t);
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => mezclarValor(v, b[i], t));
    if (a === b) return a;
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
    return t < 0.5 ? a : b;
  }

  // Colores de fachada (ronda 6), ilustrativos: Bogotá es de ladrillo, pero Catastro no dice
  // el color de cada edificio. Hasta 11 pisos, ladrillo y terracota con algo de pañete claro;
  // de 12 pisos para arriba, concreto y vidrio. La clave es el número de pisos, lo único que
  // las teselas traen igual en todas las escalas (de lejos se unen construcciones con los
  // mismos pisos), así que el color no cambia entre teselas ni al acercarse.
  // Uno por cada número de pisos hasta 11. Las casas de 1 a 3 pisos son la mayoría de la
  // ciudad, así que llevan ladrillo; el pañete claro queda en 6 y 10 pisos, que son pocos.
  const LADRILLO = ['#b4683f', '#a65a3e', '#8a4634', '#b9804e', '#9c513b', '#e4d9c6', '#7b4031', '#c28b58',
    '#ae6545', '#ece6db', '#93503a'];
  const CONCRETO = ['#b8b2a8', '#a4aeb8', '#dedbd4', '#c4bfb6', '#b0b8c0'];
  function colorFachada(pisos) {
    const p = Math.max(1, Math.round(Number(pisos) || 1));
    if (p < 12) return LADRILLO[p - 1];
    const h = (Math.imul(p, 2654435761) >>> 0) ^ (p * 40503);
    return CONCRETO[(h >>> 3) % CONCRETO.length];
  }

  // Se suma a lo que ya haya (sol.js y sombra-geom.js cuelgan sus piezas aquí también).
  window.Bogotwin = Object.assign(window.Bogotwin || {}, { el, enlace, marca, marcaDe, meta, valor, edad, edadTexto, minutosDesde, num, horaLocal, fechaLocal, sinTildes, nombrePropio, frase, MARCAS, mezclarColor, mezclarValor, colorFachada });
})();
