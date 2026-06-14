/**
 * API key opcional para proteger /api/agents/* y /diag.
 * Si MASTRA_API_KEY no está definida, no se exige (útil en dev local).
 */
export function requiresApiKey(path: string): boolean {
  return path === '/diag' || path.startsWith('/api/agents/');
}

export function checkApiKey(
  authorizationHeader: string | undefined,
): { ok: true } | { ok: false; error: string } {
  const expected = process.env.MASTRA_API_KEY;
  if (!expected) return { ok: true };

  const raw = authorizationHeader ?? '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (!token || token !== expected) {
    return { ok: false, error: 'API key inválida o ausente (Authorization: Bearer …)' };
  }
  return { ok: true };
}
