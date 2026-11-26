'use strict';
// Paso 0: las marcas de procedencia. Solo lee archivos; no carga el sitio.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const archivos = (dir, ext) => fs.readdirSync(path.join(raiz, dir), { recursive: true })
  .map(String).filter((f) => ext.some((e) => f.endsWith(e))).map((f) => path.join(dir, f));

// 1. Nada publicado dice «simulado».
const publicados = [...archivos('site', ['.html', '.js', '.css', '.json']), 'README.md',
  ...archivos('pipelines', ['.py', '.md', '.yml', '.json'])];
const conSimulado = publicados.filter((f) => /simulad/i.test(leer(f)));
revisar('«simulado» no aparece en site/, pipelines/ ni README', conSimulado.length === 0, conSimulado.join(', '));

// 2. Las leyendas traen las cinco marcas, con inferido incluido.
for (const f of ['site/index.html', 'site/fuentes.html']) {
  const t = leer(f);
  const faltan = ['medido', 'de_fuente', 'inferido', 'estimado', 'supuesto'].filter((m) => !t.includes(`data-marca="${m}"`));
  revisar(`${f}: la leyenda trae las cinco marcas`, faltan.length === 0, faltan.length ? 'faltan ' + faltan.join(', ') : '');
  // La línea de la leyenda (puede haber otras marcas inferido antes, como la de las sombras).
  const inf = [...t.matchAll(/data-marca="inferido">inferido<\/span>([^<]*)/g)].map((m) => m[1]).find((x) => /lo calculamos/.test(x)) || '';
  revisar(`${f}: inferido = lo calculamos aquí con datos de otros`, /lo calculamos aquí con datos de otros/.test(inf), inf.trim());
  // Ninguna línea junta supuesto con pronóstico.
  const malas = t.split('\n').filter((l) => /data-marca="supuesto"/.test(l) && /pron[oó]stic/i.test(l));
  revisar(`${f}: ninguna línea dice que supuesto es un pronóstico`, malas.length === 0, malas.join(' | ').slice(0, 120));
  // La línea de la leyenda (puede haber antes una marca suelta, como la del 3D).
  const sup = [...t.matchAll(/data-marca="supuesto">supuesto<\/span>([^<]*)/g)].map((m) => m[1]).find((x) => /pusimos nosotros/.test(x)) || '';
  revisar(`${f}: supuesto = un número que pusimos nosotros; no está medido`, /no está medido/.test(sup), sup.trim());
}

// 3. cielo.js no marca los pronósticos como supuesto y lee las marcas del JSON con marcaDe.
const cielo = leer('site/cielo.js');
revisar('cielo.js no usa «supuesto»', !/'supuesto'/.test(cielo));
revisar('cielo.js lee las marcas de los JSON con marcaDe', /marcaDe\(/.test(cielo));

// 4. comun.js traduce la marca vieja: un JSON ya guardado con "pronostico" sale como estimado.
const ventana = {};
const caja = { window: ventana, setInterval: () => 0, document: { querySelectorAll: () => [] }, Intl, Date, Math, Number, String, Object };
vm.runInNewContext(leer('site/comun.js'), caja);
const B = ventana.Bogotwin;
revisar('marcaDe("pronostico") = estimado (JSON viejo)', B && B.marcaDe('pronostico', 'estimado') === 'estimado');
revisar('marcaDe("estimado") = estimado (JSON nuevo)', B && B.marcaDe('estimado', 'medido') === 'estimado');
revisar('marcaDe("simulado") cae en la marca por defecto', B && B.marcaDe('simulado', 'estimado') === 'estimado');
revisar('marcaDe(nada) = de_fuente', B && B.marcaDe(undefined) === 'de_fuente');
revisar('rango con el mismo formato: 10,3 a 24,0', B && B.numPar(10.3, 24).join(' a ') === '10,3 a 24,0' && B.numPar(10, 24).join(' a ') === '10 a 24', B && B.numPar(10.3, 24).join(' a '));
revisar('la hora va con espacios duros', B && !/ /.test(B.horaLocal('2026-11-25T02:32:00Z')), B && B.horaLocal('2026-11-25T02:32:00Z'));
revisar('la lista de marcas ya no tiene simulado', B && !('simulado' in B.MARCAS) && 'inferido' in B.MARCAS);

// 5. Los scripts del pipeline escriben el vocabulario nuevo.
revisar('registrar.py escribe "estimado", no "pronostico"', !/"etiqueta":\s*"pronostico"/.test(leer('pipelines/noches-frias/registrar.py'))
  && /"etiqueta":\s*"estimado"/.test(leer('pipelines/noches-frias/registrar.py')));

cierre('Marcas');
