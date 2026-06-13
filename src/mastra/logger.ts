import { PinoLogger } from '@mastra/loggers';

/**
 * Logger compartido de la aplicación.
 *
 * Se exporta como una única instancia para que los módulos que no tienen acceso
 * al contexto de ejecución de Mastra (por ejemplo `db.ts`) puedan loguear a través
 * del mismo pipeline estructurado en lugar de usar `console.*`.
 *
 * `formatters.log` expande los objetos `Error` (que Pino serializa a `{}` por
 * defecto) a `{ name, message, stack }`, para que los errores sean legibles en
 * los logs de producción (Vercel, etc.).
 */
function serializeError(err: Error, depth = 0): Record<string, unknown> {
  const e = err as any;
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    ...(e.code ? { code: e.code } : {}),
    ...(e.errno ? { errno: e.errno } : {}),
    stack: err.stack,
  };
  // Expande la cadena de `.cause` (clave para ver el error de red real bajo
  // "TypeError: fetch failed", que undici anida en cause).
  if (e.cause && depth < 5) {
    out.cause = e.cause instanceof Error ? serializeError(e.cause, depth + 1) : e.cause;
  }
  return out;
}

/**
 * Aplana toda la cadena `.cause` de un error a UN string de una línea, incluyendo
 * los campos de red de undici/Node (`code`, `errno`, `syscall`, `address`, `port`).
 *
 * Sirve para diagnóstico: al meter la causa raíz dentro del *mensaje* (y no en un
 * objeto anidado), ningún `console` con profundidad limitada puede truncarla a
 * `[Error]`. Devuelve algo como:
 *   "fetch failed  <-  Error: connect ETIMEDOUT 1.2.3.4:443 [code=ETIMEDOUT syscall=connect]"
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: any = err;
  let depth = 0;
  while (cur && depth < 8) {
    const meta = [
      cur.code && `code=${cur.code}`,
      cur.errno && `errno=${cur.errno}`,
      cur.syscall && `syscall=${cur.syscall}`,
      cur.address && `address=${cur.address}`,
      cur.port && `port=${cur.port}`,
    ]
      .filter(Boolean)
      .join(' ');
    const name = cur.name || (cur.constructor && cur.constructor.name) || 'Error';
    const msg = cur.message ?? String(cur);
    parts.push(`${name}: ${msg}${meta ? ` [${meta}]` : ''}`);
    cur = cur.cause;
    depth++;
  }
  return parts.join('  <-  ');
}

function expandErrors(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Error ? serializeError(v) : v;
  }
  return out;
}

export const logger = new PinoLogger({
  name: 'ROMA IA',
  level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  formatters: {
    log: expandErrors,
  },
});
