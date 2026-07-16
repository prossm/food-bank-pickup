import { query } from '../client';
import type { FoodTier } from '@/lib/domain/types';

interface TierRow extends Record<string, unknown> {
  id: string;
  min_size: number;
  max_size: number | null;
  boxes: number;
  label_key: string;
}

export async function listTiers(): Promise<FoodTier[]> {
  const rows = await query<TierRow>(
    `SELECT id, min_size, max_size, boxes, label_key FROM food_tiers ORDER BY min_size`,
  );
  return rows.map((r) => ({
    id: r.id,
    minSize: Number(r.min_size),
    maxSize: r.max_size === null ? null : Number(r.max_size),
    boxes: Number(r.boxes),
    labelKey: r.label_key,
  }));
}
