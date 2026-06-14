// IMPORTANTE: primero de todo — ajusta el dispatcher global de undici (connect
// timeout) antes de que se construya cualquier cliente HTTP (libsql/Turso).
import './bootstrap';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { sqlAgent } from './agents/sql-agent';
import { handleDiagRequest } from './diag-handler';
import { AGENT_GENERATE_PATH, handleAgentGenerateRequest } from './agent-api-handler';
import { checkApiKey, requiresApiKey } from './api-auth';
import { applyUserContextFromHeaders } from './user-context-http';
import { logger, describeError } from './logger';
import { libsqlUrl, libsqlAuthToken, validateLibsqlEnv } from './libsql-config';
import { probeLibsql } from './storage-probe';

const libsqlEnv = validateLibsqlEnv();
if (!libsqlEnv.ok) {
  for (const issue of libsqlEnv.issues) {
    logger.error(`[libsql-config] ${issue}`);
  }
}

// Handlers globales: el init del storage de Mastra lanza un unhandledRejection
// que mata el proceso con exit 128 (antes de que cualquier log async salga).
// Los capturamos para (a) loguear el error COMPLETO con cadena .cause expandida
// (nuestro logger), exponiendo la causa raíz real del "fetch failed", y (b) evitar
// que el cold-start muera, dándole al resto de la función la chance de responder.
process.on('unhandledRejection', (reason) => {
  logger.error(`[unhandledRejection] CAUSA RAIZ >> ${describeError(reason)}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`[uncaughtException] CAUSA RAIZ >> ${describeError(err)}`);
});

// Diagnóstico temporal: al hacer cold-start, comprueba la conectividad real a
// Turso y loguea la causa raíz de red si falla (ver storage-probe.ts).
void probeLibsql();

export const mastra = new Mastra({
  agents: { sqlAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: libsqlUrl(),
    ...(libsqlAuthToken() ? { authToken: libsqlAuthToken() } : {}),
  }),
  logger,
  // Deployer de Vercel: hace que `mastra build` genere la estructura serverless
  // que Vercel entiende (función + vercel.json). maxDuration alto porque el agente
  // encadena varios pasos de tools (introspección + SQL + redacción).
  // Región IGUAL a la de Turso (us-east-2 / Ohio): cle1 es Cleveland, us-east-2.
  // Misma región = mínima latencia de handshake y sin salto entre regiones, para
  // eliminar el `connect ETIMEDOUT` intermitente al inicializar el storage.
  deployer: new VercelDeployer({ maxDuration: 60, regions: ['cle1'] }),
  server: {
    /**
     * Mastra protege /api/* por defecto. Sin provider de auth, las rutas protegidas
     * devuelven 500 opaco. Hasta integrar JWT del backend, dejamos /api/* público;
     * el aislamiento real sigue en x-empresa-id / x-colaborador-id.
     */
    auth: {
      public: ['/api/*', '/diag', '/health'],
      protected: [],
    },
    /**
     * Middleware que traslada el contexto del usuario desde cabeceras HTTP de
     * confianza al `RequestContext`. Las tools y las instrucciones del agente lo
     * leen para aplicar el aislamiento multi-empresa de forma determinista, en
     * lugar de confiar en un bloque de texto dentro del mensaje del usuario.
     *
     * IMPORTANTE: en producción estas cabeceras deben provenir de un backend que
     * verifique un JWT (no del cliente directamente). El `colaboradorID` se fija
     * además como resourceId reservado para aislar la memoria por usuario.
     */
    middleware: [
      async (c, next) => {
        const path = c.req.path;
        if (requiresApiKey(path)) {
          const keyCheck = checkApiKey(c.req.header('authorization'));
          if (!keyCheck.ok) {
            return c.json({ error: keyCheck.error }, 401);
          }
        }
        await next();
      },
      async (c, next) => {
        applyUserContextFromHeaders(c, MASTRA_RESOURCE_ID_KEY);
        await next();
      },
      async (c, next) => {
        const path = c.req.path;
        if (path === '/diag' && c.req.method === 'GET') {
          return handleDiagRequest(c);
        }
        if (
          (path === AGENT_GENERATE_PATH || path === '/agents/hr-sql-agent/generate') &&
          c.req.method === 'POST'
        ) {
          return handleAgentGenerateRequest(c);
        }
        await next();
      },
    ],
  },
});
