import { createOpenAI } from '@ai-sdk/openai';
import { LibSQLVector } from '@mastra/libsql';
import { logger } from './logger';

/**
 * Capa de RAG documental.
 *
 * Indexa documentos de la empresa (políticas, convenio, manual del empleado, etc.)
 * en un vector store LibSQL y permite recuperarlos por similitud semántica, filtrando
 * siempre por `empresaId` para mantener el aislamiento multi-empresa.
 *
 * Las embeddings usan OpenAI (`text-embedding-3-small`). Requiere `OPENAI_API_KEY`
 * (los modelos de embedding de OpenRouter no son equivalentes).
 */

export const VECTOR_INDEX = 'documentos_rrhh';
export const EMBEDDING_DIM = 1536; // text-embedding-3-small

const embeddingProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
});

const embeddingModel = embeddingProvider.embeddingModel('text-embedding-3-small');

export const vectorStore = new LibSQLVector({
  id: 'rag-vector',
  url: process.env.LIBSQL_URL ?? 'file:./mastra.db',
  ...(process.env.LIBSQL_AUTH_TOKEN ? { authToken: process.env.LIBSQL_AUTH_TOKEN } : {}),
});

/** Genera el embedding de un texto. */
export async function embedText(text: string): Promise<number[]> {
  const { embeddings } = await embeddingModel.doEmbed({ values: [text] });
  return embeddings[0];
}

/** Genera embeddings para varios textos (una sola llamada). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embeddingModel.doEmbed({ values: texts });
  return embeddings;
}

/** Crea el índice vectorial si no existe. */
export async function ensureVectorIndex(): Promise<void> {
  try {
    await vectorStore.createIndex({ indexName: VECTOR_INDEX, dimension: EMBEDDING_DIM });
  } catch (err) {
    // createIndex es idempotente en la práctica; logueamos por si acaso.
    logger.debug('[RAG] ensureVectorIndex', { err: (err as Error)?.message });
  }
}

export interface DocChunkMetadata {
  empresaId: string;
  source: string;
  text: string;
  [key: string]: unknown;
}
