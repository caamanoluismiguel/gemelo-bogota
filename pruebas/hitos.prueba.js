'use strict';
// Hitos 3D (site/hitos.js, site/cajas-ocultas.js, site/hitos/): lector de GLB, presupuesto por
// hito, catálogo y procedencia, filtro de cajas, ficha de la ventana y que los ids de Catastro
// sigan siendo de las teselas publicadas. Con la tesela local, también que los ids existen.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');
const H = require('../site/hitos.js');
const C = require('../site/cajas-ocultas.js');
const G = require('../pipelines/hitos/geometria.js');

const SITE = path.join(__dirname, '..', 'site');
const cat = JSON.parse(fs.readFileSync(path.join(SITE, 'hitos', 'catalogo.json'), 'utf8'));

// ── Lector de GLB: ida y vuelta con el escritor del pipeline ──
{
  const m = new G.Malla();
  m.caja(G.marco([0, 0], 0), -2, 2, -3, 3, 0, 10, [200, 100, 50], [90, 90, 90]);
  const { glb, triangulos } = G.aGlb(m, { nombre: 'prueba' });
  const g = H.leerGlb(glb);
  revisar('el GLB del pipeline se lee', g.partes.length === 1 && H.triangulos(g) === triangulos, H.triangulos(g) + ' triángulos');
  const p = g.partes[0];
  let ymax = -Infinity;
  for (let i = 1; i < p.pos.datos.length; i += 3) ymax = Math.max(ymax, p.pos.datos[i]);
  revisar('alto de la caja: 10 m en y (arriba)', Math.abs(ymax - 10) < 1e-6, String(ymax));
  revisar('color por vértice en bytes normalizados', p.col && p.col.tipo === 5121 && p.col.normalizado && p.col.n === 4);
  revisar('normales unitarias', [...Array(p.nor.datos.length / 3).keys()].every((i) => Math.abs(Math.hypot(p.nor.datos[3 * i], p.nor.datos[3 * i + 1], p.nor.datos[3 * i + 2]) - 1) < 1e-4));
  let malo = false;
  try { H.leerGlb(new Uint8Array(40)); } catch (e) { malo = true; }
  revisar('un archivo que no es GLB se rechaza', malo);
  // Sin normales: las calcula.
  const n = H.normales(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]), new Uint32Array([0, 1, 2]));
  revisar('normales calculadas: un piso mira arriba', Math.abs(n[1] - 1) < 1e-6, Array.from(n.slice(0, 3)).join(','));
}

// ── Catálogo, presupuesto y procedencia ──
const IDS = new Set();
let totalBytes = 0;
for (const h of cat.hitos) {
  IDS.add(h.id);
  const f = path.join(SITE, h.glb);
  const ok = fs.existsSync(f);
  revisar(`${h.id}: el GLB existe`, ok);
  if (!ok) continue;
  const bytes = fs.statSync(f).size;
  totalBytes += bytes;
  const g = H.leerGlb(fs.readFileSync(f));
  const t = H.triangulos(g);
  revisar(`${h.id}: ${t} triángulos (máximo 50.000)`, t <= 50000 && t === h.triangulos);
  revisar(`${h.id}: ${bytes} bytes (máximo 400 KB)`, bytes <= 400 * 1024 && bytes === h.bytes);
  const imgs = g.partes.filter((p) => p.imagen).length;
  revisar(`${h.id}: una textura como mucho`, imgs <= 1);
  // Alto del modelo igual al del catálogo (con 1 m de holgura) y el pie bajo el suelo.
  let y0 = Infinity, y1 = -Infinity;
  for (const p of g.partes) for (let i = 1; i < p.pos.datos.length; i += 3) { y0 = Math.min(y0, p.pos.datos[i]); y1 = Math.max(y1, p.pos.datos[i]); }
  revisar(`${h.id}: alto del modelo ${y1.toFixed(1)} m como el catálogo (${h.alto} m)`, Math.abs(y1 - h.alto) <= 1);
  revisar(`${h.id}: los muros bajan del suelo (no flota en ladera)`, y0 < -1, y0.toFixed(1) + ' m');
  // Procedencia: archivo, una licencia, sin NC, tipo dicho.
  const pf = path.join(SITE, h.procedencia);
  const pr = fs.existsSync(pf) && JSON.parse(fs.readFileSync(pf, 'utf8'));
  revisar(`${h.id}: tiene archivo de procedencia`, !!pr);
  if (pr) {
    revisar(`${h.id}: una licencia y no es NC`, pr.licencia && typeof pr.licencia.nombre === 'string' && !/NC/.test(pr.licencia.nombre) && pr.licencia.nombre === h.licencia.nombre);
    revisar(`${h.id}: dice cómo se hizo y de dónde salió`, /supuesto|medido/.test(pr.tipo) && Array.isArray(pr.fuentes) && pr.fuentes.length > 0);
    revisar(`${h.id}: las fotos son solo referencia, no textura`, /solo para mirar la forma/.test(String(pr.referencias_visuales)) && (h.tipo !== 'modelado' || g.partes.every((p) => !p.imagen)));
  }
  revisar(`${h.id}: tipo modelado o fotogrametría`, h.tipo === 'modelado' || h.tipo === 'fotogrametria');
  revisar(`${h.id}: contorno con 3 puntos o más`, Array.isArray(h.contorno) && h.contorno.length >= 3);
  revisar(`${h.id}: dentro de Bogotá`, h.lon > -74.3 && h.lon < -73.9 && h.lat > 4.4 && h.lat < 4.9);
  revisar(`${h.id}: esconde al menos una caja en z16`, h.ocultar && h.ocultar.z16.length > 0);
}
revisar('los hitos juntos pesan menos de 1 MB', totalBytes < 1024 * 1024, totalBytes + ' bytes');
revisar('al menos dos hitos en el catálogo', IDS.size >= 2);
for (const p of cat.pendientes || []) revisar(`pendiente ${p.id}: licencia sin NC y dice qué falta`, !/NC/.test(p.licencia.nombre) && p.falta && p.url.startsWith('https://'));

