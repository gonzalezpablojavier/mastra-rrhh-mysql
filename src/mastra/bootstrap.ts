import { setGlobalDispatcher, Agent } from 'undici';

/**
 * Ajuste del dispatcher global de undici (el que usa el `fetch()` nativo) que debe
 * correr ANTES de crear cualquier cliente HTTP. Por eso este módulo se importa de
 * primero en index.ts.
 *
 * Motivo: el cliente de Turso/libsql sufre `connect ETIMEDOUT` intermitente desde
 * Vercel. El connect TCP a la IP de Turso (AWS us-east-2) a veces supera el timeout
 * por defecto de undici (10s), agravado por la ráfaga del `initDomainsInParallel`
 * de Mastra, que abre ~13 conexiones simultáneas (una por tabla) al cold-start.
 *
 * - `connect.timeout`: damos 30s al handshake TCP+TLS (en vez de 10s).
 * - `connections`: ampliamos el pool por host para la ráfaga inicial.
 * - keep-alive holgado para reusar conexiones ya establecidas entre requests.
 *
 * `setGlobalDispatcher` afecta al `fetch` global de Node (comparten el símbolo
 * `undici.globalDispatcher`), por lo que cubre tanto a libsql como a cualquier
 * otra llamada `fetch` del proceso.
 */
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 30_000 },
    connections: 64,
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 60_000,
  }),
);
