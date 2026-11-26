# Mapa base de Bogotá. Cada paso pesado corre en serie (make no paraleliza aquí).
# Uso desde mapa-base/:  make todo   |  make bajar  |  make limites  |  make osm  |  make catastro
# Herramientas: brew install tippecanoe pmtiles osmium-tool duckdb
.NOTPARALLEL:
.PHONY: todo bajar limites osm osm3d catastro arboles orto orto-bajar buscador medir manifiesto servir

todo: bajar limites osm catastro osm3d arboles buscador medir manifiesto

bajar:
	sh scripts/bajar.sh

limites:
	sh scripts/limites.sh

# osm recorta con salida/trabajo/bogota-dc.geojson, que sale de limites
osm: limites
	nice -n 10 sh scripts/osm.sh

catastro:
	nice -n 10 sh scripts/catastro.sh

# Edificios con forma (partes de OSM con alto, base y techo). Lee el extracto de osm y el archivo
# de catastro para comparar alturas y saber qué cajas tapar; sale un archivo aparte, ODbL.
osm3d:
	sh scripts/osm3d.sh

arboles:
	nice -n 10 sh scripts/arboles.sh

# Ortoimágenes 2025 (IDECA, CC BY 4.0). Se bajan una vez (horas; se puede cortar y repetir)
# y se arman aparte: no entran en «todo» para no volver a pedirle nada al servidor.
orto-bajar:
	sh scripts/orto.sh bajar

orto:
	sh scripts/orto.sh armar

medir:
	sh scripts/medir.sh
	python3 -I scripts/costo_vista.py salida/trabajo/medir/*.mbtiles

manifiesto:
	python3 -I scripts/manifiesto.py

servir:
	python3 -I scripts/servir.py

buscador: limites
	sh scripts/buscador.sh
