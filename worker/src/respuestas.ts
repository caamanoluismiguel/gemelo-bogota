/** Respuestas JSON con mensajes en español y sin detalles internos. */

export const MENSAJES = {
  noEncontrado: "Esta ruta no existe.",
  metodo: "Método no permitido.",
  origen: "Este sitio no puede usar el asistente.",
  tipo: "Envía la pregunta como JSON.",
  muyGrande: "La pregunta es demasiado larga.",
  invalida: "La pregunta no tiene el formato esperado.",
  turnstile: "No pudimos comprobar que eres una persona. Recarga la página e inténtalo de nuevo.",
  limite: "Ya hiciste varias preguntas en la última hora. Vuelve a intentarlo más tarde.",
  tope: "El asistente ya usó todo su presupuesto de este mes. Vuelve el próximo mes; el mapa y los datos siguen abiertos.",
  apagado: "El asistente está apagado por ahora. El mapa y los datos siguen abiertos.",
  noDisponible: "El asistente no está disponible en este momento.",
  error: "Algo falló al responder. Inténtalo de nuevo en unos minutos.",
  rechazo: "El asistente no puede responder esa pregunta. Prueba con otra sobre los datos de Bogotá.",
} as const;

export type ClaveMensaje = keyof typeof MENSAJES;

export function json(cuerpo: unknown, estado: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(cuerpo), { status: estado, headers });
}

export function error(clave: ClaveMensaje, estado: number, extra: HeadersInit = {}): Response {
  return json({ error: clave, mensaje: MENSAJES[clave] }, estado, extra);
}
