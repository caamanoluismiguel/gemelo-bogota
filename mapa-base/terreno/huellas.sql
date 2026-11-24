-- Prueba A del paso 2, criterio nuevo (panel/terreno-arreglos.md): huellas de Catastro en la rejilla de
-- los exportes del MDT 2025 (1/3 de segundo, unos 10 m), en coordenadas de píxel, para comparar la altura
-- del suelo dentro de cada construcción con la de su alrededor. Solo control: no entra en ningún producto.
-- Lo corre terreno/Makefile desde mapa-base/. Origen de la rejilla: esquina del exporte mdt_c702_f576-1583.tif.
LOAD spatial;
SET memory_limit = '3GB';
SET threads = 4;
SET geometry_always_xy = true;
COPY (
  SELECT OGC_FID AS id, pisos,
         round(ST_Area(geom) * 111320.0 * 111320.0 * cos(radians(4.6)), 1) AS area_m2,
         ST_AsText(ST_ReducePrecision(ST_ExteriorRing(ST_Affine(g.geom, 10800.0, 0.0, 0.0, -10800.0,
                   74.4551388889 * 10800.0, 4.8401388889 * 10800.0)), 0.1)) AS anillo_px
  FROM (SELECT OGC_FID, pisos, unnest(ST_Dump(geom)).geom AS geom
        FROM ST_Read('salida/trabajo/catastro/construcciones.fgb')
        WHERE pisos > 0) g
  WHERE ST_Intersects(g.geom, ST_MakeEnvelope(-74.23, 4.45, -74.00, 4.84))
) TO 'salida/terreno/huellas_px.csv' (HEADER, DELIMITER '|');
