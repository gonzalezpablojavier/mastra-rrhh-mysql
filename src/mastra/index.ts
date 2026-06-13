// IMPORTANTE: primero de todo — ajusta el dispatcher global de undici (connect
// timeout) antes de que se construya cualquier cliente HTTP (libsql/Turso).
import './bootstrap';
import { Mastra } from '@mastra/core/mastra';
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
import { libsqlUrl, libsqlAuthToken } from './libsql-config';
import { probeLibsql } from './storage-probe';

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
  // Región pegada a Turso (us-east-2 / Ohio) para minimizar la latencia del
  // handshake TCP y evitar el `connect ETIMEDOUT` intermitente. iad1 (Washington
  // DC, us-east-1) es la región de Vercel más cercana a us-east-2.
  deployer: new VercelDeployer({ maxDuration: 60, regions: ['iad1'] }),
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
