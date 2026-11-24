#!/bin/sh
# Construcciones de Catastro con pisos (CC BY 4.0) a salida/catastro-pisos-bogota.pmtiles.
# Trabajo pesado: correrlo solo, sin otro proceso grande. Uso: sh scripts/catastro.sh (desde mapa-base/)
set -eu
T="$PWD/salida/trabajo"; K=$T/catastro
mkdir -p "$K"
export TMPDIR="$T"
N="nice -n 10"
[ -f "$K/CONST.gpkg" ] || $N unzip -o -q salida/crudos/construcciones.gpkg.zip -d "$K"
[ -f "$T/sector/SECTOR.gpkg" ] || unzip -o -q salida/crudos/sector-catastral.gpkg.zip -d "$T/sector"
rm -f "$K/construcciones.fgb" "$K/construcciones_lejos.fgb" "$K/pisos_por_sector.geojsonseq"
$N duckdb -no-agent -csv < scripts/catastro.sql

TC="$N tippecanoe --force --quiet --temporary-directory=$T -M 150000"
# Vista de ciudad: sectores con pisos promedio, z10 a z15.
$TC -o "$K/sectores_pisos.pmtiles" -l pisos_sector -Z10 -z15 --detect-shared-borders \
  --no-tiny-polygon-reduction "$K/pisos_por_sector.geojsonseq"
# Construcciones: solo z16, todas (medido el 23 nov 2026: z16 sale idéntico con y sin tope;
# en z15 el tope soltaba más de la mitad de los bytes, así que z15 no se arma con todas;
# para z14 y z15 va la versión unida de más abajo). El visor
# sobreamplía z16. Sin --drop: si una tesela no cabe en 150 KB, tippecanoe falla y se revisa.
# -T: desde FlatGeobuf tippecanoe escribe los enteros como texto; se fuerzan a entero.
$TC -o "$K/construcciones.pmtiles" -l construcciones -Z16 -z16 --read-parallel -T pisos:int -T sotanos:int \
  --no-tiny-polygon-reduction --simplification=2 "$K/construcciones.fgb"
# Construcciones lejanas: z14 y z15 con las huellas unidas por manzana y pisos, a poca
# resolución (-d8, -D7: unos 5 m en z15). Con la cámara inclinada el fondo llega en estas
# teselas; sin ellas el fondo queda vacío. Medido el 24 nov 2026: +4,6 MB al archivo,
# tesela z15 más pesada 31 KB.
$TC -o "$K/construcciones_lejos.pmtiles" -l construcciones -Z14 -z15 --read-parallel -y pisos -T pisos:int \
  --simplification=4 -d8 -D7 "$K/construcciones_lejos.fgb"
$N tile-join --force --no-tile-size-limit -o salida/catastro-pisos-bogota.pmtiles \
  -n "Construcciones de Catastro con pisos" \
  -N "Huella de cada construcción con número de pisos y sótanos (no es altura en metros)" \
  -A 'UAECD (Catastro Bogotá), Datos Abiertos Bogotá, CC BY 4.0' \
  "$K/sectores_pisos.pmtiles" "$K/construcciones_lejos.pmtiles" "$K/construcciones.pmtiles"
