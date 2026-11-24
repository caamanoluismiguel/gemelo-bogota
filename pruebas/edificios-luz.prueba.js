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

// Fachadas: ladrillo y terracota con algunos pañetes claros; de 12 pisos arriba, concreto y vidrio.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const bajos = Array.from({ length: 11 }, (_, i) => hex(B.colorFachada(i + 1)));
const altos = Array.from({ length: 59 }, (_, i) => hex(B.colorFachada(i + 12)));
revisar('el color de fachada es estable para los mismos pisos', [1, 3, 7, 15, 40].every((p) => B.colorFachada(p) === B.colorFachada(p) && B.colorFachada(String(p)) === B.colorFachada(p)));
revisar('bajo 12 pisos casi todo es ladrillo (rojo sobre azul)', bajos.filter((c) => c[0] - c[2] > 0.12).length >= 8);
revisar('de 12 pisos arriba, tonos de concreto poco saturados', altos.every((c) => tono(c) < 0.1));
revisar('no hay dos tonos para un mismo edificio en zooms distintos', B.colorFachada(0) === B.colorFachada(1) && B.colorFachada(null) === B.colorFachada(1));
const sombraLadrillo = bajos[0].map((v, i) => v * mediodia.frio[i]), solLadrillo = bajos[0].map((v, i) => v * mediodia.calido[i]);
revisar('a la sombra el ladrillo conserva su tono', sombraLadrillo[0] > sombraLadrillo[2] && lum(sombraLadrillo) / lum(solLadrillo) < 0.5);
const fuente = fs.readFileSync(path.join(__dirname, '..', 'site', 'edificios-luz.js'), 'utf8');
revisar('el sombreador guarda el color de la fachada y apaga un poco el techo', /mix\(vec3\(gris\), v_base, 0\.92\)/.test(fuente) && /v_techo > 0\.5 \? mix\(vec3\(gris\), v_base, 0\.55\) \* 0\.86/.test(fuente));
cierre('Luz de los edificios');
