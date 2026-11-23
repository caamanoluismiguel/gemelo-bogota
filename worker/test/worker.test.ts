import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costoRespuesta, cotaReserva, PRECIO_CONSERVADOR } from "../src/costo";
import { claveIp } from "../src/limite";

const ORIGEN = "https://caamanoluismiguel.github.io";
const HOST = "caamanoluismiguel.github.io";
const TOKEN_BUENO = "token-bueno";

interface Simulacion {
  textos?: string[];
  stopReason?: string;
  uso?: Record<string, unknown>;
  falloHttp?: number;
  conRespaldo?: boolean;
}

let llamadasModelo = 0;
let llamadasTurnstile = 0;
let ultimoCuerpoModelo: Record<string, unknown> | null = null;
let simulacion: Simulacion = {};

function sse(eventos: Array<Record<string, unknown>>): string {
  return eventos.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function respuestaModelo(s: Simulacion): Response {
  if (s.falloHttp) {
    return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "falla" } }), {
      status: s.falloHttp,
      headers: { "content-type": "application/json" },
    });
  }
  const textos = s.textos ?? ["Hola ", "Bogotá."];
  const uso = s.uso ?? { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const eventos: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: {
        id: "msg_prueba",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...textos.map((t) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })),
    { type: "content_block_stop", index: 0 },
  ];
  if (s.conRespaldo) {
    eventos.push(
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Respaldo." } },
      { type: "content_block_stop", index: 2 },
    );
  }
  eventos.push(
    { type: "message_delta", delta: { stop_reason: s.stopReason ?? "end_turn", stop_sequence: null }, usage: uso },
    { type: "message_stop" },
  );
  return new Response(sse(eventos), { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  llamadasModelo = 0;
  llamadasTurnstile = 0;
  ultimoCuerpoModelo = null;
  simulacion = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    const url = new URL(req.url);
    if (url.hostname === "challenges.cloudflare.com") {
      llamadasTurnstile++;
      const form = await req.formData();
      const ok = form.get("response") === TOKEN_BUENO;
      return Response.json(ok ? { success: true, hostname: HOST, action: "preguntar" } : { success: false, "error-codes": ["invalid-input-response"] });
    }
    if (url.hostname === "api.anthropic.com") {
      llamadasModelo++;
      ultimoCuerpoModelo = (await req.json()) as Record<string, unknown>;
      return respuestaModelo(simulacion);
    }
    throw new Error(`fetch inesperado a ${url.hostname}`);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Cada prueba arranca con el contador y los límites vacíos.
  await reset();
});

let ipContador = 0;
function ipNueva(): string {
  ipContador++;
  return `203.0.113.${ipContador}`;
}

function preguntar(cuerpo: unknown, opciones: { ip?: string; origen?: string | null; tipo?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": opciones.tipo ?? "application/json",
    "cf-connecting-ip": opciones.ip ?? ipNueva(),
  };
  if (opciones.origen !== null) headers.origin = opciones.origen ?? ORIGEN;
  return exports.default.fetch("https://asistente.prueba/preguntar", {
    method: "POST",
    headers,
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

function lineas(texto: string): Array<Record<string, unknown>> {
  return texto
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const contador = () => env.CONTADOR_GASTO.getByName("global");

describe("rutas básicas", () => {
  it("GET /salud responde sin cifras de gasto", async () => {
    const r = await exports.default.fetch("https://asistente.prueba/salud");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, activo: true });
  });

  it("preflight solo para el origen del sitio", async () => {
    const bueno = await exports.default.fetch("https://asistente.prueba/preguntar", {
      method: "OPTIONS",
      headers: { origin: ORIGEN },
    });
    expect(bueno.status).toBe(204);
    expect(bueno.headers.get("access-control-allow-origin")).toBe(ORIGEN);
    const malo = await exports.default.fetch("https://asistente.prueba/preguntar", {
      method: "OPTIONS",
      headers: { origin: "https://otro.ejemplo" },
    });
    expect(malo.status).toBe(403);
    expect(malo.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/mcp es un esqueleto 501", async () => {
    const r = await exports.default.fetch("https://asistente.prueba/mcp", { method: "POST" });
    expect(r.status).toBe(501);
  });

  it("ruta desconocida da 404", async () => {
    const r = await exports.default.fetch("https://asistente.prueba/x");
    expect(r.status).toBe(404);
  });
});

describe("barreras de /preguntar", () => {
  it("rechaza otro origen sin llamar a nadie", async () => {
    const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { origen: "https://otro.ejemplo" });
    expect(r.status).toBe(403);
    expect(llamadasTurnstile + llamadasModelo).toBe(0);
  });

  it("rechaza sin cabecera Origin", async () => {
    const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { origen: null });
    expect(r.status).toBe(403);
  });

  it("Turnstile inválido: 403 y no llama al modelo", async () => {
    const r = await preguntar({ pregunta: "¿Cómo está el aire en Kennedy?", turnstile: "token-malo" });
    expect(r.status).toBe(403);
    const cuerpo = (await r.json()) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe("turnstile");
    expect(cuerpo.mensaje).toMatch(/persona/);
    expect(llamadasTurnstile).toBe(1);
    expect(llamadasModelo).toBe(0);
  });

  it("pregunta demasiado larga: 413 sin verificar ni llamar", async () => {
    const r = await preguntar({ pregunta: "a".repeat(801), turnstile: TOKEN_BUENO });
    expect(r.status).toBe(413);
    expect(llamadasTurnstile + llamadasModelo).toBe(0);
  });

  it("cuerpo de más de 8 KB: 413", async () => {
    const r = await preguntar(JSON.stringify({ pregunta: "hola", turnstile: TOKEN_BUENO, relleno: "x".repeat(9000) }));
    expect(r.status).toBe(413);
  });

  it("formato inválido o campos de más: 400", async () => {
    const r1 = await preguntar({ pregunta: "¿Qué tal?", turnstile: TOKEN_BUENO, extra: 1 });
    expect(r1.status).toBe(400);
    const r2 = await preguntar({ pregunta: "¿Qué tal?", turnstile: TOKEN_BUENO, contexto: { capa: "<script>" } });
    expect(r2.status).toBe(400);
    const r3 = await preguntar("{no es json");
    expect(r3.status).toBe(400);
  });

  it("tipo de contenido distinto de JSON: 415", async () => {
    const r = await preguntar("pregunta=hola", { tipo: "application/x-www-form-urlencoded" });
    expect(r.status).toBe(415);
  });

  it("límite por visitante: la sexta pregunta en una hora da 429", async () => {
    const ip = ipNueva();
    for (let i = 0; i < 5; i++) {
      const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { ip });
      expect(r.status).toBe(200);
      await r.text();
    }
    const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { ip });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(llamadasModelo).toBe(5);
  });
});

