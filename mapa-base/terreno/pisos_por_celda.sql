-- Control de la prueba A del paso 2: pisos máximos de Catastro por celda de 1 segundo del mosaico.
-- Sirve para comprobar que el suelo no trae edificios: si quedaran, las celdas con torres
-- sobresaldrían más que las celdas con casas. Lo corre terreno/Makefile (desde mapa-base/).
-- Entrada: salida/trabajo/catastro/construcciones.fgb (lo deja scripts/catastro.sql).
LOAD spatial;
SET memory_limit = '3GB';
SET threads = 4;
SET geometry_always_xy = true;
COPY (
  SELECT CAST(round((ST_Y(ST_Centroid(geom)) * -1 + 5.0) * 3600) AS INTEGER) AS fila,
         CAST(round((ST_X(ST_Centroid(geom)) + 74.65) * 3600) AS INTEGER) AS col,
         max(pisos) AS pisos_max, count(*) AS n
  FROM ST_Read('salida/trabajo/catastro/construcciones.fgb')
  WHERE pisos > 0
  GROUP BY ALL
) TO 'salida/terreno/pisos_por_celda.csv' (HEADER, DELIMITER ',');
