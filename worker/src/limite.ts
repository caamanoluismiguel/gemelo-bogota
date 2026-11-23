/**
 * Límite de preguntas por visitante. Un Durable Object por visitante, nombrado con un
 * hash de su IP (la IP nunca se guarda). Solo guarda las horas de sus últimas preguntas
 * y una alarma borra todo al cerrar la ventana.
 */
import { DurableObject } from "cloudflare:workers";

export type ResultadoLimite = { ok: true } | { ok: false; reintentarEnSeg: number };

export class LimiteVisitante extends DurableObject<Env> {
  async permitir(limite: number, ventanaMs: number, ahora: number = Date.now()): Promise<ResultadoLimite> {
    const kv = this.ctx.storage.kv;
    const marcas = (kv.get<number[]>("marcas") ?? []).filter((t) => ahora - t < ventanaMs);
    if (marcas.length >= limite) {
      const masVieja = Math.min(...marcas);
      return { ok: false, reintentarEnSeg: Math.max(1, Math.ceil((masVieja + ventanaMs - ahora) / 1000)) };
    }
    marcas.push(ahora);
    kv.put("marcas", marcas);
    await this.ctx.storage.setAlarm(ahora + ventanaMs);
    return { ok: true };
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/**
 * Una IPv4 cuenta sola. Una IPv6 cuenta por su prefijo /64, porque un solo hogar o
 * servidor suele tener el /64 entero y podría rotar direcciones para saltarse el límite.
 */
export function claveIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = cola ? cola.split(":") : [];
  const grupos = ip.includes("::") ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${grupos
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":")}::/64`;
}

/** Nombre del objeto para un visitante: hash SHA-256 de su IP (o prefijo), nunca la IP. */
export async function nombreVisitante(ip: string): Promise<string> {
  const datos = new TextEncoder().encode(`gemelo-bogota:${claveIp(ip)}`);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return `v:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
