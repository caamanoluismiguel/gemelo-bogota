# Fuentes de movilidad para Bogotwin

Consulta directa el 25 de noviembre de 2026. Cada fila dice qué hay hoy, con qué licencia, cada cuánto cambia, si pide clave y si una Action de GitHub la puede cosechar sin trabas. Lo que no se pudo abrir queda «por verificar».

Regla de licencias del proyecto: sirven CC0, CC BY, ODbL, CC BY-SA y CC BY-NC, con crédito; nunca NC junto con SA en un mismo archivo. Sin licencia declarada, la fuente queda fuera y pasa a pendientes. Nada se lee en vivo desde servidores del Distrito: se cosecha y se sirve desde nuestro Pages.

Marcas: **de fuente** es lo que la entidad publica tal cual; **inferido** es lo que calculamos a partir de eso; **de memoria** es lo que viene de la investigación anterior del panel (23 de noviembre) y no se volvió a abrir hoy.

## Resumen

| Fuente | Hay hoy | Licencia | Cada cuánto | Clave | Cosecha con Action | Uso |
|---|---|---|---|---|---|---|
| GTFS estático TransMilenio y SITP | Sí, un zip nuevo cada día | CC BY-SA 4.0 | Diario, cerca de las 4:20 de Bogotá | No | Sí | **Capa construida** |
| GTFS Realtime TransMilenio | Anunciado, no encontrado | Sin declarar | No se sabe | No se sabe | No | Pendiente |
| Velocidades SDM (Bitcarrier) | Solo histórico hasta noviembre 2022 | CC BY 4.0 | Ya no se actualiza | No | Sí, pero viejo | No sirve para «ahora» |
| Semáforos en falla en tiempo real (SDM) | Sí, servicio ArcGIS | Sin declarar | Minutos | No | Técnicamente sí | Fuera por licencia |
| Waze para Ciudades | No es abierto | Acuerdo privado | Minutos | Convenio | No | Fuera |
| Siniestralidad, puntos y tramos críticos 2022 a 2025 (SDM) | Sí | CC BY 4.0 | Anual | No | Sí | Candidata siguiente |
| Base de siniestros detallada (SDM) | Sí, servicio ArcGIS | Sin declarar | No se sabe | No | Técnicamente sí | Fuera por licencia |
| Trazados troncales TransMilenio | Sí | CC BY 4.0 | Cuando cambia la red | No | Sí | Ya en el visor |
| Estaciones troncales TransMilenio | Sí | CC BY 4.0 | Cuando cambia la red | No | Sí | Ya en el visor por GTFS |
| Validaciones diarias y mensuales SITP | Ficha sí, archivos no | CC BY y CC BY-SA | Diario y mensual | No | No: el enlace da 403 | Pendiente |
| Metro línea 1 y línea 2, trazado y estaciones | Sí | CC BY 4.0 | Cuando cambia el diseño | No | Sí | Ya en el visor (L1) |
| Ciclorruta (IDU) | Sí, GeoJSON en .7z | CC BY 4.0 | Ficha tocada el 25 nov 2026 | No | Sí, hay que abrir .7z | Candidata siguiente |
| Bicis compartidas (GBFS) | Sí | CC0 por la norma GBFS | Minutos | No | Sí | Ya en el visor |
| Red semafórica (inventario SDM) | Sí | CC BY 4.0 | Esporádica | No | Sí | Referencia, sin estado vivo |
| Cicloparqueaderos (SDM) | Sí | CC BY 4.0 | Esporádica | No | Sí | Referencia |
| Encuesta de Movilidad 2023 | Por verificar | Por verificar | Cada 4 o 5 años | Por verificar | Por verificar | Pendiente |

## Detalle

### GTFS estático de TransMilenio y SITP

- Archivos: bucket público https://storage.googleapis.com/gtfs-estaticos/ . Se puede listar sin clave. El 25 de noviembre tenía 374 objetos y un `GTFS_AAAAMMDD.zip` nuevo por día, publicado hacia las 09:20 UTC. El de hoy, `GTFS_20261125.zip`, pesa 117.936.269 B comprimido y unos 610 MB abierto; `stop_times.txt` solo ocupa 559 MB.
- Ficha y licencia: https://datosabiertos.bogota.gov.co/dataset/especificacion-gtfs-general-transport-feed-specification-sitp declara `CC-BY-SA-4.0` (metadatos del 18 de diciembre de 2023). El hub de TransMilenio cataloga versiones hasta el 27 de octubre de 2026 (169 entradas) sin campo de licencia propio; vale la de la ficha.
- Mobility Database la lista como mdb-3358, apuntando a una versión del 29 de abril de 2026.
- Qué trae: agencias 1 Troncal, 2 Alimentadores, 3 Zonal urbano, 4 Complementario, 5 Especial, 6 Dual, 7 TransMiCable. 160 estaciones con `location_type=1` y sus vagones como hijos. Tres servicios con viajes: 1 hábil, 2 sábado, 4 domingo; en festivos `calendar_dates` agrega el 4 y quita los otros. `frequencies.txt` solo cubre el cable. `shapes.txt` no trae distancia recorrida.
- Cosecha: sí. La Action lista el bucket, compara con lo publicado y solo baja cuando hay un zip nuevo. Por la licencia SA, todo lo derivado va en un archivo aparte, CC BY-SA 4.0, sin mezclar con OSM ni con datos NC.

### GTFS Realtime de TransMilenio

