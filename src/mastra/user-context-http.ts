type RequestContextLike = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};

type HttpContextWithHeaders = {
  req: { header: (name: string) => string | undefined };
  get: (key: 'requestContext') => RequestContextLike | undefined;
};

/** Lee cabeceras RRHH y las vuelca al RequestContext de Mastra. */
export function applyUserContextFromHeaders(c: HttpContextWithHeaders, resourceIdKey: string): void {
  const requestContext = c.get('requestContext');
  if (!requestContext) return;

  const empresaId = c.req.header('x-empresa-id');
  const colaboradorID = c.req.header('x-colaborador-id');
  const rol = c.req.header('x-rol');
  const area = c.req.header('x-area');

  if (empresaId) requestContext.set('empresaId', empresaId);
  if (colaboradorID) {
    requestContext.set('colaboradorID', colaboradorID);
    requestContext.set(resourceIdKey, colaboradorID);
  }
  if (rol) requestContext.set('rol', rol);
  if (area) requestContext.set('area', area);
}

export function getUserContextFromRequest(
  requestContext: RequestContextLike | undefined,
): { empresaId?: string; colaboradorID?: string; rol?: string; area?: string } {
  if (!requestContext) return {};
  return {
    empresaId: requestContext.get('empresaId') as string | undefined,
    colaboradorID: requestContext.get('colaboradorID') as string | undefined,
    rol: requestContext.get('rol') as string | undefined,
    area: requestContext.get('area') as string | undefined,
  };
}

export function requireUserHeaders(
  requestContext: RequestContextLike | undefined,
): { ok: true; empresaId: string; colaboradorID: string } | { ok: false; error: string } {
  const { empresaId, colaboradorID } = getUserContextFromRequest(requestContext);
  if (!empresaId || !colaboradorID) {
    return {
      ok: false,
      error: 'Faltan cabeceras x-empresa-id y/o x-colaborador-id (deben venir del backend con JWT verificado).',
    };
  }
  return { ok: true, empresaId, colaboradorID };
}
