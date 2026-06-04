import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';

const BLOCKED_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i,
  /\b(ATTACH|DETACH)\b/i,
  /\b(PRAGMA)\b/i,
  /;.*\S/, // bloquea múltiples statements en una sola consulta
];

export const executeSql = createTool({
  id: 'execute-sql',
  description: 'Ejecuta una consulta SQL SELECT de solo lectura contra la base de datos MySQL y retorna los registros.',
  inputSchema: z.object({
    query: z.string().describe('La consulta SQL SELECT a ejecutar en MySQL'),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe('Filas devueltas por la consulta'),
    rowCount: z.number().describe('Cantidad de filas devueltas'),
  }),
  execute: async ({ query }) => {
    const trimmed = query.trim().replace(/;$/, '');

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new Error('Solo se permiten consultas de tipo SELECT de solo lectura.');
      }
    }

    if (!/^\s*SELECT\b/i.test(trimmed)) {
      throw new Error('La consulta SQL debe comenzar con la palabra clave SELECT.');
    }

    // Ejecución en la base de datos MySQL
    const rows = await executeQuery<Record<string, unknown>[]>({ query: trimmed });

    return {
      rows,
      rowCount: rows.length,
    };
  },
});
