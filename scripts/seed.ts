/**
 * Seeds food tiers and the upcoming Wednesday pickup slots. Safe to re-run.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// "Wednesday at 5pm" is a wall-clock time at the food bank, not a UTC instant. Postgres does
// the local->timestamptz conversion so DST shifts are handled by the tz database rather than
// by hour arithmetic that silently breaks twice a year.
const TZ = process.env.FOOD_BANK_TZ ?? 'America/New_York';
const CAPACITY = Number(process.env.SLOT_CAPACITY ?? 30);
const WEEKS_AHEAD = 6;

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: true },
});

async function main() {
  // Placeholder boundaries. The brief specifies "3-4" and "6+", which leaves both 5 and 1-2
  // undefined, so these are a guess pending confirmation from the food bank. They live in a
  // table precisely so correcting them is an UPDATE, not a deploy.
  //
  // DO NOTHING, emphatically not DO UPDATE: this seed runs on every deploy, and once the food
  // bank corrects a boundary, re-asserting these placeholders would silently revert their real
  // numbers and change how much food every household gets. Seed only fills in what's absent.
  const tiers = await pool.query(`
    INSERT INTO food_tiers (id, min_size, max_size, boxes, label_key) VALUES
      ('small',  1, 2,    1, 'tier.small'),
      ('medium', 3, 5,    2, 'tier.medium'),
      ('large',  6, NULL, 3, 'tier.large')
    ON CONFLICT (id) DO NOTHING
  `);
  console.log(
    tiers.rowCount
      ? `  tiers seeded (${tiers.rowCount} placeholder rows inserted)`
      : '  tiers already present — left untouched',
  );

  const res = await pool.query(
    `
    WITH weds AS (
      SELECT generate_series(
        (date_trunc('week', (now() AT TIME ZONE $1)::date) + interval '2 days')::date,
        (date_trunc('week', (now() AT TIME ZONE $1)::date) + interval '2 days'
           + ($3 || ' weeks')::interval)::date,
        interval '1 week'
      )::date AS d
    ),
    times AS (SELECT unnest(ARRAY[time '17:00', time '17:30']) AS t)
    INSERT INTO slots (starts_at, capacity)
    SELECT (weds.d + times.t) AT TIME ZONE $1, $2
      FROM weds CROSS JOIN times
     WHERE (weds.d + times.t) AT TIME ZONE $1 > now()
    ON CONFLICT (starts_at) DO NOTHING
    RETURNING starts_at
    `,
    [TZ, CAPACITY, WEEKS_AHEAD],
  );
  console.log(`  ${res.rowCount} slots seeded (${TZ}, capacity ${CAPACITY})`);

  const all = await pool.query(
    `SELECT starts_at, capacity, booked_count FROM slots ORDER BY starts_at LIMIT 4`,
  );
  for (const r of all.rows) {
    console.log(
      `    ${new Date(r.starts_at).toLocaleString('en-US', { timeZone: TZ })} — ${r.booked_count}/${r.capacity}`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
