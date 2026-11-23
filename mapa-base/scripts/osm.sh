#!/bin/sh
# Recorta OSM a Bogotá D.C., separa capas y arma salida/osm-bogota.pmtiles (ODbL 1.0).
# Uso: sh scripts/osm.sh   (desde mapa-base/, después de bajar.sh y limites.sh)
set -eu
C=salida/crudos; T="$PWD/salida/trabajo"; O=salida
mkdir -p "$T/osm" "$O"
export TMPDIR="$PWD/$T"
N="nice -n 10"

# 1. Recorte con el polígono de las 20 localidades (incluye Sumapaz), estrategia smart
#    para no partir multipolígonos que cruzan el borde.
$N osmium extract --overwrite -s smart -p "$T/bogota-dc.geojson" "$C/colombia-latest.osm.pbf" -o "$T/osm/bogota.osm.pbf"

# 2. Solo lo que usa el mapa base.
$N osmium tags-filter --overwrite "$T/osm/bogota.osm.pbf" \
  w/highway wr/building wr/waterway wr/natural=water,wetland,wood,scrub,grassland,heath \
  wr/landuse=reservoir,basin,forest,grass,meadow,recreation_ground \
  wr/leisure=park,garden,nature_reserve,golf_course wr/boundary=protected_area,national_park \
  -o "$T/osm/base.osm.pbf"

# 3. A GeoJSONSeq y clasificación por capa (lectura en flujo, memoria constante).
$N osmium export --overwrite -c scripts/osmium-export.json -f geojsonseq "$T/osm/base.osm.pbf" -o "$T/osm/base.geojsonseq"
$N python3 -I scripts/clasificar_osm.py "$T/osm/base.geojsonseq" "$T/osm" "$T/osm/estadisticas.json"

# 4. Teselas por capa con sus propias reglas y unión en un solo archivo. Todas llegan a z15:
#    el archivo unido declara un solo zoom máximo y el visor sobreamplía desde ahí.
# Tope por tesela: 150 KB comprimidos (presupuesto de teléfono, panel/datos-masivos.md §4).
TC="$N tippecanoe --force --quiet --read-parallel --temporary-directory=$T -M 150000"
$TC -o "$T/osm/vias.pmtiles" -l vias -Z8 -z15 --simplification=4 \
  --coalesce --reorder --drop-densest-as-needed "$T/osm/vias.geojsonseq"
$TC -o "$T/osm/agua.pmtiles" -l agua -Z8 -z15 --simplification=4 \
  --coalesce-smallest-as-needed "$T/osm/agua.geojsonseq"
$TC -o "$T/osm/verde.pmtiles" -l verde -Z7 -z15 --simplification=4 \
  --coalesce-smallest-as-needed --detect-shared-borders "$T/osm/verde.geojsonseq"
# Edificios: solo z15 y completos (medido: la tesela más pesada pesa 91 KB, no hace falta
# soltar nada). Regla: un edificio se ve completo o no se ve; nunca se fusionan alturas.
# El visor sobreamplía z15 hasta z18. Si una tesela no cabe, tippecanoe falla y se revisa.
$TC -o "$T/osm/edificios.pmtiles" -l edificios -Z15 -z15 --no-tiny-polygon-reduction \
  --simplification=2 "$T/osm/edificios.geojsonseq"

$N tile-join --force --no-tile-size-limit -o "$O/osm-bogota.pmtiles" \
  -n "OSM Bogotá D.C." -N "Vías, edificios, agua y verde de OpenStreetMap recortados a Bogotá D.C." \
  -A '<a href="https://www.openstreetmap.org/copyright">© colaboradores de OpenStreetMap</a>, ODbL 1.0' \
  "$T/osm/vias.pmtiles" "$T/osm/agua.pmtiles" "$T/osm/verde.pmtiles" "$T/osm/edificios.pmtiles"
pmtiles show "$O/osm-bogota.pmtiles" | head -20
