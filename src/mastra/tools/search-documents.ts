import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getUserContext } from '../user-context';
import { embedText, vectorStore, VECTOR_INDEX } from '../rag';
import { logger } from '../logger';

/**
 * Recupera fragmentos relevantes de los documentos internos de la empresa
 * (políticas, convenio, manual del empleado, onboarding) mediante búsqueda
 * semántica. Complementa la tabla `faq` para preguntas que requieren documentos
 * largos. Filtra SIEMPRE por `empresaId` del contexto autenticado.
 */
export const searchDocuments = createTool({
  id: 'search-documents',
  description:
    'Busca en los documentos internos de la empresa (políticas, convenio, manual del empleado, beneficios, onboarding) por significado. Úsalo para preguntas sobre normativa o documentación interna que no estén en la tabla faq.',
  inputSchema: z.object({
    consulta: z.string().describe('La pregunta o tema a buscar en los documentos internos'),
    topK: z.number().optional().describe('Cantidad de fragmentos a recuperar (por defecto 4)'),
  }),
  outputSchema: z.object({
    fragmentos: z
      .array(
        z.object({
          texto: z.string(),
          fuente: z.string(),
          score: z.number(),
        }),
      )
      .describe('Fragmentos relevantes encontrados'),
  }),
  execute: async ({ consulta, topK }, { requestContext }) => {
    const user = getUserContext(requestContext);
    if (!user) {
      throw new Error('Acceso denegado: no hay un contexto de usuario autenticado.');
    }

    const queryVector = await embedText(consulta);

    const results = await vectorStore.query({
      indexName: VECTOR_INDEX,
      queryVector,
      topK: topK ?? 4,
      // Aislamiento multi-empresa a nivel de metadatos del vector store.
      filter: { empresaId: user.empresaId },
    });

    logger.debug('[search-documents]', { empresaId: user.empresaId, encontrados: results.length });

    return {
      fragmentos: results.map((r) => ({
        texto: String(r.metadata?.text ?? ''),
        fuente: String(r.metadata?.source ?? 'documento'),
        score: r.score ?? 0,
      })),
    };
  },
});
