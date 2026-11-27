'use strict';
// «Descarga los datos» en fuentes.html: cada ficha trae fuente, licencia, cada cuánto, corte y un
// enlace a un archivo que de verdad está en site/. La licencia de la ficha es la que trae el archivo.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');

const sitio = path.join(__dirname, '..', 'site');
const fu = fs.readFileSync(path.join(sitio, 'fuentes.html'), 'utf8');
const fichas = [...fu.matchAll(/<article class="ficha"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]);
revisar('hay una ficha por archivo servido (9)', fichas.length === 9, String(fichas.length));

// La licencia del archivo, donde el archivo la declara.
function licenciaDe(archivo) {
  const t = fs.readFileSync(path.join(sitio, archivo), 'utf8').slice(0, 4000);
  const m = t.match(/"licencia":\{[^}]*?"nombre":"([^"]+)"/) || t.match(/"licencia":\s*\{\s*"nombre":\s*"([^"]+)"/);
  return m ? m[1] : null;
}
const normal = (s) => s.replace(/‑/g, '-').replace(/Creative Commons Attribution Share-Alike 4\.0/, 'CC BY-SA 4.0');

for (const f of fichas) {
  const titulo = (f.match(/<h3>([^<]+)<\/h3>/) || [])[1] || '?';
  const campos = [...f.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]).join();
  revisar(`${titulo}: fuente, licencia, cada cuánto y corte`, campos === 'Fuente,Licencia,Cada cuánto,Corte', campos);
  const enlace = (f.match(/class="ficha-bajar"><a href="([^"]+)" download>/) || [])[1];
  const existe = !!enlace && !/^https?:/.test(enlace) && fs.existsSync(path.join(sitio, enlace));
  revisar(`${titulo}: el enlace baja un archivo de site/`, existe, enlace);
  if (!existe) continue;
  const lic = (f.match(/<dt>Licencia<\/dt><dd><a [^>]+>([^<]+)<\/a>/) || [])[1];
  const delArchivo = licenciaDe(enlace);
  revisar(`${titulo}: la licencia coincide con la del archivo`, !delArchivo || normal(lic || '') === normal(delArchivo), `${lic} / ${delArchivo}`);
  const kb = fs.statSync(path.join(sitio, enlace)).size / 1000;
  const dice = (f.match(/, ([\d,]+) (KB|MB)<\/span>/) || []);
  const dicho = dice[1] ? parseFloat(dice[1].replace(',', '.')) * (dice[2] === 'MB' ? 1000 : 1) : NaN;
  revisar(`${titulo}: el tamaño dicho se parece al real`, Math.abs(dicho - kb) / kb < 0.15, `${dicho} / ${kb.toFixed(0)} KB`);
}
revisar('fuentes.html enlaza llms.txt', /href="llms\.txt"/.test(fu));
revisar('ningún archivo de descarga apunta fuera del sitio', !fichas.some((f) => /ficha-bajar"><a href="https?:/.test(f)));

// llms.txt: cada archivo de las fichas sale con su URL completa y su licencia, y nada apunta a un
// archivo que el sitio no tenga.
const llms = fs.readFileSync(path.join(sitio, 'llms.txt'), 'utf8');
const BASE = 'https://caamanoluismiguel.github.io/gemelo-bogota/';
for (const f of fichas) {
  const enlace = (f.match(/class="ficha-bajar"><a href="([^"]+)"/) || [])[1];
  const lic = normal((f.match(/<dt>Licencia<\/dt><dd><a [^>]+>([^<]+)<\/a>/) || [])[1] || '');
  const linea = llms.split('\n').find((l) => l.includes('(' + BASE + enlace + ')')) || '';
  revisar(`llms.txt: ${enlace} con su licencia ${lic}`, linea.includes(lic), linea.slice(0, 80));
}
const propias = [...llms.matchAll(/https:\/\/caamanoluismiguel\.github\.io\/gemelo-bogota\/([^\s)]+)/g)].map((m) => m[1]);
const faltan = propias.filter((r) => !fs.existsSync(path.join(sitio, r)));
revisar('llms.txt: cada URL del sitio existe en site/', faltan.length === 0, faltan.join(', '));
revisar('llms.txt: lleva una línea en inglés', /^English: /m.test(llms));
revisar('llms.txt: sin rayas en la prosa', !/—| – /.test(llms));

cierre('descargas');
