-- Índice del buscador de barrios (CC BY 4.0, SDP y UAECD) para la página.
-- Una fila por nombre: localidad, UPL, sector catastral y barrio legalizado, con su caja.
-- Lo corre scripts/buscador.sh desde mapa-base/ después de limites.
LOAD spatial;
SET geometry_always_xy = true;
SET VARIABLE carmagbog = '+proj=tmerc +lat_0=4.680486111 +lon_0=-74.14659167 +k=1 +x_0=92334.879 +y_0=109320.965 +a=6380687 +rf=298.257222101 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

CREATE TABLE loc AS
SELECT LocNombre AS nombre, ST_Transform(SHAPE, 'EPSG:4686', 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/localidades.gpkg');
CREATE TABLE upl AS
SELECT NOMBRE AS nombre, ST_Transform(SHAPE, 'EPSG:4686', 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/upl.gpkg');
CREATE TABLE sec AS
SELECT SCANOMBRE AS nombre, geom FROM ST_Read('salida/trabajo/sector/SECTOR.gpkg');
CREATE TABLE bl AS
SELECT NOMBRE AS nombre, ST_Transform(SHAPE, getvariable('carmagbog'), 'EPSG:4326', always_xy := true) AS geom
FROM ST_Read('salida/crudos/barrios-legalizados.gpkg');

CREATE TABLE todo AS
SELECT 'localidad' AS nivel, nombre, geom FROM loc
UNION ALL SELECT 'upl', nombre, geom FROM upl
UNION ALL SELECT 'sector', nombre, geom FROM sec
UNION ALL SELECT 'barrio', nombre, geom FROM bl;

-- La localidad de cada fila: la que contiene un punto de su superficie.
CREATE TABLE salida AS
SELECT t.nivel, trim(t.nombre) AS nombre, any_value(l.nombre) AS localidad,
       round(ST_XMin(t.geom), 5) AS x0, round(ST_YMin(t.geom), 5) AS y0,
       round(ST_XMax(t.geom), 5) AS x1, round(ST_YMax(t.geom), 5) AS y1
FROM todo t LEFT JOIN loc l ON ST_Within(ST_PointOnSurface(t.geom), l.geom)
WHERE t.nombre IS NOT NULL AND trim(t.nombre) <> '' AND t.geom IS NOT NULL
GROUP BY ALL;

SELECT nivel, count(*) n, count(localidad) con_localidad FROM salida GROUP BY nivel ORDER BY nivel;
COPY (SELECT * FROM salida ORDER BY nivel, nombre) TO 'salida/trabajo/buscador.csv' (HEADER);
