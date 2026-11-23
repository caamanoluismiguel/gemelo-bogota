# El cielo de Bogotá ahora

`cielo.py` arma `data/cielo/ahora.json` (y copia `goes19-bogota.jpg`) para la tarjeta del mismo nombre. Usa solo la biblioteca estándar de Python y ninguna clave.

```
python3 -I pipelines/cielo/cielo.py --salida data/cielo --anterior <ruta o URL del ahora.json anterior>
```

El workflow de propuesta está en `.github/workflows/cielo.yml`. Corre cada 20 minutos y publica con `actions/deploy-pages`, sin commit, en un repo aparte solo para lo vivo.

## Reglas que cumple

* Cada bloque trae `fuente`, `url`, `hora_dato`, `hora_consulta`, `edad_min_al_generar`, `licencia` y `etiqueta`. La edad se recalcula en el navegador con `hora_dato`.
* Si una fuente falla, el bloque queda con `estado: "falla"`, el error y `ultimo_valor` (lo último bueno del JSON anterior, con su edad). Si no hay anterior, `ultimo_valor` es `null`. Nunca se inventa un valor.
* El gemelo no emite alertas propias. Las alertas oficiales son del IDIGER y del IDEAM; el JSON trae sus enlaces.
* Nada de RMCAB.
* Ningún cálculo mezcla datos CC BY‑NC con datos CC BY‑SA. El único cálculo propio sobre datos NC es el resumen por localidad del SAB, hecho solo con datos del SAB.

## Etiquetas

* **medido**: lo registró un instrumento (pluviómetro, METAR, sismógrafo, detección de calor, imagen de satélite).
* **estimado**: sale de un modelo o de una relación teórica (UV de CAMS, lluvia del radar por Marshall‑Palmer).
* **simulado**: escenario. No se usa en esta tarjeta.

## Fuentes (todas consultadas el 23 nov 2026)

| Bloque | Fuente | Licencia | Etiqueta | Se actualiza |
|---|---|---|---|---|
| `metar` | Aviation Weather Center, METAR de SKBO y SKGY | Dominio público NOAA/NWS | medido | cada hora |
| `lluvia_sab` | IDIGER, Sistema de Alerta de Bogotá, `ServletTipoSensores?idtiposensor=5` (documentado en Datos Abiertos Bogotá) | CC BY‑NC 4.0 | medido | cada minuto, sin validar |
| `radar_tablazo` | IDEAM, acumulados del radar de Tablazo (bart.ideam.gov.co) | CC BY‑SA 4.0 (datos.gov.co 9ii9‑i4ym) | estimado | cada hora, con 4 a 5 h de atraso |
| `goes19` | NOAA GOES‑19 GeoColor por NASA GIBS (WMS) | Dominio público, pide reconocimiento | medido | cada 10 min |
| `uv` | CAMS global por Open‑Meteo | Datos CC BY 4.0; la API gratis es solo para uso no comercial | estimado | cada hora |
| `focos_calor` | NASA FIRMS, VIIRS NOAA‑20 y NOAA‑21, CSV de 24 h de Suramérica | Datos abiertos NASA, citar «NASA FIRMS» | medido | por paso de satélite |
| `sismos` | USGS ComCat, 300 km, M 2,5 o más, 30 días | Dominio público de EE. UU. | medido | al ocurrir |

## Decisiones

* **GOES se copia.** Es dominio público y el recorte de 512 × 512 pesa unos 40 KB. El WMS de GIBS es inestable: en las pruebas respondió HTML con código 200 en cerca de la mitad de las consultas y, para el tiempo más reciente, un cuadro negro de 1,8 KB. El script exige un JPEG de más de 8 KB y prueba hasta 12 tiempos.
* **El radar de Tablazo se enlaza, no se copia.** La imagen pesa unos 290 KB, cubre medio país y lleva SA. Se muestra solo si la persona toca el enlace. Si tiene más de 1 hora, la tarjeta dice «Radar sin imagen reciente». Paso siguiente: recortarla a Bogotá en Actions (necesita Pillow) y publicar el recorte aparte, como CC BY‑SA 4.0, con crédito al IDEAM y su aviso «Producto en evaluación».
* **El SAB entra** porque tiene una forma abierta y documentada de leerlo. Va en su propio bloque y no se cruza con el radar.
* **Sin datos de hoy, la estación del SAB va en gris**: `sin_dato_hoy: true` y acumulado `null`.
* **Focos de calor**: se dice «0 focos detectados», nunca «no hay incendios». Un foco a menos de 2 km del relleno Doña Juana lleva una nota.
* **METAR**: rótulo «Aeropuerto, no tu calle». El QNH no es la presión en Bogotá.
