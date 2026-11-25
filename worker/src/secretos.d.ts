// Secretos: se cargan con `wrangler secret put`, nunca en wrangler.toml.
// Opcionales a propósito: el código debe responder 503 si faltan.
interface SecretosAsistente {
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  // Token fino de GitHub, solo «Actions: Read and write» sobre los dos repos (src/cosecha.ts).
  GITHUB_TOKEN_COSECHA?: string;
}
interface Env extends SecretosAsistente {}
declare namespace Cloudflare {
  interface Env extends SecretosAsistente {}
}
