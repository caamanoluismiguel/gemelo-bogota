/**
 * Worker del asistente «Pregúntale a Bogotá» del gemelo digital.
 *
 * Rutas:
 *   POST /preguntar  pregunta del visitante → respuesta en vivo (NDJSON)
 *   GET  /salud      estado simple, sin cifras de gasto
 *   POST /mcp        esqueleto documentado (501)
 *
 * Disparador programado (cada 10 min): lanza la cosecha de datos vivos en GitHub
 * Actions (src/cosecha.ts). Solo usa GITHUB_TOKEN_COSECHA, nada del asistente.
 *
 * Orden de las barreras en /preguntar, de la más barata a la más cara:
 *   origen → interruptor → clave configurada → tipo y tamaño → esquema →
 *   Turnstile → límite por visitante → reserva en el tope mensual → modelo.
 */
import { responderEnVivo } from "./asistente";
import { cosechar } from "./cosecha";
import { leerConfig, MODELO, VENTANA_LIMITE_MS } from "./config";
import { cotaReserva, usdAMicro } from "./costo";
import { cabecerasCors, origenPermitido, preflight } from "./cors";
import { leerEntrada } from "./entrada";
import { nombreVisitante } from "./limite";
import { manejarMcp } from "./mcp";
import { armarMensaje, PROMPT_SISTEMA } from "./prompt";
import { error, json } from "./respuestas";
import { verificarTurnstile } from "./turnstile";

export { ContadorGasto } from "./presupuesto";
export { LimiteVisitante } from "./limite";

async function preguntar(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const config = leerConfig(env);
  const origen = origenPermitido(request, config.origenes);
  const cors = cabecerasCors(origen);
  if (!origen) return error("origen", 403, cors);
  if (!config.activo) return error("apagado", 503, cors);
  if (!env.ANTHROPIC_API_KEY || !env.TURNSTILE_SECRET) {
    console.error(JSON.stringify({ evento: "falta_secreto" }));
    return error("noDisponible", 503, cors);
  }

  const lectura = await leerEntrada(request);
  if (!lectura.ok) {
    const estado = lectura.motivo === "tipo" ? 415 : lectura.motivo === "muyGrande" ? 413 : 400;
    return error(lectura.motivo, estado, cors);
  }
  const entrada = lectura.entrada;

  const ip = request.headers.get("cf-connecting-ip");
  if (!(await verificarTurnstile(entrada.turnstile, ip, env.TURNSTILE_SECRET, config.hostsTurnstile))) {
    return error("turnstile", 403, cors);
  }

  // Sin IP (no debería pasar detrás de Cloudflare) se agrupa en un solo cubo compartido.
  const visitante = env.LIMITE_VISITANTE.getByName(await nombreVisitante(ip ?? "sin-ip"));
  const limite = await visitante.permitir(config.limitePorHora, VENTANA_LIMITE_MS);
  if (!limite.ok) {
    const h = new Headers(cors);
    h.set("retry-after", String(limite.reintentarEnSeg));
    return error("limite", 429, h);
  }

  const contador = env.CONTADOR_GASTO.getByName("global");
  const bytesEntrada = new TextEncoder().encode(PROMPT_SISTEMA + armarMensaje(entrada)).byteLength;
  const microReservado = cotaReserva(bytesEntrada, config.maxTokens, MODELO);
  const idReserva = crypto.randomUUID();
  const reserva = await contador.reservar(idReserva, microReservado, usdAMicro(config.topeMensualUsd));
  if (!reserva.ok) return error("tope", 503, cors);

  return responderEnVivo({
    apiKey: env.ANTHROPIC_API_KEY,
    config,
    entrada,
    contador,
    idReserva,
    microReservado,
    ctx,
    cabeceras: cors,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const config = leerConfig(env);
    try {
      if (request.method === "OPTIONS") return preflight(request, config.origenes);

      switch (url.pathname) {
        case "/preguntar":
          if (request.method !== "POST") return error("metodo", 405, { allow: "POST, OPTIONS" });
          return await preguntar(request, env, ctx);
        case "/salud":
          if (request.method !== "GET") return error("metodo", 405, { allow: "GET" });
          return json({ ok: true, activo: config.activo }, 200, cabecerasCors(origenPermitido(request, config.origenes)));
        case "/mcp": {
          const origen = origenPermitido(request, config.origenes);
          return manejarMcp(cabecerasCors(origen));
        }
        default:
          return error("noEncontrado", 404);
      }
    } catch (e) {
      console.error(JSON.stringify({ evento: "fallo_inesperado", tipo: (e as Error)?.name ?? "desconocido" }));
      return error("error", 500);
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(cosechar(new Date(controller.scheduledTime), env.GITHUB_TOKEN_COSECHA));
  },
} satisfies ExportedHandler<Env>;
