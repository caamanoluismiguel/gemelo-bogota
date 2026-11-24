'use strict';
// Ayuda mínima para las pruebas: sin dependencias, solo Node.
let fallas = 0, pasan = 0;
function revisar(nombre, ok, detalle) {
  if (ok) pasan++; else fallas++;
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${nombre}${detalle ? '  (' + detalle + ')' : ''}`);
}
function cierre(titulo) {
  console.log(`${titulo}: ${pasan} pasan, ${fallas} fallan\n`);
  if (fallas) process.exitCode = 1;
}
module.exports = { revisar, cierre };
