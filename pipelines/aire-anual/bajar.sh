#!/bin/sh
# Baja UNA VEZ lo que necesita la capa «Aire de siempre» y lo deja en una carpeta aparte.
# El visor nunca le pide nada a estos servidores: sirve lo que arma armar.py en site/datos/aire/.
# Uso: sh pipelines/aire-anual/bajar.sh /ruta/vacia   (después: python3 -I pipelines/aire-anual/armar.py /ruta/vacia)
set -eu
D="${1:?falta la carpeta de descarga}"
mkdir -p "$D"
cd "$D"
date -u +%Y-%m-%dT%H:%M:%SZ > fecha.txt
P=https://datosabiertos.bogota.gov.co
# PM2,5 promedio anual 2025, SDA (CC BY 4.0)
curl -sS -m 120 -o pm25.geojson "$P/dataset/a32d342a-fe03-44a9-b006-b5997a816f70/resource/d6b61b68-9e28-4b9e-91dd-1b4dbdce9e94/download/pm25_prom_anual.geojson"
curl -sS -m 60 -o ficha-pm25.json "$P/api/3/action/package_show?id=pm-25-promedio-anual-bogota-d-c"
# Colegios, SED, corte del 30 sep 2026 (CC BY-SA 4.0)
curl -sS -m 120 -o colegios.geojson "$P/dataset/d451b52f-e30c-43b3-9066-3a7816638fea/resource/4cb45e38-779b-483b-acc4-5673c5db9505/download/colegios092026.geojson"
curl -sS -m 60 -o ficha-colegios.json "$P/api/3/action/package_show?id=colegios-bogota-d-c"
# Red adscrita de salud, SDS (CC BY 4.0). El GeoJSON del portal viene sin atributos; el servicio
# REST que enlaza la misma ficha trae el nombre de cada sede.
curl -sS -m 120 -o salud.geojson "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/salud/instituciones/MapServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
curl -sS -m 60 -o ficha-salud.json "$P/api/3/action/package_show?id=red-adscrita-de-salud-para-bogota"
shasum -a 256 pm25.geojson colegios.geojson salud.geojson
