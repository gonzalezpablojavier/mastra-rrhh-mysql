import { Agent } from '@mastra/core/agent';
import { resolveModel, withSecurity } from './shared';
import { introspectDatabase } from '../tools/introspect-database';
import { executeSql } from '../tools/execute-sql';
import { searchDocuments } from '../tools/search-documents';
import { requestVacation, logMood, submitIdea, setAttendanceStatus } from '../tools/actions';

const SQL_BASE = `
Traduce la pregunta a una consulta SQL SELECT compatible con MySQL y preséntala de forma humana.
Si no conoces el esquema, llama primero a 'introspect-database'. Genera solo SELECT de lectura.
Para acciones de escritura usa el protocolo de confirmación en dos fases (primero sin 'confirmar', muestra el resumen y pide confirmación; luego con confirmar: true).
`;

/** Asistencia, presentismo y jornada. */
export const asistenciaAgent = new Agent({
  id: 'asistencia-agent',
  name: 'ROMA · Asistencia',
  model: resolveModel(),
  instructions: withSecurity(
    `Eres el especialista en **asistencia, presentismo y jornada** (tablas presentismo, estado_asistencia).
Resuelves consultas de fichajes, retrasos, ausencias y puntualidad. Para justificar/evaluar la asistencia de un colaborador usa 'set-attendance-status' (solo gerencia/admin).` +
      SQL_BASE,
  ),
  tools: { introspectDatabase, executeSql, setAttendanceStatus },
});

/** Vacaciones y permisos. */
export const vacacionesAgent = new Agent({
  id: 'vacaciones-agent',
  name: 'ROMA · Vacaciones',
  model: resolveModel(),
  instructions: withSecurity(
    `Eres el especialista en **vacaciones y permisos** (tablas vacaciones, historico_dias_disponibles).
Consultas saldos y solicitudes, y ayudas a solicitar vacaciones con 'request-vacation' (protocolo de confirmación).` +
      SQL_BASE,
  ),
  tools: { introspectDatabase, executeSql, requestVacation },
});

/** Clima laboral: mood e ideas. */
export const climaAgent = new Agent({
  id: 'clima-agent',
  name: 'ROMA · Clima',
  model: resolveModel(),
  instructions: withSecurity(
    `Eres el especialista en **clima laboral** (tablas mood, idea_box).
Consultas tendencias de ánimo e ideas, registras el mood del día con 'log-mood' y envías ideas con 'submit-idea' (protocolo de confirmación).` +
      SQL_BASE,
  ),
  tools: { introspectDatabase, executeSql, logMood, submitIdea },
});

/** Documentos, políticas y FAQ. */
export const documentosAgent = new Agent({
  id: 'documentos-agent',
  name: 'ROMA · Documentos',
  model: resolveModel(),
  instructions: withSecurity(
    `Eres el especialista en **políticas, cultura y documentación interna**.
Responde primero con la tabla 'faq' (isActive = 1, filtrando por empresaId). Si se requiere documentación más extensa (convenio, manual del empleado), usa 'search-documents' y cita la fuente de forma natural.` +
      SQL_BASE,
  ),
  tools: { introspectDatabase, executeSql, searchDocuments },
});
