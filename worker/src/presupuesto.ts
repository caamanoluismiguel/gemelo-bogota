/**
 * Contador de gasto mensual. Un solo Durable Object global ("global").
 *
 * Por qué Durable Object y no KV: KV es de consistencia eventual y no tiene
 * lectura-modificación-escritura atómica; dos preguntas simultáneas podrían leer el
 * mismo saldo y pasarse del tope. Un Durable Object procesa una llamada a la vez y la
 * API síncrona de almacenamiento (ctx.storage.kv) hace que cada método sea atómico.
 *
 * Flujo: reservar (cota superior) antes de llamar al modelo, liquidar con el costo
 * real al terminar. Una reserva que nadie liquida en 10 minutos se cobra entera.
 * Solo guarda montos y conteos por mes y por día. Nada de preguntas ni de IPs.
 */
import { DurableObject } from "cloudflare:workers";

const VENCE_RESERVA_MS = 10 * 60 * 1000;

interface Reserva {
  micro: number;
  t: number;
  mes: string;
}

interface Acumulado {
  micro: number;
  preguntas: number;
}

export type ResultadoReserva = { ok: true } | { ok: false; motivo: "tope" };

export interface EstadoGasto {
  mes: string;
  gastadoMicro: number;
  reservadoMicro: number;
  preguntas: number;
}

export const mesUtc = (t: number) => new Date(t).toISOString().slice(0, 7);
const diaUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export class ContadorGasto extends DurableObject<Env> {
  private sumar(clave: string, micro: number, preguntas: number): void {
    const kv = this.ctx.storage.kv;
    const a = kv.get<Acumulado>(clave) ?? { micro: 0, preguntas: 0 };
    kv.put<Acumulado>(clave, { micro: a.micro + micro, preguntas: a.preguntas + preguntas });
  }

  /** Cobra entero lo reservado hace más de 10 minutos y devuelve lo reservado vigente. */
  private vencerReservas(ahora: number): number {
    const kv = this.ctx.storage.kv;
    let vigente = 0;
    for (const [clave, r] of [...kv.list<Reserva>({ prefix: "res:" })]) {
      if (ahora - r.t > VENCE_RESERVA_MS) {
        this.sumar(`mes:${r.mes}`, r.micro, 1);
        this.sumar(`dia:${diaUtc(r.t)}`, r.micro, 1);
        kv.delete(clave);
      } else {
        vigente += r.micro;
      }
    }
    return vigente;
  }

  reservar(id: string, micro: number, topeMicro: number, ahora: number = Date.now()): ResultadoReserva {
    const kv = this.ctx.storage.kv;
    const mes = mesUtc(ahora);
    const reservado = this.vencerReservas(ahora);
    const gastado = kv.get<Acumulado>(`mes:${mes}`)?.micro ?? 0;
    if (gastado + reservado + micro > topeMicro) return { ok: false, motivo: "tope" };
    kv.put<Reserva>(`res:${id}`, { micro, t: ahora, mes });
    return { ok: true };
  }

  /** Cambia la reserva por el costo real. Nunca cobra más que lo reservado. */
  liquidar(id: string, microReal: number): void {
    const kv = this.ctx.storage.kv;
    const r = kv.get<Reserva>(`res:${id}`);
    if (!r) return; // ya vencida y cobrada entera
    const micro = Math.max(0, Math.min(Math.ceil(microReal), r.micro));
    this.sumar(`mes:${r.mes}`, micro, 1);
    this.sumar(`dia:${diaUtc(r.t)}`, micro, 1);
    kv.delete(`res:${id}`);
  }

  /** Suelta una reserva sin cobrar (la API rechazó la llamada antes de generar). */
  soltar(id: string): void {
    this.ctx.storage.kv.delete(`res:${id}`);
  }

  estado(ahora: number = Date.now()): EstadoGasto {
    const mes = mesUtc(ahora);
    const reservado = this.vencerReservas(ahora);
    const a = this.ctx.storage.kv.get<Acumulado>(`mes:${mes}`) ?? { micro: 0, preguntas: 0 };
    return { mes, gastadoMicro: a.micro, reservadoMicro: reservado, preguntas: a.preguntas };
  }
}
