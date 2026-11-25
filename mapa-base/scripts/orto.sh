#!/bin/sh
# Ortoimágenes 2025 de la SDP, publicadas por IDECA (CC BY 4.0), servidas desde aquí.
# El visor nunca le pide nada al servidor del Distrito: se bajan una vez, se pasan a WebP
# y se empacan en PMTiles que van al release junto con las demás teselas.
#
#   sh scripts/orto.sh bajar   baja lo que falte a salida/orto-crudo/ (se puede cortar y repetir)
#   sh scripts/orto.sh armar   arma los cinco PMTiles en salida/ y parte la urbana en ocho
#                              franjas de menos de 60 MB (scripts/orto_partir.py); se
#                              publican las franjas, no el archivo entero
#
# Qué se baja (zoom de teselas de 256 px salvo donde se dice):
#   urbana  orthourbana2025funcion  z16 a z18 en toda la extensión, z19 en 3 km alrededor
#           de la vista de arranque (-74.0585, 4.6535)
#   cerros  orthocerros2025funcion  z13 a z16 (NoData 255)
#   cerros lejos                    z11 con teselas de 512 px (el servicio no dibuja más grueso
#                                   que unos 40 m por píxel)
#   rural   orthorural2025funcion   z11 a z14 (NoData 0); cubre solo la zona rural del sur
# Desde mapa-base/. Necesita el .venv de terreno (Pillow) y pmtiles (brew install pmtiles).
set -eu
PY="terreno/.venv/bin/python -I"
N="nice -n 10"

bajar() {
  $PY scripts/orto_bajar.py --servicio orthourbana2025funcion --zoom 16-18 \
    --caja -74.0585,4.6535,3 --zoom-caja 19
  $PY scripts/orto_bajar.py --servicio orthocerros2025funcion --nodata 255 --zoom 13-16
  $PY scripts/orto_bajar.py --servicio orthocerros2025funcion --nodata 255 --zoom 11-11 --px 512
  $PY scripts/orto_bajar.py --servicio orthorural2025funcion --nodata 0 --zoom 11-14
}

armar() {
  A="$N $PY scripts/orto_armar.py"
  # z19 va aparte y con bounds justos: fuera de esa caja el visor estira z18 en vez de pedir
  # teselas z19 que no existen.
  $A orthourbana2025funcion orto-urbana-bogota \
    "Ortoimagen urbana 2025 de Bogotá" 256 16-18
  # Pages no sirve bien el archivo urbano entero (420 MB, 503): se publica en franjas.
  $N python3 -I scripts/orto_partir.py salida/orto-urbana-bogota.pmtiles salida
  $A orthourbana2025funcion orto-urbana-cerca-bogota \
    "Ortoimagen urbana 2025 de Bogotá, centro a z19" 256 19-19
  $A orthocerros2025funcion orto-cerros-bogota \
    "Ortoimagen Cerros Orientales 2025" 256
  $A orthocerros2025funcion@512 orto-cerros-lejos-bogota \
    "Ortoimagen Cerros Orientales 2025, vista lejana" 512
  ORTO_TITULAR=UAECD $A orthorural2025funcion orto-rural-bogota \
    "Ortoimagen satelital rural 2025 de Bogotá (sur)" 256
  # La foto de lejos (z10 a z15) sale de las mismas teselas WebP, sin bajar nada. El visor ya
  # usa esta en vez de orto-cerros-lejos y orto-rural. El satélite del entorno va aparte:
  # scripts/satelite_entorno.py (necesita rasterio).
  $N $PY scripts/orto_lejos.py
}

case "${1:-}" in
  bajar) bajar ;;
  armar) armar ;;
  *) echo "uso: sh scripts/orto.sh bajar|armar" >&2; exit 2 ;;
esac
