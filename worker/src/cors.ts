/** CORS solo para los orígenes del sitio (ORIGENES_PERMITIDOS). */

export function origenPermitido(request: Request, origenes: string[]): string | null {
  const origen = request.headers.get("origin");
  if (!origen) return null;
  // Comparación exacta: nada de comodines ni sufijos.
  return origenes.includes(origen) ? origen : null;
}

export function cabecerasCors(origen: string | null): Headers {
  const h = new Headers({ vary: "Origin" });
  if (origen) {
    h.set("access-control-allow-origin", origen);
    h.set("access-control-allow-methods", "POST, GET, OPTIONS");
    h.set("access-control-allow-headers", "content-type");
    h.set("access-control-max-age", "600");
  }
  return h;
}

export function preflight(request: Request, origenes: string[]): Response {
  const origen = origenPermitido(request, origenes);
  if (!origen) return new Response(null, { status: 403, headers: { vary: "Origin" } });
  return new Response(null, { status: 204, headers: cabecerasCors(origen) });
}
