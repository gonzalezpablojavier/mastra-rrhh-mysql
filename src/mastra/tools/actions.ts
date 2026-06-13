import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';
import { logger } from '../logger';
import { getUserContext, esRolPrivilegiado, esRolGerencia } from '../user-context';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

/**
 * Tools transaccionales (escritura) de autogestión de RRHH.
 *
 * Patrón Human-in-the-Loop en dos fases:
 *  1. El agente llama SIN `confirmar` → la tool devuelve un resumen ("confirmacion_requerida")
 *     y NO escribe. El agente muestra el resumen y pide confirmación al usuario.
 *  2. Tras la confirmación explícita del usuario, el agente vuelve a llamar con `confirmar: true`
 *     → la tool ejecuta el INSERT/UPDATE.
 *
 * Garantías deterministas (NO dependen del LLM):
 *  - `empresaId` y `colaboradorID` se toman del RequestContext autenticado, no del input.
 *  - Escritura siempre parametrizada (sin SQL generado por el modelo).
 */

const outputSchema = z.object({
  status: z.enum(['confirmacion_requerida', 'completado', 'denegado']),
  mensaje: z.string(),
  id: z.number().optional(),
});

// ───────────────────────────── Solicitar vacaciones ─────────────────────────────

export const requestVacation = createTool({
  id: 'request-vacation',
  description:
    'Registra una SOLICITUD de vacaciones/permiso del colaborador autenticado (queda en estado "Evaluando"). Llama primero sin confirmar para mostrar el resumen y pedir confirmación.',
  inputSchema: z.object({
    fechaDesde: z.string().describe('Fecha de inicio (YYYY-MM-DD)'),
    fechaHasta: z.string().describe('Fecha de fin (YYYY-MM-DD)'),
    motivo: z.string().optional().describe('Motivo del permiso'),
    colaboradorCubre: z.string().optional().describe('Nombre de quién lo cubre'),
    observacion: z.string().optional(),
    confirmar: z.boolean().optional().describe('true para ejecutar la solicitud tras la confirmación del usuario'),
  }),
  outputSchema,
  execute: async ({ fechaDesde, fechaHasta, motivo, colaboradorCubre, observacion, confirmar }, { requestContext }) => {
    const user = getUserContext(requestContext);
    if (!user) return { status: 'denegado' as const, mensaje: 'No hay un contexto de usuario autenticado.' };

    if (!confirmar) {
      return {
        status: 'confirmacion_requerida' as const,
        mensaje: `Vas a solicitar vacaciones del ${fechaDesde} al ${fechaHasta}${motivo ? ` (motivo: ${motivo})` : ''}. La solicitud quedará "Evaluando". ¿Confirmás?`,
      };
    }

    const result = await executeQuery<ResultSetHeader>({
      query: `INSERT INTO vacaciones
        (fechaPermisoDesde, fechaPermisoHasta, motivo, colaboradorCubre, observacion, autorizado, colaboradorID, area, empresaId)
        VALUES (?, ?, ?, ?, ?, 'Evaluando', ?, ?, ?)`,
      params: [
        fechaDesde,
        fechaHasta,
        motivo ?? '',
        colaboradorCubre ?? '',
        observacion ?? '',
        user.colaboradorID,
        user.area,
        user.empresaId,
      ],
    });

    logger.info('[request-vacation] creada', { colaboradorID: user.colaboradorID, id: result.insertId });
    return { status: 'completado' as const, mensaje: 'Tu solicitud de vacaciones fue registrada y quedó en evaluación.', id: result.insertId };
  },
});

// ───────────────────────────── Registrar estado de ánimo ─────────────────────────────

export const logMood = createTool({
  id: 'log-mood',
  description: 'Registra el estado de ánimo (mood) del día del colaborador autenticado. Llama primero sin confirmar.',
  inputSchema: z.object({
    mood: z.string().describe('El estado de ánimo reportado (ej: "feliz", "cansado", "motivado")'),
    confirmar: z.boolean().optional(),
  }),
  outputSchema,
  execute: async ({ mood, confirmar }, { requestContext }) => {
    const user = getUserContext(requestContext);
    if (!user) return { status: 'denegado' as const, mensaje: 'No hay un contexto de usuario autenticado.' };

    if (!confirmar) {
      return { status: 'confirmacion_requerida' as const, mensaje: `Vas a registrar tu mood de hoy como "${mood}". ¿Confirmás?` };
    }

    const result = await executeQuery<ResultSetHeader>({
      query: `INSERT INTO mood (colaboradorID, mood, empresaId) VALUES (?, ?, ?)`,
      params: [user.colaboradorID, mood, user.empresaId],
    });

    logger.info('[log-mood] registrado', { colaboradorID: user.colaboradorID, id: result.insertId });
    return { status: 'completado' as const, mensaje: '¡Gracias por compartir cómo te sentís hoy! Lo registré.', id: result.insertId };
  },
});

