# ROMA IA — Asistente conversacional de RRHH (text-to-SQL)

Agente de Recursos Humanos construido con [Mastra](https://mastra.ai) que responde preguntas en lenguaje natural sobre una base de datos **MySQL** de RRHH (colaboradores, presentismo, vacaciones, asistencia, clima laboral, FAQ). El agente introspecciona el esquema, traduce la pregunta a SQL `SELECT` y presenta los resultados de forma cálida y humana en español.

## Características

- **Multi-empresa (multitenant)**: aislamiento de datos por `empresaId`, aplicado de forma **determinista en código** (no se confía en el LLM).
- **Control de acceso por rol**: `colaborador` (solo sus datos), `gerencia` (su área), `admin` (toda la empresa).
- **Arquitectura multi-agente**: un coordinador delega en especialistas (asistencia, vacaciones, clima, documentos).
- **Acciones de autogestión (Human-in-the-Loop)**: solicitar vacaciones, registrar mood, enviar ideas y justificar asistencia, con confirmación en dos fases.
- **RAG documental**: búsqueda semántica sobre documentos internos (políticas, convenio, manual), filtrada por empresa.
- **Memoria de trabajo** por colaborador (nombre preferido, idioma, temas abiertos).
- **Guardrails**: normalización Unicode + detección de prompt-injection (entrada) y de PII (salida).
- **Desambiguación proactiva**: ante preguntas vagas, propone una interpretación y pide confirmación antes de ejecutar.
- **Diccionario de datos + fallback offline** del esquema para guiar la generación de SQL.
- **Observabilidad** con filtrado de datos sensibles (PII).

## Arquitectura

```
src/mastra/
├── index.ts                 # new Mastra(): agentes, storage, logger, observability, middleware del server
├── logger.ts                # PinoLogger compartido
├── user-context.ts          # tipo UserContext + lectura desde RequestContext + helpers de rol
├── catalog.ts               # catálogo de tablas data-driven (scope empresa/personal/global)
├── rag.ts                   # vector store LibSQL + embeddings (RAG documental)
├── agents/
│   ├── sql-agent.ts         # coordinador "ROMA IA" (guardrails, working memory, delega en especialistas)
│   ├── shared.ts            # model router, tono RRHH y bloque de seguridad dinámico compartido
│   └── specialists.ts       # sub-agentes: asistencia, vacaciones, clima, documentos
└── tools/
    ├── introspect-database.ts  # esquema + diccionario + reglas de negocio (con fallback estático)
    ├── execute-sql.ts          # ejecuta SELECT + aislamiento multi-tenant determinista
    ├── search-documents.ts     # recuperación semántica de documentos (RAG), filtrada por empresa
    └── actions.ts              # acciones de escritura con confirmación (vacaciones, mood, ideas, asistencia)

scripts/
├── ingest-docs.ts           # ingesta de documentos a RAG: pnpm ingest  (docs/<empresaId>/*.md)
└── tabla_config.sql         # catálogo de scopes por tabla (DDL + ejemplo de dominio nuevo)
```

## Escalar a nuevos dominios de datos (misma MySQL, sin código)

El agente consulta cualquier tabla de la base vía introspección automática. Para agregar un dominio nuevo:

1. Crear la tabla en MySQL (con `COMMENT` en tabla y columnas para guiar al modelo).
2. Declarar su política de acceso en `tabla_config` (ver [scripts/tabla_config.sql](scripts/tabla_config.sql)):
   - `empresa` (filtra por `empresaId`), `personal` (además por `colaboradorID`) o `global` (público, sin tenant).
3. Reiniciar el proceso (el catálogo se cachea).

No hace falta tocar código: la introspección descubre la tabla y `execute-sql` aplica el scope declarado. Tablas no declaradas se tratan como `empresa` (default seguro).

El contexto del usuario (`empresaId`, `colaboradorID`, `rol`, `area`) viaja **fuera del prompt**, a través del `RequestContext` de Mastra, poblado por un middleware del servidor a partir de cabeceras HTTP de confianza. Ver [API.md](API.md).

## Inicio rápido

1. **Instalar dependencias**: `pnpm install`
2. **Configurar entorno**: copia `.env.example` a `.env` y completa la clave del modelo (`OPENAI_API_KEY` u `OPENROUTER_API_KEY`) y la conexión MySQL (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`).
3. **Arrancar**: `pnpm dev` y abre [localhost:4111](http://localhost:4111).

> Si MySQL no está disponible, la introspección usa un diccionario estático de fallback (`introspect-database.ts`) para que el agente siga funcionando en modo demo.

## Scripts

| Script | Descripción |
|---|---|
| `pnpm dev` | Servidor de desarrollo de Mastra (Studio + API HTTP). |
| `pnpm build` | Build de producción. |
| `pnpm start` | Arranca el build. |
| `pnpm typecheck` | Verificación de tipos con `tsc`. |

## Deploy en Vercel

El proyecto usa `VercelDeployer` ([index.ts](src/mastra/index.ts)): `mastra build` genera `.vercel/output` (Build Output API v3) con la función serverless y el routing.

En el dashboard de Vercel configurá:

| Setting | Valor |
|---|---|
| Build Command | `npm run build` (ejecuta `mastra build`) |
| Output Directory | `.vercel/output` |
| Framework Preset | Other / None (usa Build Output API) |
| Environment Variables | `OPENAI_API_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `AGENT_MODEL_ID`, **`LIBSQL_URL`** y **`LIBSQL_AUTH_TOKEN`** (Turso) |

> ⚠️ **Storage en serverless**: el filesystem de Vercel no persiste, así que `LIBSQL_URL=file:...` no sirve. Usá **Turso** (libsql remoto) para que memoria, trazas y el vector store de RAG funcionen. MySQL (RDS) ya es remoto y solo necesita sus variables.

La función tiene `maxDuration: 60s` (el agente encadena varios pasos de tools).

## Seguridad

El aislamiento multi-empresa y el control por rol se aplican en [`execute-sql.ts`](src/mastra/tools/execute-sql.ts) como capa determinista de defensa-en-profundidad (rechaza consultas que referencien otra empresa u otro colaborador). Para una garantía más fuerte en producción, se recomienda además usar **credenciales/vistas de MySQL por empresa** y que las cabeceras de contexto provengan de un **JWT verificado** en el backend, nunca directamente del cliente.

Construido sobre [Mastra](https://mastra.ai).
