import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

/**
 * Obtiene o inicializa el Pool de conexiones a MySQL.
 */
export function getMysqlPool(): mysql.Pool {
  if (!pool) {
    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || '3306', 10);
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_DATABASE || 'roma_rrhh';

    console.log(`[MySQL] Inicializando pool de conexiones para la base de datos "${database}" en ${host}:${port}`);

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

/**
 * Ejecuta una consulta SQL en la base de datos utilizando el pool de conexiones.
 * Sigue el patrón RORO (Receive an Object, Return an Object).
 */
export async function executeQuery<T = any>({
  query,
  params,
}: {
  query: string;
  params?: any[];
}): Promise<T> {
  const mysqlPool = getMysqlPool();
  const connection = await mysqlPool.getConnection();
  try {
    // Validamos que la conexión esté saludable (evita conexiones stale)
    await connection.ping();
    const [rows] = await connection.execute(query, params);
    return rows as T;
  } catch (error) {
    console.error('[MySQL] Error en la ejecución de la consulta:', error);
    throw error;
  } finally {
    connection.release();
  }
}