- Una nota de bogota.gov.co del 4 de noviembre de 2026 dice que el GTFS Realtime se publica en https://datosabiertos.bogota.gov.co/organization/transmilenio . Hoy esa organización tiene 34 conjuntos, ninguno en tiempo real; el más reciente se modificó el 19 de octubre de 2026.
- En el hub de TransMilenio, búsquedas por realtime, tiempo real, GTFS-RT, vehicle positions y posiciones dan 0 resultados. https://gis.transmilenio.gov.co/gtfs/ responde 500. Mobility Database no tiene un feed RT de Bogotá.
- Estado: **por verificar**. No hay URL, ni tipo de mensajes, ni licencia. No se puede usar.

### Velocidades y tráfico de la Secretaría Distrital de Movilidad

- Datos Abiertos Bogotá, organización sdm: 6 conjuntos (cicloparqueaderos, red semafórica, cámaras salvavidas, activos, zonas amarillas, zonas de cargue). Ninguno de velocidades ni de aforos.
- Hub de la SDM: capas mensuales «Velocidades Bitcarrier», CC BY 4.0, la última es de noviembre de 2022. Sirve como historia, no como «ahora».
- SIMUR, servicios DatosAbiertos: siniestralidad por puntos, tramos y zonas críticas 2022 a 2025 (CC BY 4.0, octubre 2026), red semafórica, cicloparqueaderos, cámaras salvavidas, barrios vitales.
- `SEM_FALLAS_TIEMPO_REAL` (semáforos en falla en vivo): sin licencia declarada, fuera.
- `Siniestralidad_BD` (AccidentalidadAnalisis): campo de licencia vacío, fuera.
- Malla vial integral (23 de julio de 2024): bajo la licencia general del hub de la SDM; por verificar si aplica CC BY a esa capa en particular.

### Waze para Ciudades

- 0 resultados en Datos Abiertos Bogotá y en el hub de la SDM. El servicio de Waze en SIMUR es interno. Waze para Ciudades se entrega por convenio y sus términos no permiten volver a publicar los datos. Fuera.

### Metro de Bogotá

- Conjuntos de la Empresa Metro en Datos Abiertos Bogotá: trazado y estaciones de la línea 1 y de la línea 2, CC BY 4.0, octubre de 2026. No hay GTFS del metro, porque aún no opera.
- Avance de obra de la línea 1: 84,68 % a octubre de 2026, de memoria (panel del 23 de noviembre), no se volvió a abrir hoy.

### Ciclorrutas

- https://datosabiertos.bogota.gov.co/dataset/cicloruta-bogota-d-c (IDU), CC BY 4.0, metadatos tocados el 25 de noviembre de 2026. GeoJSON dentro de un .7z: la Action necesita `7z` o `py7zr`, que no son biblioteca estándar.

### Bicis compartidas

- Feed GBFS ya cosechado por el visor. El feed no declara `license_id`, y la norma GBFS dice que entonces es CC0. Mobility Database lo lista con CC BY 4.0. Se da crédito igual, así que no cambia nada en la práctica, pero la diferencia queda anotada.

### Validaciones del SITP

- Ficha `validaciones-diarias-sitp`, CC BY 4.0; mensuales, CC BY-SA 4.0. Los enlaces a `storage.googleapis.com/validaciones_tmsa` responden 403. Pendiente hasta que el enlace funcione.

### Otros de TransMilenio

- `trazados-troncales-de-transmilenio`, CC BY 4.0, 19 de octubre de 2026: ya es la capa «troncal» del visor.
- `servicios-rutas-troncales-y-zonales`, CC BY 4.0.
- `patios-sitp` y `nuevas-zonas`: CC BY NC SA. Por la regla de no mezclar NC con SA, no se combinan con nada; quedan fuera por ahora.

## Qué permite decidir cada capa

| Capa | Decisión de ciudad | Qué permite anticipar |
|---|---|---|
| Buses troncales programados por hora (construida) | Dónde la oferta programada es más delgada fuera de la hora pico, qué tramos llevan más buses de los que caben en sus vagones | Qué corredores quedan cortos un domingo o festivo; dónde el cierre de una estación pega más fuerte según la hora |
| Siniestralidad por tramo crítico | Dónde priorizar pacificación, cruces y cámaras | Tramos que repiten año tras año |
| Ciclorruta | Dónde faltan conexiones entre la red de ciclorrutas y estaciones troncales o de metro | Qué estaciones del metro quedarán sin llegada en bici |
| GTFS Realtime (si aparece) | Cumplimiento real contra lo programado, por tramo y por hora | Retrasos que se acumulan en un corredor antes de que se note |

## Qué tendría que pedir el dueño para tener mejores datos

1. A TransMilenio: la URL pública del GTFS Realtime que anunció en noviembre de 2026, con su licencia escrita y los tipos de mensaje (posiciones, actualizaciones de viaje, alertas). Con eso se compara lo programado con lo que pasa.
2. A TransMilenio: arreglar el bucket `validaciones_tmsa`, que hoy da 403 aunque la ficha sea CC BY.
3. A la Secretaría Distrital de Movilidad: volver a publicar velocidades por tramo (lo que fue Bitcarrier) con CC BY, y declarar licencia en `SEM_FALLAS_TIEMPO_REAL` y en `Siniestralidad_BD`.
4. Waze para Ciudades exige convenio y no deja volver a publicar; no vale la pena para un visor abierto.

Ninguna de estas solicitudes se ha hecho. El proyecto no contacta entidades ni crea cuentas.
