import { describe, it, expect } from 'vitest';
import { transition } from '@/lib/conversation/machine';
import {
  initialState,
  type Effect,
  type SessionState,
  type TransitionContext,
} from '@/lib/conversation/types';
import { keywordParser } from '@/lib/conversation/parser/keyword-parser';
import { NODE_SPECS, slotOptions } from '@/lib/conversation/nodes';
import { render } from '@/lib/i18n/render';
import type { AllergyKind, FoodTier, SlotView } from '@/lib/domain/types';

const TIERS: FoodTier[] = [
  { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
  { id: 'medium', minSize: 3, maxSize: 5, boxes: 2, labelKey: 'tier.medium' },
  { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
];

const SLOTS: SlotView[] = [
  { id: 'slot-5pm', startsAt: new Date('2026-07-22T21:00:00Z'), capacity: 30, spotsUsed: 18, spotsLeft: 12 },
  { id: 'slot-530pm', startsAt: new Date('2026-07-22T21:30:00Z'), capacity: 30, spotsUsed: 0, spotsLeft: 30 },
];

const CTX: TransitionContext = { slots: SLOTS, tiers: TIERS };

type Registry = Record<string, { size: number; allergies: AllergyKind[] }>;

/**
 * Stands in for the runner: drives real text through the real parser, and answers
 * LOOKUP_FAMILY from a fake registry — so these tests cover text → intent → state → effect
 * end to end with no database.
 */
async function converse(texts: string[], ctx: TransitionContext = CTX, known: Registry = {}) {
  let state = initialState();
  const sent: string[] = [];
  let booked: Effect | null = null;

  const settle = (out: ReturnType<typeof transition>) => {
    state = out.state;
    sent.push(...out.out.map((s) => render(s, state.locale)));
    const pending = [...out.effects];
    while (pending.length) {
      const effect = pending.shift()!;
      if (effect.type === 'BOOK') {
        booked = effect;
        continue;
      }
      const hit = known[effect.phone];
      const after = transition(
        state,
        {
          type: 'effectResult',
          result: hit
            ? { kind: 'family_known', phone: effect.phone, size: hit.size, allergies: hit.allergies }
            : { kind: 'family_new', phone: effect.phone },
        },
        ctx,
      );
      state = after.state;
      sent.push(...after.out.map((s) => render(s, state.locale)));
      pending.push(...after.effects);
    }
  };

  for (const text of texts) {
    const spec = NODE_SPECS[state.node];
    const options = state.node === 'SLOT_SELECT' ? slotOptions(ctx.slots) : (spec.options ?? []);
    const intent = await keywordParser.parse({ text, node: state.node, locale: state.locale, options });
    settle(transition(state, { type: 'intent', intent }, ctx));
    if (booked) break;
  }
  return { state, sent, booked: booked as Effect | null };
}

describe('a family signing up for itself', () => {
  it('is identified by phone and never asked for a name', async () => {
    const { state, sent } = await converse(['1', '2', '212-555-0100', '4', '4']);

    expect(state.node).toBe('SLOT_SELECT');
    expect(state.families).toEqual([
      { phone: '+12125550100', size: 4, allergies: [], known: false, isSelf: true },
    ]);
    expect(sent.join('\n')).not.toMatch(/last name|apellido/i);
    expect(sent.at(-1)).toContain('12 spots left');
  });
});

describe('an ambassador who knows numbers, not names', () => {
  it('collects a phone per household and counts their own on top', async () => {
    const { state, sent } = await converse([
      '1', '1',              // English, ambassador
      'yes',                 // picking up for their own household too
      '2',                   // two OTHER families
      '212-555-0100', '4', '2',
      '212-555-0187', '6', '4',
      '212-555-0199', '2', '3',
    ]);

    expect(state.familyCount).toBe(3);
    expect(state.families.map((f) => f.phone)).toEqual([
      '+12125550100',
      '+12125550187',
      '+12125550199',
    ]);
    expect(state.families[0].isSelf).toBe(true);
    expect(state.families[1].isSelf).toBe(false);
    expect(state.families[2].allergies).toEqual(['gluten_free', 'dairy_free']);
    expect(sent.join('\n')).not.toMatch(/last name/i);
  });

  it('shows phones on the confirmation, formatted for humans', async () => {
    const { sent } = await converse([
      '1', '1', 'no', '2',
      '2125550187', '6', '4',
      '2125550199', '2', '4',
      '1',
    ]);
    const summary = sent.at(-1)!;
    expect(summary).toContain('(212) 555-0187 — 6 people');
    expect(summary).toContain('(212) 555-0199 — 2 people');
    expect(summary).toContain('4 boxes'); // 3 + 1
    expect(summary).not.toContain('+1212'); // E.164 is storage, not display
  });
});

describe('dedupe by phone', () => {
  it('reuses a known household and skips its two questions', async () => {
    const known: Registry = { '+12125550187': { size: 6, allergies: ['dairy_free'] } };
    const { state, sent } = await converse(
      ['1', '1', 'no', '2', '212-555-0187', '212-555-0199', '2', '4'],
      CTX,
      known,
    );

    // The known household needed only its phone; the unknown one needed size + restrictions.
    expect(state.families).toEqual([
      { phone: '+12125550187', size: 6, allergies: ['dairy_free'], known: true, isSelf: false },
      { phone: '+12125550199', size: 2, allergies: [], known: false, isSelf: false },
    ]);
    expect(state.node).toBe('SLOT_SELECT');
  });

  it('says it recognised the household, but does not leak its details', async () => {
    const known: Registry = { '+12125550187': { size: 6, allergies: ['dairy_free'] } };
    const { sent } = await converse(['1', '2', '212-555-0187'], CTX, known);

    const ack = sent.find((m) => m.includes('already on file'))!;
    expect(ack).toBeDefined();
    // Whoever holds a phone shouldn't learn a household's size by guessing numbers at it.
    expect(ack).not.toMatch(/\b6\b/);
    expect(ack.toLowerCase()).not.toContain('dairy');
  });

  it('treats differently-typed spellings of one number as the same household', async () => {
    const known: Registry = { '+12125550187': { size: 6, allergies: [] } };
    for (const spelling of ['212-555-0187', '(212) 555-0187', '+1 212 555 0187', '2125550187']) {
      const { state } = await converse(['1', '2', spelling], CTX, known);
      expect(state.families[0]?.known, `${spelling} should be recognised`).toBe(true);
    }
  });

  it('rejects the same number twice in one conversation', async () => {
    // Otherwise an ambassador books "two" households that are one row, and the second
    // silently overwrites the first — they'd leave with too little food.
    const { state, sent } = await converse([
      '1', '1', 'no', '2',
      '212-555-0187', '6', '4',
      '212-555-0187',
    ]);
    expect(state.node).toBe('FAMILY_PHONE');
    expect(state.families).toHaveLength(1);
    expect(sent.join()).toContain('already added that phone number');
  });

  it('requires a phone — SKIP is no longer a way out', async () => {
    const { state, sent } = await converse(['1', '2', 'skip']);
    expect(state.node).toBe('FAMILY_PHONE');
    expect(sent.join()).toContain("doesn't look like a phone number");
  });
});

describe('input handling', () => {
  it('speaks Spanish, accent-free and in words', async () => {
    const a = await converse(['2']);
    expect(a.state.locale).toBe('es');
    expect(a.sent.at(-1)).toContain('¿Recoge solo para su hogar');

    const c = await converse(['2', '1', 'si']);
    expect(c.state.includeSelf).toBe(true);
    expect(c.state.node).toBe('FAMILY_COUNT');
  });

  it('rejects invalid phone numbers, including the fictional 555 area code', async () => {
    const bad = await converse(['1', '2', '12']);
    expect(bad.state.node).toBe('FAMILY_PHONE');

    const fake = await converse(['1', '2', '(555) 010-0100']);
    expect(fake.state.node).toBe('FAMILY_PHONE');
  });

  it('rejects a household size of zero and an absurd family count', async () => {
    const zero = await converse(['1', '2', '212-555-0100', '0']);
    expect(zero.state.node).toBe('FAMILY_SIZE');
    expect(zero.sent.join()).toContain('between 1 and 30');

    const many = await converse(['1', '1', 'no', '40']);
    expect(many.state.node).toBe('FAMILY_COUNT');
  });
});

describe('global commands', () => {
  it('RESTART wipes collected households', async () => {
    const { state } = await converse(['1', '2', '212-555-0100', '4', '4', 'restart']);
    expect(state.node).toBe('LANG_SELECT');
    expect(state.families).toEqual([]);
  });

  it('BACK re-opens the previous household mid-loop', async () => {
    const { state } = await converse([
      '1', '1', 'no', '2',
      '212-555-0187', '4', '4',
      'back',
    ]);
    expect(state.node).toBe('FAMILY_PHONE');
    expect(state.cursor).toBe(0);
    expect(state.families).toEqual([]);
  });

  it('BACK from the slot list re-opens a recognised household at its phone prompt', async () => {
    // A recognised household answered no questions, so there is no size step to go back to.
    const known: Registry = { '+12125550187': { size: 6, allergies: [] } };
    const { state } = await converse(['1', '2', '212-555-0187', 'back'], CTX, known);
    expect(state.node).toBe('FAMILY_PHONE');
    expect(state.families).toEqual([]);
  });
});

describe('booking', () => {
  it('emits a BOOK effect on confirm rather than touching a database', async () => {
    const { booked } = await converse(['1', '2', '212-555-0100', '4', '4', '1', 'yes']);
    expect(booked).toEqual({ type: 'BOOK', slotId: 'slot-5pm' });
  });

  it('keeps the households when the slot fills up mid-conversation', async () => {
    const { state } = await converse(['1', '2', '212-555-0100', '4', '4', '1', 'yes']);
    const after = transition(state, { type: 'effectResult', result: { kind: 'slot_full' } }, CTX);
    expect(after.state.node).toBe('SLOT_SELECT');
    expect(after.state.families).toHaveLength(1);
    expect(render(after.out[0], 'en')).toContain('filled up');
  });
});

describe('purity', () => {
  it('never mutates the state it was handed', async () => {
    const state = initialState();
    const frozen = JSON.stringify(state);
    const spec = NODE_SPECS[state.node];
    const intent = await keywordParser.parse({
      text: '1', node: state.node, locale: state.locale, options: spec.options ?? [],
    });
    transition(state, { type: 'intent', intent }, CTX);
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
