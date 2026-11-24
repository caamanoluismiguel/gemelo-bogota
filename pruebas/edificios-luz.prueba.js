'use strict';
// Rondas 5 y 5b: la luz propia de los edificios y el tinte de la hora.
// El color viene de la luz, no de la pintura: sombra oscura y casi gris, sol de mediodía casi neutro.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');
const L = require(path.join(__dirname, '..', 'site', 'edificios-luz.js'));

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const tono = (c) => Math.max(...c) - Math.min(...c);   // cuánto se aleja del gris
const calidez = (c) => c[0] - c[2];
const tarde = L.paleta(10, 1), mediodia = L.paleta(70, 1), noche = L.paleta(-12, 1), nublado = L.paleta(40, 0.5);

const r = lum(mediodia.frio) / lum(mediodia.calido);
revisar('la sombra queda entre 35 % y 45 % de la cara al sol', r >= 0.35 && r <= 0.45, r.toFixed(2));
revisar('la sombra es casi gris, apenas fría', tono(mediodia.frio) < 0.05 && calidez(mediodia.frio) <= 0);
revisar('al mediodía la cara al sol es casi neutra', tono(mediodia.calido) < 0.03);
revisar('el sol bajo calienta más que el alto', calidez(tarde.calido) > calidez(mediodia.calido) && tono(tarde.calido) < 0.15);
revisar('de noche un solo tono', noche.calido.every((v, i) => Math.abs(v - noche.frio[i]) < 1e-9) && noche.noche === 1);
revisar('nublado: poca diferencia entre caras', lum(nublado.frio) / lum(nublado.calido) > r);
revisar('pie de fachada más oscuro, sin ensuciarlo', tarde.ao > 0.45 && tarde.ao < 0.6);
revisar('valores finitos a toda hora', [-20, -6, -3, 0, 2, 8, 20, 35, 60, 90].every((a) => {
  const p = L.paleta(a, 1); return [...p.calido, ...p.frio, ...p.bruma, p.techo, p.ao, p.noche].every(Number.isFinite);
}));
revisar('sin intensidad cuenta como sol directo', JSON.stringify(L.paleta(30)) === JSON.stringify(L.paleta(30, 1)));

// Tinte de la hora: multiplica toda la escena, nunca la aclara.
const t7 = L.tinte(8, 100, 1), t12 = L.tinte(75, 90, 1), tn = L.tinte(-12, 260, 1);
revisar('el tinte nunca aclara', [-20, -3, 0, 5, 20, 60].every((a) => L.tinte(a, 250, 1).every((v) => v <= 1 && v > 0.7)));
revisar('mañana ámbar suave, mediodía neutro', calidez(t7) > 0.05 && t12.every((v) => v > 0.99));
revisar('de noche el tinte es frío', calidez(tn) < -0.05);
revisar('la noche entra poco a poco en el crepúsculo civil', L.deNoche(0) === 0 && L.deNoche(-6) === 1 && Math.abs(L.deNoche(-3) - 0.5) < 1e-9);

// comun.js: mezclas para pasar del día a la noche sin salto.
const ventana = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'site', 'comun.js'), 'utf8'),
  { window: ventana, setInterval: () => 0, document: { querySelectorAll: () => [] }, Intl, Date, Math, Number, String, Object });
const B = ventana.Bogotwin;
revisar('mezclarColor va de un color al otro', B.mezclarColor('#000000', '#ffffff', 0.5).toLowerCase() === '#808080' && B.mezclarColor('#102030', '#ffffff', 0) === '#102030');
revisar('mezclarValor mezcla números y listas', Math.abs(B.mezclarValor(0, 10, 0.3) - 3) < 1e-9 && JSON.stringify(B.mezclarValor([0, 2], [10, 4], 0.5)) === '[5,3]');
cierre('Luz de los edificios');
