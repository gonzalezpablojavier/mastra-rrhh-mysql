import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeQuery } from '../db';
import { logger } from '../logger';

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

const TABLA_FALLBACK_DESCRIPCIONES: Record<string, string> = {
  colaborador: 'Credenciales de acceso, contraseñas e inicio de sesión de los colaboradores.',
  usuarios_registrados: 'Perfil completo de los colaboradores (nombre, apellido, email, área, sucursal, cuil, nivel/seniority Jr/Ssr/Sr). Contiene el colaboradorID que enlaza con las demás tablas.',
  presentismo: 'Historial crudo de marcas de entrada y salida (fichajes) con hora, geolocalización (latitud, longitud) y modalidad (home/distri). NOTA: No contiene una columna "fecha" ni "estado"; las fechas se obtienen de "horaRegistro" y los estados se consultan en "estado_asistencia".',
  estado_asistencia: 'Consolidado diario del estado de asistencia por colaborador y fecha (presente, ausente_justificado, ausente_injustificado, sin_evaluar).',
  vacaciones: 'Solicitudes y asignaciones de días de vacaciones por colaborador, incluyendo fechas desde/hasta, estado de autorización (Aprobado/Pendiente/Rechazado) y balances de días.',
  historico_dias_disponibles: 'Historial del saldo de días de vacaciones de los colaboradores (diasCorresponden, diasConsumidos, diasPrevios).',
  mood: 'Registro diario del estado de ánimo reportado voluntariamente por los colaboradores para medir el clima laboral.',
  idea_box: 'Buzón de sugerencias e ideas de mejora enviadas por los colaboradores, asociadas a un área de destino y con puntaje/estado.',
  faq: 'Preguntas frecuentes de la empresa sobre cultura, hábitos, políticas, beneficios y preguntas generales internas de la organización.',
};

const COLUMNA_FALLBACK_DESCRIPCIONES: Record<string, Record<string, string>> = {
  usuarios_registrados: {
    nivel: "Nivel de seniority del colaborador. Valores posibles: 'Jr', 'Ssr', 'Sr'.",
    colaboradorID: "ID numérico único del colaborador que enlaza con las otras tablas (presentismo, vacaciones, etc.).",
  },
  presentismo: {
    tipo: "Tipo de marcación. Valores posibles: 'entrada', 'salida'.",
    tipoPresencial: "Modalidad de trabajo para el fichaje. Valores posibles: 'home' (home office), 'distri' (presencial en sucursal).",
    horaRegistro: "Fecha y hora exacta del marcaje/fichaje. No usar columna 'fecha'.",
  },
  estado_asistencia: {
    estadoManual: "Estado de asistencia evaluado. Valores posibles: 'presente', 'ausente_justificado', 'ausente_injustificado', 'sin_evaluar'.",
    fecha: "Fecha de la jornada evaluada (tipo DATE). Para presentismo crudo se usa 'horaRegistro'.",
  },
  vacaciones: {
    autorizado: "Estado de aprobación de las vacaciones. Valores comunes: 'Aprobado', 'Pendiente', 'Rechazado'.",
    diasDisponibles: "Días de vacaciones que tiene disponibles actualmente el colaborador para solicitar.",
  },
  faq: {
    pregunta: "La pregunta frecuente formulada (útil para buscar coincidencias con LIKE).",
    respuesta: "La respuesta o explicación correspondiente a la pregunta frecuente.",
    keywords: "Palabras clave asociadas a la pregunta (formato JSON).",
    area: "Área de la empresa relacionada con la pregunta (ej: 'RH', 'Finanzas', 'Sistemas').",
    isActive: "Indica si la FAQ está activa (1) o inactiva (0). Filtrar siempre por isActive = 1.",
  }
};

