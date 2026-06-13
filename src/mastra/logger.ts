import { PinoLogger } from '@mastra/loggers';

/**
 * Logger compartido de la aplicación.
 *
 * Se exporta como una única instancia para que los módulos que no tienen acceso
 * al contexto de ejecución de Mastra (por ejemplo `db.ts`) puedan loguear a través
 * del mismo pipeline estructurado en lugar de usar `console.*`.
 */
export const logger = new PinoLogger({
  name: 'ROMA IA',
  level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
});
