# Procedencia del terreno de Bogotwin

Las cifras de cada corrida (URL, hora de consulta, bytes y sha256 de lo bajado, de los scripts y de los productos) quedan en `procedencia.json`, que genera `procedencia.py`. Este archivo guarda lo que no cambia entre corridas: de dónde sale cada dato, con qué licencia y cómo se atribuye.

## Cómo rehacerlo desde cero

```
cd mapa-base/terreno
make todo
```

`bajar.py` baja las fuentes a `mapa-base/salida/crudos/terreno/` (carpeta ignorada por git, cada fuente en la suya). `mosaico.py`, `teselas.py` y `horizonte.py` dejan sus productos y sus pruebas en `mapa-base/salida/terreno/`; `huellas.sql` y `prueba_a.py` dejan el control de la prueba A (`huellas_px.csv`, unos 330 MB, y `prueba_a.json`), que no entra en ningún producto; el PMTiles queda en `mapa-base/salida/terreno-bogota.pmtiles`. Todo se corre con `python -I` dentro de `.venv` (versiones en `requirements.txt`).

## Fuentes

### Modelo Digital de Terreno de Bogotá D.C. 2025 (MDT 2025)

- Qué es: suelo desnudo (sin edificios ni vegetación) en tres piezas: urbano LiDAR a 1 m, Cerros Orientales a 5 m y rural ZY3 a 10 m. Alturas en el datum GEOCOL2004.
- Ficha: https://datosabiertos.bogota.gov.co/dataset/modelo-digital-de-terreno-de-la-ciudad-de-bogota-ano-2025
- Servicio usado: https://serviciosgis.catastrobogota.gov.co/image/rest/services/Imagenes/modelodigitalterreno2025funcion/ImageServer (exportes a 1/3 de segundo, promediados 3 × 3 a la rejilla de 1 segundo). El servicio está abierto en la ruta `/image/rest/`; la ruta `/arcgis/rest/` pide token y no se usó.
- Licencia: CC BY 4.0, según la ficha de datos abiertos.
- Créditos que da el servicio (copyrightText): «Productos cartográficos generados por SIGLA S.A.S. — Sistemas de Información Geográfica de Latinoamérica, bajo los Contratos No. 1047/2024 (Secretaría Distrital de Planeación — DEM Urbano y Cerros Orientales) y No. 369-2025 (Unidad Administrativa Especial de Catastro Distrital — DEM Zona Rural).»
- Atribución propuesta: «Modelo Digital de Terreno 2025, Secretaría Distrital de Planeación y UAECD, publicado por IDECA, CC BY 4.0». El texto del panel solo nombra a la SDP; la pieza rural es de la UAECD, así que conviene nombrar a las dos.

### Copernicus DEM GLO-30

- Qué es: modelo de superficie (trae edificios y árboles) a 1 segundo de arco, alturas EGM2008.
- Origen: bucket público de AWS, `https://copernicus-dem-30m.s3.amazonaws.com`, teselas `N04_00_W075_00` y `N04_00_W074_00`. Registro: https://registry.opendata.aws/copernicus-dem
- Licencia: «Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open», verificada el 2026-11-23 en https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf
- Lo que pide el artículo 6 de esa licencia, y lo que toca a Bogotwin:
  - Nuestros productos modifican los datos (se filtran y se mezclan), así que va el aviso para datos adaptados, tal cual: «produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved».
  - Exención obligatoria en la licencia o el aviso que acompañe a los productos: «The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30».
  - No se puede dar a entender que el programa Copernicus respalda Bogotwin.
  - Quien reciba los datos queda obligado por las mismas condiciones.
- Corrección al panel: el texto de `sombras-DEBATE.md` (tabla de fuentes) omite «produced using» y «; all rights reserved». Usa el de arriba.
- Cita sugerida por el registro de AWS: «Copernicus Digital Elevation Model (DEM) was accessed on 2026-11-23 from https://registry.opendata.aws/copernicus-dem.»

### Catastro (solo control)

