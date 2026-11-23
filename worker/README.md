# Worker del asistente «Pregúntale a Bogotá»

Servidor pequeño en Cloudflare Workers que guarda la clave de Anthropic y responde las preguntas del visor del gemelo digital con el modelo `claude-opus-5-5`. El sitio es estático; la clave nunca llega al navegador.

Licencia AGPL-3.0, como el resto del repositorio.

## Qué hace

| Ruta | Método | Qué devuelve |
|---|---|---|
| `/preguntar` | POST | La respuesta en vivo, una línea JSON por trozo (NDJSON) |
| `/salud` | GET | `{"ok":true,"activo":true}`, sin cifras de gasto |
| `/mcp` | POST | 501 por ahora. Es un esqueleto documentado en `src/mcp.ts` |

Cuerpo de `/preguntar`:

```json
{
  "pregunta": "¿Cómo estuvo el aire en Kennedy esta semana?",
  "turnstile": "<token del widget>",
  "contexto": { "localidad": "Kennedy", "capa": "pm25", "fecha": "2026-11-20", "escenario": "base" }
}
```

`contexto` es opcional. Cualquier campo de más se rechaza.

Líneas que devuelve, en orden:

```
{"tipo":"texto","texto":"En Kennedy "}
{"tipo":"texto","texto":"el PM2,5 …"}
{"tipo":"fin"}
```

Otras posibles: `{"tipo":"corte"}` (el modelo principal declinó y sigue el de respaldo; el visor debe borrar lo que llevaba), `{"tipo":"rechazo","mensaje":"…"}` y `{"tipo":"error","mensaje":"…"}`.

Si algo se rechaza antes de llamar al modelo, la respuesta es JSON con `error` y `mensaje` en español:

| Estado | `error` | Cuándo |
|---|---|---|
| 403 | `origen` | El pedido no viene del sitio |
| 415 | `tipo` | No es JSON |
| 413 | `muyGrande` | Más de 800 caracteres o más de 8 KB |
| 400 | `invalida` | No cumple el esquema |
| 403 | `turnstile` | Turnstile no aprobó |
| 429 | `limite` | Más de 5 preguntas por hora del mismo visitante (trae `Retry-After`) |
| 503 | `tope` | Se acabó el presupuesto del mes |
| 503 | `apagado` / `noDisponible` | Interruptor apagado o falta un secreto |

## Barreras, de la más barata a la más cara

1. Origen exacto en `ORIGENES_PERMITIDOS`.
2. Interruptor `ASISTENTE_ACTIVO`.
3. Tipo, tamaño (leído con tope, aunque el cliente mienta) y esquema con zod.
4. Turnstile del lado del servidor: además de `success`, se exige `action = "preguntar"` y que el `hostname` esté en `HOSTS_TURNSTILE`.
5. Límite por visitante: un Durable Object por visitante, nombrado con el hash de su IP (en IPv6, del prefijo /64). Guarda solo las horas de sus preguntas y una alarma lo borra al cerrar la hora.
6. Tope mensual: antes de llamar al modelo se **reserva** una cota superior del costo; si no cabe, se responde 503 sin llamar. Al terminar se **liquida** con el costo real.
7. Modelo.

## Presupuesto

* La Console de Anthropic tiene el límite duro de 20 USD al mes en el espacio de trabajo. El Worker corta antes, en `TOPE_MENSUAL_USD` (18 por defecto, nunca más de 19,5).
* El contador vive en un Durable Object único (`ContadorGasto`). Se eligió Durable Object y no KV porque KV es de consistencia eventual y no tiene lectura y escritura atómicas: dos preguntas al mismo tiempo podrían leer el mismo saldo y pasarse. El Durable Object atiende una llamada a la vez y cada método usa la API síncrona de almacenamiento, así que reservar es atómico. Hay una prueba que lanza 10 reservas a la vez y solo pasan las que caben.
* La reserva cuenta los bytes de la entrada como tokens (un token nunca es menos de un byte) a tarifa de escritura de caché, más `MAX_TOKENS` de salida, más un posible intento de respaldo a precio conservador. Para una pregunta típica son unos 0,43 USD reservados y unos 0,04 a 0,08 USD cobrados.
* El costo real sale de `usage`. Si la respuesta trae `usage.iterations`, cada intento se cobra a la tarifa de su propio modelo (así se cobra bien el respaldo). Un modelo que no está en la tabla se cobra a precio conservador.
* Si el visitante cierra a mitad de camino, o algo falla después de empezar, se cobra la reserva entera. Si la API rechaza antes de generar, no se cobra. Una reserva que nadie liquida en 10 minutos se cobra entera.
* El mes es el mes UTC.
* Precios usados (USD por millón de tokens) en `src/costo.ts`: `claude-opus-5-5` entrada 4, salida 20, lectura de caché 0,20, escritura 5 (5 min) u 8 (1 h). Revisarlos si cambian.

