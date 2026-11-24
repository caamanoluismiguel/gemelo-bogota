#!/bin/sh
# Índice del buscador de barrios para la página. Necesita haber corrido limites (usa SECTOR.gpkg).
# Uso: sh scripts/buscador.sh   (desde mapa-base/)
set -eu
nice -n 10 duckdb -no-agent -csv < scripts/buscador.sql
python3 -I scripts/buscador.py
