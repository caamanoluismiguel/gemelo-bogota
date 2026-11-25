# «Pregúntale a la ciudad» con un modelo de lenguaje

Propuesta para decidir. No está construida.

## Lo que hay hoy

La caja «Pregúntale a la ciudad» contesta en el navegador, con nuestros datos y sin servidor (`site/preguntar-logica.js`). Reconoce diez temas (aire, lluvia, frío, temperatura, UV, sol, canales, bicis, edificio más alto, colegios con peor aire) y los nombres de localidades, UPL y barrios. Lo que no reconoce lo contesta con «Eso no lo sé todavía» y las preguntas que sí sabe. No cuesta nada y no se equivoca de cifra, pero no entiende preguntas fuera de esos moldes, como «¿qué localidad respira mejor?» o «¿llovió más ayer que hoy?».

En el repositorio ya hay un Worker de Cloudflare (`worker/`) sin desplegar, con la clave como secreto, Turnstile, límite por visitante y tope mensual. Esta propuesta lo reutiliza y le agrega herramientas.

## Cómo sería

1. **Primero el motor local.** El navegador sigue contestando lo que ya sabe, gratis. Solo las preguntas que el motor local no entiende (intención `desconocida`) van al Worker. Así el modelo atiende una fracción de las preguntas.
2. **Worker de Cloudflare** con la clave guardada con `wrangler secret put ANTHROPIC_API_KEY`. La clave nunca llega al navegador ni al repositorio.
3. **Modelo** `claude-opus-5-5` por defecto, con las instrucciones fijas en caché.
4. **Solo herramientas sobre nuestro JSON.** El modelo no navega ni busca en la web. Tiene herramientas que leen los mismos archivos públicos del sitio, con las mismas funciones puras que ya usa la caja: `buscar_lugar`, `aire`, `lluvia`, `frio`, `sol`, `canales`, `bicis`, `edificio_mas_alto`, `colegios_aire`. Cada herramienta devuelve cifras con su marca (medido, estimado, de fuente, inferido), su hora y su fuente.
5. **Control de cifras.** Antes de mostrar la respuesta, el Worker revisa que cada número que escribe el modelo aparezca en lo que devolvieron las herramientas. Si alguno no aparece, se descarta la respuesta y se muestra «Eso no lo sé todavía».
6. **La procedencia la pone el sitio**, no el modelo: las marcas, horas y licencias salen de las herramientas y se pintan igual que en el panel.
7. **Límites**, los que ya tiene el Worker: origen exacto, Turnstile, 5 preguntas por hora por visitante (Durable Object), tope mensual con reserva antes de llamar (Durable Object) y el límite duro de gasto en la Console de Anthropic. El enlace de límite de Cloudflare (`ratelimit`) es aproximado y por ubicación, así que no sirve como tope de gasto; el tope lo hace el Durable Object.
8. **CSP.** Hay que sumar el dominio del Worker a `connect-src` y el script de Turnstile a `script-src` y `frame-src`.

## Cuánto costaría al mes

Precios de `claude-opus-5-5` (de fuente, [tabla de precios de Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), consultada el 25 nov 2026): entrada 4 USD por millón de tokens, salida 20, lectura de caché 0,20 y escritura de caché de 5 minutos 5. Workers: gratis hasta 100.000 pedidos al día; el plan pago parte de 5 USD al mes ([precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/), consultada el 25 nov 2026). Si los Durable Objects exigen el plan pago está **por verificar**.

Supuestos de cada pregunta (supuesto, no medido):

| Parte | Tokens | Costo |
|---|---|---|
| Instrucciones y herramientas, en caché | unos 3.500, dos vueltas | 0,001 a 0,018 USD (según si la caché está fría) |
| Pregunta y resultados de herramientas | 1.000 a 3.000 | 0,004 a 0,012 USD |
| Salida con razonamiento, dos vueltas | 1.000 a 2.500 | 0,02 a 0,05 USD |
| **Total por pregunta** | | **0,03 a 0,08 USD** |

El README del Worker ya calculaba 0,04 a 0,08 USD cobrados por pregunta sin herramientas, del mismo orden.

| Preguntas al mes que llegan al modelo | Modelo | Worker | Total |
|---|---|---|---|
| 300 | 9 a 24 USD | 0 a 5 USD | **9 a 29 USD** |
| 1.000 | 30 a 80 USD | 0 a 5 USD | **30 a 85 USD** |
| 5.000 | 150 a 400 USD | 5 USD | **155 a 405 USD** |

Con el tope actual de 20 USD al mes, el asistente atendería entre 250 y 650 preguntas y después diría que se acabó el presupuesto del mes. Si las preguntas que el motor local ya contesta son la mayoría (supuesto: la mitad o más), el número de visitas que cabe en ese tope se duplica.

Un modelo más barato (Sonnet 5.5 cuesta la mitad; Haiku 5.5, unas 40 veces menos) bajaría el costo en la misma proporción. Queda como opción; el pedido es Opus 5.5.

## Riesgos

* **Gasto.** Un bot puede vaciar el presupuesto. Lo frenan Turnstile, el límite por visitante y el tope del Durable Object; el límite de la Console es la última barrera. Cuando se acaba el tope, la caja vuelve al motor local.
* **Cifras inventadas.** Es el riesgo principal para un gemelo que presume de marcar cada dato. El control de cifras del punto 5 lo reduce, pero no revisa frases como «está mejor que ayer». Las instrucciones deben prohibir comparar o concluir lo que ninguna herramienta devolvió.
* **Inyección en la pregunta.** Alguien puede escribir «ignora tus reglas». Como el modelo solo puede leer nuestro JSON público y no escribe en ningún lado, lo peor que pasa es una respuesta rara, que igual pasa por el control de cifras.
* **Privacidad.** La pregunta sale del navegador hacia Cloudflare y Anthropic. El Worker no guarda preguntas ni IP; la caja debe avisarlo en una línea.
* **Licencias.** Algunos datos son CC BY‑NC (IDIGER). Pasarlos por una API de pago para contestar gratis en un sitio sin ánimo de lucro parece compatible, pero está **por verificar**.
* **Disponibilidad.** Si el Worker o la API fallan, la caja contesta con el motor local. Nunca debe quedar en blanco.
* **Datos viejos.** Las herramientas leen lo que publica el sitio, con su hora. Si la cosecha se atrasa, la respuesta lo dice con la misma marca de «hace X min».

## Qué falta para decidir

1. Sí o no a gastar hasta el tope de 20 USD al mes, o subirlo.
2. Opus 5.5 o un modelo más barato.
3. Turnstile en el sitio (pide un script de Cloudflare y un cambio de CSP).
