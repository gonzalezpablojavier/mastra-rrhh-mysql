import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';
import { logger } from '../logger';
import { getUserContext, esRolPrivilegiado } from '../user-context';
import { getScope } from '../catalog';

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

/** Extrae los nombres de tabla referenciados en la consulta (FROM / JOIN). */
function tablasReferenciadas(query: string): string[] {
  const tables = new Set<string>();
  const re = /\b(?:from|join)\s+`?([a-z_][\w]*)`?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    tables.add(m[1].toLowerCase());
  }
  return [...tables];
}

/**
 * Aplica el aislamiento multi-tenant de forma DETERMINISTA en código (no se confía
 * en que el modelo lo haga), según el SCOPE de cada tabla declarado en el catálogo:
 *  - 'global'   → dato público (mundial, feriados…): no exige empresaId.
 *  - 'empresa'  → exige filtrar por empresaId.
 *  - 'personal' → además, los roles no privilegiados solo ven su colaboradorID.
 *
 * NOTA: capa de defensa-en-profundidad por inspección textual. La garantía más fuerte
 * sería usar credenciales/vistas de MySQL por empresa. Este guard rechaza de forma
 * conservadora cualquier referencia a un empresaId/colaboradorID distinto al del
 * contexto, o la ausencia de filtro de empresa cuando alguna tabla lo requiere.
 */
async function enforceTenantIsolation(query: string, empresaId: string, colaboradorID: string, rol: string): Promise<void> {
  // 1. Toda referencia literal a empresaId debe coincidir con la del contexto.
  const empresaMatches = [...query.matchAll(/empresaid\s*=\s*'?([\w-]+)'?/gi)];
  for (const m of empresaMatches) {
    if (String(m[1]) !== String(empresaId)) {
      throw new Error('Acceso denegado: la consulta intenta acceder a datos de otra empresa.');
    }
  }

  // Determinar el scope de cada tabla referenciada.
  const tablas = tablasReferenciadas(query);
  const scopes = await Promise.all(tablas.map((t) => getScope(t)));
  const requierenEmpresa = tablas.filter((_, i) => scopes[i] !== 'global');
  const tocaPersonales = scopes.includes('personal');

  // 2. Si alguna tabla no es global, la consulta debe acotar por empresa.
  if (requierenEmpresa.length > 0 && empresaMatches.length === 0) {
    throw new Error('Acceso denegado: la consulta debe filtrar por empresaId para garantizar el aislamiento entre empresas.');
  }

  // 3. Rol no privilegiado (colaborador): solo puede ver su propia información personal.
  if (!esRolPrivilegiado(rol)) {
    const colabMatches = [...query.matchAll(/colaboradorid\s*=\s*'?([\w-]+)'?/gi)];
    for (const m of colabMatches) {
      if (String(m[1]) !== String(colaboradorID)) {
        throw new Error('Acceso denegado: no tienes permisos para consultar información de otros colaboradores.');
      }
    }
    const acotaPorColaborador = colabMatches.some((m) => String(m[1]) === String(colaboradorID));
    if (tocaPersonales && !acotaPorColaborador) {
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
    await enforceTenantIsolation(trimmed, user.empresaId, user.colaboradorID, user.rol);

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