// Los ids de Catastro son de unas teselas concretas: si se publican otras, hay que rehacerlos.
{
  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mapa-base', 'teselas-publicadas.json'), 'utf8')).archivos;
  for (const [f, sha] of Object.entries(cat.teselas || {})) {
    revisar(`ids de cajas sacados de la ${f} publicada (si falla: node pipelines/hitos/catastro-ids.js y modelar.js)`, pub[f] && pub[f].sha256 === sha);
  }
  revisar('el catálogo dice de qué teselas salen los ids', cat.teselas && cat.teselas['catastro-pisos-bogota.pmtiles']);
}

// ── Cercanía, matriz y toque ──
{
  const col = cat.hitos.find((h) => h.id === 'colpatria');
  revisar('a 1 km de la Colpatria la carga', H.cercanos(cat.hitos, col.lon + 0.009, col.lat, 2000).some((h) => h.id === 'colpatria'));
  revisar('a 3 km no', !H.cercanos(cat.hitos, col.lon + 0.027, col.lat, 2000).some((h) => h.id === 'colpatria'));
  const d = H.distanciaM(-74.07, 4.61, -74.07, 4.62);
  revisar('0,01° de latitud son unos 1.113 m', Math.abs(d - 1113) < 3, d.toFixed(0));
  // Con la matriz identidad, x del modelo va a x Mercator, y (arriba) a z, z (sur) a y.
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const F = H.matrizModelo(I, 0.3, 0.4, 2600, 0.5);
  const q = (x, y, z) => [0, 1, 2].map((k) => F[k] * x + F[4 + k] * y + F[8 + k] * z + F[12 + k]);
  const a = q(2, 10, 4);
  revisar('matriz: este, arriba y sur al lugar correcto', Math.abs(a[0] - (0.3 + 1)) < 1e-12 && Math.abs(a[1] - (0.4 + 2)) < 1e-12 && Math.abs(a[2] - (2600 + 10) * 0.5) < 1e-9, a.join(','));
  // Silueta en la pantalla y el punto dentro.
  const sil = H.envolvente([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
  revisar('envolvente de un cuadrado: 4 esquinas', sil.length === 4);
  revisar('punto dentro y fuera de la silueta', H.dentro([5, 5], sil) && !H.dentro([15, 5], sil));
}

// ── Ventana: qué dice al tocar ──
for (const h of cat.hitos) {
  const f = H.ficha(h);
  const texto = f.filas.map((r) => r.join(' ')).join(' | ');
  revisar(`${h.id}: la ventana dice nombre, cómo se hizo, fuente y licencia`, texto.includes(h.nombre) && /huella y altura|fotogrametría/.test(texto) && f.meta.licencia && f.meta.licencia.nombre === h.licencia.nombre && texto.includes(h.fuente));
  revisar(`${h.id}: modelado va como supuesto, fotogrametría como medido`, f.meta.tipo === (h.tipo === 'fotogrametria' ? 'medido' : 'supuesto'));
}
{
  const f = H.ficha({ nombre: 'X', tipo: 'fotogrametria', licencia: { nombre: 'CC BY 4.0' }, fuente: 'y' });
  revisar('fotogrametría dice «medido»', /fotogrametría \(medido\)/.test(f.filas[1][1]));
}

// ── Filtro de cajas ──
{
  const u = C.unir([C.normalizar({ z15: [3], z16: [1, 2] }), C.normalizar([2, 5])]);
  revisar('unir sin repetidos', JSON.stringify(u) === JSON.stringify({ z14: [], z15: [3], z16: [1, 2, 5] }));
  const f = C.filtro(u, null);
  revisar('filtro por zoom de tesela (step)', f[0] === 'step' && f[2] === true && f[3] === 15 && f[5] === 16 && JSON.stringify(f[6]) === JSON.stringify(['!', ['in', ['id'], ['literal', [1, 2, 5]]]]));
  const previo = ['>', ['get', 'pisos'], 0];
  const f2 = C.filtro(u, previo);
  revisar('respeta el filtro que ya tenía la capa', JSON.stringify(f2[2]) === JSON.stringify(previo) && f2[4][0] === 'all' && JSON.stringify(f2[4][1]) === JSON.stringify(previo));
  revisar('sin nada que esconder vuelve el filtro de antes', C.filtro(C.unir([]), previo) === previo && C.filtro(C.unir([]), null) === null);

  // Con un mapa de mentiras: agregar, quitar y volver al filtro original.
  const filtros = { 'construcciones-3d': previo };
  const oyentes = {};
  const mapa = {
    getLayer: (id) => id in filtros, getFilter: (id) => filtros[id], setFilter: (id, v) => { filtros[id] = v; },
    on: (e, f) => { oyentes[e] = f; }, off: () => {}
  };
  const c = C.crear();
  c.usar(mapa);
  c.agregar('hitos:colpatria', { z16: [7] });
  c.agregar('hitos:catedral', [9]);
  revisar('dos hitos esconden sus dos cajas', JSON.stringify(c.ocultos().z16) === '[7,9]' && JSON.stringify(filtros['construcciones-3d'][6][2]) === JSON.stringify(['!', ['in', ['id'], ['literal', [7, 9]]]]));
  // Si el estilo rehace la capa con su filtro original, se vuelve a esconder.
  filtros['construcciones-3d'] = previo;
  oyentes.styledata();
  revisar('después de un cambio de estilo siguen escondidas', filtros['construcciones-3d'][0] === 'step');
  c.quitar('hitos:colpatria');
  c.quitar('hitos:catedral');
  revisar('al quitar todo vuelve el filtro original', filtros['construcciones-3d'] === previo);
}

// ── Lo que mapa.js y el sitio deben tener ──
{
  const mapa = fs.readFileSync(path.join(SITE, 'mapa.js'), 'utf8');
  revisar('mapa.js baja cajas-ocultas.js y hitos.js solo en la vista de calle', /bajarUno\('cajas-ocultas\.js'\)/.test(mapa) && /bajarUno\('hitos\.js'\)/.test(mapa) && /alHitos\(e\.detail\.on\)/.test(mapa));
  revisar('el toque mira el hito antes de queryRenderedFeatures', mapa.indexOf('B.hitosCapa().tocar(e)') > 0 && mapa.indexOf('B.hitosCapa().tocar(e)') < mapa.indexOf('mapa.queryRenderedFeatures(caja'));
  const src = fs.readFileSync(path.join(SITE, 'hitos.js'), 'utf8');
  revisar('hitos.js usa el relieve con queryTerrainElevation', /queryTerrainElevation/.test(src));
  revisar('hitos.js usa la paleta de edificios-luz.js', /B\.luzEdificios/.test(src) && /paleta\(/.test(src));
  revisar('hitos.js no trae nada de fuera (CSP)', !/https?:\/\/(?!creativecommons)/.test(src.replace(/\/\/.*$/gm, '')) && !/import\(|eval\(|new Function/.test(src));
  const fuentes = fs.readFileSync(path.join(SITE, 'fuentes.html'), 'utf8');
  revisar('fuentes.html acredita los hitos 3D', /Hitos 3D/.test(fuentes) && cat.hitos.every((h) => fuentes.includes(h.nombre)));
}

// ── Con la tesela local: los ids escondidos existen ──
{
  const salida = path.join(__dirname, '..', 'mapa-base', 'salida', 'catastro-pisos-bogota.pmtiles');
  if (!fs.existsSync(salida)) console.log('(sin mapa-base/salida/catastro-pisos-bogota.pmtiles: no se miran los ids contra la tesela)');
  else {
    const { abrir } = require('./pmtiles-leer');
    const ids = require('../pipelines/hitos/catastro-ids.js');
    const pm = abrir(salida);
    for (const h of cat.hitos) {
      const [x, y] = ids.teselaDe(h.lon, h.lat, 16);
      const b = pm.tesela(16, x, y);
      const hay = new Set(b ? ids.objetosConId(b, 'construcciones').map((o) => o.id) : []);
      revisar(`${h.id}: sus ids z16 están en la tesela`, h.ocultar.z16.some((i) => hay.has(i)));
    }
  }
}

// ── Geometría: sentido de los anillos, tapas que cubren la huella y muros hacia afuera ──
{
  const cuadro = [[0, 0], [10, 0], [10, 10], [0, 10]];
  revisar('área con signo: contrario a las agujas del reloj es positiva', G.areaConSigno(cuadro) === 100, String(G.areaConSigno(cuadro)));
  const areaTris = ({ pts, tris }) => tris.reduce((s, [i, j, k]) => s + ((pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (pts[k][0] - pts[i][0])) / 2, 0);
  for (const r of [cuadro, cuadro.slice().reverse()]) revisar('la tapa de un cuadrado cubre 100 m² (en los dos sentidos)', Math.abs(areaTris(G.triangular([r])) - 100) < 1e-6);
  const conHueco = G.triangular([cuadro, [[3, 3], [3, 6], [6, 6], [6, 3]]]);
  revisar('la tapa con hueco cubre 91 m²', Math.abs(areaTris(conHueco) - 91) < 1e-6, areaTris(conHueco).toFixed(2));
  const { aMetros } = require('../pipelines/hitos/catastro-ids');
  const huellas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipelines', 'hitos', 'huellas-catastro.geojson'), 'utf8'));
  let peor = 0;
  for (const f of huellas.features) {
    const c0 = f.geometry.coordinates[0][0], m = aMetros(c0[0], c0[1]);
    const an = f.geometry.coordinates.map((r) => G.limpiar(r.map(([a, b]) => m(a, b))));
    const esp = an.reduce((s, r, i) => s + (i ? -1 : 1) * Math.abs(G.areaConSigno(r)), 0);
    peor = Math.max(peor, Math.abs(areaTris(G.triangular(an)) - esp) / esp);
  }
  revisar('las tapas cubren cada huella de Catastro (área de triángulos = área de la huella)', peor < 1e-6, (peor * 100).toFixed(4) + ' % de diferencia');
  const mm = new G.Malla();
  mm.muros(cuadro, 0, 3, [1, 1, 1], false);
  let afuera = true;
  for (let i = 0; i < mm.pos.length; i += 9) {
    const cx = (mm.pos[i] + mm.pos[i + 3] + mm.pos[i + 6]) / 3 - 5, cy = (mm.pos[i + 1] + mm.pos[i + 4] + mm.pos[i + 7]) / 3 - 5;
    if (cx * mm.nor[i] + cy * mm.nor[i + 1] <= 0) afuera = false;
  }
  revisar('los muros del contorno miran hacia afuera', afuera);
  revisar('el sombreado da vuelta las normales (las de MapLibre miran hacia adentro)', /vec2 n = -normalize\(nn\.xy/.test(fs.readFileSync(path.join(SITE, 'hitos.js'), 'utf8')));
}

// ── Suelo en un piso plano (sueloEn): puntos dentro del hito y muros que bajan lo bastante ──
for (const h of cat.hitos.filter((x) => x.sueloEn)) {
  revisar(`${h.id}: sueloEn con puntos [este, norte] dentro del contorno`, h.sueloEn.length >= 3 && h.sueloEn.every((q) => H.dentro(q, h.contorno)));
}

cierre('Hitos 3D');
