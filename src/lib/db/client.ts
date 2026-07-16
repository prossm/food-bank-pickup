import { Pool, type PoolClient } from 'pg';

// One pool per lambda instance. Neon's pooled connection string works over plain TCP from
// Vercel's Node runtime, and the same driver runs against local Postgres in tests — so the
// concurrency proof exercises the real code path rather than a stand-in.
declare global {
  // eslint-disable-next-line no-var
  var __fbPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function getPool(): Pool {
  if (!global.__fbPool) {
    const url = connectionString();
    global.__fbPool = new Pool({
      connectionString: url,
      // Neon terminates TLS; localhost doesn't speak it.
      ssl: url.includes('localhost') || url.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return global.__fbPool;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * READ COMMITTED (the default) is sufficient and intended here — see claimSpot() for why
 * the booking race is safe without a stricter isolation level or an explicit lock.
 */
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
