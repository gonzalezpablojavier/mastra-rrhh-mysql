import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';
import { logger } from '../logger';
import { getUserContext, esRolPrivilegiado } from '../user-context';

const BLOCKED_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|MERGE|CALL)\b/i,
  /\b(ATTACH|DETACH)\b/i,
  /\b(PRAGMA)\b/i,
  /\b(INTO\s+(OUTFILE|DUMPFILE))\b/i,
  /;.*\S/, // bloquea múltiples statements en una sola consulta
  /\/\*|\*\/|--/, // bloquea comentarios SQL (vector típico de evasión)
];

/** Tope máximo de filas devueltas por consulta para evitar respuestas gigantes. */
const MAX_ROWS = 500;

/** Tablas que contienen la columna `colaboradorID` y, por tanto, requieren scoping personal. */
const TABLAS_CON_COLABORADOR = [
  'usuarios_registrados',
  'presentismo',
  'estado_asistencia',
  'vacaciones',
  'mood',
  'idea_box',
  'historico_dias_disponibles',
  'colaborador',
];

/**
 * Aplica el aislamiento multi-tenant de forma DETERMINISTA en código (no se confía
 * en que el modelo lo haga). Lanza un error si la consulta viola el aislamiento.
 *
 * NOTA: Esta es una capa de defensa-en-profundidad basada en inspección textual de
 * la consulta. La garantía más robusta sería usar credenciales/vistas de MySQL por
 * empresa (un usuario de BD por tenant). Mientras tanto, este guard rechaza de forma
 * conservadora cualquier consulta que referencie un `empresaId`/`colaboradorID`
 * distinto al del contexto autenticado, o que no acote por empresa.
 */
function enforceTenantIsolation(query: string, empresaId: string, colaboradorID: string, rol: string): void {
  const lower = query.toLowerCase();

  // 1. Toda referencia literal a empresaId debe coincidir con la del contexto.
  const empresaMatches = [...query.matchAll(/empresaid\s*=\s*'?([\w-]+)'?/gi)];
  for (const m of empresaMatches) {
    if (String(m[1]) !== String(empresaId)) {
      throw new Error('Acceso denegado: la consulta intenta acceder a datos de otra empresa.');
    }
  }
  // 2. La consulta debe acotar por empresa (al menos una referencia a empresaId).
  if (empresaMatches.length === 0) {
    throw new Error('Acceso denegado: la consulta debe filtrar por empresaId para garantizar el aislamiento entre empresas.');
  }

  // 3. Rol no privilegiado (colaborador): solo puede ver su propia información.
  if (!esRolPrivilegiado(rol)) {
    // Ninguna referencia a colaboradorID puede apuntar a otro colaborador.
    const colabMatches = [...query.matchAll(/colaboradorid\s*=\s*'?([\w-]+)'?/gi)];
    for (const m of colabMatches) {
      if (String(m[1]) !== String(colaboradorID)) {
        throw new Error('Acceso denegado: no tienes permisos para consultar información de otros colaboradores.');
      }
    }
    // Si toca tablas con datos personales, debe acotar por su propio colaboradorID.
    const tocaTablasPersonales = TABLAS_CON_COLABORADOR.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(lower));
    const acotaPorColaborador = colabMatches.some((m) => String(m[1]) === String(colaboradorID));
    if (tocaTablasPersonales && !acotaPorColaborador) {
      throw new Error('Acceso denegado: solo puedes consultar tu propia información personal.');
    }
  }
}

/** Asegura que la consulta tenga un LIMIT acotado. */
function ensureLimit(query: string): string {
  if (/\blimit\b/i.test(query)) return query;
  return `${query} LIMIT ${MAX_ROWS}`;
}

export const executeSql = createTool({
  id: 'execute-sql',
  description: 'Ejecuta una consulta SQL SELECT de solo lectura contra la base de datos MySQL y retorna los registros.',
  inputSchema: z.object({
    query: z.string().describe('La consulta SQL SELECT a ejecutar en MySQL'),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe('Filas devueltas por la consulta'),
    rowCount: z.number().describe('Cantidad de filas devueltas'),
  }),
  execute: async ({ query }, { requestContext }) => {
    const trimmed = query.trim().replace(/;$/, '');

    if (!/^\s*SELECT\b/i.test(trimmed)) {
      throw new Error('La consulta SQL debe comenzar con la palabra clave SELECT.');
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new Error('Solo se permiten consultas de tipo SELECT de solo lectura.');
      }
    }

    // Aislamiento multi-tenant determinista a partir del contexto autenticado.
    const user = getUserContext(requestContext);
    if (!user) {
      throw new Error('Acceso denegado: no hay un contexto de usuario autenticado.');
    }
    enforceTenantIsolation(trimmed, user.empresaId, user.colaboradorID, user.rol);

    const finalQuery = ensureLimit(trimmed);

    logger.debug('[execute-sql] Ejecutando consulta', { empresaId: user.empresaId, colaboradorID: user.colaboradorID });

    const rows = await executeQuery<Record<string, unknown>[]>({ query: finalQuery });
    const capped = rows.slice(0, MAX_ROWS);

    return {
      rows: capped,
      rowCount: capped.length,
    };
  },
});
