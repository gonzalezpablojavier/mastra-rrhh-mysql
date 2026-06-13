/**
 * Ingesta de documentos internos al vector store para RAG.
 *
 * Estructura esperada de carpetas (el nombre de la subcarpeta = empresaId):
 *
 *   docs/
 *     <empresaId>/
 *       politica-vacaciones.md
 *       manual-empleado.txt
 *       ...
 *
 * Uso:  npx tsx --env-file=.env scripts/ingest-docs.ts
 *
 * Requiere OPENAI_API_KEY (embeddings) y la config de LIBSQL_URL.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { embedMany, ensureVectorIndex, vectorStore, VECTOR_INDEX, type DocChunkMetadata } from '../src/mastra/rag';
import { logger } from '../src/mastra/logger';

const DOCS_DIR = process.env.DOCS_DIR || 'docs';
const CHUNK_SIZE = 1200; // caracteres aprox por fragmento
const CHUNK_OVERLAP = 150;

/** Divide un texto en fragmentos solapados respetando párrafos cuando es posible. */
function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    // Intenta cortar en un salto de párrafo/oración cercano.
    const slice = clean.slice(start, end);
    const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
    if (end < clean.length && lastBreak > CHUNK_SIZE * 0.5) {
      end = start + lastBreak + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter(Boolean);
}

async function main() {
  await ensureVectorIndex();

  let empresas: string[];
  try {
    empresas = readdirSync(DOCS_DIR).filter((d) => statSync(join(DOCS_DIR, d)).isDirectory());
  } catch {
    logger.warn(`[ingest] No existe el directorio "${DOCS_DIR}". Crea docs/<empresaId>/archivo.md y reintenta.`);
    process.exit(0);
  }

  let total = 0;
  for (const empresaId of empresas) {
    const dir = join(DOCS_DIR, empresaId);
    const files = readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f));
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf8');
      const chunks = chunkText(raw);
      if (chunks.length === 0) continue;

      const vectors = await embedMany(chunks);
      const metadata: DocChunkMetadata[] = chunks.map((text) => ({ empresaId, source: file, text }));

      await vectorStore.upsert({ indexName: VECTOR_INDEX, vectors, metadata });
      total += chunks.length;
      logger.info(`[ingest] ${empresaId}/${file}: ${chunks.length} fragmentos`);
    }
  }

  logger.info(`[ingest] Completado. ${total} fragmentos indexados en "${VECTOR_INDEX}".`);
  process.exit(0);
}

main().catch((err) => {
  logger.error('[ingest] Error', { err });
  process.exit(1);
});