## Llamada al modelo

* `client.beta.messages.stream` del SDK oficial `@anthropic-ai/sdk` (versión fija en `package.json`).
* Razonamiento adaptativo (`thinking: {type: "adaptive"}`) y `output_config.effort` desde `ESFUERZO`.
* Instrucciones fijas en `src/prompt.ts`, en el bloque `system` con `cache_control`. No deben cambiar entre preguntas.
* **Sin respaldo a otro modelo** (decisión de LM, 23 nov 2026: solo `claude-opus-5-5`). Si el modelo declina, el visitante recibe el mensaje de rechazo. Para encender el respaldo del servidor habría que agregar `betas: ["server-side-fallback-2026-07-01"]` y `fallbacks: "default"` en `src/asistente.ts`.
* Sin `temperature` ni respuesta precargada (el modelo no los acepta).

## Privacidad

* No se guarda ninguna pregunta, respuesta ni IP. El contador guarda solo montos y conteos por mes y por día; el límite por visitante guarda solo horas y se borra solo.
* Los registros solo tienen eventos como `fallo_modelo` con el tipo de error y el estado HTTP. Los registros automáticos de invocación están apagados en `wrangler.toml` porque traerían datos del pedido.

## Probar en local

```sh
cd worker
npm ci
npm run typecheck
npm test
```

Las pruebas corren dentro de workerd con `@cloudflare/vitest-plugin` y simulan Turnstile y la API de Anthropic. No llaman a nada real.

Para `wrangler dev`:

```sh
cp .dev.vars.example .dev.vars   # trae la clave de prueba pública de Turnstile
npm run dev
```

Sin `ANTHROPIC_API_KEY` en `.dev.vars`, `/preguntar` responde 503. Así debe ser mientras no haya clave.

## Desplegar (pasos pendientes, en orden)

1. **Turnstile**: en el panel de Cloudflare, crear un widget para el dominio del visor. Copiar la clave del sitio (pública, va en el HTML) y la clave secreta.
2. **Clave de Anthropic**: crear en la Console una clave **dentro del espacio de trabajo que ya tiene el límite de 20 USD**, solo para este Worker.
3. **Configurar** en `wrangler.toml` el dominio real en `ORIGENES_PERMITIDOS` y `HOSTS_TURNSTILE`. Correr `npm run cf-typegen` si cambian las variables.
4. **Secretos**, nunca en archivos:
   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put TURNSTILE_SECRET
   ```
5. **Desplegar**: `npx wrangler deploy`. La primera vez crea los dos Durable Objects (migración `v1`).
6. **Visor**: poner el widget de Turnstile con `data-action="preguntar"`, mandar el token en `turnstile` y leer el NDJSON línea por línea. Pedir un token nuevo para cada pregunta (cada token sirve una sola vez).
7. **Comprobar** con una pregunta real y mirar en la Console que el gasto coincida con el contador.

Para apagar el asistente sin desplegar código: cambiar `ASISTENTE_ACTIVO` en el panel de Cloudflare.

## Archivos

| Archivo | Qué tiene |
|---|---|
| `src/index.ts` | Rutas y orden de las barreras |
| `src/asistente.ts` | Llamada al modelo en vivo, NDJSON y liquidación |
| `src/presupuesto.ts` | Durable Object del tope mensual |
| `src/limite.ts` | Durable Object del límite por visitante |
| `src/costo.ts` | Precios, costo real y cota de reserva |
| `src/turnstile.ts` | Verificación de Turnstile |
| `src/entrada.ts` | Lectura con tope y esquema zod |
| `src/prompt.ts` | Instrucciones fijas del asistente |
| `src/mcp.ts` | Esqueleto del servidor MCP |
| `test/worker.test.ts` | Pruebas |
