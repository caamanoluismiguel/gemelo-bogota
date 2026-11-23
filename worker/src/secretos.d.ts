// Secretos: se cargan con `wrangler secret put`, nunca en wrangler.toml.
// Opcionales a propósito: el código debe responder 503 si faltan.
interface SecretosAsistente {
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET?: string;
}
interface Env extends SecretosAsistente {}
declare namespace Cloudflare {
  interface Env extends SecretosAsistente {}
}
