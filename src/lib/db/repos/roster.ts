import { query } from '../client';

export interface RosterHousehold {
  phone: string | null;
  /** Supplied by staff; null until someone fills it in. The chat never asks. */
  name: string | null;
  size: number;
  boxes: number;
  allergies: string[];
  /** When a human last confirmed the size. Null for rows predating the column. */
  sizeConfirmedAt: Date | null;
}

export interface RosterRow {
  code: string;
  role: string;
  startsAt: Date;
  families: number;
  people: number;
  boxes: number;
  households: RosterHousehold[];
  allergies: string | null;
}

interface Row extends Record<string, unknown> {
  code: string;
  role: string;
  starts_at: Date;
  families: string;
  people: string;
  boxes: string;
  households: RosterHousehold[] | null;
  allergies: string | null;
}

/**
 * Every booked pickup with its household counts and box total.
 *
 * The per-family figures are collapsed in a CTE *before* aggregating. Joining
 * family_allergies directly into this query would fan out one row per allergy, so a family
 * marked both gluten free and dairy free would be counted twice — silently doubling both the
 * people count and the box order for that household. The bug looks like nothing until the
 * week someone over-orders.
 */
export async function bookedPickups(): Promise<RosterRow[]> {
  const rows = await query<Row>(`
    WITH fam AS (
      SELECT
        pf.pickup_id,
        pf.family_id,
        pf.position,
        pf.family_size_snapshot,
        COALESCE(t.boxes, 0) AS boxes,
        f.name,
        f.phone_e164,
        f.size_confirmed_at,
        ARRAY(SELECT fa.kind::text FROM family_allergies fa
               WHERE fa.family_id = f.id ORDER BY fa.kind::text) AS kinds
      FROM pickup_families pf
      JOIN families f       ON f.id = pf.family_id
      LEFT JOIN food_tiers t ON t.id = pf.food_tier_snapshot
    )
    SELECT
      p.confirmation_code                        AS code,
      p.role::text                               AS role,
      s.starts_at,
      COUNT(fam.family_id)                       AS families,
      COALESCE(SUM(fam.family_size_snapshot), 0) AS people,
      COALESCE(SUM(fam.boxes), 0)                AS boxes,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'phone', fam.phone_e164,
            'name', fam.name,
            'size', fam.family_size_snapshot,
            'boxes', fam.boxes,
            'allergies', to_jsonb(fam.kinds),
            'sizeConfirmedAt', fam.size_confirmed_at
          ) ORDER BY fam.position
        ) FILTER (WHERE fam.family_id IS NOT NULL),
        '[]'::jsonb
      )                                          AS households,
      -- Correlated, so it can't fan out the sums above. Aggregating fam.allergies directly
      -- would concatenate per-household strings and repeat kinds ("dairy free, dairy free").
      (SELECT string_agg(DISTINCT fa.kind::text, ', ')
         FROM pickup_families pf2
         JOIN family_allergies fa ON fa.family_id = pf2.family_id
        WHERE pf2.pickup_id = p.id)              AS allergies
    FROM pickups p
    JOIN slots s      ON s.id = p.slot_id
    LEFT JOIN fam     ON fam.pickup_id = p.id
    WHERE p.status = 'booked'
    GROUP BY p.id, s.starts_at, p.created_at
    ORDER BY s.starts_at, p.created_at
  `);

  return rows.map((r) => ({
    code: r.code,
    role: r.role,
    startsAt: new Date(r.starts_at),
    families: Number(r.families),
    people: Number(r.people),
    boxes: Number(r.boxes),
    households: (r.households ?? []).map((h) => ({
      ...h,
      size: Number(h.size),
      boxes: Number(h.boxes),
      sizeConfirmedAt: h.sizeConfirmedAt ? new Date(h.sizeConfirmedAt) : null,
    })),
    allergies: r.allergies,
  }));
}
