'use strict';
// Pasos 10 a 12: textos de la barra del sol, URL ?sol=, fila de la ventana, nubes del METAR y luz.
const path = require('path');
const { revisar, cierre } = require('./util');
const T = require(path.join(__dirname, '..', 'site', 'sol-texto.js'));
const G = require(path.join(__dirname, '..', 'site', 'sombra-geom.js'));

revisar('hora 9:40 a. m.', T.horaTexto(580) === '9:40 a. m.', T.horaTexto(580));
revisar('hora 12 m.', T.horaTexto(720) === '12 m.');
revisar('hora 6:30 p. m.', T.horaTexto(1110) === '6:30 p. m.');
revisar('hora 12:05 p. m.', T.horaTexto(725) === '12:05 p. m.');
revisar('fecha corta', T.fechaTexto(2026, 11, 23) === 'lunes, 23 nov', T.fechaTexto(2026, 11, 23));
revisar('día del año y vuelta', [1, 59, 60, 172, 355, 365].every((n) => {
  const f = T.fechaDeDia(2028, n); return T.diaDelAnio(f.anio, f.mes, f.dia) === n;
}));
revisar('ajustar a 5 min y al rango', T.ajustarHora(583) === 585 && T.ajustarHora(100) === 330 && T.ajustarHora(1300) === 1110);

const s = T.leerSol('2026-04-02T12:00');
revisar('leer ?sol=', s && s.anio === 2026 && s.mes === 4 && s.dia === 2 && s.min === 720);
revisar('escribir ?sol= ida y vuelta', T.escribirSol(s) === '2026-04-02T12:00');
revisar('?sol= inválido', [null, '', '2026-02-30T12:00', '2026-04-02T25:00', '2026-04-02 12:00', 'x'].every((v) => T.leerSol(v) === null));

revisar('ocho puntos', T.direccion8(0) === 'norte' && T.direccion8(95) === 'oriente' && T.direccion8(200) === 'sur' && T.direccion8(-45) === 'noroccidente');

const fila = T.filaSombra({ altura: 45, azimut: 90 }, 4, G.largoSombra);
revisar('fila de día', /^Sombra a esta hora: de 10 a 16 m hacia el occidente$/.test(fila), fila);
revisar('fila de noche', T.filaSombra({ altura: -3, azimut: 270 }, 4, G.largoSombra) === 'Sombra a esta hora: no hay, es de noche');
revisar('fila al ras', /casi en el horizonte/.test(T.filaSombra({ altura: 2, azimut: 80 }, 4, G.largoSombra)));
revisar('fila decimal con coma', /de 1,8 a 2,9 m/.test(T.filaSombra({ altura: 54, azimut: 180 }, 1, G.largoSombra)), T.filaSombra({ altura: 54, azimut: 180 }, 1, G.largoSombra));

const ahora = Date.parse('2026-11-23T15:00:00Z');
const est = (cover, fen, hace) => ({ hora_dato: new Date(ahora - (hace || 10) * 60000).toISOString(), nubes: cover ? [{ cover, base_ft: 2000 }] : [], fenomenos: fen || '' });
const c1 = T.cielo({ estaciones: [est('BKN'), est('OVC')] }, ahora);
revisar('BKN y OVC en las dos: media intensidad', c1.clave === 'cubierto' && c1.intensidad === 0.5 && /cielo cubierto/.test(c1.texto));
revisar('OVC en una y SCT en otra: nubes', T.cielo({ estaciones: [est('OVC'), est('SCT')] }, ahora).clave === 'nubes');
revisar('lluvia: cubierto', T.cielo({ estaciones: [est('FEW', '-RA')] }, ahora).clave === 'cubierto');
revisar('VCSH no cuenta', T.cielo({ estaciones: [est('FEW', 'VCSH')] }, ahora).clave === 'despejado');
const viejo = T.cielo({ estaciones: [est('OVC', '', 120), est('OVC', '', 200)] }, ahora);
revisar('dato viejo: sin dato, intensidad 1', viejo.clave === 'sinDato' && viejo.intensidad === 1);
revisar('sin METAR: sin dato', T.cielo(null, ahora).clave === 'sinDato');

const l = T.luz({ altura: 60, azimut: -10 });
revisar('luz del sol', l.anchor === 'map' && l.position[0] === 1.5 && l.position[1] === 350 && l.position[2] === 30);
revisar('luz baja queda en 5°', T.luz({ altura: 1, azimut: 90 }).position[2] === 85);

cierre('Textos de la barra del sol');
