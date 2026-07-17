import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, getPool } from '@/lib/db/client';
import { bookPickup } from '@/lib/db/repos/pickups';
import { upsertContact } from '@/lib/db/repos/contacts';
import type { FoodTier, FamilyDraft } from '@/lib/domain/types';

const TIERS: FoodTier[] = [
  { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
  { id: 'medium', minSize: 3, maxSize: 5, boxes: 2, labelKey: 'tier.medium' },
  { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
];

let phoneSeq = 0;
/** Households are identified by phone now, so each test household needs a distinct one. */
const family = (size: number, phone?: string): FamilyDraft => ({
  phone: phone ?? `+1212555${String(1000 + phoneSeq++).slice(-4)}`,
  size,
  allergies: [],
});

async function makeSlot(capacity: number): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO slots (starts_at, capacity) VALUES (now() + interval '7 days', $1) RETURNING id`,
    [capacity],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await query(`TRUNCATE pickup_families, family_allergies, families, notifications,
                        pickups, slots, messages, conversation_sessions, contacts CASCADE`);
});

afterAll(async () => {
  await getPool().end();
});

describe('claimSpot concurrency', () => {
  it('lets exactly 30 of 50 simultaneous bookings through', async () => {
    const slotId = await makeSlot(30);
    const contacts = await Promise.all(
      Array.from({ length: 50 }, (_, i) => upsertContact('web', `racer-${i}`, 'en')),
    );

    // Fired without awaiting in between: these genuinely overlap inside Postgres.
    const results = await Promise.all(
      contacts.map((c) =>
        bookPickup({
          slotId,
          contactId: c.id,
          role: 'family',
          families: [family(4)],
          tiers: TIERS,
        }),
      ),
    );

    expect(results.filter((r) => r.kind === 'booked')).toHaveLength(30);
    expect(results.filter((r) => r.kind === 'slot_full')).toHaveLength(20);

    // The invariant that matters: the counter and the actual rows agree, and neither exceeds 30.
    const [{ booked_count }] = await query<{ booked_count: number }>(
      `SELECT booked_count FROM slots WHERE id = $1`,
      [slotId],
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM pickups WHERE slot_id = $1 AND status = 'booked'`,
      [slotId],
    );
    expect(Number(booked_count)).toBe(30);
    expect(Number(count)).toBe(30);
  });

  it('never oversells even when capacity is 1 and 20 people race for it', async () => {
    const slotId = await makeSlot(1);
    const contacts = await Promise.all(
      Array.from({ length: 20 }, (_, i) => upsertContact('web', `sprint-${i}`, 'en')),
    );

    const results = await Promise.all(
      contacts.map((c) =>
        bookPickup({
          slotId,
          contactId: c.id,
          role: 'family',
          families: [family(2)],
          tiers: TIERS,
        }),
      ),
    );

    expect(results.filter((r) => r.kind === 'booked')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'slot_full')).toHaveLength(19);
  });

  it('rolls the spot back when the booking transaction fails partway', async () => {
    const slotId = await makeSlot(30);
    const contact = await upsertContact('web', 'bad-actor', 'en');

    // A household of 31 passes tierFor (the top tier is unbounded) but violates the
    // families size CHECK, so it fails AFTER the spot has been claimed. If the rollback
    // didn't release the increment, this slot would leak a spot nobody holds.
    await expect(
      bookPickup({
        slotId,
        contactId: contact.id,
        role: 'family',
        families: [family(31)],
        tiers: TIERS,
      }),
    ).rejects.toThrow();

    const [{ booked_count }] = await query<{ booked_count: number }>(
      `SELECT booked_count FROM slots WHERE id = $1`,
      [slotId],
    );
    expect(Number(booked_count)).toBe(0);
  });

  it('treats a double-tap from one contact as already_booked, not a second spot', async () => {
    const slotId = await makeSlot(30);
    const contact = await upsertContact('web', 'impatient', 'en');
    const book = () =>
      bookPickup({
        slotId,
        contactId: contact.id,
        role: 'family',
        families: [family(4)],
        tiers: TIERS,
      });

    const [a, b] = await Promise.all([book(), book()]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['already_booked', 'booked']);

    const [{ booked_count }] = await query<{ booked_count: number }>(
      `SELECT booked_count FROM slots WHERE id = $1`,
      [slotId],
    );
    expect(Number(booked_count)).toBe(1);
  });

  it('closed slots reject bookings', async () => {
    const slotId = await makeSlot(30);
    await query(`UPDATE slots SET status = 'closed' WHERE id = $1`, [slotId]);
    const contact = await upsertContact('web', 'late', 'en');

    const res = await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'family',
      families: [family(3)],
      tiers: TIERS,
    });
    expect(res.kind).toBe('slot_full');
  });
});

describe('spots vs people', () => {
  it('counts an ambassador with 5 families as ONE spot but five families of food', async () => {
    const slotId = await makeSlot(30);
    const contact = await upsertContact('web', 'maria', 'en');

    const res = await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'ambassador',
      families: [family(4), family(6), family(2), family(5), family(5)],
      tiers: TIERS,
    });
    expect(res.kind).toBe('booked');

    const [load] = await query<{
      spots_used: number;
      spots_left: number;
      families_served: string;
      people_served: string;
    }>(
      `SELECT spots_used, spots_left, families_served, people_served
         FROM slot_load WHERE id = $1`,
      [slotId],
    );

    // The whole capacity model in one assertion: one car, five households, 22 people.
    expect(Number(load.spots_used)).toBe(1);
    expect(Number(load.spots_left)).toBe(29);
    expect(Number(load.families_served)).toBe(5);
    expect(Number(load.people_served)).toBe(22);
  });

  it('snapshots family size so later edits do not rewrite a past pickup', async () => {
    const slotId = await makeSlot(30);
    const contact = await upsertContact('web', 'snap', 'en');
    await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'family',
      families: [family(3, '+12125559999')],
      tiers: TIERS,
    });

    const edited = await query(
      `UPDATE families SET family_size = 9 WHERE phone_e164 = '+12125559999' RETURNING id`,
    );
    // Guards the test itself: if the household weren't found, the assertions below would
    // pass against a value nothing had tried to change.
    expect(edited).toHaveLength(1);

    const [{ family_size_snapshot, food_tier_snapshot }] = await query<{
      family_size_snapshot: number;
      food_tier_snapshot: string;
    }>(`SELECT family_size_snapshot, food_tier_snapshot FROM pickup_families`);
    expect(Number(family_size_snapshot)).toBe(3);
    expect(food_tier_snapshot).toBe('medium');
  });
});

describe('cancelPickup', () => {
  it('releases the spot, and a double-cancel does not decrement twice', async () => {
    const { cancelPickup } = await import('@/lib/db/repos/pickups');
    const slotId = await makeSlot(30);
    const contact = await upsertContact('web', 'canceller', 'en');
    const res = await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'family',
      families: [family(3)],
      tiers: TIERS,
    });
    if (res.kind !== 'booked') throw new Error('setup failed');

    expect(await cancelPickup(res.pickupId)).toBe(true);
    expect(await cancelPickup(res.pickupId)).toBe(false);

    const [{ booked_count }] = await query<{ booked_count: number }>(
      `SELECT booked_count FROM slots WHERE id = $1`,
      [slotId],
    );
    expect(Number(booked_count)).toBe(0);
  });
});
