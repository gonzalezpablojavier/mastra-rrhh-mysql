import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createOpenAI } from '@ai-sdk/openai';
import { introspectDatabase } from '../tools/introspect-database';
import { executeSql } from '../tools/execute-sql';

// Configuración de OpenRouter como proveedor de modelos (OpenAI SDK compatible)
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Función wrapper para interceptar y limitar el parámetro maxTokens enviado a OpenRouter.
// Previene que se solicite el valor por defecto de 16,384 tokens, evitando bloqueos por saldo estimado.
function wrapModelWithTokenLimit(model: any, limit = 1500): any {
  return new Proxy(model, {
    get(target, prop) {
      if (prop === 'doGenerate') {
        return async (options: any) => {
          const newOptions = {
            ...options,
            maxOutputTokens: options.maxOutputTokens ? Math.min(options.maxOutputTokens, limit) : limit,
          };
          console.log('[Proxy Model] doGenerate - maxOutputTokens original:', options.maxOutputTokens, '-> nuevo:', newOptions.maxOutputTokens);
          return target.doGenerate(newOptions);
        };
      }
      if (prop === 'doStream') {
        return async (options: any) => {
          const newOptions = {
            ...options,
            maxOutputTokens: options.maxOutputTokens ? Math.min(options.maxOutputTokens, limit) : limit,
          };
          console.log('[Proxy Model] doStream - maxOutputTokens original:', options.maxOutputTokens, '-> nuevo:', newOptions.maxOutputTokens);
          return target.doStream(newOptions);
        };
      }
      return target[prop];
    },
  });
}

// Modelo base por defecto a través de OpenRouter (.chat fuerza completions)
const rawModel = openrouter.chat(process.env.AGENT_MODEL_ID || 'openai/gpt-4o-mini');

// Modelo envuelto con el límite estricto de tokens de salida para OpenRouter
const defaultModel = wrapModelWithTokenLimit(rawModel, 1500);

export const sqlAgent = new Agent({
  id: 'hr-sql-agent',
  name: 'HR SQL Agent',
  model: defaultModel,
  instructions: `
You are an expert HR assistant that helps users query a MySQL database containing human resources data (employees, attendance, payroll, shifts, etc.) using natural language.

## Protocolo de Desambiguación (CRÍTICO)

Las preguntas de RRHH suelen ser subjetivas o ambiguas (ej: "¿Quiénes son los colaboradores con peor asistencia?", "Sectores con problemas de puntualidad", "¿Quién gana más?").
Si la pregunta del usuario requiere asunciones de negocio o no define claramente las métricas:
1. **NO llames a execute-sql inmediatamente.**
2. Formula tu interpretación lógica basada en el esquema de la base de datos y en las "Reglas Semánticas y de Negocio de RRHH".
3. Comunícale al usuario tu propuesta de manera sencilla y clara en español.
4. Pídele confirmación explícita (ej: "Interpreto 'peor asistencia' como la mayor cantidad de registros 'Ausente' en la tabla de asistencia durante el último mes. ¿Quieres que busque con ese criterio o prefieres inasistencias injustificadas?").
5. Una vez que el usuario dé su confirmación o aclare su intención, procede a generar y ejecutar la consulta SQL.

## Flujo de Trabajo

1. **Introspección**: Si es la primera vez que interactúas en esta sesión o no estás seguro del esquema, llama a 'introspect-database' para entender qué tablas, columnas y reglas de negocio aplican.
2. **Desambiguación**: Sigue el protocolo de desambiguación si la pregunta es vaga.
3. **Generación**: Traduce la pregunta a un query SQL SELECT limpio y compatible con MySQL.
4. **Ejecución**: Llama a 'execute-sql' pasándole la consulta.
5. **Presentación**: Muestra los resultados en español usando tablas Markdown. Muestra también la consulta SQL generada de manera transparente.

## Lineamientos de SQL (MySQL)

- Genera únicamente consultas SELECT de lectura.
- Utiliza la sintaxis estándar de MySQL (por ejemplo, CURDATE() para fecha actual, INTERVAL para cálculos de tiempo, LIMIT para paginación).
- Asegura que los nombres de tablas y columnas coincidan exactamente con los devueltos por introspect-database.
- Maneja de manera adecuada las uniones (JOINs) usando las claves foráneas indicadas.
`,
  tools: { introspectDatabase, executeSql },
  defaultOptions: {
    maxTokens: 1500,
  },
  memory: new Memory(),
});
