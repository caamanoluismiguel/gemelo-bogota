/**
 * Llamada al modelo con streaming y salida NDJSON hacia el navegador.
 *
 * Cada línea es un objeto JSON:
 *   {"tipo":"texto","texto":"..."}   trozo de respuesta
 *   {"tipo":"corte"}                 el modelo principal declinó y responde el de respaldo:
 *                                    el visor debe borrar el texto anterior
 *   {"tipo":"rechazo","mensaje":"..."} el modelo no responde esa pregunta
 *   {"tipo":"error","mensaje":"..."} falló a mitad de camino
 *   {"tipo":"fin"}                   terminó bien
 *
 * Al terminar (bien, mal o porque el visitante cerró) se liquida el costo real en el
 * contador. Nunca se registra la pregunta ni la respuesta.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config";
import { MODELO } from "./config";
import { costoRespuesta, type UsoMensaje } from "./costo";
import type { Entrada } from "./entrada";
import type { ContadorGasto } from "./presupuesto";
import { armarMensaje, PROMPT_SISTEMA } from "./prompt";
import { MENSAJES } from "./respuestas";

/** Respaldo del lado del servidor si claude-opus-5-5 declina por política. */

type Linea =
  | { tipo: "texto"; texto: string }
  | { tipo: "corte" }
  | { tipo: "rechazo"; mensaje: string }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin" };

interface Parametros {
  apiKey: string;
  config: Config;
  entrada: Entrada;
  contador: DurableObjectStub<ContadorGasto>;
  idReserva: string;
  microReservado: number;
  ctx: ExecutionContext;
  cabeceras: Headers;
}

export function responderEnVivo(p: Parametros): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const cod = new TextEncoder();
  let visitanteSeFue = false;

  const enviar = async (l: Linea) => {
    if (visitanteSeFue) return;
    try {
      await escritor.write(cod.encode(`${JSON.stringify(l)}\n`));
    } catch {
      visitanteSeFue = true;
    }
  };

  const trabajo = async () => {
    // Cliente nuevo por pedido: la clave nunca sale de esta función.
    const cliente = new Anthropic({ apiKey: p.apiKey, maxRetries: 1, timeout: 90_000 });
    // Por defecto se cobra lo reservado entero; solo se baja si sabemos el costo real.
    let microCosto: number = p.microReservado;
    let recibioAlgo = false;
    const stream = cliente.beta.messages.stream({
      model: MODELO,
      max_tokens: p.config.maxTokens,
      system: [{ type: "text", text: PROMPT_SISTEMA, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: p.config.esfuerzo },
      messages: [{ role: "user", content: armarMensaje(p.entrada) }],
    });
    try {
      for await (const ev of stream) {
        recibioAlgo = true;
        if (visitanteSeFue) {
          stream.abort();
          break;
        }
        if (ev.type === "content_block_start" && ev.content_block.type === "fallback") {
          await enviar({ tipo: "corte" });
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          await enviar({ tipo: "texto", texto: ev.delta.text });
        }
      }
      if (!visitanteSeFue) {
        const final = await stream.finalMessage();
        microCosto = costoRespuesta(final.usage as UsoMensaje, final.model);
        if (final.stop_reason === "refusal") {
          await enviar({ tipo: "rechazo", mensaje: MENSAJES.rechazo });
        } else {
          await enviar({ tipo: "fin" });
        }
      }
    } catch (e) {
      // Si la API rechazó antes de generar nada (4xx/5xx sin eventos), no hubo costo.
      if (!recibioAlgo && e instanceof Anthropic.APIError && typeof e.status === "number") {
        microCosto = 0;
      }
      // Solo el tipo y el estado, nunca el contenido de la pregunta.
      const estado = e instanceof Anthropic.APIError ? e.status : undefined;
      console.error(JSON.stringify({ evento: "fallo_modelo", tipo: (e as Error)?.name ?? "desconocido", estado }));
      await enviar({ tipo: "error", mensaje: MENSAJES.error });
    } finally {
      try {
        if (microCosto === 0) await p.contador.soltar(p.idReserva);
        else await p.contador.liquidar(p.idReserva, microCosto);
      } catch {
        // Si falla, la reserva vence en 10 minutos y se cobra entera: seguro por defecto.
        console.error(JSON.stringify({ evento: "fallo_liquidar" }));
      }
      try {
        await escritor.close();
      } catch {
        /* el visitante ya cerró */
      }
    }
  };

  p.ctx.waitUntil(trabajo());

  const h = new Headers(p.cabeceras);
  h.set("content-type", "application/x-ndjson; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  return new Response(readable, { status: 200, headers: h });
}
