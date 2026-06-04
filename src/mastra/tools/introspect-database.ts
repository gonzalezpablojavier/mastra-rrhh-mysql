import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';

const REGLAS_SEMANTICAS_RRHH = `
### 📋 Reglas Semánticas y de Negocio de RRHH (Glosario de Desambiguación)
1. **Colaboradores**: Representan a los empleados. Las inasistencias, salarios o marcas de tiempo se asocian a ellos.
2. **Asistencia y Jornada**:
   - Una "falta" o "inasistencia" se detecta si no hay marcas de entrada registradas en días laborales o cuando el estado es explícitamente 'Ausente'.
   - Un "retraso" o "llegada tarde" es cuando la marca de entrada supera el horario establecido de ingreso del empleado (ej: entrada a las 09:15 cuando la jornada inicia a las 09:00).
   - "Horas extras" son las horas de trabajo realizadas que exceden la jornada asignada por contrato (ej. más de 8 o 9 horas diarias).
3. **Métricas de Rendimiento (Consultas Ambiguas)**:
   - "Peor asistencia" o "mayor ausentismo" se refiere al empleado con la mayor cantidad de inasistencias en un período.
   - "Mayor cumplimiento" o "más puntual" se refiere a quien tiene menor desviación (en minutos) respecto a su hora de entrada asignada.
4. **Filtros de Período**:
   - "Este mes": Filtra desde el primer día del mes actual hasta la fecha actual.
   - "El mes pasado": Filtra desde el primer día del mes anterior hasta el último día del mismo.
`;

export const introspectDatabase = createTool({
  id: 'introspect-database',
  description: 'Introspecciona la base de datos MySQL de RRHH para obtener las tablas, columnas, tipos de datos y relaciones de claves foráneas, adjuntando además las reglas semánticas contables y de negocio.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    schema: z.string().describe('Descripción legible en Markdown del esquema de la base de datos MySQL de RRHH y reglas de negocio.'),
  }),
  execute: async () => {
    const dbName = process.env.DB_DATABASE || 'roma_rrhh';

    // 1. Obtener todas las tablas y columnas
    const columns = await executeQuery<
      Array<{
        TABLE_NAME: string;
        COLUMN_NAME: string;
        DATA_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_KEY: string;
      }>
    >({
      query: `
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `,
      params: [dbName],
    });

    // 2. Obtener las foreign keys
    const foreignKeys = await executeQuery<
      Array<{
        TABLE_NAME: string;
        COLUMN_NAME: string;
        REFERENCED_TABLE_NAME: string;
        REFERENCED_COLUMN_NAME: string;
      }>
    >({
      query: `
        SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `,
      params: [dbName],
    });

    const lines: string[] = ['# Esquema de Base de Datos MySQL (RRHH)', ''];

    let currentTable = '';
    for (const col of columns) {
      if (col.TABLE_NAME !== currentTable) {
        currentTable = col.TABLE_NAME;
        lines.push(`\n## Tabla: ${currentTable}`);
        lines.push('| Columna | Tipo de Dato | Nullable | Clave |');
        lines.push('|---|---|---|---|');
      }
      lines.push(
        `| ${col.COLUMN_NAME} | ${col.DATA_TYPE} | ${col.IS_NULLABLE} | ${col.COLUMN_KEY || ''} |`
      );
    }

    if (foreignKeys.length > 0) {
      lines.push('\n### Relaciones de Claves Foráneas');
      for (const fk of foreignKeys) {
        lines.push(
          `- \`${fk.TABLE_NAME}.${fk.COLUMN_NAME}\` → \`${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}\``
        );
      }
    }

    // Adjuntar reglas semánticas para desambiguar
    lines.push('\n' + REGLAS_SEMANTICAS_RRHH);

    return { schema: lines.join('\n') };
  },
});
