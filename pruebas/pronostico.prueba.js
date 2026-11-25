'use strict';
// Pronóstico y lo que se pide en cada carga: la hora de lluvia más alta nunca es una que ya
// pasó, los rótulos del eje no se montan, la pestaña tiene ícono (sin él, el navegador pide
// /favicon.ico y da 404 en cada carga) y el servidor local da ultima.json como pages.yml.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { spawn } = require('child_process');
const { revisar, cierre } = require('./util');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const caja = { window: {} };
vm.createContext(caja);
vm.runInContext(leer('site/vivo-datos.js'), caja);
const V = caja.window.Bogotwin.vivo;

// 1. Resumen de 24 horas: solo desde ahora.
const H = 3600000;
const ahora = Date.parse('2026-11-25T00:30:00Z'); // 7:30 p. m. en Bogotá
const horas = [];
for (let i = -1; i <= 48; i++) {
  const t = Date.parse('2026-11-25T00:00:00Z') + i * H;
  horas.push({ t, temp: 14 + (i % 5), prob: i === 0 ? 90 : i === -1 ? 95 : i === 5 ? 60 : i === 30 ? 99 : 10 });
}
const r = V.resumen24(horas, ahora);
revisar('la hora de lluvia más alta es futura', r.lluvia && r.lluvia.t >= ahora, r.lluvia && new Date(r.lluvia.t).toISOString());
revisar('ni la hora en curso ni la anterior cuentan (90 % y 95 % quedan fuera)', r.lluvia.prob === 60);
revisar('lo que pasa después de 24 horas no entra (99 % a las 30 h)', r.lluvia.prob !== 99);
revisar('24 horas desde ahora', r.horas === 24, String(r.horas));
revisar('temperatura mínima y máxima salen de esas horas', r.tmin === 14 && r.tmax === 18);
const vacio = V.resumen24(horas.slice(0, 1), ahora);
revisar('sin horas futuras: sin lluvia ni temperatura, sin romperse', vacio.lluvia === null && vacio.tmin === null && vacio.horas === 0);
const tx = leer('site/pronostico.js');
revisar('pronostico.js usa resumen24 y ya no corta las primeras 25 horas', tx.includes('V.resumen24(horas') && !tx.includes('slice(0, 25)'));

// 2. Rótulos del eje: el caso de 48 h que se montaba al final (12 m y 6 p. m.).
const W = 320, iz = 30, de = 6;
const x = (i) => iz + (W - iz - de) * i / 48;
const marcas = [];
// La gráfica arranca a las 7 p. m.: día, 6 a. m., 12 m, 6 p. m., día, ... y el último 6 p. m. en x = 308.
for (let i = 5, hb = 0; i <= 48; i += 6, hb = (hb + 6) % 24) {
  marcas.push({ x: x(i), dia: hb === 0, texto: hb === 0 ? (i < 24 ? 'mié 25' : 'jue 26') : hb === 12 ? '12 m' : hb === 6 ? '6 a. m.' : '6 p. m.' });
}
revisar('el caso trae el 6 p. m. pegado al borde derecho', marcas[marcas.length - 1].texto === '6 p. m.' && marcas[marcas.length - 1].x > W - 18);
const puestos = V.rotulosEje(marcas, 2, W - 1);
const cajas = puestos.map((p) => {
  const w = V.anchoRotulo(p.texto, p.dia);
  const izq = p.ancla === 'end' ? p.x - w : p.ancla === 'start' ? p.x : p.x - w / 2;
  return [izq, izq + w, p.texto];
});
let monta = '';
for (let i = 1; i < cajas.length; i++) if (cajas[i][0] < cajas[i - 1][1]) monta = `${cajas[i - 1][2]} con ${cajas[i][2]}`;
revisar('ningún rótulo se monta sobre otro', !monta, monta);
revisar('ninguno se sale de la gráfica', cajas.every(([a, b]) => a >= 2 && b <= W - 1));
revisar('los días quedan siempre', puestos.filter((p) => p.dia).length === marcas.filter((m) => m.dia).length);
revisar('el rótulo del borde derecho se ancla a la derecha o se quita', puestos.every((p) => p.x < W - 20 || p.ancla === 'end'));
const dos = V.rotulosEje([{ x: 280, dia: false, texto: '12 m' }, { x: 300, dia: false, texto: '6 p. m.' }], 2, W - 1);
revisar('dos rótulos muy juntos: queda uno solo', dos.length === 1 && dos[0].texto === '12 m');
revisar('el ancho estimado de «6 p. m.» no es cero ni absurdo', V.anchoRotulo('6 p. m.') > 20 && V.anchoRotulo('6 p. m.') < 40);

// 3. Ícono de la pestaña en cada página.
revisar('site/icono.svg existe y es SVG', /^<svg[\s\S]*<\/svg>\s*$/.test(leer('site/icono.svg')));
for (const f of ['site/index.html', 'site/fuentes.html', 'site/prueba-sombras.html']) {
  revisar(`${f} enlaza el ícono`, leer(f).includes('<link rel="icon" href="icono.svg" type="image/svg+xml">'));
}
revisar('el ícono no lleva degradados', !/Gradient/i.test(leer('site/icono.svg')));

// 4. Servidor local: ultima.json es el último día de data/noches-frias, como en pages.yml.
const dias = fs.readdirSync(path.join(raiz, 'data', 'noches-frias')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const puerto = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn('python3', [path.join(__dirname, 'servir-sitio.py'), String(puerto)], { stdio: 'ignore' });
const pedir = (ruta) => new Promise((ok) => {
  http.get({ host: '127.0.0.1', port: puerto, path: ruta }, (res) => {
    let cuerpo = '';
    res.on('data', (d) => { cuerpo += d; });
    res.on('end', () => ok({ estado: res.statusCode, cuerpo }));
  }).on('error', () => ok({ estado: 0, cuerpo: '' }));
});
(async () => {
  let u = { estado: 0 };
  for (let i = 0; i < 40 && !u.estado; i++) { await new Promise((s) => setTimeout(s, 150)); u = await pedir('/datos/noches-frias/ultima.json'); }
  if (dias.length) {
    revisar('ultima.json responde 200 en local', u.estado === 200, String(u.estado));
    revisar('ultima.json es el último día', u.cuerpo === leer(path.join('data', 'noches-frias', dias[dias.length - 1])));
    const d = await pedir('/datos/noches-frias/' + dias[0]);
    revisar('un día registrado se sirve por su nombre', d.estado === 200);
  } else {
    revisar('sin días registrados, ultima.json da 404 como en Pages', u.estado === 404);
  }
  revisar('un nombre que no es un día da 404', (await pedir('/datos/noches-frias/..%2F..%2FLICENSE')).estado === 404);
  revisar('el ícono se sirve', (await pedir('/icono.svg')).estado === 200);
  srv.kill();
  cierre('Pronóstico, rótulos y pedidos de cada carga');
})();
