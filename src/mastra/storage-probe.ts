import { createClient } from '@libsql/client';
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

  // 1) fetch nativo plano (ya probado que funciona) — control.
  try {
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
    logger.info('[probe] (1) fetch nativo a /v2/pipeline', {
      status: res.status,
      tokenPresente: Boolean(token),
    });
  } catch (err) {
    logger.error('[probe] (1) fetch nativo FALLÓ:', { err: err as Error });
  }

  // 2) EXACTAMENTE lo que hace LibSQLStore: createClient(...).execute('SELECT 1').
  //    Si esto falla, reproduce el bug y el logger expande la causa raíz real.
  try {
    const client = createClient({
      url,
      ...(token ? { authToken: token } : {}),
    });
    const rs = await client.execute('SELECT 1');
    logger.info('[probe] (2) createClient().execute OK', { filas: rs.rows.length });
  } catch (err) {
    logger.error('[probe] (2) createClient().execute FALLÓ — ESTA es la causa raíz:', {
      err: err as Error,
    });
  }
}
