# ¿Qué pasa si…?

Herramienta de escenarios en la pestaña «Probar» del visor. Mueves una perilla y el mapa muestra cómo cambiaría algo de la ciudad. Lo que se ve es un escenario: no es lo que está pasando hoy ni lo que va a pasar. Por eso el mapa lleva un marco morado y un sello arriba mientras dura, y siempre hay un botón «Volver a hoy».

Archivos:

- `site/escenarios-modelo.js`: las cuentas, solo funciones puras. Corre en el navegador y en Node.
- `site/escenarios.js`: el panel, las capas del mapa, el sello y la URL (`?esc=`).
- `pruebas/escenarios.prueba.js`: pruebas con los datos reales del sitio.
- `mapa.js` baja los dos archivos la primera vez que abres «Probar» o si la URL trae `?esc=`.

Cada escenario se arma con el esquema XLRM:

- X son las incertidumbres, lo que nadie controla;
- L son las palancas, lo que decide quien usa la herramienta;
- R es el modelo;
- M son las métricas.

Una perilla sin una decisión detrás no entra.

Marcas de las cifras, con el sistema del sitio:

- **de fuente**: un umbral publicado.
- **inferido**: sale de un dato con una cuenta corta y defendible, como el valor anual de una franja o la posición del sol.
- **supuesto**: lo pone el escenario, como el valor del día o el ritmo de crecimiento.
- **estimado**: un resultado que mezcla lo anterior.

Ningún resultado de esta herramienta es medido.

## 1. Aire de un día malo

**La decisión.** Un día de aire malo, ¿a quién le toca avisar y desde qué valor? La puede tomar una secretaría, un rector o una red de salud. La herramienta muestra cuántos colegios y sedes de salud quedarían sobre el umbral de aviso que elijas, y dónde cambia la respuesta.

**X, lo que nadie controla.**

- El PM2,5 promedio del día en la ciudad, de 5 a 100 µg/m³ (supuesto). Atajos:
  - el valor de hoy según CAMS (estimado, ya está en el sitio);
  - el promedio de 2025, 13,1 µg/m³ (inferido);
  - 15 y 37 (de fuente).
- Cómo se reparte el día entre zonas. Aquí se fija con un supuesto (ver R) y no tiene perilla, porque no hay datos abiertos por día y por zona que la respalden.

**L, lo que decides.**

- «Avisas desde», con dos posiciones. No es continua porque solo hay dos umbrales de 24 horas con respaldo:
  - la guía de la OMS de 2021 para 24 horas, 15 µg/m³ (de fuente);
  - la norma colombiana de 24 horas, 37 µg/m³, de la Resolución 2254 de 2017, art. 2, tabla 1 (de fuente).
- A quién avisas: a los colegios, a las sedes de la red pública de salud o a los dos.

**R, el modelo.**

- Media de 2025 de la ciudad: m = Σ(vᵢ·Aᵢ) / ΣAᵢ, con las 8 franjas del PM2,5 anual de 2025 de la SDA, pesadas por su área. Da 13,12 µg/m³ (inferido).
- Valor del día en un lugar: P·v / m. v es el valor anual de la franja donde cae el lugar. El supuesto es que el día malo se reparte como el promedio del año, así que las zonas sucias del año son las sucias del día.
- Un lugar queda «sobre» el umbral si P·v / m > U. Los lugares fuera del área que interpola la SDA quedan aparte: 49 colegios y 4 sedes. No se cuentan ni como limpios ni como sucios.
- Puntos de quiebre, con v en la franja de cada lugar:
  - el primer lugar pasa cuando P = U·m / v_max;
  - todos pasan cuando P = U·m / v_min.
- Cuánto se ve. Se usa la fórmula de Koschmieder, la misma de la bruma del cielo en `vivo-datos.js`:
  - V = 3,912 / β;
  - β = 1,2·10⁻⁵ + 4·1,5·10⁻⁶·PM, en 1/m.
- La visibilidad se da como rango, de la zona más sucia a la más limpia. Sirve para comparar, no para medir.

**M, las métricas.**

- Colegios sobre el umbral, de los 2.127 que tienen valor.
- Sedes de salud sobre el umbral, de las 112 que tienen valor.
- Los dos puntos de quiebre.
- La visibilidad en km.