// ───────────────────────────── Enviar idea al buzón ─────────────────────────────

export const submitIdea = createTool({
  id: 'submit-idea',
  description: 'Envía una idea o sugerencia al buzón (idea_box) en nombre del colaborador autenticado. Llama primero sin confirmar.',
  inputSchema: z.object({
    idea: z.string().describe('El texto de la idea o sugerencia'),
    areaDestino: z.string().optional().describe('Área a la que va dirigida la idea'),
    confirmar: z.boolean().optional(),
  }),
  outputSchema,
  execute: async ({ idea, areaDestino, confirmar }, { requestContext }) => {
    const user = getUserContext(requestContext);
    if (!user) return { status: 'denegado' as const, mensaje: 'No hay un contexto de usuario autenticado.' };

    if (!confirmar) {
      return {
        status: 'confirmacion_requerida' as const,
        mensaje: `Vas a enviar esta idea al buzón${areaDestino ? ` (área: ${areaDestino})` : ''}: "${idea}". ¿Confirmás?`,
      };
    }

    const result = await executeQuery<ResultSetHeader>({
      query: `INSERT INTO idea_box (colaboradorID, idea, areaDestino, estado, empresaId) VALUES (?, ?, ?, 'Nuevo', ?)`,
      params: [user.colaboradorID, idea, areaDestino ?? null, user.empresaId],
    });

    logger.info('[submit-idea] enviada', { colaboradorID: user.colaboradorID, id: result.insertId });
    return { status: 'completado' as const, mensaje: '¡Gracias por tu idea! La envié al buzón de sugerencias.', id: result.insertId };
  },
});

// ──────────────── Evaluar/justificar asistencia (solo gerencia/admin) ────────────────

const ESTADOS_VALIDOS = ['presente', 'ausente_justificado', 'ausente_injustificado', 'sin_evaluar'] as const;

export const setAttendanceStatus = createTool({
  id: 'set-attendance-status',
  description:
    'Establece o justifica el estado de asistencia de un colaborador en una fecha (ej: marcar "ausente_justificado"). SOLO para roles gerencia o admin. Llama primero sin confirmar.',
  inputSchema: z.object({
    colaboradorID: z.number().describe('ID del colaborador cuya asistencia se modifica'),
    fecha: z.string().describe('Fecha de la jornada (YYYY-MM-DD)'),
    estado: z.enum(ESTADOS_VALIDOS).describe('Nuevo estado de asistencia'),
    observaciones: z.string().optional(),
    confirmar: z.boolean().optional(),
  }),
  outputSchema,
  execute: async ({ colaboradorID, fecha, estado, observaciones, confirmar }, { requestContext }) => {
    const user = getUserContext(requestContext);
    if (!user) return { status: 'denegado' as const, mensaje: 'No hay un contexto de usuario autenticado.' };

    if (!esRolPrivilegiado(user.rol)) {
      return { status: 'denegado' as const, mensaje: 'No tenés permisos para modificar la asistencia de colaboradores.' };
    }

    // Validar que el colaborador objetivo pertenece a la misma empresa (y área, si es gerencia).
    const target = await executeQuery<RowDataPacket[]>({
      query: `SELECT empresaId, area FROM usuarios_registrados WHERE colaboradorID = ? LIMIT 1`,
      params: [colaboradorID],
    });
    if (target.length === 0 || String(target[0].empresaId) !== String(user.empresaId)) {
      return { status: 'denegado' as const, mensaje: 'El colaborador no pertenece a tu empresa.' };
    }
    if (esRolGerencia(user.rol) && String(target[0].area) !== String(user.area)) {
      return { status: 'denegado' as const, mensaje: 'Como gerencia, solo podés modificar la asistencia de colaboradores de tu área.' };
    }

    if (!confirmar) {
      return {
        status: 'confirmacion_requerida' as const,
        mensaje: `Vas a marcar al colaborador ${colaboradorID} como "${estado}" el ${fecha}. ¿Confirmás?`,
      };
    }

    const result = await executeQuery<ResultSetHeader>({
      query: `INSERT INTO estado_asistencia (colaboradorID, empresaId, fecha, estadoManual, modificadoPor, observaciones)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [colaboradorID, user.empresaId, fecha, estado, user.colaboradorID, observaciones ?? null],
    });

    logger.info('[set-attendance-status]', { por: user.colaboradorID, objetivo: colaboradorID, estado });
    return { status: 'completado' as const, mensaje: `Asistencia del colaborador ${colaboradorID} actualizada a "${estado}".`, id: result.insertId };
  },
});
