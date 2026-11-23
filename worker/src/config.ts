/** Configuración leída de las variables públicas de wrangler.toml, con límites sanos. */

export const MODELO = "claude-opus-5-5";
/** Tamaño máximo del cuerpo de /preguntar, en bytes. */
export const MAX_BYTES_CUERPO = 8 * 1024;
/** Largo máximo de la pregunta, en caracteres. */
export const MAX_CARACTERES_PREGUNTA = 800;
/** Ventana del límite por visitante. */
export const VENTANA_LIMITE_MS = 60 * 60 * 1000;

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";
const ESFUERZOS: readonly Esfuerzo[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  origenes: string[];
  hostsTurnstile: string[];
  topeMensualUsd: number;
  limitePorHora: number;
  maxTokens: number;
  esfuerzo: Esfuerzo;
  activo: boolean;
}

function numero(valor: string | undefined, porDefecto: number, min: number, max: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

function lista(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function leerConfig(env: Env): Config {
  const esfuerzo = ESFUERZOS.includes(env.ESFUERZO as Esfuerzo) ? (env.ESFUERZO as Esfuerzo) : "medium";
  return {
    origenes: lista(env.ORIGENES_PERMITIDOS),
    hostsTurnstile: lista(env.HOSTS_TURNSTILE),
    // Nunca por encima de 20: es el límite duro del espacio de trabajo en la Console.
    topeMensualUsd: numero(env.TOPE_MENSUAL_USD, 18, 0, 19.5),
    limitePorHora: Math.floor(numero(env.LIMITE_POR_HORA, 5, 1, 60)),
    maxTokens: Math.floor(numero(env.MAX_TOKENS, 3000, 256, 8000)),
    esfuerzo,
    activo: env.ASISTENTE_ACTIVO === "si",
  };
}
