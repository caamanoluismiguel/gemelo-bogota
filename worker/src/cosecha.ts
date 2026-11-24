/**
 * Disparador programado de la cosecha de datos vivos (motor A).
 *
 * GitHub atrasa o se salta los cron de Actions (el 24 nov 2026, cielo corrió 2 de
 * unas 73 veces). Por eso este Worker, cada 10 minutos, pide a GitHub que corra los
 * workflows con `workflow_dispatch`. GitHub sigue armando y publicando, así el
 * linaje queda en los registros de Actions.
 *
 * Llave: env.GITHUB_TOKEN_COSECHA, un token fino con solo «Actions: Read and write»
 * sobre gemelo-bogota y gemelo-bogota-vivo. Se carga con `wrangler secret put`.
 * Sin llave, no hace nada y deja un registro claro. La llave nunca se registra.
 *
 * No toca nada del asistente: no lee sus secretos ni sus Durable Objects.
 */

export const DUENO = "caamanoluismiguel";

export interface Disparo {
  repo: string;
  workflow: string;
}

/** Qué lanzar en el turno que empieza en `cuando` (hora UTC del cron, cada 10 min). */
export function planDeDisparos(cuando: Date): Disparo[] {
  const plan: Disparo[] = [{ repo: "gemelo-bogota-vivo", workflow: "cosecha.yml" }];
  const h = cuando.getUTCHours();
  const m = cuando.getUTCMinutes();
  // Noches frías: 06:40, 08:40 y 11:40 en Bogotá. El script es idempotente.
  if ((h === 11 || h === 13 || h === 16) && m >= 40 && m < 50) {
    plan.push({ repo: "gemelo-bogota", workflow: "noches-frias.yml" });
  }
  return plan;
}

export interface Resultado extends Disparo {
  estado: number | "error_red";
  pista?: string;
}

const PISTAS: Record<number, string> = {
  401: "La llave no sirve o venció. Carga una nueva con wrangler secret put GITHUB_TOKEN_COSECHA.",
  403: "La llave no tiene permiso Actions: Read and write sobre este repo.",
  404: "No existe el repo o el workflow, o la llave no ve ese repo.",
  422: "El workflow no acepta workflow_dispatch o la rama no existe.",
};

export async function disparar(token: string, d: Disparo, motor: string, f: typeof fetch = fetch): Promise<Resultado> {
  const url = `https://api.github.com/repos/${DUENO}/${d.repo}/actions/workflows/${d.workflow}/dispatches`;
  try {
    const r = await f(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "bogotwin-cosecha",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { motor } }),
    });
    const res: Resultado = { ...d, estado: r.status };
    const pista = PISTAS[r.status];
    if (pista) res.pista = pista;
    return res;
  } catch {
    return { ...d, estado: "error_red" };
  }
}

export async function cosechar(cuando: Date, token: string | undefined, f: typeof fetch = fetch): Promise<Resultado[]> {
  const plan = planDeDisparos(cuando);
  if (!token) {
    console.warn(JSON.stringify({
      evento: "cosecha_sin_llave",
      mensaje: "Falta el secreto GITHUB_TOKEN_COSECHA; no se lanzó nada.",
      habria_lanzado: plan.map((d) => `${d.repo}/${d.workflow}`),
    }));
    return [];
  }
  const resultados = await Promise.all(plan.map((d) => disparar(token, d, "worker-cloudflare", f)));
  for (const r of resultados) {
    const ok = r.estado === 204 || r.estado === 200;
    const linea = JSON.stringify({ evento: ok ? "cosecha_lanzada" : "cosecha_fallo", repo: r.repo, workflow: r.workflow, estado: r.estado, pista: r.pista });
    if (ok) console.log(linea);
    else console.error(linea);
  }
  return resultados;
}
