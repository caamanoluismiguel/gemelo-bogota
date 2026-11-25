'use strict';
// Pasos de UX del plan de jerarquía. Solo lee archivos y corre comun.js en una caja; no carga el
// sitio. Lo que se mide en el navegador (capturas a 390 px y en escritorio) va aparte.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
function cargarComun(extra) {
  const ventana = Object.assign({}, extra);
  const caja = Object.assign({ window: ventana, setInterval: () => 0, document: { querySelectorAll: () => [] }, Intl, Date, Math, Number, String, Object }, extra);
  vm.runInNewContext(leer('site/comun.js'), caja);
  return ventana.Bogotwin;
}
const B = cargarComun();
const mapa = leer('site/mapa.js');

// Paso 1. Las fichas con coma decimal y con su sello completo.
revisar('valorFicha(3.4) = «3,4»', B.valorFicha(3.4) === '3,4', B.valorFicha(3.4));
revisar('valorFicha("3.4") = «3,4» (número que llega como texto)', B.valorFicha('3.4') === '3,4', B.valorFicha('3.4'));
revisar('valorFicha(12) = «12» (un entero o un código no cambia)', B.valorFicha(12) === '12' && B.valorFicha('045A01') === '045A01');
revisar('valorFicha(1624) = «1624» y «1.624» no se vuelve 1,6', B.valorFicha(1624) === '1624' && B.valorFicha('1.624') === '1.624', B.valorFicha('1.624'));
revisar('valorFicha(null) y valorFicha("") = «sin dato»', B.valorFicha(null) === 'sin dato' && B.valorFicha('') === 'sin dato' && B.valorFicha(undefined) === 'sin dato');
revisar('ventana() de mapa.js escribe cada fila con valorFicha', /function ventana[\s\S]{0,300}B\.valorFicha\(v\)/.test(mapa));
const llamadas = [...mapa.matchAll(/\n\s*ventana\(ll,[\s\S]*?\);\n/g)].map((m) => m[0]);
const sinLicencia = llamadas.filter((c) => !/licencia:\s*\{\s*nombre:/.test(c)).map((c) => (c.match(/\[\['([^']+)'/) || [])[1]);
revisar('cada ficha del mapa trae marca, fuente y licencia', llamadas.length >= 6 && sinLicencia.length === 0,
  `${llamadas.length} fichas` + (sinLicencia.length ? '; sin licencia: ' + sinLicencia.join(', ') : ''));

// Paso 2. Movimiento reducido. MapLibre 5.24 ya salta sin animar easeTo, flyTo y fitBounds cuando
// el sistema pide menos movimiento, salvo si la llamada dice essential: true. Medido en el
// navegador: con «reduce» el 3D llega a zoom 17 en 150 ms sin moverse; sin él va en 13,5 y
// sigue moviéndose. Esta prueba cuida que nadie le ponga essential: true a un movimiento.
const js = fs.readdirSync(path.join(raiz, 'site')).filter((f) => f.endsWith('.js'));
const esenciales = js.filter((f) => /essential\s*:\s*true/.test(leer('site/' + f)));
revisar('ningún movimiento de cámara se salta el movimiento reducido (essential: true)', esenciales.length === 0, esenciales.join(', '));
const camara = js.filter((f) => /\.(easeTo|flyTo|fitBounds)\(/.test(leer('site/' + f)));
revisar('los movimientos de cámara son de MapLibre (easeTo, flyTo, fitBounds)', camara.length >= 2, camara.join(', '));
const animaciones = js.filter((f) => /requestAnimationFrame/.test(leer('site/' + f)) && !/sombras-capa|prueba-sombras/.test(f));
const css = leer('site/estilo.css');
revisar('sin animaciones propias fuera del mapa (CSS ni requestAnimationFrame)', !/@keyframes|animation\s*:|transition\s*:/.test(css) && animaciones.length === 0,
  animaciones.join(', '));

// Paso 3. De noche, el primer cuadro ya es de noche (antes de que llegue la barra del sol).
const SOL = require('../site/sol.js');
const Bsol = cargarComun();
Bsol.sol = SOL;
const bogota = (h, m) => SOL.desdeBogota(2026, 11, 24, h, m);
const n19 = Bsol.cieloArranque(bogota(19, 0));
revisar('19:00 en Bogotá: noche plena y cielo de noche', !!n19 && n19.noche === 1 && n19.cielo['sky-color'] === '#0a1628', n19 && `${n19.noche} ${n19.cielo['sky-color']}`);
const n12 = Bsol.cieloArranque(bogota(12, 0));
revisar('12:00 en Bogotá: sin cambio (cielo de día)', n12 === null);
const n18 = Bsol.cieloArranque(bogota(17, 55));
revisar('17:55 en Bogotá: crepúsculo, noche entre 0 y 1', !!n18 && n18.noche > 0 && n18.noche < 1, n18 && String(Math.round(n18.noche * 100) / 100));
revisar('sin sol.js no inventa la hora: devuelve null', B.cieloArranque(bogota(19, 0)) === null);
const barra = leer('site/sol-barra.js');
const cuerpo = (barra.match(/function cieloPorAltura[\s\S]*?\n  \}/) || [''])[0];
const hexComun = [...new Set(leer('site/comun.js').match(/(CIELO_NOCHE|CIELO_OCASO) = \{[^}]*\}/g).join(' ').match(/#[0-9a-f]{6}/gi))];
revisar('los colores de noche son los de cieloPorAltura en sol-barra.js', hexComun.length >= 6 && hexComun.every((h) => cuerpo.includes(h)), hexComun.join(' '));
const indice = leer('site/index.html');
revisar('index.html carga sol.js antes de mapa.js', indice.indexOf('src="sol.js"') > 0 && indice.indexOf('src="sol.js"') < indice.indexOf('src="mapa.js"'));
revisar('apagar las sombras antes de que llegue la barra quita la noche del arranque', /if \(B\.solBarra\) B\.solBarra\.apagar\(\); else if \(noche\) \{ fijarNoche\(false\)/.test(mapa));
revisar('poner3d usa cieloArranque al arrancar', /function poner3d[\s\S]{0,2500}B\.cieloArranque\(Date\.now\(\)\)/.test(mapa));

// Seguimientos del paso 3: la luz de los edificios y los árboles usan el sol del arranque, y el
// sector sale con mayúscula de nombre propio sin dañar los números romanos.
const a19 = Bsol.cieloArranque(bogota(19, 0));
revisar('cieloArranque trae la altura y el acimut del sol', !!a19 && Number.isFinite(a19.sol.altura) && a19.sol.altura < 0 && Number.isFinite(a19.sol.azimut));
revisar('edificios-luz.js y arboles.js leen el sol del arranque', /solArranque/.test(leer('site/edificios-luz.js')) && /solArranque/.test(leer('site/arboles.js')));
revisar('mapa.js suelta el sol del arranque al apagar las sombras', /if \(!cajaSombras\.checked\) \{ B\.solArranque = null;/.test(mapa));
for (const [de, a] of [['TIBABUYES II', 'Tibabuyes II'], ['ENGATIVA VI', 'Engativá VI'], ['VIVA', 'Viva'], ['IVAN', 'Ivan'], ['BOSA IX', 'Bosa IX']]) {
  revisar(`nombrePropio: ${de} da ${a}`, B.nombrePropio(de) === a, B.nombrePropio(de));
}
revisar('la ficha del sector pasa el nombre por nombrePropio', /\['Sector', B\.nombrePropio\(/.test(mapa));

// Pasos 4 a 10. Lo que se puede revisar sin navegador; las medidas van en las capturas.
const html = leer('site/index.html');
const panelJs = leer('site/panel.js');
const fuentesHtml = leer('site/fuentes.html');
const tramo = (id) => { const i = html.indexOf(`id="${id}"`); if (i < 0) return ''; const j = html.indexOf('role="tabpanel"', i + 10); return html.slice(i, j > 0 ? j : html.indexOf('<footer', i)); };
revisar('paso 4: franja del ahora con tres cifras que abren su pestaña', /id="ahora-franja"/.test(html) && ['franja-temp', 'franja-lluvia', 'franja-aire'].every((id) => new RegExp(`id="${id}" data-ir="(ahora|dias)"`).test(html)));
revisar('paso 4: la franja escucha el cielo, el pronóstico y el aire', ['bogotwin:cielo', 'bogotwin:pronostico', 'bogotwin:aire'].every((e) => panelJs.includes(`'${e}'`)) && /bogotwin:pronostico/.test(leer('site/pronostico.js')));
revisar('paso 4: la franja anuncia con aria-live solo cuando cambia una cifra', /id="franja-voz" aria-live="polite"/.test(html) && /return antes !== '';/.test(panelJs));
revisar('paso 5: el panel arranca asomado, sin depender del mapa', /data-hoja="asomada"/.test(html) && /ponerHoja\('asomada'\)/.test(panelJs) && html.indexOf('src="panel.js"') < html.indexOf('src="mapa.js"'));
revisar('paso 5: mapa.js ya no pliega el panel por su cuenta', !/boton\.textContent = si \? 'Ver datos'/.test(mapa) && /const plegar = \(si\) => ui\.abrir\(!si\)/.test(mapa));
const tabsHtml = [...html.matchAll(/role="tab" id="pe-(\w+)" aria-controls="pa-(\w+)"/g)];
revisar('paso 6: cuatro pestañas en un tablist, cada una con su panel', /class="pestanas" role="tablist"/.test(html) && tabsHtml.length === 4 && tabsHtml.every((m) => m[1] === m[2] && new RegExp(`role="tabpanel" id="pa-${m[1]}" aria-labelledby="pe-${m[1]}"`).test(html)),
  tabsHtml.map((m) => m[1]).join(' '));
revisar('paso 6: flechas, Inicio y Fin, y la pestaña en ?p=', ['ArrowRight', 'ArrowLeft', "'Home'", "'End'"].every((k) => panelJs.includes(k)) && /q\.set\('p', p\)/.test(panelJs) && /get\('p'\)/.test(panelJs));
revisar('paso 6: el escenario abre en «Probar»', /ui\.elegir\('probar'\)/.test(mapa) && /id="pe-probar"[^>]*class="[^"]*solo-sombras|class="solo-sombras"[^>]*id="pe-probar"|id="pe-probar"/.test(html));
revisar('paso 7: «Cómo leer cada dato» sale con el botón «?»', /id="ayuda-marcas"[^>]*aria-controls="marcas-ayuda"/.test(html) && /id="marcas-ayuda"[^>]*hidden/.test(html));
revisar('paso 7: «Cómo se hizo» al pie de «La ciudad» y en fuentes.html', /id="sombras-como"[\s\S]*Cómo se hizo/.test(tramo('pa-ciudad')) && /id="como-se-hizo"/.test(fuentesHtml) && /Koschmieder/.test(fuentesHtml));
for (const p of ['pa-ahora', 'pa-dias', 'pa-ciudad', 'pa-probar']) {
  const t = tramo(p).replace(/<details[\s\S]*?<\/details>/g, '');
  const marcas = (t.match(/class="marca/g) || []).length, notas = (t.match(/class="nota[ "]/g) || []).length;
  revisar(`paso 7: ${p} trae 12 marcas o menos y 10 notas o menos a la vista`, marcas <= 12 && notas <= 10, `${marcas} marcas, ${notas} notas`);
}
const css2 = leer('site/estilo.css');
const regla = (sel) => (css2.match(new RegExp(sel.replace(/[[\]"]/g, (c) => '\\' + c) + '\\s*\\{([^}]*)\\}')) || ['', ''])[1];
revisar('paso 8: inferido y estimado ya no se ven iguales (fondo en estimado, borde en inferido)', /background/.test(regla('.marca[data-marca="estimado"]')) && !/background/.test(regla('.marca[data-marca="inferido"]')));
revisar('paso 8: supuesto va punteado y el sello viejo con borde ámbar', /dotted/.test(regla('.marca[data-marca="supuesto"]')) && /\.sello:has\(\.edad\.viejo\)/.test(css2));
revisar('paso 8: meta() usa B.sello', /function meta\([^)]*\) \{\s*const m = el\('div', \{ clase: 'meta' \}, sello\(/.test(leer('site/comun.js')));
revisar('sin degradados en el CSS', !/gradient\(/.test(css2));
const ley = (html.match(/<div class="leyenda-mapa" id="leyenda-mapa"[\s\S]*?\n<\/div>/) || [''])[0];
const panelHtml = (html.match(/<aside id="panel"[\s\S]*?<\/aside>/) || [''])[0];
revisar('paso 9: una sola leyenda flotante con pisos, lluvia, bicis, canales y PM2,5', ['id="leyenda"', 'class="escala"', 'id="lluvia-leyenda"', 'id="bicis-leyenda"', 'id="canales-leyenda"', 'id="pm25-leyenda"'].every((x) => ley.includes(x) && !panelHtml.includes(x)));
revisar('paso 9: la leyenda en el teléfono se esconde con la hoja abierta', /#panel:not\(\[data-hoja="asomada"\]\) ~ \.leyenda-mapa \{ display: none; \}/.test(css2));
const colores = [...html.matchAll(/data-tipo="color"[^\n]*?(?:data-grupo="(\w+)"|id="(ver-[\w-]+)")|(?:data-grupo="(\w+)"|id="(ver-[\w-]+)")[^\n]*?data-tipo="color"/g)].map((m) => m[1] || m[2] || m[3] || m[4]);
const nombres = (mapa.match(/const NOMBRE_CAPA = \{[\s\S]*?\};/) || [''])[0];
revisar('paso 10: cada capa de color tiene su nombre para la línea que explica', colores.length >= 6 && colores.every((c) => nombres.includes(c.includes('-') ? `'${c}'` : `${c}:`)), colores.join(' '));
revisar('paso 10: prender una capa de color apaga las otras y lo dice', /function unaDeColor/.test(mapa) && /Apagamos \$\{/.test(mapa) && /id="capa-aviso" aria-live="polite"/.test(html));

cierre('ux');
