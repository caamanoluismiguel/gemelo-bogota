#!/bin/sh
# Edificios emblemáticos en 3D con las partes de OpenStreetMap (ODbL 1.0) a
# salida/osm-3d-bogota.pmtiles, aparte de Catastro.
# Uso: sh scripts/osm3d.sh (desde mapa-base/). Antes: make osm (bogota.osm.pbf) y make catastro
# (catastro-pisos-bogota.pmtiles, que se lee para comparar alturas y saber qué cajas tapar).
# Qué entra, cómo se calculan las alturas y los techos y qué se decide con Catastro: osm3d.py.
set -eu
T="salida/trabajo"; O=$T/osm3d
mkdir -p "$O"
export TMPDIR="$T"
N="nice -n 10"
$N osmium tags-filter --overwrite "$T/osm/bogota.osm.pbf" wr/building wr/building:part -o "$O/edif.osm.pbf"
$N osmium export --overwrite -c scripts/osmium-export-3d.json -f geojsonseq "$O/edif.osm.pbf" -o "$O/edif.geojsonseq"
$N python3 -I scripts/osm3d.py "$O/edif.geojsonseq" salida/catastro-pisos-bogota.pmtiles \
  "$O/piezas.geojsonseq" "$O/ocultas.json" "$O/reporte.json"
# z14 a z16: el mapa pide teselas de Catastro desde z14 (las huellas unidas de lejos), y en z14 y
# z15 también se tapan; sin piezas ahí quedaría un hueco. -d14 en z16 es unos 15 cm: los techos en
# escalones necesitan anillos finos. Sin --drop: si una tesela no cabe, tippecanoe falla.
rm -f "$O/osm3d.mbtiles"
$N tippecanoe --force --quiet --temporary-directory="$T" -o "$O/osm3d.mbtiles" -l partes \
  -Z14 -z16 -d14 -D12 --no-tile-size-limit --no-feature-limit --no-tiny-polygon-reduction -b4 --read-parallel \
  -n "Edificios emblemáticos en 3D (OpenStreetMap)" \
  -N "Partes y edificios de OSM con altura, base y techo aproximado en escalones; reemplazan cajas de Catastro" \
  -A '© colaboradores de OpenStreetMap, ODbL 1.0' \
  "$O/piezas.geojsonseq"
# Las construcciones de Catastro que las piezas tapan van en los metadatos del mismo archivo
# (clave «ocultas»): el visor las esconde (site/cajas-ocultas.js) sin bajar nada más.
python3 -I - "$O/osm3d.mbtiles" "$O/ocultas.json" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("DELETE FROM metadata WHERE name='ocultas'")
db.execute("INSERT INTO metadata (name, value) VALUES ('ocultas', ?)", (open(sys.argv[2]).read(),))
db.execute("UPDATE metadata SET value='ODbL 1.0' WHERE name='license'")
if not db.execute("SELECT 1 FROM metadata WHERE name='license'").fetchone():
    db.execute("INSERT INTO metadata (name, value) VALUES ('license', 'ODbL 1.0')")
db.commit()
PY
rm -f salida/osm-3d-bogota.pmtiles
$N pmtiles convert "$O/osm3d.mbtiles" salida/osm-3d-bogota.pmtiles
ls -l salida/osm-3d-bogota.pmtiles