describe("tope mensual", () => {
  it("con el tope alcanzado responde 503 en español y no llama al modelo", async () => {
    const c = contador();
    const antes = await c.estado();
    const tope = 18_000_000;
    const relleno = Math.max(0, tope - antes.gastadoMicro - antes.reservadoMicro - 1000);
    expect((await c.reservar("relleno", relleno, tope)).ok).toBe(true);
    await c.liquidar("relleno", relleno);

    const r = await preguntar({ pregunta: "¿Cómo está el aire en Suba?", turnstile: TOKEN_BUENO });
    expect(r.status).toBe(503);
    const cuerpo = (await r.json()) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe("tope");
    expect(cuerpo.mensaje).toMatch(/presupuesto de este mes/);
    expect(llamadasModelo).toBe(0);
  });

  it("dos reservas simultáneas no pueden pasar juntas del tope", async () => {
    const c = env.CONTADOR_GASTO.getByName("prueba-carrera");
    const resultados = await Promise.all(Array.from({ length: 10 }, (_, i) => c.reservar(`r${i}`, 300_000, 1_000_000)));
    expect(resultados.filter((r) => r.ok).length).toBe(3);
  });

  it("una reserva sin liquidar vence y se cobra entera", async () => {
    const c = env.CONTADOR_GASTO.getByName("prueba-vence");
    const t0 = Date.UTC(2026, 10, 10, 12);
    await c.reservar("x", 500_000, 1_000_000, t0);
    const e = await c.estado(t0 + 11 * 60 * 1000);
    expect(e.gastadoMicro).toBe(500_000);
    expect(e.reservadoMicro).toBe(0);
  });

  it("el mes nuevo arranca en cero", async () => {
    const c = env.CONTADOR_GASTO.getByName("prueba-mes");
    const nov = Date.UTC(2026, 10, 30, 23);
    await c.reservar("a", 900_000, 1_000_000, nov);
    await c.liquidar("a", 900_000);
    expect((await c.reservar("b", 200_000, 1_000_000, nov + 60_000)).ok).toBe(false);
    expect((await c.reservar("c", 200_000, 1_000_000, Date.UTC(2026, 11, 1, 1))).ok).toBe(true);
  });
});

