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
revisar('pie de fachada más oscuro, sin ensuciarlo', tarde.ao > 0.5 && tarde.ao < 0.7, tarde.ao.toFixed(2));
// Ronda 8: banda de contacto en el primer metro y medio, suave y más leve con cielo cubierto.
revisar('contacto con el suelo: oscurece poco (menos de 25 %)', [10, 70].every((a) => { const c = L.paleta(a, 1).contacto; return c > 0.1 && c < 0.25; }));
revisar('de noche el contacto pesa menos', L.paleta(-20, 1).contacto < L.paleta(40, 1).contacto);
revisar('al pie, ao y contacto juntos nunca bajan de 45 %', [-20, 0, 10, 70].every((a) => { const p = L.paleta(a, 1); return p.ao * (1 - p.contacto) >= 0.45; }));
revisar('valores finitos a toda hora', [-20, -6, -3, 0, 2, 8, 20, 35, 60, 90].every((a) => {
  const p = L.paleta(a, 1); return [...p.calido, ...p.frio, ...p.bruma, p.techo, p.ao, p.contacto, p.noche].every(Number.isFinite);
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

// Ronda 7: color por edificio («tono» de la tesela), sin perder la clave por pisos.
revisar('con tono, el color sale de la tono y es estable', [0, 5, 15].every((t) => B.colorFachada(3, t) === B.colorFachada(3, String(t))) && B.colorFachada(3, 4) !== B.colorFachada(3, 5));
revisar('sin tono, el mismo color de antes (teselas viejas y de lejos)', [1, 2, 6, 11, 12, 30].every((p) => B.colorFachada(p, undefined) === B.colorFachada(p) && B.colorFachada(p, null) === B.colorFachada(p)));
const conTonoBajos = Array.from({ length: 16 }, (_, t) => hex(B.colorFachada(2, t)));
const conTonoAltos = Array.from({ length: 16 }, (_, t) => hex(B.colorFachada(20, t)));
revisar('con tono, bajo 12 pisos sigue siendo ladrillo casi siempre', conTonoBajos.filter((c) => c[0] - c[2] > 0.12).length >= 12 && new Set(conTonoBajos.map(String)).size === 16);
revisar('con tono, las torres siguen en concreto poco saturado', conTonoAltos.every((c) => tono(c) < 0.1));
const ex = B.exprFachada(['literal', 'x'], (c) => c.toUpperCase());
revisar('la expresión de MapLibre cae a la de pisos sin tono', ex[0] === 'case' && JSON.stringify(ex[1]) === JSON.stringify(['!', ['has', 'tono']]) && ex[2][1] === 'x');
revisar('la expresión usa la misma paleta que colorFachada, con la mezcla de noche', JSON.stringify(ex).includes(B.colorFachada(2, 0).toUpperCase()) && JSON.stringify(ex).includes(B.colorFachada(20, 0).toUpperCase()));

// Ventanas, luces y bruma.
const ev = (a) => L.encendidas(a, 260), ma = (a) => L.encendidas(a, 100);
revisar('de día no hay ventanas prendidas', [-1, 0, 10, 60].every((a) => ev(a) === 0 && ma(a) === 0));
revisar('en la noche temprana cerca de un tercio, nunca más', ev(-15) > 0.25 && [-3, -6, -20, -40, -70].every((a) => ev(a) <= 0.32));
revisar('se apagan hacia la madrugada y suben un poco antes del alba', ev(-70) < ev(-20) && ma(-10) > ma(-60) && ma(-60) > 0.08);
revisar('la luz entra de a poco, sin saltos', [-2, -2.5, -3, -4, -5, -6].every((a, i, l) => i === 0 || ev(a) >= ev(l[i - 1])) && ev(-2.1) < 0.02);
const bd = L.brumaHora(60, 180, 1), bo = L.brumaHora(5, 260, 1), bn = L.brumaHora(-20, 260, 1);
revisar('bruma de día azul pálida', bd[2] > bd[0] && lum(bd) > 0.75);
revisar('bruma más cálida al ocaso y oscura de noche', calidez(bo) > 0.15 && lum(bn) < 0.2);
revisar('brumaHex da un color válido', /^#[0-9a-f]{6}$/.test(L.brumaHex(60, 180, 1)) && /^#[0-9a-f]{6}$/.test(L.brumaHex(-90, 0, 0.5)));
revisar('paleta lleva la bruma de la hora y la parte prendida', JSON.stringify(L.paleta(5, 1, 260).bruma.slice(0, 3)) === JSON.stringify(bo) && L.paleta(-15, 1, 260).encendidas === ev(-15));
revisar('el sombreador dibuja pisos cada 3 m y ventanas que se apagan de lejos', /floor\(v_h \/ 3\.0\)/.test(fuente) && /fwidth\(v_u\)/.test(fuente) && /step\(35\.5, v_alto\)/.test(fuente));
revisar('la bruma del sombreador crece con la distancia', /exp\(-max\(v_lejos - u_lejos_m\.x, 0\.0\) \/ u_lejos_m\.y\)/.test(fuente));
revisar('sin parpadeo: la luz de cada ventana depende solo de ventana, piso, edificio y hora', !/u_tiempo|performance\.now\(\)\s*\*/.test(fuente) && /step\(azar\(vec3\(col, piso, v_semilla \+ 17\.0\)\), cuota\)/.test(fuente));
revisar('la franja de contacto mide 1,5 m, se va cuando el píxel pasa de medio metro y no toca el techo', /smoothstep\(0\.0, 1\.5, hs\)/.test(fuente) && /franja = 1\.0 - smoothstep\(0\.25, 0\.6, fwidth\(v_h\)\)/.test(fuente) && /if \(v_techo > 0\.5\) c \*= u_techo;/.test(fuente));
// Ronda 9: sin rayas claras entre techos vecinos. El suelo de cada edificio se redondea a
// medio piso: dos centroides a 10 m en la misma ladera ya no quedan a 30 cm uno del otro.
revisar('el suelo de cada edificio se redondea a medio piso (1,5 m)', /const float ESCALON = 1\.5;/.test(fuente) && /ESCALON \* floor\(elevacion\(a_centroid\) \/ ESCALON \+ 0\.5\)/.test(fuente));
const esc = (e) => 1.5 * Math.floor(e / 1.5 + 0.5);
// Relieve medido en los centroides de vecinos de la Calle 72 (ronda 9): 3 pisos y 1 piso.
const vecinos = [[2584.8, 2585.13, 2585.55], [2585.35, 2585.46, 2585.72, 2585.63, 2585.94]];
const saltos = []; for (const g of vecinos) g.forEach((a, i) => g.slice(i + 1).forEach((b) => saltos.push(Math.abs(esc(a) - esc(b)), Math.abs(a - b))));
const conRedondeo = saltos.filter((_, i) => i % 2 === 0), sinRedondeo = saltos.filter((_, i) => i % 2 === 1);
revisar('entre vecinos del mismo alto no quedan muros de menos de 1,5 m (antes 0,1 a 0,8 m)', conRedondeo.every((d) => d === 0 || d >= 1.5) && sinRedondeo.some((d) => d > 0.05 && d < 1.5),
  `${conRedondeo.filter((d) => d > 0).length} escalones de 1,5 m, ${conRedondeo.filter((d) => d === 0).length} pares parejos`);
revisar('el redondeo mueve el techo 75 cm o menos', [2584.8, 2585.13, 2585.55, 2586.3, 2600.74].every((e) => Math.abs(esc(e) - e) <= 0.75));
// Ronda 10: foto aérea en los techos.
revisar('sin foto (2D, error o sin teselas) el techo es el tono de siempre', L.pesoFoto(6, 0, 1) === 0 && L.pesoFoto(6, 1, 0) === 0 && L.pesoFoto(6, NaN, 1) === 0
  && /if \(v_techo > 0\.5 && u_foto > 0\.0 && fotoAlto > 0\.0\)/.test(fuente) && /gl\.uniform1f\(loc\.u_foto, conFoto \? F\.opacidad : 0\)/.test(fuente)
  && /const conFoto = F\.lista && F\.mos\.length === 2 && F\.opacidad > 0;/.test(fuente));
revisar('el peso de la foto en el sombreador sale de la misma cuenta que pesoFoto', /float fotoAlto = 1\.0 - smoothstep\(u_foto_alto\.x, u_foto_alto\.y, v_alto\);/.test(fuente) && /float peso = 0\.92 \* u_foto \* clamp\(fs\.a, 0\.0, 1\.0\) \* fotoAlto;/.test(fuente)
  && /if \(fs\.a < 0\.999\) fs \+= textureGrad\(u_fotoL, v_uvL, gLx, gLy\) \* dentro\(v_uvL\) \* \(1\.0 - fs\.a\)/.test(fuente)
  && Math.abs(L.pesoFoto(9, 1, 1) - 0.92) < 1e-9);
revisar('casas y edificios bajos llevan foto; las torres no (la foto inclina los altos)', L.pesoFoto(3, 1, 1) > 0.9 && L.pesoFoto(12, 1, 1) > 0.9 && L.pesoFoto(36, 1, 1) === 0
  && [3, 9, 15, 18, 21, 24, 27].every((h, i, l) => i === 0 || L.pesoFoto(h, 1, 1) <= L.pesoFoto(l[i - 1], 1, 1)));
revisar('una tesela a medio entrar pesa a medias (sin parpadeo)', Math.abs(L.pesoFoto(6, 0.5, 1) - 0.46) < 1e-9 && Math.abs(L.pesoFoto(6, 1, 0.5) - 0.46) < 1e-9);
revisar('el ajuste de color es el mismo de la capa raster de MapLibre', L.factorSaturacion(-0.22) === 0.22 && Math.abs(L.factorContraste(-0.08) - 0.92) < 1e-12
  && Math.abs(L.factorContraste(0.5) - 2) < 1e-12 && L.factorSaturacion(0) === 0);
{
  const S = 0.0001, [ox, oy] = L.origenCascada(0.3, 0.47, 15, S);
  const dentro = (x, y) => x > ox && x < ox + S && y > oy && y < oy + S;
  const [ox2] = L.origenCascada(0.3 + S / 50, 0.47, 15, S);
  revisar('el mosaico cubre la cámara y lo que tiene adelante, y no se mueve por un paso corto', dentro(0.3, 0.47) && dentro(0.3 + Math.sin(15 * Math.PI / 180) * 0.7 * S, 0.47 - Math.cos(15 * Math.PI / 180) * 0.7 * S) && ox2 === ox);
}
revisar('el mosaico cercano es más fino que la foto z18 y el lejano cubre la foto del piso', L.CASCADAS[0].lado / L.CASCADAS[0].px < 0.6 && L.CASCADAS[1].lado >= 2000 && L.CASCADAS.every((c) => c.px <= 2048));
revisar('la foto se lee con las derivadas tomadas fuera de los if (sin costuras en el mip)', /vec2 gCx = dFdx\(v_uvC\)/.test(fuente) && /textureGrad\(u_fotoC, v_uvC, gCx, gCy\)/.test(fuente) && /generateMipmap/.test(fuente));

// Ronda 10: tipos de fachada por edificio, estables de día y de noche.
const mapaJs = fs.readFileSync(path.join(__dirname, '..', 'site', 'mapa.js'), 'utf8');
const nocheMat = (mapaJs.match(/const NOCHE_MATERIAL = '(#[0-9a-f]{6})'/i) || [])[1];
revisar('el color de noche de las pruebas es el de mapa.js', !!nocheMat && L.hexRgb(nocheMat).every((v, i) => Math.abs(v - L.NOCHE_MATERIAL[i]) < 1e-9), nocheMat);
const PAL = B.PALETA_FACHADA.map(L.hexRgb), GRUPO = L.gruposPaleta(PAL);
const indice = (rgb) => GRUPO[L.indicePaleta(rgb, PAL)];
const usados = new Set();
for (let p = 1; p <= 60; p++) { usados.add(B.colorFachada(p)); for (let t = 0; t < 16; t++) usados.add(B.colorFachada(p, t)); }
revisar('la paleta del sombreador tiene todos los colores de fachada y cabe en 24', PAL.length <= 24 && [...usados].every((c) => B.PALETA_FACHADA.includes(c)), `${PAL.length} colores`);
let saltan = 0, total = 0;
for (const c of B.PALETA_FACHADA) {
  const i0 = indice(L.hexRgb(c));
  for (let k = 0; k <= 20; k++) {
    const mezclado = L.hexRgb(B.mezclarColor(c, nocheMat, 0.62 * k / 20));   // redondeado a 8 bits, como llega a la GPU
    total++;
    if (indice(mezclado) !== i0 || i0 !== GRUPO[B.PALETA_FACHADA.indexOf(c)]) saltan++;
  }
}
revisar('los grupos de color dejan casi todos los colores aparte', new Set(GRUPO).size >= PAL.length - 5, `${new Set(GRUPO).size} grupos de ${PAL.length}`);
revisar('al pasar del día a la noche ningún edificio cambia de fachada ni de ventanas', saltan === 0, `${saltan} de ${total}`);
revisar('la semilla del sombreador es la de semilla() en JS', /v_semilla = floor\(fract\(ip \* 0\.754877 \+ pisos \* 0\.56984 \+ ip \* pisos \* 0\.0131\) \* 997\.0\)/.test(fuente)
  && /hA < 0\.4 \? 4 : hA < 0\.75 \? 5 : 6\) : \(hA < 0\.42 \? 0 : hA < 0\.62 \? 1 : hA < 0\.84 \? 2 : 3\)/.test(fuente));
{
  // Reparto en los edificios que salen de verdad: cada tono de cada número de pisos.
  const cuenta = new Array(7).fill(0), tiendas = [0, 0], tintes = [0, 0, 0, 0];
  let bajosN = 0, torresN = 0;
  for (let p = 1; p <= 40; p++) for (let t = 0; t < 16; t++) {
    const alto = 3 * p, torre = alto > 35.5;
    const s = L.semilla(indice(L.hexRgb(B.colorFachada(p, t))), alto);
    const f = L.fachada(s, torre, alto);
    cuenta[f.tipo]++;
    if (torre) { torresN++; tintes[f.tinte]++; } else bajosN++;
    if (!torre && alto < 21.5) { tiendas[1]++; if (f.tienda) tiendas[0]++; }
  }
  const parte = (i, n) => cuenta[i] / n;
  const msg = L.TIPOS_FACHADA.map((n, i) => `${n} ${Math.round(100 * parte(i, i < 4 ? bajosN : torresN))} %`).join(', ');
  revisar('edificios bajos: los cuatro tipos salen, ninguno pasa de la mitad', [0, 1, 2, 3].every((i) => parte(i, bajosN) >= 0.08 && parte(i, bajosN) <= 0.5), msg);
  revisar('torres: los tres tipos salen, ninguno pasa de 60 %', [4, 5, 6].every((i) => parte(i, torresN) >= 0.12 && parte(i, torresN) <= 0.6), msg);
  revisar('locales en el primer piso de una parte de los edificios bajos (25 a 75 %)', tiendas[0] / tiendas[1] >= 0.25 && tiendas[0] / tiendas[1] <= 0.75, `${tiendas[0]} de ${tiendas[1]}`);
  revisar('los cuatro tintes de vidrio salen en las torres', tintes.every((n) => n > 0), tintes.join(', '));
  revisar('dos semillas seguidas no dan siempre el mismo tipo', new Set(Array.from({ length: 20 }, (_, s) => L.fachada(s, false, 9).tipo)).size === 4);
}
// Bruma del aire (PM2,5, de 0 a 1, la pone sol-barra.js).
const sinAire = L.paleta(40, 1, 200), conAire = L.paleta(40, 1, 200, 1), medioAire = L.paleta(40, 1, 200, 0.5);
revisar('sin aire la paleta es la de siempre', JSON.stringify(L.paleta(40, 1, 200, 0)) === JSON.stringify(sinAire) && sinAire.lejos[0] === 1 && sinAire.lejos[1] === 1);
revisar('con aire la bruma empieza más cerca y crece más rápido', conAire.lejos[0] < medioAire.lejos[0] && medioAire.lejos[0] < 1 && conAire.lejos[1] < medioAire.lejos[1]);
revisar('con aire la bruma pesa más, sin borrar del todo', conAire.bruma[3] > sinAire.bruma[3] && conAire.bruma[3] <= 0.9);
revisar('con aire el color de la bruma se agrisa', (() => { const s = sinAire.bruma, c = conAire.bruma; return (Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3))) < (Math.max(...s.slice(0, 3)) - Math.min(...s.slice(0, 3))); })());
revisar('aire fuera de rango se recorta', JSON.stringify(L.paleta(40, 1, 200, 5)) === JSON.stringify(conAire) && JSON.stringify(L.paleta(40, 1, 200, -1)) === JSON.stringify(sinAire));
revisar('brumaHex y brumaAireHex dan colores', /^#[0-9a-f]{6}$/.test(L.brumaHex(40, 200, 1, 0.5)) && /^#[0-9a-f]{6}$/.test(L.brumaAireHex(-20)));

cierre('Luz de los edificios');
