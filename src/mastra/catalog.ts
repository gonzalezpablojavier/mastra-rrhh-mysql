import { executeQuery } from './db';
import { logger } from './logger';

/**
 * Catálogo de tablas data-driven.
 *
 * Define, por tabla, su POLÍTICA DE ACCESO (scope) y una descripción opcional.
 * Permite escalar a nuevos dominios de datos dentro de la MISMA base MySQL sin
 * tocar el código: basta crear la tabla y declarar su scope en `tabla_config`.
 *
 *  - 'empresa'  → dato multiempresa: la consulta DEBE filtrar por empresaId.
 *  - 'personal' → además de empresa, los roles no privilegiados solo ven su
 *                 propio colaboradorID (presentismo, vacaciones, mood, etc.).
 *  - 'global'   → dato público/compartido sin aislamiento de tenant
 *                 (ej: mundial, feriados, faq general). NO requiere empresaId.
 *
 * Fuente: tabla `tabla_config(tableName, scope, descripcion)` en MySQL.
 * Si la tabla de config no existe o la BD no responde, se usan los scopes por
 * defecto. Las tablas DESCONOCIDAS se tratan como 'empresa' (default seguro:
 * nunca se expone una tabla nueva sin aislamiento por olvido).
 */

export type Scope = 'empresa' | 'personal' | 'global';

export interface TablaConfig {
  scope: Scope;
  descripcion?: string;
}

/** Scopes por defecto de las tablas conocidas de RRHH (usados como fallback). */
const DEFAULT_SCOPES: Record<string, Scope> = {
  colaborador: 'personal',
  usuarios_registrados: 'personal',
  presentismo: 'personal',
  estado_asistencia: 'personal',
  vacaciones: 'personal',
  mood: 'personal',
  idea_box: 'personal',
  historico_dias_disponibles: 'personal',
  faq: 'empresa',
};

const SCOPES_VALIDOS: Scope[] = ['empresa', 'personal', 'global'];

let cache: Map<string, TablaConfig> | null = null;

function normalizeScope(value: unknown): Scope {
  const v = String(value || '').toLowerCase();
  return (SCOPES_VALIDOS as string[]).includes(v) ? (v as Scope) : 'empresa';
}

/**
 * Carga (y cachea) el catálogo: arranca con los defaults y los sobrescribe/extiende
 * con lo que haya en `tabla_config`. Reinicia el proceso para refrescar tras cambios.
 */
export async function loadCatalog(): Promise<Map<string, TablaConfig>> {
  if (cache) return cache;

  const map = new Map<string, TablaConfig>();
  for (const [t, scope] of Object.entries(DEFAULT_SCOPES)) {
    map.set(t.toLowerCase(), { scope });
  }

  try {
    const rows = await executeQuery<Array<{ tableName: string; scope: string; descripcion: string | null }>>({
      query: `SELECT tableName, scope, descripcion FROM tabla_config`,
    });
    for (const r of rows) {
      if (!r.tableName) continue;
      map.set(String(r.tableName).toLowerCase(), {
        scope: normalizeScope(r.scope),
        descripcion: r.descripcion ?? undefined,
      });
    }
    logger.debug('[catalog] tabla_config cargada', { tablas: rows.length });
  } catch (err) {
    logger.warn('[catalog] No se pudo leer tabla_config; uso scopes por defecto.', {
      err: (err as Error)?.message,
    });
  }

  cache = map;
  return cache;
}

/** Scope de una tabla. Default seguro 'empresa' para tablas desconocidas. */
export async function getScope(tableName: string): Promise<Scope> {
  const map = await loadCatalog();
  return map.get(tableName.toLowerCase())?.scope ?? 'empresa';
}

/** Descripción declarada en el catálogo para una tabla, si existe. */
export async function getDescripcion(tableName: string): Promise<string | undefined> {
  const map = await loadCatalog();
  return map.get(tableName.toLowerCase())?.descripcion;
}

/** Invalida la cache (útil tras modificar tabla_config en runtime/tests). */
export function clearCatalogCache(): void {
  cache = null;
}
