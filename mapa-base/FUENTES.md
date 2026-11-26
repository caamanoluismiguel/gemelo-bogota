# Fuentes del mapa base de Bogotá

Consulta y descarga: 23 de noviembre de 2026 (UTC). La URL exacta, la hora, los bytes y el sha256 de cada archivo crudo quedan en `salida/crudos/descargas.tsv` cada vez que corre `make bajar`. El sha256 de cada producto queda en `salida/manifest.json` (`make manifiesto`).

## Cómo se rehace

```
brew install tippecanoe pmtiles osmium-tool duckdb
cd mapa-base
make todo          # bajar, limites, osm, catastro, medir, manifiesto (en serie)
make servir        # abre http://127.0.0.1:8106/vista.html
```

DuckDB instala su extensión `spatial` la primera vez (lee y escribe GPKG, FGB y GeoJSONSeq). No hace falta GDAL aparte. `salida/` no va al repo.

## Fuentes que entran

| Capa | Productor | URL de descarga | Ficha | Licencia (verificada en la ficha el 23 nov 2026) | Última modificación según la ficha |
|---|---|---|---|---|---|
| Calles, edificios, agua, verde | Colaboradores de OpenStreetMap, extracto de Geofabrik | https://download.geofabrik.de/south-america/colombia-latest.osm.pbf (esa vez redirigió a colombia-261122) | https://www.openstreetmap.org/copyright | ODbL 1.0, atribución obligatoria | 22 nov 2026 (fecha del extracto) |
| Localidades (20) | Secretaría Distrital de Planeación (SDP) | https://datosabiertos.bogota.gov.co/dataset/856cb657-8ca3-4ee8-857f-37211173b1f8/resource/b6c3fbda-1281-4735-8063-260e75ad95f8/download/loca.gpkg | https://datosabiertos.bogota.gov.co/dataset/856cb657-8ca3-4ee8-857f-37211173b1f8 | CC BY 4.0 | 28 feb 2023 |
| Unidades de Planeamiento Local (UPL, POT 2021) | SDP | https://datosabiertos.bogota.gov.co/dataset/808582fc-ffc8-4649-8428-7e1fd8d3820c/resource/e0345fb3-edd4-4844-b55c-ab6b787eb40b/download/unidadplaneamientolocal.gpkg | https://datosabiertos.bogota.gov.co/dataset/808582fc-ffc8-4649-8428-7e1fd8d3820c | CC BY 4.0 | 20 feb 2025 |
| Barrios legalizados | SDP | https://datosabiertos.bogota.gov.co/dataset/36a80ef3-02c1-4a48-b3c7-c285e1de4323/resource/9937fa1f-91bb-441e-b299-bea1178e49c8/download/barriolegalizado.gpkg | https://datosabiertos.bogota.gov.co/dataset/36a80ef3-02c1-4a48-b3c7-c285e1de4323 | CC BY 4.0 | 3 jul 2026 |
| Sector catastral (el «barrio común» de Catastro) | Unidad Administrativa Especial de Catastro Distrital (UAECD) | https://datosabiertos.bogota.gov.co/dataset/6f5031cf-07d0-42c3-ba5c-4436eba0a2d9/resource/aebb0d9c-a475-407c-abb6-ac2fd978f31c/download/sector.gpkg.10.26.zip | https://datosabiertos.bogota.gov.co/dataset/6f5031cf-07d0-42c3-ba5c-4436eba0a2d9 | CC BY 4.0 | 5 nov 2026 |
| Arbolado urbano (censo SIGAU) | Jardín Botánico de Bogotá José Celestino Mutis (JBB) | https://datosabiertos.bogota.gov.co/dataset/18721a34-0b1c-4399-bf2c-5f03fe5ef21a/resource/5a965d93-c623-40df-87e0-747cb51a1f5d/download/arboladourbano.zip | https://datosabiertos.bogota.gov.co/dataset/censo-arbolado-urbano | CC BY 4.0 (verificada el 24 nov 2026) | 27 oct 2026 |
| Construcciones con número de pisos | UAECD | https://datosabiertos.bogota.gov.co/dataset/397ccbd8-e2c5-4700-b90e-b68d101ab0c5/resource/2e619105-f07a-45c9-944b-ecc8ee206ef1/download/const.gpkg.10.26.zip | https://datosabiertos.bogota.gov.co/dataset/397ccbd8-e2c5-4700-b90e-b68d101ab0c5 | CC BY 4.0 | 4 nov 2026 |
| Ortoimagen urbana 2025 (solo para medir el color de techo) | Secretaría Distrital de Planeación (SDP), publicada por IDECA | Teselas z18 del servicio `orthourbana2025funcion`, las mismas de `make orto-bajar` | https://datosabiertos.bogota.gov.co/dataset/servicio-web-geografico-ortoimagen-para-la-zona-urbana-de-la-ciudad-de-bogota-d-c-2025 | CC BY 4.0 (releída el 25 nov 2026, ficha modificada ese día a las 20:07) | 2025 |

