/**
 * Configuración compartida de conexión a LibSQL/Turso (storage + vector store).
 *
 * En entornos serverless (Vercel), el esquema `libsql://` hace que el cliente intente
 * una conexión WebSocket (hrana) que suele fallar con "fetch failed". Forzamos el
 * transporte HTTP puro convirtiendo `libsql://` → `https://`, que es lo recomendado
 * para serverless y equivalente en local. El esquema `file:` (dev local) no se toca.
 */
export function libsqlUrl(): string {
  const raw = process.env.LIBSQL_URL ?? 'file:./mastra.db';
  return raw.startsWith('libsql://') ? raw.replace(/^libsql:\/\//, 'https://') : raw;
}

export function libsqlAuthToken(): string | undefined {
  return process.env.LIBSQL_AUTH_TOKEN || undefined;
}
