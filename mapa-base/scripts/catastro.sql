-- Construcciones de Catastro (UAECD, CC BY 4.0) con número de pisos. Lo corre scripts/catastro.sh.
-- Regla: los pisos se publican como pisos. No se convierten a metros. CONALTURA no entra:
-- es un código (valores -2, -1, -0,5, 0 y 1), no una altura en metros.
LOAD spatial;
SET memory_limit = '4GB';
SET threads = 4;
SET geometry_always_xy = true;
SET preserve_insertion_order = false;
COPY (
  SELECT CONNPISOS::INTEGER AS pisos,
         CONNSOTANO::INTEGER AS sotanos,
         geom
  FROM ST_Read('salida/trabajo/catastro/CONST.gpkg')
) TO 'salida/trabajo/catastro/construcciones.fgb' WITH (FORMAT GDAL, DRIVER 'FlatGeobuf', SRS 'EPSG:4326');

-- Resumen por sector catastral para la vista de ciudad (z11 a z13): pisos promedio
-- ponderado por área construida en planta y conteo. Sale de los mismos datos CC BY.
CREATE TEMP TABLE c AS
  SELECT CONNPISOS AS pisos, SHAPE_AREA AS a, ST_PointOnSurface(geom) AS pt
  FROM ST_Read('salida/trabajo/catastro/CONST.gpkg');
CREATE TEMP TABLE s AS
  SELECT SCACODIGO AS codigo, SCANOMBRE AS nombre, geom FROM ST_Read('salida/trabajo/sector/SECTOR.gpkg');
CREATE TEMP TABLE r AS
  SELECT s.codigo, any_value(s.nombre) AS nombre, count(*) AS construcciones,
         round(sum(c.pisos * c.a) / nullif(sum(c.a), 0), 1) AS pisos_prom,
         max(c.pisos) AS pisos_max
  FROM c JOIN s ON ST_Within(c.pt, s.geom) GROUP BY s.codigo;
COPY (SELECT r.*, s.geom FROM r JOIN s USING (codigo))
  TO 'salida/trabajo/catastro/pisos_por_sector.geojsonseq' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
SELECT 'conteo' AS q, (SELECT count(*) FROM c) AS construcciones,
       (SELECT sum(construcciones) FROM r) AS en_sectores, (SELECT count(*) FROM r) AS sectores;
