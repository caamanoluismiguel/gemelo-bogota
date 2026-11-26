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
         -- tono: número de 0 a 15 sacado del código de lote (o de la construcción si no hay
         -- lote). Solo sirve para que el visor dé a cada edificio su color ilustrativo; las
         -- construcciones de un mismo lote comparten tono. Medido el 24 nov 2026: con 0 a 255
         -- el archivo crecía 11,9 %; con 0 a 15 los valores se repiten y la tesela crece menos.
         (hash(coalesce(LOTECODIGO, CONCODIGO)) % 16)::INTEGER AS tono,
         geom
  FROM ST_Read('salida/trabajo/catastro/CONST.gpkg')
) TO 'salida/trabajo/catastro/construcciones.fgb' WITH (FORMAT GDAL, DRIVER 'FlatGeobuf', SRS 'EPSG:4326');

-- Construcciones lejanas (z12 a z15, solo para el fondo de la vista inclinada): las de una
-- misma manzana y el mismo número de pisos se unen en una sola huella y se simplifican a
-- ~1 m. Los pisos siguen siendo los de Catastro, sin promedios. Manzana = 9 primeros
-- dígitos del código de lote; sin lote, cada construcción va sola.
-- techo: color de techo medido en la Ortoimagen 2025 (SDP/IDECA, CC BY 4.0) por
-- scripts/techos.sh, índice de la paleta corta TECHO_COLOR de site/comun.js. Por grupo va
-- el color que cubre más área; si menos de la mitad del área del grupo tiene color medido,
-- el grupo queda sin techo y el visor usa su paleta supuesta. Medido el 25 nov 2026: partir
-- los grupos por color sumaba 62 KB por vista en z15; con un solo color por grupo, nada.
CREATE TEMP TABLE k AS
  SELECT coalesce(left(LOTECODIGO, 9), CONCODIGO) AS manzana, CONNPISOS::INTEGER AS pisos,
         SHAPE_AREA AS a, t.techo, geom
  FROM ST_Read('salida/trabajo/catastro/CONST.gpkg')
  LEFT JOIN read_csv('salida/trabajo/catastro/techos.csv',
                     types = {'fid': 'BIGINT', 'techo': 'INTEGER', 'techo_q': 'INTEGER'}) t USING (fid);
CREATE TEMP TABLE kt AS
  SELECT manzana, pisos, arg_max(techo, area) AS techo, sum(area) AS a_medida
  FROM (SELECT manzana, pisos, techo, sum(a) AS area FROM k WHERE techo IS NOT NULL GROUP BY ALL)
  GROUP BY ALL;
COPY (
  SELECT g.pisos, CASE WHEN kt.a_medida >= 0.5 * g.a THEN kt.techo END AS techo, g.geom
  FROM (SELECT manzana, pisos, sum(a) AS a,
               ST_SimplifyPreserveTopology(ST_Union_Agg(ST_MakeValid(geom)), 0.00001) AS geom
        FROM k GROUP BY manzana, pisos) g
  LEFT JOIN kt USING (manzana, pisos)
) TO 'salida/trabajo/catastro/construcciones_lejos.fgb' WITH (FORMAT GDAL, DRIVER 'FlatGeobuf', SRS 'EPSG:4326');
DROP TABLE k;

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
