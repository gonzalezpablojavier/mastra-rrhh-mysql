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
    // Un GET a la raíz alcanza para confirmar red (egress + DNS + TLS). No nos
    // importa el status HTTP: si responde algo, la conectividad existe y el
    // problema está en otro lado (protocolo/transporte/token).
    const res = await fetch(url, {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    logger.info('[probe] Turso ALCANZABLE (la red está OK)', {
      status: res.status,
      url,
      tokenPresente: Boolean(token),
    });
  } catch (err) {
    logger.error('[probe] fetch a Turso FALLÓ — causa de red:', { err: err as Error });
  }
}
