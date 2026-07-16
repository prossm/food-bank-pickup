import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, getPool } from '@/lib/db/client';
import { listOpenSlots } from '@/lib/db/repos/slots';

beforeEach(async () => {
  await query(`TRUNCATE pickup_families, family_allergies, families, notifications,
                        pickups, slots, messages, conversation_sessions, contacts CASCADE`);
});

afterAll(async () => {
  await getPool().end();
});

/** Seeds a Wednesday's 5:00 and 5:30 slots `weeks` out, in the food bank's local time. */
async function seedWednesday(weeks: number, capacity = 30, booked = 0): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `
    WITH d AS (
      SELECT (date_trunc('week', (now() AT TIME ZONE 'America/New_York')::date)
              + interval '2 days' + ($1 || ' weeks')::interval)::date AS day
    ),
    t AS (SELECT unnest(ARRAY[time '17:00', time '17:30']) AS tm)
    INSERT INTO slots (starts_at, capacity, booked_count)
    SELECT (d.day + t.tm) AT TIME ZONE 'America/New_York', $2, $3
      FROM d CROSS JOIN t
    RETURNING id
    `,
    [weeks, capacity, booked],
  );
  return rows.map((r) => r.id);
}

describe('listOpenSlots', () => {
  it('offers only the soonest pickup day, not every seeded week', async () => {
    // Regression: seeding six weeks ahead made the bot send a twelve-option text.
    await seedWednesday(1);
    await seedWednesday(2);
    await seedWednesday(3);

    const slots = await listOpenSlots();
    expect(slots).toHaveLength(2);

    const days = new Set(slots.map((s) => s.startsAt.toISOString().slice(0, 10)));
    expect(days.size).toBe(1);
  });

  it('rolls past a fully booked day rather than offering two full times', async () => {
    const full = await seedWednesday(1, 30, 30);
    await seedWednesday(2);

    const slots = await listOpenSlots();
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.spotsLeft > 0)).toBe(true);
    expect(slots.map((s) => s.id).some((id) => full.includes(id))).toBe(false);
  });

  it('still offers a day where only one of the two times has room', async () => {
    await seedWednesday(1, 30, 30);
    await query(
      `UPDATE slots SET booked_count = 12
        WHERE starts_at = (SELECT MIN(starts_at) FROM slots)`,
    );

    const slots = await listOpenSlots();
    // Both times on that day are offered — the full one shows 0 left, which is honest and
    // lets someone see that 5:30 is the only option.
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.spotsLeft).sort()).toEqual([0, 18]);
  });

  it('returns nothing when everything is booked solid', async () => {
    await seedWednesday(1, 30, 30);
    await seedWednesday(2, 30, 30);
    expect(await listOpenSlots()).toEqual([]);
  });

  it('ignores closed slots and slots in the past', async () => {
    await seedWednesday(1);
    await query(`UPDATE slots SET status = 'closed'`);
    await seedWednesday(2);

    const slots = await listOpenSlots();
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.startsAt > new Date())).toBe(true);
  });
});
