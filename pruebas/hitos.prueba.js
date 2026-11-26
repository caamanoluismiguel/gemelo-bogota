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
  revisar(`${h.id}: esconde su caja de cerca (z16) y la de lejos (z14 y z15)`, h.ocultar && h.ocultar.cerca.length > 0 && h.ocultar.lejos.length > 0 && Array.isArray(h.ocultar.osm));
  // Sombra: piezas del propio modelo, en metros desde lon/lat, ninguna más alta que el hito.
  const sb = Array.isArray(h.sombra) ? h.sombra : [];
  revisar(`${h.id}: trae piezas de sombra de su modelo`, sb.length > 0 && sb.every((p) => p.anillo.length >= 3 && p.alto > 0 && p.alto <= h.alto + 1));
  revisar(`${h.id}: la sombra más alta es la del hito`, Math.abs(Math.max(...sb.map((p) => p.alto)) - h.alto) <= 7, String(Math.max(...sb.map((p) => p.alto))));
  // Alto por fuente: cada alto dice si es de fuente o supuesto, y si es de fuente, cuál.
  revisar(`${h.id}: cada alto dice de dónde sale`, Array.isArray(h.altos) && h.altos.length > 0 && h.altos.every((a) => a.valor && (a.tipo === 'supuesto' || (a.tipo === 'de_fuente' && a.de))));
}
{
  const col = cat.hitos.find((h) => h.id === 'colpatria');
  revisar('Colpatria: esconde las tres partes de OSM de la torre', ['way/1175248694', 'way/1175248695', 'way/767352739'].every((i) => col.ocultar.osm.includes(i)));
  revisar('Colpatria: sombra hasta 196 m', col.sombra.some((p) => p.alto === 196));
  revisar('Colpatria: el alto de 196 m va como de fuente', col.altos.some((a) => a.valor === '196 m' && a.tipo === 'de_fuente'));
  revisar('Virgilio Barco no está en el catálogo', !JSON.stringify(cat).includes('virgilio'));
}
revisar('los hitos juntos pesan menos de 1 MB', totalBytes < 1024 * 1024, totalBytes + ' bytes');
revisar('al menos dos hitos en el catálogo', IDS.size >= 2);

// Los ids de Catastro son de unas teselas concretas: si se publican otras, hay que rehacerlos.
{
  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mapa-base', 'teselas-publicadas.json'), 'utf8')).archivos;
  for (const [f, sha] of Object.entries(cat.teselas || {})) {
    revisar(`ids de cajas sacados de la ${f} publicada (si falla: node pipelines/hitos/catastro-ids.js y modelar.js)`, pub[f] && pub[f].sha256 === sha);
  }
  revisar('el catálogo dice de qué teselas salen los ids', cat.teselas && cat.teselas['catastro-pisos-bogota.pmtiles'] && cat.teselas['osm-3d-bogota.pmtiles']);
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
  const altos = f.filas.filter((r) => h.altos.some((a) => a.que === r[0]));
  revisar(`${h.id}: cada alto sale en la ventana con su marca`, altos.length === h.altos.length && altos.every((r) => r[2] === 'de_fuente' || r[2] === 'supuesto'));
  revisar(`${h.id}: el alto de fuente dice cuál fuente`, h.altos.filter((a) => a.tipo === 'de_fuente').every((a) => f.filas.some((r) => r[1].includes(a.de) && r[2] === 'de_fuente')));
}
{
  const f = H.ficha({ nombre: 'X', tipo: 'fotogrametria', licencia: { nombre: 'CC BY 4.0' }, fuente: 'y' });
  revisar('fotogrametría va como «medido»', f.filas[1][1] === 'fotogrametría' && f.filas[1][2] === 'medido');
  const g = H.ficha({ nombre: 'X', tipo: 'modelado', licencia: { nombre: 'CC BY 4.0' }, fuente: 'y', alto: 20 });
  revisar('sin «altos» el alto va como supuesto', g.filas.some((r) => r[0] === 'Alto' && r[1] === '20 m' && r[2] === 'supuesto'));
}

// ── Lugar de la ventana: nunca encima del hito ──
{
  const sil = [[150, 300], [250, 300], [250, 500], [150, 500]];
  const corta = (l, tam) => l.anchor === 'top' ? l.y - l.correr >= 500 : l.y + tam - l.correr <= 300;
  const a = H.lugarVentana(sil, 390, 700, 150);
  revisar('cabe debajo: la ventana va debajo de la silueta', a.anchor === 'top' && a.y >= 500 && a.correr === 0);
  const b = H.lugarVentana([[150, 300], [250, 300], [250, 620], [150, 620]], 390, 700, 150);
  revisar('no cabe debajo pero sí encima: va encima', b.anchor === 'bottom' && b.y <= 300 && b.correr === 0);
  const c = H.lugarVentana([[100, 120], [300, 120], [300, 600], [100, 600]], 390, 700, 200);
  // Sin lugar: se corre el mapa; ya corrido, la ventana empieza justo debajo de la silueta.
  revisar('sin lugar: el mapa se corre y la ventana no tapa la silueta', c.correr !== 0 && (c.anchor === 'top' ? c.y >= 600 - c.correr : c.y <= 120 - c.correr), JSON.stringify(c));
  revisar('sin silueta no hay lugar', H.lugarVentana([], 390, 700, 100) === null);
  revisar('la ventana queda dentro del ancho', a.x >= 8 && a.x <= 382 && corta(a, 150));
}

