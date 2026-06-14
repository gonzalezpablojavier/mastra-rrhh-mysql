/**
 * Configuración compartida de conexión a LibSQL/Turso (storage + vector store).
 *
 * En entornos serverless (Vercel), el esquema `libsql://` hace que el cliente intente
 * una conexión WebSocket (hrana) que suele fallar con "fetch failed". Forzamos el
 * transporte HTTP puro convirtiendo `libsql://` → `https://`, que es lo recomendado
 * para serverless y equivalente en local. El esquema `file:` (dev local) no se toca.
 */
export function libsqlUrlRaw(): string {
  return process.env.LIBSQL_URL ?? 'file:./mastra.db';
}

export function libsqlUrl(): string {
  const raw = libsqlUrlRaw();
  return raw.startsWith('libsql://') ? raw.replace(/^libsql:\/\//, 'https://') : raw;
}

export function libsqlAuthToken(): string | undefined {
  return process.env.LIBSQL_AUTH_TOKEN || undefined;
}

/** True en Vercel u otros runtimes serverless sin filesystem persistente. */
export function isServerlessDeploy(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export interface LibsqlEnvValidation {
  ok: boolean;
  issues: string[];
  /** Resumen seguro para diagnóstico (sin secretos). */
  summary: {
    serverless: boolean;
    libsqlScheme: string;
    tokenPresente: boolean;
    urlResuelta: string;
  };
}

/**
 * Valida que LIBSQL_* sea usable en el entorno actual.
 * En serverless, `file:` o token ausente en URL remota son errores de configuración.
 */
export function validateLibsqlEnv(): LibsqlEnvValidation {
  const raw = libsqlUrlRaw();
  const resolved = libsqlUrl();
  const token = libsqlAuthToken();
  const issues: string[] = [];

  if (isServerlessDeploy()) {
    if (raw.startsWith('file:')) {
      issues.push(
        'LIBSQL_URL=file:... no funciona en Vercel/serverless. Configurá Turso: LIBSQL_URL=libsql://tu-db.turso.io y LIBSQL_AUTH_TOKEN.',
      );
    } else if (!raw.startsWith('libsql://') && !raw.startsWith('https://')) {
      issues.push(`LIBSQL_URL tiene esquema inválido para serverless (${raw.split(':')[0]}:).`);
    }
    if ((raw.startsWith('libsql://') || raw.startsWith('https://')) && !token) {
      issues.push('LIBSQL_AUTH_TOKEN está vacío pero LIBSQL_URL es remoto. Turso exige token.');
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      serverless: isServerlessDeploy(),
      libsqlScheme: raw.split(':')[0] + ':',
      tokenPresente: Boolean(token),
      // Host resuelto sin credenciales (https://xxx.turso.io).
      urlResuelta: resolved.replace(/^https:\/\//, '').split('/')[0],
    },
  };
}