Algunos valores (todos estimados):

| PM2,5 del día (P) | Umbral | Colegios sobre el umbral | Visibilidad |
|---|---|---|---|
| 13,1 (promedio de 2025) | OMS | 979 | |
| 13,1 (promedio de 2025) | norma | 0 | |
| 25 | OMS | 2.127 (todos) | |
| 25 | norma | 66 | |
| 37 | norma | 979 | unos 17 km en la ciudad (8 a 20 km por zona) |

Puntos de quiebre para colegios (inferidos):

| Umbral | Pasa el primero | Pasan todos |
|---|---|---|
| OMS | P = 6,6 | P = 17,8 |
| norma | P = 16,3 | P = 44,0 |

Lo que esto dice para la decisión. Con la guía de la OMS, casi cualquier día de aire regular ya pone a media ciudad en aviso. Con la norma, hace falta un día de episodio para que pase algo. Entre las dos reglas hay unos 20 µg/m³ en que la respuesta cambia del todo.

**En el mapa.**

- Las franjas se pintan con el valor del día:
  - claro hasta 15;
  - rosado de 15 a 37;
  - morado sobre 37.
- Los colegios sobre tu umbral salen en negro y los demás en blanco. Las sedes de salud sobre tu umbral salen en verde lleno.
- Con el 3D prendido, la bruma del cielo sigue el escenario. La barra lo dice («Escenario, no el aire de hoy») con la marca supuesto.

**Límites.**

- La SDA entrega solo ocho franjas. Por eso la cuenta salta de a muchos colegios a la vez.
- El valor anual de cada lugar lo interpoló la SDA entre estaciones. No se midió en el lugar.
- Un día real puede cargarse hacia un lado de la ciudad. Pasa con el viento del oriente o con los incendios del Llano. El supuesto de reparto proporcional no lo ve.
- Koschmieder con un factor fijo de humedad es una aproximación de orden de magnitud.

**Fuentes.**

- SDA, PM2,5 promedio anual 2025, CC BY 4.0. Archivo `site/datos/aire/pm25-anual-2025.geojson`, con su procedencia en `procedencia.json`.
- SED, colegios, CC BY‑SA 4.0. SDS, red pública de salud, CC BY 4.0.
- OMS, WHO global air quality guidelines (2021), tabla 0.1. https://www.who.int/publications/i/item/9789240034228 (consultada el 25 nov 2026).
- Ministerio de Ambiente, Resolución 2254 de 2017, art. 2, tabla 1. https://www.minambiente.gov.co/wp-content/uploads/2021/10/Resolucion-2254-de-2017.pdf (consultada el 25 nov 2026).
- CAMS, el valor de hoy que ya baja `pronostico.js`.

## 2. Árboles en una calle

**La decisión.** Si siembras una fila de árboles en una calle, ¿qué porte eliges y a qué distancia? Esta parte se puede usar en una junta de acción comunal, en un concurso de arborización o en un diseño de andén. La herramienta muestra cuánta sombra darían a cierta hora, cuántos años tardan en darla y hacia dónde cae.

**X, lo que nadie controla.** Cuánto crecen. No hay curvas de crecimiento publicadas para los árboles de calle de Bogotá (por verificar). Por eso no hay perilla. La cuenta corre siempre con tres ritmos a la vez y muestra el rango (supuesto):

- lento: 0,3 m al año;
- medio: 0,6 m al año;
- rápido: 1 m al año.

En los tres casos el árbol mide 2 m al sembrarlo.

**L, lo que decides.**

- Porte, con su altura adulta (supuesto): bajo de 6 m, medio de 12 m o alto de 20 m.
- Separación entre árboles, de 4 a 16 m.
- Número de árboles, de 2 a 20.
- El giro de la fila, de 0° a 175°, para que siga la calle. 0° va de sur a norte y 90° de occidente a oriente. La cuadrícula de Bogotá no va justo al norte.
- Dónde: tocas la calle en el mapa.

**Cuándo miras.** No es palanca ni incertidumbre:

- años después de sembrar, de 0 a 30;
- el día: hoy, 21 de junio o 21 de diciembre;
- la hora, de 6 a 18; por defecto las 2 p. m.

