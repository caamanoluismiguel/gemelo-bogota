'use strict';
// Cosecha viva (pipelines/bicis, pronostico, vivo y noches-frias): corre las pruebas de Python sin red.
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync('python3', ['-I', path.join(__dirname, 'cosecha_vivo.py')], { stdio: 'inherit' });
if (r.status !== 0) process.exitCode = 1;
