import type { RequestContext } from '@mastra/core/request-context';

/**
 * Contexto del usuario autenticado que viaja FUERA del prompt, a través del
 * `RequestContext` de Mastra. Esto sustituye al antiguo bloque de texto
 * `[CONTEXTO_USUARIO: ...]` que se inyectaba dentro del mensaje y que el modelo
 * debía respetar voluntariamente (lo cual no es una frontera de seguridad real).
 *
 * El servidor lo rellena en un middleware a partir de cabeceras HTTP de confianza
 * (idealmente derivadas de un JWT verificado en el backend), y las tools lo leen
 * para aplicar el aislamiento multi-empresa de forma DETERMINISTA en código.
 */
export type Rol = 'admin' | 'administrador' | 'gerencia' | 'gerente' | string;

export interface UserContext {
  colaboradorID: string;
  rol: Rol;
  area: string;
  empresaId: string;
}

/** Forma tipada del RequestContext usado en todo el proyecto. */
export type AppRequestContext = RequestContext<{
  colaboradorID: string;
  rol: string;
  area: string;
  empresaId: string;
}>;

const ROLES_PRIVILEGIADOS = new Set(['admin', 'administrador', 'gerencia', 'gerente']);
const ROLES_GERENCIA = new Set(['gerencia', 'gerente']);
const ROLES_ADMIN = new Set(['admin', 'administrador']);

export const esRolPrivilegiado = (rol?: string) => !!rol && ROLES_PRIVILEGIADOS.has(rol.toLowerCase());
export const esRolGerencia = (rol?: string) => !!rol && ROLES_GERENCIA.has(rol.toLowerCase());
export const esRolAdmin = (rol?: string) => !!rol && ROLES_ADMIN.has(rol.toLowerCase());

/**
 * Lee el contexto del usuario desde el RequestContext. Devuelve `null` si el
 * contexto obligatorio (empresaId + colaboradorID) no está presente.
 */
export function getUserContext(requestContext?: RequestContext): UserContext | null {
  if (!requestContext) return null;
  const empresaId = requestContext.get('empresaId') as string | undefined;
  const colaboradorID = requestContext.get('colaboradorID') as string | undefined;
  if (!empresaId || !colaboradorID) return null;
  return {
    empresaId: String(empresaId),
    colaboradorID: String(colaboradorID),
    rol: (requestContext.get('rol') as string) || 'colaborador',
    area: (requestContext.get('area') as string) || '',
  };
}
