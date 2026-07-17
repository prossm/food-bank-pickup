import type { PoolClient } from 'pg';
import { transaction } from '../client';
import { tierFor } from '@/lib/domain/food-tiers';
import { upsertFamilyByPhone, setAllergies } from './families';
import type { FamilyDraft, FoodTier, PickupRole } from '@/lib/domain/types';

export type BookResult =
  | { kind: 'booked'; pickupId: string; code: string }
  | { kind: 'slot_full' }
  | { kind: 'already_booked' };

/**
 * Claims one spot (one car) in a slot and creates the pickup row, atomically.
 *
 * The capacity guard lives INSIDE the UPDATE, which is what makes this safe under the
 * default READ COMMITTED isolation. When two requests race, the second blocks on the first's
 * row lock; on waking, Postgres re-evaluates the WHERE clause against the newly committed row
 * rather than its own stale snapshot. So the request that would be number 31 re-checks
 * `30 < 30`, fails the predicate, updates zero rows, and the dependent INSERT inserts nothing.
 *
 * The tempting alternatives are both broken: SELECT count(*) followed by INSERT lets two
 * racers read 29 from the same snapshot and both insert, and pushing that count into an
 * `INSERT ... SELECT WHERE (SELECT count(*)) < capacity` subquery fails identically — the
 * subquery reads a snapshot and takes no locks. It looks atomic and isn't.
 *
 * Zero rows returned means the slot filled up. That is an expected outcome, not an error.
 */
async function claimSpot(
  tx: PoolClient,
  slotId: string,
  contactId: string,
  role: PickupRole,
  code: string,
): Promise<{ id: string } | null> {
  const res = await tx.query(
    `
    WITH claim AS (
      UPDATE slots
         SET booked_count = booked_count + 1
       WHERE id = $1
         AND status = 'open'
         AND booked_count < capacity
      RETURNING id
    )
    INSERT INTO pickups (slot_id, contact_id, role, confirmation_code)
    SELECT id, $2, $3, $4 FROM claim
    RETURNING id
    `,
    [slotId, contactId, role, code],
  );
  return res.rows[0] ?? null;
}

function confirmationCode(): string {
  // Ambiguous glyphs removed: this gets read aloud and typed back by someone at a curb.
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Books a pickup: one spot, N families.
 *
 * The claim runs first inside the transaction so the family writes only happen once a spot is
 * actually secured, and a rollback releases the increment.
 */
export async function bookPickup(args: {
  slotId: string;
  contactId: string;
  role: PickupRole;
  families: FamilyDraft[];
  tiers: readonly FoodTier[];
}): Promise<BookResult> {
  const { slotId, contactId, role, families, tiers } = args;

  // Validate tiers BEFORE opening the transaction: tierFor throws on an uncovered household
  // size, and it should fail without having burned a spot.
  families.forEach((f) => tierFor(f.size, tiers));

  try {
    return await transaction(async (tx) => {
      const code = confirmationCode();
      const claimed = await claimSpot(tx, slotId, contactId, role, code);
      if (!claimed) return { kind: 'slot_full' as const };

      for (const [i, draft] of families.entries()) {
        // Dedupe on phone: the same household signing up every week is one row, not fifty.
        const fam = await upsertFamilyByPhone(tx, draft.phone, draft.size, contactId);

        // Only a brand new household takes its restrictions from this conversation. For a
        // known one the flow never asked, so `draft.allergies` is just an echo of what's
        // already stored and re-writing it would be busywork at best.
        if (fam.isNew) await setAllergies(tx, fam.id, draft.allergies);

        // Snapshot from what the DATABASE holds, not the draft. If another conversation
        // created this household between our lookup and now, its size is the real one, and
        // the box we stage must match the row rather than our stale read.
        const tier = tierFor(fam.size, tiers);
        await tx.query(
          `INSERT INTO pickup_families
             (pickup_id, family_id, position, family_size_snapshot, food_tier_snapshot)
           VALUES ($1, $2, $3, $4, $5)`,
          [claimed.id, fam.id, i + 1, fam.size, tier.id],
        );
      }

      await tx.query(
        `INSERT INTO notifications (pickup_id, kind) VALUES ($1, 'confirmation')
         ON CONFLICT DO NOTHING`,
        [claimed.id],
      );

      return { kind: 'booked' as const, pickupId: claimed.id, code };
    });
  } catch (err: unknown) {
    // Unique violation on pickups_one_active_per_contact_slot: the same contact already holds
    // this slot. That's an impatient double-tap, not a failure.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      return { kind: 'already_booked' };
    }
    throw err;
  }
}

/**
 * Releases a spot. Not wired into the conversation in v1, but the decrement is guarded by
 * `status = 'booked'` so a double-cancel cannot decrement twice — worth fixing in place
 * rather than rediscovering later.
 */
export async function cancelPickup(pickupId: string): Promise<boolean> {
  return transaction(async (tx) => {
    const res = await tx.query(
      `
      WITH c AS (
        UPDATE pickups SET status = 'cancelled', cancelled_at = now()
         WHERE id = $1 AND status = 'booked'
        RETURNING slot_id
      )
      UPDATE slots SET booked_count = booked_count - 1
        FROM c WHERE slots.id = c.slot_id
      RETURNING slots.id
      `,
      [pickupId],
    );
    return res.rows.length > 0;
  });
}
