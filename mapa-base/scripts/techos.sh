#!/bin/sh
# Color de techo de las construcciones de Catastro hasta 4 pisos, medido en la Ortoimagen
# urbana 2025 (SDP/IDECA, CC BY 4.0) a z18. Deja salida/trabajo/catastro/techos.csv, que
# luego une scripts/catastro.sql. Pide la orto cruda (make orto-bajar) y CONST.gpkg.
# Trabajo pesado: correrlo solo. Medido el 25 nov 2026: la lectura de la foto tarda 83 s.
# Uso: sh scripts/techos.sh (desde mapa-base/)
set -eu
T="$PWD/salida/trabajo"; K=$T/catastro
mkdir -p "$K"
export TMPDIR="$T"
N="nice -n 10"
[ -f "$K/CONST.gpkg" ] || $N unzip -o -q salida/crudos/construcciones.gpkg.zip -d "$K"
PY=terreno/.venv/bin/python
[ -x "$PY" ] || PY=python3
$N duckdb -no-agent -csv < scripts/techos.sql
$N "$PY" -I scripts/techos.py medir
$N "$PY" -I scripts/techos.py cuantizar
rm -f "$K/techos-huellas.csv"
