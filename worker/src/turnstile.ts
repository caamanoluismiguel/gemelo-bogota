/** Verificación de Cloudflare Turnstile del lado del servidor. */

const URL_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const ACCION_TURNSTILE = "preguntar";

interface RespuestaSiteverify {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

export async function verificarTurnstile(
  token: string,
  ip: string | null,
  secreto: string,
  hostsPermitidos: string[],
): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secreto);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  form.append("idempotency_key", crypto.randomUUID());
  let datos: RespuestaSiteverify;
  try {
    const r = await fetch(URL_SITEVERIFY, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return false;
    datos = (await r.json()) as RespuestaSiteverify;
  } catch {
    return false;
  }
  if (datos.success !== true) return false;
  // El token debe venir de nuestro widget y de nuestro sitio, no de otro que use la misma clave.
  if (datos.action !== ACCION_TURNSTILE) return false;
  if (!datos.hostname || !hostsPermitidos.includes(datos.hostname)) return false;
  return true;
}
