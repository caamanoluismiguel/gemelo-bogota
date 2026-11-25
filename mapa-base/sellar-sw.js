'use strict';
// Sella site/sw.js en la carpeta que se publica (lo llama pages.yml, después de armarla):
//   node mapa-base/sellar-sw.js publicar mapa-base/teselas-publicadas.json
// Pone en el service worker (1) la versión del despliegue, que es el hash de lo publicado y
// por eso cambia solo cuando cambia algo que el visitante ve, y (2) la huella de cada tesela
// según el ancla de confianza. Con eso el worker sabe qué guardar y cuándo tirarlo.
// Sin npm: solo Node. Las funciones se prueban en pruebas/sw.prueba.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Lo que no entra al hash: el propio worker (lleva el sello), las teselas (van por huella en el
// sello) y lo que el flujo diario cambia sin tocar el sitio (noches frías, que el worker no guarda).
const FUERA = [/^sw\.js$/, /^teselas\//, /^datos\/noches-frias\//, /^\.nojekyll$/];

function archivos(raiz, rel) {
  const dir = path.join(raiz, rel || '');
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) salida.push(...archivos(raiz, r));
    else if (!FUERA.some((re) => re.test(r))) salida.push(r);
  }
  return salida.sort();
}

function calcularVersion(raiz) {
  const h = crypto.createHash('sha256');
  for (const r of archivos(raiz)) {
    h.update(r + '\0');
    h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, r))).digest());
  }
  return h.digest('hex').slice(0, 12);
}

// {nombre: sha256 de 12 letras}, de teselas-publicadas.json. Falla si falta una huella.
function mapaTeselas(ancla) {
  const salida = {};
  for (const [nombre, info] of Object.entries(ancla.archivos || {})) {
    if (!/^[0-9a-f]{64}$/.test(String(info.sha256))) throw new Error(nombre + ': sin sha256 válido');
    salida[nombre] = info.sha256.slice(0, 12);
  }
  if (!Object.keys(salida).length) throw new Error('el ancla no trae archivos');
  return salida;
}

function sellar(texto, version, teselas) {
  if (!/^[0-9a-f]{12}$/.test(version)) throw new Error('versión inválida');
  if (!texto.includes("'__SW_VERSION__'") || !texto.includes("'__SW_TESELAS__'")) throw new Error('sw.js ya viene sellado o no tiene las marcas');
  return texto.replace("'__SW_VERSION__'", "'" + version + "'").replace("'__SW_TESELAS__'", "'" + JSON.stringify(teselas) + "'");
}

if (require.main === module) {
  const [carpeta, anclaRuta] = process.argv.slice(2);
  if (!carpeta || !anclaRuta) { console.error('uso: node sellar-sw.js <carpeta publicada> <teselas-publicadas.json>'); process.exit(2); }
  const destino = path.join(carpeta, 'sw.js');
  const version = calcularVersion(carpeta);
  const teselas = mapaTeselas(JSON.parse(fs.readFileSync(anclaRuta, 'utf8')));
  fs.writeFileSync(destino, sellar(fs.readFileSync(destino, 'utf8'), version, teselas));
  console.log(`sw.js sellado: versión ${version}, ${Object.keys(teselas).length} teselas`);
}

module.exports = { calcularVersion, mapaTeselas, sellar, archivos };
