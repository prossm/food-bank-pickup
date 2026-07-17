import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, getPool } from '@/lib/db/client';
import { bookPickup } from '@/lib/db/repos/pickups';
import { bookedPickups } from '@/lib/db/repos/roster';
import { upsertContact } from '@/lib/db/repos/contacts';
import type { FoodTier } from '@/lib/domain/types';

const TIERS: FoodTier[] = [
  { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
  { id: 'medium', minSize: 3, maxSize: 5, boxes: 2, labelKey: 'tier.medium' },
  { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
];

beforeEach(async () => {
  await query(`TRUNCATE pickup_families, family_allergies, families, notifications,
                        pickups, slots, messages, conversation_sessions, contacts CASCADE`);
  await query(`
    INSERT INTO food_tiers (id, min_size, max_size, boxes, label_key) VALUES
      ('small', 1, 2, 1, 'tier.small'),
      ('medium', 3, 5, 2, 'tier.medium'),
      ('large', 6, NULL, 3, 'tier.large')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await getPool().end();
});

async function makeSlot(): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO slots (starts_at, capacity) VALUES (now() + interval '7 days', 30) RETURNING id`,
  );
  return rows[0].id;
}

describe('roster totals', () => {
  it('does not double-count a household that has BOTH allergies', async () => {
    // The regression this guards: joining family_allergies into the aggregate fans out one
    // row per allergy, so this household would report 8 people and 4 boxes instead of 4 and 2.
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'both-allergies', 'en');
    await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: ['gluten_free', 'dairy_free'] }],
      tiers: TIERS,
    });

    const [row] = await bookedPickups();
    expect(row.families).toBe(1);
    expect(row.people).toBe(4);
    expect(row.boxes).toBe(2);
    expect(row.allergies).toBe('dairy_free, gluten_free');
  });

  it('totals an ambassador load correctly across mixed allergies and sizes', async () => {
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'maria', 'en');
    await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'ambassador',
      families: [
        { phone: '+12125550100', size: 4, allergies: ['gluten_free', 'dairy_free'] },
        { phone: '+12125550187', size: 6, allergies: ['dairy_free'] },
        { phone: '+12125550199', size: 2, allergies: [] },
      ],
      tiers: TIERS,
    });

    const [row] = await bookedPickups();
    expect(row.role).toBe('ambassador');
    expect(row.families).toBe(3);
    expect(row.people).toBe(12); // 4 + 6 + 2
    expect(row.boxes).toBe(6); // 2 + 3 + 1
    expect(row.households.map((h) => h.phone)).toEqual([
      '+12125550100', '+12125550187', '+12125550199',
    ]);
    // Names are staff's to fill in; the chat never asked, so they start empty.
    expect(row.households.every((h) => h.name === null)).toBe(true);
    // Two households need dairy free; staff should see the kind once, not once per household.
    expect(row.allergies).toBe('dairy_free, gluten_free');
  });

  it('omits cancelled pickups', async () => {
    const { cancelPickup } = await import('@/lib/db/repos/pickups');
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'gone', 'en');
    const res = await bookPickup({
      slotId,
      contactId: contact.id,
      role: 'family',
      families: [{ phone: '+12125550100', size: 3, allergies: [] }],
      tiers: TIERS,
    });
    if (res.kind !== 'booked') throw new Error('setup failed');
    await cancelPickup(res.pickupId);

    expect(await bookedPickups()).toEqual([]);
  });
});
