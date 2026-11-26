-- Huellas para medir el color de techo (scripts/techos.py). Lo corre scripts/techos.sh.
-- Solo construcciones de hasta 4 pisos: en la ortofoto (que no es «verdadera») el techo de un
-- edificio más alto sale corrido de su huella y el color sería el de la calle o el vecino.
-- Cada huella se encoge 1 m hacia adentro (en EPSG:3857, que en Bogotá, a 4,6° de latitud,
-- estira menos de 0,4 %): así el borde del techo, el alero y la sombra del muro quedan fuera.
-- tx, ty: tesela z15 del centro de la huella, para leer la foto por bloques.
LOAD spatial;
SET memory_limit = '4GB';
SET threads = 4;
SET geometry_always_xy = true;
SET preserve_insertion_order = false;
COPY (
  WITH h AS (
    SELECT fid, CONNPISOS AS pisos,
           ST_Buffer(ST_Transform(geom, 'EPSG:4326', 'EPSG:3857'), -1.0) AS g
    FROM ST_Read('salida/trabajo/catastro/CONST.gpkg')
    WHERE CONNPISOS <= 4
  )
  SELECT fid, pisos,
         floor((ST_X(ST_Centroid(g)) + 20037508.342789244) / 40075016.68557849 * 32768)::INTEGER AS tx,
         floor((20037508.342789244 - ST_Y(ST_Centroid(g))) / 40075016.68557849 * 32768)::INTEGER AS ty,
         hex(ST_AsWKB(g)) AS wkb
  FROM h WHERE NOT ST_IsEmpty(g)
  ORDER BY tx, ty
) TO 'salida/trabajo/catastro/techos-huellas.csv' (HEADER, DELIMITER ',');
SELECT 'huellas' AS q,
       (SELECT count(*) FROM ST_Read('salida/trabajo/catastro/CONST.gpkg')) AS construcciones,
       (SELECT count(*) FROM read_csv('salida/trabajo/catastro/techos-huellas.csv')) AS con_huella_encogida;
