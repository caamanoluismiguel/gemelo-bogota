'use strict';
// Lector mínimo de teselas vectoriales (Mapbox Vector Tile 2.1, protobuf).
// Escrito aquí para no sumar dependencias: solo lee lo que necesita la sombra
// (una capa, sus polígonos y sus propiedades numéricas o de texto).
// Módulo puro: corre en el navegador (window.Bogotwin.mvt) y en Node (require).
// Especificación: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
(function (raiz) {
  // Lector de protobuf: varint, longitud y saltos. Nada más.
  function Lector(bytes) { this.b = bytes; this.p = 0; }
  Lector.prototype.varint = function () {
    const b = this.b;
    let v = 0, m = 1, x;
    do {
      x = b[this.p++];
      v += (x & 0x7f) * m;
      m *= 128;
    } while (x & 0x80);
    return v;
  };
  Lector.prototype.svarint = function () { const v = this.varint(); return v % 2 === 1 ? (v + 1) / -2 : v / 2; };
  Lector.prototype.saltar = function (tipo) {
    if (tipo === 0) this.varint();
    else if (tipo === 1) this.p += 8;
    else if (tipo === 2) { const n = this.varint(); this.p += n; }
    else if (tipo === 5) this.p += 4;
    else throw new Error('tipo de campo protobuf desconocido: ' + tipo);
  };
  Lector.prototype.bloque = function () { const n = this.varint(); const ini = this.p; this.p += n; return [ini, this.p]; };

  const texto = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function leerValor(r, fin) {
    let v = null;
    while (r.p < fin) {
      const t = r.varint(), campo = t >> 3, tipo = t & 7;
      if (campo === 1) { const [a, z] = r.bloque(); v = texto.decode(r.b.subarray(a, z)); }
      else if (campo === 2) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 4).getFloat32(0, true); r.p += 4; }
      else if (campo === 3) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 8).getFloat64(0, true); r.p += 8; }
      else if (campo === 4 || campo === 5) v = r.varint();
      else if (campo === 6) v = r.svarint();
      else if (campo === 7) v = r.varint() === 1;
      else r.saltar(tipo);
    }
    return v;
  }

  // Comandos de geometría a anillos [[x, y], ...] (sin repetir el primer punto).
  function anillosDe(r, a, z) {
    const anillos = [];
    let x = 0, y = 0, actual = null;
    r.p = a;
    while (r.p < z) {
      const c = r.varint(), id = c & 7, n = c >> 3;
      if (id === 1 || id === 2) {
        for (let i = 0; i < n; i++) {
          x += r.svarint(); y += r.svarint();
          if (id === 1) { actual = []; anillos.push(actual); }
          actual.push([x, y]);
        }
      } else if (id !== 7) throw new Error('comando de geometría desconocido: ' + id);
    }
    return anillos;
  }

  // Área con signo (fórmula del cordón). En MVT un anillo exterior tiene área positiva
  // con y hacia abajo (sentido del reloj en pantalla).
  function areaFirmada(r) {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; s += p[0] * q[1] - q[0] * p[1]; }
    return s / 2;
  }

  // Lee una capa de la tesela. Devuelve { extension, objetos: [{ propiedades, anillos }] }
  // o null si la capa no está. Solo polígonos (tipo 3); los anillos de un multipolígono
  // quedan juntos: para la sombra da lo mismo, cada borde se trata por su lado.
  function leerCapa(bytes, nombre) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const r = new Lector(u8);
    while (r.p < u8.length) {
      const t = r.varint();
      if (t >> 3 !== 3 || (t & 7) !== 2) { r.saltar(t & 7); continue; }
      const [a, z] = r.bloque();
      const capa = leerUnaCapa(r, a, z, nombre);
      r.p = z;
      if (capa) return capa;
    }
    return null;
  }

  function leerUnaCapa(r, a, z, buscado) {
    let nombre = null, extension = 4096;
    const claves = [], valores = [], rasgos = [];
    r.p = a;
    while (r.p < z) {
      const t = r.varint(), campo = t >> 3, tipo = t & 7;
      if (campo === 1) { const [x, y] = r.bloque(); nombre = texto.decode(r.b.subarray(x, y)); if (nombre !== buscado) return null; }
      else if (campo === 2) rasgos.push(r.bloque());
      else if (campo === 3) { const [x, y] = r.bloque(); claves.push(texto.decode(r.b.subarray(x, y))); }
      else if (campo === 4) { const [x, y] = r.bloque(); const fin = r.p; r.p = x; valores.push(leerValor(r, y)); r.p = fin; }
      else if (campo === 5) extension = r.varint();
      else r.saltar(tipo);
    }
    if (nombre !== buscado) return null;
    const objetos = [];
    for (const [fa, fz] of rasgos) {
      let tipoGeom = 0, etiquetas = [], geom = null;
      r.p = fa;
      while (r.p < fz) {
        const t = r.varint(), campo = t >> 3, tipo = t & 7;
        if (campo === 2) { const [x, y] = r.bloque(); const fin = r.p; r.p = x; while (r.p < y) etiquetas.push(r.varint()); r.p = fin; }
        else if (campo === 3) tipoGeom = r.varint();
        else if (campo === 4) geom = r.bloque();
        else r.saltar(tipo);
      }
      if (tipoGeom !== 3 || !geom) continue;
      const propiedades = {};
      for (let i = 0; i + 1 < etiquetas.length; i += 2) propiedades[claves[etiquetas[i]]] = valores[etiquetas[i + 1]];
      const fin = r.p;
      const anillos = anillosDe(r, geom[0], geom[1]);
      r.p = fin;
      objetos.push({ propiedades, anillos });
    }
    return { extension, objetos };
  }

  const mvt = { leerCapa, areaFirmada };
  if (typeof module === 'object' && module.exports) module.exports = mvt;
  if (raiz && typeof raiz === 'object' && typeof raiz.document !== 'undefined') {
    raiz.Bogotwin = raiz.Bogotwin || {};
    raiz.Bogotwin.mvt = mvt;
  }
})(typeof window !== 'undefined' ? window : globalThis);
