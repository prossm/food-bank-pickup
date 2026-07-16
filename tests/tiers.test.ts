import { describe, it, expect } from 'vitest';
import { tierFor, boxesFor } from '@/lib/domain/food-tiers';
import type { FoodTier } from '@/lib/domain/types';

// Mirrors scripts/seed.ts. These boundaries are a PLACEHOLDER — the brief specifies "3-4"
// and "6+", which defines neither 5 nor 1-2, so the real numbers are pending confirmation
// from the food bank.
const SEEDED: FoodTier[] = [
  { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
  { id: 'medium', minSize: 3, maxSize: 5, boxes: 2, labelKey: 'tier.medium' },
  { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
];

describe('food tiers', () => {
  it('covers every household size from 1 to 30 with exactly one tier', () => {
    for (let size = 1; size <= 30; size++) {
      const matches = SEEDED.filter(
        (t) => size >= t.minSize && (t.maxSize === null || size <= t.maxSize),
      );
      expect(matches, `household size ${size} matched ${matches.length} tiers`).toHaveLength(1);
    }
  });

  it('maps the sizes the brief actually named', () => {
    expect(tierFor(3, SEEDED).id).toBe('medium'); // "3-4"
    expect(tierFor(4, SEEDED).id).toBe('medium');
    expect(tierFor(6, SEEDED).id).toBe('large'); // "6+"
    expect(tierFor(12, SEEDED).id).toBe('large');
  });

  it('THROWS rather than guessing when a size falls in a gap', () => {
    // A gap is a live possibility while the boundaries are unconfirmed. Silently defaulting
    // would send a family home with the wrong amount of food and nobody would ever notice.
    const gapped: FoodTier[] = [
      { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
      { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
    ];
    expect(() => tierFor(4, gapped)).toThrow(/No food tier covers household size 4/);
  });

  it('rejects nonsense sizes', () => {
    expect(() => tierFor(0, SEEDED)).toThrow(/Invalid household size/);
    expect(() => tierFor(-3, SEEDED)).toThrow(/Invalid household size/);
    expect(() => tierFor(2.5, SEEDED)).toThrow(/Invalid household size/);
  });

  it('sums boxes across an ambassador load', () => {
    expect(boxesFor([4, 6, 2, 5, 5], SEEDED)).toBe(2 + 3 + 1 + 2 + 2);
  });
});
