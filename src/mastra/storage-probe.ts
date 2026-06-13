import { logger } from './logger';
import { libsqlUrl, libsqlAuthToken } from './libsql-config';

/**
 * Sonda de diagnóstico de conectividad a Turso/libsql.
 *
 * El error "fetch failed" que loguea Mastra al inicializar el storage lo imprime
 * con `console` interno y NO pasa por nuestro logger, por lo que la causa raíz de
 * red queda oculta (`[cause]: [Error]`). Esta sonda hace un `fetch` directo al
 * mismo endpoint HTTPS y loguea el error completo a través de nuestro logger, que
 * expande la cadena `.cause` (DNS / TLS / timeout / reset, con su `code`).
 *
 * Es temporal: una vez identificada la causa, se puede quitar.
 */
export async function probeLibsql(): Promise<void> {
  const url = libsqlUrl();
  const token = libsqlAuthToken();

  if (!url.startsWith('https://')) {
    logger.warn('[probe] LIBSQL_URL no es https (¿sigue en libsql:// o file:?)', { url });
    return;
  }

  try {
    // Replicamos la petición REAL del cliente libsql: POST al endpoint de
    // pipeline con el token y un SELECT 1. Esto valida red + token + transporte,
    // igual que hace LibSQLStore al crear sus tablas.
    const res = await fetch(`${url}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        requests: [
          { type: 'execute', stmt: { sql: 'SELECT 1' } },
          { type: 'close' },
        ],
      }),
    });
    const cuerpo = await res.text();
    logger.info('[probe] POST /v2/pipeline respondió', {
      status: res.status,
      ok: res.ok,
      url,
      tokenPresente: Boolean(token),
      // Recortado: si es 200 trae los resultados; si es 401 trae el motivo.
      cuerpo: cuerpo.slice(0, 300),
    });
  } catch (err) {
    logger.error('[probe] fetch a Turso FALLÓ — causa de red:', { err: err as Error });
  }
}
