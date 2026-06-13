import type { RequestContext } from '@mastra/core/request-context';
import { getUserContext, esRolAdmin, esRolGerencia } from '../user-context';

/**
 * Configuración del modelo compartida por todos los agentes (coordinador + especializados),
 * usando el "model router" de Mastra.
 */
export function resolveModel() {
  const isOpenRouter =
    !!process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.startsWith('sk-proj-');

  const envModel = process.env.AGENT_MODEL_ID;

  if (isOpenRouter) {
    const id = (envModel || 'openai/gpt-4o-mini') as `${string}/${string}`;
    return { id, url: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY };
  }

  let id = envModel || 'openai/gpt-4o-mini';
  if (!id.includes('/')) id = `openai/${id}`;
  return id as `${string}/${string}`;
}

/** Pautas de tono cálido y humano de RRHH, comunes a todos los agentes. */
export const TONO_RRHH = `
## Tono y Personalidad (Asistente Cálido y Humano de RRHH)
- Eres un asistente de Recursos Humanos cálido, empático, profesional y cercano. Habla en español de forma natural, amable y cordial.
- **PROHIBIDO mostrar información técnica**: NO muestres nunca la consulta SQL, ni nombres de tablas/columnas, ni menciones herramientas o procesos internos. Toda la lógica técnica debe ser invisible.
- **Presentación humana**: explica los datos de forma redactada y amable; si usas tablas, acompáñalas de una introducción y un cierre cálidos.
- Sé proactivo: agrega consejos, recordatorios y sugerencias de seguimiento relevantes.
`;

/**
 * Bloque dinámico de control de acceso y seguridad, construido con los valores REALES
 * del contexto autenticado (no marcadores). Compartido por todos los agentes; el
 * aislamiento se aplica además de forma determinista en las tools.
 */
export function accessControlInstructions(requestContext?: RequestContext): string {
  const user = getUserContext(requestContext);
  if (!user) {
    return (
      '\n\n## Reglas de Control de Acceso y Seguridad (CRÍTICO)\n' +
      'No se recibió un contexto de usuario verificado (empresaId / colaboradorID). ' +
      'Por seguridad, **NO ejecutes ninguna consulta ni acción** y responde de forma educada en español ' +
      'indicando que la sesión no está autenticada correctamente.'
    );
  }

  const { rol, empresaId, colaboradorID, area } = user;
  const lines = [
    '\n\n## Reglas de Control de Acceso y Seguridad (CRÍTICO)',
    `Contexto del usuario actual (verificado por el servidor): empresaId=${empresaId}, colaboradorID=${colaboradorID}, rol=${rol}, area=${area}.`,
    `1. **Aislamiento Multitenant**: las consultas a tablas de empresa o personales **DEBEN** incluir \`empresaId = '${empresaId}'\` (el sistema rechaza lo que no lo respete). Las tablas marcadas como **Acceso (global)** en la introspección (ej: datos públicos) NO requieren empresaId.`,
  ];

  if (esRolAdmin(rol)) {
    lines.push(`2. **Rol Administrador**: puedes consultar a cualquier colaborador de la empresa ${empresaId}.`);
  } else if (esRolGerencia(rol)) {
    lines.push(
      `2. **Rol Gerencia**: solo otros colaboradores de tu área (\`area = '${area}'\`); usa JOIN con \`usuarios_registrados\` filtrando por esa área. Deniega o limita peticiones de otras áreas.`,
    );
  } else {
    lines.push(
      `2. **Rol Colaborador**: solo tu propia información. **DEBES** añadir \`colaboradorID = ${colaboradorID}\` en tablas con esa columna. Si piden datos de otros o información general, **deniega** de forma educada sin ejecutar nada.`,
    );
  }

  return lines.join('\n');
}

/** Compone las instrucciones finales de un agente: base + seguridad dinámica + tono. */
export function withSecurity(base: string) {
  return ({ requestContext }: { requestContext?: RequestContext }) =>
    base + accessControlInstructions(requestContext) + TONO_RRHH;
}
