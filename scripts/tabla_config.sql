-- ============================================================================
-- Catálogo de tablas data-driven para ROMA IA
-- ----------------------------------------------------------------------------
-- Declara, por tabla, su POLÍTICA DE ACCESO (scope) que aplica execute-sql:
--   'empresa'  → la consulta DEBE filtrar por empresaId.
--   'personal' → además, los roles no privilegiados solo ven su colaboradorID.
--   'global'   → dato público/compartido (sin aislamiento de empresa).
--
-- Tablas no listadas se tratan como 'empresa' (default seguro).
-- Para escalar a un dominio nuevo: crear la tabla + insertar una fila aquí.
-- (Reiniciar el proceso para refrescar la cache del catálogo.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tabla_config (
  tableName   VARCHAR(128) NOT NULL PRIMARY KEY,
  scope       ENUM('empresa', 'personal', 'global') NOT NULL DEFAULT 'empresa',
  descripcion VARCHAR(512) NULL
);

-- Políticas de las tablas de RRHH (coinciden con los defaults del código).
INSERT INTO tabla_config (tableName, scope, descripcion) VALUES
  ('usuarios_registrados',       'personal', 'Perfil de los colaboradores.'),
  ('colaborador',                'personal', 'Credenciales de acceso.'),
  ('presentismo',                'personal', 'Fichajes de entrada/salida.'),
  ('estado_asistencia',          'personal', 'Estado diario de asistencia.'),
  ('vacaciones',                 'personal', 'Solicitudes y saldos de vacaciones.'),
  ('historico_dias_disponibles', 'personal', 'Histórico de saldo de vacaciones.'),
  ('mood',                       'personal', 'Estado de ánimo reportado.'),
  ('idea_box',                   'personal', 'Buzón de ideas y sugerencias.'),
  ('faq',                        'empresa',  'Preguntas frecuentes de la empresa.')
ON DUPLICATE KEY UPDATE scope = VALUES(scope), descripcion = VALUES(descripcion);

-- ----------------------------------------------------------------------------
-- EJEMPLO: agregar un dominio nuevo SIN tocar código (datos públicos: el mundial)
-- ----------------------------------------------------------------------------
-- CREATE TABLE mundial (
--   id INT PRIMARY KEY AUTO_INCREMENT,
--   equipo VARCHAR(80) COMMENT 'Selección participante',
--   grupo CHAR(1) COMMENT 'Grupo del fixture',
--   partidos_jugados INT, ganados INT, empatados INT, perdidos INT,
--   puntos INT COMMENT 'Puntos en la fase de grupos'
-- ) COMMENT='Posiciones del Mundial de fútbol';
--
-- INSERT INTO tabla_config (tableName, scope, descripcion)
--   VALUES ('mundial', 'global', 'Posiciones y resultados del Mundial de fútbol.');
--
-- Tras esto, "¿cómo va Argentina en el mundial?" funciona sin deploy:
-- la introspección descubre la tabla y el guard la trata como global (sin empresaId).