describe("respuesta simulada del modelo", () => {
  it("transmite NDJSON, arma bien la llamada y suma el costo real", async () => {
    const antes = await contador().estado();
    simulacion = {
      textos: ["En Kennedy ", "el PM2,5 fue medido."],
      uso: {
        input_tokens: 300,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1500,
      },
    };
    const r = await preguntar({
      pregunta: "¿Cómo estuvo el aire en Kennedy?",
      turnstile: TOKEN_BUENO,
      contexto: { localidad: "Kennedy", capa: "pm25", fecha: "2026-11-20" },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEN);
    const ls = lineas(await r.text());
    expect(ls.filter((l) => l.tipo === "texto").map((l) => l.texto).join("")).toBe("En Kennedy el PM2,5 fue medido.");
    expect(ls.at(-1)).toEqual({ tipo: "fin" });

    // La llamada usa el modelo, razonamiento adaptativo, esfuerzo, caché y respaldo.
    const cuerpo = ultimoCuerpoModelo as Record<string, any>;
    expect(cuerpo.model).toBe("claude-opus-5-5");
    expect(cuerpo.thinking).toEqual({ type: "adaptive" });
    expect(cuerpo.output_config).toEqual({ effort: "medium" });
    expect(cuerpo.max_tokens).toBe(3000);
    expect(cuerpo.fallbacks).toBeUndefined();
    expect(cuerpo.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(cuerpo.messages[0].content).toContain("<pregunta>");
    expect(cuerpo.messages[0].content).toContain("localidad: Kennedy");
    expect(cuerpo.temperature).toBeUndefined();

    // 300×4 + 1000×20 + 1500×0,2 = 21.500 microdólares.
    const despues = await contador().estado();
    expect(despues.gastadoMicro - antes.gastadoMicro).toBe(21_500);
    expect(despues.reservadoMicro).toBe(antes.reservadoMicro);
  });

  it("respaldo a mitad de camino: avisa el corte", async () => {
    simulacion = { conRespaldo: true };
    const r = await preguntar({ pregunta: "¿Qué es una isla de calor?", turnstile: TOKEN_BUENO });
    const ls = lineas(await r.text());
    expect(ls.some((l) => l.tipo === "corte")).toBe(true);
    expect(ls.at(-1)).toEqual({ tipo: "fin" });
  });

  it("rechazo del modelo: mensaje claro", async () => {
    simulacion = { stopReason: "refusal", textos: [] };
    const r = await preguntar({ pregunta: "Pregunta que el modelo no responde", turnstile: TOKEN_BUENO });
    const ls = lineas(await r.text());
    expect(ls.at(-1)?.tipo).toBe("rechazo");
  });

  it("error de la API antes de generar: mensaje genérico y no cobra", async () => {
    const antes = await contador().estado();
    simulacion = { falloHttp: 400 };
    const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO });
    expect(r.status).toBe(200);
    const texto = await r.text();
    const ls = lineas(texto);
    expect(ls.at(-1)?.tipo).toBe("error");
    expect(texto).not.toMatch(/api_error|anthropic|falla/i);
    const despues = await contador().estado();
    expect(despues.gastadoMicro).toBe(antes.gastadoMicro);
    expect(despues.reservadoMicro).toBe(antes.reservadoMicro);
  });
});

describe("cálculo de costo", () => {
  it("cobra cada intento a la tarifa de su modelo", () => {
    const micro = costoRespuesta(
      {
        input_tokens: 0,
        output_tokens: 0,
        iterations: [
          { model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { model: "claude-opus-5", input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ],
      },
      "claude-opus-5",
    );
    // 1000×4 + 100×20 + 1000×5 + 200×25
    expect(micro).toBe(4000 + 2000 + 5000 + 5000);
  });

  it("modelo desconocido se cobra a precio conservador", () => {
    const micro = costoRespuesta({ input_tokens: 1000, output_tokens: 0 }, "modelo-nuevo");
    expect(micro).toBe(1000 * PRECIO_CONSERVADOR.entrada);
  });

  it("escritura de caché con desglose 5m y 1h", () => {
    const micro = costoRespuesta(
      { cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } },
      "claude-opus-5-5",
    );
    expect(micro).toBe(1000 * 5 + 1000 * 8);
  });

  it("la reserva siempre cubre el peor caso típico", () => {
    const reserva = cotaReserva(6000, 3000, "claude-opus-5-5");
    const peor = costoRespuesta({ input_tokens: 6000, output_tokens: 3000 }, "claude-opus-5-5");
    expect(reserva).toBeGreaterThan(peor);
  });
});

describe("límite por visitante en IPv6", () => {
  it("agrupa por prefijo /64", () => {
    expect(claveIp("2001:db8:1:2:aaaa::1")).toBe("2001:0db8:0001:0002::/64");
    expect(claveIp("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:0db8:0001:0002::/64");
    expect(claveIp("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(claveIp("198.51.100.7")).toBe("198.51.100.7");
  });

  it("rotar direcciones dentro del mismo /64 no salta el límite", async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { ip: `2001:db8:5:6::${i}` });
      expect(r.status).toBe(200);
      await r.text();
    }
    const r = await preguntar({ pregunta: "¿Cómo está el aire?", turnstile: TOKEN_BUENO }, { ip: "2001:db8:5:6::99" });
    expect(r.status).toBe(429);
  });
});