// ── Cajas escondidas: Catastro de cerca y de lejos, y partes de OSM ──
{
  C.agregar('hitos:colpatria', { cerca: [7], lejos: [50213], osm: ['way/1'] });
  C.agregar('hitos:catedral', { cerca: [9], lejos: [48706] });
  const f = C.filtro();
  revisar('filtro de Catastro: cerca por «tono» y lejos aparte', f[0] === 'case' && JSON.stringify(f[2][2]) === '[7,9]' && JSON.stringify(f[3][2]) === '[48706,50213]');
  revisar('filtro de OSM por id_osm', JSON.stringify(C.filtroOsm()) === JSON.stringify(['match', ['to-string', ['get', 'id_osm']], ['way/1'], false, true]));
  revisar('origenes lista los hitos', C.origenes().includes('hitos:colpatria') && C.origenes().includes('hitos:catedral'));
  // Con un mapa de mentiras: aplicar pone los dos filtros y quitar los devuelve.
  const filtros = {};
  const mapa = { getLayer: () => true, setFilter: (id, v) => { filtros[id] = v; } };
  C.aplicar(mapa);
  revisar('aplicar pone el filtro en Catastro y en OSM', filtros[C.CAPA][0] === 'case' && filtros[C.CAPA_OSM][0] === 'match');
  C.quitar('hitos:colpatria');
  C.quitar('hitos:catedral');
  revisar('al quitar todo no queda filtro', filtros[C.CAPA] === null && filtros[C.CAPA_OSM] === null && C.cuantas().cerca === 0);
}

// ── Lo que mapa.js y el sitio deben tener ──
{
  const mapa = fs.readFileSync(path.join(SITE, 'mapa.js'), 'utf8');
  revisar('mapa.js baja cajas-ocultas.js y hitos.js solo en la vista de calle', /bajarUno\('cajas-ocultas\.js'\)/.test(mapa) && /bajarUno\('hitos\.js'\)/.test(mapa) && /alHitos\(e\.detail\.on\)/.test(mapa));
  revisar('el toque mira el hito antes de queryRenderedFeatures', mapa.indexOf('B.hitosCapa().tocar(e)') > 0 && mapa.indexOf('B.hitosCapa().tocar(e)') < mapa.indexOf('mapa.queryRenderedFeatures(caja'));
  const src = fs.readFileSync(path.join(SITE, 'hitos.js'), 'utf8');
  revisar('hitos.js usa el relieve con queryTerrainElevation', /queryTerrainElevation/.test(src));
  revisar('hitos.js da la sombra de los hitos que se dibujan y avisa', /sombras, estado/.test(src) && /bogotwin:hitos-sombra/.test(src));
  const sol = fs.readFileSync(path.join(SITE, 'sol-barra.js'), 'utf8');
  const capa = fs.readFileSync(path.join(SITE, 'sombras-capa.js'), 'utf8');
  revisar('las sombras suman las de los hitos (fijas) y se rearman al cambiar', /fijas \}\)/.test(sol) && /bogotwin:hitos-sombra/.test(sol) && /function piezasFijas/.test(capa) && /lista: base/.test(capa));
  revisar('la ventana del hito marca cada fila y se pone fuera de la silueta', /ventanaHito\(e, hito\)/.test(mapa) && /B\.marca\(tipo\)/.test(mapa) && /lugarVentana/.test(mapa));
  const css = fs.readFileSync(path.join(SITE, 'estilo.css'), 'utf8');
  revisar('«Cómo se hizo» subrayado y de 44 px para el dedo', /\.enlace-ficha \{[^}]*min-height: 44px[^}]*text-decoration: underline/.test(css) && /enlace-ficha/.test(mapa));
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
    const enTesela = (z, h) => { const [x, y] = ids.teselaDe(h.lon, h.lat, z); const b = pm.tesela(z, x, y); return new Set(b ? ids.objetosConId(b, 'construcciones').map((o) => o.id) : []); };
    for (const h of cat.hitos) {
      revisar(`${h.id}: sus ids de cerca están en la tesela z16`, h.ocultar.cerca.some((i) => enTesela(16, h).has(i)));
      // El hueco de la Colpatria en z14: la caja de lejos tiene que estar en z14 y en z15.
      for (const z of [14, 15]) revisar(`${h.id}: sus ids de lejos están en la tesela z${z}`, h.ocultar.lejos.some((i) => enTesela(z, h).has(i)));
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
  // [este, norte] dentro del contorno; [este, norte, d] en el contorno con d ≤ 0 (no sube el piso por encima del relieve del borde).
  const casi = ([e, n]) => [e * 0.98, n * 0.98];
  revisar(`${h.id}: sueloEn con puntos dentro del contorno`, h.sueloEn.length >= 3 && h.sueloEn.every((q) => H.dentro(q.length > 2 ? casi(q) : q, h.contorno) && !(q[2] > 0)));
}

cierre('Hitos 3D');
