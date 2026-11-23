-- Límites oficiales (CC BY 4.0) a GeoJSONSeq en WGS84. Lo corre scripts/limites.sh desde mapa-base/.
LOAD spatial;
SET memory_limit = '2GB';
SET threads = 4;
SET geometry_always_xy = true;
-- Proyección CarMAGBOG, copiada del WKT que trae el GeoJSON oficial de barrios legalizados.
SET VARIABLE carmagbog = '+proj=tmerc +lat_0=4.680486111 +lon_0=-74.14659167 +k=1 +x_0=92334.879 +y_0=109320.965 +a=6380687 +rf=298.257222101 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

CREATE TABLE loc AS
SELECT LocCodigo AS codigo, LocNombre AS nombre,
       ST_Transform(SHAPE, 'EPSG:4686', 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/localidades.gpkg');

CREATE TABLE upl AS
SELECT CODIGO_UPL AS codigo, NOMBRE AS nombre, SECTOR AS sector,
       ST_Transform(SHAPE, 'EPSG:4686', 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/upl.gpkg');

CREATE TABLE sec AS
SELECT SCACODIGO AS codigo, SCANOMBRE AS nombre, SCATIPO AS tipo, geom
FROM ST_Read('salida/trabajo/sector/SECTOR.gpkg');

CREATE TABLE bl AS
SELECT CODIGO_ID AS codigo, NOMBRE AS nombre, ESTADO AS estado,
       CODIGO_UPZ AS codigo_upz, CODIGO_LOCALIDAD AS codigo_localidad,
       ST_Transform(SHAPE, getvariable('carmagbog'), 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/barrios-legalizados.gpkg');

-- Comprobación de la reproyección: casi todos los barrios deben caer dentro del D.C.
CREATE TABLE dc AS SELECT ST_Union_Agg(geom) AS geom FROM loc;
SELECT 'barrios_legalizados_dentro_dc' AS chequeo,
       count(*) FILTER (WHERE ST_Within(ST_PointOnSurface(bl.geom), dc.geom)) AS dentro, count(*) AS total
FROM bl, dc;

COPY (SELECT 'Bogotá D.C.' AS nombre, geom FROM dc)
  TO 'salida/trabajo/bogota-dc.geojson' WITH (FORMAT GDAL, DRIVER 'GeoJSON');
COPY loc TO 'salida/trabajo/limites/localidades.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
COPY upl TO 'salida/trabajo/limites/upl.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
COPY sec TO 'salida/trabajo/limites/sectores.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
COPY bl  TO 'salida/trabajo/limites/barrios_legalizados.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
-- Puntos para rótulos (uno por polígono, siempre dentro de él).
COPY (SELECT 'localidad' AS nivel, nombre, ST_PointOnSurface(geom) AS geom FROM loc
      UNION ALL SELECT 'upl', nombre, ST_PointOnSurface(geom) FROM upl
      UNION ALL SELECT 'sector', nombre, ST_PointOnSurface(geom) FROM sec)
  TO 'salida/trabajo/limites/rotulos.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
SELECT 'conteos' AS c, (SELECT count(*) FROM loc) loc, (SELECT count(*) FROM upl) upl,
       (SELECT count(*) FROM sec) sec, (SELECT count(*) FROM bl) bl;
