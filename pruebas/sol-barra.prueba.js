'use strict';
// Ronda 8: el texto honesto de la barra del sol. En la vista de calle salen árboles, así que
// ahí no puede decir «sin árboles»; fuera de ella (2D y 3D sin calle) sí.
const fs = require('fs');
const path = require('path');
const { revisar, cierre } = require('./util');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'site', 'sol-barra.js'), 'utf8');
const texto = (n) => { const m = new RegExp(`const ${n} = '([^']*)'`).exec(fuente); return m ? m[1] : null; };
const fuera = ['HONESTA_CON_CERROS', 'HONESTA_SIN_CERROS'].map(texto);
const calle = ['HONESTA_CALLE_CON_CERROS', 'HONESTA_CALLE_SIN_CERROS'].map(texto);
revisar('los cuatro textos existen', [...fuera, ...calle].every((t) => t && t.length > 20));
revisar('fuera de la vista de calle sigue diciendo que no hay árboles', fuera.every((t) => /árboles/.test(t) && /sin /.test(t)));
revisar('en la vista de calle no dice «sin árboles» y avisa que son aproximados', calle.every((t) => !/ni árboles|sin árboles/.test(t) && /árboles/.test(t) && /aproximad/.test(t)));
revisar('sin cerros se dice en las dos vistas', /sin cerros/.test(fuera[1]) && /sin cerros/.test(calle[1]) && !/cerros/.test(fuera[0]) && !/cerros/.test(calle[0]));
revisar('sin rayas ni guiones de separación', [...fuera, ...calle].every((t) => !/[—–]| - /.test(t)));
revisar('el texto de calle solo va con 3D, vista de calle y capa de árboles sin error',
  /conArboles = api\.es3d\(\) && enCalle\(\) && !\(capaArb && capaArb\.estado\.error\)/.test(fuente));
revisar('escucha el aviso de la vista de calle', /addEventListener\('bogotwin:vista-calle'/.test(fuente));
cierre('Texto honesto de la barra del sol');