Notas de proyección:
- Localidades vienen en EPSG:4686 (MAGNA-SIRGAS). Se pasan a WGS84 sin transformación de datum. Hasta donde sé (no lo medí), la diferencia es de menos de un metro y no se nota en un mapa base.
- El GPKG de barrios legalizados no declara sistema de coordenadas. Se usó el WKT CarMAGBOG (cartesiana local de Bogotá) que trae el GeoJSON oficial del mismo conjunto. Comprobación medida: 1.775 de 1.775 barrios caen dentro del D.C., y 1.772 coinciden con su código de localidad.
- Construcciones y sectores ya vienen en EPSG:4326.

## Qué trae cada archivo producido

| Archivo | Licencia | Capas | Zooms |
|---|---|---|---|
| `salida/osm-bogota.pmtiles` | ODbL 1.0 | `vias`, `agua`, `verde`, `edificios` | 7 a 15 (edificios solo en 15) |
| `salida/limites-bogota.pmtiles` | CC BY 4.0 | `localidades`, `upl`, `sectores`, `barrios_legalizados`, `rotulos` | 6 a 14 |
| `salida/catastro-pisos-bogota.pmtiles` | CC BY 4.0 | `pisos_sector` (promedio por sector), `construcciones` (con `techo` en z14 y z15) | 10 a 15 y 16 |
| `salida/catastro-lejos-bogota.pmtiles` | CC BY 4.0 | `construcciones` unidas por manzana y pisos, con `techo` | 12 y 13 |
| `salida/arboles-bogota.pmtiles` | CC BY 4.0 | `arboles` (puntos con `h` y `f`) | solo 16 (el visor lo usa desde el zoom 15) |

### Alturas y pisos (lo que es dato y lo que no)

- **Edificios OSM.** `altura_m` sale solo de la etiqueta `height` cuando es un número en metros. Si no la hay, `altura_conocida = false` y `fuente_altura = "desconocida"`; la vista los pinta grises con borde punteado y no los levanta. `building:levels` va aparte como `pisos_osm` y nunca se convierte a metros. Medido en el extracto: 145.012 edificios, 2.132 con `height` (1,5 %), 9.911 con `building:levels` (6,8 %).
- **Construcciones de Catastro.** `pisos` = `CONNPISOS` y `sotanos` = `CONNSOTANO`, tal cual, sin convertir a metros. Medido: 2.422.631 construcciones, 99,3 % con pisos mayor que 0, mediana 2, máximo 67.
- **`CONALTURA` no se usa.** Es un código, no metros. Medido: solo toma los valores 0 (1.858.000 casos), 1 (491.607), y unos pocos -1, -0,5 y -2.
- **`pisos_sector`** es el promedio de pisos ponderado por área construida (`SHAPE_AREA`) de las construcciones de cada sector catastral, con `pisos_max` y `n`. Es un dato derivado, no medido en campo. 61 construcciones caen fuera de todo sector y no cuentan.
- **Árboles del censo SIGAU.** `h` = altura total (`Altura_Tot`) en decímetros, de fuente. `f` = forma de copa inferida del nombre de la especie (0 redonda, 1 palma, 2 conífera, 3 eucalipto). El censo no publica el diámetro de copa: el visor lo supone con la altura y la forma. Entran 1.121.290 de 1.472.670 registros: quedan fuera los de menos de 1,5 m o más de 60 m. Medido: 948.256 redondas, 36.728 palmas, 86.378 coníferas y 49.928 eucaliptos.
- **`techo`** (solo z12 a z15, en las huellas unidas) es el índice del color de techo en la paleta corta de 11 colores (`scripts/techos.py`, `TECHO_COLOR` en `site/comun.js`). Es un dato derivado de la Ortoimagen urbana 2025: mediana de R, G y B dentro de la huella de Catastro encogida 1 m, en la foto z18 (unos 60 cm por píxel). Solo construcciones de hasta 4 pisos (la foto no es «verdadera» y el techo de las altas sale corrido). Sin color si más del 30 % de la muestra es verde, más del 50 % es sombra, quedan menos de 20 píxeles útiles o falta foto. Por grupo unido va el color que cubre más área, y solo si el área medida es la mitad o más. Medido el 25 nov 2026: 1.176.186 construcciones con color (48,5 % de 2.422.631; 78 % del área construida en planta); 128.041 de 171.749 grupos unidos llevan `techo`. Para el visor: color medido en foto 2025; sin `techo`, la paleta de ladrillo supuesta. `make techos` lo arma antes de `make catastro`; sin él, `catastro` sale igual, sin `techo`.
- Las alturas de OSM y los pisos de Catastro nunca se mezclan en una misma capa ni en un mismo archivo.

