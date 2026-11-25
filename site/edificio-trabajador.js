'use strict';
// Trabajador del escenario «Edificio nuevo»: cuenta el año fuera del hilo del mapa.
// Usa los mismos módulos que el visor y que las pruebas, así que da las mismas cifras.
// Esos módulos se registran en Bogotwin solo donde hay document; aquí no lo hay, así que
// se pone uno vacío antes de cargarlos (no se usa para nada más).
self.document = self.document || {};
importScripts('sol.js', 'sombra-geom.js', 'horizonte.js', 'edificio-calculo.js');
const C = self.Bogotwin.edificioCalculo, HZ = self.Bogotwin.horizonte;
let R = null, claveR = null;

// Mensaje: { id, clave, rejilla: { construcciones, arboles, lote } | null, pts, pisos, cerros: { az, hz } | null, patio: [x, y] | null }
self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.rejilla) { R = C.armarRejilla(m.rejilla); claveR = m.clave; }
    if (!R || claveR !== m.clave) throw new Error('la rejilla no es la de este lote');
    const t0 = performance.now();
    const cerros = m.cerros ? (az) => HZ.enAzimut(m.cerros.az, m.cerros.hz, az) : null;
    const res = C.metricas(R, m.pts, m.pisos, { cerros, patio: m.patio });
    self.postMessage({ id: m.id, res, ms: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e && e.message || e) });
  }
};
