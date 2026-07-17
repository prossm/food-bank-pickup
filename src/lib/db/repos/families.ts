import type { PoolClient } from 'pg';
import { query } from '../client';
import type { AllergyKind } from '@/lib/domain/types';

export interface KnownFamily {
  id: string;
  size: number;
  allergies: AllergyKind[];
}

interface FamilyRow extends Record<string, unknown> {
  id: string;
  family_size: number;
  allergies: AllergyKind[] | null;
}

/**
 * Looks a household up by phone — the dedupe read behind the LOOKUP_FAMILY effect.
 *
 * Returns null for an unknown number, which sends the conversation down the ask-size-and-
 * restrictions path.
 */
export async function findFamilyByPhone(phone: string): Promise<KnownFamily | null> {
  const rows = await query<FamilyRow>(
    `SELECT f.id, f.family_size,
            ARRAY(SELECT fa.kind::text FROM family_allergies fa WHERE fa.family_id = f.id
                   ORDER BY fa.kind::text) AS allergies
       FROM families f
      WHERE f.phone_e164 = $1`,
    [phone],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, size: Number(row.family_size), allergies: row.allergies ?? [] };
}

export interface UpsertResult {
  id: string;
  /** The size actually stored, which for a known household is what's on file, not the draft. */
  size: number;
  isNew: boolean;
}

/**
 * Finds or creates the household for a phone number, inside the booking transaction.
 *
 * Notably it does NOT update an existing row. A recognised household reuses its stored size
 * and restrictions (the flow never re-asks), so there is nothing new to write — and blindly
 * writing the draft back would let a stale in-flight conversation overwrite fresher data.
 * It also must never touch `name`: that column belongs to staff, and the chat has no idea
 * what it should be.
 *
 * The DO UPDATE is a deliberate no-op touch. ON CONFLICT DO NOTHING returns no row when it
 * conflicts, which would force a second round trip to fetch the winner; touching the phone
 * with its own value makes RETURNING work on both paths and closes the race where two
 * ambassadors add the same household at once.
 */
export async function upsertFamilyByPhone(
  tx: PoolClient,
  phone: string,
  size: number,
  contactId: string,
): Promise<UpsertResult> {
  const res = await tx.query<{ id: string; family_size: number; inserted: boolean }>(
    `
    INSERT INTO families (phone_e164, family_size, created_by_contact_id, size_confirmed_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (phone_e164) WHERE phone_e164 IS NOT NULL
      DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
    RETURNING id, family_size, (xmax = 0) AS inserted
    `,
    [phone, size, contactId],
  );
  const row = res.rows[0];
  return { id: row.id, size: Number(row.family_size), isNew: row.inserted };
}

export async function setAllergies(
  tx: PoolClient,
  familyId: string,
  allergies: AllergyKind[],
): Promise<void> {
  for (const kind of allergies) {
    await tx.query(
      `INSERT INTO family_allergies (family_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [familyId, kind],
    );
  }
}
