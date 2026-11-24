#!/bin/sh
# Arbolado urbano (censo SIGAU del JBB, CC BY 4.0) a salida/arboles-bogota.pmtiles.
# Uso: sh scripts/arboles.sh (desde mapa-base/). Antes: sh scripts/bajar.sh (baja el SHP).
set -eu
# Rutas relativas: tippecanoe guarda su línea de órdenes en los metadatos del archivo.
T="salida/trabajo"; A=$T/arboles
mkdir -p "$A"
export TMPDIR="$T"
N="nice -n 10"
[ -f "$A/ArboladoUrbano.shp" ] || $N unzip -o -q salida/crudos/arboladourbano.zip -d "$A"
rm -f "$A/arboles.fgb"
$N duckdb -no-agent -csv < scripts/arboles.sql
# Solo z16: el visor dibuja los árboles desde el zoom 15 del mapa y siempre pide teselas z16.
# -d10: 1.024 unidades por tesela, unos 0,6 m en z16; el punto del censo no es más fino que
# eso a la escala de la calle. Sin --drop: si una tesela no cabe en 150 KB, tippecanoe falla
# y se revisa. -b0: sin margen, cada árbol sale en una sola tesela (no se dibuja dos veces).
$N tippecanoe --force --quiet --temporary-directory="$T" -M 150000 \
  -o salida/arboles-bogota.pmtiles -l arboles -Z16 -z16 -d10 -D10 -b0 --read-parallel \
  -T h:int -T f:int \
  -n "Arbolado urbano de Bogotá" \
  -N "Cada árbol del censo SIGAU con altura total (h, en decímetros, de fuente) y forma de copa (f, inferida de la especie)" \
  -A 'Jardín Botánico de Bogotá José Celestino Mutis (JBB), censo SIGAU, Datos Abiertos Bogotá, CC BY 4.0' \
  "$A/arboles.fgb"
