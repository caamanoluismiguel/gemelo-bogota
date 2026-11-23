#!/bin/sh
# Mide .pmtiles: teselas y bytes comprimidos con gzip (lo que baja el teléfono) por zoom.
# Uso: sh scripts/medir.sh [archivos...]   (sin argumentos mide salida/*.pmtiles y escribe salida/medidas.tsv)
set -eu
T="$PWD/salida/trabajo/medir"; mkdir -p "$T"
if [ $# -eq 0 ]; then set -- salida/*.pmtiles; OUT=salida/medidas.tsv; else OUT="$T/medidas-parciales.tsv"; fi
printf 'archivo\tzoom\tteselas\tbytes_total\tbytes_promedio\tbytes_max\n' > "$OUT"
for f in "$@"; do
  b=$(basename "$f" .pmtiles)
  rm -f "$T/$b.mbtiles"
  nice tile-join --force --quiet --no-tile-size-limit -o "$T/$b.mbtiles" "$f"
  sqlite3 -separator "$(printf '\t')" "$T/$b.mbtiles" \
    "SELECT '$b', zoom_level, count(*), sum(length(tile_data)), CAST(avg(length(tile_data)) AS INT), max(length(tile_data)) FROM tiles GROUP BY zoom_level ORDER BY zoom_level;" >> "$OUT"
done
column -t -s "$(printf '\t')" "$OUT"
