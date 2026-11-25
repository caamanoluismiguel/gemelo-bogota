# Buses troncales programados por hora

`frecuencia.py` lee el GTFS estático que TransMilenio publica cada día en el bucket público `gtfs-estaticos` y escribe `frecuencia/troncal.json`: para cada tramo entre dos estaciones troncales vecinas, cuántos buses troncales tienen programado pasar en cada hora, sumando los dos sentidos, en día hábil, sábado y domingo o festivo. También cuántos buses paran en cada estación.

Es la programación, no los buses en la calle. El visor lo dice así («programado») y marca las cifras como inferidas.

## Cómo cuenta

1. Toma los viajes de la agencia 1 (troncal). Duales, alimentadores, zonales y cable no entran.
2. El tipo de día sale de `calendar.txt`; los festivos son los días en que `calendar_dates.txt` agrega el servicio de domingo.
3. Cada vagón se junta con su estación (`parent_station`). Dos vagones seguidos de la misma estación son una parada.
4. Las estaciones se ubican sobre la forma del viaje (`shapes.txt`). Una estación a menos de 40 m de la forma por la que el bus pasa sin parar (expresos) también cuenta como paso, con la hora interpolada por distancia entre las paradas de verdad.
5. La hora es la de paso por la primera estación del tramo; pasadas las 24:00 vuelven a la hora 0 del mismo día de servicio.
6. La línea de cada tramo es el trozo de forma entre las dos estaciones, simplificado a 6 m.

En el centro hay rutas que dan la vuelta y comparten vía con otros tramos: el visor dibuja encima el más cargado y, al tocar, suma todos los tramos que hay bajo el dedo.

## Correr

```
python3 -I pipelines/frecuencia/frecuencia.py --salida _site/frecuencia
```

Revisa la licencia en la ficha de Datos Abiertos Bogotá (para si deja de ser una aceptada), lista el bucket y solo baja el zip (unos 120 MB) cuando hay uno nuevo. Con el zip ya bajado, la cuenta tarda unos 16 s y usa unos 180 MB de memoria. Solo biblioteca estándar, sin claves.

Para la copia que viene con el sitio:

```
python3 -I pipelines/frecuencia/frecuencia.py --zip GTFS_AAAAMMDD.zip --salida site/datos/transporte --nombre troncal-frecuencia.json
```

## En el repo vivo

Una vez al día basta (el zip sale hacia las 4:20 de Bogotá). Paso sugerido en `cosecha.yml`, detrás de `toca.py` con cadencia de 1440 min y `continue-on-error`, igual que las demás partes. Lo dispara quien maneja el repo vivo; este repo no lo toca.

## Licencia

CC BY-SA 4.0, como el GTFS (ver `evidencia-licencia.json`). El archivo va aparte y no se mezcla con datos CC BY-NC ni con OpenStreetMap.

Pruebas: `node pruebas/frecuencia.prueba.js` (incluye `pruebas/frecuencia_gtfs.py`, un GTFS de juguete sin red).
