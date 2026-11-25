import { describe, expect, it, vi } from "vitest";
import { cosechar, disparar, planDeDisparos } from "../src/cosecha";

describe("cosecha programada", () => {
  it("lanza la cosecha viva en cada turno", () => {
    const plan = planDeDisparos(new Date("2026-11-25T03:20:00Z"));
    expect(plan).toEqual([{ repo: "gemelo-bogota-vivo", workflow: "cosecha.yml" }]);
  });

  it("suma noches frías solo a las 11:40, 13:40 y 16:40 UTC", () => {
    for (const h of ["11:40", "13:40", "16:40"]) {
      const plan = planDeDisparos(new Date(`2026-11-25T${h}:00Z`));
      expect(plan.map((d) => d.workflow)).toContain("noches-frias.yml");
    }
    for (const h of ["11:30", "11:50", "12:40", "16:30"]) {
      const plan = planDeDisparos(new Date(`2026-11-25T${h}:00Z`));
      expect(plan.map((d) => d.workflow)).not.toContain("noches-frias.yml");
    }
  });

  it("sin llave no llama a GitHub y deja un registro", async () => {
    const f = vi.fn();
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await cosechar(new Date("2026-11-25T11:40:00Z"), undefined, f as unknown as typeof fetch);
    expect(r).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(String(aviso.mock.calls[0]?.[0])).toContain("cosecha_sin_llave");
    aviso.mockRestore();
  });

  it("llama a workflow_dispatch con la llave y nunca la registra", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await cosechar(new Date("2026-11-25T11:40:00Z"), "llave-falsa", f as unknown as typeof fetch);
    expect(r.map((x) => x.estado)).toEqual([204, 204]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/caamanoluismiguel/gemelo-bogota-vivo/actions/workflows/cosecha.yml/dispatches");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer llave-falsa");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { motor: "worker-cloudflare" } });
    expect(log.mock.calls.flat().join(" ")).not.toContain("llave-falsa");
    log.mockRestore();
  });

  it("da una pista en español si GitHub responde 401", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    const r = await disparar("x", { repo: "gemelo-bogota-vivo", workflow: "cosecha.yml" }, "prueba", f as unknown as typeof fetch);
    expect(r.estado).toBe(401);
    expect(r.pista).toContain("GITHUB_TOKEN_COSECHA");
  });
});
