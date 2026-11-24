# Terreno de Bogotwin: mosaico, teselas raster-dem y rejilla de horizonte.
# Uso (desde mapa-base/terreno):  make todo
# Herramientas: python3, pmtiles y duckdb (brew install pmtiles duckdb).
# Necesita salida/trabajo/bogota-dc.geojson y salida/trabajo/catastro/construcciones.fgb del Makefile de mapa-base.
# Un trabajo pesado a la vez: mosaico.py llega a unos 4,5 GB de memoria.

PY := .venv/bin/python -I
NICE := nice -n 10

.PHONY: todo entorno crudos mosaico teselas horizonte prueba_a procedencia

todo: entorno crudos mosaico teselas horizonte prueba_a procedencia

entorno: .venv/bin/python
.venv/bin/python: requirements.txt
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	touch .venv/bin/python

crudos:
	$(PY) bajar.py

../salida/terreno/pisos_por_celda.csv: pisos_por_celda.sql
	mkdir -p ../salida/terreno
	cd .. && $(NICE) duckdb -no-agent < terreno/pisos_por_celda.sql

mosaico: ../salida/terreno/pisos_por_celda.csv
	$(NICE) $(PY) mosaico.py

teselas:
	$(NICE) $(PY) teselas.py

horizonte:
	$(NICE) $(PY) horizonte.py

# Prueba A, criterio nuevo (panel/terreno-arreglos.md). Solo control: no entra en ningún producto.
# huellas_px.csv pesa unos 330 MB; prueba_a.py llega a unos 4,2 GB de memoria.
../salida/terreno/huellas_px.csv: huellas.sql
	mkdir -p ../salida/terreno
	cd .. && $(NICE) duckdb -no-agent < terreno/huellas.sql

prueba_a: ../salida/terreno/huellas_px.csv
	$(NICE) $(PY) prueba_a.py

procedencia:
	$(PY) procedencia.py
