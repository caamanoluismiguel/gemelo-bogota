'use strict';
// La barra del sol y las capas no pueden quedar esperando un 'load' que ya pasó. 'load' sale una
// sola vez; después isStyleLoaded() puede dar falso un rato y mapa.once('load') nunca llega.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'site', 'mapa.js'), 'utf8');
revisar('mapa.js guarda que el mapa ya cargó', /let mapaCargado = false;/.test(fuente) && /mapa\.once\('load', \(\) => \{ mapaCargado = true; \}\)/.test(fuente));
revisar('trasCarga corre ya si el mapa cargó', /const trasCarga = \(fn\) => \{ if \(mapaCargado \|\| mapa\.loaded\(\)\) fn\(\); else mapa\.once\('load', fn\); \}/.test(fuente));
revisar('la barra del sol entra con trasCarga', /trasCarga\(ir\)/.test(fuente));
const esperas = (fuente.match(/mapa\.once\('load'/g) || []).length;
revisar("solo quedan tres mapa.once('load'): la marca, trasCarga y el arranque del 3D", esperas === 3, String(esperas));
revisar("ningún isStyleLoaded() decide si esperar 'load'", !/isStyleLoaded\(\)\) [^;]*else mapa\.once\('load'/.test(fuente));

// La misma lógica, con un mapa de mentira que ya cargó y cuyo estilo está ocupado.
function mapaFalso() {
  const oyentes = [];
  return { cargado: false, estiloListo: true, once(ev, fn) { if (ev === 'load') oyentes.push(fn); },
    loaded() { return this.cargado && this.estiloListo; }, isStyleLoaded() { return this.estiloListo; },
    disparar() { this.cargado = true; oyentes.splice(0).forEach((f) => f()); } };
}
const cuerpo = /let mapaCargado = false;[\s\S]*?const trasCarga = [^\n]*\n/.exec(fuente)[0];
const hacer = new Function('mapa', cuerpo + 'return trasCarga;');
const m = mapaFalso();
const trasCarga = hacer(m);
let antes = 0; trasCarga(() => antes++);
revisar('antes de cargar espera', antes === 0);
m.disparar();
revisar('al cargar corre lo que esperaba', antes === 1);
m.estiloListo = false;   // una fuente nueva cargando: isStyleLoaded() y loaded() dan falso
let despues = 0; trasCarga(() => despues++);
revisar('después de cargar corre ya, aunque el estilo esté ocupado', despues === 1);
cierre('Mapa: esperar la carga una sola vez');