const FALLBACK_SCHEMA_COLUMNS = [
  // colaborador
  { TABLE_NAME: 'colaborador', COLUMN_NAME: 'colaboradorID', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'Identificador único de credenciales.' },
  { TABLE_NAME: 'colaborador', COLUMN_NAME: 'nombreUsuario', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Nombre de usuario.' },
  { TABLE_NAME: 'colaborador', COLUMN_NAME: 'password', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Contraseña codificada.' },
  { TABLE_NAME: 'colaborador', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' },
  
  // usuarios_registrados
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'ID único del registro.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'nombre', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Nombre del colaborador.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'apellido', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Apellido del colaborador.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'email', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Correo electrónico.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'area', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Área/departamento de trabajo.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'sucursal', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Sucursal de asignación.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'nivel', DATA_TYPE: "enum('Jr','Ssr','Sr')", IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Seniority (Jr, Ssr, Sr).' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'cuil', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'CUIL del empleado.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'colaboradorID', DATA_TYPE: 'int', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'Enlace con credenciales colaboradorID.' },
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' },

  // presentismo
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'ID de marcación.' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'colaboradorID', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID del colaborador.' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'tipo', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: "Tipo de ficha ('entrada' o 'salida')." },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'tipoPresencial', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: "Modalidad ('home' o 'distri')." },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'horaRegistro', DATA_TYPE: 'datetime', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Fecha y hora exacta del marcaje/fichaje. No contiene columna "fecha".' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'latitud', DATA_TYPE: 'decimal(10,8)', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'Latitud de geolocalización.' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'longitud', DATA_TYPE: 'decimal(11,8)', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'Longitud de geolocalización.' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' },

  // estado_asistencia
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'ID de estado.' },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'colaboradorID', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID del colaborador.' },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'fecha', DATA_TYPE: 'date', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Fecha de la jornada evaluada.' },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'estadoManual', DATA_TYPE: "enum('presente','ausente_justificado','ausente_injustificado','sin_evaluar')", IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: "Estado ('presente', 'ausente_justificado', 'ausente_injustificado', 'sin_evaluar')." },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'observaciones', DATA_TYPE: 'text', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'Notas adicionales.' },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' },

  // vacaciones
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'ID del permiso.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'colaboradorID', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID del colaborador.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'fechaPermisoDesde', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Fecha de inicio del permiso.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'fechaPermisoHasta', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Fecha de fin del permiso.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'autorizado', DATA_TYPE: 'varchar(50)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: "Estado ('Aprobado', 'Pendiente', 'Rechazado')." },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'diasDisponibles', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Días de vacaciones disponibles.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'vacacionesPendientes', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Días pendientes.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'diasCorresponden', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Días que corresponden.' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' },

  // faq
  { TABLE_NAME: 'faq', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: 'ID único del FAQ.' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'pregunta', DATA_TYPE: 'text', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Pregunta frecuente.' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'respuesta', DATA_TYPE: 'text', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Respuesta frecuente.' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'keywords', DATA_TYPE: 'json', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Palabras clave asociadas.' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'area', DATA_TYPE: 'varchar(100)', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'Área relacionada.' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'isActive', DATA_TYPE: 'tinyint(1)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'Estado activo (1 o 0).' },
  { TABLE_NAME: 'faq', COLUMN_NAME: 'empresaId', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: 'ID de empresa.' }
];

const FALLBACK_SCHEMA_FOREIGN_KEYS = [
  { TABLE_NAME: 'usuarios_registrados', COLUMN_NAME: 'colaboradorID', REFERENCED_TABLE_NAME: 'colaborador', REFERENCED_COLUMN_NAME: 'colaboradorID' },
  { TABLE_NAME: 'presentismo', COLUMN_NAME: 'colaboradorID', REFERENCED_TABLE_NAME: 'usuarios_registrados', REFERENCED_COLUMN_NAME: 'colaboradorID' },
  { TABLE_NAME: 'estado_asistencia', COLUMN_NAME: 'colaboradorID', REFERENCED_TABLE_NAME: 'usuarios_registrados', REFERENCED_COLUMN_NAME: 'colaboradorID' },
  { TABLE_NAME: 'vacaciones', COLUMN_NAME: 'colaboradorID', REFERENCED_TABLE_NAME: 'usuarios_registrados', REFERENCED_COLUMN_NAME: 'colaboradorID' }
];

