'use strict';
// Corre todas las pruebas: node pruebas/correr.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let mal = 0;
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.prueba.js')).sort()) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) mal++;
}
console.log(mal ? `${mal} archivo(s) con fallas` : 'Todo pasa');
process.exitCode = mal ? 1 : 0;
