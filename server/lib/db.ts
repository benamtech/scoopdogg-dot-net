import pg from 'pg';

/**
 * One pooled client per warm function instance. The connection string is read from the
 * environment and is never logged, never returned, and never reaches the browser.
 */
let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not configured.');
    // Neon presents a valid public certificate, so verify it rather than skipping the
    // check. `pg` also warns that the loose sslmode aliases change meaning in v9, so the
    // mode is stated here instead of inherited from a default that is about to move.
    pool = new pg.Pool({
      connectionString: connectionString.includes('sslmode=')
        ? connectionString.replace(/sslmode=[^&]*/, 'sslmode=verify-full')
        : connectionString + (connectionString.includes('?') ? '&' : '?') + 'sslmode=verify-full',
      ssl: { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

/** Read one setting, with a fallback so a missing row never breaks a request. */
export async function setting<T>(key: string, fallback: T): Promise<T> {
  try {
    const { rows } = await db().query('select value from settings where key = $1', [key]);
    return rows.length ? (rows[0].value as T) : fallback;
  } catch {
    return fallback;
  }
}
