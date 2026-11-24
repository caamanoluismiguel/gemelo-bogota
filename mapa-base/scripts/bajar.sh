#!/bin/sh
# Baja las fuentes crudas del mapa base y anota URL, fecha y sha256.
# Uso: sh scripts/bajar.sh   (desde mapa-base/)
# Las salidas quedan en salida/crudos/, que no va al repo.
set -eu
CRUDOS="${CRUDOS:-salida/crudos}"
mkdir -p "$CRUDOS"
REG="$CRUDOS/descargas.tsv"
[ -f "$REG" ] || printf 'archivo\turl\tconsultado_utc\tbytes\tsha256\n' > "$REG"

bajar() { # $1 nombre local, $2 url
  dest="$CRUDOS/$1"
  if [ -s "$dest" ]; then echo "ya está: $1"; return 0; fi
  echo "bajando $1"
  curl -fL --retry 3 --retry-delay 5 -A "mapa-base-gemelo/1.0" -o "$dest.parcial" "$2"
  mv "$dest.parcial" "$dest"
  bytes=$(wc -c < "$dest" | tr -d ' ')
  sha=$(shasum -a 256 "$dest" | cut -d' ' -f1)
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$bytes" "$sha" >> "$REG"
}

# OpenStreetMap, extracto de Colombia de Geofabrik (ODbL 1.0). Se recorta a Bogotá D.C. después.
bajar colombia-latest.osm.pbf "https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"

# Datos Abiertos Bogotá (CC BY 4.0, verificado en CKAN el 23 nov 2026)
B=https://datosabiertos.bogota.gov.co/dataset
bajar localidades.gpkg      "$B/856cb657-8ca3-4ee8-857f-37211173b1f8/resource/b6c3fbda-1281-4735-8063-260e75ad95f8/download/loca.gpkg"
bajar upl.gpkg              "$B/808582fc-ffc8-4649-8428-7e1fd8d3820c/resource/e0345fb3-edd4-4844-b55c-ab6b787eb40b/download/unidadplaneamientolocal.gpkg"
bajar barrios-legalizados.gpkg "$B/36a80ef3-02c1-4a48-b3c7-c285e1de4323/resource/9937fa1f-91bb-441e-b299-bea1178e49c8/download/barriolegalizado.gpkg"
bajar sector-catastral.gpkg.zip "$B/6f5031cf-07d0-42c3-ba5c-4436eba0a2d9/resource/aebb0d9c-a475-407c-abb6-ac2fd978f31c/download/sector.gpkg.10.26.zip"
# Construcciones de Catastro con número de pisos (CC BY 4.0). Pesado: 393 MB.
if [ "${SIN_CATASTRO:-0}" != "1" ]; then
  bajar construcciones.gpkg.zip "$B/397ccbd8-e2c5-4700-b90e-b68d101ab0c5/resource/2e619105-f07a-45c9-944b-ecc8ee206ef1/download/const.gpkg.10.26.zip"
fi
# Censo del arbolado urbano del Jardín Botánico (SIGAU, CC BY 4.0, ficha censo-arbolado-urbano). 62 MB.
bajar arboladourbano.zip "$B/18721a34-0b1c-4399-bf2c-5f03fe5ef21a/resource/5a965d93-c623-40df-87e0-747cb51a1f5d/download/arboladourbano.zip"
echo "listo. Registro en $REG"
