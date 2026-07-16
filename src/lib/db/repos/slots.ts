import { query } from '../client';
import { FOOD_BANK_TZ } from '@/lib/i18n/format';
import type { SlotView } from '@/lib/domain/types';

interface SlotLoadRow extends Record<string, unknown> {
  id: string;
  starts_at: Date;
  capacity: number;
  spots_used: number;
  spots_left: number;
  families_served: string;
  people_served: string;
}

/**
 * The slots to offer next: one pickup day's worth, being the soonest day that still has room.
 *
 * Scoped to a single day on purpose. Slots are seeded weeks ahead, and listing all of them
 * produced a twelve-option text message — unreadable on a phone, and not what people want
 * anyway, since food need is this-week need. If every slot on the soonest day is full, this
 * rolls to the next day that isn't, rather than offering a choice between two full times.
 *
 * The spots_left figures are an unlocked read and are stale the moment they're rendered.
 * That's intended — they're a display value. claimSpot re-checks capacity atomically, and
 * nothing may gate an insert on a number from here.
 */
export async function listOpenSlots(): Promise<SlotView[]> {
  const rows = await query<SlotLoadRow>(
    `
    WITH avail AS (
      SELECT * FROM slot_load WHERE status = 'open' AND starts_at > now()
    ),
    target_day AS (
      SELECT MIN((starts_at AT TIME ZONE $1)::date) AS d
        FROM avail WHERE spots_left > 0
    )
    SELECT a.id, a.starts_at, a.capacity, a.spots_used, a.spots_left
      FROM avail a, target_day
     WHERE (a.starts_at AT TIME ZONE $1)::date = target_day.d
     ORDER BY a.starts_at
    `,
    [FOOD_BANK_TZ],
  );
  return rows.map((r) => ({
    id: r.id,
    startsAt: new Date(r.starts_at),
    capacity: Number(r.capacity),
    spotsUsed: Number(r.spots_used),
    spotsLeft: Number(r.spots_left),
  }));
}

export interface SlotRoster {
  id: string;
  startsAt: Date;
  capacity: number;
  spotsUsed: number;
  spotsLeft: number;
  familiesServed: number;
  peopleServed: number;
}

export async function slotRoster(): Promise<SlotRoster[]> {
  const rows = await query<SlotLoadRow>(
    `SELECT id, starts_at, capacity, spots_used, spots_left, families_served, people_served
       FROM slot_load ORDER BY starts_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    startsAt: new Date(r.starts_at),
    capacity: Number(r.capacity),
    spotsUsed: Number(r.spots_used),
    spotsLeft: Number(r.spots_left),
    familiesServed: Number(r.families_served),
    peopleServed: Number(r.people_served),
  }));
}
