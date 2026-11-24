-- Arbolado urbano de Bogotá (censo SIGAU del Jardín Botánico, JBB, CC BY 4.0). Lo corre
-- scripts/arboles.sh. Cada árbol queda como un punto con dos números:
--   h  altura total en decímetros, tal cual la publica el censo (Altura_Tot, en m) redondeada
--      a 0,1 m. Es dato de fuente.
--   f  forma de la copa, sacada aquí del nombre común de la especie (inferido):
--      0 copa redonda (la mayoría), 1 palma, 2 conífera, 3 eucalipto (copa alta y angosta).
-- El censo no publica el diámetro de copa: el visor lo calcula con la altura y la forma
-- (supuesto, ver site/arboles.js). Las plantas de menos de 1,5 m no entran: a esa altura son
-- arbustos o árboles recién sembrados que casi no se ven desde la calle.
LOAD spatial;
SET memory_limit = '3GB';
SET threads = 4;
SET geometry_always_xy = true;
SET preserve_insertion_order = false;
COPY (
  SELECT CAST(round(Altura_Tot * 10) AS INTEGER) AS h,
         CASE
           WHEN Nombre_Esp ILIKE 'palm%' OR Nombre_Esp ILIKE '%palmiche%' OR Nombre_Esp ILIKE 'yuca%'
             OR Nombre_Esp ILIKE 'helecho palma%' THEN 1
           WHEN Nombre_Esp ILIKE '%pino%' OR Nombre_Esp ILIKE '%cipr%' OR Nombre_Esp ILIKE 'araucaria%'
             OR Nombre_Esp ILIKE '%criptomeria%' THEN 2
           WHEN Nombre_Esp ILIKE 'eucalipto%' THEN 3
           ELSE 0
         END AS f,
         -- EPSG:4686 (MAGNA-SIRGAS) a WGS84 sin cambio de datum, igual que las localidades.
         ST_Point(ST_X(geom), ST_Y(geom)) AS geom
  FROM ST_Read('salida/trabajo/arboles/ArboladoUrbano.shp')
  WHERE Altura_Tot >= 1.5 AND Altura_Tot <= 60
) TO 'salida/trabajo/arboles/arboles.fgb' WITH (FORMAT GDAL, DRIVER 'FlatGeobuf', SRS 'EPSG:4326');
