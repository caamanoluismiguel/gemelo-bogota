/** Lectura y validación de la entrada de /preguntar. */
import { z } from "zod";
import { MAX_BYTES_CUERPO, MAX_CARACTERES_PREGUNTA } from "./config";

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

export const esquemaEntrada = z
  .object({
    pregunta: z
      .string()
      // Quita caracteres de control salvo salto de línea y tabulación.
      .transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim())
      .pipe(z.string().min(3).max(MAX_CARACTERES_PREGUNTA)),
    turnstile: z.string().min(1).max(2048),
    contexto: z
      .object({
        localidad: z
          .string()
          .regex(/^[\p{L} .'-]{1,60}$/u)
          .optional(),
        capa: slug.optional(),
        fecha: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        escenario: slug.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Entrada = z.infer<typeof esquemaEntrada>;

export type ResultadoLectura =
  | { ok: true; entrada: Entrada }
  | { ok: false; motivo: "tipo" | "muyGrande" | "invalida" };

/** Lee el cuerpo con tope de bytes aunque el cliente mienta en content-length. */
async function leerConTope(request: Request, tope: number): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > tope) return null;
  if (!request.body) return "";
  const lector = request.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) {
    todo.set(t, pos);
    pos += t.byteLength;
  }
  return new TextDecoder("utf-8").decode(todo);
}

export async function leerEntrada(request: Request): Promise<ResultadoLectura> {
  const tipo = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(tipo)) return { ok: false, motivo: "tipo" };
  const texto = await leerConTope(request, MAX_BYTES_CUERPO);
  if (texto === null) return { ok: false, motivo: "muyGrande" };
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: "invalida" };
  }
  // Pregunta demasiado larga se reporta aparte para que el visor muestre el mensaje correcto.
  if (
    typeof datos === "object" &&
    datos !== null &&
    typeof (datos as { pregunta?: unknown }).pregunta === "string" &&
    ((datos as { pregunta: string }).pregunta.trim().length > MAX_CARACTERES_PREGUNTA)
  ) {
    return { ok: false, motivo: "muyGrande" };
  }
  const r = esquemaEntrada.safeParse(datos);
  if (!r.success) return { ok: false, motivo: "invalida" };
  return { ok: true, entrada: r.data };
}
