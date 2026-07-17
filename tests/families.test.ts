import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, getPool } from '@/lib/db/client';
import { bookPickup } from '@/lib/db/repos/pickups';
import { findFamilyByPhone } from '@/lib/db/repos/families';
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

describe('dedupe by phone', () => {
  it('is one household after signing up two weeks running, not two', async () => {
    const [w1, w2] = [await makeSlot(), await makeSlot()];
    await query(`UPDATE slots SET starts_at = now() + interval '14 days' WHERE id = $1`, [w2]);
    const contact = await upsertContact('web', 'regular', 'en');

    for (const slotId of [w1, w2]) {
      const res = await bookPickup({
        slotId,
        contactId: contact.id,
        role: 'family',
        families: [{ phone: '+12125550100', size: 4, allergies: ['gluten_free'] }],
        tiers: TIERS,
      });
      expect(res.kind).toBe('booked');
    }

    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM families WHERE phone_e164 = '+12125550100'`,
    );
    expect(Number(count)).toBe(1);

    // Both pickups point at that single household.
    const [{ links }] = await query<{ links: string }>(`SELECT count(*) AS links FROM pickup_families`);
    expect(Number(links)).toBe(2);
  });

  it('never lets the chat overwrite a name that staff entered', async () => {
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'x', 'en');
    await bookPickup({
      slotId, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: [] }],
      tiers: TIERS,
    });

    // Staff do their job: they know who this number belongs to.
    await query(`UPDATE families SET name = 'Alvarez' WHERE phone_e164 = '+12125550100'`);

    const slot2 = await makeSlot();
    await query(`UPDATE slots SET starts_at = now() + interval '21 days' WHERE id = $1`, [slot2]);
    await bookPickup({
      slotId: slot2, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: [] }],
      tiers: TIERS,
    });

    const [{ name }] = await query<{ name: string }>(
      `SELECT name FROM families WHERE phone_e164 = '+12125550100'`,
    );
    expect(name).toBe('Alvarez');
  });

  it('reuses the stored size rather than a stale draft', async () => {
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'y', 'en');
    await bookPickup({
      slotId, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: [] }],
      tiers: TIERS,
    });
    // The household's real size changes on file.
    await query(`UPDATE families SET family_size = 7 WHERE phone_e164 = '+12125550100'`);

    const slot2 = await makeSlot();
    await query(`UPDATE slots SET starts_at = now() + interval '21 days' WHERE id = $1`, [slot2]);
    // A conversation carrying the OLD size books anyway (it read before the change).
    await bookPickup({
      slotId: slot2, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: [] }],
      tiers: TIERS,
    });

    // The snapshot follows the database, not the stale draft: 7 people is the large tier.
    const rows = await query<{ family_size_snapshot: number; food_tier_snapshot: string }>(
      `SELECT pf.family_size_snapshot, pf.food_tier_snapshot
         FROM pickup_families pf JOIN pickups p ON p.id = pf.pickup_id
        WHERE p.slot_id = $1`,
      [slot2],
    );
    expect(Number(rows[0].family_size_snapshot)).toBe(7);
    expect(rows[0].food_tier_snapshot).toBe('large');
  });

  it('survives two ambassadors adding the same household at the same moment', async () => {
    const [a, b] = [await makeSlot(), await makeSlot()];
    await query(`UPDATE slots SET starts_at = now() + interval '14 days' WHERE id = $1`, [b]);
    const [c1, c2] = await Promise.all([
      upsertContact('web', 'amb-1', 'en'),
      upsertContact('web', 'amb-2', 'en'),
    ]);

    const results = await Promise.all([
      bookPickup({
        slotId: a, contactId: c1.id, role: 'ambassador',
        families: [{ phone: '+12125550100', size: 4, allergies: [] }], tiers: TIERS,
      }),
      bookPickup({
        slotId: b, contactId: c2.id, role: 'ambassador',
        families: [{ phone: '+12125550100', size: 4, allergies: [] }], tiers: TIERS,
      }),
    ]);

    expect(results.every((r) => r.kind === 'booked')).toBe(true);
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM families WHERE phone_e164 = '+12125550100'`,
    );
    expect(Number(count)).toBe(1);
  });

  it('findFamilyByPhone returns stored size and allergies, or null', async () => {
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'z', 'en');
    await bookPickup({
      slotId, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 6, allergies: ['dairy_free', 'gluten_free'] }],
      tiers: TIERS,
    });

    const found = await findFamilyByPhone('+12125550100');
    expect(found?.size).toBe(6);
    expect(found?.allergies.sort()).toEqual(['dairy_free', 'gluten_free']);

    expect(await findFamilyByPhone('+12125550999')).toBeNull();
  });

  it('records when a size was last confirmed, so staff can spot stale households', async () => {
    const slotId = await makeSlot();
    const contact = await upsertContact('web', 'w', 'en');
    await bookPickup({
      slotId, contactId: contact.id, role: 'family',
      families: [{ phone: '+12125550100', size: 4, allergies: [] }],
      tiers: TIERS,
    });
    const [{ size_confirmed_at }] = await query<{ size_confirmed_at: Date | null }>(
      `SELECT size_confirmed_at FROM families WHERE phone_e164 = '+12125550100'`,
    );
    expect(size_confirmed_at).not.toBeNull();
  });
});
