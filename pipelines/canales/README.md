# Nivel de quebradas, ríos y canales

`canales.py` arma `canales/ahora.json` y `canales/serie-48h.ndjson.gz` en el repo de datos vivos con los sensores de nivel del Sistema de Alerta de Bogotá (SAB) del IDIGER. Solo usa la biblioteca estándar de Python y ninguna clave.

```
python3 -I pipelines/canales/canales.py --sitio _site --cierres _cierres --manifiestos vivo/manifiestos
```

## Qué mide la lectura

Comprobado el 24 nov 2026 por dos vías que no dependen una de la otra.

**1. El código del visor oficial del SAB.** `https://app.sab.gov.co/sab/js/niveles.js` (sha256 `b65ebce6…1069`) calcula el espejo de agua así:

```js
if (data.IDTIPOLECTURA == 1) {
    espejoagua = parseFloat(data.MINSENSOR) + parseFloat(data.VALORLECTURA);
} else {
    espejoagua = parseFloat(data.COTASENSOR) - parseFloat(data.VALORLECTURA);
}
var borde = parseFloat(data.NIVELDESBORDAMIENTO) - parseFloat(espejoagua);
```

y la gráfica de 7 días (`/sab/faces/js/graficaNivel.js`, sha256 `e40120e3…f890`) lo dice con comentarios: `///distancia NO` sobre el tipo 2 y `//nivel SI` sobre el tipo 1. Las estaciones con `IDTIPOLECTURA` 0 son del acueducto y el SAB no da su lectura.

**2. Una creciente real.** Serie oficial de 7 días (`/Nivel/SvltDataNiveles`, `number=3`) de cuatro sensores del río Tunjuelo, el 21 nov 2026 en la noche (hora de Bogotá):

| Sensor | Tipo | Lectura antes | Lectura en el pico | Hora del pico |
|---|---|---|---|---|
| San Benito | 1 (altura) | 1,054 m a las 19:00 | 1,461 m | 19:50 |
| Autopista Sur | 2 (distancia) | 4,724 m a las 19:00 | 4,476 m | 23:20 |
| Kennedy | 2 (distancia) | 10,15 m a las 20:30 | 10,11 m | 21:10 a 22:00 |

En la misma onda, la lectura del tipo 1 **sube** y la del tipo 2 **baja**. Solo cuadra si el tipo 2 es la distancia del sensor al agua. Con la fórmula oficial el espejo sube en los tres, primero aguas arriba y unas tres horas y media después aguas abajo, como baja una creciente por el río.

**3. Sentido común con la geometría del propio sensor.** El 24 nov a las 19:10, si el tipo 2 fuera altura, San Francisco (quebrada Limas) tendría el agua 5,1 m por encima del desborde y Kennedy 4,5 m. Leído como distancia, los 13 sensores quedan entre el fondo y el desborde, con 2,4 a 7,7 m de borde libre.

No se confirmó la lluvia de esa noche con un pluviómetro: la creciente está en la serie de nivel, no en un registro de lluvia nuestro.

## Licencia

CC BY‑NC 4.0, con crédito: «Datos: IDIGER, Sistema de Alerta de Bogotá (SAB)». La ficha publicada cubre la lluvia; el nivel no tiene ficha propia y le aplicamos la del SAB **[inferido]**. Evidencia con URL, fecha, texto y huellas en `evidencia-licencia.json`. Antes de publicar, el verificador y LM deben aceptar esa extensión.

El archivo solo lleva datos del SAB y cálculos hechos solo con ellos. No se combina con nada CC BY‑SA.

## Etiquetas

* `lectura_m`: **medido**, tal cual la da el sensor.
* `espejo_msnm` y `borde_libre_m`: **inferido**, la misma cuenta del visor oficial.
* `desborde_msnm` y `umbrales_msnm` (bajo, medio, alto): **de fuente**, los publica el IDIGER. Hoy 7 de 13 sensores traen umbrales. Si un sensor no los trae, va `null` y no se inventan.

## Reglas

* El gemelo no emite alertas. Dice «nivel bajo, medio o alto según los umbrales del IDIGER» y enlaza al visor oficial.
* Un `IDTIPOLECTURA` distinto de 1 y 2 no se interpreta: el sensor va sin espejo ni borde libre.
* `dudoso` = 1 si la lectura es negativa o deja el agua más de 1 m bajo el fondo o más de 3 m sobre el desborde. El número se muestra igual, con la marca.
* La serie de 48 h guarda una fila por corrida. Los huecos quedan como huecos.
* Peso medido el 24 nov 2026: `ahora.json` 6,2 KB (unos 2 KB con gzip); la serie, unos 270 B por fila comprimida sola, menos en conjunto.
