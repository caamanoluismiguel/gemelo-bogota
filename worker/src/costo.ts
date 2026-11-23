/**
 * Precios y cálculo de costo en microdólares (enteros, para no acumular errores de coma flotante).
 * Precios en USD por millón de tokens, tomados de la referencia de la API (noviembre de 2026).
 */

interface Precio {
  entrada: number;
  salida: number;
  lecturaCache: number;
  escrituraCache5m: number;
  escrituraCache1h: number;
}

const PRECIOS: Record<string, Precio> = {
  "claude-opus-5-5": { entrada: 4, salida: 20, lecturaCache: 0.2, escrituraCache5m: 5, escrituraCache1h: 8 },
  "claude-opus-5": { entrada: 5, salida: 25, lecturaCache: 0.5, escrituraCache5m: 6.25, escrituraCache1h: 10 },
  "claude-opus-4-8": { entrada: 5, salida: 25, lecturaCache: 0.5, escrituraCache5m: 6.25, escrituraCache1h: 10 },
};

/** Para un modelo desconocido (por ejemplo, el de respaldo) se cobra de más, nunca de menos. */
export const PRECIO_CONSERVADOR: Precio = {
  entrada: 10,
  salida: 50,
  lecturaCache: 1,
  escrituraCache5m: 12.5,
  escrituraCache1h: 20,
};

export function precioDe(modelo: string | null | undefined): Precio {
  if (!modelo) return PRECIO_CONSERVADOR;
  // El id puede traer sufijo de fecha; se busca la clave más larga que sea prefijo.
  const clave = Object.keys(PRECIOS)
    .filter((k) => modelo === k || modelo.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return clave ? (PRECIOS[clave] as Precio) : PRECIO_CONSERVADOR;
}

/** Forma mínima del uso que reporta la API (por intento o total). */
export interface UsoTokens {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  model?: string | null;
}

export interface UsoMensaje extends UsoTokens {
  iterations?: UsoTokens[] | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);

function microdolares(uso: UsoTokens, precio: Precio): number {
  let escritura: number;
  const cc = uso.cache_creation;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    escritura =
      n(cc.ephemeral_5m_input_tokens) * precio.escrituraCache5m + n(cc.ephemeral_1h_input_tokens) * precio.escrituraCache1h;
  } else {
    // Sin desglose se asume la tarifa más cara de escritura.
    escritura = n(uso.cache_creation_input_tokens) * precio.escrituraCache1h;
  }
  const total =
    n(uso.input_tokens) * precio.entrada +
    n(uso.output_tokens) * precio.salida +
    n(uso.cache_read_input_tokens) * precio.lecturaCache +
    escritura;
  // USD/MTok × tokens = microdólares. Se redondea hacia arriba.
  return Math.ceil(total);
}

/**
 * Costo real de una respuesta. Si hay `iterations`, cada intento (incluido el de respaldo)
 * se cobra a la tarifa de su propio modelo; son la verdad de facturación.
 */
export function costoRespuesta(uso: UsoMensaje, modeloServido: string | null | undefined): number {
  const iter = uso.iterations;
  if (Array.isArray(iter) && iter.length > 0) {
    return iter.reduce((s, it) => s + microdolares(it, precioDe(it.model ?? modeloServido)), 0);
  }
  return microdolares(uso, precioDe(modeloServido));
}

/**
 * Cota superior del costo antes de llamar al modelo. Los tokens de entrada se acotan por bytes
 * UTF-8 (un token nunca es menos de un byte) más un margen, a tarifa de escritura de caché.
 * Se suma un posible intento de respaldo a precio conservador.
 */
export function cotaReserva(bytesEntrada: number, maxTokens: number, modelo: string): number {
  const entrada = bytesEntrada + 2000;
  const p = precioDe(modelo);
  const principal = Math.ceil(entrada * p.escrituraCache1h + maxTokens * p.salida);
  const respaldo = Math.ceil(entrada * PRECIO_CONSERVADOR.escrituraCache1h + maxTokens * PRECIO_CONSERVADOR.salida);
  return principal + respaldo;
}

export const usdAMicro = (usd: number) => Math.round(usd * 1_000_000);
export const microAUsd = (micro: number) => micro / 1_000_000;
