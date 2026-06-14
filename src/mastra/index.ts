// IMPORTANTE: primero de todo — ajusta el dispatcher global de undici (connect
// timeout) antes de que se construya cualquier cliente HTTP (libsql/Turso).
import './bootstrap';
import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { sqlAgent } from './agents/sql-agent';
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
        const requestContext = c.get('requestContext');
        if (requestContext) {
          const empresaId = c.req.header('x-empresa-id');
          const colaboradorID = c.req.header('x-colaborador-id');
          const rol = c.req.header('x-rol');
          const area = c.req.header('x-area');

          if (empresaId) requestContext.set('empresaId', empresaId);
          if (colaboradorID) {
            requestContext.set('colaboradorID', colaboradorID);
            // Aísla la memoria conversacional por colaborador (precede a valores del cliente).
            requestContext.set(MASTRA_RESOURCE_ID_KEY, colaboradorID);
          }
          if (rol) requestContext.set('rol', rol);
          if (area) requestContext.set('area', area);
        }
        await next();
      },
    ],
    /**
     * Ruta de diagnóstico TEMPORAL. Ejecuta el agente igual que `/generate` pero
     * atrapa el error y lo devuelve en la respuesta HTTP en texto plano (sin pasar
     * por Pino, que trunca los Error a `{}`). Permite ver la causa raíz del 500 con
     * un solo `curl https://<host>/diag`. Quitar una vez resuelto.
     */
    apiRoutes: [
      registerApiRoute('/diag', {
        method: 'GET',
        requiresAuth: false,
        handler: async (c) => {
          const pasos: Record<string, unknown> = {};
          // Todo envuelto en un try externo: cualquier throw se reporta en el body
          // (200) en vez de caer al manejador genérico de Mastra (500 sin detalle).
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

            const m = c.get('mastra') as any;
            pasos.mastra = m ? 'presente' : 'AUSENTE';

            // 1) Storage: forzar init explícito.
            try {
              const storage = m?.getStorage?.();
              pasos.storage = storage ? 'presente' : 'AUSENTE';
              await storage?.init?.();
              pasos.storageInit = 'OK';
            } catch (err) {
              pasos.storageInit = describeError(err);
            }

            // 2) Agente — solo si ?agent=1 (para aislar del storage).
            if (c.req.query('agent') === '1') {
              try {
                const agent = m.getAgent('sqlAgent');
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
            // Captura cualquier cosa que se nos haya escapado.
            return c.json({ ok: false, pasos, fatal: describeError(err), stack: (err as Error)?.stack });
          }
        },
      }),
    ],
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'roma-ia-rrhh',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