export const introspectDatabase = createTool({
  id: 'introspect-database',
  description: 'Introspecciona la base de datos MySQL de RRHH para obtener las tablas, columnas, tipos de datos y relaciones de claves foráneas, adjuntando además las descripciones del diccionario de datos y las reglas semánticas contables y de negocio.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    schema: z.string().describe('Descripción legible en Markdown del esquema de la base de datos MySQL de RRHH, diccionario de tablas y reglas de negocio.'),
  }),
  execute: async () => {
    const dbName = process.env.DB_DATABASE || 'roma_rrhh';

    let tablesInfo: Array<{ TABLE_NAME: string; TABLE_COMMENT: string }> = [];
    let columns: Array<{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; COLUMN_KEY: string; COLUMN_COMMENT: string }> = [];
    let foreignKeys: Array<{ TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }> = [];
    let isFallback = false;

    try {
      // 1. Obtener todas las tablas y sus comentarios
      tablesInfo = await executeQuery<
        Array<{
          TABLE_NAME: string;
          TABLE_COMMENT: string;
        }>
      >({
        query: `
          SELECT TABLE_NAME, TABLE_COMMENT
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
        `,
        params: [dbName],
      });

      // 2. Obtener todas las columnas con sus comentarios
      columns = await executeQuery<
        Array<{
          TABLE_NAME: string;
          COLUMN_NAME: string;
          DATA_TYPE: string;
          IS_NULLABLE: string;
          COLUMN_KEY: string;
          COLUMN_COMMENT: string;
        }>
      >({
        query: `
          SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION
        `,
        params: [dbName],
      });

      // 3. Obtener las foreign keys
      foreignKeys = await executeQuery<
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
    } catch (err) {
      logger.warn('[MySQL Introspect] Error conectando al servidor MySQL. Utilizando diccionario fallback estático.', { err });
      isFallback = true;
    }

    // Cargar datos estáticos si falló la conexión
    if (isFallback || columns.length === 0) {
      columns = FALLBACK_SCHEMA_COLUMNS;
      foreignKeys = FALLBACK_SCHEMA_FOREIGN_KEYS;
      tablesInfo = Object.keys(TABLA_FALLBACK_DESCRIPCIONES).map(name => ({
        TABLE_NAME: name,
        TABLE_COMMENT: TABLA_FALLBACK_DESCRIPCIONES[name]
      }));
    }

    const tableComments = new Map<string, string>();
    for (const t of tablesInfo) {
      tableComments.set(t.TABLE_NAME, t.TABLE_COMMENT || '');
    }

    const lines: string[] = ['# Esquema de Base de Datos MySQL (RRHH) y Diccionario de Datos', ''];

    let currentTable = '';
    for (const col of columns) {
      if (col.TABLE_NAME !== currentTable) {
        currentTable = col.TABLE_NAME;
        lines.push(`\n## Tabla: ${currentTable}`);
        const comment = tableComments.get(currentTable) || TABLA_FALLBACK_DESCRIPCIONES[currentTable] || '';
        if (comment) {
          lines.push(`**Descripción**: ${comment}\n`);
        }
        lines.push('| Columna | Tipo de Dato | Nullable | Clave | Descripción / Comentario |');
        lines.push('|---|---|---|---|---|');
      }
      const colComment = col.COLUMN_COMMENT || (COLUMNA_FALLBACK_DESCRIPCIONES[currentTable] && COLUMNA_FALLBACK_DESCRIPCIONES[currentTable][col.COLUMN_NAME]) || '';
      lines.push(
        `| ${col.COLUMN_NAME} | ${col.DATA_TYPE} | ${col.IS_NULLABLE} | ${col.COLUMN_KEY || ''} | ${colComment} |`
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
