import { describeError } from './logger';
import { executeQuery } from './db';

export interface MysqlProbeResult {
  ok: boolean;
  host?: string;
  database?: string;
  error?: string;
}

/** Sonda rápida de conectividad a MySQL (RDS). */
export async function probeMysql(): Promise<MysqlProbeResult> {
  const host = process.env.DB_HOST || 'localhost';
  const database = process.env.DB_DATABASE || 'roma_rrhh';

  try {
    await executeQuery<{ ok: number }[]>({ query: 'SELECT 1 AS ok' });
    return { ok: true, host, database };
  } catch (err) {
    return { ok: false, host, database, error: describeError(err) };
  }
}
