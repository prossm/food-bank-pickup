import type { FoodTier } from './types';

/**
 * Resolves a household size to its food tier.
 *
 * Throws on an unmapped size rather than falling back to a default. A silent default here
 * would mean a family quietly receives the wrong amount of food, which is worse than an
 * error someone has to look at — the seeded tiers are a placeholder pending confirmation
 * from the food bank, so gaps are a live possibility.
 */
export function tierFor(size: number, tiers: readonly FoodTier[]): FoodTier {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Invalid household size: ${size}`);
  }
  const match = tiers.find(
    (t) => size >= t.minSize && (t.maxSize === null || size <= t.maxSize),
  );
  if (!match) {
    throw new Error(
      `No food tier covers household size ${size}. Tiers must cover every size with no gaps.`,
    );
  }
  return match;
}

/** Total boxes to stage for a set of households. */
export function boxesFor(sizes: readonly number[], tiers: readonly FoodTier[]): number {
  return sizes.reduce((sum, s) => sum + tierFor(s, tiers).boxes, 0);
}
