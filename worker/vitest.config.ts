import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // Valores falsos solo para pruebas. Nunca una clave real.
        bindings: {
          ANTHROPIC_API_KEY: "clave-falsa-de-prueba",
          TURNSTILE_SECRET: "secreto-falso-de-prueba",
        },
      },
    }),
  ],
});