Los pisos y las huellas de `construcciones.fgb` (salida de `scripts/catastro.sql`, UAECD, CC BY 4.0) se usan solo para el control de la prueba A: `pisos_por_celda.sql` cuenta pisos por celda de 1″ (A2, residuo por clase en la sabana plana) y `huellas.sql` pasa las huellas de 5 o más pisos a píxeles de los exportes del MDT (A1, suelo dentro de la huella contra el anillo de 15 a 35 m). El criterio está en `panel/terreno-arreglos.md`. No entran en ningún producto.

### Puntos de referencia del horizonte

`puntos-referencia.json`, versión 2 (2026-11-23). Cada punto es el centroide de un objeto concreto de OpenStreetMap (la plaza o el parque, no el centroide del barrio que devolvía Nominatim en la versión 1), leído del extracto local `bogota.osm.pbf` de Geofabrik con osmium. Cada punto guarda el objeto (`osm`), qué es, por qué se eligió y las coordenadas de la versión 1 (`lon_v1`, `lat_v1`). Los que más se movieron: Bosa (1.395 m), Lucero (997 m), Timiza (294 m), Parque Nacional (202 m) y 20 de Julio (175 m). Datos © colaboradores de OpenStreetMap, ODbL 1.0. Solo sirven para la prueba; no se publican en el visor.

## Licencia de los productos

Las teselas y la rejilla de horizonte mezclan las dos fuentes. Por eso no pueden publicarse solo como CC BY: dentro del Distrito valen las condiciones de CC BY 4.0 del MDT, y fuera del Distrito (y en la franja de costura de 1.000 m hacia adentro del borde, ver `mosaico.py`) valen las de Copernicus, con su aviso y su exención. Propuesta de texto para el metadato del PMTiles y la página de créditos:

> Relieve: MDT 2025 © Secretaría Distrital de Planeación y UAECD, publicado por IDECA (CC BY 4.0); produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.

El metadato `attribution` del PMTiles generado ya lleva las dos primeras partes; la exención va en la página de créditos (el control de atribución del mapa no tiene espacio para ella). Esto es una propuesta: lo público pasa por el verificador y por el visto bueno de LM.

## Texto listo para pegar en `site/fuentes.html`

No está pegado: `site/` queda como está hasta que pase por el verificador y LM diga «publica». Reemplaza los dos primeros párrafos bajo `<h3>Relieve: atribución y exención</h3>`. Corrige además «franja de costura de 500 m», que ya es de 1.000 m. El copyrightText del servicio del MDT nombra a SIGLA S.A.S. como quien elaboró el modelo por contrato; CC BY pide atribuir a quien licencia (la SDP y la UAECD), así que SIGLA va como mención y no como titular.

```html
<p>Relieve: Modelo Digital de Terreno de Bogotá 2025 (MDT 2025), Secretaría Distrital de Planeación y Unidad Administrativa Especial de Catastro Distrital (UAECD), publicado por IDECA en <a href="https://datosabiertos.bogota.gov.co/dataset/modelo-digital-de-terreno-de-la-ciudad-de-bogota-ano-2025">Datos Abiertos Bogotá</a> bajo <a href="https://creativecommons.org/licenses/by/4.0/deed.es">CC BY 4.0</a>. Lo elaboró SIGLA S.A.S. por los contratos 1047/2024 (SDP, zona urbana y Cerros Orientales) y 369-2025 (UAECD, zona rural). Lo promediamos a una rejilla de unos 30 m y lo unimos con Copernicus en el borde.</p>
<p>Alrededor de Bogotá: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30. El programa Copernicus no respalda este visor.</p>
<p>El relieve mezcla las dos fuentes: dentro del Distrito vale el MDT 2025 con su CC BY 4.0; afuera, y en una franja de costura de 1.000 m hacia adentro del borde, vale la licencia de Copernicus. Quien reutilice el relieve recibe las mismas condiciones.</p>
```

Para el metadato `attribution` del PMTiles y el control de atribución del mapa (corto, sin la exención, que vive en la página de créditos):

```
Relieve: MDT 2025 © SDP y UAECD, IDECA (CC BY 4.0); produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved
```

La fila «Relieve del 3D dentro de Bogotá» de la tabla ya nombra a la SDP y la UAECD; no hay que cambiarla. Si sale la rejilla de horizonte, la fila «Sombra de los cerros» de «Lo que este visor no tiene» deja de ser cierta y hay que quitarla en el mismo cambio.
