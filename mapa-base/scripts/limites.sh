#!/bin/sh
# Límites de localidades, UPL, sectores catastrales y barrios legalizados (CC BY 4.0)
# a salida/limites-bogota.pmtiles. Deja también salida/trabajo/bogota-dc.geojson para recortar OSM.
# Uso: sh scripts/limites.sh   (desde mapa-base/)
set -eu
T="$PWD/salida/trabajo"; L=$T/limites
mkdir -p "$L" "$T/sector"
export TMPDIR="$PWD/$T"
N="nice -n 10"
[ -f "$T/sector/SECTOR.gpkg" ] || unzip -o -q salida/crudos/sector-catastral.gpkg.zip -d "$T/sector"
rm -f "$T/bogota-dc.geojson" "$L"/*.geojsonseq
$N duckdb -no-agent -csv < scripts/limites.sql

TC="$N tippecanoe --force --quiet --temporary-directory=$T --detect-shared-borders --no-tiny-polygon-reduction"
$TC -o "$L/localidades.pmtiles" -l localidades -Z6 -z14 "$L/localidades.geojsonseq"
$TC -o "$L/upl.pmtiles" -l upl -Z9 -z14 "$L/upl.geojsonseq"
$TC -o "$L/sectores.pmtiles" -l sectores -Z11 -z14 "$L/sectores.geojsonseq"
$TC -o "$L/barrios_legalizados.pmtiles" -l barrios_legalizados -Z12 -z14 "$L/barrios_legalizados.geojsonseq"
$N tippecanoe --force --quiet --temporary-directory=$T -o "$L/rotulos.pmtiles" -l rotulos -Z8 -z14 \
  -j '{"rotulos":["any",["all",["==","nivel","localidad"]],["all",["==","nivel","upl"],[">=","$zoom",10]],["all",["==","nivel","sector"],[">=","$zoom",13]]]}' \
  "$L/rotulos.geojsonseq"
$N tile-join --force -o salida/limites-bogota.pmtiles -n "Límites oficiales Bogotá D.C." -N "Localidades, UPL, sectores catastrales y barrios legalizados" \
  -A 'SDP y UAECD, Datos Abiertos Bogotá, CC BY 4.0' \
  "$L/localidades.pmtiles" "$L/upl.pmtiles" "$L/sectores.pmtiles" "$L/barrios_legalizados.pmtiles" "$L/rotulos.pmtiles"
