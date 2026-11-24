# Mapa base de Bogotá. Cada paso pesado corre en serie (make no paraleliza aquí).
# Uso desde mapa-base/:  make todo   |  make bajar  |  make limites  |  make osm  |  make catastro
# Herramientas: brew install tippecanoe pmtiles osmium-tool duckdb
.NOTPARALLEL:
.PHONY: todo bajar limites osm catastro buscador medir manifiesto servir

todo: bajar limites osm catastro buscador medir manifiesto

bajar:
	sh scripts/bajar.sh

limites:
	sh scripts/limites.sh

# osm recorta con salida/trabajo/bogota-dc.geojson, que sale de limites
osm: limites
	nice -n 10 sh scripts/osm.sh

catastro:
	nice -n 10 sh scripts/catastro.sh

medir:
	sh scripts/medir.sh
	python3 -I scripts/costo_vista.py salida/trabajo/medir/*.mbtiles

manifiesto:
	python3 -I scripts/manifiesto.py

servir:
	python3 -I scripts/servir.py

buscador: limites
	sh scripts/buscador.sh
