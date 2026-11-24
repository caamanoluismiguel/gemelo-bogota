/**
 * /mcp: esqueleto documentado. Todavía NO implementa el protocolo.
 *
 * Plan (panel del gemelo, §3.4): servidor MCP de solo lectura, sin modelo y sin costo,
 * sobre el transporte «Streamable HTTP» (un único endpoint POST con JSON-RPC 2.0).
 * Herramientas previstas, todas sobre los datos públicos ya publicados por el sitio:
 *   - resumen_localidad(localidad)        → cifras clave con id citable y fecha
 *   - serie_estacion(estacion, variable, desde, hasta)
 *   - capa_en_punto(capa, lat, lon)       → valor de una capa en un punto
 *   - escenario(id)                       → supuestos y resultados de un escenario
 *   - fuentes(id)                         → procedencia y licencia de un dato
 * Cada resultado lleva su marca: medido, de fuente, inferido, estimado o supuesto.
 * Mismas reglas que /preguntar: CORS restringido, límite por visitante, nada de datos
 * personales en registros. Estas mismas herramientas alimentarán el bloque <datos>
 * del asistente.
 */
import { json } from "./respuestas";

export function manejarMcp(cors: Headers): Response {
  return json(
    {
      error: "no_implementado",
      mensaje: "El servidor MCP del gemelo todavía no está disponible.",
      herramientas_previstas: ["resumen_localidad", "serie_estacion", "capa_en_punto", "escenario", "fuentes"],
    },
    501,
    cors,
  );
}