**R, el modelo.**

- Altura a t años: h = min(adulto, 2 + ritmo·t).
- Copa redonda con las proporciones de `arboles.js` (supuesto), la forma redonda:
  - tronco libre max(1,2; 0,35·h);
  - radio de copa min(8; 0,8 + 0,36·h);
  - para árboles chicos, el radio nunca pasa de la mitad del alto.
- Sol: posición con las ecuaciones del NOAA en `sol.js` (inferido).
- Sombra de la copa. La copa es un elipsoide y su sombra sobre suelo plano es una elipse:
  - el centro queda a hc·cot(α) del pie, hacia el lado contrario del sol;
  - el semieje largo es √((r·sen α)² + (c·cos α)²) / sen α;
  - el semieje corto es r.
  - Aquí hc es la altura del centro de la copa, α la altura del sol, r el radio y c la mitad del alto de la copa.
- El tronco proyecta una franja.
- El área se cuenta en una cuadrícula de 0,5 m, sin contar dos veces donde se juntan dos copas.
- Andén: una franja de 3 m de ancho a lo largo de la fila, con los árboles en el medio (supuesto). Se cuenta qué parte queda a la sombra.

**M, las métricas.**

- Altura a esa edad, como rango de lento a rápido.
- Metros cuadrados de sombra en el suelo, como rango, con el valor medio y lo que da cada árbol.
- Parte del andén a la sombra, como rango.
- Hacia dónde cae la sombra y a cuántos metros del pie.
- En cuántos años llega a su altura adulta, según el ritmo.

Un ejemplo: 10 árboles de porte medio a 8 m, a los 10 años, a las 2 p. m. del 25 de noviembre. El sol está a 48° y al suroccidente.

- Los árboles miden de 5 a 12 m, 8 m con ritmo medio (supuesto).
- La sombra es de 233, 498 y 864 m² con ritmo lento, medio y rápido (estimado).
- La sombra cae hacia el nororiente, con el centro de la copa a unos 5 m del pie.
- Solo 30 a 33 % del andén queda a la sombra.

Lo que esto dice para la decisión. A media tarde la sombra se corre fuera de la fila. Por eso importa en qué lado de la calle siembras, y eso puede pesar tanto como cuántos árboles pones.

**En el mapa.**

- La mancha oscura es la sombra con ritmo medio.
- La línea continua es la sombra con ritmo lento y la de rayas, con ritmo rápido.
- Las copas y los troncos se ven en 3D con el ritmo medio.
- Una raya morada marca el andén que se cuenta.

**Límites.**

- Suelo plano y cielo despejado. No cuenta los edificios que ya tapan el sol ni los árboles que ya están ahí. Hay que mirarlo junto a la capa de sombras del sitio.
- Son portes, no especies. Un urapán y un sietecueros del mismo porte dan copas distintas.
- No cuenta mortalidad. Con cada árbol que falte, la sombra baja en su parte.
- Un día de nubes no hay sombra marcada. La cuenta es para un día despejado.

**Fuentes.**

- NOAA, ecuaciones del sol (Meeus) en `sol.js`.
- Proporciones de copa de `arboles.js`, contrastadas con la ortofoto IDECA 2025 en la calle 72 con carrera 7.

## Lo que se dejó por fuera y por qué

- **Lluvia y nivel de los canales.** No hay curvas de nivel contra caudal ni hidrología de cuencas abiertas. La respuesta de un canal depende de cuánta agua ya trae el suelo y de la lluvia aguas arriba, que el sitio no tiene. Además, los datos del SAB son CC BY‑NC y aquí solo se citan.
- **Heladas por localidad.** Solo hay dos estaciones abiertas en el aeropuerto. El aire frío que se encharca en los bajos no sale de la elevación sola, así que un mapa por localidad sería inventado.
- **NO₂ según el tráfico.** Pasar de vehículos a concentración pide un modelo de dispersión con meteorología por hora y emisiones por vía, y no hay datos abiertos que lo respalden.
- **Más perillas en el aire**, como el viento o la estación. Sin datos abiertos por día y por zona, una perilla así movería el mapa sin respaldo.