## Fuentes que NO entran y por qué

| Fuente | Estado | Motivo |
|---|---|---|
| UPZ (Unidades de Planeamiento Zonal) | Fuera, por verificar | No tiene ficha en el portal de datos abiertos. El servicio REST de Catastro (`ordenamientoterritorial/unidadplaneamientozonal`) solo dice «Secretaría Distrital de Planeación - SDP» en `copyrightText`, sin licencia. Mientras no aparezca una licencia escrita, se usan UPL, sectores catastrales y barrios legalizados. El campo `codigo_upz` de los barrios legalizados es solo un código. |
| Mapa de Referencia IDECA | No usado por ahora | CC BY 4.0, 1,9 GB, ficha modificada el 28 ago 2026. No trae capa de UPZ y lo que hace falta ya sale de los conjuntos de arriba. |
| MDS 2022 de la EAAB (alturas) | Fuera mientras el verificador lo revisa | Licencia CC BY‑NC‑SA según lo que se sabe hoy. No es definitiva para este repo. |
| Alturas en metros para edificios sin `height` en OSM | No existen aquí | No se inventan. Siguen marcadas como desconocidas. |

## Qué no se puede mezclar

Regla de trabajo: **un archivo, una licencia**. Así cada pieza conserva su atribución y nadie tiene que decidir sobre una base de datos combinada.

- **OSM (ODbL) siempre en archivo aparte.** Si una base derivada mezcla OSM con otra fuente, esa base queda bajo ODbL (cláusula de compartir igual de la base de datos). Las imágenes o mapas que se produzcan a partir de ellas se pueden publicar con la atribución.
- **ODbL con CC BY‑SA no.** Cada una exige que el derivado vaya con su propia licencia y no son compatibles entre sí.
- **CC BY‑SA con CC BY‑NC (o NC‑SA) no.** Lo NC prohíbe el uso comercial y SA obliga a no agregar restricciones. Por eso el MDS 2022 (NC‑SA) no puede ir en un archivo con nada que sea SA distinto, y nunca en el repo AGPL como dato si su licencia es NC.
- **CC BY 4.0 con CC BY 4.0 sí.** Por eso límites (SDP y UAECD) y construcciones (UAECD) podrían unirse; se dejan separados por peso y por zoom.
- **El código del repo (AGPL‑3.0) es una cosa y los datos otra.** La licencia del código no cubre los PMTiles; cada uno conserva la suya.

## Atribución que debe verse en el mapa

- © colaboradores de OpenStreetMap, ODbL
- SDP y UAECD, Datos Abiertos Bogotá, CC BY 4.0
- UAECD (Catastro Bogotá), Datos Abiertos Bogotá, CC BY 4.0
- Ortoimagen 2025 SDP/IDECA, CC BY 4.0. Modificada: color mediano de techo derivado
- Árboles: JBB, censo SIGAU, Datos Abiertos Bogotá, CC BY 4.0

La vista ya las muestra en el control de atribución (plegado en el teléfono, se abre con la «i»).

## Lo que usa la vista de prueba (no son datos)

- MapLibre GL JS 5.24.1 (BSD 3 cláusulas), desde unpkg con SRI.
- pmtiles 4.5.0 (BSD 3 cláusulas), desde unpkg con SRI.
- Glifos Noto Sans de `protomaps.github.io/basemaps-assets` (Noto Sans va con SIL Open Font License). Para publicar conviene copiarlos al sitio y no depender de ese dominio.
