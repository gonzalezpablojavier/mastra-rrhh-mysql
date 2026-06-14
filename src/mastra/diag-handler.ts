import { describeError } from './logger';
import { validateLibsqlEnv } from './libsql-config';
import { probeMysql } from './mysql-probe';

/** Contexto Hono con variables de Mastra (tipado mínimo para no depender de hono). */
type DiagContext = {
  req: { path: string; method: string; query: (k: string) => string | undefined };
  get: (key: 'mastra') => {
    getStorage?: () => { init?: () => Promise<void> };
    getAgent?: (id: string) => { generate: (msg: string, opts: unknown) => Promise<{ text: string }> };
  } | undefined;
  json: (body: unknown, status?: number) => Response;
};

/**
 * Handler de GET /diag. Vive en middleware (no en apiRoutes) porque las rutas
 * custom de Mastra caen al error genérico 500 antes de ejecutar el handler.
 */
export async function handleDiagRequest(c: DiagContext) {
  const pasos: Record<string, unknown> = {};

  try {
    const env = validateLibsqlEnv();
    pasos.env = env;
    if (!env.ok) {
      return c.json({
        ok: false,
        pasos,
        hint: 'Corregí LIBSQL_URL y LIBSQL_AUTH_TOKEN en Vercel → Settings → Environment Variables y redeploy.',
      });
    }

    const m = c.get('mastra');
    pasos.mastra = m ? 'presente' : 'AUSENTE';

    try {
      const storage = m?.getStorage?.();
      pasos.storage = storage ? 'presente' : 'AUSENTE';
      await storage?.init?.();
      pasos.storageInit = 'OK';
    } catch (err) {
      pasos.storageInit = describeError(err);
    }

    if (c.req.query('mysql') === '1') {
      pasos.mysql = await probeMysql();
    }

    if (c.req.query('agent') === '1') {
      try {
        const agent = m?.getAgent?.('sqlAgent');
        if (!agent) throw new Error('getAgent("sqlAgent") devolvió undefined');
        const res = await agent.generate('Decí "hola" en una palabra.', {
          memory: { thread: 'diag-thread', resource: 'diag-user' },
        });
        pasos.agentGenerate = 'OK';
        pasos.text = res.text;
      } catch (err) {
        pasos.agentGenerate = describeError(err);
        pasos.agentStack = (err as Error)?.stack;
      }
    }

    return c.json({ ok: true, pasos });
  } catch (err) {
    return c.json({ ok: false, pasos, fatal: describeError(err), stack: (err as Error)?.stack });
  }
}
