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
function expandErrors(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack, ...(v as any) };
    } else {
      out[k] = v;
    }
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
