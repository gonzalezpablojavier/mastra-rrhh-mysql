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
import { logger } from './logger';

export const mastra = new Mastra({
  agents: { sqlAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.LIBSQL_URL ?? 'file:./mastra.db',
    ...(process.env.LIBSQL_AUTH_TOKEN ? { authToken: process.env.LIBSQL_AUTH_TOKEN } : {}),
  }),
  logger,
  // Deployer de Vercel: hace que `mastra build` genere la estructura serverless
  // que Vercel entiende (función + vercel.json). maxDuration alto porque el agente
  // encadena varios pasos de tools (introspección + SQL + redacción).
  deployer: new VercelDeployer({ maxDuration: 60 }),
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
