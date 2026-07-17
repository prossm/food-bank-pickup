/**
 * Applies drizzle/*.sql in filename order, tracking what's been run in _migrations.
 * Deliberately plain SQL: the partial unique index, the oversell CHECK, the EXCLUDE
 * constraint and the claim CTE are not things an ORM's generator expresses.
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: true },
});

// Arbitrary but fixed: identifies this app's migration lock among any other advisory locks.
const MIGRATION_LOCK_KEY = 4_812_003;

async function main() {
  const lock = await pool.connect();
  try {
    // This runs from the Vercel build, and two deploys can build at once. Without a lock they
    // would both try to apply 0000_init and one would die on a duplicate-object error, failing
    // a deploy for no real reason. The loser waits, then finds the work already done.
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await lock.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = join(process.cwd(), 'drizzle');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const done = await lock.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (done.rowCount) {
        console.log(`  skip ${file}`);
        continue;
      }
      const sql = await readFile(join(dir, file), 'utf8');
      try {
        await lock.query('BEGIN');
        await lock.query(sql);
        await lock.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await lock.query('COMMIT');
        console.log(`  applied ${file}`);
      } catch (e) {
        await lock.query('ROLLBACK');
        console.error(`  FAILED ${file}`);
        throw e;
      }
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    lock.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
