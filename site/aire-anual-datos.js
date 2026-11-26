'use strict';
// Cuentas de la capa «PM2,5 de todo 2025»: clases, colores, en qué franja cae un punto, área de
// cada clase y la frase que compara un valor con la guía de la OMS y la norma colombiana.
// No toca el mapa ni el DOM: lo prueba pruebas/aire-anual.prueba.js en Node.
(function () {
  const B = (window.Bogotwin = window.Bogotwin || {});

  // Cortes en µg/m³, promedio anual:
  //   5  guía anual de la OMS (2021)
  //   15 norma anual colombiana desde el 1 de enero de 2030 (Res. 2254 de 2017, tabla 2)
  //   25 norma anual colombiana vigente (Res. 2254 de 2017, tabla 1)
  // 10 y 20 solo parten los tramos en pasos iguales.
  const OMS = 5, META_2030 = 15, NORMA = 25;
  const CORTES = [5, 10, 15, 20, 25];
  // Secuencia plana de rosados a morado (ColorBrewer RdPu, 6 clases): se lee en escala de grises
  // y sin distinguir rojo de verde. Nada de degradados: cada franja es un color sólido.
  const COLORES = ['#feebe2', '#fcc5c0', '#fa9fb5', '#f768a1', '#c51b8a', '#7a0177'];
  const ETIQUETAS = [
    'Hasta 5: dentro de la guía de la OMS',
    'De 5 a 10',
    'De 10 a 15',
    'De 15 a 20: pasa la meta colombiana de 2030',
    'De 20 a 25',
    'Más de 25: pasa la norma anual colombiana'
  ];

  // Un valor justo en el corte queda en la clase de abajo: 25 cumple la norma, 25,1 la pasa.
  function clase(v) {
    let i = 0;
    while (i < CORTES.length && v > CORTES[i]) i++;
    return i;
  }
  const colorDe = (v) => COLORES[clase(v)];

  // Rayo hacia la derecha: un punto está dentro si cruza un número impar de bordes.
  function enAnillo(x, y, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  // Polígono GeoJSON: dentro del primer anillo y fuera de los huecos.
  function enPoligono(x, y, poli) {
    if (!poli.length || !enAnillo(x, y, poli[0])) return false;
    for (let k = 1; k < poli.length; k++) if (enAnillo(x, y, poli[k])) return false;
    return true;
  }
  function enGeometria(x, y, g) {
    if (!g) return false;
    if (g.type === 'Polygon') return enPoligono(x, y, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some((p) => enPoligono(x, y, p));
    return false;
  }
  // Franja de la SDA que cubre el punto, o null si cae fuera del área que interpola.
  function franjaEn(fc, lon, lat) {
    for (const f of fc.features) if (enGeometria(lon, lat, f.geometry)) return f;
    return null;
  }

  // Área en km² con la fórmula del trapecio sobre la esfera (radio medio 6371 km). Para una
  // ciudad del tamaño de Bogotá el error frente al elipsoide es menor al 1 %.
  function areaAnillo(anillo) {
    const R = 6371.0088, rad = Math.PI / 180;
    let s = 0;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      s += (anillo[i][0] - anillo[j][0]) * rad * (2 + Math.sin(anillo[j][1] * rad) + Math.sin(anillo[i][1] * rad));
    }
    return Math.abs(s * R * R / 2);
  }
  function areaKm2(g) {
    const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let a = 0;
    for (const p of polis) p.forEach((anillo, k) => { a += (k === 0 ? 1 : -1) * areaAnillo(anillo); });
    return a;
  }
  // Km² por clase, en el orden de COLORES.
  function areasPorClase(fc) {
    const a = COLORES.map(() => 0);
    for (const f of fc.features) a[clase(f.properties.pm25)] += areaKm2(f.geometry);
    return a;
  }

  const coma = (x, d = 1) => x.toFixed(d).replace('.', ',');
  const vecesTexto = (r) => r < 1.05 ? 'casi igual a' : `${coma(r)} veces`;

  // Frases para la ventana: cuántas veces la guía de la OMS y dónde queda frente a la norma.
  function comparar(v) {
    const veces = v / OMS;
    const oms = v <= OMS
      ? `Está dentro de la guía anual de la OMS (${OMS} µg/m³).`
      : `Es ${vecesTexto(veces)} la guía anual de la OMS (${OMS} µg/m³).`;
    let norma;
    if (v > NORMA) norma = `Pasa la norma anual colombiana (${NORMA} µg/m³).`;
    else if (v > META_2030) norma = `Queda bajo la norma anual colombiana de hoy (${NORMA} µg/m³), pero pasa la de 2030 (${META_2030} µg/m³).`;
    else norma = `Queda bajo la norma anual colombiana de hoy (${NORMA} µg/m³) y bajo la de 2030 (${META_2030} µg/m³).`;
    return { oms, norma, veces };
  }

  // Los nombres vienen en mayúsculas: se pasan a nombre propio sin romper las siglas.
  const SIGLAS = new Set(['IED', 'IPS', 'USS', 'CAPS', 'UPA', 'CAMI', 'CDI', 'SED', 'ESE', 'UCI', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'XX', 'XXI', 'EE', 'UU']);
  const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'para', 'por', 'con']);
  // Los nombres llegan sin tildes. Palabras que en un nombre propio siempre la llevan; la lista
  // es cerrada para no tildar una palabra que no la necesita.
  const TILDES = Object.fromEntries(('María José Jesús Ramón Julián Andrés Inés Tomás Nicolás Joaquín Agustín Benjamín Sebastián Martín Germán '
    + 'Simón Bolívar Nariño Darío Víctor Raúl César Héctor Rubén Álvaro Ángel Óscar Fátima Belén Lucía Sofía Rocío Mónica Verónica Angélica '
    + 'García González Rodríguez Martínez López Pérez Gómez Sánchez Ramírez Hernández Díaz Álvarez Jiménez Fernández Gutiérrez Benítez '
    + 'Domínguez Vásquez Vázquez Suárez Méndez Chávez Vélez Márquez Núñez Galán Rincón Garzón Martí Garcés Colón León Iván '
    + 'República América Panamá Japón Perú México Canadá Bogotá Usaquén Engativá Fontibón Cristóbal Mártires '
    + 'Técnico Técnica Pedagógico Pedagógica Académico Académica Básica Básico Tecnológico Tecnológica Educación Formación Integración '
    + 'Comunicación Promoción Unión Nación Concepción Asunción Agrícola Ecológico Científico Música Artística Informática Inglés Francés '
    + 'Policía Señora Niño Niños Niña Niñas Compañía Montaña Jardín Corazón Pío').split(' ').map((w) => [w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N'), w]));
  function nombre(s) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    return t.replace(/[\p{L}\p{N}]+/gu, (w, pos) => {
      // Va con mayúscula al empezar y después de un guion, un paréntesis o una coma.
      const primera = pos === 0 || /[-–(,.]\s*$/.test(t.slice(Math.max(0, pos - 3), pos));
      if (SIGLAS.has(w.toUpperCase()) && w === w.toUpperCase()) return w;
      const m = w.toLowerCase();
      // «SEDE A», «SEDE B»: la letra de la sede no es la preposición.
      if (w.length === 1 && /sede\s+$/i.test(t.slice(Math.max(0, pos - 6), pos))) return w.toUpperCase();
      if (!primera && MENORES.has(m)) return m;
      const p = m.charAt(0).toUpperCase() + m.slice(1);
      return TILDES[p] || p;
    });
  }

  B.aireAnualDatos = { nombre, TILDES, OMS, META_2030, NORMA, CORTES, COLORES, ETIQUETAS, clase, colorDe, enAnillo, enPoligono, franjaEn, areaKm2, areasPorClase, comparar, coma };
})();
